"use client";

import ArrowBack from "@mui/icons-material/ArrowBack";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import Button from "@/components/shared/Button";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import Tabs from "@/components/ui/Tabs";
import {
  completeAlbumProof, createAlbumRevisedVersion, downloadFinalAlbum, getAlbumProof, markAlbumPagesUploaded, publishAlbumToClient,
  reopenAlbumProof, resubmitAlbumToQc, sendAlbumToQc, startAlbumRevision, startQcFixes,
} from "@/services/image-selection/album-proofs.service";
import Dialog from "@/components/ui/Dialog";
import { getUploadStoreServerSnapshot, getUploadStoreSnapshot, subscribeUploadCompletion, subscribeUploadStore, uploadSessionKey } from "@/lib/imageSelectionUploadStore";
import TextAreaField from "@/components/shared/TextAreaField";
import VersionSpreads from "./VersionSpreads";
import PublicationCard from "./PublicationCard";
import AlbumPagesPane from "./AlbumPagesPane";
import AlbumProofActivityFeed from "./AlbumProofActivityFeed";
import CorrectionsTab from "./CorrectionsTab";
import ProofingStatusChip from "./ProofingStatusChip";
import QcReviewPanel from "./QcReviewPanel";

/**
 * One album's workspace: breadcrumb, the state-driven action bar, and the Album / Corrections /
 * Versions / Activity tabs. Actions light up strictly by workflow state — and the backend
 * re-checks every one of them, so a button is a convenience, never the authority. Actions whose
 * phase has not landed yet render disabled with a note saying so.
 */
// The two correction rounds, which are the same four acts in the same order: resolve, upload,
// create the version, submit it. QC's round and the client's differ only in whose corrections gate
// them, and the server decides that from the status rather than from anything sent here.
const REVISING = ["QC_REVISION_IN_PROGRESS", "REVISION_IN_PROGRESS"];

