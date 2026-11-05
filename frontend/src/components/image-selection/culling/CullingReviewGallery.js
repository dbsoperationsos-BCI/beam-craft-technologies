"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Star from "@mui/icons-material/Star";
import ZoomIn from "@mui/icons-material/ZoomIn";
import GalleryLazyImage from "../GalleryLazyImage";
import ImagePreviewDialog from "../ImagePreviewDialog";
import CullingGroupCompareDialog from "./CullingGroupCompareDialog";
import CullingPhotoExplanation from "./CullingPhotoExplanation";
import useCullingViews from "./useCullingViews";
import Button from "@/components/shared/Button";
import Dropdown from "@/components/shared/Dropdown";
import IconButton from "@/components/shared/IconButton";
import SendPhotosActions from "../SendPhotosActions";
import IncrementalListFooter from "../IncrementalListFooter";
import useIncrementalPages from "@/components/shared/useIncrementalPages";
import { bulkCullingDecision, listCullingResults, setCullingDecision } from "@/services/image-selection/image-selection.service";
import { CULLING_ALL_SCENES, CULLING_DECISION_STYLES, CULLING_FILTERS, CULLING_SORTS, cullingConfidenceLabel, cullingFilterCount, cullingGroupOf, cullingKeyIgnored, cullingRankLabel, cullingReasonLabel, cullingReasonTone, cullingSceneHint, cullingSceneLabel, cullingSceneOptions } from "@/lib/imageSelectionCulling.mjs";

const PAGE_SIZE = 60;
// A tile shows its two most telling reasons: concerns first (what to look at), then strengths.
const TONE_ORDER = { concern: 0, positive: 1, note: 2 };
const TONE_CLASS = { concern: "bg-red-50 text-red-700", positive: "bg-emerald-50 text-emerald-700", note: "bg-slate-100 text-slate-600" };
// Sorts where "biggest first" is what a photographer means by default.
const DESC_SORTS = new Set(["score"]);

/**
 * The photographer's review surface: the confidence-first triage over one review-ready session.
 * Facet chips narrow to what needs eyes (low confidence first, then duplicates, blur, blinks),
 * cards carry the verdict and its reasons, decisions land with one key, and the group marker
 * opens the compare view. Decisions call the backend one at a time or in bulk; every response
 * carries the session's fresh counts, which bubble up so the header never disagrees.
 *
 * Keyboard, following the client gallery's viewer: ←/→ move the active card, 1/2/3 decide,
 * 0 clears the override, Space/Enter opens the preview - which explains the AI's call beside the
 * photo, and inside which ←/→ and 1/2/3/0 keep working on the photo shown. Listeners pause while a
 * dialog other than the preview is open —
 * the dialogs own their keys — and while the workspace says so (`keysPaused`, its own confirm
 * dialog); a key typed into a control or a button's own Enter is never read as a shortcut.
 * Every decide control is always on screen: a phone has no hover to reveal it with.
 */
