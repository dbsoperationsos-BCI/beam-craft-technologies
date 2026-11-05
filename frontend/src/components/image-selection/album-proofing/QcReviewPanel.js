"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ArrowBack from "@mui/icons-material/ArrowBack";
import FitScreenRounded from "@mui/icons-material/FitScreenRounded";
import ZoomInRounded from "@mui/icons-material/ZoomInRounded";
import ZoomOutRounded from "@mui/icons-material/ZoomOutRounded";
import Button from "@/components/shared/Button";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import Dialog from "@/components/ui/Dialog";
import {
  addQcCorrection, deleteQcCorrection, editQcCorrection, getAlbumVersion, qcApprove, qcRequestChanges, reopenAlbumCorrection,
} from "@/services/image-selection/album-proofs.service";
import { hasSeenEvery, seenCount, spreadReviewKey, unseenSpreads } from "@/lib/spreadReview.mjs";
import { DEFAULT_PAINT_COLOR, sanitizeStrokes, strokesCenter } from "@/lib/proofPaint.mjs";
import ProofCommentComposer from "./ProofCommentComposer";
import ProofCommentList from "./ProofCommentList";
import ProofSpreadNav from "./ProofSpreadNav";
import ProofToolbar from "./ProofToolbar";
import ProofSpreadCanvas from "./ProofSpreadCanvas";
import ProofingStatusChip from "./ProofingStatusChip";
import useSeenSpreads from "./useSeenSpreads";
import { PROOF_GLASS, PROOF_GLASS_ITEM } from "./proofGlass";

const UNRESOLVED = ["OPEN", "IN_PROGRESS", "REOPENED"];

/**
 * The QC Lead's review room — the client's proofing room, for QC.
 *
 * It works exactly as the client's does, because a QC Lead marking up a spread is doing the same
 * job the client does a week later: one spread at a time (buttons, arrow keys, swipe), zoom that
 * magnifies the photo alone, a dragged circle or a drawn line to mark a correction, marks that
 * are the reviewer's own to edit or remove until the ruling is sent, this spread's list beside
 * the proof, a count in the footer that opens the per-spread summary, and one primary action that
 * switches by itself: Request N Corrections while any are open, Approve QC at zero.
 *
 * What is QC's alone: the round (a resubmitted round defaults to changed spreads only), reopening
 * a correction the studio marked resolved, and the ruling itself. The backend enforces all of it —
 * these controls only ask. Anyone with read access may look; only the QC grant may act.
 */
/**
 * @param {object}  props
 * @param {string}  [props.versionId]   A specific frozen version to open. Omitted, the panel opens
 *                                      the album's current one, which is what QC review means.
 * @param {boolean} [props.historyOnly] Opened from the Versions tab to look at a round that is
 *                                      over. Nothing here may change anything: see `reviewing`.
 */
