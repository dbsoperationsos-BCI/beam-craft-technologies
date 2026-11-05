"use client";

import ArrowBack from "@mui/icons-material/ArrowBack";
import ContentCopy from "@mui/icons-material/ContentCopy";
import { useEffect, useState } from "react";
import FloatingNotice, { useNotice } from "@/components/shared/FloatingNotice";
import useWhatsappSender from "@/components/shared/useWhatsappSender";
import { copyToClipboard } from "@/lib/clipboard";
import { notifyClientApp, prepareWhatsAppTemplate, sendWhatsAppGroupInvite } from "@/services/image-selection/image-selection.service";
import WhatsAppGroupLinkDialog from "./WhatsAppGroupLinkDialog";

function label(status) { return ({ SENDING: "Sending", SENT: "Sent", FAILED: "Failed", ALREADY_SENT: "Already Sent", MOCK_SENT: "Mock Sent" })[status] || "Not Sent"; }
function badgeClass(status) { return status === "FAILED" ? "bg-red-500" : ["SENT", "ALREADY_SENT", "MOCK_SENT"].includes(status) ? "bg-green-500" : "bg-slate-400"; }

/*
 * The invite, and the two ways it leaves.
 *
 * **Send to Group** sends it - from this person's own paired WhatsApp into the project's group, the
 * way the pre- or post-production coordinator would from their phone, so it arrives from whichever
 * of them pressed the button. The server publishes first if it has to, refuses a second send of the
 * same gallery version, and answers "link your WhatsApp" and "link a group" by code rather than by
 * sentence, which is what opens the right dialog here instead of a red line nobody can act on.
 *
 * **Send to Client** is what it always was: the studio's own WhatsApp chat with the client, message
 * prefilled, and the person presses send inside WhatsApp itself.
 *
 * `canWrite` is passed rather than read: the panel opens from View Invite, which anybody who can
 * read the project may press, so it cannot rely on the control that opened it having been hidden.
 */
export default function WhatsAppTemplatePanel({ project, canWrite = true, onBack, onProjectUpdated }) {
  const [preview, setPreview] = useState(null); const [status, setStatus] = useState("NOT_SENT"); const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  // `message` stays for what has to keep saying so - the template could not be prepared, the group
  // send's own outcome, which is tied to the badge beside it. Copying is an action with a result
  // and nothing more, so it answers in the snackbar the rest of the app answers in and then gets
  // out of the way.
  const { notice, showSuccess, showError, clearNotice } = useNotice();
  useEffect(() => { prepareWhatsAppTemplate(project.id).then((response) => setPreview(response.data)).catch((error) => setMessage(error.message || "Unable to prepare WhatsApp template.")); }, [project.id]);
  // One message, written on the server, so this panel, the group send and the wa.me link say the
  // same thing - the optional lines a manual project cannot fill are already dropped there.
  const text = preview?.whatsappPreview?.message || "";
  // Through the shared helper rather than `navigator.clipboard` directly: that API is only there
  // over https and on localhost, so on a studio running the OS over plain http this button did
  // nothing it could explain. The helper falls back and says whether the text actually got there.
  async function copy() {
    if (await copyToClipboard(text)) return showSuccess("Message copied.");
    return showError("Unable to copy the message. Select the text and copy it by hand.");
  }
  function sendToClient() {
    if (!preview?.client?.whatsappShareUrl) { setMessage("The client's WhatsApp number is missing."); return; }
    window.open(`${preview.client.whatsappShareUrl}?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
    setStatus("SENT");
    // The client's app hears of it too. Best-effort: WhatsApp has already opened either way.
    if (canWrite) notifyClientApp(project.id).catch(() => {});
  }
  async function sendToGroup() {
    setSending(true); setStatus("SENDING"); setMessage("");
    try {
      const response = await sendWhatsAppGroupInvite(project.id);
      setStatus(response.data.notification.status);
      if (response.data.preview) setPreview(response.data.preview);
      if (response.data.notification.status === "ALREADY_SENT") setMessage("This gallery version was already sent to the group. Republish the gallery to send it again.");
    } catch (error) {
      const needsLink = error?.data?.code === "WHATSAPP_NOT_CONNECTED" || error?.data?.details?.action === "link_whatsapp_group";
      setStatus(needsLink ? "NOT_SENT" : "FAILED");
      setMessage(error.message || "Unable to send to the WhatsApp group.");
      if (needsLink) setLinkOpen(true);
    } finally { setSending(false); }
  }
  const groupName = project.whatsappGroupSubject || "";
  // Send to Group goes from this person's own WhatsApp: absent until it is linked (Link a group /
  // Change pairs it), asked again once the dialog links it.
  const { canSend, refresh: refreshSender } = useWhatsappSender();
  return <>
    <aside className="flex min-h-0 flex-col border-l border-slate-200 bg-white md:h-full">
      <div className="flex shrink-0 items-center border-b border-slate-200 px-3 py-2"><button type="button" onClick={onBack} aria-label="Back to settings" className="rounded p-1 text-slate-600 hover:bg-slate-100"><ArrowBack style={{ fontSize: 15 }} /></button></div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <div className="flex items-center justify-between gap-2"><h1 className="text-[10px] font-bold text-slate-700">WhatsApp Template</h1><span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold text-white ${badgeClass(status)}`}>{label(status)}</span></div>
        {/* Which group the invite goes into, and the way to change that. */}
        <p className="mt-2 text-[10px] text-slate-500">
          Group: {groupName ? <span className="font-medium text-slate-700">{groupName}</span> : <span>none linked</span>}
          {canWrite && <> · <button type="button" onClick={() => setLinkOpen(true)} className="text-blue-600">{groupName ? "Change" : "Link a group"}</button></>}
        </p>
        {preview ? <>
          <textarea value={text} readOnly className="mt-2 h-65 w-full resize-none rounded-md border border-slate-300 p-2 text-[10px] leading-4 text-slate-700 outline-none" />
          <div className="mt-2 flex flex-wrap justify-end gap-2">
            {canWrite && canSend && <button type="button" onClick={sendToGroup} disabled={sending} className="inline-flex h-7 items-center rounded bg-green-600 px-3 text-[10px] font-medium text-white disabled:opacity-60">{sending ? "Sending..." : "Send to Group"}</button>}
            <button type="button" onClick={sendToClient} className="inline-flex h-7 items-center rounded bg-green-500 px-3 text-[10px] font-medium text-white">Send to Client</button>
            <button type="button" onClick={copy} className="inline-flex h-7 items-center gap-1 rounded bg-blue-50 px-3 text-[10px] text-blue-600"><ContentCopy style={{ fontSize: 12 }} />Copy</button>
          </div>
        </> : <p className="mt-6 text-xs text-slate-500">Preparing template...</p>}
        {preview && canWrite && !canSend && <p className="mt-2 text-[10px] text-slate-500">Send to Group appears once your WhatsApp is linked - use {groupName ? "Change" : "Link a group"} above.</p>}
        {message && <p role="alert" className={`mt-3 text-xs ${status === "FAILED" ? "text-red-600" : "text-slate-600"}`}>{message}</p>}
      </div>
    </aside>
    {linkOpen && (
      <WhatsAppGroupLinkDialog
        project={project}
        canWrite={canWrite}
        onClose={() => setLinkOpen(false)}
        onLinked={(updated) => { onProjectUpdated?.(updated); setMessage(""); refreshSender(); }}
      />
    )}
    <FloatingNotice notice={notice} onClose={clearNotice} />
  </>;
}