// `scene` / `onSceneChange`: the workspace owns the scene, so its coverage line can open the review
// on a scene with no Keep yet.
// `canSendToEditing` / `canSendToAlbum`: the "Send to …" actions over a ticked
// selection, each absent when the viewer may not use that destination. They stay offered on a
// finalized run (the Keeps are usually what goes on), when decisions are no longer taken.
export default function CullingReviewGallery({ projectId, session, filterCounts, scenes = [], scene = CULLING_ALL_SCENES, onSceneChange, canWrite = true, keysPaused = false, onCountsChange, onNotice, canSendToEditing = false, canSendToAlbum = false, onOpenEditing = null, onOpenPhotos = null, onOpenAlbum = null }) {
  const canSend = canSendToEditing || canSendToAlbum;
  // Ticks are offered to decide in bulk, and to send on; either reason is enough.
  const canSelect = canWrite || canSend;
  const [filter, setFilter] = useState("all");
  // A scene that is no longer in the run (a re-run with another profile) reads as all scenes.
  const activeScene = scene !== CULLING_ALL_SCENES && scenes.some((entry) => entry.id === scene) ? scene : CULLING_ALL_SCENES;
  const sceneOptions = useMemo(() => cullingSceneOptions(scenes), [scenes]);
  const [sort, setSort] = useState("captured");
  const [order, setOrder] = useState("asc");
  const [activeIndex, setActiveIndex] = useState(0);
  const [selected, setSelected] = useState(() => new Set());
  // The preview shows the active card, so ←/→ inside it walk the page and a decision lands on the
  // photo on screen.
  const [previewOpen, setPreviewOpen] = useState(false);
  const openPreview = (index) => { setActiveIndex(index); setPreviewOpen(true); };
  const [compareGroupId, setCompareGroupId] = useState(null);
  const [busy, setBusy] = useState(false);
  const sessionId = session.id;
  // Which photos were actually seen, for the training labels (quiet; writers only).
  const views = useCullingViews({ projectId, sessionId, enabled: canWrite });

  // One continuous review: the run's results for this filter, scene and sort, read batch by batch
  // from the paged endpoint as the end comes near (the server filters and sorts the whole run, so a
  // filter or a sort is never applied to what happens to be loaded). A new filter, scene or sort is
  // a new list; an answer to the old one is dropped.
  const listKey = `${sessionId}|${filter}|${sort}|${order}|${activeScene}`;
  const fetchPage = useCallback((page, pageSize) => listCullingResults(projectId, sessionId, { page, pageSize, filter, sort, order, scene: activeScene === CULLING_ALL_SCENES ? undefined : activeScene })
    .then((response) => ({ ...response.data, items: response.data?.items || [], total: response.data?.total || 0 })), [projectId, sessionId, filter, sort, order, activeScene]);
  const list = useIncrementalPages({ key: listKey, fetchPage, pageSize: PAGE_SIZE });
  const { refresh, updateItems, loadMore } = list;
  const loading = list.loading;
  useEffect(() => { if (list.firstError) onNotice?.(list.firstError, "error"); }, [list.firstError, onNotice]);

  const items = list.items;
  // Every photo shown in the preview counts as opened (also when the arrows walk to it).
  const previewedId = previewOpen ? items[activeIndex]?.id : null;
  const { opened } = views;
  useEffect(() => { if (previewedId) opened(previewedId); }, [previewedId, opened]);
  // Result id → photo id for every ticked result, kept beside the ticks themselves so a selection
  // made across pages can be sent on: the sends name photos, the review names results.
  const [selectedUploads, setSelectedUploads] = useState(() => new Map());
  const selectedUploadIds = useMemo(() => [...selected].map((id) => selectedUploads.get(id)).filter(Boolean), [selected, selectedUploads]);
  const changeFilter = (next) => { setFilter(next); setSelected(new Set()); setActiveIndex(0); };

  // `source`: how the decision was made (a key, a click, the preview panel), kept as label quality.
  async function decide(item, decision, source = "CLICK") {
    if (!canWrite || busy) return;
    setBusy(true);
    try {
      const response = await setCullingDecision(projectId, sessionId, item.id, decision, source);
      updateItems((current) => current.map((entry) => (entry.id === item.id ? response.data.result : entry)));
      onCountsChange?.(response.data.counts);
    } catch (error) {
      onNotice?.(error.message || "Unable to save the decision.", "error");
    } finally { setBusy(false); }
  }

  async function decideSelected(decision) {
    if (!canWrite || busy || !selected.size) return;
    setBusy(true);
    try {
      const response = await bulkCullingDecision(projectId, sessionId, [...selected], decision, "BULK");
      onCountsChange?.(response.data.counts);
      onNotice?.(`${response.data.updated} photo${response.data.updated === 1 ? "" : "s"} marked ${decision ? decision.toLowerCase() : "per the AI"}.`, "success");
      setSelected(new Set());
      await refresh();
    } catch (error) {
      onNotice?.(error.message || "Unable to save the decisions.", "error");
    } finally { setBusy(false); }
  }

  const toggleSelected = (item) => {
    setSelectedUploads((current) => { const next = new Map(current); next.set(item.id, item.uploadId || item.upload?.id); return next; });
    setSelected((current) => { const next = new Set(current); if (next.has(item.id)) next.delete(item.id); else next.add(item.id); return next; });
  };

  // One keydown listener, off while any overlay is up. The ref mirrors the latest render so the
  // once-bound listener reads fresh state; written in an effect, never during render.
  const stateRef = useRef({ items: [] });
  useEffect(() => { stateRef.current = { items, activeIndex, previewOpen, compareGroupId, canWrite, busy, keysPaused, hasMore: list.hasMore, loadMore }; });
  useEffect(() => {
    function keydown(event) {
      const { items: current, activeIndex: index, previewOpen: inPreview, compareGroupId: openCompare, canWrite: writable, busy: inFlight, keysPaused: paused, hasMore: more, loadMore: next } = stateRef.current;
      if (openCompare || paused || !current.length || inFlight) return;
      if (cullingKeyIgnored(event.target, event)) return;
      const active = current[index];
      if (event.key === "ArrowRight") {
        event.preventDefault();
        if (index < current.length - 1) setActiveIndex(index + 1);
        else if (more) next().then((loaded) => { if (loaded && loaded.length > index + 1) setActiveIndex(index + 1); });
      }
      else if (event.key === "ArrowLeft") { event.preventDefault(); setActiveIndex(Math.max(0, index - 1)); }
      else if ((event.key === " " || event.key === "Enter") && active && !inPreview) { event.preventDefault(); setPreviewOpen(true); }
      else if (writable && active && event.key === "1") decide(active, "KEEP", inPreview ? "PREVIEW_PANEL" : "KEY");
      else if (writable && active && event.key === "2") decide(active, "MAYBE", inPreview ? "PREVIEW_PANEL" : "KEY");
      else if (writable && active && event.key === "3") decide(active, "REJECT", inPreview ? "PREVIEW_PANEL" : "KEY");
      else if (writable && active && event.key === "0") decide(active, null, inPreview ? "PREVIEW_PANEL" : "KEY");
    }
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
    // decide is stable enough through the ref-read pattern; the listener binds once per session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  return (
    <div className="mt-5">
      {/* Facet chips + sort. */}
      <div className="flex flex-wrap items-center gap-2">
        <div role="tablist" aria-label="Culling filters" className="flex flex-wrap gap-1">
          {CULLING_FILTERS.map((entry) => {
            const count = cullingFilterCount(entry.id, session, filterCounts);
            if (count === 0 && !["all", "keep", "maybe", "reject", "pending"].includes(entry.id)) return null;
            return (
              <Button
                key={entry.id}
                size="none"
                variant="plain"
                role="tab"
                aria-selected={filter === entry.id}
                title={entry.hint || undefined}
                onClick={() => changeFilter(entry.id)}
                className={`min-h-10 rounded-full px-2.5 py-1 text-[11px] font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 sm:min-h-8 sm:text-[11px] ${filter === entry.id ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
              >
                {entry.label}{count !== null ? ` ${count}` : ""}
              </Button>
            );
          })}
        </div>
        {/* Every loaded photo ticked at once, for a bulk decision or a send; the filter chips
            narrow what "all" means (all Keeps, all of a scene). */}
        {canSelect && items.length > 0 && (
          <Button variant="ghost" size="sm" onClick={() => {
            const allTicked = items.every((item) => selected.has(item.id));
            if (allTicked) { setSelected(new Set()); return; }
            setSelectedUploads((current) => { const next = new Map(current); for (const item of items) next.set(item.id, item.uploadId || item.upload?.id); return next; });
            setSelected(new Set(items.map((item) => item.id)));
          }}>
            {items.every((item) => selected.has(item.id)) ? "Deselect all" : `Select all loaded (${items.length})`}
          </Button>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-1">
          {sceneOptions.length > 0 && (
            <Dropdown
              ariaLabel="Scene (AI's guess)"
              mode="switch"
              options={sceneOptions}
              value={activeScene}
              sorted={false}
              onChange={(next) => { onSceneChange?.(next); setSelected(new Set()); setActiveIndex(0); }}
            />
          )}
          <Dropdown
            ariaLabel="Sort photos"
            mode="switch"
            options={CULLING_SORTS.map((entry) => ({ value: entry.id, label: entry.label }))}
            value={sort}
            sorted={false}
            onChange={(next) => { setSort(next); setOrder(DESC_SORTS.has(next) ? "desc" : "asc"); setActiveIndex(0); }}
          />
          <IconButton size="sm" ariaLabel={`Sort ${order === "asc" ? "ascending" : "descending"}`} onClick={() => setOrder((value) => (value === "asc" ? "desc" : "asc"))} className="border border-slate-300 text-slate-600">
            <span aria-hidden="true">{order === "asc" ? "↑" : "↓"}</span>
          </IconButton>
        </div>
      </div>
      {/* Keyboard copy for keyboards: hidden on a phone, where the buttons are the whole story. */}
      <p className="mt-2 hidden text-[11px] text-slate-600 md:block">Keys: ←/→ move{canWrite ? " · 1 keep · 2 maybe · 3 reject · 0 back to AI" : ""} · Space or double-click opens the preview</p>

      {loading ? (
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }, (_, index) => <div key={index} className="aspect-4/3 animate-pulse rounded-lg bg-slate-100" />)}
        </div>
      ) : !items.length ? (
        <div className="mt-4 grid min-h-40 place-items-center rounded-xl border border-dashed border-slate-300 bg-slate-50/60 text-xs text-slate-500">
          <div className="text-center">
            <p>No photos match {activeScene === CULLING_ALL_SCENES ? "this filter" : "this filter in this scene"}.</p>
            {activeScene !== CULLING_ALL_SCENES && (
              <div className="mt-2"><Button variant="secondary" size="sm" onClick={() => onSceneChange?.(CULLING_ALL_SCENES)}>Show all scenes</Button></div>
            )}
          </div>
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
          {items.map((item, index) => {
            const decision = CULLING_DECISION_STYLES[item.effectiveDecision] || CULLING_DECISION_STYLES.PENDING;
            const group = cullingGroupOf(item);
            const groupId = group?.id;
            const codes = Array.isArray(item.reasonCodes) ? item.reasonCodes : [];
            return (
              <div
                key={item.id}
                ref={views.observe}
                data-culling-result={item.id}
                role="button"
                tabIndex={0}
                onClick={() => setActiveIndex(index)}
                // A desktop extra: double-clicking the photo itself opens the preview. The Preview
                // button below is the path that works everywhere, and a double-click on a control
                // (the checkbox, a decide button) is that control's business.
                onDoubleClick={(event) => { if (!event.target.closest?.("button, input, a")) openPreview(index); }}
                onKeyDown={(event) => { if (event.key === "Enter") setActiveIndex(index); }}
                className={`relative touch-manipulation overflow-hidden rounded-lg border bg-white text-left ${index === activeIndex ? "border-blue-500 ring-2 ring-blue-200" : "border-slate-200"}`}
              >
                {/* The photo's own box: the preview button sits on the photo, never over the decide row. */}
                <div className="relative">
                  <GalleryLazyImage src={item.upload.thumbnailUrl} alt={item.upload.fileName} className="aspect-4/3" />
                  <IconButton
                    size="sm"
                    ariaLabel={`Preview ${item.upload.fileName}`}
                    onClick={(event) => { event.stopPropagation(); openPreview(index); }}
                    className="absolute bottom-1.5 right-1.5 bg-slate-900/60 text-white hover:bg-slate-900/80"
                  >
                    <ZoomIn style={{ fontSize: 18 }} aria-hidden="true" />
                  </IconButton>
                </div>
                {canSelect && (
                  // A padded label gives the 16px box a thumb-sized hit area.
                  <label className="absolute left-0 top-0 flex h-10 w-10 cursor-pointer items-start justify-start p-2" onClick={(event) => event.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selected.has(item.id)}
                      onChange={() => toggleSelected(item)}
                      aria-label={`Select ${item.upload.fileName}`}
                      className="h-4 w-4 accent-blue-600"
                    />
                  </label>
                )}
                {item.finalScore !== null && (
                  <span className="absolute right-1.5 top-1.5 whitespace-nowrap rounded bg-slate-900/70 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                    <span className="sr-only">AI score </span>{item.finalScore}
                    {cullingConfidenceLabel(item.confidence) ? <span className="font-normal text-white/80"> · <span className="sr-only">confidence </span>{cullingConfidenceLabel(item.confidence)}</span> : null}
                  </span>
                )}
                {item.isGroupBest && <Star className="absolute right-1.5 top-7 text-amber-400" style={{ fontSize: 16 }} titleAccess="Best of its group" />}
                <div className="p-2">
                  <div className="flex items-center justify-between gap-1">
                    <span className="min-w-0 truncate text-[10px] text-slate-600" title={item.upload.fileName}>
                      {item.upload.fileName}
                      {cullingSceneLabel(item.sceneLabel, scenes, item.sceneConfidence) && <span className="block truncate text-[11px] text-slate-600" title={cullingSceneHint(item.sceneConfidence)}>{cullingSceneLabel(item.sceneLabel, scenes, item.sceneConfidence)}</span>}
                    </span>
                    <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${decision.className}`}>
                      {decision.label}{item.userDecision ? <> ✎<span className="sr-only"> your decision</span></> : null}
                    </span>
                  </div>
                  {item.userDecision && item.aiDecision && item.aiDecision !== item.userDecision && (
                    <p className="mt-0.5 text-[10px] text-slate-600">AI said {CULLING_DECISION_STYLES[item.aiDecision]?.label || item.aiDecision}</p>
                  )}
                  <div className="mt-1 flex flex-wrap items-center gap-1">
                    {[...codes].sort((a, b) => TONE_ORDER[cullingReasonTone(a)] - TONE_ORDER[cullingReasonTone(b)]).slice(0, 2).map((code) => (
                      <span key={code} className={`rounded px-1 py-0.5 text-[10px] ${TONE_CLASS[cullingReasonTone(code)]}`} title={codes.map(cullingReasonLabel).join(", ")}>{cullingReasonLabel(code)}</span>
                    ))}
                    {codes.length > 2 && <span className="text-[10px] text-slate-500" title={codes.map(cullingReasonLabel).join(", ")}>+{codes.length - 2}</span>}
                    {groupId && (
                      <Button size="none" variant="plain" onClick={(event) => { event.stopPropagation(); setCompareGroupId(groupId); }} className="relative before:absolute before:-inset-y-2 before:-inset-x-1 before:content-[''] min-h-6 rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-700 hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 sm:text-[10px]" ariaLabel={`Compare the ${group.noun} of ${item.upload.fileName}`}>
                        {[item.isGroupBest && group.type !== "SIMILAR" ? "Best" : cullingRankLabel(group.rank), "Compare"].filter(Boolean).join(" · ")}
                      </Button>
                    )}
                  </div>
                  {canWrite && (
                    // Thumb-sized on a phone, compact beside a mouse.
                    <div className="mt-1.5 flex gap-1">
                      {["KEEP", "MAYBE", "REJECT"].map((value) => (
                        <Button key={value} size="none" variant="plain" aria-pressed={item.userDecision === value} onClick={(event) => { event.stopPropagation(); decide(item, value, "CLICK"); }} disabled={busy} className={`flex-1 rounded px-1 py-2 text-[11px] font-semibold sm:py-0.5 sm:text-[9px] ${item.userDecision === value ? CULLING_DECISION_STYLES[value].className : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
                          {CULLING_DECISION_STYLES[value].label}
                        </Button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* One continuous review: the next batch loads as the end comes near; no Previous / Next. */}
      {!loading && <IncrementalListFooter list={list} resetKey={listKey} />}

      {/* The bulk bar, floating over the grid while anything is ticked. */}
      {canSelect && selected.size > 0 && (
        <div className="sticky bottom-3 z-10 mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-slate-800 px-3 py-2 text-white shadow-lg">
          <span className="text-xs font-medium">{selected.size} selected</span>
          {canWrite && ["KEEP", "MAYBE", "REJECT"].map((value) => (
            <Button key={value} size="none" variant="plain" disabled={busy} onClick={() => decideSelected(value)} className="min-h-10 rounded bg-white/10 px-2 py-1 text-[11px] font-semibold text-white hover:opacity-80 sm:min-h-8 sm:text-[11px]">{CULLING_DECISION_STYLES[value].label}</Button>
          ))}
          {canWrite && <Button size="none" variant="plain" disabled={busy} onClick={() => decideSelected(null)} className="min-h-10 rounded bg-white/10 px-2 py-1 text-[11px] text-white hover:opacity-80 sm:min-h-8 sm:text-[11px]" title="Clear overrides — back to the AI's answers">Back to AI</Button>}
          {/* Where the ticked photos may go next: AI Editing (as they are), Photo Selection (their
              already-compressed derivatives), the Signature Album (by reference). The server moves
              them; nothing is downloaded here. */}
          <SendPhotosActions
            projectId={projectId}
            uploadIds={selectedUploadIds}
            from="culling"
            cullingSessionId={session.id}
            finalized={session.status === "FINALIZED"}
            canSendToEditing={canSendToEditing}
            canSendToAlbum={canSendToAlbum}
            disabled={busy}
            onDone={(summary, destination, open, tone = "success") => { setSelected(new Set()); onNotice?.(summary, tone, open ? { label: `Open ${destination === "editing" ? "AI Editing" : destination === "photos" ? "Photo Selection" : "Signature Album"}`, onSelect: open } : undefined); }}
            onError={(message) => onNotice?.(message, "error")}
            onOpenEditing={onOpenEditing}
            onOpenPhotos={onOpenPhotos}
            onOpenAlbum={onOpenAlbum}
            className="border-l border-white/20 pl-2"
          />
          <Button size="none" variant="plain" onClick={() => setSelected(new Set())} className="ml-auto min-h-10 rounded px-2 py-1 text-[11px] text-slate-300 hover:opacity-80 sm:min-h-8 sm:text-[11px]">Deselect</Button>
        </div>
      )}

      {previewOpen && items[activeIndex] && (
        <ImagePreviewDialog
          image={items[activeIndex].upload}
          onClose={() => setPreviewOpen(false)}
          galleryKeys
          aside={<CullingPhotoExplanation item={items[activeIndex]} session={session} scenes={scenes} canWrite={canWrite} busy={busy} onDecide={(item, value) => decide(item, value, "PREVIEW_PANEL")} />}
        />
      )}
      {compareGroupId && (
        <CullingGroupCompareDialog
          projectId={projectId}
          sessionId={sessionId}
          groupId={compareGroupId}
          canWrite={canWrite}
          onClose={() => setCompareGroupId(null)}
          onCountsChange={onCountsChange}
          onChanged={() => refresh()}
          onNotice={onNotice}
        />
      )}
    </div>
  );
}
