"use client";
import ArrowForward from "@mui/icons-material/ArrowForward";
import { useState } from "react";
import GallerySidebarShell, { SidebarToggle } from "./GallerySidebarShell";
import { GalleryLogo } from "./GalleryBrand";
import SelectionPhotoGrid from "./SelectionPhotoGrid";
import { selectionProgressStatus } from "@/lib/selectionProgressStatus.mjs";
import { PROGRESS_COLORS } from "@/lib/progressStatus.mjs";

function formatDate(value) {
  return value ? new Date(value).toLocaleDateString("en-GB") : "";
}

// Completion across every selection item. The target is how many photos the client has to
// pick in total — the sum of the limits — not how many photos the gallery holds.
function overallCompletion(deliverables, selectionCounts) {
  const totals = deliverables.reduce(
    (acc, item) => {
      const limit = Number(item.selectionLimit) || 0;
      return { limit: acc.limit + limit, done: acc.done + Math.min(selectionCounts[item.id] || 0, limit) };
    },
    { limit: 0, done: 0 },
  );
  return { ...totals, percentage: totals.limit ? Math.round((totals.done / totals.limit) * 100) : 0 };
}

/**
 * The folders a client is offered inside the shoot folder in view: its subfolders, or — when the
 * studio filed the photos in the shoot folder itself and made none — that folder on its own.
 * Shared with the in-folder sidebar so both lists agree about what exists.
 */
export function foldersToShow(folders, activeFolderGroupId) {
  const children = folders.filter((folder) => folder.parentId === activeFolderGroupId);
  if (children.length) return children;
  const group = folders.find((folder) => folder.folderId === activeFolderGroupId);
  return group && group.total ? [group] : children;
}

