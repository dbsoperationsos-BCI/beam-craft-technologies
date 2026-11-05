"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import FitScreenRounded from "@mui/icons-material/FitScreenRounded";
import ZoomInRounded from "@mui/icons-material/ZoomInRounded";
import ZoomOutRounded from "@mui/icons-material/ZoomOutRounded";
import AppLogo from "@/components/shared/AppLogo";
import Button from "@/components/shared/Button";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import Dialog from "@/components/ui/Dialog";
import {
  addProofCorrection, approveProofAlbum, deleteProofCorrection, editProofCorrection,
  getProof, submitProofCorrections,
} from "@/services/image-selection/album-proof-client.service";
import { hasSeenEvery, seenCount, spreadReviewKey, unseenSpreads } from "@/lib/spreadReview.mjs";
import { DEFAULT_PAINT_COLOR, sanitizeStrokes, strokesCenter } from "@/lib/proofPaint.mjs";
import ProofCommentComposer from "../ProofCommentComposer";
import ProofCommentList from "../ProofCommentList";
import ProofSpreadNav from "../ProofSpreadNav";
import ProofToolbar from "../ProofToolbar";
import ProofSpreadCanvas from "../ProofSpreadCanvas";
import useSeenSpreads from "../useSeenSpreads";
import { PROOF_GLASS, PROOF_GLASS_ITEM } from "../proofGlass";

/**
 * The client's proofing room: one spread at a time (buttons, arrow keys, swipe), zoom, their own
 * correction pins — editable and removable until the round is sent — the per-spread summary, and
 * the one dynamic primary action: Send Corrections while any exist, Approve & Submit Album at
 * zero. No admin or QC control ever appears here.
 */
