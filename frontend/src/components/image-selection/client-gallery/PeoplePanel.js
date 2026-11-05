"use client";

import Button from "@/components/shared/Button";
import Dropdown from "@/components/shared/Dropdown";
import Loader from "@/components/shared/Loader";
import useInfiniteScroll from "@/components/shared/useInfiniteScroll";
import PeopleFilterRow from "./PeopleFilterRow";
import SelectionPhotoGrid from "./SelectionPhotoGrid";
import { peopleState } from "@/lib/clientGalleryPeople.mjs";
import { ALL_SCENES } from "@/lib/clientGalleryScenes.mjs";

const formatCount = (value) => Number(value || 0).toLocaleString("en-US");

/**
 * The body of the gallery home's **People** tab.
 *
 * **Always one grid, never a card to open first.** With nobody chosen it is every photograph of
 * the shoot in view, gathered from all of its cards; with anyone chosen it is the ones all of them
 * are in together. The client is looking for a photograph, or for a person - not for a memory
 * card - so being asked which card to look in was asking them to know something only the studio
 * knows.
 *
 * Each photo still belongs to the card it was uploaded to: nothing is copied or moved, the grid is
 * one listing over the shoot with at most one more condition on it, and a photo appears once
 * however many cards it crossed, because it is one row either way.
 *
 * The tick on a photo is the gallery's own, the same one the folder view writes - a photo picked
 * here is picked everywhere, and one picked earlier in a folder is already ticked here. There is
 * no second selection state to keep in step.
 *
 * Nothing here is a copy: the people are `PeopleFilterRow` and the photographs
 * `SelectionPhotoGrid`, the same grid the folder view and the Selected tab draw. Before anyone is
 * found the tab says why - still organising, nobody in the photos, or face recognition switched
 * off. All Photos never waits on any of it.
 *
 * **The Scene filter** sits on the grid's heading row, beside the count: one compact switch
 * reading "All scenes" that opens to a row per scene the culling run read in these photos -
 * "Family · 8" - the same `Dropdown` the studio's culling review uses, with the same rows. It is
 * one more condition on the same grid: with people chosen it is their photos in that scene, and
 * its counts are of those photos. Absent when the shoot's photos were never culled.
 */
