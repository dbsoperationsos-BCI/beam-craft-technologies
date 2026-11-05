"use client";
import { useState } from "react";
import GallerySidebarShell, { SidebarToggle } from "./GallerySidebarShell";
import { GalleryLogo } from "./GalleryBrand";
import SelectionPhotoGrid from "./SelectionPhotoGrid";
import PeoplePanel from "./PeoplePanel";
import FolderCardList from "./FolderCardList";
import { selectionProgressStatus } from "@/lib/selectionProgressStatus.mjs";
import { PROGRESS_COLORS } from "@/lib/progressStatus.mjs";
import Button from "@/components/shared/Button";
import Tabs from "@/components/ui/Tabs";
import SelectionStatusPill from "./SelectionStatusPill";
import { galleryHeading, showsDeselectAll } from "@/lib/clientGalleryHome.mjs";
import { galleryEmptyMessage } from "@/lib/galleryEmptyState.mjs";
import SelectionFooter from "./SelectionFooter";

function formatDate(value) {
  return value ? new Date(value).toLocaleDateString("en-GB") : "";
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

// `tab` switches the body between the folder cards, the People tab and the photos already picked
// for the selection item in the sidebar. The Selected tab used to leave for the read-only review
// page, which cost the client the sidebar, the heading and their place; it now shares the in-folder
// grid so a photo can be unpicked or filed elsewhere without going back into a folder. The People
// tab is the face-recognition result for the whole gallery over these same folder cards, counted
// for the chosen people - `people` carries everything `PeoplePanel` draws, and a card there opens
// the same folder view, narrowed to those people's photos, through `people.onOpenFolder`.
export default function FolderCards({
  client, folders, deliverables = [], overall, selectionCounts = {}, activeFolderGroupId, activeDeliverableId,
  onSelectDeliverable, onOpenFolder, onReviewAndSend, onSubmitAll, onDeselectAll, clearing = false,
  tab = "all", onTabChange, selectedItems = [], selectedLoading = false, sessionToken, onToggleSelect, onOpenImage,
  people = {},
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const heading = galleryHeading(client);
  const expiryDate = formatDate(client?.expiresAt);
  const active = deliverables.find((item) => item.id === activeDeliverableId);
  const selected = active ? selectionCounts[active.id] || 0 : 0;
  // What this folder holds for the selection item on screen. Counting every photo the client has
  // picked, for any item, made a folder card disagree with the heading above it — "0 out of 30
  // Images Selected for Retouches" beside a card claiming two were.
  const folderSelected = (folder) => (active ? folder.selectedByDeliverable?.[active.id] || 0 : folder.selected || 0);
  const progress = selectionProgressStatus(selected, active?.selectionLimit || 0);
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

      <div className="flex min-h-screen min-w-0 flex-col pb-40 sm:pb-24 lg:pb-20">
        <div className="flex items-center gap-2 border-b border-slate-200 bg-white px-3 py-2 lg:hidden">
          <SidebarToggle onClick={() => setMenuOpen(true)} />
          <GalleryLogo studioName={client?.studioName} logoUrl={client?.galleryLogoUrl} variant="clientSelectionMobile" />
        </div>
        <header className="bg-white px-4 pt-6 sm:px-8 sm:pt-8">
          {/* The client's name, centred over the content pane - the sidebar is beside the pane,
              not over it, so this is the pane's centre - with the status and count under it. */}
          <h1 className="text-center text-4xl font-semibold leading-tight tracking-tight text-slate-950 [overflow-wrap:anywhere] sm:text-5xl xl:text-6xl">{heading}</h1>
          {/* On a phone the badge takes its own line and the sentence balances its two lines
              under it; from `sm` up they share one line as before. */}
          {active ? (
            <p className="mt-4 flex flex-wrap items-center justify-center gap-2 text-center text-base text-slate-800 max-sm:mt-3 max-sm:flex-col max-sm:gap-1.5">
              <SelectionStatusPill status={progress} plain />
              <span className="max-sm:text-balance max-sm:leading-snug"><strong>{selected}</strong> out of <strong>{active.selectionLimit}</strong> Images Selected for <strong>{active.name}</strong></span>
            </p>
          ) : (
            <p className="mt-4 text-center text-base text-slate-800">
              <strong>{overall.selected}</strong> out of <strong>{overall.total}</strong> Images Selected
            </p>
          )}
          {/* The tabs underlined on one divider, with the expiry on its right; on a narrow screen
              the expiry wraps under the tabs rather than squeezing them. People keeps its β and
              the testing note - one word on a phone, the sentence from `sm` up - said once to a
              screen reader in the tab's name. Same values, same handler. */}
          <div className="mt-5 flex flex-wrap items-end justify-between gap-x-6 gap-y-1 border-b border-slate-200">
            <Tabs
              size="inline"
              ariaLabel="Gallery view"
              className="gap-3 min-[400px]:gap-4 sm:gap-6"
              value={tab}
              onChange={onTabChange}
              tabs={[
                { id: "all", label: "All Photos" },
                {
                  id: "people",
                  label: <>People <span aria-hidden="true">β</span><span className="sr-only"> (beta, under testing)</span><span aria-hidden="true" className="ml-1 text-[11px] font-normal text-slate-500">(<span className="sm:hidden">testing</span><span className="hidden sm:inline">this feature is under testing</span>)</span></>,
                },
                { id: "selected", label: `Selected${active ? ` (${selected})` : ""}` },
              ]}
            />
            {expiryDate && (
              <p className="pb-2 text-xs text-slate-600 max-sm:w-full max-sm:pt-1 max-sm:text-center">
                Photo selection will expire on <strong className="text-slate-900">{expiryDate}</strong>
              </p>
            )}
          </div>
        </header>

        <section className="flex-1 px-4 pt-5 pb-6 sm:px-8 sm:pt-6">
          {/* "Add to" offers only the shoot in view, and only what is still open: a submitted
              item is locked, so it is not somewhere a photo can still be filed. */}
          {tab === "people" ? (
            <PeoplePanel
              people={people.people}
              peopleInfo={people.info}
              activePersonIds={people.activePersonIds}
              onSelectPerson={people.onSelectPerson}
              onOpenMore={people.onOpenMore}
              totalCount={people.totalCount}
              totalPeople={people.totalPeople}
              sessionToken={sessionToken}
              locked={Boolean(active?.submittedAt)}
              /* One grid of this shoot's photographs - all of them, or the ones the chosen people
                 are in together - picked into the same selection item the cards would have. */
              photos={people.photos}
              personLabel={people.personLabel}
              /* The Scene filter beside the people - the scenes the culling run read in these photos. */
              scenes={people.scenes}
              deliverables={deliverables}
              menuDeliverables={groupPending}
              selectionCounts={selectionCounts}
              onToggleSelect={onToggleSelect}
              onOpenImage={people.onOpenPeopleImage}
            />
          ) : tab === "selected" ? (
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
              emptyMessage={active ? `No photos selected yet for ${active.name}.` : "Choose a selection item to see what you have picked."}
            />
          ) : (
          <FolderCardList folders={visibleFolders} folderSelected={folderSelected} locked={Boolean(active?.submittedAt)} onOpenFolder={onOpenFolder} sessionToken={sessionToken} emptyMessage={galleryEmptyMessage({ item: active, groupFolderId: activeFolderGroupId, folders, hasItems: deliverables.length > 0 })} />
          )}
        </section>
      </div>

      {/* The gallery's footer, shared with an open card. Pinned to the bottom here, and from lg it
          starts after the 240px sidebar column instead of running under it. Deselect All
          joins it only on the Selected tab, where the picks it releases are the ones on screen,
          and only once something is picked - absent once the item is submitted, because nothing
          can be unpicked then. */}
      <SelectionFooter
        deliverables={deliverables}
        selectionCounts={selectionCounts}
        active={active}
        onReviewAndSend={onReviewAndSend}
        onSubmitAll={onSubmitAll}
        className="fixed inset-x-0 bottom-0 lg:left-60"
        leading={showsDeselectAll(tab, selected) ? (
          <Button
            type="button"
            variant="danger"
            size="none"
            busy={clearing}
            busyLabel="Deselecting..."
            onClick={onDeselectAll}
            title={`Deselect all ${selected} photos picked for ${active?.name || "this selection item"}.`}
            className="h-11 flex-1 whitespace-nowrap rounded-lg px-4 !text-sm max-sm:px-3 max-sm:!text-[13px] sm:h-10 sm:flex-none"
          >
            Deselect All
          </Button>
        ) : null}
      />
    </main>
  );
}
