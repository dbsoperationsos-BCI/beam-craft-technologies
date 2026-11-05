"use client";

import { useId, useRef, useState } from "react";
import Button from "@/components/shared/Button";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { addPhotosToAiEditing } from "@/services/image-selection/ai-editing.service";
import { importUploadsToSignatureAlbum } from "@/services/image-selection/signature-album.service";
import { CULLING_NOT_FINALIZED } from "../SendPhotosActions";

/**
 * The run's kept photos, sent on in one step - every photo the cull decided Keep, without ticking
 * them one by one: to AI Editing (they join the bay as they are), or to AI Editing + Signature Album
 * - they join the bay enrolled for automatic album sync (each saved edit is compressed to the
 * album's preset on the server and written into the photo's one album copy) and are placed in the
 * album now by reference, until an edit replaces each in place. No count: every Keep of the run. Photo Selection is never a destination from here: Finalize
 * sends the Keeps on to AI Editing, and AI Editing sends to Photo Selection. Drawn under the summary while a run is reviewable or finalized; each
 * button is absent when the viewer may not use that destination or the project lacks the tab.
 * Only a finalized run's Keeps are sent: until then the buttons are held with the reason beside
 * them, and the server refuses the send all the same (409 `notFinalized`). A second press while a
 * send is in flight is refused by a ref. From the web the album gets the photos by reference: a
 * browser cannot read the originals to compress them with the album's own preset.
 */
// `unlinkedNote`: what to say instead of the sends when the project has no linked AI Editing project
// but the viewer could send there (Edit Project → Linked Modules links one). `canSyncEditsToAlbum`:
// AI Editing is linked to the Signature Album as well, which the combined send needs.
export default function CullingKeepsActions({ projectId, session, canSendToEditing = false, canSendToAlbum = false, canSyncEditsToAlbum = true, disabled = false, onNotice, onOpenEditing, onOpenAlbum, unlinkedNote = "" }) {
  const [confirm, setConfirm] = useState(null);
  const [busy, setBusy] = useState(null);
  const sending = useRef(false);
  const reasonId = useId();
  const kept = Number(session?.keepCount) || 0;
  if (!session || !kept) return null;
  if (!canSendToEditing) return unlinkedNote ? <p className="mt-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">{unlinkedNote}</p> : null;
  // The combined destination writes both tabs, so it needs both permissions - and both links.
  const canSendToEditingAlbum = canSendToEditing && canSendToAlbum && canSyncEditsToAlbum;
  const finalized = session.status === "FINALIZED";

  async function run(destination) {
    if (sending.current || !finalized) return;
    sending.current = true;
    setBusy(destination);
    try {
      if (destination === "editing") {
        const { data } = await addPhotosToAiEditing(projectId, { cullingSessionId: session.id, decision: "KEEP" });
        const tail = [data.skipped ? `${data.skipped} already there` : "", data.notCulled ? `${data.notCulled} not sent - still to be culled` : ""].filter(Boolean).join(", ");
        // Nothing new is said as information, not as a success.
        onNotice?.(data.added ? `${data.added} kept photo${data.added === 1 ? "" : "s"} sent to AI Editing${tail ? ` (${tail})` : ""}.` : `Nothing new for AI Editing${tail ? ` (${tail})` : ""}.`, data.added ? "success" : "info", onOpenEditing ? { label: "Open AI Editing", onSelect: onOpenEditing } : undefined);
      } else {
        // AI Editing + Signature Album: enrolled in the bay first, then placed in the album.
        const { data: editing } = await addPhotosToAiEditing(projectId, { cullingSessionId: session.id, decision: "KEEP", albumSync: true });
        const { data } = await importUploadsToSignatureAlbum(projectId, { cullingSessionId: session.id, decision: "KEEP" });
        const parts = [`${editing.added} kept photo${editing.added === 1 ? "" : "s"} sent to AI Editing${editing.skipped ? ` (${editing.skipped} already there)` : ""}`, `${data.added} placed in the Signature Album${data.skipped ? ` (${data.skipped} already there)` : ""}`];
        if (data.notSendable) parts.push(`${data.notSendable} not placed - still processing, or still to be culled`);
        onNotice?.(`${parts.join(", ")}. Each saved edit replaces its photo in the album automatically.`, editing.added || data.added ? "success" : "info", onOpenEditing ? { label: "Open AI Editing", onSelect: onOpenEditing } : undefined);
      }
      setConfirm(null);
    } catch (error) {
      onNotice?.(error.message || "Unable to send the kept photos.", "error");
    } finally { sending.current = false; setBusy(null); }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
      <span>{kept} kept photo{kept === 1 ? "" : "s"}:</span>
      {canSendToEditing && <Button variant="secondary" size="sm" disabled={disabled || !finalized || Boolean(busy)} aria-describedby={finalized ? undefined : reasonId} busy={busy === "editing"} busyLabel="Sending..." onClick={() => run("editing")}>Send kept to AI Editing</Button>}
      {canSendToEditingAlbum && <Button variant="secondary" size="sm" disabled={disabled || !finalized || Boolean(busy)} aria-describedby={finalized ? undefined : reasonId} busy={busy === "album"} busyLabel="Sending..." onClick={() => setConfirm("album")}>Send kept to AI Editing + Signature Album</Button>}
      {!finalized && <span id={reasonId} className="text-amber-700">{CULLING_NOT_FINALIZED}</span>}
      {confirm === "album" && finalized && (
        <ConfirmDialog
          title="Send the kept photos to AI Editing + Signature Album?"
          message={`All ${kept} photo${kept === 1 ? "" : "s"} the run kept will join AI Editing and the project's Signature Album. Until a photo is edited the album shows its existing preview (the web cannot read the originals); each edit you save then replaces it in the album automatically, in the same place. The album is created if the project has none yet.`}
          confirmLabel="Send"
          busyLabel="Sending..."
          tone="primary"
          loading={busy === "album"}
          onCancel={() => setConfirm(null)}
          onConfirm={() => run("album")}
        />
      )}
    </div>
  );
}
