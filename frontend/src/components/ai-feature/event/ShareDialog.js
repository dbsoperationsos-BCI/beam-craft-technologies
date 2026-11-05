"use client";

import { useCallback, useEffect, useState } from "react";
import Dialog from "@/components/ui/Dialog";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import Button from "@/components/shared/Button";
import ToggleSwitch from "@/components/shared/ToggleSwitch";
import Loader from "@/components/shared/Loader";
import ShareableMessage from "@/components/shared/ShareableMessage";
import { copyToClipboard } from "@/lib/clipboard";
import { formatCount } from "@/lib/aiFeature.mjs";
import { createAiShare, getAiShare, revokeAiShare } from "@/services/ai-feature/ai-feature.service";

/**
 * The guest link. One per event: generated with or without a PIN, shown with its QR and how often
 * it has been opened, revoked when the event is over, regenerated when the old one has leaked.
 * Regenerating re-keys the same short code, so an invitation already printed still works.
 */
export default function ShareDialog({ eventId, eventName, onClose, onNotify }) {
  const [share, setShare] = useState(undefined);
  const [requirePin, setRequirePin] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState(null);
  const [copied, setCopied] = useState(false);

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
      const response = await createAiShare(eventId, { requirePin: share?.hasPin && confirm === "regenerate" ? true : requirePin });
      setShare(response.data);
      setConfirm(null);
      onNotify?.(active ? "New link generated." : "Event link generated.");
    } catch (cause) {
      setError(cause.message || "Unable to generate the link.");
    } finally {
      setBusy("");
    }
  }
  async function revoke() {
    setBusy("revoke");
    try {
      await revokeAiShare(eventId);
      await load();
      setConfirm(null);
      onNotify?.("Event link revoked.");
    } catch (cause) {
      setError(cause.message || "Unable to revoke the link.");
    } finally {
      setBusy("");
    }
  }
  async function copy(text) {
    const done = await copyToClipboard(text);
    setCopied(done);
    if (done) window.setTimeout(() => setCopied(false), 2500);
  }

  const message = active ? `Photos from ${eventName || "the event"} are ready.\n\nOpen ${share.url}${share.pin ? `\nPIN: ${share.pin}` : ""}\n\nUpload a selfie to find the photos you are in.` : "";

  return <>
    <Dialog
      title="Share with guests"
      description={active ? "Send this link or QR to the guests. They register, take a selfie, and get their photos." : "Guests reach the event through one link. It can ask for a PIN, and it can be revoked at any time."}
      size="md"
      onClose={onClose}
      busy={Boolean(busy)}
      footer={active
        ? <>
          <Button type="button" variant="danger" className="max-sm:flex-1" disabled={Boolean(busy)} onClick={() => setConfirm("revoke")}>Revoke link</Button>
          <Button type="button" className="max-sm:flex-1" disabled={Boolean(busy)} onClick={() => setConfirm("regenerate")}>Regenerate</Button>
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
            <div>
              <p className="text-[11px] font-semibold text-slate-600 sm:text-xs">Event link</p>
              <div className="mt-1.5 flex gap-2">
                <input readOnly value={share.url} aria-label="Event link" onFocus={(event) => event.target.select()} className="min-h-9 min-w-0 flex-1 rounded-lg border border-slate-300 bg-slate-50 px-3 text-xs text-slate-700 sm:text-sm" />
                <Button type="button" size="sm" className="min-h-9" onClick={() => copy(share.url)}>{copied ? "Copied" : "Copy"}</Button>
              </div>
            </div>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
              {share.qrDataUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={share.qrDataUrl} alt="QR code for the event link" className="h-40 w-40 shrink-0 self-center rounded-lg border border-slate-200 bg-white p-1 sm:self-start" />
              )}
              <dl className="grid flex-1 grid-cols-2 gap-x-3 gap-y-2 text-xs">
                <dt className="text-slate-500">Short code</dt><dd className="font-mono text-slate-800">{share.shortCode}</dd>
                <dt className="text-slate-500">PIN</dt><dd className="font-mono text-slate-800">{share.pin || (share.hasPin ? "Set" : "None")}</dd>
                <dt className="text-slate-500">Opened</dt><dd className="text-slate-800">{formatCount(share.accessCount || 0)} {share.accessCount === 1 ? "time" : "times"}</dd>
                <dt className="text-slate-500">Last opened</dt><dd className="text-slate-800">{share.lastAccessAt ? new Date(share.lastAccessAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "Not yet"}</dd>
                <dt className="text-slate-500">Expires</dt><dd className="text-slate-800">{share.expiresAt ? new Date(share.expiresAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "Never"}</dd>
              </dl>
            </div>
            <ShareableMessage label="Ready-to-send message" message={message} rows={5} />
          </div>
          : <div className="space-y-3">
            {share?.status === "REVOKED" && <p className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">The previous link was revoked{share.revokedAt ? ` on ${new Date(share.revokedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}` : ""}. Generating a new one keeps the same short code.</p>}
            <ToggleSwitch label="Require a PIN to open" checked={requirePin} onCheckedChange={setRequirePin} />
            <p className="text-xs text-slate-500">A four-digit PIN is generated with the link and shown here; share it with the guests separately from the link.</p>
          </div>}
    </Dialog>
    <ConfirmDialog
      open={confirm === "revoke"}
      layer="confirmOverDialog"
      title="Revoke the event link?"
      message="Guests can no longer open the event from it. A new link can be generated afterwards."
      confirmLabel="Revoke link"
      loading={busy === "revoke"}
      onCancel={() => setConfirm(null)}
      onConfirm={revoke}
    />
    <ConfirmDialog
      open={confirm === "regenerate"}
      layer="confirmOverDialog"
      tone="primary"
      title="Generate a new link?"
      message={`The short code stays the same, so the printed link still works; the PIN is ${share?.hasPin ? "replaced with a new one" : "left off"}. Guests already signed in are unaffected.`}
      confirmLabel="Regenerate"
      loading={busy === "generate"}
      onCancel={() => setConfirm(null)}
      onConfirm={generate}
    />
  </>;
}