export default function ClientProofViewer({ token, sessionToken, meta }) {
  const [proof, setProof] = useState(null);
  const [index, setIndex] = useState(0);
  const [composer, setComposer] = useState(null); // { pin: {x,y} } new, or { correction } editing
  // How this client is marking the spread, and what they have painted on it but not yet sent.
  const [tool, setTool] = useState("circle");
  const [penColor, setPenColor] = useState(DEFAULT_PAINT_COLOR);
  const [strokes, setStrokes] = useState([]);
  const [comment, setComment] = useState("");
  const [activePinId, setActivePinId] = useState(null);
  // The corrections rail is opened from the toolbar's message button rather than standing there by
  // default: most of a review is looking at the spread, and a 320px column of words beside it is
  // worth the room only while the words are what is being read.
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [confirming, setConfirming] = useState(null); // "send" | "approve"
  const [approveChecked, setApproveChecked] = useState(false);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const touchStartX = useRef(null);
  // Zoom magnifies the photo alone — never the page around it. 1 = fit the pane; above that the
  // pane scrolls/pans. Pins ride along automatically because they are placed in percentages.
  const [zoom, setZoom] = useState(1);
  const zoomRef = useRef(1);
  const viewerRef = useRef(null);
  const pinchRef = useRef(null); // { distance, zoom } at the moment two fingers touched
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);
  const clampZoom = (value) => Math.min(4, Math.max(1, value));

  // Pinch and ctrl/trackpad-wheel must call preventDefault so the browser does not zoom the whole
  // page — React's root-level touch/wheel listeners are passive, so these attach natively.
  // The viewer node only exists once the proof has loaded, hence the dependency.
  const proofLoaded = Boolean(proof);
  useEffect(() => {
    const node = viewerRef.current;
    if (!node) return undefined;
    const distance = (touches) => Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);
    function onWheel(event) {
      if (!event.ctrlKey) return;
      event.preventDefault();
      setZoom((current) => clampZoom(current * (event.deltaY < 0 ? 1.1 : 1 / 1.1)));
    }
    function onTouchStart(event) {
      if (event.touches.length === 2) pinchRef.current = { distance: distance(event.touches), zoom: zoomRef.current };
    }
    function onTouchMove(event) {
      if (event.touches.length !== 2 || !pinchRef.current) return;
      event.preventDefault();
      setZoom(clampZoom(pinchRef.current.zoom * (distance(event.touches) / pinchRef.current.distance)));
    }
    function onTouchEnd(event) {
      if (event.touches.length < 2) pinchRef.current = null;
    }
    node.addEventListener("wheel", onWheel, { passive: false });
    node.addEventListener("touchstart", onTouchStart, { passive: true });
    node.addEventListener("touchmove", onTouchMove, { passive: false });
    node.addEventListener("touchend", onTouchEnd, { passive: true });
    node.addEventListener("touchcancel", onTouchEnd, { passive: true });
    return () => {
      node.removeEventListener("wheel", onWheel);
      node.removeEventListener("touchstart", onTouchStart);
      node.removeEventListener("touchmove", onTouchMove);
      node.removeEventListener("touchend", onTouchEnd);
      node.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [proofLoaded]);

  const load = useCallback(async () => {
    try {
      const response = await getProof(token, sessionToken);
      setProof(response.data);
      setNotice("");
    } catch (error) {
      setNotice(error.message || "Unable to load the proof.");
    }
  }, [token, sessionToken]);

  useEffect(() => {
    const timer = window.setTimeout(() => { load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const pages = proof?.pages || [];
  const page = pages[index] || null;
  const corrections = proof?.corrections || [];
  const pageCorrections = useMemo(() => corrections.filter((correction) => correction.versionPageId === page?.id), [corrections, page]);
  const bySpread = useMemo(() => {
    const map = new Map();
    for (const correction of corrections) map.set(correction.pageNumber, (map.get(correction.pageNumber) || 0) + 1);
    return [...map.entries()].sort((a, b) => a[0] - b[0]);
  }, [corrections]);
  const locked = proof?.locked;
  // Either answer ends this client's pass over the version — approving it, or sending it back — so
  // both wait until every spread has been looked at. Corrections sent halfway through become a
  // second round for the half nobody had opened yet, which is the round this one was meant to be.
  const pageIds = useMemo(() => pages.map((candidate) => candidate.id), [pages]);
  const seen = useSeenSpreads(spreadReviewKey(token, proof?.versionNumber), page?.id);
  const reviewed = seenCount(pageIds, seen);
  const leftToSee = unseenSpreads(pageIds, seen).length;
  const reviewedEverything = hasSeenEvery(pageIds, seen);

  // One correction as the canvas draws it. A pin already sent to the studio is theirs now: it
  // still opens and reads, but it carries no Edit or Remove.
  function pinOf(correction, number) {
    const editable = !locked && !correction.locked;
    return {
      id: correction.id, x: correction.x, y: correction.y, radius: correction.radius, path: correction.path,
      number: number + 1, status: correction.locked ? "RESOLVED" : "OPEN", source: "CLIENT",
      author: "You", createdAt: correction.createdAt, comment: correction.comment,
      actions: editable ? [
        { label: "Edit", disabled: busy, onSelect: () => { editCorrection(correction); } },
        { label: "Remove", disabled: busy, onSelect: () => removeCorrection(correction) },
      ] : [],
    };
  }

  // This spread's corrections as the panel lists them, with Edit and Remove while they are still
  // this client's to change.
  const listedComments = useMemo(() => pageCorrections
    .map((correction) => ({
      id: correction.id,
      author: "You",
      createdAt: correction.createdAt,
      comment: correction.comment,
      status: correction.locked ? "RESOLVED" : "DEFAULT",
      badge: correction.locked ? <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">Sent</span> : null,
      actions: !locked && !correction.locked ? [
        { label: "Edit", disabled: busy, onSelect: () => { editCorrection(correction); } },
        { label: "Remove", tone: "danger", disabled: busy, onSelect: () => removeCorrection(correction) },
      ] : [],
    })), [pageCorrections, busy, locked]); // eslint-disable-line react-hooks/exhaustive-deps

  /*
   * Turning the page drops the composer and everything it held - the strokes and the words as
   * well as the card. It used to drop the card alone, so a stroke painted on one spread was still
   * in hand on the next: the first stroke there reopened the composer over both drawings, with the
   * old comment already typed, and Save filed the lot against the new spread.
   */
  const go = useCallback((delta) => {
    setComposer(null); setComment(""); setStrokes([]); setActivePinId(null);
    setIndex((current) => Math.min(pages.length - 1, Math.max(0, current + delta)));
  }, [pages.length]);

  useEffect(() => {
    function onKey(event) {
      // Not while a comment is being written or a dialog is up: the arrow keys move the caret in
      // the composer, and with the composer open they used to turn the page underneath it and
      // throw the half-typed comment away. Same rule as the QC room.
      if (composer || summaryOpen || confirming || result) return;
      if (event.key === "ArrowRight") go(1);
      if (event.key === "ArrowLeft") go(-1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, composer, summaryOpen, confirming, result]);

  /** Opening a correction for editing brings its drawing back with its words. */
  function editCorrection(correction) {
    setComposer({ correction });
    setComment(correction.comment);
    setStrokes(correction.path || []);
  }

  /** Leaving the composer drops everything it was holding, drawing included. */
  function closeComposer() {
    setComposer(null);
    setComment("");
    setStrokes([]);
  }

  /**
   * A finished stroke joins the drawing, and the first one opens the composer against it — paint,
   * then say what you mean, with no gesture in between. Further strokes keep going onto the same
   * correction while it is open.
   */
  function addStroke(stroke) {
    setStrokes((current) => {
      const next = sanitizeStrokes([...current, stroke]);
      setComposer((open) => open || { area: strokesCenter(next) || { x: 0.5, y: 0.5, radius: null } });
      return next;
    });
  }

  /** Undo takes back the last stroke; taking back the last of them closes the composer with it. */
  function undoStroke() {
    setStrokes((current) => {
      const next = current.slice(0, -1);
      if (!next.length && !composer?.correction) { setComposer(null); setComment(""); }
      return next;
    });
  }

  async function saveCorrection() {
    setBusy(true);
    try {
      const path = sanitizeStrokes(strokes);
      // A painted correction sits at the middle of what was drawn; a pinned or circled one at the
      // spot that was marked. Either way the record keeps one point, which the pin and the card read.
      const at = path.length ? strokesCenter(path) : null;
      if (composer.correction) await editProofCorrection(token, sessionToken, composer.correction.id, { comment: comment.trim(), path, ...(at || {}) });
      else await addProofCorrection(token, sessionToken, { versionPageId: page.id, x: at?.x ?? composer.area.x, y: at?.y ?? composer.area.y, radius: at ? null : composer.area.radius ?? null, path, comment: comment.trim() });
      closeComposer();
      await load();
    } catch (error) {
      setNotice(error.message || "Unable to save your correction.");
    } finally {
      setBusy(false);
    }
  }
  async function removeCorrection(correction) {
    setBusy(true);
    try { await deleteProofCorrection(token, sessionToken, correction.id); setActivePinId(null); await load(); }
    catch (error) { setNotice(error.message || "Unable to remove the correction."); }
    finally { setBusy(false); }
  }
  async function sendCorrections() {
    setBusy(true);
    try {
      const response = await submitProofCorrections(token, sessionToken);
      setConfirming(null);
      setResult({ kind: "sent", ...response.data });
      await load();
    } catch (error) {
      setNotice(error.message || "Unable to submit your corrections.");
      setConfirming(null);
    } finally { setBusy(false); }
  }
  async function approveAlbum() {
    setBusy(true);
    try {
      const response = await approveProofAlbum(token, sessionToken, "I have reviewed the complete album and approve it for final processing.");
      setConfirming(null);
      setResult({ kind: "approved", ...response.data });
      await load();
    } catch (error) {
      setNotice(error.message || "Unable to approve the album.");
      setConfirming(null);
    } finally { setBusy(false); }
  }

  if (!proof) return <main className="flex min-h-dvh items-center justify-center bg-slate-50 p-6"><p className="text-sm text-slate-500">{notice || "Loading your album..."}</p></main>;

  return <main className="flex h-dvh overflow-hidden bg-slate-50 text-slate-900 md:flex-row">
    <aside className="flex shrink-0 flex-col border-b border-slate-200 bg-white md:w-[270px] md:border-b-0 md:border-r">
      {/* The studio's own mark, not its name typed into this file: the Global Logo from Settings,
          the bundled mark where none is set or a configured one fails to load. `AppLogo` reads the
          public branding endpoint, so it answers on this tokenised page as it does behind the
          login. `albumProof` is this sidebar's own box — the head of the column is the mark's
          alone here, so it is given more room than the selection gallery's, where the sidebar is
          mostly folder tree. Centred rather than ranged left: a mark is a badge here, not a heading,
          and a round or narrow one left against the edge of a 270px column reads as a stray
          graphic — while a wide wordmark fills the box and centring costs it nothing. */}
      <div className="flex items-center justify-center border-b border-slate-100 px-6 py-5">
        <AppLogo variant="albumProof" />
      </div>
      <div className="space-y-6 px-5 py-6">
        <section><p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Published version</p><div className="mt-3 rounded-lg border border-blue-100 bg-blue-50 px-3 py-3"><div className="flex items-center justify-between gap-2"><span className="font-semibold text-blue-700">Version V{proof.versionNumber}</span><span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold text-blue-700">Current</span></div><p className="mt-1 text-[11px] text-slate-600">{proof.statusLabel}</p></div></section>
        <section><p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Review progress</p><div className="mt-3 rounded-lg border border-slate-200 p-3"><div className="flex items-center justify-between text-xs text-slate-600"><span>Spreads reviewed</span><span className="font-semibold text-slate-900">{reviewed} / {pages.length}</span></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-blue-600 transition-[width]" style={{ width: `${pages.length ? (reviewed / pages.length) * 100 : 0}%` }} /></div><p className="mt-3 text-xs text-slate-600"><span className="font-semibold text-slate-900">{corrections.length}</span> correction{corrections.length === 1 ? "" : "s"} added</p></div></section>
      </div>
    </aside>
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
    <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-5 py-4 md:px-9">
      <div className="min-w-0">
        <p className="truncate font-serif text-3xl leading-none tracking-tight text-slate-950 md:text-4xl">{proof.albumName}</p>
        <p className="text-[10px] text-slate-400">{proof.clientName} · Version V{proof.versionNumber} · Revision {proof.revision.number}{proof.revision.limit != null ? ` of ${proof.revision.limit}` : ""}</p>
      </div>
      <div className="flex items-center gap-2 text-xs text-slate-600">
        <p className="tabular-nums font-semibold">Spread {pages.length ? index + 1 : 0} / {pages.length}</p>
      </div>
    </header>

    {locked && <p className="mx-4 my-1 rounded-md bg-blue-50 px-3 py-1.5 text-center text-[11px] text-blue-700">
      {proof.approved ? "Thank you — your album is approved. The studio is finalizing it." : proof.submitted ? `Your ${proof.submitted.count} correction${proof.submitted.count === 1 ? "" : "s"} are with the studio. ${proof.statusLabel}.` : proof.statusLabel}
    </p>}
    {notice && <p role="alert" className="mx-4 my-1 rounded-md bg-rose-50 px-3 py-1.5 text-center text-[11px] text-rose-700">{notice}</p>}

    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={viewerRef}
        className={`flex min-h-0 flex-1 bg-slate-100 ${zoom > 1 ? "overflow-auto" : "overflow-hidden"}`}
        onTouchStart={(event) => { if (event.touches.length === 1) touchStartX.current = event.touches[0].clientX; }}
        onTouchEnd={(event) => {
          if (touchStartX.current == null) return;
          const delta = event.changedTouches[0].clientX - touchStartX.current;
          touchStartX.current = null;
          // Swiping turns the spread only at fit — while zoomed in, a drag pans the photo.
          if (Math.abs(delta) > 60 && !composer && zoomRef.current === 1) go(delta < 0 ? 1 : -1);
        }}
      >
        {/* The zoomed box: only this scales — the sidebars, header and footer never move. */}
        <div className="m-auto" style={{ width: `${zoom * 100}%`, height: `${zoom * 100}%` }}>
          {page && <ProofSpreadCanvas
            imageUrl={page.previewUrl}
            alt={`Spread ${page.pageNumber}`}
            pins={pageCorrections.map((correction, number) => pinOf(correction, number))}
            activePinId={activePinId}
            pendingArea={composer?.area?.radius ? composer.area : null}
            pendingPin={composer?.area && !composer.area.radius ? composer.area : null}
            // The comment is written against the mark itself, beside the pin just dropped or the
            // correction being edited — never in a dialog over the photograph being described.
            composerAnchor={composer?.correction ? { x: composer.correction.x, y: composer.correction.y } : null}
            composer={composer && <ProofCommentComposer
              value={comment}
              onChange={setComment}
              onSubmit={saveCorrection}
              onCancel={closeComposer}
              busy={busy}
              editing={Boolean(composer.correction)}
            />}
            onSelectPin={setActivePinId}
            // Two ways to mark a correction, and both say how much of the spread they mean:
            // dragging circles the area that needs work, and the pen traces it.
            onImageCircleDraw={!locked ? (area) => { setComposer({ area }); setComment(""); setStrokes([]); } : undefined}
            tool={locked ? "none" : tool}
            penColor={penColor}
            pendingStrokes={strokes}
            onPaintStroke={!locked ? addStroke : undefined}
            className="flex h-full w-full items-center justify-center"
            imageClassName="h-full w-full rounded-none object-contain"
          />}
        </div>
      </div>
      {page && <ProofToolbar
        canMark={!locked}
        tool={tool}
        onToolChange={setTool}
        penColor={penColor}
        onPenColorChange={setPenColor}
        onUndo={undoStroke}
        canUndo={strokes.length > 0}
        commentsOpen={commentsOpen}
        onToggleComments={setCommentsOpen}
      />}
      <div className={`absolute bottom-3 right-3 z-10 flex items-center gap-0.5 rounded-full px-1.5 py-1 text-slate-700 ${PROOF_GLASS}`}>
        <button type="button" aria-label="Zoom out" disabled={zoom <= 1} onClick={() => setZoom((current) => clampZoom(current - 0.25))} className={`grid h-7 w-7 place-items-center rounded-full ${PROOF_GLASS_ITEM} disabled:opacity-30`}><ZoomOutRounded style={{ fontSize: 18 }} /></button>
        <span className="w-11 text-center text-[11px] font-semibold tabular-nums">{Math.round(zoom * 100)}%</span>
        <button type="button" aria-label="Zoom in" disabled={zoom >= 4} onClick={() => setZoom((current) => clampZoom(current + 0.25))} className={`grid h-7 w-7 place-items-center rounded-full ${PROOF_GLASS_ITEM} disabled:opacity-30`}><ZoomInRounded style={{ fontSize: 18 }} /></button>
        {zoom > 1 && <button type="button" aria-label="Fit to screen" onClick={() => setZoom(1)} className={`grid h-7 w-7 place-items-center rounded-full ${PROOF_GLASS_ITEM}`}><FitScreenRounded style={{ fontSize: 18 }} /></button>}
      </div>
    </div>

    {/* This spread's corrections, with edit/remove while unsent. */}
    {pageCorrections.length > 0 && <div className="mx-4 mb-1.5 max-h-28 shrink-0 space-y-1.5 overflow-y-auto rounded-lg border border-slate-200 bg-white p-2.5 lg:hidden">
      {pageCorrections.map((correction, number) => <div key={correction.id} className="flex items-start justify-between gap-2 text-[11px] text-slate-600">
        <p className="min-w-0"><span className="font-bold text-slate-700">{number + 1}.</span> {correction.comment}</p>
        {!locked && !correction.locked && <span className="flex shrink-0 gap-2">
          <button type="button" onClick={() => editCorrection(correction)} className="font-medium text-blue-600 hover:underline">Edit</button>
          <button type="button" onClick={() => removeCorrection(correction)} disabled={busy} className="font-medium text-rose-600 hover:underline">Remove</button>
        </span>}
      </div>)}
    </div>}

    <footer className="shrink-0 border-t border-slate-200 bg-white px-3 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2">
      {/* Above the row rather than in it: the middle belongs to the arrows now, and a disabled
          Approve still has to say what it is waiting for. */}
      {!locked && !reviewedEverything && <p className="mb-1 text-center text-[11px] text-slate-500">{leftToSee} spread{leftToSee === 1 ? "" : "s"} left to view</p>}
      {/* Three columns rather than a centred row: the count sits at the left edge of the bar and
          the ruling at the right, however wide the pane is, and the arrows between them are
          centred on the bar itself rather than on whatever is left over. */}
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        <button type="button" onClick={() => setSummaryOpen(true)} className="justify-self-start whitespace-nowrap rounded-lg px-2.5 py-1.5 text-xs text-slate-600 hover:bg-slate-100">
          {corrections.length} correction{corrections.length === 1 ? "" : "s"}
        </button>
        {/* Back and forward sit between the count and the ruling: the album is paged from the same
            bar it is sent from, which is the only paging a phone had before. */}
        <ProofSpreadNav index={index} count={pages.length} onGo={go} className="justify-self-center" />
        <div className="flex items-center justify-end gap-2 justify-self-end">
          {!locked && <div className="flex items-center gap-2">
          {corrections.length > 0
            ? <Button type="button" size="sm" variant="primary" className="bg-rose-500 hover:bg-rose-600" disabled={busy || !reviewedEverything} title={reviewedEverything ? undefined : "Please look through every spread first."} onClick={() => setConfirming("send")}>Send {corrections.length} Correction{corrections.length === 1 ? "" : "s"}</Button>
            : <Button type="button" size="sm" variant="primary" className="bg-emerald-600 hover:bg-emerald-700" disabled={busy || !reviewedEverything} title={reviewedEverything ? undefined : "Please look through every spread first."} onClick={() => { setApproveChecked(false); setConfirming("approve"); }}>Approve &amp; Submit Album</Button>}
          </div>}
        </div>
      </div>
    </footer>

    {summaryOpen && <Dialog title={`${corrections.length} Correction${corrections.length === 1 ? "" : "s"}`} onClose={() => setSummaryOpen(false)} footer={<Button type="button" className="max-sm:flex-1" onClick={() => setSummaryOpen(false)}>Close</Button>}>
      {bySpread.length === 0 && <p className="py-6 text-center text-xs text-slate-500">Nothing yet — every spread looks good so far.</p>}
      <ul className="divide-y divide-slate-100">
        {bySpread.map(([pageNumber, count]) => <li key={pageNumber}>
          <button type="button" onClick={() => { const target = pages.findIndex((candidate) => candidate.pageNumber === pageNumber); if (target >= 0) setIndex(target); setSummaryOpen(false); }} className="flex w-full items-center justify-between px-1 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50">
            <span>Spread {String(pageNumber).padStart(2, "0")}</span><span className="font-semibold">{count}</span>
          </button>
        </li>)}
      </ul>
    </Dialog>}

    {confirming === "send" && <ConfirmDialog
      title="Send your corrections?"
      message={`You added ${corrections.length} correction${corrections.length === 1 ? "" : "s"}. Submitting locks this revision and sends everything to the studio — you won't be able to edit this round afterwards.`}
      confirmLabel={`Send ${corrections.length} Correction${corrections.length === 1 ? "" : "s"}`}
      busyLabel="Sending..."
      tone="primary"
      loading={busy}
      onCancel={() => setConfirming(null)}
      onConfirm={sendCorrections}
    />}
    {confirming === "approve" && <ConfirmDialog
      title="Final Album Approval"
      message="I have reviewed the complete album."
      confirmLabel="Confirm Approval"
      busyLabel="Approving..."
      tone="primary"
      loading={busy}
      confirmDisabled={!approveChecked}
      onCancel={() => setConfirming(null)}
      onConfirm={approveAlbum}
    >
      <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-slate-200 px-3 py-2.5 text-xs text-slate-700">
        <input type="checkbox" checked={approveChecked} onChange={(event) => setApproveChecked(event.target.checked)} className="mt-0.5" />
        I approve this album for final processing.
      </label>
    </ConfirmDialog>}

    {result && <Dialog title={result.kind === "approved" ? "Album Approved 🎉" : "Corrections Submitted Successfully"} onClose={() => setResult(null)} footer={<Button type="button" variant="primary" className="max-sm:flex-1" onClick={() => setResult(null)}>Done</Button>}>
      <p className="text-sm text-slate-700">
        {result.kind === "approved"
          ? `Thank you! Version V${result.versionNumber} is approved and moves to final processing.`
          : `Revision ${result.revisionNumber} used${result.remainingRevisions != null ? ` — ${result.remainingRevisions} revision round${result.remainingRevisions === 1 ? "" : "s"} remaining` : ""}. The studio will share the updated album here.`}
      </p>
    </Dialog>}
    </div>
    {commentsOpen && <aside className="hidden w-80 shrink-0 flex-col border-l border-slate-200 bg-white lg:flex">
      <ProofCommentList
        title={`Corrections${page ? ` — Spread ${String(index + 1).padStart(2, "0")}` : ""}`}
        hint={locked ? "Your corrections for this version are with the studio." : "Drag the proof to circle an area, or take the pen and draw on it."}
        comments={listedComments}
        activeId={activePinId}
        onSelect={setActivePinId}
      />
    </aside>}
  </main>;
}