export default function PeoplePanel({
  people = [], peopleInfo = {}, activePersonIds = [], onSelectPerson, onOpenMore, totalCount = 0, totalPeople = 0, sessionToken,
  locked = false,
  // The grid: the photographs themselves and how to ask for the next page.
  photos = {}, personLabel = "",
  // The Scene filter: its rows (`options`, none when there is no scene to offer), the scene in
  // force (`value`), its name for the heading (`label`) and the press that changes it.
  scenes = {},
  deliverables = [], menuDeliverables = [], selectionCounts = {}, onToggleSelect, onOpenImage,
}) {
  const state = peopleState({ ...peopleInfo, people });
  const filtering = activePersonIds.length > 0;
  const { items = [], loading: photosLoading = false, replacing = false, hasMore = false, total = 0, onLoadMore } = photos;
  const { options: sceneRows = [], value: scene = ALL_SCENES, label: sceneName = "", onChange: onSceneChange, processing: scenesProcessing = false } = scenes;
  const inScene = scene !== ALL_SCENES && Boolean(sceneName);
  // Who, and which scene, the grid is showing - "Person 1 · Family" - or the whole shoot.
  const heading = [filtering ? personLabel || "Selected people" : "", inScene ? sceneName : ""].filter(Boolean).join(" · ") || "All Photos";
  // No root is named: the hook finds whatever actually scrolls above the sentinel, which on this
  // page is the window on a phone and the content pane on a desktop. The filter is the reset key,
  // so the page counter starts again when the people change.
  const sentinelRef = useInfiniteScroll({ onLoadMore, hasMore, loading: photosLoading, count: items.length, resetKey: `${activePersonIds.join(",")}|${scene}` });

  if (state === "loading") return <div className="py-16"><Loader label="Loading people..." /></div>;
  if (state !== "ready") {
    const message = {
      processing: ["Organizing people...", "People will appear here once face analysis is complete."],
      empty: ["No people found in this gallery.", "Every photo is still in All Photos."],
      unavailable: ["People is not available for this gallery.", "Every photo is still in All Photos."],
    }[state];
    return (
      <div className="rounded-xl bg-white px-4 py-12 text-center shadow-sm sm:px-6">
        <p className="text-sm font-medium text-slate-700">{message[0]}</p>
        <p className="mt-1 text-xs text-slate-500">{message[1]}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-xl bg-white shadow-sm">
        <PeopleFilterRow people={people} activePersonIds={activePersonIds} onSelect={onSelectPerson} onOpenMore={onOpenMore} sessionToken={sessionToken} totalCount={totalCount} totalPeople={totalPeople} />
        {peopleInfo.processing && <p className="px-3 py-2 text-xs text-slate-400 sm:px-5">Still organizing photos — more people may appear.</p>}
      </div>

      <section>
        {/* Who is being looked for, or the whole shoot, and how many frames that is - said once
            over the grid rather than a card at a time. */}
        <div className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1">
          <h2 className="text-base font-medium text-slate-700 sm:text-lg">{heading}</h2>
          {/* Announced as it changes: a person or a scene chosen with a screen reader is otherwise a
              grid that changed with nothing said about it. */}
          <p role="status" aria-live="polite" className="text-xs text-slate-500">{photosLoading && !items.length ? "Loading photos..." : `${formatCount(total)} ${total === 1 ? "Photo" : "Photos"}`}</p>
          {/* The Scene filter: the culling review's own switch - "All scenes", then "Family · 8" a
              row each, in the profile's order - at the row's end, so the heading keeps its place.
              With people chosen its counts are of their photos, and its name says so. */}
          {sceneRows.length > 0 && (
            <div className="ml-auto">
              <Dropdown ariaLabel={filtering && personLabel ? `Scene, in the photos of ${personLabel}` : "Scene"} mode="switch" options={sceneRows} value={scene} sorted={false} onChange={onSceneChange} />
            </div>
          )}
          {/* Photos are still being read for their scene: said where the switch will appear, or
              beside it while its rows are still growing, the way the People rail says the same. */}
          {scenesProcessing && <p className={`text-xs text-slate-400 ${sceneRows.length ? "basis-full text-right" : "ml-auto"}`}>Organizing scenes...</p>}
        </div>
        {/* The grid is never swapped for a spinner once it has answered: a person coming or going
            is one more condition on the same question, so the photos dim and are replaced in
            place - the rail, the layout and the scroll position all hold still. Only a replacing
            answer dims: the next page of the same answer is added below, behind the grid's own
            placeholder tiles, and leaves the photos already on screen as they are. */}
        <div aria-busy={photosLoading} className={`transition-opacity duration-150 ${photosLoading && replacing && items.length ? "opacity-60" : "opacity-100"}`}>
          <SelectionPhotoGrid
            items={items}
            loading={photosLoading && (!items.length || !replacing)}
            sessionToken={sessionToken}
            deliverables={deliverables}
            menuDeliverables={menuDeliverables}
            selectionCounts={selectionCounts}
            locked={locked}
            onToggleSelect={onToggleSelect}
            onOpenImage={onOpenImage}
            /* An empty scene offers the way back where the client is looking, not only in the switch
               at the row's end: one press, and the whole shoot is back. */
            emptyMessage={inScene
              ? <>{filtering ? `No photos of ${activePersonIds.length > 1 ? "these people" : "this person"} in ${sceneName}.` : `No photos in ${sceneName}.`}<span className="mt-3 block"><Button variant="secondary" size="sm" onClick={() => onSceneChange?.(ALL_SCENES)}>Show all scenes</Button></span></>
              : activePersonIds.length > 1
              ? "No photos found with these people together. Remove one of them, or choose someone else."
              : filtering ? "No photos found for the selected person." : "No photos in this shoot yet."}
          />
        </div>
        {hasMore && <div ref={sentinelRef} aria-hidden="true" className="h-px" />}
      </section>
    </div>
  );
}
