"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Button from "@/components/shared/Button";
import Loader from "@/components/shared/Loader";
import FloatingNotice, { useNotice } from "@/components/shared/FloatingNotice";
import SearchField from "@/components/shared/SearchField";
import useEscapeKey from "@/components/shared/useEscapeKey";
import SendPhotosActions from "../SendPhotosActions";
import EditingPanel from "./EditingPanel";
import EditingPhotoGrid from "./EditingPhotoGrid";
import EditedDownloadButton from "./EditedDownloadButton";
import IncrementalListFooter from "../IncrementalListFooter";
import useIncrementalPages from "@/components/shared/useIncrementalPages";
import { scrollParentOf } from "@/components/shared/useInfiniteScroll";
import { PROGRESS_CHIP_CLASS, progressChipStyle } from "@/lib/progressStatus.mjs";
import { cullingKeyIgnored } from "@/lib/imageSelectionCulling.mjs";
import { editingCountsLine, editingEngineStatus, editingFocusOrder, editingFocusPosition, editingNavigationKey, editingNavigationTarget, editingNeedsPolling } from "@/lib/imageSelectionEditing.mjs";
import { getAiEditingCapabilities, getAiEditingPhoto, listAiEditingPhotos } from "@/services/image-selection/ai-editing.service";

/**
 * The AI Editing tab's body: the editing bay between AI Culling and Photo Selection. Photos arrive
 * here three ways - uploaded on this tab (held for editing until sent on), sent from AI Culling,
 * or already in Photo Selection and opened for an edit - and leave to the Signature Album through
 * the server, which compresses an edited photo to the album's own preset; an unedited one goes as
 * it is. There is no send into Photo Selection from here (a finalized AI Culling run's Keeps fill
 * it). The scope is the folder selected in the tree, as AI Culling's is.
 *
 * Two surfaces: the bay (tiles, upload, bulk sends) and, over one photo, the editor. The bay is one
 * continuous list: the first batch, then the next as the reader nears the end (`useIncrementalPages`
 * over the paged endpoint, the footer's sentinel) - no Previous / Next. The editor stays open while
 * the keyboard walks the bay in its own order - Left / Right a photo, Home / End the ends - loading
 * the next batch as a move needs it, so a wedding is edited without a trip back to the tiles for
 * every photo. The bay polls while any photo is still uploading or rendering (re-reading what is
 * shown, in place) and goes quiet when nothing is moving; leaving the editor puts the bay back where
 * it was scrolled.
 */
const PAGE_SIZE = 60;
const POLL_MS = 4000;