// `tab` switches the body between the folder cards and the photos already picked for the
// selection item in the sidebar. The Selected tab used to leave for the read-only review page,
// which cost the client the sidebar, the heading and their place; it now shares the in-folder
// grid so a photo can be unpicked or filed elsewhere without going back into a folder.
export default function FolderCards({
  client, folders, deliverables = [], overall, selectionCounts = {}, activeFolderGroupId, activeDeliverableId,
  onSelectDeliverable, onOpenFolder, onReviewAndSend, onDeselectAll, clearing = false,
  tab = "all", onTabChange, selectedItems = [], selectedLoading = false, sessionToken, onToggleSelect, onOpenImage,
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const clientName = [client?.groomName, client?.brideName].filter(Boolean).join(" & ") || client?.clientName || "Your gallery";
  const expiryDate = formatDate(client?.expiresAt);
  const active = deliverables.find((item) => item.id === activeDeliverableId);
  const selected = active ? selectionCounts[active.id] || 0 : 0;
  // What this folder holds for the selection item on screen. Counting every photo the client has
  // picked, for any item, made a folder card disagree with the heading above it — "0 out of 30
  // Images Selected for Retouches" beside a card claiming two were.
  const folderSelected = (folder) => (active ? folder.selectedByDeliverable?.[active.id] || 0 : folder.selected || 0);
  const progress = selectionProgressStatus(selected, active?.selectionLimit || 0);
  const enabled = deliverables.filter((item) => item.enabled !== false);
  const completion = overallCompletion(enabled, selectionCounts);
  // A selection item derived from Post Production Allocation belongs to one shoot, so it is listed
  // under the folder that shoot created. An item the studio typed on a manually named project has
  // no shoot behind it and applies to the whole project, so it is offered under every folder.
  const groups = folders
    .filter((folder) => !folder.parentId)
    .map((outer) => ({ outer, items: deliverables.filter((item) => !item.shoot?.shoot || item.shoot.shoot.trim().toLowerCase() === outer.name.trim().toLowerCase()) }))
    .filter((group) => group.items.length);
  // The cards are the subfolders of the shoot folder in view. A project whose photos sit directly
  // in that folder has no subfolders, and used to show the client an empty gallery, so the folder
  // itself becomes the card.
  const visibleFolders = foldersToShow(folders, activeFolderGroupId);
  // Submission goes out one selection item at a time — the engagement album is filled months
  // before the wedding album — so the button is gated on the item in view: it has to reach its
  // limit, and an item already sent shows as submitted instead. "Add to" still offers the other
  // unsubmitted items of the shoot folder in view.
  const activeGroup = groups.find((group) => group.outer.folderId === activeFolderGroupId) || null;
  const groupPending = (activeGroup?.items || []).filter((item) => item.enabled !== false && !item.submittedAt);
  const activeSubmitted = Boolean(active?.submittedAt);
  // Whether this item may be sent. One photo is enough: the limit is a ceiling on how many the
  // client may pick, not a quota they have to fill, and the server applies the same rule.
  const canSubmit = Boolean(active) && !activeSubmitted && selected > 0;

  const sidebar = (
    <>
      {/* Centred rather than flush left: a logo can be any proportion — a wide wordmark or a square
          badge — and centring is the one placement that suits both. */}
      <div className="flex justify-center px-5 py-5">
        <GalleryLogo studioName={client?.studioName} logoUrl={client?.galleryLogoUrl} />
      </div>
      <nav className="px-3 pb-6">
        {groups.map(({ outer, items }) => (
          <section key={outer.folderId} className="mb-4">
            {/* The shoot heading answers the one question the client keeps coming back with over a
                months-long project: how much of this shoot has been sent yet? Items submit one at
                a time, so the badge summarises them — all sent, some, or none. */}
            <h2 className="flex items-center justify-between gap-2 px-2 py-1 text-xs text-slate-400">
              <span className="min-w-0 truncate">{outer.name}</span>
              {items.every((item) => item.submittedAt)
                ? <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-600">Submitted</span>
                : <span className="shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-600">{items.some((item) => item.submittedAt) ? `${items.filter((item) => item.submittedAt).length} of ${items.length} submitted` : "Not submitted"}</span>}
            </h2>
            {items.map((item) => {
              const count = selectionCounts[item.id] || 0;
              const submitted = Boolean(item.submittedAt);
              // A submitted item can still be opened so the client can look back at what they
              // sent; only changing it is refused. Its text stays muted so the sidebar still
              // reads at a glance as done versus in progress.
              return (
                <button
                  key={item.id}
                  type="button"
                  title={submitted ? "This selection has been submitted — you can view it, but it can no longer be changed." : undefined}
                  onClick={() => { onSelectDeliverable(item, outer.folderId); setMenuOpen(false); }}
                  className={`flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-[13px] ${item.id === activeDeliverableId ? "bg-blue-50 text-blue-700" : submitted ? "text-slate-400 hover:bg-slate-50" : "text-slate-700 hover:bg-slate-50"}`}
                >
                  {/* No badge of its own: the shoot heading already counts what has been sent,
                      and repeating it on every row drowned the counts. The greyed text and green
                      dot are what mark the item as sent. */}
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: submitted ? PROGRESS_COLORS.completed : selectionProgressStatus(count, item.selectionLimit).color }} />
                  <span className="min-w-0 flex-1 truncate">{item.name}</span>
                  <span className="shrink-0 text-xs">({count}/{item.selectionLimit})</span>
                </button>
              );
            })}
          </section>
        ))}
        {!groups.length && <p className="px-2 py-3 text-xs text-slate-500">No selection items have been shared yet.</p>}
      </nav>
    </>
  );

  return (
    <main className="min-h-screen bg-slate-50 lg:grid lg:grid-cols-[240px_minmax(0,1fr)]">
      <GallerySidebarShell open={menuOpen} onClose={() => setMenuOpen(false)} label="Selection items">{sidebar}</GallerySidebarShell>

      <div className="flex min-h-screen min-w-0 flex-col pb-28 sm:pb-24 lg:pb-16">
        <div className="flex items-center gap-2 border-b border-slate-200 bg-white px-3 py-2 lg:hidden">
          <SidebarToggle onClick={() => setMenuOpen(true)} />
          <GalleryLogo studioName={client?.studioName} logoUrl={client?.galleryLogoUrl} variant="clientSelectionMobile" />
        </div>
        <header className="bg-white px-4 pt-5 sm:px-8 sm:pt-6">
          <h1 className="font-serif text-3xl leading-tight tracking-tight text-slate-950 sm:text-5xl xl:text-6xl">{clientName}</h1>
          {active ? (
            <p className="mt-4 flex flex-wrap items-center gap-2 text-base text-slate-800">
              <span className="rounded-md px-2 py-0.5 text-[11px] font-semibold text-white" style={{ backgroundColor: progress.color }}>{progress.label}</span>
              <span><strong>{selected}</strong> out of <strong>{active.selectionLimit}</strong> Images Selected for <strong>{active.name}</strong></span>
            </p>
          ) : (
            <p className="mt-4 text-base text-slate-800">
              <strong>{overall.selected}</strong> out of <strong>{overall.total}</strong> Images Selected
            </p>
          )}
          <div className="mt-5 flex flex-wrap items-end justify-between gap-3 border-b border-slate-200">
            <div className="flex gap-6 text-[13px] font-medium">
              <button type="button" onClick={() => onTabChange("all")} className={`border-b-2 px-1 pb-2 ${tab === "all" ? "border-blue-600 text-blue-600" : "border-transparent text-slate-600 hover:text-blue-600"}`}>All Photos</button>
              <button type="button" onClick={() => onTabChange("selected")} className={`border-b-2 px-1 pb-2 ${tab === "selected" ? "border-blue-600 text-blue-600" : "border-transparent text-slate-600 hover:text-blue-600"}`}>Selected{active ? ` (${selected})` : ""}</button>
            </div>
            {expiryDate && (
              <p className="pb-2 text-xs text-slate-600">
                Photo selection will expire on <strong className="text-slate-900">{expiryDate}</strong>
              </p>
            )}
          </div>
        </header>

        <section className="flex-1 px-4 py-5 sm:px-8 sm:py-6">
          {/* "Add to" offers only the shoot in view, and only what is still open: a submitted
              item is locked, so it is not somewhere a photo can still be filed. */}
          {tab === "selected" ? (
            <SelectionPhotoGrid
              items={selectedItems}
              loading={selectedLoading}
              sessionToken={sessionToken}
              deliverables={deliverables}
              menuDeliverables={groupPending}
              selectionCounts={selectionCounts}
              locked={Boolean(active?.submittedAt)}
              onToggleSelect={onToggleSelect}
              onOpenImage={onOpenImage}
              emptyMessage={active ? `No photos selected yet for ${active.name}.` : "Select a Selection Setting to see what you have picked."}
            />
          ) : (
          <div className="max-w-2xl space-y-4">
            {visibleFolders.length ? (
              visibleFolders.map((folder) => (
                <article key={folder.folderId} className="rounded-xl bg-white px-4 py-4 shadow-sm sm:px-6 sm:py-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h2 className="min-w-0 flex-1 truncate text-lg text-slate-500 sm:text-xl">{folder.name}</h2>
                    {/* After the selection is submitted the folder is view-only, and the button
                        says so — the same door, no longer promising a choice. */}
                    <button type="button" onClick={() => onOpenFolder(folder.folderId)} className="inline-flex h-9 shrink-0 items-center gap-2 rounded-md bg-blue-600 px-3 text-xs font-medium text-white hover:bg-blue-700">
                      {active?.submittedAt ? "See Photos" : "Select Photos"} <ArrowForward style={{ fontSize: 14 }} />
                    </button>
                  </div>
                  {/* The count alone, not "3/5": the limit belongs to the selection item across every
                      folder, so a ratio on one card read as that folder's own quota. The limit is
                      already stated once, in the heading above the cards. */}
                  <p className="mt-3 text-xs text-slate-600">
                    Total: {folder.total} | {folderSelected(folder)} Selected
                  </p>
                </article>
              ))
            ) : (
              <p className="py-12 text-center text-sm text-slate-500">Select a Selection Setting to view its gallery folders.</p>
            )}
          </div>
          )}
        </section>
      </div>

      <footer className="fixed inset-x-0 bottom-0 flex flex-col gap-2 border-t border-slate-200 bg-white px-4 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:flex-row sm:items-center sm:justify-between sm:gap-6 sm:px-8 lg:pl-66">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] text-slate-600">Overall Completion: {completion.percentage}%</p>
          <div className="mt-1 flex max-w-md items-center gap-3">
            <div className="h-1 min-w-0 flex-1 rounded-full bg-slate-100">
              <div className="h-1 rounded-full bg-blue-600" style={{ width: `${completion.percentage}%` }} />
            </div>
            <span className="shrink-0 text-[10px] text-slate-500">{completion.done} of {completion.limit} Photos</span>
          </div>
        </div>
        {activeSubmitted ? (
          <p className="shrink-0 text-xs font-semibold text-emerald-600">{active?.name || "This selection item"} submitted</p>
        ) : (
          <div className="flex shrink-0 flex-col gap-2 sm:flex-row sm:items-center">
          {/* Between the progress and Review & Submit: the way back from a selection the client
              wants to start over. Absent rather than disabled once the item is submitted, because
              nothing can be unpicked then — that is the branch above. */}
          <button
            type="button"
            disabled={!selected || clearing}
            onClick={onDeselectAll}
            title={selected ? `Deselect all ${selected} photos picked for ${active?.name || "this selection item"}.` : "No photos are selected yet."}
            className="h-9 w-full shrink-0 rounded-md bg-red-600 px-4 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-40 sm:w-auto"
          >
            {clearing ? "Deselecting..." : "Deselect All"}
          </button>
          <button
            type="button"
            disabled={!canSubmit}
            onClick={onReviewAndSend}
            title={canSubmit ? undefined : `Pick at least one photo for ${active?.name || "this selection item"} first.`}
            className="h-9 w-full shrink-0 rounded-md bg-slate-700 px-5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-40 sm:w-auto"
          >
            Review &amp; Submit{active ? ` · ${active.name}` : ""}
          </button>
          </div>
        )}
      </footer>
    </main>
  );
}
