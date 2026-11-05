"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import CreateFolderDialog from "./CreateFolderDialog";
import DeleteFolderDialog from "./DeleteFolderDialog";
import FolderCard from "./FolderCard";
import FolderToolbar from "./FolderToolbar";
import FolderTree from "./FolderTree";
import Gallery from "./Gallery";
import GalleryPublication from "./GalleryPublication";
import ImageSelectionSettingsPanel from "./ImageSelectionSettingsPanel";
import WhatsAppTemplatePanel from "./WhatsAppTemplatePanel";
import RenameFolderDialog from "./RenameFolderDialog";
import UploadManager from "./UploadManager";
import Tabs from "@/components/ui/Tabs";
import { useModuleAccess } from "@/components/auth/PermissionsProvider";
import {
  createImageSelectionFolder,
  deleteImageSelectionFolder,
  listImageSelectionAllocatedServices,
  listImageSelectionFolders,
  renameImageSelectionFolder,
} from "@/services/image-selection/image-selection.service";

// The workspace's three tabs are the studio-facing deliverables — every other deliverable the
// Deliverables table marks Yes reaches the client through Selection Settings instead. On a
// project linked to Project Management a tab must be earned twice over: the deliverable is
// allocated in Post Production Allocation, and its row in the Deliverables table's Image
// Selection column says an explicit Yes — No and never-answered both keep the tab off. A
// manually named project has no allocation to read, so it shows the tabs ticked on the Create
// New Project form, stored on the project row; one created before the form asked keeps the
// Photo Selection tab it always had.
//
// An allocation matches its tab when the name *contains* the tab's, so the variants the studio
// allocates under — "Signature Album (Soft Copy)", "Signature Album - Premium" — still raise it.
const WORKSPACE_TABS = [
  { id: "photos", label: "Photo Selection", deliverableName: "Photo Selection" },
  { id: "culling", label: "Photo Culling", deliverableName: "Photo Culling" },
  { id: "album", label: "Signature Album", deliverableName: "Signature Album" },
];
// Mirrors the backend's service-name normalization so "Signature album" and "signature-album"
// match the same tab.
function normalizedName(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

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
export default function ImageSelectionProjectWorkspace({ project, folderTarget = null, refreshSignal = 0, onBack, onProjectUpdated }) {
  /*
   * One permission runs this workspace: shaping a project, uploading the shoot and sending the
   * gallery are the same job done by the same people. READ browses folders, searches the gallery
   * and opens a published link; READ_WRITE is what changes any of it.
   */
  const { canWrite } = useModuleAccess("IMAGE_SELECTION", "Project Management");
  const [activeTab, setActiveTab] = useState("photos");
  const [folders, setFolders] = useState([]);
  const [totalFolderCount, setTotalFolderCount] = useState(0);
  const [currentFolderId, setCurrentFolderId] = useState(folderTarget?.id || null);
  const [openedTarget, setOpenedTarget] = useState(folderTarget);
  // The upload dock passes a fresh folderTarget every time the user clicks a running
  // upload; jumping to that folder is a state reset from a prop, which React wants
  // adjusted during render rather than in an effect.
  if (folderTarget !== openedTarget) {
    setOpenedTarget(folderTarget);
    if (folderTarget?.id) {
      setCurrentFolderId(folderTarget.id);
      setActiveTab("photos");
    }
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
  const updatedLabel = useMemo(() => {
    if (!updatedAt || !now) return "recently";
    const seconds = Math.max(0, Math.floor((now - new Date(updatedAt).getTime()) / 1000));
    if (seconds < 60) return "just now";
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes} min${minutes === 1 ? "" : "s"} ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
    const days = Math.floor(hours / 24);
    return `${days} day${days === 1 ? "" : "s"} ago`;
  }, [updatedAt, now]);
  const loadFolders = useCallback(async () => {
    setLoading(true);
    try {
      const response = await listImageSelectionFolders(project.id);
      setFolders(response.data.folders || []);
      setTotalFolderCount(response.data.totalFolderCount || 0);
      setNotice("");
    } catch (error) {
      setNotice(error.message || "Unable to load folders.");
    } finally {
      setLoading(false);
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
  // Only the names the Deliverables table answers Yes for count — a tab is allocated work the
  // table marked for Image Selection, both answers at once.
  const allocatedNames = useMemo(
    () => (allocatedServices === null ? null : new Set(allocatedServices
      .filter((item) => item.imageSelectionEnabled === true)
      .map((item) => item.key || normalizedName(item.name)))),
    [allocatedServices],
  );
  const isLinked = Boolean(project.salesProjectId);
  const tabs = useMemo(() => {
    // A manual project has no allocation to earn tabs from; it shows the tabs ticked when it was
    // created. Null is a project from before the form asked: Photo Selection on — the tab every
    // manual project used to have — and the other two off.
    if (!isLinked)
      return WORKSPACE_TABS.filter((tab) =>
        tab.id === "photos" ? project.photoSelectionTab !== false
        : tab.id === "culling" ? project.photoCullingTab === true
        : project.signatureAlbumTab === true);
    if (!allocatedNames) return [];
    return WORKSPACE_TABS.filter((tab) => {
      const base = normalizedName(tab.deliverableName);
      return [...allocatedNames].some((name) => name.includes(base));
    });
  }, [isLinked, allocatedNames, project.photoSelectionTab, project.photoCullingTab, project.signatureAlbumTab]);
  // A deliverable can be de-allocated — or its Image Selection answer changed — while its tab is
  // open, so fall back to the first tab the project still has. A manual project's tabs are known
  // without waiting for the allocation, so a project created without Photo Selection opens
  // straight onto its first ticked tab.
  if ((isLinked ? allocatedNames : true) && tabs.length && !tabs.some((tab) => tab.id === activeTab))
    setActiveTab(tabs[0].id);
  // Loaded, linked, and none of the three earned a tab: the workspace has nothing to stand on,
  // so the pane explains what to change instead of silently offering uploads.
  const noTabs = isLinked && allocatedNames !== null && tabs.length === 0;
  // The shoots the active tab stands on: every shoot whose Post Production Allocation carries the
  // tab's deliverable (matched by contained name, Yes in the table). Clicking Photo Culling shows
  // the shoots allocated Photo Culling, not the whole project. Null means "no filter" — a manual
  // project has no allocation to read, and before the allocation loads the tree stays whole.
  const activeTabShoots = useMemo(() => {
    if (!isLinked || !allocatedServices) return null;
    const base = normalizedName(WORKSPACE_TABS.find((tab) => tab.id === activeTab)?.deliverableName);
    if (!base) return null;
    const byId = new Map();
    for (const service of allocatedServices) {
      if (service.imageSelectionEnabled !== true) continue;
      const key = service.key || normalizedName(service.name);
      if (!key.includes(base)) continue;
      for (const shoot of service.shoots || []) if (!byId.has(shoot.id)) byId.set(shoot.id, shoot);
    }
    return [...byId.values()];
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
  async function renameFolder(name) {
    await renameImageSelectionFolder(project.id, dialog.folder.id, name);
    refreshGallery();
    await loadFolders();
  }
  // `options` carries { acknowledgeSubmitted: true } when the delete dialog escalated to the
  // high-impact warning over client-submitted selections and the admin typed the confirmation.
  async function removeFolder(options) {
    const removedId = dialog.folder.id;
    await deleteImageSelectionFolder(project.id, removedId, options);
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
          > div:nth-of-type(2)
          > div:nth-child(2)
          > div[class*="border-t"] {
          border-top-width: 0;
        }
      `}</style>
      <header className="flex min-h-11 items-center border-b border-slate-200 px-3 py-1">
        <div className="min-w-0">
          <h1 className="truncate text-base font-normal text-slate-800">
            {project.name}
          </h1>
          <p className="text-[10px] text-slate-500">Created: {createdLabel}</p>
        </div>
      </header>
      <div className="flex min-h-11 items-end justify-between gap-3 border-b border-slate-200 px-5">
        <Tabs tabs={tabs} value={activeTab} onChange={setActiveTab} ariaLabel="Project workspace sections" className="-mb-px" />
        <div className="mb-2 flex min-w-0 shrink items-center gap-2 text-[10px] text-slate-500">
          {!collectingSelection && <span className="shrink-0">Updated: {updatedLabel}</span>}
          <GalleryPublication
            projectId={project.id}
            projectName={project.name}
            refreshKey={galleryRevision}
            compact
            // The shoot the studio is standing in: the top of the breadcrumb, whichever of its
            // subfolders is open. Downloads are per shoot, so the header offers that shoot's
            // download — and only the publish badge at the project root.
            folder={path[0] || null}
            canWrite={canWrite}
            // A manual project downloads shoot-wise only: the folder must carry a shoot group
            // of its name, and the whole-project fallback download is never offered.
            linked={Boolean(project.salesProjectId)}
            onCollectingChange={setCollectingSelection}
          />
        </div>
      </div>
      <div className="grid md:min-h-0 md:flex-1 md:grid-cols-[210px_minmax(0,1fr)_300px]">
        <aside className="border-b border-slate-200 p-3 md:min-h-0 md:overflow-y-auto md:border-b-0 md:border-r">
          <FolderTree
            folders={tabFolders}
            currentFolder={currentFolder}
            onSelect={(folder) => setCurrentFolderId(folder.id)}
            onRoot={() => setCurrentFolderId(null)}
            onCreateRoot={() => setDialog({ type: "create", parent: null })}
            onAction={openFolderAction}
            canWrite={canWrite}
          />
        </aside>
        <div className="min-w-0 p-5 md:overflow-y-auto">
          <FolderToolbar
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
          />
          {notice && (
            <p
              role="alert"
              className="mt-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700"
            >
              {notice}
            </p>
          )}
          <div className="mt-5 border-t border-slate-200 pt-5">
            {noTabs ? (
              <div className="mx-auto grid min-h-[300px] max-w-[720px] place-items-center rounded-xl border border-dashed border-slate-300 bg-slate-50/60 px-5 text-center text-sm text-slate-500">
                No deliverables are marked for Image Selection. Allocate Photo Selection, Photo
                Culling or Signature Album in the project&apos;s Post Production Allocation and set
                its Image Selection column to Yes in Project Settings → Deliverables.
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
                    canWrite={canWrite}
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
        {showInvite ? (
          <WhatsAppTemplatePanel
            project={project}
            canWrite={canWrite}
            onBack={() => setShowInvite(false)}
            onProjectUpdated={onProjectUpdated}
          />
        ) : (
          <ImageSelectionSettingsPanel
            project={project}
            onSaved={refreshGallery}
            onProjectChanged={refreshGallery}
            onProjectUpdated={onProjectUpdated}
            onViewInvite={() => setShowInvite(true)}
            rootFolderNames={folders.map((folder) => folder.name)}
          />
        )}
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
