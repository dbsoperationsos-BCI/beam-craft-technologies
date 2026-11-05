"use client";
import ExpiredClientLink from "@/components/shared/ExpiredClientLink";
import { expiredLinkFrom } from "@/lib/expiredLink.mjs";
import { useCallback, useEffect, useRef, useState } from "react";
import FloatingNotice from "@/components/shared/FloatingNotice";
import PinGate from "./client-gallery/PinGate";
import "./client-gallery/appEmbed.css";
import FolderCards from "./client-gallery/FolderCards";
import FolderGrid from "./client-gallery/FolderGrid";
import ImageViewer from "./client-gallery/ImageViewer";
import ReviewSelected from "./client-gallery/ReviewSelected";
import SelectionPinDialog from "./client-gallery/SelectionPinDialog";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { getGalleryMeta, verifyGalleryPin, startGalleryPreview, listGalleryFolders, listGalleryFolderImages, listGallerySelected, submitGallerySelection, submitAllGallerySelections, setGalleryImageSelection, clearGallerySelection, listGalleryPeople, listGalleryScenes } from "@/services/image-selection/public-gallery.service";
import { getGallerySession, isGalleryPreviewSession, setGallerySession, setGalleryPreviewSession, clearGallerySession } from "@/lib/gallerySession";
import Loader from "@/components/shared/Loader";
import { MAX_PEOPLE, personFilterLabel, railPeople, togglePerson } from "@/lib/clientGalleryPeople.mjs";
import PeoplePickerDialog from "./client-gallery/PeoplePickerDialog";
import { ALL_SCENES, activeScene, sceneLabel, sceneOptions, sceneQuery } from "@/lib/clientGalleryScenes.mjs";
import SubmitAllDialog from "./client-gallery/SubmitAllDialog";
import useSubmitOnce from "@/components/shared/useSubmitOnce";
import { galleryHeading, submitAllGroups, submittableItems } from "@/lib/clientGalleryHome.mjs";

const PAGE_SIZE = 60;
// How many people the rail is handed. It leads with as many as its width fits, which on a wide or
// zoomed-out screen is well past a dozen, so this is more than one row can hold; the rail draws
// only the faces that fit, and everybody else is reached through the picker.
const RAIL_PEOPLE = 40;
// How often the Scene filter's rows are asked for again while photos are still being read.
const SCENES_POLL_MS = 6000;

