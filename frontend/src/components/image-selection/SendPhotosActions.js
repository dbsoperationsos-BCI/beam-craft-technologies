"use client";

import { useRef, useState } from "react";
import Button from "@/components/shared/Button";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { addPhotosToAiEditing, sendAiEditingToSignatureAlbum } from "@/services/image-selection/ai-editing.service";
import { importUploadsToSignatureAlbum } from "@/services/image-selection/signature-album.service";

/**
 * The "Send to …" actions over a ticked selection of project photos, drawn into the bulk bars of
 * the AI Culling review and the AI Editing bay, and under the editor's one photo. Every send
 * happens on the server - a photo is never downloaded and re-uploaded - and the server compresses
 * whatever goes INTO the Signature Album to the album's own preset; sending the same photos twice
 * is asked about, never done silently.
 *
 * `from`: "culling" (AI Culling → AI Editing / Signature Album: the photos join as they are, their
 * derivatives already compressed) or "editing" (AI Editing → Signature Album only: an edited
 * photo's latest render is compressed for the album, an unedited one goes as it is, and one whose
 * render is still in flight or failed is not sent and counted). Neither sends to Photo Selection:
 * the gallery is filled by a finalized AI Culling run's Keeps, so no photo skips its cull and no
 * edit reaches the client's gallery from here. Each button is absent when the viewer may not use
 * that destination, or the project lacks that tab (`canSend…`). The server answers which ids it
 * declined because their current version was already sent; those are asked about and sent again
 * on purpose. `onDone(summary, destination, open, tone)` reports the server's answer ("info" when nothing new went), with `open` the
 * destination tab to offer afterwards.
 *
 * AI Culling → Signature Album from the web is by reference: a browser cannot read the originals on
 * the studio's disks or NAS, so it cannot make the album's own copy with the album's preset - the
 * album shows the photo's existing previews. The desktop app makes the album's own copies.
 *
 * From AI Culling the photos are a run's, and a run's photos go on only once it is FINALIZED: the
 * review passes `cullingSessionId` and `finalized`; until then the buttons are replaced by the
 * reason, and the server refuses the send all the same (409 `notFinalized`). A second press while
 * a send is in flight is refused by a ref, before React has re-rendered the button busy.
 */
const LABELS = { editing: "AI Editing", album: "Signature Album" };
export const CULLING_NOT_FINALIZED = "Finalize the run first - only a finalized run's Keeps are sent on.";
// An AI Editing send compresses each edited photo on the server, so a long selection goes in
// slices of this many; the answers are added up into one summary.
const SLICE = 50;
function merge(into, data) {
  for (const [key, value] of Object.entries(data || {})) {
    if (Array.isArray(value)) into[key] = [...(into[key] || []), ...value];
    else if (typeof value === "number") into[key] = (into[key] || 0) + value;
    else if (into[key] == null) into[key] = value;
  }
  return into;
}

function summarize(destination, data, from) {
  const n = (value) => value || 0;
  // Counted apart: already there, and not sendable (still processing, or still to be culled).
  const notSent = (value, words) => (value ? `${value} not sent - ${words}` : "");
  if (destination === "editing") {
    const tail = [data.skipped ? `${data.skipped} already there` : "", notSent(data.notCulled, "still to be culled")].filter(Boolean).join(", ");
    return n(data.added) ? `${n(data.added)} photo${n(data.added) === 1 ? "" : "s"} sent to AI Editing${tail ? ` (${tail})` : ""}.` : `Nothing new for AI Editing${tail ? ` (${tail})` : ""}.`;
  }
  if (from === "editing") {
    const held = data.notReady ? ` ${data.notReady} not sent: still rendering, or the render failed. Apply again, then send.` : "";
    if (!n(data.created) && !n(data.referenced) && data.notReady) return `Nothing was sent.${held}`;
    return `${n(data.created)} edited photo${n(data.created) === 1 ? "" : "s"} compressed into the Signature Album, ${n(data.referenced)} added as ${n(data.referenced) === 1 ? "it is" : "they are"}${data.referencedSkipped ? `, ${data.referencedSkipped} already there` : ""}.${held}`;
  }
  const tail = [data.skipped ? `${data.skipped} already there` : "", notSent(data.notSendable, "still processing, or still to be culled")].filter(Boolean).join(", ");
  return n(data.added) ? `${n(data.added)} photo${n(data.added) === 1 ? "" : "s"} added to the Signature Album${tail ? ` (${tail})` : ""}.` : `Nothing new for the Signature Album${tail ? ` (${tail})` : ""}.`;
}

