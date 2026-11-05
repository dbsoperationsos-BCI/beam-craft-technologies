"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import CreateFolderDialog from "./CreateFolderDialog";
import CullingWorkspace from "./culling/CullingWorkspace";
import AiEditingWorkspace from "./editing/AiEditingWorkspace";
import DeleteFolderDialog from "./DeleteFolderDialog";
import FolderCard from "./FolderCard";
import FolderToolbar from "./FolderToolbar";
import FolderTree from "./FolderTree";
import Gallery from "./Gallery";
import GalleryPublication from "./GalleryPublication";
import ImageSelectionSettingsPanel from "./ImageSelectionSettingsPanel";
import WhatsAppTemplatePanel from "./WhatsAppTemplatePanel";
import RenameFolderDialog from "./RenameFolderDialog";
import SignatureAlbumWorkspace from "./signature-album/SignatureAlbumWorkspace";
import { StatusChip } from "./signature-album/PublishPanel";
import { updatedAgo } from "@/lib/relativeTime.mjs";
import UploadManager from "./UploadManager";
import { useModuleAccess } from "@/components/auth/PermissionsProvider";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { WORKSPACE_TABS, linkedWorkspaceTabIds, tabShoots } from "@/lib/imageSelectionTabs.mjs";
import { PROJECT_MODULES, modulesLinked } from "@/lib/stageDashboards.mjs";
import useUnsavedGuard from "@/components/shared/useUnsavedGuard";
import {
  createImageSelectionFolder,
  deleteImageSelectionFolder,
  listImageSelectionAllocatedServices,
  listImageSelectionFolders,
  renameImageSelectionFolder,
} from "@/services/image-selection/image-selection.service";

// The workspace's four tabs are the flow a shoot takes - AI Culling, AI Editing, Photo Selection,
// Signature Album - and every other deliverable the Deliverables table marks Yes reaches the
// client through Selection Settings instead. On a project linked to Project Management, AI
// Culling and AI Editing are always there, Photo Selection is there once the project has one of
// those deliverables (they are its Selection Items), and Signature Album is earned as it always
// was: allocated, and an explicit Yes in the Deliverables table. A manually named project has no
// allocation to read, so it shows the tabs ticked on the Create New Project form, stored on the
// project row; one created before the form asked keeps the Photo Selection tab it always had.
//
// A linked project's tabs are `lib/imageSelectionTabs.mjs`. AI Editing and Signature Album are
// also held to their own permissions: a tab the viewer may not open is absent.
//
// Since 3 Nov 2026 each of the four is a Visual Curation module of its own - Photo Selection, AI
// Culling, AI Editing, Signature Album - with its own Projects page, and the workspace is opened on
// one of them (`stage`) with no tab strip: the module is the page. The rules above still decide
// whether the project has that module at all, and which of the others a photo may be sent on to;
// "Open AI Editing" and the like go to that module's Projects page on the same project
// (`onOpenStage`).