export default function PublicGallery({ token }) {
  const [meta, setMeta] = useState(null);
  const [sessionToken, setSessionTokenState] = useState(null);
  // Browsing via "View Photos" gets the whole gallery read-only; the PIN is only demanded when
  // the client reaches for something that records a choice. `pendingAction` is what they were
  // trying to do, replayed once the PIN checks out so the click is not simply swallowed.
  const [preview, setPreview] = useState(false);
  const [pendingAction, setPendingAction] = useState(null);
  const [error, setError] = useState("");
  // An expired link's details, when the gallery's link has lapsed - the shared expired page.
  const [expiredLink, setExpiredLink] = useState(null);
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

  const [viewerIndex, setViewerIndex] = useState(null);
  // Which list the viewer is paging through: the folder grid, or the home page's Selected or
  // People tab.
  const [viewerScope, setViewerScope] = useState("folder");
  // The home page's own tabs. "selected" shows what the client has picked for the selection item
  // in the sidebar, laid out like the in-folder grid so it can still be changed from there.
  // "people" is the face-recognition result for the whole gallery, with the same grid beneath it.
  const [homeTab, setHomeTab] = useState("all");
  const [homeSelected, setHomeSelected] = useState([]);
  const [homeSelectedLoading, setHomeSelectedLoading] = useState(false);
  // The People tab: who was found across the gallery (and whether the worker is still looking),
  // which of them are chosen - several at once, meaning photos all of them are in together - and the folder
  // cards counted for those people (null until the first answer). A card opens the folder view
  // with `folderPersonIds` as its filter, empty for a folder opened from All Photos. A filter over
  // the same photos and nothing more: it owns no photo-selection state (people picked ≠ photos
  // picked); the tick on each photo is the gallery's own.
  const [people, setPeople] = useState([]);
  const [peopleInfo, setPeopleInfo] = useState({ loaded: false, available: true, processing: false });
  const [activePersonIds, setActivePersonIds] = useState([]);
  const [folderPersonIds, setFolderPersonIds] = useState([]);
  /*
   * The People tab's own photo grid, with anyone chosen: every photo of the shoot in view that all
   * of them are in together, from every card of it. One listing with one more condition - the same
   * one a folder uses - so each photo is still the card's own and each tick is the gallery's own.
   */
  const [peoplePhotos, setPeoplePhotos] = useState({ items: [], loading: false, replacing: false, hasMore: false, total: 0, page: 1 });
  // How many people the gallery holds, and everybody the browser has been told about - the rail is
  // only handed the first few, so somebody chosen in the picker is looked up here to stay visible.
  const [peopleTotal, setPeopleTotal] = useState(0);
  const peopleKnown = useRef(new Map());
  const [pickerOpen, setPickerOpen] = useState(false);
  // The Scene filter beside the people: the scenes the culling run read in the shoot's photos -
  // and, with anyone chosen, in theirs - each counted, and the one in force. The whole shoot
  // until a scene is chosen; the list is counted again whenever the chosen people or the shoot
  // change, and a scene that count leaves empty falls back to all scenes (`loadScenes`).
  const [scenes, setScenes] = useState([]);
  // Photos are still being read for their scene: the rows will grow, so they are asked for again.
  const [scenesProcessing, setScenesProcessing] = useState(false);
  const [activeSceneId, setActiveSceneId] = useState(ALL_SCENES);
  // The same two, readable by an answer landing later without re-making the request for them.
  const scenesRef = useRef([]);
  const activeSceneRef = useRef(ALL_SCENES);
  const chooseScene = useCallback((sceneId) => { activeSceneRef.current = sceneId; setActiveSceneId(sceneId); }, []);
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
  // Submit All's popup: null while closed, otherwise `sent` - null until the server has accepted
  // the items, then the items that went.
  // Opening it sends nothing; `submitAllOnce` is what stops a second press sending twice.
  const [submitAll, setSubmitAll] = useState(null);
  const submitAllOnce = useSubmitOnce();

  const loadMeta = useCallback(async () => {
    setLoading(true);
    try { const response = await getGalleryMeta(token); setMeta(response.data); setError(""); }
    catch (metaError) { setExpiredLink(expiredLinkFrom(metaError)); setError(metaError.message || "This gallery link is unavailable."); }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { loadMeta(); }, [loadMeta]);
  // Writes read the session from a ref: a pending action replayed straight after the PIN is
  // accepted would otherwise still be holding the preview token from its own render.
  const sessionRef = useRef(null);
  const applySession = useCallback((next, isPreview) => { sessionRef.current = next; setSessionTokenState(next); setPreview(isPreview); }, []);
  // Shown inside the client's app (`#embed=app`): the page drops its own logo bar and wears the
  // app's look (`client-gallery/appEmbed.css`). Kept for this tab, as the address loses its fragment.
  useEffect(() => {
    const EMBED_KEY = "dbs_gallery_embed";
    if (new URLSearchParams(window.location.hash.slice(1)).get("embed") === "app") window.sessionStorage.setItem(EMBED_KEY, "app");
    if (window.sessionStorage.getItem(EMBED_KEY) === "app") document.documentElement.dataset.embed = "app";
  }, []);
  useEffect(() => {
    applySession(getGallerySession(token), isGalleryPreviewSession(token));
    // Opened from the client's app, which already holds this gallery's PIN: it comes in the address's
    // fragment (`#pin=1234`, never sent to a server), is taken out of the address bar at once, and is
    // checked exactly as the PIN screen would - so the client lands on the gallery, not the PIN screen.
    const pin = new URLSearchParams(window.location.hash.slice(1)).get("pin");
    if (!pin) return;
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    verifyGalleryPin(token, pin)
      .then((response) => { setGallerySession(token, response.data.sessionToken); applySession(response.data.sessionToken, false); })
      .catch(() => {});
  }, [token, applySession]);

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
    // A selection item names the shoot it belongs to and opens that shoot's folder: a manual item
    // filed under a folder, by that folder's id - so a renamed folder still opens - and a derived
    // item by its shoot's name. One with no shoot applies to the whole project, so it opens the
    // first folder the project has. Without this the gallery opened no folder at all and the client
    // was shown an empty project.
    const shootName = (first.shoot?.shoot || "").trim().toLowerCase();
    const outer = first.shoot?.folderId
      ? folders.find((folder) => folder.folderId === first.shoot.folderId)
      : shootName
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

  // Only the latest listing asked for may land: a tab pressed while the previous page was still
  // on its way would otherwise arrive last and be shown under the wrong filter. `personIds` is the
  // People filter a folder opened from the People tab carries: the same listing, narrowed.
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

  // Who was found across the whole gallery, for the People tab. Never an error on screen: a
  // gallery whose face processing is off, has not run or cannot answer shows the tab's empty
  // state, and everything else carries on.
  const loadPeople = useCallback(async (folderGroupId) => {
    try {
      // Only the rail's own few: a gallery may hold thousands of faces, and the rest are reached
      // through the picker, which asks for them a page at a time.
      const response = await listGalleryPeople(token, sessionRef.current, undefined, { folderGroupId, page: 1, pageSize: RAIL_PEOPLE });
      const list = response.data?.people || [];
      list.forEach((person) => peopleKnown.current.set(person.id, person));
      setPeople(list);
      setPeopleTotal(response.data?.total || list.length);
      setPeopleInfo({ loaded: true, available: response.data?.available !== false, processing: Boolean(response.data?.processing) });
    } catch { setPeople([]); setPeopleTotal(0); setPeopleInfo({ loaded: true, available: true, processing: false }); }
  }, [token]);

  /**
   * The scenes read in the photos the People tab is listing, counted for the chosen people, so
   * "Family · 3" beside Person 1 is her three family photos. Only the latest answer lands. A scene
   * the new count no longer lists - chosen for the whole shoot, then narrowed to none by the
   * people chosen - comes off rather than heading an empty grid, and the notice says so, because
   * a filter changing on its own is otherwise a grid widening for no reason the client can see.
   * A count that cannot be read leaves the rows and the chosen scene exactly as they were: a
   * gallery whose photos were never culled offers no scene, and one that cannot answer keeps
   * what it last said rather than dropping the client's filter.
   */
  const scenesRequest = useRef(0);
  const loadScenes = useCallback(async (personIds, folderGroupId) => {
    const request = ++scenesRequest.current;
    try {
      const response = await listGalleryScenes(token, sessionRef.current, { folderGroupId, personId: personIds.length ? personIds.join(",") : undefined });
      if (request !== scenesRequest.current) return;
      const list = response.data?.scenes || [];
      const current = activeSceneRef.current;
      const next = activeScene(current, list);
      if (next !== current) {
        const name = sceneLabel(current, scenesRef.current) || "That scene";
        chooseScene(next);
        setError(personIds.length ? `${name} has no photos of ${personIds.length > 1 ? "these people" : "this person"}, so all scenes are shown.` : `${name} has no photos here any more, so all scenes are shown.`);
      }
      scenesRef.current = list;
      setScenes(list);
      setScenesProcessing(Boolean(response.data?.processing));
    } catch { /* The rows and the chosen scene stay as they were; nothing is dropped on a failed count. */ }
  }, [token, chooseScene]);

  /**
   * A page of people for the picker: searched and numbered by the server, remembered here so a
   * person chosen from deep in the list can still be named and drawn in the rail afterwards.
   */
  const loadPickerPeople = useCallback(async ({ page, pageSize }) => {
    const response = await listGalleryPeople(token, sessionRef.current, undefined, { folderGroupId: activeFolderGroupId || undefined, page, pageSize });
    (response.data?.people || []).forEach((person) => peopleKnown.current.set(person.id, person));
    return response.data;
  }, [token, activeFolderGroupId]);

  /**
   * The People tab's combined grid. `folders/all` with the shoot as the scope is every card of it,
   * and `personId` is the same AND condition the folder view uses - photos every chosen person is
   * in together. Paged, so a gallery of fifty thousand photos arrives a screen at a time, and
   * guarded against a stale answer landing the way every other listing here is.
   */
  const peoplePhotosRequest = useRef(0);
  const loadPeoplePhotos = useCallback(async (personIds, nextPage, folderGroupId, sceneId) => {
    const request = ++peoplePhotosRequest.current;
    // The photos already on screen stay while the next answer is fetched - another person is one
    // more condition on the same question, not a different page - and page one replaces them when
    // it lands. Emptying here instead put a spinner over every press. `replacing` tells the grid
    // which: page one is a new answer and dims the photos it replaces; a further page only adds
    // to the end, and dimming every photo already there made the whole gallery flash on each scroll.
    setPeoplePhotos((current) => ({ ...current, loading: true, replacing: nextPage === 1 }));
    try {
      const response = await listGalleryFolderImages(token, sessionRef.current, "all", { page: nextPage, pageSize: PAGE_SIZE, selected: "all", deliverableConfigId: activeDeliverableId || undefined, personId: personIds.length ? personIds.join(",") : undefined, folderGroupId: folderGroupId || undefined, sceneId });
      if (request !== peoplePhotosRequest.current) return;
      const { items: batch = [], pagination } = response.data;
      setPeoplePhotos((current) => ({
        items: nextPage === 1 ? batch : [...current.items, ...batch],
        loading: false,
        replacing: false,
        total: pagination?.total || 0,
        page: nextPage,
        hasMore: nextPage < (pagination?.totalPages || 1),
      }));
    } catch (photosError) {
      if (request !== peoplePhotosRequest.current) return;
      setPeoplePhotos((current) => ({ ...current, loading: false, replacing: false }));
      if (photosError.status === 401) { clearGallerySession(token); setSessionTokenState(null); }
      else setError(photosError.message || "Unable to load photos.");
    }
  }, [token, activeDeliverableId]);

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
  // The People tab reads the people afresh each time it is opened - the worker may have found
  // more - and its cards whenever the chosen people change, and again when a folder opened from
  // it closes, so picks made inside are on the cards. Opening a folder leaves the tab as it was,
  // so coming back finds the same people chosen and the same cards.
  useEffect(() => { if (homeTab === "people" && !activeFolderId) loadPeople(activeFolderGroupId || undefined); }, [homeTab, activeFolderId, activeFolderGroupId, loadPeople]);
  // The scenes follow the people: counted again whenever who is chosen, or the shoot, changes.
  useEffect(() => { if (homeTab === "people" && !activeFolderId) loadScenes(activePersonIds, activeFolderGroupId || undefined); }, [homeTab, activeFolderId, activePersonIds, activeFolderGroupId, loadScenes]);
  // While photos are still being read for their scene, the rows are asked for again every few
  // seconds - the engine reads a shoot in well under a minute, and the switch appears as soon as
  // the first scenes are in - and the asking stops with the tab, or once there is nothing to come.
  useEffect(() => {
    if (!scenesProcessing || homeTab !== "people" || activeFolderId) return undefined;
    const timer = setTimeout(() => loadScenes(activePersonIds, activeFolderGroupId || undefined), SCENES_POLL_MS);
    return () => clearTimeout(timer);
  }, [scenesProcessing, scenes, homeTab, activeFolderId, activePersonIds, activeFolderGroupId, loadScenes]);
  // What the grid is asked for: nothing for all scenes, the id otherwise. Derived here so the grid
  // is fetched again when the scene in force changes, and not merely when the list is re-counted.
  const peopleSceneId = sceneQuery(activeSceneId, scenes);
  // Deferred a tick, which is this codebase's convention for a load started from an effect: a
  // fetch begun in the body counts as state set during that effect.
  useEffect(() => {
    if (homeTab !== "people" || activeFolderId) return undefined;
    const timer = setTimeout(() => loadPeoplePhotos(activePersonIds, 1, activeFolderGroupId || undefined, peopleSceneId), 0);
    return () => clearTimeout(timer);
  }, [homeTab, activeFolderId, activePersonIds, activeFolderGroupId, peopleSceneId, loadPeoplePhotos]);

  function changeHomeTab(nextTab, force = false) {
    // Picking is a write, so the Selected tab is behind the PIN the same way the grid's tick is.
    // People is only a way of looking, so it opens without one; the tick on a photo there asks.
    if (nextTab === "selected" && !force && !requirePin(() => changeHomeTab(nextTab, true))) return;
    setHomeTab(nextTab);
  }

  // A folder opens from All Photos as itself, and from a People card narrowed to the chosen
  // people's photos in it - the same view, the same grid, one more condition on the listing.
  function openFolder(folderId, personIds = []) { setActiveFolderId(folderId); setFolderPersonIds(personIds); setTab("all"); setItems([]); setPage(1); loadFolderImages(folderId, 1, "all", personIds); }
  function changeTab(nextTab, force = false) {
    if (nextTab === "selected" && !force && !requirePin(() => changeTab(nextTab, true))) return;
    setTab(nextTab); setItems([]); setPage(1); loadFolderImages(activeFolderId, 1, nextTab, folderPersonIds);
  }
  // The People tab's filter. Pressing a person adds them, pressing them again takes them out, and
  // null (All, or Clear) empties the set for the whole gallery again; the effect above refetches
  // the cards. The selection on each photo comes back from the server with every listing, so a
  // photo ticked under one person is ticked under every other, and in All Photos.
  function selectPerson(personId) {
    // All, or Clear: the filter comes off and the grid widens to the whole shoot. It is not a
    // view closing - the tab shows photographs either way - so nothing is emptied here.
    if (personId === null) { setActivePersonIds([]); return; }
    const { next, refused } = togglePerson(activePersonIds, personId);
    if (refused) { setError(`You can choose up to ${MAX_PEOPLE} people at once.`); return; }
    setActivePersonIds(next);
  }
  /**
   * Moving to another shoot's selection setting.
   *
   * The People filter goes with it, and so does everything the browser had been told about that
   * shoot's people. Who was found is counted per shoot, and the numbering is the project's but the
   * counts are not: keeping "Person 88" chosen across the move left the rail saying how many
   * photos of the *old* shoot they were in, over a grid of the new one that may hold none of them.
   * The tab lands on the new shoot's cards, which is where All leaves it.
   */
  function changeShoot(outerFolderId) {
    setActiveFolderGroupId(outerFolderId);
    setActivePersonIds([]);
    peopleKnown.current.clear();
    // The scenes are the shoot's too: another shoot is counted afresh, from all of its scenes.
    chooseScene(ALL_SCENES);
  }

  /*
   * The picker's Apply: the whole set at once, and the gallery filtered once for it. Ticking
   * people in the picker changes nothing until this, which is what keeps choosing four of them
   * from being four reloads of the grid.
   */
  function applyPeople(personIds) {
    setPickerOpen(false);
    const next = personIds.slice(0, MAX_PEOPLE);
    // Apply with nothing ticked or unticked is not a new question: handing back an equal-but-new
    // list would throw away every page read so far and the place the client had scrolled to.
    if (next.length === activePersonIds.length && next.every((id, index) => id === activePersonIds[index])) return;
    setActivePersonIds(next);
  }
  // Coming back with the Selected tab open refetches it, so photos ticked inside the folder are
  // waiting on the tab rather than missing until the next tab switch. The People tab's effects
  // above do the same for its cards, keyed on the folder closing; the chosen people stay chosen.
  function backToFolders() { setActiveFolderId(null); setFolderPersonIds([]); setItems([]); loadFolders(sessionToken); if (homeTab === "selected") loadHomeSelected(activeDeliverableId); }

  // Every photo the client has picked, for any selection item, each carrying the items it is
  // picked for in `photoSelections`.
  async function collectSelected() {
    const collected = [];
    let nextPage = 1;
    let totalPages = 1;
    do {
      const response = await listGallerySelected(token, sessionRef.current, { page: nextPage, pageSize: 100 });
      collected.push(...response.data.items);
      totalPages = response.data.pagination.totalPages;
      nextPage += 1;
    } while (nextPage <= totalPages);
    return collected;
  }

  // `itemId` is the selection item to review - the one in the sidebar, unless Submit All's popup
  // named another.
  async function openReview(canSend = true, force = false, itemId = activeDeliverableId) {
    if (!force && !requirePin(() => openReview(canSend, true, itemId))) return;
    setGridLoading(true);
    try {
      const collected = await collectSelected();
      // Review & Submit sends one selection item — the one the client is working in — so it
      // reviews only that item. "View Selected" still shows everything, read-only.
      if (canSend) {
        const activeItem = deliverables.find((item) => item.id === itemId);
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

  // Submit All opens a review of every ready item, read from the counts already loaded; it sends
  // nothing until Submit All Selections is pressed.
  function openSubmitAll(force = false) {
    if (!force && !requirePin(() => openSubmitAll(true))) return;
    setSubmitAll({ sent: null });
  }

  // Sends every ready item in one request. The server checks each and writes all of them in one
  // transaction, or refuses the lot - so the success view only ever follows a real save, and on a
  // refusal the picks are untouched and the popup stays open with the reason.
  function sendAllSelections() {
    const ready = submittableItems(deliverables, selectionCounts);
    if (ready.length < 2) return undefined;
    const sent = ready.map((item) => ({ item, count: selectionCounts[item.id] || 0 }));
    return submitAllOnce.run(async () => {
      try {
        await submitAllGallerySelections(token, sessionRef.current, ready.map((item) => item.id));
        setSubmitAll((current) => (current ? { ...current, sent } : current));
      } catch (sendError) {
        setError(sendError.message || "Your selections could not be submitted. Nothing was sent - please try again.");
      }
      // Either way the sidebar and the popup re-read what the server now holds.
      await loadFolders(sessionRef.current);
    });
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
    // The People tab's grid is the same photos under another question, so the same tile follows.
    setPeoplePhotos((prev) => ({ ...prev, items: prev.items.map((item) => (item.id === image.id ? withSelection(item) : item)) }));
    if (forActive) {
      setCounts((prev) => ({ ...prev, selected: prev.selected + step }));
      setFolders((prev) => prev.map((folder) => ((folder.folderId || "unfiled") === activeFolderId ? bumpFolder(folder) : folder)));
    }
    try {
      await setGalleryImageSelection(token, sessionRef.current, image.id, nextSelected, target);
      await loadFolders(sessionRef.current);
      // The People tab's cards count picks too: what was remembered is stale, and the cards on
      // screen are re-read when the tab is the one open.
    } catch (selectionError) {
      setItems((prev) => prev.map((item) => (item.id === image.id ? image : item)));
      setHomeSelected((prev) => prev.map((item) => (item.id === image.id ? image : item)));
      setPeoplePhotos((prev) => ({ ...prev, items: prev.items.map((item) => (item.id === image.id ? image : item)) }));
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
      const released = (item) => ({ ...item, selected: false, photoSelections: (item.photoSelections || []).filter((selection) => selection.imageSelectionDeliverableConfigId !== target.id) });
      setItems((prev) => prev.map(released));
      setPeoplePhotos((prev) => ({ ...prev, items: prev.items.map(released) }));
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

  // Inside a folder opened from a People card, the sidebar and prev/next walk the cards the People
  // tab showed - the folders holding those people's photos, counted for them - not every folder.
  const browseFolders = folders;
  const activeFolderMeta = browseFolders.find((folder) => (folder.folderId || "unfiled") === activeFolderId);
  const folderIndex = browseFolders.findIndex((folder) => (folder.folderId || "unfiled") === activeFolderId);

  if (loading) return <main className="grid min-h-screen place-items-center bg-white"><Loader label="Loading gallery..." size="lg" /></main>;
  if (expiredLink && !meta) return <ExpiredClientLink {...expiredLink} />;
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

  const submitAllDialog = submitAll ? <SubmitAllDialog
    heading={galleryHeading(meta)}
    groups={submitAllGroups(deliverables, selectionCounts)}
    sent={submitAll.sent}
    submitting={submitAllOnce.busy}
    onReviewItem={(item) => { setSubmitAll(null); openReview(true, false, item.id); }}
    onSubmitAll={sendAllSelections}
    onClose={() => setSubmitAll(null)}
  /> : null;

  if (reviewing) {
    // Scoped to the selection item being submitted: other deliverables are left out of the map,
    // so a photo also picked for a later item only appears under the item going out now.
    const reviewDeliverables = reviewScope ? deliverables.filter((item) => reviewScope.deliverableIds.includes(item.id)) : deliverables;
    return <>{pinDialog}<ReviewSelected items={selectedItems} folders={folders} deliverables={reviewDeliverables} itemName={reviewScope?.itemName} projectName={meta?.projectName || ""} studioName={meta?.studioName} galleryLogoUrl={meta?.galleryLogoUrl} sessionToken={sessionToken} sent={selectionSent} canSend={reviewCanSend} onBack={() => setReviewing(false)} onSend={sendSelection} /></>;
  }

  // The viewer pages through whichever list the photo was opened from — the folder grid, or the
  // home page's Selected tab, which exists while no folder is open.
  const viewerItems = viewerScope === "home" ? homeSelected : viewerScope === "people" ? peoplePhotos.items : items;
  /*
   * The open photo, drawn **over** the gallery rather than instead of it.
   *
   * This used to be an early return: with a photo open the gallery was not rendered at all, so
   * `FolderGrid` and `FolderCards` unmounted, and with them the pane that actually scrolls
   * (`min-h-0 flex-1 overflow-y-auto` inside the grid). Closing the photo built a new pane, which
   * starts at the top - so a client who had scrolled to the thousandth photograph was put back at
   * the first and had to scroll there again. It was never the data: the photos, the page reached,
   * the folder, the chosen people and every tick live on this component, which does not unmount.
   * Only the scrolled box did.
   *
   * Kept in the tree in the same position instead, so React reconciles rather than remounts: the
   * pane, its scroll position and every loaded page are exactly where they were left, and closing
   * reveals them with nothing to restore and nothing to fetch again. The viewer is its own
   * `fixed inset-0` layer, so it covers the gallery the whole time it is open.
   */
  const viewer = viewerIndex !== null && viewerItems[viewerIndex] ? (
    <ImageViewer
      image={viewerItems[viewerIndex]}
      index={viewerIndex}
      total={viewerItems.length}
      selectedCount={viewerScope === "folder" ? counts.selected : activeDeliverableId ? selectionCounts[activeDeliverableId] || 0 : homeSelected.length}
      sessionToken={sessionToken}
      onClose={() => setViewerIndex(null)}
      onPrev={() => setViewerIndex((value) => Math.max(0, value - 1))}
      onNext={() => setViewerIndex((value) => Math.min(viewerItems.length - 1, value + 1))}
      hasPrev={viewerIndex > 0}
      hasNext={viewerIndex < viewerItems.length - 1}
      onToggleSelect={toggleSelect}
      deliverables={deliverables}
    />
  ) : null;

  if (activeFolderId) {
    return (
      <>
      {pinDialog}
      {submitAllDialog}
      {floatingNotice}
      {viewer}
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
        onLoadMore={() => loadFolderImages(activeFolderId, page + 1, tab, folderPersonIds)}
        hasMore={page < pagination.totalPages}
        loading={gridLoading}
        onPrevFolder={() => browseFolders[folderIndex - 1] && openFolder(browseFolders[folderIndex - 1].folderId || "unfiled", folderPersonIds)}
        onNextFolder={() => browseFolders[folderIndex + 1] && openFolder(browseFolders[folderIndex + 1].folderId || "unfiled", folderPersonIds)}
        hasPrevFolder={folderIndex > 0}
        hasNextFolder={folderIndex >= 0 && folderIndex < browseFolders.length - 1}
        deliverables={deliverables}
        selectionCounts={selectionCounts}
        folders={browseFolders}
        activeFolderGroupId={activeFolderMeta?.parentId || activeFolderGroupId}
        activeFolderId={activeFolderId}
        onOpenFolder={(folderId) => openFolder(folderId, folderPersonIds)}
        personLabel={personFilterLabel(folderPersonIds, people)}
        activeDeliverableId={activeDeliverableId}
        studioName={meta?.studioName}
        galleryLogoUrl={meta?.galleryLogoUrl}
        onReviewAndSend={() => openReview(true)}
        onSubmitAll={() => openSubmitAll()}
      />
      </>
    );
  }

  const peoplePicker = pickerOpen ? <PeoplePickerDialog activePersonIds={activePersonIds} knownPeople={[...peopleKnown.current.values()]} onApply={applyPeople} onClose={() => setPickerOpen(false)} loadPeople={loadPickerPeople} sessionToken={sessionToken} /> : null;

  return <>{pinDialog}{clearDialog}{submitAllDialog}{floatingNotice}{peoplePicker}{viewer}<FolderCards client={meta} folders={folders} deliverables={deliverables} overall={overall} selectionCounts={selectionCounts} activeFolderGroupId={activeFolderGroupId} activeDeliverableId={activeDeliverableId} onSelectDeliverable={(item, outerFolderId) => { setActiveDeliverableId(item.id); if (outerFolderId !== activeFolderGroupId) changeShoot(outerFolderId); }} onOpenFolder={openFolder} onReviewAndSend={() => openReview(true)} onSubmitAll={() => openSubmitAll()} onDeselectAll={() => setConfirmClear(true)} clearing={clearing} tab={homeTab} onTabChange={changeHomeTab} selectedItems={homeSelected} selectedLoading={homeSelectedLoading} sessionToken={sessionToken} onToggleSelect={toggleSelect} onOpenImage={(image) => { setViewerScope("home"); setViewerIndex(homeSelected.findIndex((item) => item.id === image.id)); }}
    people={{
      people: railPeople(people, activePersonIds, peopleKnown.current),
      info: peopleInfo,
      activePersonIds,
      onSelectPerson: selectPerson,
      onOpenMore: () => setPickerOpen(true),
      // What All counts is this shoot's photographs - which is the grid's own total whenever
      // nobody is chosen, and the whole gallery's only before the first answer lands.
      totalCount: activePersonIds.length ? overall.total : peoplePhotos.total || overall.total,
      totalPeople: peopleTotal,
      // The combined grid, with anyone chosen: the photos themselves and the next page.
      photos: { ...peoplePhotos, onLoadMore: () => loadPeoplePhotos(activePersonIds, peoplePhotos.page + 1, activeFolderGroupId || undefined, peopleSceneId) },
      // The Scene filter beside the rail: its rows, the scene in force and its name, and the press
      // that changes it. No rows at all when the shoot's photos were never culled.
      scenes: { options: sceneOptions(scenes), value: activeScene(activeSceneId, scenes), label: sceneLabel(activeSceneId, scenes), onChange: chooseScene, processing: scenesProcessing },
      personLabel: personFilterLabel(activePersonIds, railPeople(people, activePersonIds, peopleKnown.current)),
      onOpenPeopleImage: (image) => { setViewerScope("people"); setViewerIndex(peoplePhotos.items.findIndex((item) => item.id === image.id)); },
    }}
  /></>;
}