export default function AlbumProofWorkspace({ albumId, canWrite, qcCanWrite, onBack, onReviewContext }) {
  const [album, setAlbum] = useState(null);
  const [tab, setTab] = useState("album");
  const [notice, setNotice] = useState("");
  const [confirmingQc, setConfirmingQc] = useState(false);
  const [confirmingResubmit, setConfirmingResubmit] = useState(false);
  const [confirmingPublish, setConfirmingPublish] = useState(false);
  const [publishedCredentials, setPublishedCredentials] = useState(null);
  const [reopening, setReopening] = useState(false);
  const [reopenReason, setReopenReason] = useState("");
  const [downloadResult, setDownloadResult] = useState(null);
  const [qcOpen, setQcOpen] = useState(false);
  // A frozen version opened from the Versions tab, to look at and nothing more.
  const [historyVersion, setHistoryVersion] = useState(null);
  const [busy, setBusy] = useState(false);
  /*
   * Upload Revised Version has been pressed and the corrected spreads are on their way.
   *
   * Intent, never authority: it decides whether this upload landing should go on to create the
   * version, and the server applies the real gate again regardless — so a correction reopened
   * while the files were going up still stops it. The upload subscription below lists this, so the
   * callback that hears the batch land is always the one that knows the current answer.
   */
  const [awaitingRevisedUpload, setAwaitingRevisedUpload] = useState(false);
  /*
   * The batch that was already sitting in the dock when the button was pressed, if any.
   *
   * A session that finished earlier is still in the store, and "a finished upload exists" would
   * be true the instant the reader asked to upload — which would freeze a version out of the
   * spreads already in the album, before a single corrected one had arrived. The next batch has a
   * different id, so this is what tells the new upload from the old one.
   */
  const [ignoreBatchId, setIgnoreBatchId] = useState(null);
  const creatingVersion = useRef(false);

  const load = useCallback(async () => {
    try {
      const response = await getAlbumProof(albumId);
      setAlbum(response.data);
      setNotice("");
    } catch (error) {
      setNotice(error.message || "Unable to load the album.");
    }
  }, [albumId]);

  useEffect(() => {
    const timer = window.setTimeout(() => { load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  // Pages arrive through the shared upload dock, which finishes a batch on its own timetable —
  // after the Import dialog is closed, even from another tab of this workspace. Listening here
  // rather than inside the dialog is what lets a finished batch always reach the album.
  const projectId = album?.projectId;
  const rootFolderId = album?.rootFolderId;
  useEffect(() => {
    if (!projectId || !rootFolderId) return undefined;
    return subscribeUploadCompletion(async (detail) => {
      if (detail.projectId !== projectId || (detail.folderId || null) !== rootFolderId) return;
      try { await markAlbumPagesUploaded(albumId, { folderId: rootFolderId }); }
      catch (error) { setNotice(error.message || "The pages arrived, but the album could not be moved on."); }
      await load();
    });
  }, [albumId, load, projectId, rootFolderId]);

  /*
   * Whether the corrected spreads have landed — read from the upload store, not received from it.
   *
   * The store also emits a one-shot completion event, and hanging the version on that is what made
   * this hang: it fires once per batch, only to whoever is subscribed at that instant, and is
   * never replayed. Re-subscribing, remounting or simply navigating away and back missed it, and
   * the button then said "Waiting for the upload..." for ever with no way out. A snapshot can be
   * read again at any moment, so arriving late at the answer is the same as arriving on time.
   */
  const uploads = useSyncExternalStore(subscribeUploadStore, getUploadStoreSnapshot, getUploadStoreServerSnapshot);
  const sessionKey = projectId && rootFolderId ? uploadSessionKey(projectId, rootFolderId) : null;
  const revisedBatch = uploads.sessions.find((session) => session.key === sessionKey && session.batchId !== ignoreBatchId) || null;
  /*
   * `finished` is the server's word for it, carried on the progress stream. A batch of fourteen
   * photos that the browser has already prepared settles in about two seconds, which that stream
   * can lose the end of — and then the album waited on a message that was never coming again.
   *
   * So the browser's own work counts too: every file posted, none left pending, none failed. That
   * is knowable here without asking anyone. `seenTransferring` is what stops it counting the
   * moment before the first file is queued, when nothing is pending because nothing has started.
   */
  const [seenTransferring, setSeenTransferring] = useState(null);
  useEffect(() => {
    if (revisedBatch?.transferring) setSeenTransferring(revisedBatch.batchId);
  }, [revisedBatch?.transferring, revisedBatch?.batchId]);
  const postedEverything = Boolean(revisedBatch
    && seenTransferring === revisedBatch.batchId
    && !revisedBatch.transferring
    && revisedBatch.pendingLocalFiles === 0
    && revisedBatch.failedLocalFiles === 0);
  const revisedUploadLanded = Boolean(revisedBatch && (revisedBatch.finished || postedEverything));

  useEffect(() => {
    if (!awaitingRevisedUpload || !revisedUploadLanded || creatingVersion.current) return;
    creatingVersion.current = true;
    (async () => {
      try {
        await createAlbumRevisedVersion(albumId);
        setAwaitingRevisedUpload(false);
        setNotice("");
      } catch (error) {
        // The spreads are in the album either way; only the freeze failed. Say why and leave the
        // dock open, so it can be tried again rather than leaving the reader with a dead button.
        setNotice(error.message || "The spreads uploaded, but the revised version could not be created.");
      } finally {
        creatingVersion.current = false;
        await load();
      }
    })();
  }, [albumId, awaitingRevisedUpload, load, revisedUploadLanded]);

  async function handleSendToQc() {
    setBusy(true);
    try {
      await sendAlbumToQc(album.id);
      setConfirmingQc(false);
      setNotice("");
      await load();
    } catch (error) {
      setNotice(error.message || "Unable to send the album to QC.");
      setConfirmingQc(false);
    } finally {
      setBusy(false);
    }
  }

  /*
   * Upload Revised Version opens the album's own dock rather than calling anything: this step IS
   * the upload, and the version is created by its landing, in the subscription above. Marking the
   * intent and moving to the tab is the whole of it.
   */
  function startRevisedUpload() {
    // Anything already finished in the dock belongs to an earlier upload, not to this one.
    setIgnoreBatchId(uploads.sessions.find((session) => session.key === sessionKey)?.batchId ?? null);
    setAwaitingRevisedUpload(true);
    setTab("album");
    setNotice("");
  }

  async function runAction(action) {
    setBusy(true);
    try {
      await action();
      setNotice("");
      await load();
    } catch (error) {
      setNotice(error.message || "Unable to complete the action.");
    } finally {
      setBusy(false);
    }
  }

  if (!album) return <div className="p-6 text-center text-xs text-slate-500">{notice || "Loading album..."}</div>;

  /*
   * The Versions tab is where a round is looked at; the Corrections tab is where one is worked.
   * Both open the same panel, and this entry passes `historyOnly`, which turns every control that
   * could change something off at the one gate they all read. No reload on the way out: looking
   * changed nothing, so there is nothing to pick up.
   */
  if (historyVersion) return <QcReviewPanel album={album} qcCanWrite={false} versionId={historyVersion.id} historyOnly onBack={() => setHistoryVersion(null)} />;
  if (qcOpen) return <QcReviewPanel album={album} qcCanWrite={qcCanWrite && album.status === "QC_REVIEW"} onReviewContext={onReviewContext} onBack={() => { setQcOpen(false); load(); }} onDecided={() => { setQcOpen(false); load(); }} />;

  // What each state offers, per the workflow. `phase` marks actions whose implementation phase
  // has not landed yet; they render disabled with the honest note. Everything the backend also
  // enforces — a button here is a convenience, never the authority.
  const actions = [];
  /*
   * Whether the corrected spreads may be uploaded yet — decided by the server and only read here,
   * so the button and the endpoint cannot hold two different opinions of the same rule.
   *
   * It carries the reason as well as the answer, so a locked step says what is holding it up
   * rather than sitting greyed out. The count behind it is the *album's*: a correction reopened on
   * an earlier version is still outstanding, and counted per version it would lock nothing.
   */
  const revisedUpload = album.revisedUpload || { unlocked: false, reason: "" };
  if (canWrite) {
    if (album.status === "READY_FOR_QC") actions.push({ label: "Send to QC Lead", primary: true, onClick: () => setConfirmingQc(true) });
    // "Start Fix Round", not "Start Fixes": this opens the round for the whole album, and every
    // correction row on the Corrections tab carries its own Start Fixes for the one correction it
    // belongs to. Both are offered in this state, so two different acts under one label meant the
    // reader could not tell which of them they were about to take.
    if (album.status === "QC_CHANGES_REQUESTED") actions.push({ label: "Start Fix Round", primary: true, onClick: () => runAction(() => startQcFixes(album.id)) });
    // Only once every QC correction is resolved: resolving is one action, freezing the next version
    // is another, and offering the second while the first is outstanding is what made this a button
    // that failed. A reopened correction puts it back out of reach at once.
    /*
     * Resolving every correction unlocks the **upload**, and that is all it does.
     *
     * The corrected spreads go up through the album's own dock, and their landing is what creates
     * the next version — which is why this button opens the Album tab rather than calling anything.
     * A reopened correction takes it out of reach again at once, here and on the server. Both
     * rounds work this way: QC's and the client's are the same four acts in the same order.
     */
    if (REVISING.includes(album.status)) {
      actions.push({
        label: awaitingRevisedUpload ? (revisedBatch?.transferring ? "Uploading..." : "Waiting for the spreads...") : "Upload Revised Version",
        primary: true,
        disabled: !revisedUpload.unlocked || awaitingRevisedUpload,
        note: revisedUpload.unlocked ? undefined : revisedUpload.reason,
        onClick: startRevisedUpload,
      });
    }
    // The version exists; sending it is its own act, and the only one offered now.
    if (album.status === "REVISION_READY_FOR_QC") actions.push({ label: "Resubmit to QC", primary: true, onClick: () => setConfirmingResubmit(true) });
    if (["QC_APPROVED", "READY_FOR_CLIENT"].includes(album.status)) actions.push({ label: "Send to Client", primary: true, onClick: () => setConfirmingPublish(true) });
    if (album.status === "CLIENT_CHANGES_REQUESTED") actions.push({ label: "Create Revision", primary: true, onClick: () => runAction(() => startAlbumRevision(album.id)) });
    // The client's round, gated the same way and on its own count.
    if (album.status === "CLIENT_APPROVED") actions.push({ label: "Complete Album", primary: true, onClick: () => runAction(() => completeAlbumProof(album.id)) });
    if (["CLIENT_APPROVED", "COMPLETED"].includes(album.status)) {
      actions.push({ label: "Download Final Album", primary: album.status === "COMPLETED", onClick: () => runAction(async () => { const response = await downloadFinalAlbum(album.id); setDownloadResult(response.data); }) });
      actions.push({ label: "Reopen Album", onClick: () => { setReopenReason(""); setReopening(true); } });
    }
  }
  /*
   * Reviewing is its own doorway: QC rules in it, and anyone with read access may look.
   *
   * The door used to be offered only while the album sat in QC review, or to somebody holding the
   * QC grant — which is not what "anyone may look" means, and left the designer working the fixes
   * unable to open the very proof the corrections are pinned to. They hold `Album Proofing`, the
   * album is `QC_CHANGES_REQUESTED`, and both tests failed, so the one screen showing a correction
   * *where it is* was shut to the person it was addressed to. The version and its corrections are
   * `READ_ANY` on the server, so the data was theirs to read the whole time; only the button was
   * missing. A version exists, so there is something to look at — that is the whole condition.
   */
  const ruling = album.status === "QC_REVIEW" && qcCanWrite;
  if (album.currentVersionId) actions.unshift({ label: ruling ? "Open QC Review" : "View Proof", primary: ruling, onClick: () => setQcOpen(true) });
  const PHASE_NOTES = {};

  return <div className="flex min-h-0 flex-1 flex-col">
    <div className="shrink-0 border-b border-slate-200 px-4 py-3 md:px-6">
      <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-xs text-slate-500">
        <button type="button" onClick={onBack} className="inline-flex items-center gap-1 font-medium text-blue-600 hover:underline"><ArrowBack style={{ fontSize: 14 }} />Albums</button>
        <span aria-hidden="true">/</span><span className="truncate">{album.clientName}</span>
        <span aria-hidden="true">/</span><span className="truncate font-medium text-slate-700">{album.name}</span>
      </nav>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <h1 className="truncate text-lg font-semibold tracking-tight text-slate-900">{album.name}</h1>
          <ProofingStatusChip status={album.archivedAt ? "ARCHIVED" : album.status} />
          {album.currentVersionNumber && <span className="text-xs text-slate-500">V{album.currentVersionNumber}</span>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* `disabled` is a step the album is not ready for yet and `note` says why, the way
              `phase` says an implementation has not landed - both reach the reader as the title.
              `busy` is the third and is not one of those: the action is one this album *can* take
              and somebody has taken it, so the button says it is working rather than only going
              dead - which is what tells a second press apart from a first that did nothing. */}
          {actions.map((action) => <Button key={action.label} type="button" variant={action.primary ? "primary" : "secondary"} size="sm" busy={busy} disabled={Boolean(action.phase) || Boolean(action.disabled)} title={action.note || PHASE_NOTES[action.phase]} onClick={action.onClick}>{action.label}</Button>)}
        </div>
      </div>
      <div className="mt-3">
        <Tabs ariaLabel="Album sections" size="sm" value={tab} onChange={setTab} tabs={[
          { id: "album", label: "Album" },
          { id: "corrections", label: "Corrections", count: album.corrections?.total || undefined },
          { id: "versions", label: "Versions", count: album.versions?.length || undefined },
          { id: "activity", label: "Activity" },
        ]} />
      </div>
    </div>

    {notice && <p role="alert" className="mx-4 mt-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700 md:mx-6">{notice}</p>}
    <div className="shrink-0 px-4 pt-3 md:px-6"><PublicationCard album={album} canWrite={canWrite} freshCredentials={publishedCredentials} onChanged={load} /></div>

    <div className="flex min-h-0 flex-1 flex-col md:flex-row">
      {/* One child, never two: this row is `md:flex-row`, so a sibling beside the pane becomes a
          second column half the width of the tab. The note that says where to upload lives inside
          the pane, directly above the dock it is talking about. */}
      {tab === "album" && <AlbumPagesPane
        key={`${album.id}-${album.status}`}
        album={album}
        canWrite={canWrite && !album.archivedAt}
        onAlbumChanged={load}
        revisedUploadOpen={awaitingRevisedUpload}
        onCancelRevisedUpload={() => setAwaitingRevisedUpload(false)}
      />}
      {tab === "corrections" && <CorrectionsTab album={album} canWrite={canWrite && !album.archivedAt} qcCanWrite={qcCanWrite} onChanged={load} />}
      {tab === "versions" && <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
        {(album.versions || []).length === 0
          ? <p className="py-10 text-center text-xs text-slate-500">No versions yet. V1 is created when the album is first sent to QC.</p>
          : <ol className="space-y-2.5">
              {album.versions.map((version) => <li key={version.id} className={`rounded-lg border p-3 ${version.id === album.currentVersionId ? "border-blue-300 bg-blue-50/40" : "border-slate-200 bg-white"}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-slate-800">V{version.versionNumber}{version.approved && <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">Final Approved</span>}</span>
                  <span className="text-[11px] text-slate-500">{version.pageCount} page{version.pageCount === 1 ? "" : "s"} · {version.frozenAt ? `Frozen ${new Date(version.frozenAt).toLocaleDateString()}` : "Draft"}</span>
                </div>
                {version.changeSummary && <p className="mt-1.5 text-xs text-slate-600">{version.changeSummary}</p>}
                {/*
                  * The spreads this version was sent with, on request.
                  *
                  * Every version froze its own copies of every page, so an earlier one can still be
                  * looked at exactly as it went to QC - which is the whole point of freezing them.
                  * The list said how many pages a version held and gave no way to see them; this
                  * opens that version's own snapshot, never the album's live pages.
                  */}
                <VersionSpreads version={version} onOpen={setHistoryVersion} />
              </li>)}
            </ol>}
      </div>}
      {tab === "activity" && <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6"><AlbumProofActivityFeed albumId={album.id} /></div>}
    </div>

    {reopening && <Dialog
      title="Reopen Approved Album"
      description="Reopening never edits an approved version silently: the album goes back into revision, the approval stays in history, and your reason is recorded."
      busy={busy}
      onClose={() => setReopening(false)}
      onSubmit={(event) => { event.preventDefault(); setReopening(false); runAction(() => reopenAlbumProof(album.id, reopenReason.trim())); }}
      footer={<>
        <Button type="button" className="max-sm:flex-1" onClick={() => setReopening(false)} disabled={busy}>Cancel</Button>
        <Button type="submit" variant="danger" className="max-sm:flex-1" disabled={busy || reopenReason.trim().length < 3}>Reopen Album</Button>
      </>}
    >
      <TextAreaField label="Reason for reopening" required autoFocus placeholder='e.g. "Client called: one name is misspelled on spread 12."' value={reopenReason} maxLength={1000} onChange={(event) => setReopenReason(event.target.value)} />
    </Dialog>}
    {downloadResult && <Dialog
      title="✓ Final Originals Copied"
      onClose={() => setDownloadResult(null)}
      footer={<Button type="button" variant="primary" className="max-sm:flex-1" onClick={() => setDownloadResult(null)}>Done</Button>}
    >
      <p className="text-sm text-slate-700">{downloadResult.copied} / {downloadResult.total} original JPEGs of V{downloadResult.versionNumber} copied to:</p>
      <p className="mt-2 break-all rounded bg-slate-50 px-3 py-2 font-mono text-xs text-slate-700">{downloadResult.outputPath}</p>
      <p className="mt-2 text-[11px] text-slate-500">Copied from their original locations on your drive/NAS — proof previews were never used.</p>
    </Dialog>}
    {confirmingPublish && <ConfirmDialog
      title="Send to Client?"
      message={`V${album.currentVersionNumber} goes out behind a fresh secure link and 6-digit PIN, expiring in ${album.proofExpiryDays} day${album.proofExpiryDays === 1 ? "" : "s"}. Any earlier client link is revoked.`}
      confirmLabel="Publish to Client"
      busyLabel="Publishing..."
      tone="primary"
      loading={busy}
      onCancel={() => setConfirmingPublish(false)}
      onConfirm={() => { setConfirmingPublish(false); runAction(async () => { const response = await publishAlbumToClient(album.id); setPublishedCredentials(response.data); }); }}
    />}
    {confirmingResubmit && <ConfirmDialog
      title="Resubmit to QC?"
      message="Fixed spreads get fresh proofs and QC reviews the changed spreads by default. Every QC correction must already be resolved."
      confirmLabel="Resubmit to QC"
      busyLabel="Resubmitting..."
      tone="primary"
      loading={busy}
      onCancel={() => setConfirmingResubmit(false)}
      onConfirm={() => { setConfirmingResubmit(false); runAction(() => resubmitAlbumToQc(album.id, "CHANGED_ONLY")); }}
    />}
    {confirmingQc && <ConfirmDialog
      title={album.status === "REVISION_READY_FOR_QC" ? "Resubmit to QC?" : "Send to QC Lead?"}
      message={`This freezes ${album.currentVersionNumber ? `V${album.currentVersionNumber + 1}` : "V1"} as an immutable version — its pages and proofs can no longer change — and hands it to QC for review.`}
      confirmLabel={album.status === "REVISION_READY_FOR_QC" ? "Resubmit to QC" : "Send to QC"}
      busyLabel="Freezing version..."
      tone="primary"
      loading={busy}
      onCancel={() => setConfirmingQc(false)}
      onConfirm={handleSendToQc}
    />}
  </div>;
}