function findFolder(folders, id) {
  for (const folder of folders) {
    if (folder.id === id) return folder;
    const nested = findFolder(folder.children, id);
    if (nested) return nested;
  }
  return null;
}
function findPath(folders, id, trail = []) {
  for (const folder of folders) {
    const next = [...trail, folder];
    if (folder.id === id) return next;
    const nested = findPath(folder.children, id, next);
    if (nested.length) return nested;
  }
  return [];
}
// The same tree with one folder's name changed - same id, children and photos.
function renamedInTree(folders, id, name) {
  return folders.map((folder) =>
    folder.id === id ? { ...folder, name } : { ...folder, children: renamedInTree(folder.children || [], id, name) },
  );
}
export default function ImageSelectionProjectWorkspace({ project, stage = "photos", folderTarget = null, refreshSignal = 0, onBack, onProjectUpdated, onOpenStage = null }) {
  /*
   * The module this workspace is opened in runs it: Photo Selection's own permission (Project
   * Management) on Photo Selection, AI Culling's on AI Culling, and so on - each module is opened by
   * its own permission and none needs another's. READ browses folders and the module's work;
   * READ_WRITE is what changes any of it.
   */
  const { canWrite } = useModuleAccess("IMAGE_SELECTION", PROJECT_MODULES[stage]?.feature || "Project Management");
  // Disabled from Expand: everything that would reach the client - uploading, publishing, the link
  // and its sending - is held back for everyone (the server refuses it too), and the banner says
  // why. The studio's own work (folders, AI Culling, AI Editing) carries on as before.
  const projectDisabled = Boolean(project.disabledAt);
  const clientWrite = canWrite && !projectDisabled;
  // The Signature Album tab answers to its own permission: without READ the tab is absent, and
  // READ_WRITE is what builds, publishes and shares the album. Nothing else in this workspace
  // reads it.
  const albumAccess = useModuleAccess("IMAGE_SELECTION", "Signature Album");
  // The AI Editing tab likewise: READ opens it and sees the edits, READ_WRITE uploads into it,
  // edits and sends on. Sending INTO Photo Selection or the album is the destination's permission.
  const editingAccess = useModuleAccess("IMAGE_SELECTION", "AI Editing");
  // The right-hand column while the album tab is open, handed to the album workspace to draw its
  // own rail into, so this file knows nothing about what that rail holds.
  const [albumRailNode, setAlbumRailNode] = useState(null);
  // The module this workspace is opened in. Fixed for its life: another module is another page.
  const activeTab = stage;
  const folderless = activeTab === "album";
  // The two processing tabs. They share the folder tree and the folder dialogs with Photo
  // Selection - the folder is the scope a cull or an edit works on - but none of Photo Selection's
  // client side: no settings rail (publish status, Allow Photo Selection, expiry, client URL, PIN,
  // Shoots & Selection Items, View Invite) and no publish badge or Download Selected in the header.
  // Those belong to the client gallery, which is Photo Selection's alone; the processing workspace
  // takes the column they would have held.
  const railless = activeTab === "culling" || activeTab === "editing";
  // AI Culling's and AI Editing's full-width review: the tree steps aside for a while and comes
  // back the moment the photographer leaves the tab (never a lasting setting).
  const [cullingWide, setCullingWide] = useState(false);
  const cullingWideActive = cullingWide && railless;
  const [folders, setFolders] = useState([]);
  const [totalFolderCount, setTotalFolderCount] = useState(0);
  const [currentFolderId, setCurrentFolderId] = useState(folderTarget?.id || null);
  const [openedTarget, setOpenedTarget] = useState(folderTarget);
  // The upload dock passes a fresh folderTarget every time the user clicks a running
  // upload; jumping to that folder is a state reset from a prop, which React wants
  // adjusted during render rather than in an effect.
  if (folderTarget !== openedTarget) {
    setOpenedTarget(folderTarget);
    if (folderTarget?.id) setCurrentFolderId(folderTarget.id);
  }
  const [dialog, setDialog] = useState(null);
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [galleryRevision, setGalleryRevision] = useState(0);
  const [updatedAt, setUpdatedAt] = useState(project.updatedAt);
  const [showInvite, setShowInvite] = useState(false);
  // True only while the header has swapped the publish badge for the wide Download Selected button,
  // which leaves no room for the "Updated:" label beside it. Reported by GalleryPublication, which
  // already loads the publish record.
  const [collectingSelection, setCollectingSelection] = useState(false);
  // What the header says while the Signature Album tab is open: the album's own status and its own
  // last write, reported by SignatureAlbumWorkspace from every album response - never the
  // project's timestamp or the Photo Selection publication, which belong to the other tabs.
  const [albumHeader, setAlbumHeader] = useState(null);
  // Whether the Signature Album is still sending photos: its queue lives in that tab, so leaving the
  // tab mid-batch stops what has not been sent yet, and is asked about first.
  const [albumUploading, setAlbumUploading] = useState(false);
  const leaveAlbum = useUnsavedGuard(() => albumUploading && activeTab === "album", {
    title: "Photos are still uploading",
    message: "Leaving the Signature Album stops the upload. Photos already uploaded stay in the album; the rest are not sent.",
    cancelLabel: "Stay",
    confirmLabel: "Leave anyway",
  });
  // Studio-wide settings are edited from ⋮ → Settings, which sits above this workspace and
  // therefore cannot reach `refreshGallery`. The page bumps this counter instead, so the selection
  // items and publish state reload against the new defaults. Adjusted during render rather than in
  // an effect, the same way a folder deep link is above.
  const [appliedRefreshSignal, setAppliedRefreshSignal] = useState(refreshSignal);
  if (refreshSignal !== appliedRefreshSignal) {
    setAppliedRefreshSignal(refreshSignal);
    setGalleryRevision((value) => value + 1);
  }
  const refreshGallery = useCallback(
    () => {
      setGalleryRevision((value) => value + 1);
      setUpdatedAt(new Date().toISOString());
    },
    [],
  );
  // "3 mins ago" is only true for a minute. The clock is read in an effect rather than during
  // render — reading it while rendering is impure, gives the server a different answer from the
  // browser, and left the label frozen at whatever it said when the workspace last re-rendered.
  const [now, setNow] = useState(null);
  useEffect(() => {
    // Deferred by a zero timer for the same reason the loaders below are: setting state straight
    // from an effect body is a cascading render.
    const first = window.setTimeout(() => setNow(Date.now()), 0);
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => { window.clearTimeout(first); window.clearInterval(timer); };
  }, []);
  const updatedLabel = useMemo(() => updatedAgo(updatedAt, now), [updatedAt, now]);
  const albumUpdatedLabel = useMemo(() => updatedAgo(albumHeader?.updatedAt, now), [albumHeader, now]);
  // Only the latest listing is applied: one that was already on its way when a rename or delete
  // landed would otherwise put the old tree back.
  const folderRequest = useRef(0);
  const loadFolders = useCallback(async () => {
    const request = ++folderRequest.current;
    setLoading(true);
    try {
      const response = await listImageSelectionFolders(project.id);
      if (request !== folderRequest.current) return;
      setFolders(response.data.folders || []);
      setTotalFolderCount(response.data.totalFolderCount || 0);
      setNotice("");
    } catch (error) {
      if (request === folderRequest.current) setNotice(error.message || "Unable to load folders.");
    } finally {
      if (request === folderRequest.current) setLoading(false);
    }
  }, [project.id]);
  useEffect(() => {
    const timer = window.setTimeout(loadFolders, 0);
    return () => window.clearTimeout(timer);
  }, [loadFolders]);
  const currentFolder = useMemo(
    () => (currentFolderId ? findFolder(folders, currentFolderId) : null),
    [folders, currentFolderId],
  );
  const isSubfolder = Boolean(currentFolder?.parentId);
  // Null until the allocation is known, so a tab never flashes in and out while the project
  // loads. The response carries each allocated service with the shoots it was allocated to,
  // which is what lets a tab show only its own shoots below.
  const [allocatedServices, setAllocatedServices] = useState(null);
  useEffect(() => {
    let active = true;
    listImageSelectionAllocatedServices(project.id)
      .then((response) => {
        if (active) setAllocatedServices(response.data || []);
      })
      .catch(() => {
        if (active) setAllocatedServices([]);
      });
    return () => {
      active = false;
    };
  }, [project.id]);
  // Null until the allocation is known, like `allocatedServices` itself.
  const linkedTabIds = useMemo(
    () => (allocatedServices === null ? null : new Set(linkedWorkspaceTabIds(allocatedServices))),
    [allocatedServices],
  );
  const isLinked = Boolean(project.salesProjectId);
  const tabs = useMemo(() => {
    // A manual project has no allocation to earn tabs from; it shows the tabs ticked when it was
    // created. Null is a project from before the form asked: Photo Selection, AI Culling and AI
    // Editing on, the album off.
    // The Signature Album tab is also held to its own permission: a tab the viewer may not open
    // is absent rather than shown and refused.
    const permitted = (tab) =>
      tab.id === "album" ? albumAccess.loading || albumAccess.canRead
      : tab.id === "editing" ? editingAccess.loading || editingAccess.canRead
      : true;
    if (!isLinked)
      return WORKSPACE_TABS.filter((tab) =>
        // Null is a tick the project never stored (a project from before the tab existed, or an
        // older client): AI Culling and AI Editing are on - every project walks the flow, and
        // only an explicit untick on the project form takes either away. The album stays off
        // until ticked, as it always was.
        tab.id === "photos" ? project.photoSelectionTab !== false
        : tab.id === "culling" ? project.photoCullingTab !== false
        : tab.id === "editing" ? project.aiEditingTab !== false
        : project.signatureAlbumTab === true).filter(permitted);
    if (!linkedTabIds) return [];
    return WORKSPACE_TABS.filter((tab) => linkedTabIds.has(tab.id)).filter(permitted);
  }, [isLinked, linkedTabIds, project.photoSelectionTab, project.photoCullingTab, project.aiEditingTab, project.signatureAlbumTab, albumAccess.loading, albumAccess.canRead, editingAccess.loading, editingAccess.canRead]);
  // Which modules this project has, for the "Send to …" actions on AI Culling and AI Editing: a
  // destination the project lacks is not offered.
  const hasTab = (id) => tabs.some((tab) => tab.id === id);
  // Whether photos may go from one module of this project to another: the destination is on the
  // project and the two are linked (Edit Project → Linked Modules); the server asks the same.
  const linkedTo = (source, destination) => hasTab(destination) && modulesLinked(project, source, destination);
  // Known, and the project does not have the module this page is: a deliverable never allocated or
  // de-allocated since, or a manual project created without it. The pane says what to change
  // instead of silently offering the module's work.
  const moduleLabel = WORKSPACE_TABS.find((tab) => tab.id === stage)?.label || "this module";
  // A linked project's modules come from its allocation, read once it opens; until then the pane
  // waits rather than offering the module's work and taking it back a moment later.
  const stageReady = isLinked ? linkedTabIds !== null : true;
  const noTabs = stageReady && !hasTab(stage);
  // "Open AI Editing" and the like: the same project in that module's own Projects page. The
  // album's unsent upload is asked about first, as leaving the album always was.
  const openStage = (id) => (hasTab(id) && onOpenStage ? () => leaveAlbum.guard(() => { setCullingWide(false); onOpenStage(id, currentFolderId); }) : null);
  // The shoots the active tab stands on: every shoot whose Post Production Allocation carries the
  // tab's deliverable (matched by contained name, Yes in the table). Clicking Photo Culling shows
  // the shoots allocated Photo Culling, not the whole project; a tab with no such allocation shows
  // every shoot (`tabShoots`). Null means "no filter" — a manual project has no allocation to read,
  // and before the allocation loads the tree stays whole.
  const activeTabShoots = useMemo(() => {
    if (!isLinked || !allocatedServices) return null;
    return tabShoots(allocatedServices, activeTab);
  }, [isLinked, allocatedServices, activeTab]);
  const activeShootIds = useMemo(
    () => (activeTabShoots === null ? null : new Set(activeTabShoots.map((shoot) => shoot.id))),
    [activeTabShoots],
  );
  // What the folder tree shows under this tab: the active tab's shoot folders, plus any root
  // folder the studio made itself — a folder with no shoot behind it belongs to no tab in
  // particular, so it stays on all of them.
  const tabFolders = useMemo(
    () => (activeShootIds === null ? folders : folders.filter((folder) => !folder.projectShootId || activeShootIds.has(folder.projectShootId))),
    [folders, activeShootIds],
  );
  // Switching tabs can hide the folder the studio was standing in; fall back to the project root
  // rather than working inside a folder the tree no longer shows. Adjusted during render, the
  // same way the tab fallback above is.
  if (activeShootIds !== null && currentFolderId && folders.length && !findFolder(tabFolders, currentFolderId))
    setCurrentFolderId(null);
  const path = useMemo(
    () => (currentFolderId ? findPath(folders, currentFolderId) : []),
    [folders, currentFolderId],
  );
  const visibleFolders = currentFolder ? currentFolder.children : folders;
  async function createFolder(name) {
    await createImageSelectionFolder(project.id, {
      name,
      parentId: dialog?.parent?.id || null,
    });
    refreshGallery();
    await loadFolders();
  }
  // The server's confirmed name goes into the tree at once - the selected folder, its breadcrumb and
  // the shoot names in the rail all read it from there - and the listing then refreshes the rest.
  // A failed rename throws before this, so the old name stays.
  async function renameFolder(name) {
    const response = await renameImageSelectionFolder(project.id, dialog.folder.id, name);
    setFolders((current) => renamedInTree(current, dialog.folder.id, response?.data?.name || name));
    refreshGallery();
    await loadFolders();
  }
  // Delete is permanent, after the studio confirmed it in the dialog - which is also the answer to
  // the server's warning over client-submitted selections. The tree and the gallery are reloaded
  // only once the server has confirmed the delete.
  async function removeFolder() {
    const removedId = dialog.folder.id;
    // A folder already deleted - from the desktop, another tab - is the outcome asked for: the
    // tree is reloaded rather than the dialog showing "not found".
    await deleteImageSelectionFolder(project.id, removedId, { acknowledgeSubmitted: true }).catch((error) => {
      if (error.status !== 404) throw error;
    });
    refreshGallery();
    if (
      currentFolderId === removedId ||
      path.some((item) => item.id === removedId)
    )
      setCurrentFolderId(dialog.folder.parentId || null);
    await loadFolders();
  }
  function openFolderAction(type, folder) {
    setDialog(type === "create" ? { type, parent: folder } : { type, folder });
  }
  const createdLabel = project.createdAt
    ? new Date(project.createdAt).toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : "recently";

  return (
    // Fills the column the page hands down instead of sizing itself against the viewport. The
    // old 100dvh-minus-chrome maths depended on two CSS variables; once they were gone the whole
    // calc() became invalid, the height was dropped, and the workspace stopped short of the
    // bottom of the shell. From md up it holds that height and the three panes below scroll.
    <section className="image-selection-workspace flex min-h-0 flex-1 flex-col bg-white md:overflow-hidden">
      <style jsx>{`
        .image-selection-workspace
          > div:nth-of-type(1)
          > div:nth-child(2)
          > div[class*="border-t"] {
          border-top-width: 0;
        }
      `}</style>
      {/* One header row in every module: the project - its name and when it was created - on the
          left, and what the module says about it on the right: its last write and status (Photo
          Selection's publish badge or Download Selected, the album's status chip). With no tab
          strip any more, a second row held only that, so it sits beside the name; on a phone the
          right-hand side wraps under it rather than pushing the row past the screen. */}
      <header className="flex min-h-11 flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-slate-200 px-3 py-1">
        <ConfirmDialog {...leaveAlbum.confirmProps} />
        <div className="min-w-0">
          <h1 className="truncate text-base font-normal text-slate-800">
            {project.name}
          </h1>
          <p className="text-[10px] text-slate-500">Created: {createdLabel}</p>
        </div>
        <div className="flex min-w-0 shrink items-center gap-2 text-[10px] text-slate-500">
          {activeTab === "album" ? (
            // The album's own header: its last write and its status (Draft / Ready / Published /
            // Expired, the same chip the album draws everywhere). Nothing until the album has
            // answered, and nothing for a project with no album yet. On a phone only the chip: the
            // date beside it pushed the row past the screen and the pane scrolled sideways.
            albumHeader && <>
              <span className="hidden shrink-0 sm:inline">Updated: {albumUpdatedLabel}</span>
              <StatusChip status={albumHeader.status} />
            </>
          ) : <>
          {!collectingSelection && <span className="shrink-0">Updated: {updatedLabel}</span>}
          {/* The publish badge and Download Selected are the client gallery's: Photo Selection's
              header only. AI Culling and AI Editing keep the project's last write and nothing else. */}
          {!railless && <GalleryPublication
            projectId={project.id}
            projectName={project.name}
            refreshKey={galleryRevision}
            compact
            // The shoot the studio is standing in: the top of the breadcrumb, whichever of its
            // subfolders is open. Downloads are per shoot, so the header offers that shoot's
            // download — and only the publish badge at the project root.
            folder={path[0] || null}
            canWrite={clientWrite}
            // A manual project downloads shoot-wise only: the folder must carry a shoot group
            // of its name, and the whole-project fallback download is never offered.
            linked={Boolean(project.salesProjectId)}
            onCollectingChange={setCollectingSelection}
          />}
          </>}
        </div>
      </header>
      {projectDisabled && <p role="status" className="mx-5 mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">This project is disabled. Enable it from Expand to upload photos or send the client link. Its client link is paused until then; its photos and selections are kept.</p>}
      {/* The Signature Album has no use for the folder tree: it has its own library and picker, so on
          that tab the tree and the folder toolbar are not drawn and the album takes their width.
          The folders themselves are untouched - every other tab shows them exactly as before.
          AI Culling and AI Editing keep the tree and drop the rail (`railless`): two columns, the
          tree and the processing workspace, and one column while the review is expanded. */}
      <div className={`grid md:min-h-0 md:flex-1 ${cullingWideActive ? "md:grid-cols-[minmax(0,1fr)]" : railless ? "md:grid-cols-[210px_minmax(0,1fr)]" : folderless ? "md:grid-cols-[minmax(0,1fr)_300px]" : "md:grid-cols-[210px_minmax(0,1fr)_300px]"}`}>
        {!folderless && <aside className={`border-b border-slate-200 p-3 md:min-h-0 md:overflow-y-auto md:border-b-0 md:border-r ${cullingWideActive ? "md:hidden" : ""}`}>
          <FolderTree
            folders={tabFolders}
            currentFolder={currentFolder}
            onSelect={(folder) => setCurrentFolderId(folder.id)}
            onRoot={() => setCurrentFolderId(null)}
            onCreateRoot={() => setDialog({ type: "create", parent: null })}
            onAction={openFolderAction}
            canWrite={canWrite}
          />
        </aside>}
        <div className="min-w-0 p-5 md:overflow-y-auto">
          {!folderless && <FolderToolbar
            folder={currentFolder}
            totalFolderCount={totalFolderCount}
            onCreate={() =>
              setDialog({ type: "create", parent: currentFolder })
            }
            onRename={() =>
              setDialog({ type: "rename", folder: currentFolder })
            }
            onDelete={() =>
              setDialog({ type: "delete", folder: currentFolder })
            }
          />}
          {notice && (
            <p
              role="alert"
              className="mt-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700"
            >
              {notice}
            </p>
          )}
          <div className={folderless ? "" : "mt-5 border-t border-slate-200 pt-5"}>
            {!stageReady ? (
              <p className="py-10 text-center text-xs text-slate-500">Loading {moduleLabel}...</p>
            ) : noTabs ? (
              <div className="mx-auto grid min-h-[300px] max-w-[720px] place-items-center rounded-xl border border-dashed border-slate-300 bg-slate-50/60 px-5 text-center text-sm text-slate-500">
                {isLinked
                  ? `${moduleLabel} is not allocated to this project. Allocate it in the project's Post Production Allocation and set its Image Selection column to Yes in Project Settings → Deliverables.`
                  : `This project was created without ${moduleLabel}. Tick ${moduleLabel} on the project from Photo Selection → Projects → Edit to use it here.`}
              </div>
            ) : activeTab === "photos" ? (
              isSubfolder ? (
                <>
                  <UploadManager
                    key={`upload-${currentFolder.id}`}
                    projectId={project.id}
                    projectName={project.name}
                    folderId={currentFolder.id}
                    folderName={currentFolder.name}
                    onUploadReady={refreshGallery}
                    canWrite={clientWrite}
                  />
                  <Gallery
                    key={`gallery-${currentFolder.id}`}
                    projectId={project.id}
                    folderId={currentFolder.id}
                    refreshKey={galleryRevision}
                  />
                </>
              ) : (
                <div className="mx-auto grid min-h-[300px] max-w-[720px] place-items-center rounded-xl border border-dashed border-slate-300 bg-slate-50/60 px-5 text-center text-sm text-slate-500">
                  Select or create a subfolder to upload and view photos.
                </div>
              )
            ) : activeTab === "album" ? (
              // The Signature Album workspace: its own component, its own API and its own rail
              // (drawn into the column below through `albumRailNode`), at the tree's width too.
              <SignatureAlbumWorkspace project={project} canWrite={albumAccess.canWrite} railNode={albumRailNode} onAlbumState={setAlbumHeader} onUploadingChange={setAlbumUploading} />
            ) : activeTab === "culling" ? (
              // Folder-first, the way Photo Selection is: nothing is culled until a folder is
              // chosen in the tree. Standing on "card 1" culls only card 1's photos and standing
              // on the shoot folder culls its whole subtree; the project root is never a scope,
              // so the tab opens on the same guidance Photo Selection gives rather than on the
              // whole project's counts. Keyed by scope so switching folders remounts with that
              // folder's own session.
              !currentFolder ? (
                <div className="mx-auto grid min-h-[300px] max-w-[720px] place-items-center rounded-xl border border-dashed border-slate-300 bg-slate-50/60 px-5 text-center text-sm text-slate-500">
                  {canWrite ? "Select or create a folder to start AI Culling." : "Select a folder to see its AI Culling."}
                </div>
              ) : <CullingWorkspace
                key={`culling-${currentFolder?.id || "project"}`}
                projectId={project.id}
                projectName={project.name}
                folder={currentFolder || null}
                scopeLabel={path.map((entry) => entry.name).join(" / ")}
                // Photos for culling are imported by the desktop app; Photo Selection stays one
                // click away for photos that need its attention.
                onOpenPhotos={openStage("photos")}
                onOpenEditing={openStage("editing")}
                expanded={cullingWideActive}
                onExpandedChange={setCullingWide}
                canWrite={canWrite}
                // A root folder is the shoot itself: its setup shows no mode cards.
                shootFolder={Boolean(currentFolder && !currentFolder.parentId)}
                // Where a ticked selection may be sent from the review: each destination answers
                // to its own permission, and to the project having that tab at all.
                canSendToEditing={linkedTo("culling", "editing") && editingAccess.canWrite}
                canSendToAlbum={linkedTo("culling", "album") && albumAccess.canWrite}
                // AI Culling's "AI Editing + Signature Album" goes on from AI Editing to the album too.
                canSyncEditsToAlbum={linkedTo("editing", "album")}
                // Somebody who could send to AI Editing, on a project not linked to it, is told why
                // there is nowhere to send - never offered another project instead.
                unlinkedNote={stageReady && !linkedTo("culling", "editing") && editingAccess.canWrite
                  ? hasTab("editing")
                    ? "This project's AI Editing project is unlinked, so its kept photos cannot be sent there. Tick AI Editing under Edit Project → Linked Modules to link it again."
                    : "No linked AI Editing project. Tick AI Editing under Edit Project → Linked Modules to link one."
                  : ""}
                refreshKey={galleryRevision}
                onSessionSettled={() => setGalleryRevision((value) => value + 1)}
              />
            ) : activeTab === "editing" ? (
              // The AI Editing bay: folder-first like AI Culling, the same folder scope, keyed by
              // it. Its one send goes to the Signature Album through the backend.
              !currentFolder ? (
                <div className="mx-auto grid min-h-[300px] max-w-[720px] place-items-center rounded-xl border border-dashed border-slate-300 bg-slate-50/60 px-5 text-center text-sm text-slate-500">
                  {editingAccess.canWrite ? "Select or create a folder to start AI Editing." : "Select a folder to see its AI Editing."}
                </div>
              ) : <AiEditingWorkspace
                key={`editing-${currentFolder?.id || "project"}`}
                projectId={project.id}
                projectName={project.name}
                folder={currentFolder || null}
                scopeLabel={path.map((entry) => entry.name).join(" / ")}
                expanded={cullingWideActive}
                onExpandedChange={setCullingWide}
                canWrite={editingAccess.canWrite}
                canSendToAlbum={linkedTo("editing", "album") && albumAccess.canWrite}
                onOpenAlbum={openStage("album")}
                refreshKey={galleryRevision}
                onChanged={refreshGallery}
              />
            ) : (
              <div className="mx-auto grid min-h-[300px] max-w-[720px] place-items-center rounded-xl border border-dashed border-slate-300 bg-slate-50/60 px-5 text-center text-sm text-slate-500">
                <div>
                  <p>
                    {tabs.find((tab) => tab.id === activeTab)?.label} photos will
                    appear here.
                  </p>
                  {activeTabShoots && activeTabShoots.length > 0 && (
                    <p className="mt-2 text-xs">
                      Allocated shoots:{" "}
                      {activeTabShoots.map((shoot) => shoot.shoot).join(", ")}
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
        {/* The right-hand column: the album's own rail on its tab, Photo Selection's settings rail
            (or the View Invite panel) on Photo Selection, and nothing at all on AI Culling and AI
            Editing - not hidden, not drawn, so the grid above has no column for it to leave empty. */}
        {!railless && <div className="contents">
        {activeTab === "album" ? (
          // The album's rail, filled by SignatureAlbumWorkspace above. Everything the Photo
          // Selection rail holds - publish status, Allow Photo Selection, expiry, PIN, the
          // WhatsApp group - stays on the other tabs, untouched. On a phone it comes first: in one
          // column it followed the Gallery, which loads without end, so Publish and the client's
          // link were out of reach until every photo had loaded.
          <div ref={setAlbumRailNode} className="order-first flex min-h-0 flex-col border-b border-slate-200 md:order-none md:h-full md:border-b-0" />
        ) : showInvite ? (
          <WhatsAppTemplatePanel
            project={project}
            canWrite={clientWrite}
            onBack={() => setShowInvite(false)}
            onProjectUpdated={onProjectUpdated}
          />
        ) : (
          <ImageSelectionSettingsPanel
            project={project}
            projectDisabled={projectDisabled}
            onSaved={refreshGallery}
            onProjectChanged={refreshGallery}
            onProjectUpdated={onProjectUpdated}
            onViewInvite={() => setShowInvite(true)}
            rootFolders={folders.map((folder) => ({ id: folder.id, name: folder.name }))}
          />
        )}
        </div>}
      </div>
      {dialog?.type === "create" && (
        <CreateFolderDialog
          parentName={dialog.parent?.name}
          onClose={() => setDialog(null)}
          onCreate={createFolder}
        />
      )}
      {dialog?.type === "rename" && (
        <RenameFolderDialog
          folder={dialog.folder}
          onClose={() => setDialog(null)}
          onRename={renameFolder}
        />
      )}
      {dialog?.type === "delete" && (
        <DeleteFolderDialog
          folder={dialog.folder}
          onClose={() => setDialog(null)}
          onDelete={removeFolder}
        />
      )}
    </section>
  );
}
