"use client";

import ArrowBack from "@mui/icons-material/ArrowBack";
import { useRef, useState } from "react";
import useInfiniteScroll from "@/components/shared/useInfiniteScroll";
import GallerySidebarShell, { SidebarToggle } from "./GallerySidebarShell";
import { GalleryLogo } from "./GalleryBrand";
import SelectionPhotoGrid, { selectionFor } from "./SelectionPhotoGrid";
import { foldersToShow } from "./FolderCards";
import SelectionFooter from "./SelectionFooter";
import { selectionProgressStatus } from "@/lib/selectionProgressStatus.mjs";

function DeliverableSidebar({ activeDeliverable, selectionCounts, folders, activeFolderGroupId, activeFolderId, onOpenFolder, studioName, galleryLogoUrl }) {
  const selected = activeDeliverable ? selectionFor(activeDeliverable, selectionCounts) : 0;
  const progress = selectionProgressStatus(selected, activeDeliverable?.selectionLimit || 0);
  const visibleFolders = foldersToShow(folders, activeFolderGroupId);
  return (
    <>
      {/* Centred to match the selection-items sidebar, which is the same panel one step earlier. */}
      <div className="flex justify-center border-b border-slate-100 px-5 py-5 sm:px-6 sm:py-6">
        <GalleryLogo studioName={studioName} logoUrl={galleryLogoUrl} />
      </div>
      <nav className="p-4">
        {activeDeliverable && <section><div className="rounded-md bg-blue-50 px-3 py-2"><p className="truncate text-xs font-semibold text-blue-700">{activeDeliverable.name}</p><p className="mt-0.5 text-[10px] text-blue-600"><span className="mr-1 font-semibold" style={{ color: progress.color }}>{progress.label}</span>· {selected} selected of {activeDeliverable.selectionLimit}</p></div><h2 className="mb-2 mt-5 px-2 text-xs font-medium text-slate-500">Folders</h2><div className="space-y-2">{visibleFolders.map((folder) => <button key={folder.folderId} type="button" onClick={() => onOpenFolder(folder.folderId)} className={`w-full rounded-lg border px-3 py-2 text-left ${folder.folderId === activeFolderId ? "border-blue-200 bg-blue-50" : "border-slate-200 bg-white hover:bg-slate-50"}`}><span className="block truncate text-xs font-medium text-slate-700">{folder.name}</span><span className="mt-1 block text-[10px] text-slate-500">{folder.selectedByDeliverable?.[activeDeliverable.id] || 0} selected · {folder.total || 0} photos</span></button>)}</div>{!visibleFolders.length && <p className="px-2 py-3 text-xs text-slate-500">No folders are available for this selection setting.</p>}</section>}
      </nav>
    </>
  );
}

