"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import SendRoundedIcon from "@mui/icons-material/SendRounded";
import MicRoundedIcon from "@mui/icons-material/MicRounded";
import StopRoundedIcon from "@mui/icons-material/StopRounded";
import PushPinRoundedIcon from "@mui/icons-material/PushPinRounded";
import BlockRoundedIcon from "@mui/icons-material/BlockRounded";
import DownloadRoundedIcon from "@mui/icons-material/DownloadRounded";
import CloseIcon from "@/components/ui/CloseIcon";
import AddRoundedIcon from "@mui/icons-material/AddRounded";
import DoneRoundedIcon from "@mui/icons-material/DoneRounded";
import ScheduleRoundedIcon from "@mui/icons-material/ScheduleRounded";
import DoneAllRoundedIcon from "@mui/icons-material/DoneAllRounded";
import InsertDriveFileRoundedIcon from "@mui/icons-material/InsertDriveFileRounded";
import OptionsMenu from "@/components/ui/OptionsMenu";
import { createPortal } from "react-dom";
import Button from "@/components/shared/Button";
import TextField from "@/components/shared/TextField";
import IconButton from "@/components/shared/IconButton";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
// Time with the chat in front of somebody, for the WhatsApp Usage report - measured the same way
// the application's own usage is, and only while the tab is visible and being touched.
import useUsageHeartbeat from "@/components/app-shell/useUsageHeartbeat";
import useEscapeKey from "@/components/shared/useEscapeKey";
import {
  actOnWhatsappMessage,
  connectWhatsapp,
  fetchWhatsappMedia,
  getWhatsappThread,
  subscribeToWhatsappThread,
  logoutWhatsapp,
  markWhatsappThreadRead,
  sendWhatsappAttachment,
  sendWhatsappMessage,
} from "@/services/sales/whatsapp-chat.service";

/**
 * The conversation with one client, inside the lead it belongs to.
 *
 * The CRM links their own WhatsApp once by scanning a code, the same way a desktop or a second
 * phone is linked, and from then on this is the thread with this lead and nothing else. Their
 * other conversations are never shown here and are never stored: the server keeps a message only
 * when the number on the other end is a lead in this CRM.
 */

// While pairing, the code has to be replaced as WhatsApp rotates it, and there is no stream to
// carry that - the panel is not looking at a conversation yet.
const PAIRING_POLL_MS = 2500;
/*
 * ── How the panel finds out that a client replied ─────────────────────────────────────────────
 *
 * By being told. `subscribeToWhatsappThread` holds a line open and the server says one word the
 * moment anything is written to this conversation; the panel then re-reads it. A reply reaches the
 * screen in about the time one round trip takes.
 *
 * Polling is what happens when that line is not there - a proxy that will not pass a stream, a
 * network that dropped it, a browser tab the OS has throttled. Two beats, because the two cases are
 * not equally urgent:
 *
 *   FALLBACK  no stream. The old behaviour, and the reply has nothing else to arrive by.
 *   SAFETY    the stream is up. Rare, and only to catch the one thing a push cannot: an event
 *             emitted while this panel was between connections. Slow enough to cost nothing.
 *
 * The old code polled at the fallback beat *always* and with no guard against one request starting
 * before the last had answered, so a thread that was slow to read got slower the longer it was open.
 * `loadingRef` below is that guard, and it matters more than either number here.
 */
const THREAD_POLL_MS = 1200;
const THREAD_SAFETY_POLL_MS = 20000;

function formatTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h12" }).format(date);
}

/**
 * The ticks WhatsApp itself draws.
 *
 * One for gone, two for arrived on their phone, two blue for read. Only on messages this side
 * sent: there is nothing to report about a message that came the other way.
 */
function MessageTicks({ message }) {
  if (message.direction !== "out") return null;
  if (message.status === "sending") {
    return <ScheduleRoundedIcon aria-label="Sending" sx={{ fontSize: 15 }} className="text-emerald-100/80" />;
  }
  const read = message.status === "read";
  const Icon = message.status === "sent" ? DoneRoundedIcon : DoneAllRoundedIcon;
  return (
    <Icon
      aria-label={read ? "Read" : message.status === "delivered" ? "Delivered" : "Sent"}
      sx={{ fontSize: 17 }}
      className={read ? "text-[#53bdeb]" : "text-emerald-100/90"}
    />
  );
}

/**
 * What a message is replying to, above the message.
 *
 * The same block WhatsApp draws: a coloured edge, who wrote it, and a line of what was said. A
 * reply without it is half a sentence - "yes" against nothing.
 */
function QuotedMessage({ message, leadName }) {
  if (!message.quotedBody) return null;
  const outgoing = message.direction === "out";
  // "You" when the quoted message was ours; the lead by name when it was theirs, which is what
  // WhatsApp shows and what tells the two apart at a glance.
  const author = message.quotedAuthor || leadName || "Them";
  return (
    <div className={`mb-1.5 rounded-md border-l-[3px] px-2 py-1 text-xs ${
      outgoing ? "border-emerald-200 bg-emerald-700/40" : "border-emerald-500 bg-slate-100"
    }`}>
      <p className={`font-semibold ${outgoing ? "text-emerald-100" : "text-emerald-700"}`}>
        {author}
      </p>
      <p className={`truncate ${outgoing ? "text-emerald-50/90" : "text-slate-600"}`}>{message.quotedBody}</p>
    </div>
  );
}

/**
 * A photo or a video at full size, over the page.
 *
 * The same shape Image Selection's preview uses - dark, full screen, one row of controls - so a
 * picture opens the same way wherever it is opened from. It shows what the bubble already fetched
 * rather than fetching again: the blob belongs to the bubble behind it, which stays mounted while
 * this is open.
 */