export default function QcReviewPanel({ album, qcCanWrite, versionId = null, historyOnly = false, onBack, onDecided, onReviewContext }) {
  const [detail, setDetail] = useState(null);
  const [index, setIndex] = useState(0);
  const [changedOnly, setChangedOnly] = useState(false);
  const [composer, setComposer] = useState(null); // { area } new, or { correction } editing
  // How this reviewer is marking the spread, and what they have painted on it but not yet sent.
  const [tool, setTool] = useState("circle");
  const [penColor, setPenColor] = useState(DEFAULT_PAINT_COLOR);
  const [strokes, setStrokes] = useState([]);
  const [comment, setComment] = useState("");
  const [activePinId, setActivePinId] = useState(null);
  const [summaryOpen, setSummaryOpen] = useState(false);
  // The corrections rail is opened from the toolbar's message button rather than standing there by
  // default: most of a review is looking at the spread, and a 320px column of words beside it is
  // worth the room only while the words are what is being read.
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [confirming, setConfirming] = useState(null); // "changes" | "approve"
  const [approveChecked, setApproveChecked] = useState(false);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const touchStartX = useRef(null);
  // Zoom magnifies the photo alone — never the panes around it. 1 = fit; above that the pane
  // scrolls/pans. Pins ride along because they are placed in percentages.
  const [zoom, setZoom] = useState(1);
  const zoomRef = useRef(1);
  const viewerRef = useRef(null);
  const pinchRef = useRef(null);
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);
  const clampZoom = (value) => Math.min(4, Math.max(1, value));

  // Pinch and ctrl/trackpad-wheel must call preventDefault so the browser does not zoom the whole
  // page — React's root-level touch/wheel listeners are passive, so these attach natively.
  const loaded = Boolean(detail);
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
  }, [loaded]);

  /*
   * `opening` is true for the load that opens the review and false for every reload after a
   * correction is saved, removed or reopened. The "Changed spreads only" default is applied on the
   * opening load alone: applied on every reload, it put the tick back on under a reviewer who had
   * taken it off - and left them on a spread number the shorter list no longer has.
   */
  const load = useCallback(async (opening = false) => {
    try {
      const response = await getAlbumVersion(album.id, versionId);
      setDetail(response.data);
      // A later round defaults to reviewing only what changed — the whole point of rounds.
      if (opening) setChangedOnly(response.data.round?.roundNumber > 1 && response.data.round?.scope === "CHANGED_ONLY" && response.data.pages.some((page) => page.changedFromPrevious));
      setNotice("");
    } catch (error) {
      setNotice(error.message || "Unable to load the version.");
    }
  }, [album.id, versionId]);

  useEffect(() => {
    const timer = window.setTimeout(() => { load(true); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  /*
   * Reviewing is the QC grant while the album sits in QC review; otherwise this is a viewer.
   *
   * It is the single gate on everything this panel can change — marking an area, the pen, the
   * correction menus, reopening, the ruling bar — so `historyOnly` has one thing to do: make it
   * false. A round opened from the Versions tab is over, and looking at what it recorded must not
   * be able to alter a correction, a status or a version. Nothing is disabled case by case, which
   * is what would let one control be forgotten.
   */
  const reviewing = Boolean(!historyOnly && qcCanWrite && detail?.album?.status === "QC_REVIEW");
  const pages = useMemo(() => {
    const all = detail?.pages || [];
    return changedOnly ? all.filter((page) => page.changedFromPrevious) : all;
  }, [detail, changedOnly]);
  // Held inside the list that is actually being paged: the list shrinks when the filter goes on
  // or a reload arrives, and a position past its end would show no spread at all.
  const spreadIndex = Math.min(index, Math.max(0, pages.length - 1));
  const page = pages[spreadIndex] || null;
  const pageNumberOf = useMemo(() => new Map((detail?.pages || []).map((candidate) => [candidate.id, candidate.pageNumber])), [detail]);
  // QC's own corrections on this version, and the ones still open — the ruling's arithmetic.
  const qcCorrections = useMemo(() => (detail?.corrections || []).filter((correction) => correction.source === "QC"), [detail]);
  const openCorrections = useMemo(() => qcCorrections.filter((correction) => UNRESOLVED.includes(correction.status)), [qcCorrections]);
  const pageCorrections = useMemo(() => (detail?.corrections || []).filter((correction) => correction.versionPageId === page?.id), [detail, page]);
  const bySpread = useMemo(() => {
    const map = new Map();
    for (const correction of qcCorrections) {
      const pageNumber = pageNumberOf.get(correction.versionPageId);
      if (pageNumber != null) map.set(pageNumber, (map.get(pageNumber) || 0) + 1);
    }
    return [...map.entries()].sort((a, b) => a[0] - b[0]);
  }, [qcCorrections, pageNumberOf]);
  // What has actually been looked at. A round shown as changed spreads only is judged on those:
  // the rest of the version was passed in an earlier round and is not asked for again.
  const pageIds = useMemo(() => pages.map((candidate) => candidate.id), [pages]);
  const seen = useSeenSpreads(spreadReviewKey(album.id, detail?.version?.versionNumber), page?.id);
  const reviewed = seenCount(pageIds, seen);
  const leftToSee = unseenSpreads(pageIds, seen).length;
  const reviewedEverything = hasSeenEvery(pageIds, seen);

  // A draft is a QC pin the ruling has not sent yet: still OPEN, never locked by a ruling.
  const isDraft = (correction) => reviewing && correction.source === "QC" && correction.status === "OPEN" && !correction.lockedAt;

  // One correction as the canvas draws it: the marker's spot, and the comment it opens into —
  // who wrote it, when, what it says, and what this reviewer may still do to it.
  function pinOf(correction, number) {
    const actions = [];
    if (isDraft(correction)) {
      actions.push({ label: "Edit", disabled: busy, onSelect: () => { editCorrection(correction); } });
      actions.push({ label: "Remove", disabled: busy, onSelect: () => removeCorrection(correction) });
    }
    if (reviewing && correction.status === "RESOLVED") actions.push({ label: "Reopen", disabled: busy, onSelect: () => reopen(correction) });
    return {
      id: correction.id, x: correction.xNormalized, y: correction.yNormalized, radius: correction.radiusNormalized, path: correction.path,
      number: number + 1, status: correction.status, source: correction.source,
      author: correction.createdByLabel || (correction.source === "CLIENT" ? "Client" : "QC Lead"),
      createdAt: correction.createdAt, comment: correction.comment, resolutionNote: correction.resolutionNote,
      actions,
    };
  }

  // This spread's comments as the panel lists them: the same author, time and text the pin
  // opens into, and the same Edit, Remove and Reopen where they are allowed.
  const listedComments = useMemo(() => pageCorrections
    .map((correction) => {
      const actions = [];
      if (isDraft(correction)) {
        actions.push({ label: "Edit", disabled: busy, onSelect: () => { setComposer({ correction }); setComment(correction.comment); } });
        actions.push({ label: "Remove", tone: "danger", disabled: busy, onSelect: () => removeCorrection(correction) });
      }
      if (reviewing && correction.status === "RESOLVED") actions.push({ label: "Reopen — not fixed", tone: "reopen", disabled: busy, onSelect: () => reopen(correction) });
      return {
        id: correction.id,
        author: correction.createdByLabel || (correction.source === "CLIENT" ? "Client" : "QC Lead"),
        createdAt: correction.createdAt,
        comment: correction.comment,
        resolutionNote: correction.resolutionNote,
        status: correction.status,
        badge: <ProofingStatusChip status={correction.status} />,
        actions,
      };
    }), [pageCorrections, busy, reviewing]); // eslint-disable-line react-hooks/exhaustive-deps

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
      if (composer || summaryOpen || confirming || result) return;
      if (event.key === "ArrowRight") go(1);
      if (event.key === "ArrowLeft") go(-1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, composer, summaryOpen, confirming, result]);

  /*
   * The review's own heading, lifted to the module header at the top of the page.
   *
   * The page draws `<project> / V1 · Round 1` with the album's status beside it while a review is
   * open, and this panel is the only place that knows the round — a round belongs to the QC detail,
   * not to the album, so nothing further up can work it out without fetching the review again.
   *
   * Reported as the detail arrives and withdrawn on the way out, so the trail can never outlive the
   * review that put it there: leaving QC, closing the album and switching project all unmount this
   * panel, and the cleanup is what clears the header in every one of those cases.
   */
  const versionLabel = detail ? `V${detail.version.versionNumber}${detail.round ? ` · Round ${detail.round.roundNumber}` : ""}` : null;
  const reviewStatus = detail?.album?.status || null;
  const spreadCount = pages.length;
  /*
   * Only what the title bar actually prints: the version and its status. The spread position used
   * to be reported here too, which meant every page-turn set state on the page above and re-rendered
   * it — the projects sidebar and all — for a number it no longer shows. These two change once a
   * review, so the page now re-renders when the review opens and closes and not while it is read.
   */
  useEffect(() => {
    if (!onReviewContext) return undefined;
    onReviewContext(versionLabel ? { versionLabel, status: reviewStatus } : null);
    return () => onReviewContext(null);
  }, [onReviewContext, versionLabel, reviewStatus]);

  /** Opening an existing correction for editing brings its drawing back with its words. */
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
   * A finished stroke joins the drawing, and the first one opens the composer against it — the
   * reviewer paints, then says what they mean, without a gesture in between. Further strokes keep
   * going onto the same correction while it is open.
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
      // spot that was marked. Either way the record keeps one point, which is what the pin, the
      // card and the spread list all read.
      const at = path.length ? strokesCenter(path) : null;
      if (composer.correction) await editQcCorrection(album.id, composer.correction.id, { comment: comment.trim(), path, ...(at || {}) });
      else await addQcCorrection(album.id, { versionPageId: page.id, x: at?.x ?? composer.area.x, y: at?.y ?? composer.area.y, radius: at ? null : composer.area.radius ?? null, path, comment: comment.trim() });
      closeComposer();
      await load();
    } catch (error) {
      setNotice(error.message || "Unable to save the correction.");
    } finally {
      setBusy(false);
    }
  }
  async function removeCorrection(correction) {
    setBusy(true);
    try { await deleteQcCorrection(album.id, correction.id); setActivePinId(null); await load(); }
    catch (error) { setNotice(error.message || "Unable to remove the correction."); }
    finally { setBusy(false); }
  }
  async function reopen(correction) {
    setBusy(true);
    try { await reopenAlbumCorrection(album.id, correction.id, null); await load(); }
    catch (error) { setNotice(error.message || "Unable to reopen the correction."); }
    finally { setBusy(false); }
  }
  async function requestCorrections() {
    setBusy(true);
    try {
      const response = await qcRequestChanges(album.id, null);
      setConfirming(null);
      setResult({ kind: "changes", ...response.data });
      await load();
    } catch (error) {
      setNotice(error.message || "Unable to record the decision.");
      setConfirming(null);
    } finally { setBusy(false); }
  }
  async function approve() {
    setBusy(true);
    try {
      const response = await qcApprove(album.id, null);
      setConfirming(null);
      setResult({ kind: "approved", ...response.data });
      await load();
    } catch (error) {
      setNotice(error.message || "Unable to record the decision.");
      setConfirming(null);
    } finally { setBusy(false); }
  }
  function finish() {
    setResult(null);
    onDecided();
  }

  if (!detail) return <div className="flex min-h-0 flex-1 items-center justify-center p-6 text-xs text-slate-500">{notice || "Loading the review..."}</div>;

  const hasChanged = (detail.pages || []).some((candidate) => candidate.changedFromPrevious);

  /*
   * No sidebar: the review is the proof and the bar above it, and nothing beside them.
   *
   * What the rail used to hold is now where it is read rather than in a column of its own — the
   * version and its status on the page's title bar, how far the review has got on the workspace
   * bar, and the corrections for this spread in the list under the proof. The one thing it held
   * that is not written anywhere else is the changed-spreads filter, which moved to the bar with
   * the progress it filters.
   */
  /*
   * A column, top to bottom: the bar naming the album, the band holding the proof and its
   * corrections, then the bar the album is paged and ruled from. Both bars span the full width;
   * the only thing that splits into columns is the band between them, and only from `lg`, which is
   * where the corrections rail appears at all (`hidden ... lg:flex`).
   */
  return <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-slate-50 text-slate-900">
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {/* A container query rather than a screen one, because this pane's width has little to do
          with the window's: the app shell, the projects sidebar and this panel's own sidebar all
          sit beside it, so it is about 440px on a 1280px screen and about 250px on a 768px one.
          Keyed to the screen, the readout was forced alongside the album name at a width that left
          the name nothing at all. Measured against this bar, the two sit side by side when there is
          room for both and stack when there is not.
          The container is this wrapper rather than the header itself — an element is a container
          for its descendants, never for its own classes, so `@min-...` on the header would have
          been measured against something else entirely. It is kept as tight as possible around the
          bar as well: `container-type` brings layout containment with it, which would make any
          `position: fixed` descendant resolve against this box instead of the window, and the
          review's dialogs live further down this same column. */}
      <div className="@container shrink-0">
      <header className="flex flex-col items-stretch justify-between gap-2 border-b border-slate-200 bg-white px-5 py-2 @min-[25rem]:flex-row @min-[25rem]:items-center md:px-9">
        <div className="flex min-w-0 items-center gap-2.5">
          {/* The way back out of the review, as an arrow rather than a labelled row of its own:
              this is the only exit, and it belongs beside the album it leaves. */}
          <button type="button" onClick={onBack} aria-label="Back to the album" title="Back to the album" className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"><ArrowBack style={{ fontSize: 16 }} /></button>
          <div className="min-w-0">
            <p className="truncate text-lg leading-tight tracking-tight text-slate-950 md:text-xl">{album.name}</p>
            <p className="flex flex-wrap items-center gap-1.5 text-[10px] text-slate-400">
              <span>{album.clientName} · {versionLabel}</span>
              {historyOnly && <span className="rounded-full bg-slate-100 px-1.5 py-0.5 font-semibold text-slate-600">Version History · View only</span>}
            </p>
          </div>
        </div>
        {/* How far the review has got, at this bar's right-hand end, where the spread count used to
            sit. It names the reviewed count rather than the position: the bar at the top of the
            page already says which spread is open, and this says how much of the album is behind
            it. A count and nothing else — no bar drawn under it, and no tally of what is still
            open, which the ruling bar below already carries and the corrections rail spells out.
            Full width once the header wraps, so on a phone it sits under the album name rather
            than squeezed beside it. */}
        <div className="w-full shrink-0 @min-[25rem]:w-auto">
          <div className="flex items-center justify-between gap-2 text-xs text-slate-600">
            <span>Reviewed</span>
            <span className="font-semibold tabular-nums text-slate-900">{reviewed} / {spreadCount}</span>
          </div>
          {/* Only on a round that has something to compare against, as before. It sits under the
              count it narrows: ticking it changes both that count and what the arrows page. */}
          {hasChanged && <label className="mt-2 inline-flex cursor-pointer items-center gap-1.5 text-[11px] text-slate-600"><input type="checkbox" checked={changedOnly} onChange={(event) => { setChangedOnly(event.target.checked); setIndex(0); }} />Changed spreads only</label>}
        </div>
      </header>
      </div>

      {!reviewing && <p className="mx-4 my-1 rounded-md bg-blue-50 px-3 py-1.5 text-center text-[11px] text-blue-700">
        {historyOnly
          ? "This version is shown for reference only. Its corrections are as they were recorded and cannot be edited here."
          : detail.album.status === "QC_REVIEW" ? "Viewing only — the QC Lead rules on this version." : "This version is not in QC review; corrections are shown as recorded."}
      </p>}
      {notice && <p role="alert" className="mx-4 my-1 rounded-md bg-rose-50 px-3 py-1.5 text-center text-[11px] text-rose-700">{notice}</p>}

      {/* Everything between the two bars: the proof, and the corrections for the spread on it.
          The rail used to be a sibling of this whole column, so it ran the full height and sat
          *beside* the bar above and the ruling below rather than between them. Here it is bounded
          by both, and the two bars keep the full width they are meant to span. */}
      <div className="flex min-h-0 flex-1 lg:flex-row">
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
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
            <div className="m-auto" style={{ width: `${zoom * 100}%`, height: `${zoom * 100}%` }}>
              {page
                ? <ProofSpreadCanvas
                    imageUrl={page.previewUrl}
                    alt={page.fileName}
                    pins={pageCorrections.map((correction, number) => pinOf(correction, number))}
                    activePinId={activePinId}
                    pendingArea={composer?.area?.radius ? composer.area : null}
                    pendingPin={composer?.area && !composer.area.radius ? composer.area : null}
                    // The comment is written against the mark itself, beside the pin just dropped or
                    // the correction being edited — never in a dialog over the spread being judged.
                    // A staff correction carries its spot as `xNormalized` / `yNormalized`, the
                    // column names - only the client's own serializer shortens them to x / y. Read
                    // as x / y here, the anchor was two undefineds and the card landed in the corner.
                    composerAnchor={composer?.correction ? { x: composer.correction.xNormalized, y: composer.correction.yNormalized } : null}
                    composer={composer && <ProofCommentComposer
                      value={comment}
                      onChange={setComment}
                      onSubmit={saveCorrection}
                      onCancel={closeComposer}
                      busy={busy}
                      editing={Boolean(composer.correction)}
                    />}
                    onSelectPin={setActivePinId}
                    // Two ways to mark a correction, exactly as the client has, and both say how
                    // much of the spread they mean: a dragged circle, and the pen's own line.
                    onImageCircleDraw={reviewing ? (area) => { setComposer({ area }); setComment(""); setStrokes([]); } : undefined}
                    tool={reviewing ? tool : "none"}
                    penColor={penColor}
                    pendingStrokes={strokes}
                    onPaintStroke={reviewing ? addStroke : undefined}
                    className="flex h-full w-full items-center justify-center"
                    imageClassName="h-full w-full rounded-none object-contain"
                  />
                : <p className="m-auto py-16 text-center text-xs text-slate-500">{changedOnly ? "No changed spreads in this round." : "This version has no pages."}</p>}
            </div>
          </div>
          {page && <ProofToolbar
            canMark={reviewing}
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
        {commentsOpen && <aside className="hidden w-80 shrink-0 flex-col border-l border-slate-200 bg-white lg:flex">
          <ProofCommentList
            title={`Corrections${page ? ` — Spread ${String(spreadIndex + 1).padStart(2, "0")}` : ""}`}
            hint={reviewing ? "Drag the proof to circle an area, or take the pen and draw on it." : "Corrections on this spread, as recorded."}
            comments={listedComments}
            activeId={activePinId}
            onSelect={setActivePinId}
          />
        </aside>}
      </div>

      {/* This spread's corrections on a phone, with edit/remove while they are still drafts. */}
      {pageCorrections.length > 0 && <div className="mx-4 mb-1.5 max-h-28 shrink-0 space-y-1.5 overflow-y-auto rounded-lg border border-slate-200 bg-white p-2.5 lg:hidden">
        {pageCorrections.map((correction, number) => <div key={correction.id} className="flex items-start justify-between gap-2 text-[11px] text-slate-600">
          <p className="min-w-0"><span className="font-bold text-slate-700">{number + 1}.</span> {correction.comment}</p>
          {isDraft(correction) && <span className="flex shrink-0 gap-2">
            <button type="button" onClick={() => editCorrection(correction)} className="font-medium text-blue-600 hover:underline">Edit</button>
            <button type="button" onClick={() => removeCorrection(correction)} disabled={busy} className="font-medium text-rose-600 hover:underline">Remove</button>
          </span>}
        </div>)}
      </div>}

      <footer className="shrink-0 border-t border-slate-200 bg-white px-3 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2">
        {/* Above the row rather than in it: the middle belongs to the arrows now, and a disabled
            ruling still has to say what it is waiting for. */}
        {reviewing && !reviewedEverything && <p className="mb-1 text-center text-[11px] text-slate-500">{leftToSee} spread{leftToSee === 1 ? "" : "s"} still to look through</p>}
        {/* Three columns rather than a centred row: the count sits at the left edge of the bar and
            the ruling at the right, however wide the pane is, and the arrows between them are
            centred on the bar itself rather than on whatever is left over. */}
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
          <button type="button" onClick={() => setSummaryOpen(true)} className="justify-self-start whitespace-nowrap rounded-lg px-2.5 py-1.5 text-xs text-slate-600 hover:bg-slate-100">
            {qcCorrections.length} correction{qcCorrections.length === 1 ? "" : "s"}
          </button>
          {/* Back and forward sit between the count and the ruling: the album is paged from the
              same bar it is judged from, on a phone as much as on a desktop. */}
          <ProofSpreadNav index={spreadIndex} count={pages.length} onGo={go} className="justify-self-center" />
          <div className="flex items-center justify-end gap-2 justify-self-end">
            {reviewing && <div className="flex items-center gap-2">
            {openCorrections.length > 0
              ? <Button type="button" size="sm" variant="primary" className="bg-rose-500 hover:bg-rose-600" disabled={busy || !reviewedEverything} title={reviewedEverything ? undefined : "Look through every spread first."} onClick={() => setConfirming("changes")}>Request {openCorrections.length} Correction{openCorrections.length === 1 ? "" : "s"}</Button>
              : <Button type="button" size="sm" variant="primary" className="bg-emerald-600 hover:bg-emerald-700" disabled={busy || !reviewedEverything} title={reviewedEverything ? undefined : "Look through every spread first."} onClick={() => { setApproveChecked(false); setConfirming("approve"); }}>Approve QC</Button>}
            </div>}
          </div>
        </div>
      </footer>

      {summaryOpen && <Dialog title={`${qcCorrections.length} Correction${qcCorrections.length === 1 ? "" : "s"}`} onClose={() => setSummaryOpen(false)} footer={<Button type="button" className="max-sm:flex-1" onClick={() => setSummaryOpen(false)}>Close</Button>}>
        {bySpread.length === 0 && <p className="py-6 text-center text-xs text-slate-500">Nothing yet — every spread looks good so far.</p>}
        <ul className="divide-y divide-slate-100">
          {bySpread.map(([pageNumber, count]) => <li key={pageNumber}>
            <button type="button" onClick={() => { const target = pages.findIndex((candidate) => candidate.pageNumber === pageNumber); if (target >= 0) setIndex(target); setSummaryOpen(false); }} className="flex w-full items-center justify-between px-1 py-2.5 text-xs text-slate-700 hover:bg-slate-50">
              <span>Spread {String(pageNumber).padStart(2, "0")}</span><span className="font-semibold">{count}</span>
            </button>
          </li>)}
        </ul>
      </Dialog>}

      {confirming === "changes" && <ConfirmDialog
        title="Request internal corrections?"
        message={`${openCorrections.length} correction${openCorrections.length === 1 ? "" : "s"} go back to the studio to fix. Sending locks this round's pins — the album leaves QC review until it is resubmitted.`}
        confirmLabel={`Request ${openCorrections.length} Correction${openCorrections.length === 1 ? "" : "s"}`}
        busyLabel="Sending..."
        tone="primary"
        loading={busy}
        onCancel={() => setConfirming(null)}
        onConfirm={requestCorrections}
      />}
      {confirming === "approve" && <ConfirmDialog
        title="Approve QC"
        message={`${versionLabel.split(" · ")[0]} passes QC and becomes ready to send to the client.`}
        confirmLabel="Approve QC"
        busyLabel="Approving..."
        tone="primary"
        loading={busy}
        confirmDisabled={!approveChecked}
        onCancel={() => setConfirming(null)}
        onConfirm={approve}
      >
        <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-slate-200 px-3 py-2.5 text-xs text-slate-700">
          <input type="checkbox" checked={approveChecked} onChange={(event) => setApproveChecked(event.target.checked)} className="mt-0.5" />
          I have reviewed every spread of this version.
        </label>
      </ConfirmDialog>}

      {result && <Dialog title={result.kind === "approved" ? "QC Approved" : "Corrections Sent to the Studio"} onClose={finish} footer={<Button type="button" variant="primary" className="max-sm:flex-1" onClick={finish}>Done</Button>}>
        <p className="text-sm text-slate-700">
          {result.kind === "approved"
            ? `Version V${result.versionNumber} passes QC and is ready to send to the client.`
            : `${result.openCorrections} correction${result.openCorrections === 1 ? "" : "s"} ${result.openCorrections === 1 ? "is" : "are"} with the studio. The album comes back to QC once the fixes are resubmitted.`}
        </p>
      </Dialog>}
    </div>
  </div>;
}
