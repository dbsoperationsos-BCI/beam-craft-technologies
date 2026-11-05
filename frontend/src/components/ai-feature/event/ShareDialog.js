"use client";

import { useCallback, useEffect, useState } from "react";
import Dialog from "@/components/ui/Dialog";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import Button from "@/components/shared/Button";
import ToggleSwitch from "@/components/shared/ToggleSwitch";
import ActionField from "@/components/shared/ActionField";
import ContentCopy from "@mui/icons-material/ContentCopy";
import Check from "@mui/icons-material/Check";
import OpenInNew from "@mui/icons-material/OpenInNew";
import Refresh from "@mui/icons-material/Refresh";
import Autorenew from "@mui/icons-material/Autorenew";
import Loader from "@/components/shared/Loader";
import ShareableMessage from "@/components/shared/ShareableMessage";
import { copyToClipboard } from "@/lib/clipboard";
import { formatCount } from "@/lib/aiFeature.mjs";
import { createAiShare, getAiShare, updateAiShare } from "@/services/ai-feature/ai-feature.service";
import QrTemplateDialog from "./QrTemplateDialog";

/**
 * The guest link. One per event: generated with or without a PIN, shown with its QR and how often
 * it has been opened. Everything happens in this one dialog: Require a PIN sits beside Access PIN
 * and applies at once; Reset PIN is inside the PIN's field and New link code inside the link's, each
 * confirmed. There is no revoking here; a link revoked before can be generated again, keeping its
 * short code.
 * QR Template turns the live link into a printable poster; it takes this dialog's place and its
 * back arrow brings this dialog back, re-read so it shows the link as it stands. The link code and
 * the PIN are always made by the server - when the link is generated, when a PIN is turned on - and
 * are only ever replaced on purpose: New link code on the link, Reset PIN on the PIN, each confirmed.
 * Opening this dialog never changes either.
 */