export default function FolderGrid({
  projectName, folderName, tab, onTabChange, counts, items, sessionToken,
  onToggleSelect, onOpenImage, onBack, onLoadMore, hasMore, loading,
  onPrevFolder, onNextFolder, hasPrevFolder, hasNextFolder, deliverables = [], selectionCounts = {}, folders = [], activeFolderGroupId, activeFolderId, onOpenFolder, activeDeliverableId,
  // The studio's own branding, for the sidebar. Both come from studio-wide settings by way of the
  // gallery meta; without them the sidebar falls back to the bundled logo.
  studioName, galleryLogoUrl,
  // The People filter this folder was opened with, named - "Person 1, Person 3" - or empty when it
  // was opened from All Photos. The listing arrives already narrowed; this only says so.
  personLabel = "",
  // The card list's footer actions, so a client inside a card sends from where they are rather
  // than walking back: Review & Submit opens the same review, Submit All the same popup.
  onReviewAndSend, onSubmitAll,
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // The photo area is the only thing on this page that scrolls, so it is what the sentinel below
  // is measured against — the window would have the next page arrive late, once the client had
  // already reached the last photo.
  const scrollRef = useRef(null);
  const sentinelRef = useInfiniteScroll({ onLoadMore, hasMore, loading, count: items.length, rootRef: scrollRef, resetKey: `${activeFolderId || ""}|${tab}|${personLabel}` });
  const activeDeliverable = deliverables.find((item) => item.id === activeDeliverableId);
  // "Add to" only offers the selection items filed under the shoot heading this folder sits in —
  // a photo inside Wedding cannot be added to a Reception deliverable. Shoots are matched to the
  // outer folder by name, the same rule the folder cards use to group the sidebar.
  const groupName = (folders.find((folder) => folder.folderId === activeFolderGroupId)?.name || "").trim().toLowerCase();
  // A submitted item is locked, so it is not offered as somewhere to file a photo.
  const groupDeliverables = deliverables.filter((item) => item.enabled !== false && !item.submittedAt && (item.shoot?.shoot || "").trim().toLowerCase() === groupName);
  const menuDeliverables = groupDeliverables.length ? groupDeliverables : activeDeliverable && !activeDeliverable.submittedAt ? [activeDeliverable] : [];
  const selectionLimit = Number(activeDeliverable?.selectionLimit || 0);
  const selectedTotal = activeDeliverable ? selectionFor(activeDeliverable, selectionCounts) : 0;
  const percentage = selectionLimit ? Math.min(100, Math.round((selectedTotal / selectionLimit) * 100)) : 0;
  const topBarStatus = selectionProgressStatus(selectedTotal, selectionLimit);
  return (
    // The viewport is the frame and only the photo area scrolls: the sidebar and the header hold
    // still while the grid moves, on a phone and on a desktop alike.
    <main className="flex h-dvh flex-col overflow-hidden bg-slate-50 lg:grid lg:grid-cols-[248px_minmax(0,1fr)]">
      <GallerySidebarShell open={sidebarOpen} onClose={() => setSidebarOpen(false)} label="Folders and progress">
        <DeliverableSidebar activeDeliverable={activeDeliverable} selectionCounts={selectionCounts} folders={folders} activeFolderGroupId={activeFolderGroupId} activeFolderId={activeFolderId} onOpenFolder={(folderId) => { onOpenFolder(folderId); setSidebarOpen(false); }} studioName={studioName} galleryLogoUrl={galleryLogoUrl} />
      </GallerySidebarShell>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex min-h-14 shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-slate-200 bg-white px-3 py-2 sm:gap-x-4 sm:px-7">
          <SidebarToggle onClick={() => setSidebarOpen(true)} />
          <button type="button" onClick={onBack} aria-label="Back to folders" className="grid h-9 w-9 shrink-0 place-items-center rounded-md text-slate-600 hover:bg-slate-100"><ArrowBack style={{ fontSize: 18 }} /></button>
          <h1 className="min-w-0 flex-1 truncate text-sm font-normal text-slate-800 sm:text-base lg:text-xl">{projectName}{folderName ? ` | ${folderName}` : ""}{personLabel ? ` · ${personLabel}` : ""}</h1>
          <div className="ml-auto flex shrink-0 items-center gap-2 text-xs text-slate-700 sm:gap-4">
            {selectionLimit > 0 && <div className="hidden w-44 lg:block"><div className="flex justify-between"><span><strong>{percentage}%</strong> Completed</span></div><div className="mt-1 h-1 rounded-full bg-slate-100"><div className="h-1 rounded-full bg-blue-600" style={{ width: `${percentage}%` }} /></div></div>}
            <span className="font-medium">{selectedTotal}/{selectionLimit || counts.all}</span>
            <span className="rounded-full px-2 py-1 text-[10px] font-semibold text-white sm:px-3" style={{ backgroundColor: topBarStatus.color }}>{topBarStatus.label}</span>
          </div>
        </header>

        {/* The tab row is pinned between the header and the scrolling grid — part of the frame,
            not the scroll content, so photos can never slide through behind it. */}
        <div className="flex shrink-0 items-center gap-3 bg-slate-50 px-3 py-3 text-xs font-semibold sm:px-5">
            <button type="button" onClick={() => onTabChange("all")} className={`rounded-md px-3 py-2 ${tab === "all" ? "bg-blue-600 text-white" : "text-blue-600 hover:bg-blue-50"}`}>All Photos ({counts.all})</button>
            <button type="button" onClick={() => onTabChange("selected")} className={`rounded-md px-3 py-2 ${tab === "selected" ? "bg-blue-600 text-white" : "text-blue-600 hover:bg-blue-50"}`}>Selected ({counts.selected})</button>
        </div>
        <section ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-3 pb-4 pt-1 sm:px-5">
          <SelectionPhotoGrid
            items={items}
            sessionToken={sessionToken}
            deliverables={deliverables}
            menuDeliverables={menuDeliverables}
            selectionCounts={selectionCounts}
            locked={Boolean(activeDeliverable?.submittedAt)}
            onToggleSelect={onToggleSelect}
            onOpenImage={onOpenImage}
            loading={loading}
            emptyMessage={personLabel ? (tab === "selected" ? `No photos of ${personLabel} selected yet in this folder.` : `No photos of ${personLabel}${personLabel.includes(",") ? " together" : ""} in this folder.`) : tab === "selected" ? "No photos selected yet in this folder." : "No photos in this folder."}
          />
          {/* Where the next page is asked for. The grid above already draws its own waiting tiles
              while one is on the way, so scrolling is the whole gesture and there is nothing to
              press. Rendered only while a page is left, so a finished folder observes nothing. */}
          {hasMore && <div ref={sentinelRef} aria-hidden="true" className="h-px" />}
        </section>
        {/* The card list's own footer, under the grid rather than over it: part of the frame, so the
            photos scroll above it and none hides behind it. */}
        {onReviewAndSend && (
          <SelectionFooter deliverables={deliverables} selectionCounts={selectionCounts} active={activeDeliverable} onReviewAndSend={onReviewAndSend} onSubmitAll={onSubmitAll} className="shrink-0" />
        )}
      </div>
    </main>
  );
}
