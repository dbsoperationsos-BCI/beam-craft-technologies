"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Button from "@/components/shared/Button";
import ChoiceCards from "@/components/shared/ChoiceCards";
import TextField from "@/components/shared/TextField";
import CullingPreferencePanel from "./CullingPreferencePanel";
import CullingReviewGallery from "./CullingReviewGallery";
import CullingStageList from "./CullingStageList";
import CullingStateCard from "./CullingStateCard";
import CullingSummaryBar from "./CullingSummaryBar";
import CullingKeepsActions from "./CullingKeepsActions";
import CullingImportPanel from "./CullingImportPanel";
import Loader from "@/components/shared/Loader";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import FloatingNotice, { useNotice } from "@/components/shared/FloatingNotice";
import { cancelCullingSession, finalizeCullingSession, getCullingOverview, reopenCullingSession, runCullingSession, startCullingSession } from "@/services/image-selection/image-selection.service";
import { CULLING_ALL_SCENES, CULLING_FAILED_ASSURANCE, CULLING_FINALIZE_ASSURANCES, CULLING_MODES, cullingAiStatus, cullingCoverageLine, cullingCoverageMissing, cullingFinalizeMessage, cullingHeldLine, cullingImporting, cullingModeSummary, cullingNewPhotosNotice, cullingProgressPercent, cullingStageSteps, cullingStartAvailability, cullingTargetValidity, cullingWaitingForDesktop, cullingWorkspaceState, isCullingSessionActive } from "@/lib/imageSelectionCulling.mjs";
import { PROGRESS_CHIP_CLASS, progressChipStyle } from "@/lib/progressStatus.mjs";

// How long after the last decision the story coverage line is re-read.
const COVERAGE_REFRESH_MS = 1500;
const MODE_OPTIONS = CULLING_MODES.map((option) => ({ value: option.id, label: option.label, description: option.description }));

/**
 * The AI Culling tab's body: the staff-side AI triage that happens before the client gallery,
 * drawn as one state per moment (`cullingWorkspaceState`): no photos, photos uploading or
 * processing, photos ready, a run analyzing (or waiting on the desktop), the review, finalized.
 * Every figure is the server's; nothing is shown that the run did not compute.
 *
 * The workspace is scoped to the folder selected in the tree, exactly like Photo Selection:
 * `folder` is that folder, and the run covers it and its subtree — its own session, counts,
 * review and finalize, independent of the folder next door. Null folder means the whole project.
 * `scopeLabel` is the folder's path as the header shows it.
 *
 * The browser never uploads here: photos for culling are imported by the desktop app, from the
 * originals where they live, and this tab reviews what arrives. `onOpenPhotos` takes the
 * photographer to Photo Selection on this same folder (absent when that tab is not available).
 * `expanded` / `onExpandedChange` let the review borrow the tree's and the rail's width for a
 * while; the project workspace owns that state and gives it back on leaving the tab.
 *
 * `onSessionSettled` fires after a finalize or reopen: the parent's gallery header (publish
 * counts, the Publish guard) reads from Photo Selection, which just changed.
 */