export default function ShareDialog({ eventId, eventName, onClose, onNotify }) {
  const [share, setShare] = useState(undefined);
  const [requirePin, setRequirePin] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState(null);
  const [copied, setCopied] = useState(false);
  const [posters, setPosters] = useState(false);

  const load = useCallback(async () => {
    try { setShare((await getAiShare(eventId)).data || null); setError(""); }
    catch (cause) { setError(cause.message || "Unable to load the share link."); setShare(null); }
  }, [eventId]);
  useEffect(() => {
    const timer = window.setTimeout(() => { load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const active = share && share.status === "ACTIVE";

  async function generate() {
    setBusy("generate");
    try {
      const response = await createAiShare(eventId, { requirePin });
      setShare(response.data);
      onNotify?.("Event link generated.");
    } catch (cause) {
      setError(cause.message || "Unable to generate the link.");
    } finally {
      setBusy("");
    }
  }
  /**
   * One change to the live link, made on the server (`PATCH .../share`): the PIN on or off, a new
   * PIN, or a new link code. Nothing is typed; the answer replaces the link, QR and message shown.
   */
  async function applyChange(payload, busyKey, done) {
    setBusy(busyKey);
    try {
      const response = await updateAiShare(eventId, payload);
      setShare(response.data);
      setConfirm(null); setError("");
      onNotify?.(done);
    } catch (cause) {
      setError(cause.message || "Unable to change the link.");
      setConfirm(null);
    } finally {
      setBusy("");
    }
  }

  async function copy(text, which = "url") {
    const done = await copyToClipboard(text);
    setCopied(done ? which : false);
    if (done) window.setTimeout(() => setCopied(false), 2500);
  }
  const copyIcon = (which) => (copied === which ? <Check style={{ fontSize: 16 }} aria-hidden="true" /> : <ContentCopy style={{ fontSize: 16 }} aria-hidden="true" />);

  const message = active ? `Photos from ${eventName || "the event"} are ready.\n\nOpen ${share.url}${share.pin ? `\nPIN: ${share.pin}` : ""}\n\nUpload a selfie to find the photos you are in.` : "";

  if (posters) return <QrTemplateDialog eventId={eventId} eventName={eventName} onNotify={onNotify} onClose={onClose} onBack={() => { setPosters(false); load(); }} />;

  return <>
    <Dialog
      title="Share with guests"
      description={active ? "Send this link or QR to the guests. They register, take a selfie, and get their photos." : "Guests reach the event through one link and a PIN, both made for you."}
      size="md"
      onClose={onClose}
      busy={Boolean(busy)}
      footer={active
        ? <>
          <Button type="button" className="max-sm:flex-1" disabled={Boolean(busy)} onClick={() => setPosters(true)}>QR Template</Button>
          <Button type="button" variant="primary" className="max-sm:flex-1" onClick={onClose}>Done</Button>
        </>
        : <>
          <Button type="button" className="max-sm:flex-1" onClick={onClose} disabled={Boolean(busy)}>Cancel</Button>
          <Button type="button" variant="primary" className="max-sm:flex-1" disabled={Boolean(busy) || share === undefined} onClick={generate}>{busy === "generate" ? "Generating..." : "Generate Event Link"}</Button>
        </>}
    >
      {error && <p role="alert" className="mb-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
      {share === undefined
        ? <Loader label="Loading share link..." />
        : active
          ? <div className="space-y-4">
            <ActionField
              label="Event link"
              helperText="The link guests open to see and find their photos from this event."
              value={share.url}
              link
              actions={[
                { label: copied === "url" ? "Copied" : "Copy event link", icon: copyIcon("url"), onClick: () => copy(share.url, "url") },
                { label: "Open the guest page", icon: <OpenInNew style={{ fontSize: 16 }} aria-hidden="true" />, onClick: () => window.open(share.url, "_blank", "noopener,noreferrer") },
                { label: "New link code", icon: <Autorenew style={{ fontSize: 16 }} aria-hidden="true" />, onClick: () => setConfirm("code"), disabled: Boolean(busy) },
              ]}
            />
            <ActionField
              label="Access PIN"
              helperText="Guests type this PIN after opening the link; share it only with invited guests."
              labelAside={<ToggleSwitch size="sm" label="Require a PIN to open" helperText="Guests must enter the PIN as well as open the link." className="text-xs" checked={Boolean(share.hasPin)} disabled={Boolean(busy)} onCheckedChange={(checked) => applyChange({ requirePin: checked }, "toggle", checked ? "PIN turned on." : "PIN turned off - guests open with the link alone.")} />}
              value={share.hasPin ? share.pin || "" : ""}
              placeholder="PIN is off - guests open with the link alone"
              mono
              actions={[
                { label: copied === "pin" ? "Copied" : "Copy access PIN", icon: copyIcon("pin"), onClick: () => copy(share.pin, "pin") },
                ...(share.hasPin ? [{ label: "Reset PIN", icon: <Refresh style={{ fontSize: 16 }} aria-hidden="true" />, onClick: () => setConfirm("pin"), disabled: Boolean(busy) }] : []),
              ]}
            />
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
              {share.qrDataUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={share.qrDataUrl} alt="QR code for the event link" className="h-40 w-40 shrink-0 self-center rounded-lg border border-slate-200 bg-white p-1 sm:self-start" />
              )}
              <dl className="grid flex-1 grid-cols-2 gap-x-3 gap-y-2 text-xs">
                <dt className="text-slate-500">Short code</dt><dd className="font-mono text-slate-800">{share.shortCode}</dd>
                <dt className="text-slate-500">Opened</dt><dd className="text-slate-800">{formatCount(share.accessCount || 0)} {share.accessCount === 1 ? "time" : "times"}</dd>
                <dt className="text-slate-500">Last opened</dt><dd className="text-slate-800">{share.lastAccessAt ? new Date(share.lastAccessAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "Not yet"}</dd>
                <dt className="text-slate-500">Expires</dt><dd className="text-slate-800">{share.expiresAt ? new Date(share.expiresAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "Never"}</dd>
              </dl>
            </div>
            <ShareableMessage label="Ready-to-send message" message={message} rows={5} />
          </div>
          : <div className="space-y-3">
            {share?.status === "REVOKED" && <p className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">The previous link was revoked{share.revokedAt ? ` on ${new Date(share.revokedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}` : ""}. Generating a new one keeps the same short code.</p>}
            <ActionField label="Event link" helperText="The link guests open to see and find their photos from this event." placeholder="Generate to create the event link" link actions={[{ label: "Copy event link", icon: copyIcon("url") }, { label: "Open the guest page", icon: <OpenInNew style={{ fontSize: 16 }} aria-hidden="true" /> }]} />
            <ActionField label="Access PIN" helperText="Guests type this PIN after opening the link; share it only with invited guests." labelAside={<ToggleSwitch size="sm" label="Require a PIN to open" helperText="Guests must enter the PIN as well as open the link." className="text-xs" checked={requirePin} onCheckedChange={setRequirePin} />} placeholder={requirePin ? "Generate to create a PIN" : "No PIN - guests open with the link alone"} mono actions={[{ label: "Copy access PIN", icon: copyIcon("pin") }]} />
          </div>}
    </Dialog>
    <ConfirmDialog
      open={confirm === "code"}
      layer="confirmOverDialog"
      tone="primary"
      title="Make a new link code?"
      message="A new code is made and the event link changes. The old link, and any QR or poster already printed or sent with it, stop opening the event - share the new link or download a new poster. The PIN stays the same, and guests already signed in are unaffected."
      confirmLabel="New link code"
      loading={busy === "code"}
      onCancel={() => setConfirm(null)}
      onConfirm={() => applyChange({ newCode: true }, "code", "New link code made. Share the new link.")}
    />
    <ConfirmDialog
      open={confirm === "pin"}
      layer="confirmOverDialog"
      tone="primary"
      title="Reset the PIN?"
      message="A new PIN is made and the old one stops working. Guests who have not joined yet will need the new PIN, and posters printed with the old PIN show the wrong one. Guests already signed in are unaffected; the link stays the same."
      confirmLabel="Reset PIN"
      loading={busy === "pin"}
      onCancel={() => setConfirm(null)}
      onConfirm={() => applyChange({ newPin: true }, "pin", "New PIN made. Send it to guests who have not joined yet.")}
    />
  </>;
}
