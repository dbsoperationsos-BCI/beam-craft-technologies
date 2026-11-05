"use client";
import ArrowBack from "@mui/icons-material/ArrowBack";
import { useMemo, useState } from "react";
import FloatingNotice, { useNotice } from "@/components/shared/FloatingNotice";
import GallerySidebarShell, { SidebarToggle } from "./GallerySidebarShell";
import { GalleryLogo } from "./GalleryBrand";
import PublicGalleryLazyImage from "./PublicGalleryLazyImage";
import { selectionProgressStatus } from "@/lib/selectionProgressStatus.mjs";
import { selectionSentMessage } from "@/lib/clientGalleryHome.mjs";

// `itemName` is the selection item this review is about to submit; selection goes to the studio
// one item at a time, so the header and the send button both name it. Null on the read-only
// "View Selected" path.
//
// The page wears the same frame as the rest of the gallery — the branded sidebar on the left and
// the pinned header over a scrolling pane — so review reads as one more gallery screen rather
// than a detour into a different design. The sidebar summarises each selection item under review
// with the same card the folder screen shows for the active item.
export default function ReviewSelected({ items, folders = [], deliverables = [], itemName = null, projectName = "", studioName, galleryLogoUrl, sessionToken, onBack, onSend, sent, canSend = false }) {
  const [busy, setBusy] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // The outcome of a send — sent, or refused — surfaces as the shared floating snackbar rather
  // than as text pinned in the footer, so it is seen wherever the client has scrolled to.
  const { notice, showSuccess, showError, clearNotice } = useNotice();
  const groups = useMemo(() => {
    const byId = new Map(deliverables.map((item) => [item.id, item])); const folderById = new Map(folders.map((folder) => [folder.folderId, folder])); const result = {};
    items.forEach((image) => (image.photoSelections || []).forEach((selection) => { const deliverable = byId.get(selection.imageSelectionDeliverableConfigId); if (!deliverable) return; const shoot = deliverable.shoot?.shoot || "Selection Items"; const folder = folderById.get(image.folderId); const folderName = folder?.name || "Unsorted"; (result[shoot] ||= {})[deliverable.id] ||= { deliverable, folders: {} }; (result[shoot][deliverable.id].folders[folderName] ||= []).push(image); }));
    return result;
  }, [deliverables, folders, items]);
  // Only photos filed under a deliverable this review covers count — the review may be scoped to
  // one shoot, and a photo picked solely for a later shoot is not part of what is being sent.
  const visibleCount = useMemo(() => {
    const covered = new Set(deliverables.map((item) => item.id));
    return items.filter((image) => (image.photoSelections || []).some((selection) => covered.has(selection.imageSelectionDeliverableConfigId))).length;
  }, [deliverables, items]);
  // What the sidebar cards report: how many of the reviewed photos each selection item holds.
  const countByDeliverable = useMemo(() => {
    const result = {};
    items.forEach((image) => (image.photoSelections || []).forEach((selection) => { result[selection.imageSelectionDeliverableConfigId] = (result[selection.imageSelectionDeliverableConfigId] || 0) + 1; }));
    return result;
  }, [items]);
  async function send() { setBusy(true); clearNotice(); try { await onSend(); showSuccess(selectionSentMessage(itemName, studioName)); } catch (cause) { showError(cause.message || "Unable to send your selection. Please try again."); } finally { setBusy(false); } }
  return (
    // The viewport is the frame and only the photo area scrolls: the sidebar, the header and the
    // send footer hold still while the review moves — the folder screen's exact behavior.
    <main className="flex h-dvh flex-col overflow-hidden bg-slate-50 lg:grid lg:grid-cols-[248px_minmax(0,1fr)]">
      <GallerySidebarShell open={sidebarOpen} onClose={() => setSidebarOpen(false)} label="Review summary">
        {/* Centred to match the folder screen's sidebar, which is the same panel one step earlier. */}
        <div className="flex justify-center border-b border-slate-100 px-5 py-5 sm:px-6 sm:py-6">
          <GalleryLogo studioName={studioName} logoUrl={galleryLogoUrl} />
        </div>
        <nav className="p-4">
          {/* Heading and cards share one left edge — the heading carries no extra indent, so the
              rail reads as a single aligned column under the centred logo. */}
          {itemName && <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">{itemName}</h2>}
          <div className="space-y-2">
            {deliverables.map((item) => {
              const selected = countByDeliverable[item.id] || 0;
              const progress = selectionProgressStatus(selected, item.selectionLimit || 0);
              return (
                <div key={item.id} className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-2.5">
                  <p className="truncate text-xs font-semibold text-blue-700">{item.name}</p>
                  <p className="mt-1 flex items-center gap-1.5 text-[10px] text-blue-600"><span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: progress.color }} /><span className="font-semibold" style={{ color: progress.color }}>{progress.label}</span>· {selected} selected of {item.selectionLimit}</p>
                </div>
              );
            })}
          </div>
          {!deliverables.length && <p className="py-3 text-xs text-slate-500">No selection items are part of this review.</p>}
        </nav>
      </GallerySidebarShell>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex min-h-14 shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-slate-200 bg-white px-3 py-2 sm:gap-x-4 sm:px-7">
          <SidebarToggle onClick={() => setSidebarOpen(true)} />
          <button type="button" onClick={onBack} aria-label="Back to selection" className="grid h-9 w-9 shrink-0 place-items-center rounded-md text-slate-600 hover:bg-slate-100"><ArrowBack style={{ fontSize: 18 }} /></button>
          <h1 className="min-w-0 flex-1 truncate text-sm font-normal text-slate-800 sm:text-base lg:text-xl">{projectName ? `${projectName} | ` : ""}Selected photos{itemName ? ` · ${itemName}` : ""}</h1>
          <div className="ml-auto flex shrink-0 items-center text-xs text-slate-700">
            <span className="font-medium">{visibleCount} selected photo{visibleCount === 1 ? "" : "s"}</span>
          </div>
        </header>
        {/* Full-width from the sidebar's edge — no centred column — and no shoot heading inside
            the pane: the header and the sidebar already name the shoot, so the photos lead. */}
        <section className="min-h-0 flex-1 overflow-y-auto bg-white px-3 py-5 sm:px-5">
          <div className="space-y-8 sm:space-y-10">{Object.keys(groups).length ? Object.entries(groups).map(([shoot, settings]) => <section key={shoot}>{Object.values(settings).map(({ deliverable, folders: settingFolders }, index) => <section key={deliverable.id} className={index ? "mt-6" : ""}><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="min-w-0 truncate text-base font-semibold text-slate-800">{deliverable.name}</h3><span className="text-xs text-slate-500">{Object.values(settingFolders).flat().length}/{deliverable.selectionLimit} selected</span></div>{Object.entries(settingFolders).map(([folderName, images]) => <section key={folderName} className="mt-4"><h4 className="mb-2 text-sm font-medium text-slate-600">{folderName}</h4><div className="grid grid-cols-3 gap-1 sm:grid-cols-5 sm:gap-2 xl:grid-cols-6">{images.map((image) => <div key={`${deliverable.id}-${image.id}`}><div className="aspect-square overflow-hidden rounded-lg bg-slate-100"><PublicGalleryLazyImage src={image.thumbnailUrl} alt={image.fileName} sessionToken={sessionToken} className="h-full w-full" /></div><p className="mt-0.5 truncate px-0.5 text-center text-[9px] text-slate-600 sm:text-[10px]" title={image.fileName}>{image.fileName}</p></div>)}</div></section>)}</section>)}</section>) : <p className="py-12 text-center text-sm text-slate-500">No selected photos to review.</p>}</div>
        </section>
        <footer className="flex shrink-0 flex-col gap-2 border-t border-slate-200 bg-white px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:px-8">{sent ? <p className="w-full text-center text-xs text-slate-600 sm:text-sm">{itemName ? `${itemName} has been submitted.` : "Your selection has been submitted."}</p> : canSend ? <><span className="text-xs text-slate-600 sm:text-sm">Review is read-only. Go back to change selections.</span><button type="button" disabled={busy || visibleCount === 0} onClick={send} className="h-11 w-full shrink-0 rounded-lg bg-blue-600 px-6 text-sm font-semibold text-white disabled:opacity-60 sm:w-auto">{busy ? "Submitting…" : "Submit"}</button></> : <span className="text-xs text-slate-600 sm:text-sm">Review is read-only. Go back to change selections.</span>}</footer>
      </div>
      <FloatingNotice notice={notice} onClose={clearNotice} />
    </main>
  );
}
