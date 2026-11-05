"use client";

import { useCallback, useState } from "react";
import Loader from "@/components/shared/Loader";
import ToggleSwitch from "@/components/shared/ToggleSwitch";
import useInfiniteScroll from "@/components/shared/useInfiniteScroll";
import AuthImage from "@/components/ai-feature/shared/AuthImage";
import EmptyState from "@/components/ai-feature/shared/EmptyState";
import { formatCount } from "@/lib/aiFeature.mjs";
import { aiFaceThumbnailPath, listAiPeople } from "@/services/ai-feature/ai-feature.service";
import usePagedList from "../usePagedList";
import PersonPanel from "../PersonPanel";

/** "Person 001" for a cluster nobody has named yet; the index is its place in the list. */
export const personLabel = (person, index) => person.label || `Person ${String(index + 1).padStart(3, "0")}`;

/**
 * Every face cluster the engine found, largest first. Mounted only with READ on AI Face
 * Management; renaming, hiding, merging, separating and linking wait for READ_WRITE on the same.
 */
export default function PeopleTab({ eventId, event, faceAccess, mediaRevision, showSuccess, showError, reloadEvent }) {
  const [showHidden, setShowHidden] = useState(false);
  const [openPerson, setOpenPerson] = useState(null);

  const fetchPage = useCallback((page) => listAiPeople(eventId, { page, pageSize: 60, includeHidden: showHidden ? "true" : undefined }), [eventId, showHidden]);
  const list = usePagedList(fetchPage, { resetKey: `${mediaRevision}` });
  const sentinelRef = useInfiniteScroll({ onLoadMore: list.loadMore, hasMore: list.hasMore, loading: list.loading, count: list.items.length, resetKey: `${showHidden}|${mediaRevision}` });

  return <div>
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <p className="text-xs text-slate-500">{formatCount(list.total)} {list.total === 1 ? "person" : "people"} found across {formatCount(event?.faceCount || 0)} faces</p>
      <ToggleSwitch label="Show hidden" size="sm" checked={showHidden} onCheckedChange={setShowHidden} />
    </div>
    {list.error && <p role="alert" className="mb-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{list.error}</p>}
    {!list.loading && list.items.length === 0
      ? <EmptyState title="No people yet." message="People appear here once the photos have been processed and faces grouped. Check the AI processing card on the Overview tab." />
      : <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
        {list.items.map((person, index) => <li key={person.id}>
          <button type="button" onClick={() => setOpenPerson({ person, index })} className={`block w-full overflow-hidden rounded-lg border bg-white text-left shadow-sm transition hover:border-blue-300 focus-visible:outline-2 focus-visible:outline-blue-500 ${person.hidden ? "border-dashed border-slate-300 opacity-70" : "border-slate-200"}`}>
            {person.coverFaceId
              ? <AuthImage path={aiFaceThumbnailPath(eventId, person.coverFaceId)} alt="" className="aspect-square w-full" />
              : <div className="flex aspect-square w-full items-center justify-center bg-slate-100 text-2xl text-slate-400" aria-hidden="true">?</div>}
            <div className="px-2.5 py-2">
              <p className="truncate text-sm font-medium text-slate-800">{personLabel(person, index)}</p>
              <p className="truncate text-[11px] text-slate-500">{formatCount(person.mediaCount)} {person.mediaCount === 1 ? "photo" : "photos"}{person.hidden ? " • hidden" : ""}</p>
              {person.guest?.name && <p className="truncate text-[11px] text-blue-700">{person.guest.name}</p>}
            </div>
          </button>
        </li>)}
      </ul>}
    <div ref={sentinelRef} aria-hidden="true" className="h-px" />
    {list.loading && <Loader label="Loading people..." size="sm" className="py-6" />}

    {openPerson && <PersonPanel
      eventId={eventId}
      person={openPerson.person}
      fallbackLabel={personLabel(openPerson.person, openPerson.index)}
      canWrite={faceAccess.canWrite}
      onClose={() => setOpenPerson(null)}
      onChanged={(updated) => { if (updated) list.patch(updated.id, updated); else list.reload(); reloadEvent?.(); }}
      showSuccess={showSuccess}
      showError={showError}
    />}
  </div>;
}
