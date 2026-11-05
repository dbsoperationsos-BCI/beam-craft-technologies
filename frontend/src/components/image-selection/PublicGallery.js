"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import FloatingNotice from "@/components/shared/FloatingNotice";
import PinGate from "./client-gallery/PinGate";
import FolderCards from "./client-gallery/FolderCards";
import FolderGrid from "./client-gallery/FolderGrid";
import ImageViewer from "./client-gallery/ImageViewer";
import ReviewSelected from "./client-gallery/ReviewSelected";
import SelectionPinDialog from "./client-gallery/SelectionPinDialog";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { getGalleryMeta, verifyGalleryPin, startGalleryPreview, listGalleryFolders, listGalleryFolderImages, listGallerySelected, submitGallerySelection, setGalleryImageSelection, clearGallerySelection, listGalleryPeople } from "@/services/image-selection/public-gallery.service";
import { getGallerySession, isGalleryPreviewSession, setGallerySession, setGalleryPreviewSession, clearGallerySession } from "@/lib/gallerySession";
import Loader from "@/components/shared/Loader";

const PAGE_SIZE = 60;

export default function PublicGallery({ token }) {
  const [meta, setMeta] = useState(null);
  const [sessionToken, setSessionTokenState] = useState(null);
  // Browsing via "View Photos" gets the whole gallery read-only; the PIN is only demanded when
  // the client reaches for something that records a choice. `pendingAction` is what they were
  // trying to do, replayed once the PIN checks out so the click is not simply swallowed.
  const [preview, setPreview] = useState(false);
  const [pendingAction, setPendingAction] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const [folders, setFolders] = useState([]);
  const [deliverables, setDeliverables] = useState([]);
  const [overall, setOverall] = useState({ total: 0, selected: 0 });
  const [selectionCounts, setSelectionCounts] = useState({});

  const [activeFolderId, setActiveFolderId] = useState(null);
  const [activeFolderGroupId, setActiveFolderGroupId] = useState(null);
  const [activeDeliverableId, setActiveDeliverableId] = useState(null);
  const [tab, setTab] = useState("all");
  const [items, setItems] = useState([]);
  const [page, setPage] = useState(1);
  const [counts, setCounts] = useState({ all: 0, selected: 0 });
  const [pagination, setPagination] = useState({ totalPages: 1 });
  const [gridLoading, setGridLoading] = useState(false);
  // The People filter inside a folder: who was found there, and which of them the grid is narrowed
  // to - several at once, meaning photos any of them is in. A filter over the same listing and
  // nothing more: it owns no photo-selection state (people picked ≠ photos picked), and it is
  // empty (so the row is absent) whenever the studio has no face processing or it has not run.
  const [people, setPeople] = useState([]);
  const [activePersonIds, setActivePersonIds] = useState([]);

  const [viewerIndex, setViewerIndex] = useState(null);
  // Which list the viewer is paging through: the folder grid, or the home page's Selected tab.
  const [viewerScope, setViewerScope] = useState("folder");
  // The home page's own tabs. "selected" shows what the client has picked for the selection item
  // in the sidebar, laid out like the in-folder grid so it can still be changed from there.
  const [homeTab, setHomeTab] = useState("all");
  const [homeSelected, setHomeSelected] = useState([]);
  const [homeSelectedLoading, setHomeSelectedLoading] = useState(false);
  // Deselect All asks first — it releases every pick for the item at once — and says so while it runs.
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [reviewCanSend, setReviewCanSend] = useState(false);
  const [selectedItems, setSelectedItems] = useState([]);
  const [selectionSent, setSelectionSent] = useState(false);
  // Which selection item Review & Submit is reviewing. Submission happens one item at a time —
  // the engagement album is filled months before the wedding album — so the review shows only
  // that item and the send names it to the server. Null while merely viewing.
  const [reviewScope, setReviewScope] = useState(null);

  const loadMeta = useCallback(async () => {
    setLoading(true);
    try { const response = await getGalleryMeta(token); setMeta(response.data); setError(""); }
    catch (metaError) { setError(metaError.message || "This gallery link is unavailable."); }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { loadMeta(); }, [loadMeta]);
  // Writes read the session from a ref: a pending action replayed straight after the PIN is
  // accepted would otherwise still be holding the preview token from its own render.
  const sessionRef = useRef(null);
  const applySession = useCallback((next, isPreview) => { sessionRef.current = next; setSessionTokenState(next); setPreview(isPreview); }, []);
  useEffect(() => { applySession(getGallerySession(token), isGalleryPreviewSession(token)); }, [token, applySession]);

  const loadFolders = useCallback(async (sess) => {
    try {
      const response = await listGalleryFolders(token, sess);
      setFolders(response.data.folders); setDeliverables(response.data.deliverables || []); setOverall(response.data.overall); setSelectionCounts(response.data.selectionCounts || {}); setError("");
    } catch (foldersError) {
      if (foldersError.status === 401) { clearGallerySession(token); setSessionTokenState(null); }
      else setError(foldersError.message || "Unable to load gallery.");
    }
  }, [token]);

  useEffect(() => { if (sessionToken) loadFolders(sessionToken); }, [sessionToken, loadFolders]);
  useEffect(() => {
    if (activeDeliverableId || !deliverables.length) return;
    // A submitted item is locked, so the gallery opens on one the client can still work on;
    // only when every item is submitted does the first of them stand in, read-only.
    const first = deliverables.find((item) => item.enabled !== false && !item.submittedAt) || deliverables.find((item) => item.enabled !== false);
    if (!first) return;
    setActiveDeliverableId(first.id);
    // A selection item derived from Post Production Allocation names the shoot it belongs to, and
    // opens that shoot's folder. One the studio typed on a manually named project has no shoot —
    // it applies to the whole project — so it opens the first folder the project has. Without this
    // the gallery opened no folder at all and the client was shown an empty project.
    const shootName = (first.shoot?.shoot || "").trim().toLowerCase();
    const outer = shootName
      ? folders.find((folder) => !folder.parentId && folder.name.trim().toLowerCase() === shootName)
      : folders.find((folder) => !folder.parentId);
    if (outer) setActiveFolderGroupId(outer.folderId);
  }, [activeDeliverableId, deliverables, folders]);

  async function handleVerifyPin(pin) {
    const response = await verifyGalleryPin(token, pin);
    setGallerySession(token, response.data.sessionToken);
    applySession(response.data.sessionToken, false);
  }

  async function handleViewPhotos() {
    const response = await startGalleryPreview(token);
    setGalleryPreviewSession(token, response.data.sessionToken);
    applySession(response.data.sessionToken, true);
  }

  // Returns true when the caller may go ahead. In preview it instead parks the action and
  // raises the PIN dialog.
  function requirePin(action) {
    if (!preview) return true;
    setPendingAction(() => action);
    return false;
  }

  async function unlockSelection(pin) {
    const action = pendingAction;
    await handleVerifyPin(pin);
    setPendingAction(null);
    await action?.();
  }

  // Only the latest listing asked for may land: a person pressed while the previous person's page
  // was still on its way would otherwise arrive last and be shown under the wrong filter.
  const imagesRequest = useRef(0);
  const loadFolderImages = useCallback(async (folderId, nextPage, currentTab, personIds = []) => {
    const request = ++imagesRequest.current;
    setGridLoading(true);
    try {
      const response = await listGalleryFolderImages(token, sessionToken, folderId, { page: nextPage, pageSize: PAGE_SIZE, selected: currentTab === "selected" ? "selected" : "all", deliverableConfigId: activeDeliverableId || undefined, personId: personIds.length ? personIds.join(",") : undefined });
      if (request !== imagesRequest.current) return;
      setItems((prev) => (nextPage === 1 ? response.data.items : [...prev, ...response.data.items]));
      setCounts(response.data.counts); setPagination(response.data.pagination); setPage(nextPage);
    } catch (imagesError) {
      if (request !== imagesRequest.current) return;
      if (imagesError.status === 401) { clearGallerySession(token); setSessionTokenState(null); }
      else setError(imagesError.message || "Unable to load photos.");
    } finally { if (request === imagesRequest.current) setGridLoading(false); }
  }, [token, sessionToken, activeDeliverableId]);

  // Who was found in the folder. Never an error on screen: a gallery whose face processing is
  // off, has not run or cannot answer simply has no People row, and everything else carries on.
  const loadPeople = useCallback(async (folderId) => {
    try { const response = await listGalleryPeople(token, sessionToken, folderId); setPeople(response.data?.people || []); }
    catch { setPeople([]); }
  }, [token, sessionToken]);

  // The Selected tab is scoped to the selection item in the sidebar, and every photo on it is one
  // the client picked, so each carries `selected` for the grid's tick. Unpicking flips that flag
  // rather than dropping the tile, which would make the photo vanish from under the cursor.
  const loadHomeSelected = useCallback(async (deliverableId) => {
    if (!deliverableId) { setHomeSelected([]); return; }
    setHomeSelectedLoading(true);
    try {
      const collected = [];
      let nextPage = 1;
      let totalPages = 1;
      do {
        const response = await listGallerySelected(token, sessionRef.current, { page: nextPage, pageSize: 100 });
        collected.push(...response.data.items);
        totalPages = response.data.pagination.totalPages;
        nextPage += 1;
      } while (nextPage <= totalPages);
      setHomeSelected(collected
        .filter((image) => (image.photoSelections || []).some((selection) => selection.imageSelectionDeliverableConfigId === deliverableId))
        .map((image) => ({ ...image, selected: true })));
      setError("");
    } catch (selectedError) {
      setError(selectedError.message || "Unable to load selected photos.");
    } finally {
      setHomeSelectedLoading(false);
    }
  }, [token]);

  // Switching selection item while the tab is open re-scopes it, so the fetch hangs off both.
  useEffect(() => { if (homeTab === "selected") loadHomeSelected(activeDeliverableId); }, [homeTab, activeDeliverableId, loadHomeSelected]);

  function changeHomeTab(nextTab, force = false) {
    // Picking is a write, so the Selected tab is behind the PIN the same way the grid's tick is.
    if (nextTab === "selected" && !force && !requirePin(() => changeHomeTab(nextTab, true))) return;
    setHomeTab(nextTab);
  }

  // Opening a folder starts from All - the person is a filter on one folder's listing, not a place.
  function openFolder(folderId) { setActiveFolderId(folderId); setTab("all"); setActivePersonIds([]); setPeople([]); setItems([]); setPage(1); loadFolderImages(folderId, 1, "all"); loadPeople(folderId); }
  function changeTab(nextTab, force = false) {
    if (nextTab === "selected" && !force && !requirePin(() => changeTab(nextTab, true))) return;
    setTab(nextTab); setItems([]); setPage(1); loadFolderImages(activeFolderId, 1, nextTab, activePersonIds);
  }
  // The People filter: the same folder and tab, narrowed to the photos any of the chosen people
  // are in. Pressing a person adds them, pressing them again takes them out, and null (All, or
  // Clear) empties the set for the whole folder again. The selection on each photo comes back from
  // the server with the listing, so a photo ticked under one person is ticked under every other.
  function selectPerson(personId) {
    const next = personId === null ? [] : activePersonIds.includes(personId) ? activePersonIds.filter((id) => id !== personId) : [...activePersonIds, personId];
    setActivePersonIds(next); setItems([]); setPage(1); loadFolderImages(activeFolderId, 1, tab, next);
  }
  // Coming back with the Selected tab open refetches it, so photos ticked inside the folder are
  // waiting on the tab rather than missing until the next tab switch.
  function backToFolders() { setActiveFolderId(null); setActivePersonIds([]); setPeople([]); setItems([]); loadFolders(sessionToken); if (homeTab === "selected") loadHomeSelected(activeDeliverableId); }

  async function openReview(canSend = true, force = false) {
    if (!force && !requirePin(() => openReview(canSend, true))) return;
    setGridLoading(true);
    try {
      const collected = [];
      let nextPage = 1;
      let totalPages = 1;
      do {
        const response = await listGallerySelected(token, sessionToken, { page: nextPage, pageSize: 100 });
        collected.push(...response.data.items);
        totalPages = response.data.pagination.totalPages;
        nextPage += 1;
      } while (nextPage <= totalPages);
      // Review & Submit sends one selection item — the one the client is working in — so it
      // reviews only that item. "View Selected" still shows everything, read-only.
      if (canSend) {
        const activeItem = deliverables.find((item) => item.id === activeDeliverableId);
        setReviewScope(activeItem ? { itemId: activeItem.id, itemName: activeItem.name || null, deliverableIds: [activeItem.id] } : null);
      } else {
        setReviewScope(null);
      }
      setSelectedItems(collected);
      setReviewCanSend(canSend);
      setSelectionSent(false);
      setReviewing(true);
      setError("");
    } catch (reviewError) {
      setError(reviewError.message || "Unable to load selected photos.");
    } finally {
      setGridLoading(false);
    }
  }

  async function sendSelection() {
    await submitGallerySelection(token, sessionRef.current, reviewScope?.itemId ?? null);
    setSelectionSent(true);
    // The submitted item is now locked server-side; reloading pulls the submitted flags so the
    // sidebar greys it out and every other item stays selectable.
    await loadFolders(sessionRef.current);
  }

  // `deliverableId` lets the grid's "Add to" menu file a photo under any selection item of the
  // current shoot. The grid's own tick and the folder counts only track the deliverable the
  // folder was opened for, so they stay put when the photo goes to a different one.
  async function toggleSelect(image, deliverableId, force = false) {
    if (!force && !requirePin(() => toggleSelect(image, deliverableId, true))) return;
    const target = deliverableId || activeDeliverableId;
    // A submitted item is locked. The server refuses the write too; catching it here keeps the
    // optimistic tick from flashing on and off.
    const targetItem = deliverables.find((item) => item.id === target);
    if (targetItem?.submittedAt) { setError(`Your selection for ${targetItem.name} has already been submitted and can no longer be changed.`); return; }
    const forActive = !target || target === activeDeliverableId;
    const nextSelected = forActive ? !image.selected : !(image.photoSelections || []).some((selection) => selection.imageSelectionDeliverableConfigId === target);
    const withSelection = (item) => ({
      ...item,
      ...(forActive ? { selected: nextSelected } : {}),
      photoSelections: target
        ? nextSelected
          ? [...(item.photoSelections || []).filter((selection) => selection.imageSelectionDeliverableConfigId !== target), { imageSelectionDeliverableConfigId: target }]
          : (item.photoSelections || []).filter((selection) => selection.imageSelectionDeliverableConfigId !== target)
        : item.photoSelections,
    });
    const step = nextSelected ? 1 : -1;
    // The folder cards count per selection item, so the optimistic bump has to land on the item
    // being toggled rather than only on the folder's any-item total. `loadFolders` below replaces
    // both with the server's answer a moment later.
    const bumpFolder = (folder) => ({
      ...folder,
      selected: Math.max(0, (folder.selected || 0) + step),
      ...(target ? { selectedByDeliverable: { ...folder.selectedByDeliverable, [target]: Math.max(0, (folder.selectedByDeliverable?.[target] || 0) + step) } } : {}),
    });
    setItems((prev) => prev.map((item) => (item.id === image.id ? withSelection(item) : item)));
    // The home page's Selected tab keeps the unpicked tile in place, unticked, rather than
    // dropping it — the photo would otherwise vanish from under the cursor with no way to re-tick.
    setHomeSelected((prev) => prev.map((item) => (item.id === image.id ? withSelection(item) : item)));
    if (forActive) {
      setCounts((prev) => ({ ...prev, selected: prev.selected + step }));
      setFolders((prev) => prev.map((folder) => ((folder.folderId || "unfiled") === activeFolderId ? bumpFolder(folder) : folder)));
    }
    try { await setGalleryImageSelection(token, sessionRef.current, image.id, nextSelected, target); await loadFolders(sessionRef.current); }
    catch (selectionError) {
      setItems((prev) => prev.map((item) => (item.id === image.id ? image : item)));
      setHomeSelected((prev) => prev.map((item) => (item.id === image.id ? image : item)));
      if (forActive) {
        setCounts((prev) => ({ ...prev, selected: prev.selected - step }));
        setFolders((prev) => prev.map((folder) => ((folder.folderId || "unfiled") === activeFolderId ? {
          ...folder,
          selected: Math.max(0, (folder.selected || 0) - step),
          ...(target ? { selectedByDeliverable: { ...folder.selectedByDeliverable, [target]: Math.max(0, (folder.selectedByDeliverable?.[target] || 0) - step) } } : {}),
        } : folder)));
      }
      // A preview session that slipped through — ask for the PIN rather than showing an error.
      if (selectionError.status === 403) setPendingAction(() => () => toggleSelect(image, deliverableId, true));
      else setError(selectionError.message || "Unable to update your selection.");
    }
  }

  /**
   * Deselect All: every photo picked for the selection item on screen, released together.
   *
   * Behind the PIN like every other write, and refused on a submitted item — the server checks
   * both again. One request rather than one per photo, so clearing hundreds of picks is a single
   * round trip; the lists are then re-read from the server rather than patched, because the
   * answer is simply "none of them".
   */
  async function deselectAll(force = false) {
    if (!force && !requirePin(() => deselectAll(true))) return;
    const target = deliverables.find((item) => item.id === activeDeliverableId);
    if (!target) return;
    if (target.submittedAt) { setError(`Your selection for ${target.name} has already been submitted and can no longer be changed.`); return; }
    setClearing(true);
    try {
      await clearGallerySelection(token, sessionRef.current, target.id);
      setItems((prev) => prev.map((item) => ({ ...item, selected: false, photoSelections: (item.photoSelections || []).filter((selection) => selection.imageSelectionDeliverableConfigId !== target.id) })));
      setHomeSelected([]);
      setCounts((prev) => ({ ...prev, selected: 0 }));
      await loadFolders(sessionRef.current);
      setError("");
    } catch (clearError) {
      if (clearError.status === 403) setPendingAction(() => () => deselectAll(true));
      else setError(clearError.message || "Unable to clear your selection.");
    } finally {
      setClearing(false);
      setConfirmClear(false);
    }
  }

  const activeFolderMeta = folders.find((folder) => (folder.folderId || "unfiled") === activeFolderId);
  const folderIndex = folders.findIndex((folder) => (folder.folderId || "unfiled") === activeFolderId);

  if (loading) return <main className="grid min-h-screen place-items-center bg-white"><Loader label="Loading gallery..." size="lg" /></main>;
  if (error && !meta) return <main className="grid min-h-screen place-items-center bg-white px-5 text-center"><div><h1 className="text-xl font-semibold text-slate-900">Gallery unavailable</h1><p className="mt-2 text-sm text-slate-500">{error}</p></div></main>;
  if (!sessionToken) return <PinGate {...meta} onVerify={handleVerifyPin} onViewPhotos={handleViewPhotos} />;
  const pinDialog = pendingAction ? <SelectionPinDialog onVerify={unlockSelection} onClose={() => setPendingAction(null)} /> : null;
  // Selection messages — the per-item limit, an item already submitted, a refused write — rise as
  // the shared snackbar rather than a strip pinned inside the page, so they read the same wherever
  // the tick happened: the folder cards, the grid, or the fullscreen viewer, which sits at z-50
  // below the snackbar's z-[200].
  const floatingNotice = <FloatingNotice notice={error} onClose={() => setError("")} />;
  // Clearing a whole selection cannot be undone by pressing again, so it is asked for once.
  const activeItem = deliverables.find((item) => item.id === activeDeliverableId);
  const clearDialog = confirmClear ? <ConfirmDialog
    title={`Deselect all photos for ${activeItem?.name || "this selection item"}?`}
    message={`This releases all ${selectionCounts[activeDeliverableId] || 0} photos you have picked for it. You can pick them again afterwards.`}
    confirmLabel="Deselect all"
    busyLabel="Deselecting..."
    loading={clearing}
    onCancel={() => setConfirmClear(false)}
    onConfirm={() => deselectAll()}
  /> : null;
  // if (!sessionToken) return <PinGate projectName={meta?.projectName || "Photo Gallery"} onVerify={handleVerifyPin} />;

  if (reviewing) {
    // Scoped to the selection item being submitted: other deliverables are left out of the map,
    // so a photo also picked for a later item only appears under the item going out now.
    const reviewDeliverables = reviewScope ? deliverables.filter((item) => reviewScope.deliverableIds.includes(item.id)) : deliverables;
    return <>{pinDialog}<ReviewSelected items={selectedItems} folders={folders} deliverables={reviewDeliverables} itemName={reviewScope?.itemName} projectName={meta?.projectName || ""} studioName={meta?.studioName} galleryLogoUrl={meta?.galleryLogoUrl} sessionToken={sessionToken} sent={selectionSent} canSend={reviewCanSend} onBack={() => setReviewing(false)} onSend={sendSelection} /></>;
  }

  // The viewer pages through whichever list the photo was opened from — the folder grid, or the
  // home page's Selected tab, which exists while no folder is open.
  const viewerItems = viewerScope === "home" ? homeSelected : items;
  if (viewerIndex !== null && viewerItems[viewerIndex]) {
    return (
      <>
      {pinDialog}
      {floatingNotice}
      <ImageViewer
        image={viewerItems[viewerIndex]}
        index={viewerIndex}
        total={viewerItems.length}
        selectedCount={viewerScope === "home" ? (activeDeliverableId ? selectionCounts[activeDeliverableId] || 0 : homeSelected.length) : counts.selected}
        sessionToken={sessionToken}
        onClose={() => setViewerIndex(null)}
        onPrev={() => setViewerIndex((value) => Math.max(0, value - 1))}
        onNext={() => setViewerIndex((value) => Math.min(viewerItems.length - 1, value + 1))}
        hasPrev={viewerIndex > 0}
        hasNext={viewerIndex < viewerItems.length - 1}
        onToggleSelect={toggleSelect}
        deliverables={deliverables}
      />
      </>
    );
  }

  if (activeFolderId) {
    return (
      <>
      {pinDialog}
      {floatingNotice}
      <FolderGrid
        projectName={meta?.projectName || ""}
        folderName={activeFolderMeta?.name || "Photos"}
        tab={tab}
        onTabChange={changeTab}
        counts={counts}
        items={items}
        sessionToken={sessionToken}
        onToggleSelect={toggleSelect}
        onOpenImage={(image) => { setViewerScope("folder"); setViewerIndex(items.findIndex((item) => item.id === image.id)); }}
        onBack={backToFolders}
        onLoadMore={() => loadFolderImages(activeFolderId, page + 1, tab, activePersonIds)}
        hasMore={page < pagination.totalPages}
        loading={gridLoading}
        onPrevFolder={() => folders[folderIndex - 1] && openFolder(folders[folderIndex - 1].folderId || "unfiled")}
        onNextFolder={() => folders[folderIndex + 1] && openFolder(folders[folderIndex + 1].folderId || "unfiled")}
        hasPrevFolder={folderIndex > 0}
        hasNextFolder={folderIndex >= 0 && folderIndex < folders.length - 1}
        deliverables={deliverables}
        selectionCounts={selectionCounts}
        folders={folders}
        activeFolderGroupId={activeFolderMeta?.parentId || activeFolderGroupId}
        activeFolderId={activeFolderId}
        onOpenFolder={openFolder}
        activeDeliverableId={activeDeliverableId}
        studioName={meta?.studioName}
        galleryLogoUrl={meta?.galleryLogoUrl}
        people={people}
        activePersonIds={activePersonIds}
        onSelectPerson={selectPerson}
      />
      </>
    );
  }

  return <>{pinDialog}{clearDialog}{floatingNotice}<FolderCards client={meta} folders={folders} deliverables={deliverables} overall={overall} selectionCounts={selectionCounts} activeFolderGroupId={activeFolderGroupId} activeDeliverableId={activeDeliverableId} onSelectDeliverable={(item, outerFolderId) => { setActiveDeliverableId(item.id); setActiveFolderGroupId(outerFolderId); }} onOpenFolder={openFolder} onReviewAndSend={() => openReview(true)} onDeselectAll={() => setConfirmClear(true)} clearing={clearing} tab={homeTab} onTabChange={changeHomeTab} selectedItems={homeSelected} selectedLoading={homeSelectedLoading} sessionToken={sessionToken} onToggleSelect={toggleSelect} onOpenImage={(image) => { setViewerScope("home"); setViewerIndex(homeSelected.findIndex((item) => item.id === image.id)); }} /></>;
}