// `canSendToEditing` / `canSendToAlbum`: whether the review offers "Send to …" over a ticked
// selection - each answers to its destination's own permission and to the project having that
// tab. There is no send to Photo Selection from here: AI Culling is a stage no photo skips, and
// its Keeps go on to AI Editing (Finalize does that). `onOpenEditing` opens that tab after a send.
// `canSyncEditsToAlbum`: AI Editing linked to the Signature Album too, which "AI Editing + Signature
// Album" needs - each saved edit goes on from AI Editing into the album.
export default function CullingWorkspace({ projectId, projectName = "", folder = null, scopeLabel: scopePath = "", canWrite = true, shootFolder = false, refreshKey = 0, onSessionSettled, onOpenPhotos = null, onOpenEditing = null, expanded = false, onExpandedChange = null, canSendToEditing = false, canSendToAlbum = false, canSyncEditsToAlbum = true, unlinkedNote = "" }) {
  const [overview, setOverview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState("ASSISTED");
  const [targetCount, setTargetCount] = useState("");
  // After a run, starting another is tucked behind one button: the review is the work now.
  const [newRunOpen, setNewRunOpen] = useState(false);
  // The finalize/reopen confirmation. `details` arrives from the server's 409 escalation — the
  // second dialog states exactly what the first one could not know (undecided counts, a live
  // published gallery) and the confirm retries with acknowledge.
  const [confirmAction, setConfirmAction] = useState(null);
  // The review's scene, owned here so the coverage line can open the review on a missing scene.
  const [reviewScene, setReviewScene] = useState(CULLING_ALL_SCENES);
  const { notice, showSuccess, showError, clearNotice } = useNotice();

  const folderId = folder?.id || null;
  const scopeLabel = scopePath || (folder ? folder.name : "Whole project");
  const load = useCallback(async () => {
    try {
      const response = await getCullingOverview(projectId, folderId);
      setOverview(response.data);
    } catch (error) {
      showError(error.message || "Unable to load culling status.");
    }
  }, [projectId, folderId, showError]);
  // Deferred by a zero timer, the workspace's own convention for loaders.
  useEffect(() => { const timer = window.setTimeout(load, 0); return () => window.clearTimeout(timer); }, [load, refreshKey]);

  const session = overview?.session || null;
  const active = isCullingSessionActive(session);
  const state = overview ? cullingWorkspaceState(overview) : null;
  // Photos still uploading or processing are polled too (also once some are ready), so the counts
  // and the tab move on by themselves while no run is moving.
  const inFlight = (Number(overview?.photoCounts?.uploading) || 0) + (Number(overview?.photoCounts?.processing) || 0);
  const waitingForPhotos = !active && state !== "review" && state !== "finalized" && state !== "waiting" && inFlight > 0;

  // While a run is moving (or photos are still being processed) the card polls — but not from a
  // background tab, where nobody is watching the bar.
  useEffect(() => {
    if (!active && !waitingForPhotos) return undefined;
    const timer = window.setInterval(() => { if (!document.hidden) load(); }, 5000);
    // Coming back to the tab refreshes at once rather than on the next tick.
    const onVisible = () => { if (!document.hidden) load(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [active, waitingForPhotos, load]);

  // Full width is for reviewing: when the state leaves the review (a new run starts, a run goes
  // stale), the tree and the project panel come back by themselves.
  const reviewing = state === "review" || state === "finalized";
  useEffect(() => { if (expanded && overview && !reviewing) onExpandedChange?.(false); }, [expanded, overview, reviewing, onExpandedChange]);

  async function start() {
    setBusy(true);
    try {
      const response = await startCullingSession(projectId, { mode, folderId, ...(mode === "TARGET_COUNT" ? { targetCount: Number(targetCount) } : {}) });
      setOverview((current) => ({ ...current, session: response.data }));
      setNewRunOpen(false);
      showSuccess("Culling run started.");
    } catch (error) {
      showError(error.message || "Unable to start culling.");
    } finally { setBusy(false); }
  }

  const targetValidity = cullingTargetValidity(mode, targetCount, overview?.readyCount || 0);

  // Decision responses carry the session's fresh counts; folding them straight into the summary
  // keeps the header agreeing with the gallery without a refetch.
  // The coverage line follows the effective decisions: a burst of decisions refreshes it once, a
  // moment after the last one, rather than on every key press.
  const coverageRefresh = useRef(null);
  // A queued refresh dies with the project or folder it was for (and with the workspace).
  useEffect(() => () => window.clearTimeout(coverageRefresh.current), [load]);
  const applyCounts = useCallback((counts) => {
    setOverview((current) => (current?.session ? { ...current, session: { ...current.session, keepCount: counts.keep, maybeCount: counts.maybe, rejectCount: counts.reject } } : current));
    window.clearTimeout(coverageRefresh.current);
    coverageRefresh.current = window.setTimeout(load, COVERAGE_REFRESH_MS);
  }, [load]);
  // `action` is the notice's optional undo (`{ label, onSelect }`), as FloatingNotice draws it.
  const reviewNotice = useCallback((message, tone, action) => { if (tone === "error") showError(message); else showSuccess(message, action); }, [showError, showSuccess]);

  // A run the desktop app is analyzing on its own computer: the web can only wait, or hand it
  // to the server to finish from the previews when that computer is away.
  async function handOver() {
    setBusy(true);
    try {
      // A run that began with the import is handed over past the photos still arriving.
      await runCullingSession(projectId, session.id, { force: cullingImporting(session) });
      showSuccess("The server is finishing the run from the photos' previews.");
      await load();
    } catch (error) {
      showError(error.message || "Unable to hand the run to the server.");
    } finally { setBusy(false); }
  }

  async function cancel() {
    setBusy(true);
    try {
      const response = await cancelCullingSession(projectId, session.id);
      setOverview((current) => ({ ...current, session: response.data }));
      showSuccess("Culling run cancelled.");
    } catch (error) {
      showError(error.message || "Unable to cancel culling.");
    } finally { setBusy(false); }
  }

  // Finalize and reopen share one flow: confirm, call, and if the server answers 409 with
  // requiresAcknowledgement, re-open the dialog carrying the server's exact reasons and retry
  // with acknowledge — the project/folder deletion escalation, applied here.
  async function runConfirmedAction() {
    const action = confirmAction;
    if (!action) return;
    setBusy(true);
    try {
      const call = action.type === "finalize" ? finalizeCullingSession : reopenCullingSession;
      const response = await call(projectId, session.id, { acknowledge: Boolean(action.details) });
      setOverview((current) => ({ ...current, session: response.data.session }));
      setConfirmAction(null);
      onSessionSettled?.();
      if (action.type === "finalize") {
        const { excluded, protected: kept } = response.data;
        showSuccess(`Culling finalized. ${excluded} photo${excluded === 1 ? "" : "s"} hidden from Photo Selection${kept ? `; ${kept} stayed because the client already selected them` : ""}.`, canWrite ? { label: "Reopen", onSelect: () => setConfirmAction({ type: "reopen" }) } : undefined);
      } else {
        showSuccess(`Culling reopened — ${response.data.restored} photo${response.data.restored === 1 ? "" : "s"} restored to Photo Selection.`);
      }
      await load();
    } catch (error) {
      if (error.status === 409 && error.data?.details?.requiresAcknowledgement) setConfirmAction({ type: action.type, details: error.data.details });
      else { setConfirmAction(null); showError(error.message || "Unable to update the culling session."); }
    } finally { setBusy(false); }
  }

  const floatingNotice = <FloatingNotice notice={notice} onClose={clearNotice} />;
  if (!overview) return <>{floatingNotice}<div className="grid min-h-[300px] place-items-center"><Loader label="Loading culling status..." size="sm" inline /></div></>;

  const availability = cullingStartAvailability({ enabled: overview.enabled, session, readyCount: overview.readyCount, canWrite });
  const percent = cullingProgressPercent(session);
  const settled = state === "review" || state === "finalized";
  const status = cullingAiStatus(state, session);
  const counts = overview.photoCounts || { total: overview.readyCount || 0, ready: overview.readyCount || 0, processing: 0, uploading: 0, failed: 0 };
  // Before any photo is ready (or after a run that left nothing to review), the counts decide.
  const preRunState = overview.readyCount > 0 ? "ready" : cullingWorkspaceState({ ...overview, session: null });
  const heldLine = cullingHeldLine(counts.held);

  // The mode choice and Start, shared by the Ready card and "Start a new run".
  // On a shoot (root) folder the mode cards are not shown: the run starts in the mode already held.
  const startControls = canWrite ? (
    <div>
      {!shootFolder && <>
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">AI culling mode</p>
      <ChoiceCards ariaLabel="Culling mode" options={MODE_OPTIONS} value={mode} onChange={setMode} columns={2} />
      </>}
      {!shootFolder && mode === "TARGET_COUNT" && (
        <TextField
          className="mt-3"
          label={`Aim for about (of ${overview.readyCount || 0} photos)`}
          helperText="How many photos the AI should aim to keep from this set."
          type="number"
          min="1"
          max={Math.max(1, (overview.readyCount || 1) - 1)}
          value={targetCount}
          onChange={(event) => setTargetCount(event.target.value)}
          error={targetCount !== "" && !targetValidity.valid ? targetValidity.reason : ""}
          note={targetCount === "" ? targetValidity.reason : ""}
        />
      )}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button variant={session ? "secondary" : "primary"} onClick={start} disabled={!availability.canStart || !targetValidity.valid} busy={busy} busyLabel="Starting..." title={availability.reason || undefined}>
          {session ? "Start a new run" : "Start AI Culling"}
        </Button>
        {availability.reason && <span className="text-[11px] text-slate-500">{availability.reason}</span>}
      </div>
    </div>
  ) : <p className="text-xs text-slate-500">Only someone who can edit this project can start a run.</p>;

  return (
    <div className="w-full">
      {floatingNotice}
      {/* The tab's header stays in view while the review scrolls - the AI Editing header's pattern:
          sticky inside the tab's own scrolling pane (no second scrollbar), pulled up over the
          pane's top padding (-mt / pt / -top of the same size) so it sits flush with the pane's
          top at every width, and opaque so the photos pass beneath it. */}
      <div className="sticky -top-5 z-20 -mx-5 -mt-5 mb-4 border-b border-slate-200 bg-white px-5 pb-3 pt-5">
      {/* Where the cull stands, in plain words. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-slate-800">AI Culling</h2>
          <p className="truncate text-xs text-slate-500" title={scopeLabel}>
            Folder: {scopeLabel} · {counts.total} photo{counts.total === 1 ? "" : "s"}
            {session && cullingModeSummary(session) ? ` · ${cullingModeSummary(session)}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Only the status word is live; the stage beside it changes with every poll. */}
          <span className={`${PROGRESS_CHIP_CLASS} rounded-full px-2 py-1 text-[11px] font-semibold`} style={progressChipStyle(status.color)}>
            <span role="status">AI culling: {status.label}</span>{status.detail ? ` · ${status.detail}` : ""}
          </span>
        </div>
      </div>
      </div>

      {state === "failed" && (
        <div className="mb-4 rounded-md bg-red-50 px-3 py-2 text-xs leading-5 text-red-700" role="alert">
          <p>{session.error || "The culling run failed."} {CULLING_FAILED_ASSURANCE}</p>
        </div>
      )}
      {state === "cancelled" && <p className="mb-4 rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">The last run was cancelled. Nothing it analyzed was applied.</p>}
      {state === "stale" && (
        <p className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800" role="alert">
          The photos this run analyzed are no longer in the project, so its counts no longer
          apply. Start a new run once the current photos have been processed.
        </p>
      )}

      {(!session || state === "failed" || state === "cancelled" || state === "stale") && (
        <div className="mx-auto max-w-180">
          <CullingStateCard state={preRunState} counts={counts} folderLabel={folder ? "this folder" : "this project"} canWrite={canWrite} onOpenPhotos={onOpenPhotos}>
            {preRunState === "ready" ? startControls : null}
          </CullingStateCard>
        </div>
      )}

      {/* Photos the desktop app imported for culling, waiting here; the cull is their only way on. */}
      {heldLine && (
        <div className="mx-auto mt-4 max-w-180">
          <p className="rounded-md border border-blue-100 bg-blue-50/60 px-3 py-2 text-xs leading-5 text-blue-900" role="status">{heldLine}</p>
        </div>
      )}

      {state === "importing" && (
        <CullingImportPanel overview={overview} session={session} canWrite={canWrite} busy={busy} onHandOver={() => setConfirmAction({ type: "handOver" })} onCancelRun={() => setConfirmAction({ type: "cancelRun" })} />
      )}

      {state === "waiting" && cullingWaitingForDesktop(session) && (
        <div className="mx-auto max-w-180 rounded-md border border-blue-100 bg-blue-50/50 px-3 py-2 text-xs leading-5 text-blue-900" role="status">
          The desktop app is analyzing this run on the computer that holds the originals. Open it there to follow progress
          {canWrite ? ", or let the server finish from the photos' previews." : "."}
          {canWrite && (
            <div className="mt-2 flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" onClick={handOver} disabled={busy}>Let the server finish</Button>
              <Button variant="secondary" size="sm" onClick={cancel} disabled={busy}>Cancel run</Button>
            </div>
          )}
        </div>
      )}

      {state === "running" && (
        <section aria-label="AI analysis" className="mx-auto max-w-180 rounded-xl border border-slate-200 bg-white p-5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">AI analysis</p>
          <div className="mt-3">
            <CullingStageList steps={cullingStageSteps(session, overview.engines)} percent={percent} processed={session.processedImages} total={session.totalImages} />
          </div>
          <p className="mt-3 text-[11px] text-slate-500">You can leave this tab; the run carries on and the review opens here when it is done.</p>
          {canWrite && <div className="mt-4"><Button variant="secondary" size="sm" onClick={cancel} busy={busy} busyLabel="Cancelling...">Cancel run</Button></div>}
        </section>
      )}

      {settled && (
        <div className="space-y-3">
          <CullingSummaryBar session={session} confidence={overview.confidence} finalized={state === "finalized"} canWrite={canWrite} busy={busy} onFinalize={() => setConfirmAction({ type: "finalize" })} onReopen={() => setConfirmAction({ type: "reopen" })} />
          {/* Every photo the run kept, sent on at once - to AI Editing or the album; Finalize is
              what sends the Keeps to Photo Selection. A ticked selection has its own bar below. */}
          <CullingKeepsActions projectId={projectId} session={session} canSendToEditing={canSendToEditing} canSendToAlbum={canSendToAlbum} canSyncEditsToAlbum={canSyncEditsToAlbum} disabled={busy} onNotice={reviewNotice} onOpenEditing={onOpenEditing} unlinkedNote={unlinkedNote} />
          {(overview.groupCounts?.duplicate > 0 || overview.groupCounts?.burst > 0 || cullingCoverageLine(overview.coverage)) && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600">
              {overview.groupCounts?.duplicate > 0 && <span className="rounded-full bg-amber-100 px-2 py-1 text-[10px] font-semibold text-amber-700">{overview.groupCounts.duplicate} duplicate group{overview.groupCounts.duplicate === 1 ? "" : "s"}</span>}
              {overview.groupCounts?.burst > 0 && <span className="rounded-full bg-sky-100 px-2 py-1 text-[10px] font-semibold text-sky-700">{overview.groupCounts.burst} burst group{overview.groupCounts.burst === 1 ? "" : "s"}</span>}
              {/* The story the Keeps tell, live: it follows every override. */}
              {cullingCoverageLine(overview.coverage) && <span>{cullingCoverageLine(overview.coverage)}</span>}
            </div>
          )}
          {cullingCoverageMissing(overview.coverage).length > 0 && (
            <p className="flex flex-wrap items-center gap-1 text-xs text-amber-800">
              No Keep yet in:
              {cullingCoverageMissing(overview.coverage).map((scene) => (
                <Button key={scene.id} variant="ghost" size="sm" className="text-amber-800 underline" onClick={() => setReviewScene(scene.id)}>{scene.label}</Button>
              ))}
            </p>
          )}
          {cullingNewPhotosNotice(overview.newPhotoCount, session.status) && (
            <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800" role="status">
              {cullingNewPhotosNotice(overview.newPhotoCount, session.status)}
            </p>
          )}
          <p className="text-xs text-slate-500">
            {state === "finalized"
              ? `Of the photos this run analyzed, only the ${session.keepCount} Keep photo${session.keepCount === 1 ? "" : "s"} went on - imported photos into AI Editing, and from there to Photo Selection; the rest are hidden (anything the client already selected always stays). Nothing is deleted; reopen to change decisions.`
              : session.mode === "ASSISTED"
                ? "Every photo is scored and grouped — in Assisted mode every decision is yours. Finalizing sends only the Keeps on to AI Editing; the rest are hidden."
                : "Review the AI's recommendations below, override anything, then finalize to send only the Keeps on to AI Editing; the rest are hidden."}
          </p>
        </div>
      )}

      {settled && (
        // Read-only once finalized: the backend refuses decisions anyway, so the gallery stops
        // offering them and stands as the record of what was decided.
        <CullingReviewGallery
          key={session.status}
          projectId={projectId}
          session={session}
          filterCounts={overview.filterCounts}
          scenes={overview.scenes || []}
          scene={reviewScene}
          onSceneChange={setReviewScene}
          canWrite={canWrite && session.status === "REVIEW_READY"}
          keysPaused={Boolean(confirmAction)}
          onCountsChange={applyCounts}
          onNotice={reviewNotice}
          canSendToEditing={canSendToEditing}
          canSendToAlbum={canSendToAlbum}
          onOpenEditing={onOpenEditing}
        />
      )}
      {settled && canWrite && overview.readyCount > 0 && (
        <div className="mt-6 border-t border-slate-200 pt-4">
          {newRunOpen
            ? <div className="max-w-180">{startControls}<Button variant="ghost" size="sm" className="mt-2" onClick={() => setNewRunOpen(false)}>Not now</Button></div>
            : <Button variant="ghost" size="sm" onClick={() => setNewRunOpen(true)}>Start a new run…</Button>}
        </div>
      )}
      {/* Personal and about future runs: below the review, the main task, and only once there are
          photos to cull. */}
      {state !== "empty" && state !== "uploading" && state !== "processing" && state !== "unprocessable" && (
        <CullingPreferencePanel projectId={projectId} canWrite={canWrite} scenes={overview.scenes || []} refreshKey={refreshKey} onNotice={reviewNotice} />
      )}
      {confirmAction?.type === "handOver" && (
        <ConfirmDialog
          title="Let the server finish now?"
          message={`${counts.ready} of ${counts.total} photos have landed. The ${Math.max(0, counts.total - counts.ready)} still arriving are left out of this run (they can be culled in a later run), and the server finishes from the photos' previews.`}
          confirmLabel="Let the server finish now"
          tone="primary"
          loading={busy}
          onClose={() => setConfirmAction(null)}
          onConfirm={async () => { setConfirmAction(null); await handOver(); }}
        />
      )}
      {confirmAction?.type === "cancelRun" && (
        <ConfirmDialog
          title="Stop culling?"
          message={`The culling run stops and what it analyzed so far (${overview.importing?.analyzed || 0} of ${counts.total} photos) is set aside; nothing is deleted, the desktop app's upload carries on, and a new run can be started once the photos have landed.`}
          confirmLabel="Stop culling"
          loading={busy}
          onClose={() => setConfirmAction(null)}
          onConfirm={async () => { setConfirmAction(null); await cancel(); }}
        />
      )}
      {confirmAction && !["handOver", "cancelRun"].includes(confirmAction.type) && (
        <ConfirmDialog
          title={confirmAction.type === "finalize" ? "Finalize culling?" : "Reopen culling?"}
          message={confirmAction.type === "finalize"
            ? cullingFinalizeMessage(session)
            : "Every photo this cull hid returns to the verdict of the newest other finalized run that covered it, or to Photo Selection when there is none, and decisions become editable again."}
          confirmLabel={confirmAction.details ? "Yes, continue" : confirmAction.type === "finalize" ? "Finalize Culling" : "Reopen Culling"}
          busyLabel={confirmAction.type === "finalize" ? "Finalizing…" : "Reopening…"}
          tone="primary"
          loading={busy}
          onCancel={() => setConfirmAction(null)}
          onConfirm={runConfirmedAction}
        >
          {confirmAction.type === "finalize" && !confirmAction.details && (
            <ul className="list-disc space-y-0.5 pl-5 text-xs leading-5 text-slate-600">
              {CULLING_FINALIZE_ASSURANCES.map((line) => <li key={line}>{line}</li>)}
            </ul>
          )}
          {confirmAction.details && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-800" role="alert">
              {confirmAction.details.undecidedCount > 0 && (
                <p>
                  {confirmAction.details.undecidedCount} photo{confirmAction.details.undecidedCount === 1 ? " is" : "s are"} not marked Keep or Reject yet
                  ({confirmAction.details.maybeCount} Maybe, {confirmAction.details.pendingCount} pending) — they will be hidden from
                  Photo Selection, not converted. Review them first, or continue.
                </p>
              )}
              {confirmAction.details.galleryPublished && (
                <p className={confirmAction.details.undecidedCount > 0 ? "mt-2" : ""}>
                  The client gallery is currently published — this changes which photos the client sees right now.
                </p>
              )}
            </div>
          )}
        </ConfirmDialog>
      )}
    </div>
  );
}