function MediaViewer({ message, url, onClose }) {
  // Escape leaves the photo, not the chat panel behind it.
  useEscapeKey(onClose);

  const name = message.mediaName || `${message.mediaType}-${message.id}`;

  return createPortal(
    <div
      className="fixed inset-0 z-[220] flex flex-col bg-slate-950/95"
      role="dialog"
      aria-modal="true"
      aria-label={`${message.mediaType} preview`}
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-white/10 px-4 text-white">
        <p className="min-w-0 truncate text-sm font-medium">{name}</p>
        <div className="flex shrink-0 items-center gap-2">
          {/* A real download rather than a new tab: the blob is the file, and the name is the
              one the client sent it under. */}
          <a
            href={url}
            download={name}
            className="inline-flex min-h-9 items-center gap-2 rounded-md bg-white/10 px-3 text-xs font-medium text-white transition hover:bg-white/20 sm:text-sm"
          >
            <DownloadRoundedIcon sx={{ fontSize: 18 }} />
            Download
          </a>
          <IconButton label="Close preview" size="sm" shape="circle" onClick={onClose} className="text-white hover:bg-white/10">
            <CloseIcon />
          </IconButton>
        </div>
      </header>
      <div className="flex min-h-0 flex-1 items-center justify-center p-4 sm:p-6">
        {message.mediaType === "video" ? (
          <video src={url} controls autoPlay className="max-h-full max-w-full rounded-lg" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={name} className="max-h-full max-w-full rounded-lg object-contain" />
        )}
      </div>
    </div>,
    document.body,
  );
}

/**
 * A file in the thread.
 *
 * Fetched rather than linked: the endpoint is behind the same login as the rest of the API, and a
 * bare src carries no token. The blob is released when the bubble goes, so a long conversation
 * does not leave a pile of them behind.
 */
