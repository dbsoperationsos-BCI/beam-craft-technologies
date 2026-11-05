"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ArrowBack from "@mui/icons-material/ArrowBack";
import ChevronLeft from "@mui/icons-material/ChevronLeft";
import ChevronRight from "@mui/icons-material/ChevronRight";
import Button from "@/components/shared/Button";
import IconButton from "@/components/shared/IconButton";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import EditingControls from "./EditingControls";
import EditingPreview from "./EditingPreview";
import SendPhotosActions from "../SendPhotosActions";
import EditedDownloadButton from "./EditedDownloadButton";
import { PROGRESS_CHIP_CLASS, progressChipStyle } from "@/lib/progressStatus.mjs";
import { normalizeRecipe, recipeIsEmpty, recipeMatchesApplied } from "@/lib/aiEditingRecipe.mjs";
import { autoValuesOf, describeAnalysis, editingAlbumSyncFailed, editingLocalSourceLine, editingPhotoStatus, editingPositionLine, editingSentLine, editingSourceLine, editingWaitingLine } from "@/lib/imageSelectionEditing.mjs";
import { batchApplyAiEditing, getAiEditingPhoto, retryAiEditingAlbumSync, removeAiEditingReference, renderAiEditingPhoto, resetAiEditingPhoto, saveAiEditingRecipe, suggestAiEditingMarks, uploadAiEditingReference } from "@/services/image-selection/ai-editing.service";

/**
 * One photo being edited: the preview on the left, the controls on the right (stacked on a phone),
 * the actions underneath. Changes to the recipe save themselves a moment after the slider stops
 * (nothing is lost by leaving), Apply renders them on the server and the panel polls until the
 * render lands, Reset puts the photo back to untouched, and the one send - to the Signature Album -
 * goes through the server with the album's own compression. The original is never written to by
 * any of it.
 *
 * The panel is one photo: the bay keys it by the photo's id and walks the bay with the keyboard
 * (Left / Right, Home / End - the listener is the bay's), so a move is this panel closing and the
 * next opening. Under the photo it says where the photo sits ("3 of 20") between Previous and Next
 * buttons for the same moves (no key hints - the owner's call). On the way out a change still waiting for its save - or one whose save failed - is
 * saved and written back into the bay's row, so coming back shows what was saved; a render in
 * flight keeps going on the server and the bay's polling picks it up.
 *
 * Where a render reads from is the server's call, never a silent one here: Apply sends no `source`,
 * and a photo whose original lives only on a studio workstation either waits for the desktop app
 * that holds it (WAITING_FOR_DESKTOP - the panel says so and keeps asking) or comes back 409
 * `requiresSourceChoice`, which opens a ConfirmDialog. Only after the user chooses does the panel
 * send `source: "preview"` - the 1600px web preview, the original staying where it is.
 */
const SAVE_DELAY_MS = 600;
const POLL_MS = 2500;