export default function AiEditingWorkspace({ projectId, projectName = "", folder = null, scopeLabel = "", expanded = false, onExpandedChange = null, canWrite = false, canSendToAlbum = false, onOpenAlbum = null, refreshKey = 0, onChanged }) {
  const folderId = folder?.id || null;
  const [search, setSearch] = useState("");
  const [capabilities, setCapabilities] = useState(null);
  const [selected, setSelected] = useState(() => new Set());
  // The photo the editor is open on, as it was opened. What the editor is given is the bay's
  // current row for that id (a save, a render or a send has updated it since), so moving away and
  // back shows what was saved; the opened row stands in only while the page no longer lists it.
  const [open, setOpen] = useState(null);
  // A move that needs the next batch first (Right off the last loaded photo, End): both moves rest
  // until it has arrived.
  const [moving, setMoving] = useState(false);
  // Edits whose save failed on the way out of a photo, by upload id: the sliders as they were
  // left, so reopening the photo restores them and offers Retry instead of losing the work.
  const [unsaved, setUnsaved] = useState(() => new Map());
  // The way of comparing (Before / After, Split, Side by side), kept from photo to photo.
  const [compareMode, setCompareMode] = useState("toggle");
  // The editor takes the full width while a photo is open - the preview and the controls need
  // the room the tree and the rail take - and gives it back on the way out, as the culling
  // review's wide mode does.
  // Where the bay was scrolled when the editor opened, put back when it closes.
  const rootRef = useRef(null);
  const scrollMemo = useRef(null);
  const rememberScroll = () => { scrollMemo.current = scrollParentOf(rootRef.current)?.scrollTop ?? null; };
  const openPhoto = (photo) => { rememberScroll(); setOpen(photo); onExpandedChange?.(true); };
  const closePhoto = () => { setMoving(false); setOpen(null); setFocus(null); onExpandedChange?.(false); };
  // Edit Selected: the editor walks the ticked photos only, by id, in the order they were frozen
  // when it began (the ticked photos on this page in the bay's order, then any ticked elsewhere).
  // A photo off this page is fetched by id, so paging, a search or a refresh never changes which
  // photos are walked. Leaving it returns to the bay with the ticks as they were.
  const [focus, setFocus] = useState(null);
  const [focusLoading, setFocusLoading] = useState(false);
  const { notice, showNotice, showSuccess, showError, clearNotice } = useNotice();

  // The bay: one list per project, folder and search; the endpoint's paging read batch by batch.
  const listKey = `${projectId}|${folderId || ""}|${search}`;
  const fetchPage = useCallback((page, pageSize) => listAiEditingPhotos(projectId, { folderId, page, pageSize, search })
    .then((response) => ({ items: response.data?.items || [], total: response.data?.pagination?.total || 0, counts: response.data?.counts || null })), [projectId, folderId, search]);
  const bay = useIncrementalPages({ key: listKey, fetchPage, pageSize: PAGE_SIZE });
  const { refresh, updateItems } = bay;
  // A quiet re-read of everything shown, in place - after a send, a save, an upload elsewhere.
  const load = useCallback(() => refresh(), [refresh]);
  const firstRefresh = useRef(refreshKey);
  useEffect(() => { if (firstRefresh.current === refreshKey) return; firstRefresh.current = refreshKey; refresh(); }, [refreshKey, refresh]);
  useEffect(() => { if (bay.firstError) showError(bay.firstError); }, [bay.firstError, showError]);
  // Back from the editor: the bay where it was scrolled.
  useEffect(() => {
    if (open || scrollMemo.current === null) return;
    const scroller = scrollParentOf(rootRef.current);
    if (scroller) scroller.scrollTop = scrollMemo.current;
    scrollMemo.current = null;
  }, [open]);
  useEffect(() => {
    let active = true;
    // A failed answer is shown as unknown, never as fine.
    getAiEditingCapabilities(projectId).then((response) => { if (active) setCapabilities(response.data); }).catch(() => { if (active) setCapabilities({ engine: { status: "unknown" }, tools: null }); });
    return () => { active = false; };
  }, [projectId]);

  const photos = bay.items;
  const loading = bay.loading;
  // Quiet re-reads while anything is still moving; nothing when the bay is at rest.
  const polling = editingNeedsPolling(photos);
  // Quiet re-reads keep going while the editor is open too: a batch's progress is these counts.
  useEffect(() => {
    if (!polling) return undefined;
    const timer = window.setInterval(() => load(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [polling, load]);

  const engine = editingEngineStatus(capabilities);
  const counts = bay.extra?.counts;
  const total = bay.total;
  const toggle = (id) => setSelected((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const selectable = photos.filter((photo) => photo.status === "READY");
  const allSelected = selectable.length > 0 && selectable.every((photo) => selected.has(photo.id));
  const selectAll = () => setSelected(new Set(selectable.map((photo) => photo.id)));
  const empty = !loading && photos.length === 0 && !search;
  const floatingNotice = <FloatingNotice notice={notice} onClose={clearNotice} />;

  // Where the open photo sits in the loaded bay, and the row the editor is given.
  const openIndex = open ? photos.findIndex((photo) => photo.id === open.id) : -1;
  const current = openIndex >= 0 ? photos[openIndex] : open;
  // Moving along the bay: by index in the loaded list; Right off the last loaded photo loads the
  // next batch and moves on, End loads every remaining batch and opens the last photo. The list
  // clamps - the culling review's rule - so nothing wraps around. Nothing moves while a batch is
  // loading, or while the open photo is not in the list (a search narrowed it away).
  // `viaButton` says the move came from the header's button, so focus is put back on it after
  // the panel is swapped (the panel is keyed by photo, so the button is remade).
  const focusAfter = useRef(null);
  // Opens one walked photo by id: the bay's row when this page has it, else the photo fetched.
  const openWalked = useCallback(async (id) => {
    const row = photos.find((photo) => photo.id === id);
    if (row) { setOpen(row); return; }
    setFocusLoading(true);
    try { const response = await getAiEditingPhoto(projectId, id); setOpen(response.data); } catch (error) { showError(error.message || "Unable to open that photo."); } finally { setFocusLoading(false); }
  }, [photos, projectId, showError]);
  const navigate = useCallback((direction, { viaButton = false } = {}) => {
    if (focus) {
      if (!open || focusLoading) return;
      focusAfter.current = viaButton ? direction : null;
      const target = editingNavigationTarget(direction, focus.ids.indexOf(open.id), focus.ids.length);
      if (target !== null) openWalked(focus.ids[target]);
      return;
    }
    if (!open || loading || openIndex < 0 || moving) return;
    focusAfter.current = viaButton ? direction : null;
    const needsMore = bay.hasMore && (direction === "last" || (direction === "next" && openIndex === photos.length - 1));
    if (needsMore) {
      setMoving(true);
      const from = openIndex;
      (direction === "last" ? bay.loadAll() : bay.loadMore())
        .then((list) => { if (list?.length) setOpen(direction === "last" ? list[list.length - 1] : list[Math.min(list.length - 1, from + 1)]); })
        .finally(() => setMoving(false));
      return;
    }
    const target = editingNavigationTarget(direction, openIndex, photos.length);
    if (target !== null) setOpen(photos[target]);
  }, [focus, focusLoading, openWalked, open, loading, openIndex, photos, moving, bay]);
  // Edit Selected begins at the first walked photo; the ticks stay as they are throughout.
  const startFocus = () => {
    const ids = editingFocusOrder(selected, photos);
    if (!ids.length) return;
    setFocus({ ids });
    rememberScroll();
    onExpandedChange?.(true);
    openWalked(ids[0]);
  };
  // After a move made with the header's button, focus goes back to that button on the new panel.
  const openId = open?.id || null;
  useEffect(() => {
    const direction = focusAfter.current;
    if (!openId || !direction) return;
    focusAfter.current = null;
    document.querySelector(`[aria-label="${direction === "prev" ? "Previous photo" : "Next photo"}"]`)?.focus();
  }, [openId]);
  // One keydown listener while the editor is open. The ref mirrors the latest `navigate` so the
  // once-bound listener reads fresh state; written in an effect, never during render. A key typed
  // into a field, a slider, a menu or a dialog is that control's (`cullingKeyIgnored`), arrows on
  // the compare tabs are the tabs', and while any dialog is open every key is the dialog's.
  const navigateRef = useRef(navigate);
  useEffect(() => { navigateRef.current = navigate; });
  const editorOpen = Boolean(open);
  useEffect(() => {
    if (!editorOpen) return undefined;
    function keydown(event) {
      const direction = editingNavigationKey(event);
      if (!direction || event.defaultPrevented || cullingKeyIgnored(event.target, event)) return;
      if (document.querySelector('[role="dialog"]') || event.target?.closest?.('[role="tablist"]')) return;
      event.preventDefault();
      navigateRef.current(direction);
    }
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [editorOpen]);
  // Escape leaves the editor the way "All photos" does (the panel saves on its way out) - through
  // the one Escape stack, so a dialog or menu open over the editor takes the key first.
  useEscapeKey(() => { closePhoto(); load(); onChanged?.(); }, editorOpen);
  // Where the photo sits in the whole bay; both moves rest while a batch a move needs is loading.
  const position = focus
    ? editingFocusPosition(focus.ids, open?.id, focusLoading)
    : open && openIndex >= 0
      ? { index: openIndex, total, canPrev: !loading && !moving && openIndex > 0, canNext: !loading && !moving && (openIndex < photos.length - 1 || bay.hasMore) }
      : null;
  // A save that failed as the photo was left: the sliders are kept for the photo's next opening,
  // and the notice offers the way back. `null` clears the record once a save has gone through.
  const onUnsavedChange = (uploadId, recipe, fileName) => {
    setUnsaved((current) => { if (!recipe && !current.has(uploadId)) return current; const next = new Map(current); if (recipe) next.set(uploadId, recipe); else next.delete(uploadId); return next; });
    if (!recipe) return;
    const row = photos.find((item) => item.id === uploadId);
    showNotice(`Your changes to ${fileName || "the photo"} were not saved. Open the photo and retry.`, "error", row ? { label: "Open photo", onSelect: () => openPhoto(row) } : undefined);
  };

  if (open) {
    return (
      <div className="w-full">
        {floatingNotice}
        {/* One live region outside the keyed panel, so a move is announced ("Photo 4 of 20, ...")
            - a region made already filled, as the panel's would be, is not read out. */}
        <p className="sr-only" role="status" aria-live="polite">{position ? `${focus ? "Selected photo" : "Photo"} ${position.index + 1} of ${position.total}, ${current?.fileName || ""}` : ""}</p>
        {focus && (
          <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900" role="status">
            <span className="min-w-0 flex-1">Editing selected photos only - {focus.ids.length} photo{focus.ids.length === 1 ? "" : "s"}. The arrows move between these alone; each keeps its own edit.</span>
            <Button variant="secondary" size="sm" onClick={() => { closePhoto(); load(true); onChanged?.(); }}>Exit selected editing</Button>
          </div>
        )}
        <EditingPanel
          key={open.id}
          projectId={projectId}
          photo={current}
          capabilities={capabilities}
          canWrite={canWrite}
          canSendToAlbum={canSendToAlbum}
          position={position}
          onNavigate={navigate}
          unsavedRecipe={unsaved.get(open.id) || null}
          onUnsavedChange={onUnsavedChange}
          compareMode={compareMode}
          onCompareModeChange={setCompareMode}
          onBack={() => { closePhoto(); load(true); onChanged?.(); }}
          onPhotoChange={(next) => { updateItems((items) => items.map((item) => (item.id === next.id ? next : item))); setOpen((was) => (was && was.id === next.id && openIndex < 0 ? next : was)); }}
          onNotice={(message, tone, action) => (tone === "error" ? showError(message) : showNotice(message, tone || "success", action))}
          onOpenAlbum={onOpenAlbum}
          selectedIds={[...selected].filter((id) => id !== open.id)}
          scopeTotal={counts?.ready || 0}
          folderId={folderId}
          batchCounts={counts}
          onBatchQueued={() => load(true)}
        />
      </div>
    );
  }

  return (
    <div ref={rootRef} className="w-full">
      {floatingNotice}
      {/* The header and the search row stay in view while the bay scrolls: sticky inside the tab's
          own scrolling pane (no second scrollbar). It is pulled up over the pane's top padding
          (-mt / pt of the same size, -top of the same size), so it sits flush with the pane's top
          edge at every width and the photos pass beneath its opaque background. */}
      <div className="sticky -top-5 z-20 -mx-5 -mt-5 mb-3 border-b border-slate-200 bg-white px-5 pb-3 pt-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-slate-800">AI Editing</h2>
          <p className="truncate text-xs text-slate-500" title={scopeLabel}>Folder: {scopeLabel || "Whole project"}{counts ? ` · ${editingCountsLine(counts)}` : ""}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`${PROGRESS_CHIP_CLASS} rounded-full px-2 py-1 text-[11px] font-semibold`} style={progressChipStyle(engine.color)} title={capabilities?.engine?.reason || undefined}><span role="status">{engine.label}</span></span>
        </div>
      </div>
      {(photos.length > 0 || search) && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <SearchField value={search} onChange={(value) => setSearch(value)} placeholder="Search file names" ariaLabel="Search photos" className="w-full sm:w-64" />
          {selectable.length > 0 && <Button variant="ghost" size="sm" onClick={allSelected ? () => setSelected(new Set()) : selectAll}>{allSelected ? "Deselect all" : `Select all loaded (${selectable.length})`}</Button>}
        </div>
      )}
      </div>

      {capabilities?.engine?.status && capabilities.engine.status !== "ready" && capabilities.engine.status !== "starting" && (
        <p role="status" className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
          {capabilities.engine.status === "disabled" ? "AI Editing's render engine is switched off on this server. Photos can still be added here and sent on as they are; edits will render once it is on."
            : capabilities.engine.status === "unknown" ? "The render engine's status could not be read. Photos can be added and sent on; an edit you apply may wait until the server answers."
            : "The render engine is not answering right now. Edits you apply wait in the queue until it is back."}
        </p>
      )}

      {/* No browser upload here: photos are imported and processed through the desktop app, or
          sent here from AI Culling. The web reviews what arrives. */}
      {empty && (
        <div className="mx-auto grid min-h-[200px] max-w-[720px] place-items-center rounded-xl border border-dashed border-slate-300 bg-slate-50/60 px-5 text-center text-sm text-slate-500" role="status">
          <div>
            <p>No photos are available for AI Editing {folder ? "under this folder" : "yet"}.</p>
            <p className="mt-1 text-xs">Photos are imported and processed through the DBS Desktop application{canWrite ? ", or sent here from AI Culling (tick photos, then Send to AI Editing)" : ""}.</p>
          </div>
        </div>
      )}

      {loading ? (
        <div className="grid min-h-[200px] place-items-center"><Loader label="Loading photos..." size="sm" inline /></div>
      ) : photos.length > 0 ? (
        <EditingPhotoGrid photos={photos} selected={selected} onToggle={toggle} onOpen={openPhoto} canSelect />
      ) : search ? (
        <p className="py-12 text-center text-xs text-slate-500">No photos match that search.</p>
      ) : null}

      {/* One continuous bay: the next batch loads as the end comes near; no Previous / Next. */}
      {!loading && <IncrementalListFooter list={bay} resetKey={listKey} />}

      {selected.size > 0 && (
        <div className="sticky bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-10 mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-800 shadow-lg ring-1 ring-slate-900/5">
          <span className="text-xs font-medium" aria-live="polite">{selected.size} selected</span>
          {/* The bar is the app's own surface: light classes the [data-theme] rules remap in the dark
              themes (globals.css), so it reads in light and dark alike - never a fixed navy slab. */}
          <Button size="none" variant="plain" onClick={startFocus} className="min-h-10 rounded-md bg-blue-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-blue-700 sm:min-h-8" title="Open the editor on the ticked photos only">Edit selected</Button>
          <EditedDownloadButton
            projectId={projectId}
            uploadIds={[...selected]}
            label="Download selected edited"
            variant="plain"
            buttonClassName="min-h-10 rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 sm:min-h-8"
            title="Download the saved edits of the ticked photos - photos not edited are left out"
            onNotice={(message, tone) => (tone === "error" ? showError(message) : showNotice(message, tone))}
          />
          <SendPhotosActions
            projectId={projectId}
            uploadIds={[...selected]}
            from="editing"
            canSendToAlbum={canSendToAlbum}
            buttonClassName="min-h-10 rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 sm:min-h-8"
            onDone={(summary, destination, openTab) => { setSelected(new Set()); load(true); onChanged?.(); showSuccess(summary, openTab ? { label: "Open Signature Album", onSelect: openTab } : undefined); }}
            onError={showError}
            onOpenAlbum={onOpenAlbum}
          />
          <Button size="none" variant="plain" onClick={() => setSelected(new Set())} className="ml-auto min-h-10 rounded px-2 py-1 text-[11px] text-slate-500 hover:bg-slate-50 hover:text-slate-800 sm:min-h-8">Deselect</Button>
        </div>
      )}
    </div>
  );
}