function MediaBubble({ message, onOpen }) {
  const [url, setUrl] = useState("");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let revoked = "";
    let cancelled = false;
    fetchWhatsappMedia(message.id)
      .then((objectUrl) => {
        if (cancelled) {
          URL.revokeObjectURL(objectUrl);
          return;
        }
        revoked = objectUrl;
        setUrl(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [message.id]);

  const name = message.mediaName || message.mediaType;

  if (failed) return <p className="text-xs italic opacity-80">[{message.mediaType} no longer stored]</p>;
  if (!url) return <p className="text-xs italic opacity-80">Loading {message.mediaType}...</p>;

  if (message.mediaType === "image" || message.mediaType === "sticker") {
    return (
      // A photo opens; that is what a photo in a chat does.
      <button type="button" onClick={() => onOpen?.(url)} className="block w-full" aria-label={`Open ${name}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt={name} className="max-h-64 w-full rounded-lg object-cover" />
      </button>
    );
  }
  if (message.mediaType === "video") {
    return (
      <div className="space-y-1">
        <video src={url} controls className="max-h-64 w-full rounded-lg" />
        <button type="button" onClick={() => onOpen?.(url)} className="text-xs underline opacity-90">
          Open full screen
        </button>
      </div>
    );
  }
  if (message.mediaType === "audio") {
    return <audio src={url} controls className="w-full" />;
  }
  return (
    <a href={url} download={name} className="flex items-center gap-2 underline" title={`Download ${name}`}>
      <InsertDriveFileRoundedIcon sx={{ fontSize: 18 }} />
      <span className="min-w-0 flex-1 truncate">{name}</span>
      <DownloadRoundedIcon sx={{ fontSize: 16 }} />
    </a>
  );
}

/**
 * The camera, in a dialog rather than a file picker.
 *
 * A file input with a capture attribute opens the camera on a phone and the file browser on a
 * desktop, which is where the CRM actually sits - so it opened "under attachments" instead of
 * taking a photo. This asks the browser for the camera itself and sends what it sees.
 */
function CameraDialog({ onClose, onCapture }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: "environment" } })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
      })
      .catch(() => {
        if (!cancelled) setError("No camera available, or permission was refused.");
      });
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  function take() {
    const video = videoRef.current;
    if (!video?.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d").drawImage(video, 0, 0);
    canvas.toBlob((blob) => {
      if (blob) onCapture(new File([blob], `photo-${Date.now()}.jpg`, { type: "image/jpeg" }));
      onClose();
    }, "image/jpeg", 0.9);
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-950/55 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section role="dialog" aria-modal="true" aria-label="Take a photo" className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-center bg-slate-900">
          {error ? (
            <p className="p-8 text-center text-sm text-white">{error}</p>
          ) : (
            <video ref={videoRef} autoPlay playsInline muted className="max-h-[60vh] w-full object-contain" />
          )}
        </div>
        <footer className="flex items-center justify-end gap-3 px-5 py-4">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="button" variant="primary" onClick={take} disabled={Boolean(error)}>Take photo</Button>
        </footer>
      </section>
    </div>
  );
}

/**
 * What a right-click on a message offers.
 *
 * WhatsApp's own list, minus the two that belong to WhatsApp rather than to a CRM: Meta AI and
 * Star. Drawn where the pointer is and closed by the next click anywhere, the way a context menu
 * behaves - and kept inside the window when the click lands near an edge.
 */
function MessageMenu({ menu, onClose, onReply, onCopy, onReact, onForward, onPin, onEdit, onDelete, onInfo }) {
  const { message } = menu;
  useEffect(() => {
    const close = () => onClose();
    window.addEventListener("click", close);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("resize", close);
    };
  }, [onClose]);

  // Editing is WhatsApp's own rule: your own message, and text rather than a file. It also
  // expires after about fifteen minutes, which only WhatsApp can decide - so the entry is offered
  // and a refusal is reported rather than the menu pretending to know.
  const canEdit = message.direction === "out" && Boolean(message.body) && !message.revokedAt;
  const items = [
    ["Message info", () => onInfo(message)],
    ["Reply", () => onReply(message)],
    ["Copy", () => onCopy(message)],
    ["Forward", () => onForward(message)],
    [message.pinnedAt ? "Unpin" : "Pin", () => onPin(message)],
    ...(canEdit ? [["Edit", () => onEdit(message)]] : []),
    ["Delete", () => onDelete(message), "danger"],
  ];

  return createPortal(
    <div
      className="fixed z-[210] w-52 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-[0_10px_30px_rgba(15,23,42,0.18)]"
      style={{
        top: Math.min(menu.y, typeof window === "undefined" ? menu.y : window.innerHeight - 320),
        left: Math.min(menu.x, typeof window === "undefined" ? menu.x : window.innerWidth - 220),
      }}
      onClick={(event) => event.stopPropagation()}
      role="menu"
    >
      {/* The reaction bar sits above the list, as it does in WhatsApp. */}
      <div className="flex items-center gap-1 border-b border-slate-100 px-2 pb-2 pt-1.5">
        {REACTIONS.map((emoji) => (
          <button
            key={emoji}
            type="button"
            onClick={() => onReact(message, emoji)}
            aria-label={`React ${emoji}`}
            className="flex h-8 w-8 items-center justify-center rounded-full text-lg transition hover:bg-slate-100"
          >
            {emoji}
          </button>
        ))}
      </div>
      {items.map(([label, onSelect, tone]) => (
        <button
          key={label}
          type="button"
          role="menuitem"
          onClick={onSelect}
          className={`block w-full px-4 py-2 text-left text-sm transition hover:bg-slate-50 ${tone === "danger" ? "text-red-600" : "text-slate-700"}`}
        >
          {label}
        </button>
      ))}
    </div>,
    document.body,
  );
}

// What WhatsApp knows about one message, which is what its own Message info shows.
function MessageInfoDialog({ message, onClose }) {
  const rows = [
    ["Direction", message.direction === "out" ? "Sent by you" : "Received"],
    ["Status", message.status === "read" ? "Read" : message.status === "delivered" ? "Delivered" : "Sent"],
    ["Time", formatTime(message.sentAt)],
    ...(message.mediaType ? [["Attachment", message.mediaName || message.mediaType]] : []),
  ];

  return createPortal(
    <div className="fixed inset-0 z-[215] flex items-center justify-center bg-slate-950/55 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="wa-message-info" className="w-full max-w-sm overflow-hidden rounded-2xl bg-white shadow-2xl">
        <header className="border-b border-slate-200 px-5 py-4">
          <h2 id="wa-message-info" className="text-base font-semibold text-slate-900">Message info</h2>
        </header>
        <dl className="divide-y divide-slate-100">
          {rows.map(([label, value]) => (
            <div key={label} className="flex items-center justify-between gap-4 px-5 py-3 text-sm">
              <dt className="text-slate-500">{label}</dt>
              <dd className="font-medium text-slate-800">{value}</dd>
            </div>
          ))}
        </dl>
        {message.body && <p className="border-t border-slate-100 px-5 py-3 text-sm text-slate-600">{message.body}</p>}
        <footer className="flex justify-end px-5 py-4">
          <Button type="button" variant="primary" onClick={onClose}>Close</Button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}

// The six WhatsApp puts on the quick bar. Anything else is a conversation, not a reaction.
const REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

/**
 * Which kind of delete, in the module's own dialog.
 *
 * The two are genuinely different: for everyone reaches into the client's phone and takes the
 * message back, for me only clears the CRM's copy. WhatsApp offers the first on your own messages
 * only, and so does this - a message a client sent is not ours to unsend.
 */
function DeleteMessageDialog({ canDeleteForEveryone, onClose, onDelete }) {
  return createPortal(
    <div className="fixed inset-0 z-[215] flex items-center justify-center bg-slate-950/55 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section role="alertdialog" aria-modal="true" aria-labelledby="wa-delete" className="w-full max-w-sm overflow-hidden rounded-2xl bg-white shadow-2xl">
        <header className="px-5 pt-5">
          <h2 id="wa-delete" className="text-base font-semibold text-slate-900">Delete message?</h2>
          <p className="mt-1.5 text-xs leading-5 text-slate-600 sm:text-sm">
            {canDeleteForEveryone
              ? "Deleting for everyone removes it from this client's WhatsApp as well."
              : "This message was sent by the client, so it can only be removed from the CRM."}
          </p>
        </header>
        <footer className="flex flex-col gap-2 px-5 py-5">
          {canDeleteForEveryone && (
            <Button type="button" variant="danger" onClick={() => onDelete("delete")}>Delete for everyone</Button>
          )}
          <Button type="button" variant="secondary" onClick={() => onDelete("deleteForMe")}>Delete for me</Button>
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}

// Where a forwarded message goes. The lead is named by its enquiry id, which is what the CRM
// shows on every row, and the server resolves the number behind it.
function ForwardDialog({ onClose, onForward }) {
  const [enquiryId, setEnquiryId] = useState("");

  return createPortal(
    <div className="fixed inset-0 z-[215] flex items-center justify-center bg-slate-950/55 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="wa-forward" className="w-full max-w-sm overflow-hidden rounded-2xl bg-white shadow-2xl">
        <header className="border-b border-slate-200 px-5 py-4">
          <h2 id="wa-forward" className="text-base font-semibold text-slate-900">Forward to</h2>
          <p className="mt-1 text-xs text-slate-500">The Enquiry ID of the lead to send this to.</p>
        </header>
        <div className="px-5 py-4">
          <TextField label="Enquiry ID" value={enquiryId} onChange={(event) => setEnquiryId(event.target.value)} placeholder="DBS-EID-DD-ERD-000001" />
        </div>
        <footer className="flex justify-end gap-3 px-5 py-4">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="button" variant="primary" disabled={!enquiryId.trim()} onClick={() => onForward(enquiryId.trim())}>Forward</Button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}

// This panel sits on a tab inside the lead popup, which opens on a double-click as well as from the
// menu - so it cannot rely on the control that opened it having been hidden. Without READ_WRITE on
// CRM Leads the conversation is readable and the composer is not drawn: sending a WhatsApp message
// to a client is a write, and one that cannot be taken back.
/*
 * How long the WhatsApp Number field has to stop changing before the chat acts on it.
 *
 * Every change asks the server for a different conversation, and the server asks WhatsApp whether
 * the number exists - so acting per keystroke would ask ten questions about nine numbers that were
 * never finished. Long enough to mean "typed", short enough that the panel opens as soon as the
 * number is.
 */
const TYPED_NUMBER_SETTLE_MS = 700;

export default function WhatsAppChatPanel({ leadId, leadName, draftPhone = "", onNotice, onError, onSessionChange, canWrite = true }) {
  /*
   * Time spent in the chat, for the WhatsApp Usage report.
   *
   * The panel is mounted only while its own tab is open, so its lifetime is the time somebody had
   * the conversation in front of them - and the beat still only fires while the tab is visible and
   * they have touched something recently, so a lead popup left open behind another window counts
   * for nothing. It is a second context rather than a replacement: this time is WhatsApp use and
   * use of the application at large, and each report asks for the one it means.
   */
  useUsageHeartbeat("whatsapp");
  const [messages, setMessages] = useState([]);
  const [session, setSession] = useState({ status: "disconnected", qr: "", phone: "", error: "" });
  const [phone, setPhone] = useState("");
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const threadRef = useRef(null);
  const countRef = useRef(0);
  const readRef = useRef(0);
  const composerRef = useRef(null);
  const fileRef = useRef(null);
  const [attaching, setAttaching] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const recorderRef = useRef(null);
  // The message a right-click opened, and where to draw its menu.
  const [menu, setMenu] = useState(null);
  const [replyTo, setReplyTo] = useState(null);
  const [info, setInfo] = useState(null);
  const [forwarding, setForwarding] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [editing, setEditing] = useState(null);
  const [viewing, setViewing] = useState(null);
  // Logging out ends the link and sends this CRM back to scanning a code, so it is asked first.
  const [confirmLogout, setConfirmLogout] = useState(false);
  /*
   * How hard this CRM has been working their WhatsApp, as the server measures it.
   *
   * `level` is "ok", "warning" or "over". The panel polls the thread every few seconds, so this
   * arrives again and again saying the same thing - hence the separate record of what has
   * already been shown. A CRM who has read the warning and chosen to finish their conversation
   * must not have it thrown at them every poll; it is put up once each time the level worsens.
   */
  const [usage, setUsage] = useState({ level: "ok", reasons: [], counts: {}, limits: {} });
  /*
   * Whether this lead's number is on WhatsApp at all.
   *
   * `null` until the server has been able to ask - no session yet, or WhatsApp did not answer -
   * and the composer stays open through that. Only a definite `false` closes it: refusing to let
   * a CRM type because a check could not be made would be worse than letting the send find out.
   */
  const [onWhatsApp, setOnWhatsApp] = useState(null);
  // Only a definite no closes the composer. `null` is "not asked yet", which must read as
  // "carry on" - a check that could not be made is not a client without WhatsApp.
  const notOnWhatsApp = onWhatsApp === false;
  const [usageAlert, setUsageAlert] = useState(null);
  const shownLevelRef = useRef("ok");
  /*
   * Messages shown before the server has them.
   *
   * A send is paced on purpose - the gap between messages, the number check, the moment of typing -
   * so it is a second or two before the message is stored. The thread refreshes faster than that,
   * and a refresh replaces the whole list, so without holding the in-flight ones here a message
   * would appear, vanish at the next poll, and come back. They are dropped once the send returns.
   */
  const pendingRef = useRef([]);
  // Whether a read is already in flight, and whether the server's line is open. Both are read by
  // the loop above; see the note on `THREAD_POLL_MS`.
  const loadingRef = useRef(false);
  const [streamUp, setStreamUp] = useState(false);

  /*
   * The WhatsApp Number as typed into the lead popup, once the typing has stopped.
   *
   * The popup keeps its edits until Update, so this is the only way the chat can know about a
   * number that has just been entered. The server decides what to do with it - it takes it only
   * when it is a whole number and falls back to what is stored on the lead otherwise - so this
   * carries whatever is in the field and leaves the judgement in one place.
   */
  const [typedPhone, setTypedPhone] = useState(draftPhone);

  useEffect(() => {
    const timer = window.setTimeout(() => setTypedPhone(draftPhone), TYPED_NUMBER_SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [draftPhone]);

  const load = useCallback(async () => {
    if (!leadId) return;
    /*
     * One read at a time.
     *
     * Without this the interval simply fired again whether or not the last request had answered,
     * so a thread slower to read than the beat piled requests on top of each other - each one
     * making the next slower, and the newest answer not necessarily arriving last. That is the
     * "receiving is delayed" this screen was reported for, and it got worse the longer a panel
     * stayed open. A tick that lands while a read is in flight is dropped: the read already
     * running is about to return the very thing it would have asked for.
     */
    if (loadingRef.current) return;
    loadingRef.current = true;
    try {
      const response = await getWhatsappThread(leadId, typedPhone);
      const data = response?.data || {};
      const stored = Array.isArray(data.messages) ? data.messages : [];
      /*
       * An optimistic bubble is dropped as soon as the real one is in the list.
       *
       * It used to be enough to settle it when the send returned, because nothing else read the
       * thread in between. The server now announces the message the instant it writes it - which is
       * *inside* the send request, before its response has reached the browser - so a read can
       * arrive holding the stored message while its optimistic twin is still here, and the sender
       * would watch their own message appear twice and then collapse.
       *
       * Matched on what was said rather than on an id, because the two do not share one: the
       * optimistic bubble is made here and the stored row is made on the server. Only outgoing
       * messages at or after the moment the bubble was drawn are considered, so the same sentence
       * sent twice in a conversation does not swallow the second one.
       */
      pendingRef.current = pendingRef.current.filter((item) => !stored.some((message) => (
        message.direction === "out"
        && String(message.body || "").trim() === String(item.body || "").trim()
        && new Date(message.sentAt || 0).getTime() >= new Date(item.sentAt || 0).getTime() - 1000
      )));
      setMessages([...stored, ...pendingRef.current]);
      const next = data.session || { status: "disconnected", qr: "", phone: "", error: "" };
      setSession(next);
      onSessionChange?.(next.status);
      setPhone(data.phone || "");
      setOnWhatsApp(data.onWhatsApp === undefined ? null : data.onWhatsApp);

      const nextUsage = data.usage || { level: "ok", reasons: [], counts: {}, limits: {} };
      setUsage(nextUsage);
      // Raised only as it gets worse. Going from ok to warning, or warning to over, is news;
      // the same level arriving on the next poll is not, and a dialog that reopened every few
      // seconds would be closed on reflex and stop being read at all.
      const worsened = (level) => (level === "over" ? 2 : level === "warning" ? 1 : 0);
      if (worsened(nextUsage.level) > worsened(shownLevelRef.current)) {
        setUsageAlert(nextUsage);
      }
      // Tracked in both directions, so an hour passing and the counts falling back lets the
      // next breach be announced again rather than being swallowed as already seen.
      shownLevelRef.current = nextUsage.level;
    } catch (error) {
      onError?.(error.message || "Unable to load this WhatsApp conversation.");
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, [leadId, typedPhone, onError, onSessionChange]);

  /*
   * The open line, and the poll that covers for it.
   *
   * `streamUp` is what the fallback beat reads: with the line open the panel is told about a reply
   * as it lands and polls only as a long-stop; without it, the panel is on its own and asks.
   *
   * `loadRef` is what the subscription calls, so opening the line does not depend on `load`'s
   * identity - which changes whenever the typed number settles - and a settling number therefore
   * does not tear the stream down and build it again.
   */
  const loadRef = useRef(load);
  // Kept in step from an effect rather than assigned during render, which the compiler refuses -
  // a ref is not something a render reads or writes.
  useEffect(() => { loadRef.current = load; }, [load]);

  /*
   * Depends on whether the panel is pairing, not on the whole session status.
   *
   * Every read writes a fresh session object, and depending on `session.status` would rebuild the
   * line each time the status string changed - including the ordinary "disconnected" to
   * "connected" the first read reports. Pairing is the only state that matters here: there is no
   * conversation to stream yet.
   */
  const pairing = session.status === "pairing";

  useEffect(() => {
    if (!leadId || pairing) return undefined;
    let stop = null;
    let retry = null;
    let cancelled = false;
    let attempt = 0;

    /*
     * Opened, and re-opened if it drops.
     *
     * A stream is a connection held open for as long as somebody has a lead in front of them, so it
     * will be dropped sometimes - a server restart, a proxy timing out an idle line, a laptop
     * waking up. Without this the panel would fall back to polling and stay there for the rest of
     * the session, which is the slow behaviour returning quietly and for good.
     *
     * Backed off and capped: a server that is restarting should be waited for rather than asked
     * every second by every open panel, and it takes at most fifteen seconds to be picked up again.
     * The panel is polling throughout, so nothing is missed while the line is down - it is just
     * arriving the slower way.
     */
    const open = () => {
      stop = subscribeToWhatsappThread(leadId, {
        // Told that something changed, the panel reads the thread - which is the same read the poll
        // was doing, now happening only when there is a reason for it.
        onChange: () => { void loadRef.current(); },
        onUp: () => { attempt = 0; setStreamUp(true); },
        onDown: () => {
          if (cancelled) return;
          setStreamUp(false);
          const wait = Math.min(1000 * (2 ** attempt), 15000);
          attempt += 1;
          retry = window.setTimeout(open, wait);
        },
      });
    };
    open();

    return () => {
      cancelled = true;
      if (retry) window.clearTimeout(retry);
      stop?.();
      setStreamUp(false);
    };
  }, [leadId, pairing]);

  useEffect(() => {
    // The thread is fetched, not derived: nothing is set until the request comes back, so this
    // is a subscription to the server rather than the cascading render the rule guards against.
    void load();
  }, [load]);

  // Polled rather than pushed: the message arrives on the server's socket, and this is the panel
  // asking whether anything came in while it was open. The beat follows what is being waited for.
  useEffect(() => {
    if (!leadId) return undefined;
    const interval = session.status === "pairing"
      ? PAIRING_POLL_MS
      : streamUp ? THREAD_SAFETY_POLL_MS : THREAD_POLL_MS;
    const timer = window.setInterval(() => { void load(); }, interval);
    return () => window.clearInterval(timer);
  }, [leadId, load, session.status, streamUp]);

  /*
   * The thread is on screen, so it has been read.
   *
   * Told to WhatsApp only when something new has actually come in from the client - a receipt
   * per poll would be a linked device reporting a read every few seconds, which no real client
   * does and nothing on the other end would thank us for.
   */
  useEffect(() => {
    if (session.status !== "connected") return;
    const unread = messages.filter((message) => message.direction === "in").length;
    if (!unread || unread === readRef.current) return;
    readRef.current = unread;
    void markWhatsappThreadRead(leadId, typedPhone).catch(() => {});
  }, [leadId, typedPhone, messages, session.status]);

  // A chat is read at the bottom. Only scrolled when the count actually moves, so a poll that
  // found nothing does not yank the view away from someone reading back through it.
  useEffect(() => {
    if (messages.length === countRef.current) return;
    countRef.current = messages.length;
    const node = threadRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages]);

  async function connect() {
    setConnecting(true);
    try {
      const response = await connectWhatsapp(leadId);
      setSession(response?.data || session);
      onSessionChange?.(response?.data?.status || session.status);
    } catch (error) {
      onError?.(error.message || "Unable to start WhatsApp pairing.");
    } finally {
      setConnecting(false);
    }
  }

  async function logout() {
    setConnecting(true);
    try {
      const response = await logoutWhatsapp(leadId);
      setSession(response?.data || { status: "disconnected", qr: "", phone: "", error: "" });
      onSessionChange?.("disconnected");
      onNotice?.("Logged out of WhatsApp.");
    } catch (error) {
      onError?.(error.message || "Unable to log out of WhatsApp.");
    } finally {
      setConnecting(false);
    }
  }

  /*
   * The + menu, and the one input behind it.
   *
   * WhatsApp offers a list rather than a bare file picker because the kind of thing being sent
   * changes what the client sees at the other end. Each entry points the same input at a
   * different set of types; Camera asks the device for its camera, which is what the attribute
   * is for on a phone and harmless on a desktop, where it opens the picker.
   */
  function pickFile(accept, capture = "") {
    const input = fileRef.current;
    if (!input) return;
    input.value = "";
    input.accept = accept;
    if (capture) input.setAttribute("capture", capture);
    else input.removeAttribute("capture");
    input.click();
  }

  async function sendFile(file, { voice = false } = {}) {
    if (!file || attaching) return;
    setAttaching(true);
    try {
      // The box doubles as the caption: what is written when a file is picked goes with it, the
      // way it does in WhatsApp.
      await sendWhatsappAttachment(leadId, file, draft.trim(), { voice, phone: typedPhone });
      setDraft("");
      if (composerRef.current) composerRef.current.style.height = "auto";
      await load();
    } catch (error) {
      if (error?.data?.code === "NOT_ON_WHATSAPP") setOnWhatsApp(false);
      onError?.(error.message || "Unable to send this attachment.");
    } finally {
      setAttaching(false);
    }
  }

  /**
   * A voice note, recorded here and sent as one.
   *
   * Pressing once starts, pressing again stops and sends - the recorder is the same object both
   * times, and its tracks are stopped on the way out so the browser's recording indicator does
   * not stay on after the message has gone.
   */
  async function toggleRecording() {
    if (recording) {
      recorderRef.current?.stop();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      /*
       * Recorded as OGG/Opus where the browser can, because that is the only thing WhatsApp
       * plays as a voice note. Firefox can; Chrome and Safari cannot and give webm or mp4, which
       * the server converts before sending. Asking for the right container here saves that
       * conversion whenever the browser is willing.
       */
      const preferred = ["audio/ogg;codecs=opus", "audio/ogg", "audio/webm;codecs=opus", "audio/webm", "audio/mp4"]
        .find((type) => typeof MediaRecorder !== "undefined"
          && typeof MediaRecorder.isTypeSupported === "function"
          && MediaRecorder.isTypeSupported(type));
      const recorder = preferred ? new MediaRecorder(stream, { mimeType: preferred }) : new MediaRecorder(stream);
      const chunks = [];
      recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        setRecording(false);
        const type = recorder.mimeType || preferred || "audio/webm";
        const blob = new Blob(chunks, { type });
        // The extension follows the container so the file is not mislabelled on the way through.
        const extension = type.includes("ogg") ? "ogg" : type.includes("mp4") ? "m4a" : "webm";
        // `voice` is what makes this a voice note rather than an audio file. Inferring it from
        // the mime type made every uploaded .ogg a voice note too.
        if (blob.size) void sendFile(new File([blob], `voice-${Date.now()}.${extension}`, { type }), { voice: true });
      };
      recorderRef.current = recorder;
      recorder.start();
      setRecording(true);
    } catch {
      onError?.("No microphone available, or permission was refused.");
    }
  }

  /**
   * One action on one message.
   *
   * Everything the menu offers is the real WhatsApp action, done on the client's actual
   * conversation - a delete removes it for them too, a reaction appears on their phone. So the
   * menu closes on the way in and the thread is re-read on the way out rather than guessing at
   * what changed.
   */
  async function runAction(message, action) {
    setMenu(null);
    try {
      await actOnWhatsappMessage(leadId, message.id, action, typedPhone);
      await load();
    } catch (error) {
      onError?.(error.message || "Unable to do that.");
    }
  }

  async function copyMessage(message) {
    setMenu(null);
    try {
      await navigator.clipboard.writeText(message.body || "");
      onNotice?.("Message copied.");
    } catch {
      onError?.("Could not copy this message.");
    }
  }

  async function send(event) {
    event?.preventDefault?.();
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);

    // Shown at once, under a temporary id, and replaced by the stored row on the next read. The
    // server's pacing is unchanged - this only stops the wait being the user's problem.
    const pending = {
      id: `pending-${Date.now()}`,
      direction: "out",
      body: text,
      status: "sending",
      sentAt: new Date().toISOString(),
      quotedBody: replyTo?.body || "",
      quotedAuthor: replyTo ? (replyTo.direction === "out" ? "You" : "Them") : "",
      pending: true,
    };
    pendingRef.current = [...pendingRef.current, pending];
    setMessages((current) => [...current, pending]);
    setDraft("");
    if (composerRef.current) composerRef.current.style.height = "auto";

    const settle = () => {
      pendingRef.current = pendingRef.current.filter((item) => item.id !== pending.id);
    };

    try {
      if (editing) await actOnWhatsappMessage(leadId, editing.id, { action: "edit", body: text }, typedPhone);
      else if (replyTo) await actOnWhatsappMessage(leadId, replyTo.id, { action: "reply", body: text }, typedPhone);
      else await sendWhatsappMessage(leadId, text, typedPhone);
      setEditing(null);
      setReplyTo(null);
      // Dropped before the read that replaces it, so the message is never in the list twice.
      settle();
      await load();
    } catch (error) {
      // A send that failed takes its own message with it, and gives the text back to the box,
      // rather than leaving a bubble in the thread that never went anywhere.
      settle();
      setMessages((current) => current.filter((item) => item.id !== pending.id));
      setDraft(text);
      // The server checked and there is no WhatsApp account behind this number. Closing the
      // composer now means the next attempt cannot even be made, rather than failing the same
      // way again - and the notice above says why.
      if (error?.data?.code === "NOT_ON_WHATSAPP") setOnWhatsApp(false);
      onError?.(error.message || "Unable to send this WhatsApp message.");
    } finally {
      setSending(false);
    }
  }

  if (loading) {
    return (
      <div className="flex h-full min-h-0 flex-1 items-center justify-center p-5 text-sm text-slate-500">
        Loading WhatsApp conversation...
      </div>
    );
  }

  if (session.status !== "connected") {
    return (
      /*
       * Fitted to the tab, not scrolled inside it.
       *
       * The card used to be as tall as its contents and the tab scrolled to reach the button
       * underneath - a pairing screen you have to scroll to finish. It is a column that fills
       * the height it is given instead, and the code takes whatever is left after the words and
       * the button, which is the one part that can be any size and still be scannable.
       */
      <div className="flex h-full min-h-0 flex-1 items-center justify-center overflow-hidden p-4">
        <section className="flex h-full max-h-[24rem] w-full max-w-[17rem] flex-col items-center overflow-hidden rounded-xl border border-slate-200 bg-white p-4 text-center">
          <h4 className="shrink-0 text-sm font-semibold text-slate-700">Link your WhatsApp</h4>
          <p className="mt-1 shrink-0 text-xs leading-4 text-slate-500">
            On your phone: <span className="font-medium text-slate-600">WhatsApp → Settings → Linked devices</span>,
            then scan this code.
          </p>

          {/* Square, and sized by what is left rather than by a number, so the card never grows
              past the tab. The code and the line that stands in for it share the same frame, so
              nothing moves as WhatsApp rotates it. */}
          <div className="mt-3 flex aspect-square min-h-0 w-auto max-w-full flex-1 items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-white p-1.5">
            {session.qr ? (
              // A QR is a data URL generated per pairing attempt and thrown away seconds later,
              // so there is nothing for next/image to optimise or cache.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={session.qr} alt="WhatsApp pairing code" className="h-full w-full object-contain" />
            ) : (
              <span className="px-2 text-xs text-slate-500">
                {session.status === "pairing" ? "Preparing your code..." : "Not linked"}
              </span>
            )}
          </div>

          <p className="mt-2 shrink-0 text-[11px] leading-4 text-slate-400">
            Only your conversations with CRM leads appear here.
          </p>
          {session.error && (
            <p role="alert" className="mt-2 shrink-0 text-xs leading-4 text-red-600">
              {session.error}
            </p>
          )}
          <Button type="button" variant="primary" className="mt-3 w-full shrink-0" onClick={() => void connect()} disabled={connecting}>
            {connecting ? "Starting..." : session.status === "pairing" ? "Refresh code" : "Connect WhatsApp"}
          </Button>
        </section>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-5 py-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-700">{leadName || "This lead"}</p>
          <p className="truncate text-xs text-slate-500">{phone ? `+${phone.replace(/^\+/, "")}` : "No number on this lead"}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-emerald-50 px-3 text-xs font-medium text-emerald-700">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            Linked{session.phone ? ` · +${session.phone}` : ""}
          </span>
          <Button type="button" variant="secondary" size="sm" onClick={() => setConfirmLogout(true)} disabled={connecting}>
            Logout
          </Button>
        </div>
      </div>

      {cameraOpen && <CameraDialog onClose={() => setCameraOpen(false)} onCapture={(file) => void sendFile(file)} />}

      {/* The module's own confirmation: unlinking is not something to do on a stray click, and it
          reads the way every other destructive step in the app does. */}
      {/* The question and the two answers, and nothing else - the title says what pressing Logout
          does, and the paragraph under it only repeated that at length. */}
      <ConfirmDialog
        open={confirmLogout}
        title="Log out from this device?"
        confirmLabel="Logout"
        busyLabel="Logging out..."
        loading={connecting}
        onCancel={() => setConfirmLogout(false)}
        onConfirm={() => { setConfirmLogout(false); void logout(); }}
      />

      {/* The usage warning, in the module's own confirmation so it reads like every other thing
          the app asks rather than as a browser alert. Disconnecting is offered as the answer
          because it is the one that protects the number, but it is not forced: a CRM in the
          middle of a client's question can carry on and stop when they are done. */}
      <ConfirmDialog
        open={Boolean(usageAlert)}
        tone={usageAlert?.level === "over" ? "danger" : "primary"}
        title={usageAlert?.level === "over"
          ? "You are over the WhatsApp limit"
          : "You are close to the WhatsApp limit"}
        message={`${(usageAlert?.reasons || []).join(" ")} ${usageAlert?.level === "over"
          ? "Messaging many clients in a short time is what WhatsApp reads as a broadcast, and the studio's number can be banned for it. Please disconnect and carry on later."
          : "Messaging many clients in a short time is what WhatsApp reads as a broadcast. Slow down, or disconnect when this conversation is finished."}`}
        confirmLabel="Disconnect now"
        busyLabel="Disconnecting..."
        cancelLabel="Keep chatting"
        loading={connecting}
        onCancel={() => setUsageAlert(null)}
        onConfirm={() => { setUsageAlert(null); void logout(); }}
      />

      {/* Said in the thread itself, where the message would have been written.

          WhatsApp was asked about this number and answered that it has no account on it, so
          there is nobody at the other end to receive anything - the composer below is closed
          rather than left open to fail on send. The number is named so it can be checked against
          the lead, which is usually where the mistake is. */}
      {notOnWhatsApp && (
        <div role="status" className="shrink-0 border-b border-amber-200 bg-amber-50 px-5 py-2.5 text-xs text-amber-800 sm:text-sm">
          <span className="font-semibold">This is not a WhatsApp number.</span>{" "}
          {phone ? `${phone} has no WhatsApp account, so this conversation cannot be started. ` : ""}
          Check the lead&apos;s WhatsApp Number, then reopen this tab.
        </div>
      )}

      {/* Stays while the level does, because the dialog above is dismissed and the reason for it
          is not. Wrapping rather than truncating: the sentence names the count that has been
          passed, and half of it is no use. */}
      {usage.level !== "ok" && (
        <div
          role="status"
          className={`shrink-0 border-b px-5 py-2.5 text-xs sm:text-sm ${usage.level === "over"
            ? "border-red-200 bg-red-50 text-red-700"
            : "border-amber-200 bg-amber-50 text-amber-800"}`}
        >
          <span className="font-semibold">
            {usage.level === "over" ? "Over the WhatsApp limit." : "Close to the WhatsApp limit."}
          </span>{" "}
          {(usage.reasons || []).join(" ")}
        </div>
      )}

      <div ref={threadRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto bg-slate-50 px-5 py-4">
        {messages.length === 0 ? (
          <p className="py-10 text-center text-sm text-slate-500">
            No messages yet. Anything sent here, or from your phone to this number, appears in this thread.
          </p>
        ) : (
          messages.map((message) => (
            <div
              key={message.id}
              className={`flex ${message.direction === "out" ? "justify-end" : "justify-start"}`}
              onContextMenu={(event) => {
                if (message.revokedAt) return;
                event.preventDefault();
                setMenu({ message, x: event.clientX, y: event.clientY });
              }}
            >
              <div className="relative max-w-[85%] sm:max-w-[70%]">
                <div
                  className={`rounded-2xl px-3.5 py-2 text-sm shadow-sm ${
                    message.direction === "out" ? "bg-emerald-600 text-white" : "bg-white text-slate-700"
                  }`}
                >
                  {/* Pinned reads above the message, the way it does in a chat: it is a note about
                      this message rather than part of what was said. */}
                  {message.pinnedAt && (
                    <p className={`mb-1 flex items-center gap-1 text-[11px] ${message.direction === "out" ? "text-emerald-100" : "text-slate-400"}`}>
                      <PushPinRoundedIcon sx={{ fontSize: 12 }} />
                      Pinned
                    </p>
                  )}
                  {message.revokedAt ? (
                    <p className={`flex items-center gap-1.5 italic ${message.direction === "out" ? "text-emerald-100" : "text-slate-400"}`}>
                      <BlockRoundedIcon sx={{ fontSize: 15 }} />
                      {message.direction === "out" ? "You deleted this message" : "This message was deleted"}
                    </p>
                  ) : (
                    <>
                      <QuotedMessage message={message} leadName={leadName} />
                      {message.mediaType && (
                        <div className="mb-1.5">
                          <MediaBubble message={message} onOpen={(url) => setViewing({ message, url })} />
                        </div>
                      )}
                      {message.body && <p className="whitespace-pre-wrap break-words">{message.body}</p>}
                    </>
                  )}
                  <p className={`mt-1 flex items-center justify-end gap-1 text-[11px] ${message.direction === "out" ? "text-emerald-100" : "text-slate-400"}`}>
                    {message.editedAt && !message.revokedAt && <span className="italic">Edited</span>}
                    {formatTime(message.sentAt)}
                    <MessageTicks message={message} />
                  </p>
                </div>
                {/* The emoji sits on the corner of the bubble it belongs to, overlapping it, as
                    WhatsApp draws it - so it reads as attached to that message and not as a
                    message of its own. */}
                {message.reaction && (
                  <span className="absolute -bottom-2 right-3 rounded-full border border-slate-200 bg-white px-1.5 py-0.5 text-xs shadow-sm">
                    {message.reaction}
                  </span>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {menu && (
        <MessageMenu
          menu={menu}
          onClose={() => setMenu(null)}
          onReply={(message) => { setReplyTo(message); setMenu(null); composerRef.current?.focus(); }}
          onCopy={copyMessage}
          onReact={(message, emoji) => void runAction(message, { action: "react", emoji })}
          onForward={(message) => { setForwarding(message); setMenu(null); }}
          onPin={(message) => void runAction(message, { action: message.pinnedAt ? "unpin" : "pin" })}
          onEdit={(message) => { setEditing(message); setDraft(message.body || ""); setMenu(null); composerRef.current?.focus(); }}
          onDelete={(message) => { setDeleting(message); setMenu(null); }}
          onInfo={(message) => { setInfo(message); setMenu(null); }}
        />
      )}

      {/* WhatsApp asks which kind of delete, because they are different acts: one takes the
          message off the client's phone as well, the other only clears this thread. */}
      {deleting && (
        <DeleteMessageDialog
          canDeleteForEveryone={deleting.direction === "out"}
          onClose={() => setDeleting(null)}
          onDelete={(action) => {
            const message = deleting;
            setDeleting(null);
            void runAction(message, { action });
          }}
        />
      )}

      {viewing && <MediaViewer message={viewing.message} url={viewing.url} onClose={() => setViewing(null)} />}

      {info && <MessageInfoDialog message={info} onClose={() => setInfo(null)} />}

      {/* Forwarding goes to another lead, named by enquiry id: the server looks its number up
          rather than taking one from the browser, so this can only ever reach a CRM contact. */}
      {forwarding && (
        <ForwardDialog
          onClose={() => setForwarding(null)}
          onForward={(toEnquiryId) => {
            const message = forwarding;
            setForwarding(null);
            void runAction(message, { action: "forward", toEnquiryId });
          }}
        />
      )}

      {editing && (
        <div className="flex items-start gap-2 border-t border-slate-200 bg-slate-50 px-5 py-2">
          <div className="min-w-0 flex-1 border-l-2 border-emerald-500 pl-2">
            <p className="text-xs font-semibold text-emerald-700">Editing message</p>
            <p className="truncate text-xs text-slate-600">{editing.body}</p>
          </div>
          <IconButton label="Cancel edit" size="sm" shape="circle" onClick={() => { setEditing(null); setDraft(""); }} className="text-slate-500 hover:bg-slate-200"><CloseIcon className="h-4 w-4" /></IconButton>
        </div>
      )}

      {canWrite && replyTo && (
        <div className="flex items-start gap-2 border-t border-slate-200 bg-slate-50 px-5 py-2">
          <div className="min-w-0 flex-1 border-l-2 border-emerald-500 pl-2">
            <p className="text-xs font-semibold text-emerald-700">Replying to</p>
            <p className="truncate text-xs text-slate-600">{replyTo.body || `[${replyTo.mediaType}]`}</p>
          </div>
          <IconButton label="Cancel reply" size="sm" shape="circle" onClick={() => setReplyTo(null)} className="text-slate-500 hover:bg-slate-200"><CloseIcon className="h-4 w-4" /></IconButton>
        </div>
      )}

      {!canWrite ? (
        <p className="border-t border-slate-200 px-5 py-3 text-center text-[11px] text-slate-500">
          You have read-only access to CRM leads, so this conversation cannot be replied to here.
        </p>
      ) : (
      <form onSubmit={send} className="flex items-end gap-2 border-t border-slate-200 px-5 py-3">
        <input
          ref={fileRef}
          type="file"
          className="hidden"
          onChange={(event) => void sendFile(event.target.files?.[0])}
        />
        {/* Nothing can be attached to a conversation that cannot exist. Replaced by a dead
            button rather than removed, so the composer does not shift under the pointer. */}
        {!phone || notOnWhatsApp ? (
          <IconButton
            type="button"
            variant="ghost"
            shape="circle"
            size="md"
            disabled
            label={notOnWhatsApp ? "This number is not on WhatsApp" : "This lead has no WhatsApp number"}
            className="mb-0.5"
          >
            <AddRoundedIcon fontSize="small" />
          </IconButton>
        ) : (
          <OptionsMenu
            ariaLabel="Attach"
            preferAbove
            triggerContent={<AddRoundedIcon fontSize="small" />}
            zIndex={150}
            menuClassName="w-52"
            triggerClassName="mb-0.5"
            items={[
              { label: "Document", onSelect: () => pickFile("*/*") },
              { label: "Photos & videos", onSelect: () => pickFile("image/*,video/*") },
              { label: "Camera", onSelect: () => setCameraOpen(true) },
              { label: "Audio file", onSelect: () => pickFile("audio/*") },
            ]}
          />
        )}
        <textarea
          value={draft}
          ref={composerRef}
          onChange={(event) => {
            setDraft(event.target.value);
            // Grown to fit what is in it, up to the cap the class sets, then scrolled. Reset
            // first, or the box can only ever get taller as the message is edited down.
            const node = composerRef.current;
            if (node) {
              node.style.height = "auto";
              node.style.height = `${node.scrollHeight}px`;
            }
          }}
          // Enter sends, the way it does in WhatsApp itself; a new line is Shift with it.
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void send();
            }
          }}
          rows={1}
          placeholder={!phone
            ? "This lead has no WhatsApp number"
            : notOnWhatsApp
              ? "This number is not on WhatsApp"
              : recording ? "Recording... press the microphone again to send" : attaching ? "Sending attachment..." : "Write a message..."}
          disabled={!phone || notOnWhatsApp || attaching}
          // The text colour is named rather than inherited. The popup around this sets its own,
          // and what was typed came out the same grey as the placeholder - a message that could
          // not be read back while it was being written.
          className="max-h-28 min-h-10 w-full flex-1 resize-none rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm leading-5 text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400"
        />
        {/* Send when there is something to send, the microphone when there is not - the swap
            WhatsApp makes in the same corner, so the button under the pointer is always the one
            that does what the composer is currently for. */}
        {draft.trim() ? (
          <IconButton
            type="submit"
            variant="primary"
            shape="circle"
            size="md"
            className="!bg-emerald-600 hover:!bg-emerald-700"
            label={sending ? "Sending message" : "Send message"}
            disabled={sending}
          >
            <SendRoundedIcon fontSize="small" />
          </IconButton>
        ) : (
          <IconButton
            type="button"
            variant={recording ? "danger" : "primary"}
            shape="circle"
            size="md"
            onClick={() => void toggleRecording()}
            label={recording ? "Stop and send voice note" : "Record a voice note"}
            disabled={!phone || notOnWhatsApp || attaching}
            className={recording ? "animate-pulse" : "!bg-emerald-600 hover:!bg-emerald-700"}
          >
            {recording ? <StopRoundedIcon fontSize="small" /> : <MicRoundedIcon fontSize="small" />}
          </IconButton>
        )}
      </form>
      )}
    </div>
  );
}