// `selectedIds` are the bay's ticked photos and `scopeTotal` how many READY photos the bay scope
// holds, for "Apply to selected" / "Apply to all"; `folderId` is the scope; `batchCounts` the bay's
// live counts while a batch renders; `onBatchQueued` tells the bay to start watching. `position` is `{ index, total, canPrev, canNext }` - where the photo sits in the bay - or null when the bay cannot place it; `onNavigate("prev" | "next" | "first" | "last", { viaButton })` is the bay's move. `unsavedRecipe` is a recipe whose save failed the last time this photo was left (the bay
// kept it): the panel opens on it, marked "Not saved" with Retry, instead of on the server's older
// one; `onUnsavedChange(uploadId, recipe | null, fileName)` tells the bay to keep or clear it.
// `compareMode` / `onCompareModeChange` (Before / After, Split, Side by side) are the bay's, so the
// way of comparing is kept from photo to photo.
export default function EditingPanel({ projectId, photo: initial, capabilities, canWrite, canSendToAlbum, position = null, onNavigate = null, unsavedRecipe = null, onUnsavedChange = null, compareMode = "toggle", onCompareModeChange = null, onBack, onPhotoChange, onNotice, onOpenAlbum, selectedIds = [], scopeTotal = 0, folderId = null, batchCounts = null, onBatchQueued }) {
  const [photo, setPhoto] = useState(initial);
  const [suggesting, setSuggesting] = useState(false);
  const [batchBusy, setBatchBusy] = useState(null);
  const [recipe, setRecipe] = useState(() => normalizeRecipe(unsavedRecipe || initial.edit?.recipe));
  const [view, setView] = useState(initial.edit?.hasOutput ? "after" : "before");
  // "pending" (a change waiting for the save), "saving", "saved", "failed".
  const [saveState, setSaveState] = useState(unsavedRecipe ? "failed" : "saved");
  const latestRecipe = useRef(normalizeRecipe(unsavedRecipe || initial.edit?.recipe));
  const [resetting, setResetting] = useState(false);
  const [applying, setApplying] = useState(false);
  const [referenceBusy, setReferenceBusy] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  // The explicit "render from the web preview?" question: `{ kind: "single", reason }` after a 409
  // on Apply, `{ kind: "batch", scope, count }` after a batch that could not route every photo.
  const [sourceChoice, setSourceChoice] = useState(null);
  // "Not now" was chosen: said on screen until the next Apply, so a photo that did not render is
  // never read as one that did.
  const [sourceDeclined, setSourceDeclined] = useState(false);
  const saveTimer = useRef(null);
  const savedJson = useRef(JSON.stringify(normalizeRecipe(initial.edit?.recipe)));
  const edit = photo.edit;
  const status = editingPhotoStatus(photo);
  const rendering = edit?.status === "QUEUED" || edit?.status === "RENDERING";
  const waitingForDesktop = Boolean(edit?.waitingForDesktop) || edit?.status === "WAITING_FOR_DESKTOP";
  const uploadId = photo.id;

  const apply = useCallback((next) => { setPhoto(next); onPhotoChange?.(next); }, [onPhotoChange]);

  // Autosave: the recipe as it stands, a moment after the last change. A failed save is said once.
  const persist = useCallback(async (next) => {
    const json = JSON.stringify(next);
    if (json === savedJson.current) { setSaveState("saved"); return; }
    setSaveState("saving");
    try {
      const response = await saveAiEditingRecipe(projectId, uploadId, next);
      savedJson.current = json;
      setSaveState("saved");
      onUnsavedChange?.(uploadId, null);
      apply({ ...photo, edit: response.data });
    } catch (error) {
      setSaveState("failed");
      onNotice?.(error.message || "Unable to save the edit.", "error");
    }
  }, [projectId, uploadId, apply, photo, onNotice, onUnsavedChange]);
  const change = (next) => {
    const normalized = normalizeRecipe(next);
    setRecipe(normalized);
    latestRecipe.current = normalized;
    if (!canWrite) return;
    setSaveState("pending");
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => persist(normalized), SAVE_DELAY_MS);
  };
  // A change still waiting when the panel closes - or one whose save failed - is saved on the way
  // out, not dropped, and the saved edit is written back into the bay's row so returning to the
  // photo shows it. A save that fails even then is handed to the bay with the sliders as they
  // were (`onUnsavedChange`), which keeps them for the photo's next opening and says so. The
  // bay's callbacks are read through a ref (written in an effect, never during render) so `flush`
  // stays the same function and the unmount effect below runs once, on unmount.
  const latest = useRef({ photo: initial, onPhotoChange, onUnsavedChange });
  useEffect(() => { latest.current = { photo, onPhotoChange, onUnsavedChange }; });
  const flush = useCallback(() => {
    if (saveTimer.current) { window.clearTimeout(saveTimer.current); saveTimer.current = null; }
    if (!canWrite || JSON.stringify(latestRecipe.current) === savedJson.current) return;
    const next = latestRecipe.current;
    saveAiEditingRecipe(projectId, uploadId, next)
      .then((response) => { savedJson.current = JSON.stringify(next); latest.current.onUnsavedChange?.(uploadId, null); latest.current.onPhotoChange?.({ ...latest.current.photo, edit: response.data }); })
      .catch(() => latest.current.onUnsavedChange?.(uploadId, next, latest.current.photo?.fileName));
  }, [canWrite, projectId, uploadId]);
  useEffect(() => flush, [flush]);

  // While a render is in flight - on the server, or waiting for the desktop app that holds the
  // original - the panel asks after it until it lands, then shows the result.
  useEffect(() => {
    if (!rendering && !waitingForDesktop) return undefined;
    let active = true;
    const timer = window.setInterval(async () => {
      try {
        const response = await getAiEditingPhoto(projectId, uploadId);
        if (!active) return;
        apply(response.data);
        if (response.data.edit?.status === "RENDERED") { setView("after"); onNotice?.(canSendToAlbum ? "Edit applied. Send it to the Signature Album below when you are happy with it." : "Edit applied.", "success"); }
        else if (response.data.edit?.status === "FAILED") onNotice?.(response.data.edit.error || "The edit could not be rendered. Try Apply again, or change the tools you switched on.", "error");
      } catch { /* the next tick asks again */ }
    }, POLL_MS);
    return () => { active = false; window.clearInterval(timer); };
  }, [rendering, waitingForDesktop, projectId, uploadId, apply, onNotice, canSendToAlbum]);

  // `source` is only ever "preview", and only after the user chose it: Apply itself leaves the
  // routing to the server, which may answer that a choice is needed.
  async function render(source) {
    if (!canWrite || applying) return;
    if (saveTimer.current) { window.clearTimeout(saveTimer.current); saveTimer.current = null; }
    setSourceDeclined(false);
    setApplying(true);
    try {
      const response = await renderAiEditingPhoto(projectId, uploadId, recipe, source ? { source } : {});
      savedJson.current = JSON.stringify(recipe);
      // A WAITING_FOR_DESKTOP answer is said by the banner under the preview, not a toast as well.
      apply({ ...photo, edit: response.data });
    } catch (error) {
      if (error.status === 409 && error.data?.details?.requiresSourceChoice) { setSourceChoice({ kind: "single", reason: error.data.details.reason || "" }); return; }
      onNotice?.(error.message || "Unable to start the render.", "error");
    } finally { setApplying(false); }
  }
  async function reset() {
    if (resetting) return;
    setConfirmReset(false);
    setResetting(true);
    try {
      const response = await resetAiEditingPhoto(projectId, uploadId);
      const next = normalizeRecipe(response.data?.recipe);
      savedJson.current = JSON.stringify(next);
      setRecipe(next);
      setView("before");
      apply({ ...photo, edit: response.data });
      onNotice?.("Back to the untouched photo.", "success");
    } catch (error) {
      onNotice?.(error.message || "Unable to reset the edit.", "error");
    } finally { setResetting(false); }
  }
  async function uploadReference(file) {
    setReferenceBusy(true);
    try {
      const response = await uploadAiEditingReference(projectId, uploadId, file);
      const next = normalizeRecipe(response.data.recipe);
      savedJson.current = JSON.stringify(next);
      setRecipe(next);
      apply({ ...photo, edit: response.data });
      onNotice?.("Reference stored. Apply to render with it.", "success");
    } catch (error) {
      onNotice?.(error.message || "Unable to store the reference photo.", "error");
    } finally { setReferenceBusy(false); }
  }
  async function removeReference() {
    setReferenceBusy(true);
    try {
      const response = await removeAiEditingReference(projectId, uploadId);
      const next = normalizeRecipe(response.data?.recipe);
      savedJson.current = JSON.stringify(next);
      setRecipe(next);
      apply({ ...photo, edit: response.data });
    } catch (error) {
      onNotice?.(error.message || "Unable to remove the reference photo.", "error");
    } finally { setReferenceBusy(false); }
  }

  // What the engine would remove: background people, proposed as marks the photographer confirms.
  async function suggestMarks() {
    setSuggesting(true);
    try {
      const { data } = await suggestAiEditingMarks(projectId, uploadId);
      const found = data?.masks || [];
      if (!found.length) { onNotice?.(data?.faces ? "No one in the background to mark - every face looks like a subject." : "No faces found to judge by. Drag over what to remove instead.", "info"); return; }
      const existing = recipe.tools.removeObject?.masks || [];
      change({ ...recipe, tools: { ...recipe.tools, removeObject: { masks: [...existing, ...found] } } });
      setView("before");
      onNotice?.(`${found.length} area${found.length === 1 ? "" : "s"} marked - background people. Remove any you want to keep, then Apply.`, "success");
    } catch (error) {
      onNotice?.(error.message || "Unable to suggest what to remove.", "error");
    } finally { setSuggesting(false); }
  }
  // This recipe onto the ticked photos, or every photo in the bay scope: one job each on the server.
  // A photo whose original lives only on a workstation is handed to the desktop app; one the server
  // cannot hand over is counted in `requiresSourceChoice`, and the user is asked before any of
  // those renders from the preview (`source: "preview"` re-sends the same batch - photos already
  // queued or handed over are skipped by the server, so nothing renders twice).
  async function applyTo(scope, source) {
    if (!canWrite || batchBusy) return;
    if (saveTimer.current) { window.clearTimeout(saveTimer.current); saveTimer.current = null; }
    setSourceDeclined(false);
    setBatchBusy(scope);
    try {
      const body = scope === "selected" ? { recipe, uploadIds: selectedIds } : { recipe, all: true, folderId };
      if (source) body.source = source;
      const { data } = await batchApplyAiEditing(projectId, body);
      onBatchQueued?.(data);
      const parts = [`${data.queued} photo${data.queued === 1 ? "" : "s"} queued with this edit`];
      if (data.waitingForDesktop) parts.push(`${data.waitingForDesktop} handed to the desktop app that holds the original`);
      if (data.skipped) parts.push(`${data.skipped} skipped - still rendering or not ready`);
      // The photos that need a choice are not counted here: the dialog that opens says them.
      if (data.requiresSourceChoice > 0) setSourceChoice({ kind: "batch", scope, count: data.requiresSourceChoice, queued: data.queued || 0, waitingForDesktop: data.waitingForDesktop || 0 });
      else onNotice?.(`${parts.join(" · ")}. Each adapts to its own light; the look stays the same.`, "success");
    } catch (error) {
      onNotice?.(error.message || "Unable to apply the edit to the photos.", "error");
    } finally { setBatchBusy(null); }
  }

  const notes = edit?.appliedRecipe?.notes || [];
  const analysisLine = describeAnalysis(edit?.appliedRecipe?.analysis);
  const sourceLine = editingSourceLine(edit);
  const sentLine = editingSentLine(photo);
  // The workstation's own words when the desktop app could not open the original (the server
  // writes them into `edit.error` too), and the line that says what a wait for the desktop means.
  const localSourceLine = editingLocalSourceLine(edit);
  const waitingLine = editingWaitingLine(photo, canWrite);
  const previewButtonTitle = "Renders this edit on the server from the 1600px web preview; the original stays untouched on the studio's machine";
  // The dialog leads with what the choice means, then why it is being asked (the server's own
  // reason when it gave one), then - for a batch - what already went ahead without a choice.
  const SOURCE_CONSEQUENCE = "The edit will be rendered at web-preview quality (1600px), not from the original. The original stays untouched on the studio's machine.";
  const sourceChoiceMessage = sourceChoice?.kind === "batch"
    ? [SOURCE_CONSEQUENCE, `${sourceChoice.count} photo${sourceChoice.count === 1 ? " has its original" : "s have their originals"} only on a studio workstation, and this server cannot hand ${sourceChoice.count === 1 ? "it" : "them"} to the desktop app right now.`, `Already going ahead: ${sourceChoice.queued} queued on the server, ${sourceChoice.waitingForDesktop} handed to the workstation.`].join(" ")
    : [SOURCE_CONSEQUENCE, sourceChoice?.reason || "This photo's original is only on a studio workstation, and this server cannot hand it to the desktop app right now."].join(" ");
  // Unapplied changes, by the server's own rule: a slider left to the AI reads as the number the
  // render chose, so an auto render is not "changed" until the photographer moves something.
  const dirty = !recipeMatchesApplied(recipe, edit?.appliedRecipe) && !recipeIsEmpty(recipe);
  const masksEditable = canWrite && Boolean(recipe.tools.removeObject) && view === "before";

  return (
    <div className="w-full">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => { flush(); onBack(); }} className="shrink-0"><ArrowBack style={{ fontSize: 16 }} aria-hidden="true" className="mr-1" />All photos</Button>
          <h3 className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-800" title={photo.fileName}>{photo.fileName}</h3>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
          <span className={`${PROGRESS_CHIP_CLASS} rounded-full px-2 py-1 font-semibold`} style={progressChipStyle(status.color)}><span role="status">{status.label}</span></span>
          {rendering && <span role="status" aria-live="polite" className="text-slate-600">{edit?.stage ? `${edit.stage}…` : edit?.status === "QUEUED" ? "Waiting in the queue…" : "Starting…"}</span>}
          {canWrite && (
            <span role="status" aria-live="polite" className={saveState === "failed" ? "text-red-600" : ""}>
              {saveState === "saving" ? "Saving…" : saveState === "pending" ? "Unsaved change" : saveState === "failed" ? "Not saved" : "Saved"}
              {saveState === "failed" && <Button size="none" variant="plain" onClick={() => persist(recipe)} className="ml-1 underline">Retry</Button>}
            </span>
          )}
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0">
          <EditingPreview photo={photo} recipe={recipe} view={view} onViewChange={setView} mode={compareMode} onModeChange={onCompareModeChange} masksEditable={masksEditable} onMasksChange={(masks) => change({ ...recipe, tools: { ...recipe.tools, removeObject: { ...(recipe.tools.removeObject || {}), masks } } })} />
          {/* Where this photo sits in the bay, and the two moves the keyboard also makes - directly
              under the photo, in a row of fixed height that is there for every photo (empty only
              while the bay cannot place it), so nothing below moves as photos change. A move is the
              bay's: this panel closes, the next opens (the bay announces it and puts focus back on
              the button). No key hints are drawn beside the buttons (the owner's call). */}
          {position ? (
            <div className="mt-2 flex min-h-10 items-center justify-center gap-1 text-[11px] text-slate-500 sm:min-h-8">
              <IconButton size="md" ariaLabel="Previous photo" disabled={!position.canPrev} onClick={() => onNavigate?.("prev", { viaButton: true })} className="border border-slate-300 text-slate-600 disabled:opacity-40 sm:h-8 sm:w-8"><ChevronLeft style={{ fontSize: 18 }} aria-hidden="true" /></IconButton>
              <span className="min-w-12 text-center tabular-nums">{editingPositionLine(position)}</span>
              <IconButton size="md" ariaLabel="Next photo" disabled={!position.canNext} onClick={() => onNavigate?.("next", { viaButton: true })} className="border border-slate-300 text-slate-600 disabled:opacity-40 sm:h-8 sm:w-8"><ChevronRight style={{ fontSize: 18 }} aria-hidden="true" /></IconButton>
            </div>
          ) : <div className="mt-2 min-h-10 sm:min-h-8" aria-hidden="true" />}
          {canWrite && recipe.tools.removeObject && (
            // The keyboard's way to the marks: each one listed with its own Remove, and a Clear.
            <ul className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-slate-600" aria-label="Areas marked for removal">
              {(recipe.tools.removeObject.masks || []).map((mask, index) => (
                <li key={index} className="flex items-center gap-1 rounded bg-slate-100 px-2 py-1">
                  Area {index + 1} ({Math.round(mask.w * 100)}×{Math.round(mask.h * 100)}%)
                  <Button size="none" variant="plain" ariaLabel={`Remove area ${index + 1}`} onClick={() => change({ ...recipe, tools: { ...recipe.tools, removeObject: { masks: (recipe.tools.removeObject.masks || []).filter((_, at) => at !== index) } } })} className="min-h-6 rounded px-1 text-slate-500 hover:text-slate-800">×</Button>
                </li>
              ))}
              {(recipe.tools.removeObject.masks || []).length > 0 && <li><Button size="none" variant="plain" onClick={() => change({ ...recipe, tools: { ...recipe.tools, removeObject: { masks: [] } } })} className="min-h-6 rounded px-1 text-slate-500 underline hover:text-slate-800">Clear marks</Button></li>}
            </ul>
          )}
          {/* The actions: apply, reset, and where the photo goes next - right under the photo. */}
          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-200 pt-4">
            {canWrite && (
              <>
                {/* `() => render()`, never `render` itself: the click event must not travel as `source`.
                    A photo waiting for the workstation has one way round the wait - the explicit
                    preview button - so Apply rests until the desktop answers. */}
                <Button variant="primary" size="sm" onClick={() => render()} disabled={rendering || waitingForDesktop || recipeIsEmpty(recipe)} busy={applying || rendering || waitingForDesktop} busyLabel={rendering ? "Rendering..." : waitingForDesktop ? "Waiting for workstation..." : "Starting..."} title={recipeIsEmpty(recipe) ? "Choose a style, move a slider or switch a tool on first" : dirty ? "Render these changes" : "Render again"}>
                  {dirty || !edit?.hasOutput ? "Apply edit" : "Apply again"}
                </Button>
                <Button variant="secondary" size="sm" onClick={() => setConfirmReset(true)} disabled={rendering || resetting || (!edit?.hasOutput && recipeIsEmpty(recipe))} busy={resetting} busyLabel="Resetting...">Reset</Button>
                {/* The same edit onto the ticked photos, or every photo here: one wedding, one look,
                    each photo's auto sliders adapting to its own light. */}
                {selectedIds.length > 0 && <Button variant="secondary" size="sm" onClick={() => applyTo("selected")} disabled={recipeIsEmpty(recipe) || Boolean(batchBusy)} busy={batchBusy === "selected"} busyLabel="Queuing..." title="Apply this edit to the photos ticked in the bay">Apply to selected ({selectedIds.length})</Button>}
                {scopeTotal > 1 && <Button variant="secondary" size="sm" onClick={() => applyTo("all")} disabled={recipeIsEmpty(recipe) || Boolean(batchBusy)} busy={batchBusy === "all"} busyLabel="Queuing..." title="Apply this edit to every photo in AI Editing here">Apply to all ({scopeTotal})</Button>}
              </>
            )}
            {/* Download Edited: this photo's saved master, once it has one. Held while it renders,
                while a change is not yet applied or not yet saved - what downloads is the edit on
                screen, never an older render, and never the original. */}
            {edit?.hasOutput && (
              <EditedDownloadButton
                projectId={projectId}
                uploadIds={[uploadId]}
                label="Download edited"
                disabled={rendering || waitingForDesktop || dirty || saveState !== "saved"}
                title="Download this photo's saved edit, at full resolution"
                onNotice={onNotice}
                className="ml-auto"
              />
            )}
            {/* The one way on: the Signature Album, with the album's own compression on the server.
                Held while a render is in flight or the sliders have moved since the last Apply, so
                what goes is the render on screen - never an older one. */}
            <SendPhotosActions
              projectId={projectId}
              uploadIds={[uploadId]}
              from="editing"
              canSendToAlbum={canSendToAlbum && photo.status === "READY"}
              disabled={rendering || waitingForDesktop || dirty}
              onDone={async (summary, destination, open) => {
                try { const response = await getAiEditingPhoto(projectId, uploadId); apply(response.data); } catch { /* the bay reloads */ }
                onNotice?.(summary, "success", open ? { label: "Open Signature Album", onSelect: open } : undefined);
              }}
              onError={(message) => onNotice?.(message, "error")}
              onOpenAlbum={onOpenAlbum}
              className={edit?.hasOutput ? "" : "ml-auto"}
              buttonClassName="min-h-10 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 sm:min-h-9"
            />
          </div>
          {(canSendToAlbum || edit?.hasOutput) && (rendering || waitingForDesktop || dirty) && (
            <p role="status" className="mt-1 text-[11px] text-slate-500">{rendering ? "Rendering - the send and the download unlock when it finishes." : waitingForDesktop ? "Waiting for the workstation to render - the send and the download unlock when it has." : "Apply the changes before sending or downloading, so what leaves is what you see."}</p>
          )}
          {batchCounts?.rendering > 0 && (
            // The batch's real progress: the queue's own counts, polled by the bay.
            <p role="status" aria-live="polite" className="mt-1 text-[11px] text-blue-700">Batch: {batchCounts.rendered} of {batchCounts.rendered + batchCounts.rendering} rendered · {batchCounts.rendering} still rendering{batchCounts.failedRenders ? ` · ${batchCounts.failedRenders} failed` : ""}.</p>
          )}
          {/* What the render did, under the actions: the actions stay right under the photo
              whatever a render has to say, and the feedback reads below them. */}
          {(sourceLine || sentLine) && <p className="mt-2 text-[11px] text-slate-500">{[sourceLine, sentLine].filter(Boolean).join(" ")}</p>}
          {/* An automatic album sync that gave up: why, and the way to try again (the saved edit itself is fine). */}
          {editingAlbumSyncFailed(photo) && canSendToAlbum && (
            <div role="alert" className="mt-2 flex flex-wrap items-center gap-2 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">
              <span className="min-w-0 flex-1 basis-56">{edit?.albumSync?.error || "The edited photo could not be added to the Signature Album."}</span>
              <Button variant="secondary" size="sm" onClick={async () => { try { await retryAiEditingAlbumSync(projectId, [uploadId]); const response = await getAiEditingPhoto(projectId, uploadId); apply(response.data); onNotice?.("Sending this edit to the Signature Album again.", "info"); } catch (error) { onNotice?.(error.message || "Unable to retry.", "error"); } }}>Retry</Button>
            </div>
          )}
          {/* A failed render says why; one the workstation could not open from the original also
              offers the explicit way round it - the web preview, named for what it is. */}
          {edit?.status === "FAILED" && (edit.error || localSourceLine) && (
            <div role="alert" className="mt-2 flex flex-wrap items-center gap-2 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">
              <span className="min-w-0 flex-1 basis-56">{edit.error || localSourceLine}</span>
              {canWrite && localSourceLine && <Button variant="secondary" size="sm" onClick={() => render("preview")} disabled={applying || recipeIsEmpty(recipe)} busy={applying} busyLabel="Starting..." title={previewButtonTitle}>Render from web preview instead</Button>}
            </div>
          )}
          {/* Waiting for the desktop app that holds the original: what is happening, what to do,
              and the explicit alternative. */}
          {waitingForDesktop && (
            <div role="status" aria-live="polite" className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800">
              <span className="min-w-0 flex-1 basis-56">{waitingLine}</span>
              {canWrite && <Button variant="secondary" size="sm" onClick={() => render("preview")} disabled={applying || recipeIsEmpty(recipe)} busy={applying} busyLabel="Starting..." title={previewButtonTitle}>Render from web preview instead</Button>}
            </div>
          )}
          {/* "Not now" in the preview dialog: nothing rendered, and the screen says so until the next Apply. */}
          {sourceDeclined && <p role="status" className="mt-2 text-xs text-slate-600">Not applied — the original is only on the studio workstation.</p>}
          {notes.length > 0 && (
            // What the last render could not do, in its own words (a step skipped, a region not
            // found). They belong to that render: a new Apply replaces them, and while the sliders
            // have moved since, the heading says these describe the render on screen, not the changes.
            <div role="status" className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
              <p className="font-semibold">{dirty ? "Notes from the last render - your changes since are not applied yet" : `Notes from this render (${notes.length})`}</p>
              <ul className="mt-1 list-disc space-y-1 break-words pl-4">
                {notes.map((note, index) => <li key={index}>{note}</li>)}
              </ul>
            </div>
          )}
          {analysisLine && <p className="mt-2 text-[11px] text-slate-500">{analysisLine}</p>}
          {edit?.appliedRecipe?.referenceProfile?.summary && <p className="mt-1 text-[11px] text-slate-500">Reference: {edit.appliedRecipe.referenceProfile.summary}</p>}
        </div>

        <aside className="min-w-0 lg:flex lg:max-h-[calc(100vh-14rem)] lg:flex-col">
          <EditingControls recipe={recipe} onChange={change} capabilities={capabilities} autoValues={autoValuesOf(edit)} disabled={!canWrite || rendering} reference={edit} onReferenceUpload={uploadReference} onReferenceRemove={removeReference} referenceBusy={referenceBusy} onSuggestMarks={canWrite ? suggestMarks : null} suggesting={suggesting} />
        </aside>
      </div>

      {confirmReset && (
        <ConfirmDialog
          title="Reset this edit?"
          message="The style, sliders, tools and reference are cleared and the rendered version is discarded. The original photo is untouched, as it always is."
          confirmLabel="Reset"
          tone="danger"
          onCancel={() => setConfirmReset(false)}
          onConfirm={reset}
        />
      )}
      {/* The one place the web renders from the preview: an explicit choice, never a fallback. */}
      {sourceChoice && (
        <ConfirmDialog
          title="Render from the web preview?"
          message={sourceChoiceMessage}
          confirmLabel="Render from preview"
          cancelLabel="Not now"
          tone="primary"
          onCancel={() => { setSourceChoice(null); setSourceDeclined(true); }}
          onConfirm={() => { const choice = sourceChoice; setSourceChoice(null); if (choice.kind === "batch") applyTo(choice.scope, "preview"); else render("preview"); }}
        />
      )}
    </div>
  );
}