export default function SendPhotosActions({ projectId, uploadIds, from = "culling", cullingSessionId = null, finalized = true, canSendToEditing = false, canSendToAlbum = false, disabled = false, onDone, onError, onOpenEditing, onOpenAlbum, className = "", buttonClassName = "" }) {
  const [confirm, setConfirm] = useState(null);
  const [busy, setBusy] = useState(null);
  const sending = useRef(false);
  const count = uploadIds.length;
  if (!count || (!canSendToEditing && !canSendToAlbum)) return null;
  if (from === "culling" && !finalized) return <span role="status" className={`text-[11px] text-white/80 ${className}`}>{CULLING_NOT_FINALIZED}</span>;

  async function run(destination, force = false, ids = uploadIds) {
    if (sending.current) return;
    sending.current = true;
    setBusy(destination);
    const open = destination === "editing" ? onOpenEditing : onOpenAlbum;
    try {
      const data = {};
      // Slices for the send that compresses on the server; the cheap ones go in one call.
      const sliced = from === "editing" && destination === "album";
      for (let index = 0; index < ids.length; index += sliced ? SLICE : ids.length) {
        const slice = ids.slice(index, sliced ? index + SLICE : ids.length);
        let answer;
        // From a run's review the run is named, so the server checks it is finalized.
        const selection = cullingSessionId ? { cullingSessionId, ...(destination === "editing" ? { uploadIds: slice } : { imageIds: slice }) } : slice;
        if (destination === "editing") answer = (await addPhotosToAiEditing(projectId, selection)).data;
        else answer = (await (from === "editing" ? sendAiEditingToSignatureAlbum(projectId, slice, { force }) : importUploadsToSignatureAlbum(projectId, selection))).data;
        merge(data, answer);
      }
      // The server declined the versions it already sent. Whatever else went is reported now, so
      // a Cancel on the question that follows never hides a change that was made; the question
      // then covers only the photos that were declined.
      const repeats = force ? [] : data.alreadySent || [];
      const sentSomething = Boolean(data.created || data.referenced || data.added);
      // Every photo held back (still rendering, or failed): said as a problem, and the selection
      // is kept so Apply and a second send need no re-ticking.
      if (!sentSomething && !repeats.length && data.notReady) { onError?.(summarize(destination, data, from)); setConfirm(null); return; }
      // Nothing new is said as information, not as a success.
      if (sentSomething || !repeats.length) onDone?.(summarize(destination, data, from), destination, open || null, sentSomething ? "success" : "info");
      if (repeats.length) { setConfirm({ destination, repeat: repeats.length, ids: repeats }); return; }
      setConfirm(null);
    } catch (error) {
      onError?.(error.message || `Unable to send the photos to ${LABELS[destination]}.`);
    } finally { sending.current = false; setBusy(null); }
  }

  function ask(destination) {
    // The album may be a published album the client is looking at: said before the send, not after.
    if (destination === "album") setConfirm({ destination, message: `${count} photo${count === 1 ? "" : "s"} will be added to the project's Signature Album, in its Album chapter. ${from === "editing" ? "Edited photos are compressed to the album's own preset first; the originals in AI Editing are not changed." : "From the web they are added with their existing previews - the browser cannot read the originals to compress them with the album's own preset (the desktop app does). The album is created if the project has none yet."}` });
    else run(destination);
  }

  const button = (destination, label) => (
    <Button key={destination} size="none" variant="plain" disabled={disabled || Boolean(busy)} busy={busy === destination} busyLabel="Sending..." onClick={() => ask(destination)} className={buttonClassName || "min-h-10 rounded bg-white/10 px-2 py-1 text-[11px] font-semibold text-white hover:opacity-80 sm:min-h-8"}>
      {label}
    </Button>
  );

  return (
    <span className={`flex flex-wrap items-center gap-2 ${className}`}>
      {canSendToEditing && button("editing", "Send to AI Editing")}
      {canSendToAlbum && button("album", "Send to Signature Album")}
      {confirm && (
        <ConfirmDialog
          title={confirm.repeat ? `Send to ${LABELS[confirm.destination]} again?` : `Send to ${LABELS[confirm.destination]}?`}
          message={confirm.repeat
            ? `${confirm.repeat} of these photo${confirm.repeat === 1 ? " was" : "s were"} already sent to ${LABELS[confirm.destination]} in ${confirm.repeat === 1 ? "its" : "their"} current version. Sending again makes another copy there.`
            : confirm.message}
          confirmLabel={confirm.repeat ? "Send again" : "Send"}
          busyLabel="Sending..."
          tone="primary"
          loading={Boolean(busy)}
          onCancel={() => setConfirm(null)}
          onConfirm={() => run(confirm.destination, Boolean(confirm.repeat), confirm.ids || uploadIds)}
        />
      )}
    </span>
  );
}
