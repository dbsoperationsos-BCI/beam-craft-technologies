"use client";

import ArrowForward from "@mui/icons-material/ArrowForward";
import CheckRounded from "@mui/icons-material/CheckRounded";
import CloseRounded from "@mui/icons-material/CloseRounded";
import GroupsRounded from "@mui/icons-material/GroupsRounded";
import { useCallback, useEffect, useRef, useState } from "react";
import useEscapeKey from "@/components/shared/useEscapeKey";
import useFocusTrap from "@/components/shared/useFocusTrap";
import useInfiniteScroll from "@/components/shared/useInfiniteScroll";
import FaceAvatar from "./FaceAvatar";
import { MAX_PEOPLE, togglePerson } from "@/lib/clientGalleryPeople.mjs";

// How many people one request brings back. Enough to fill the list twice over on a desktop, so the
// first answer never leaves a gap, and small enough that a gallery with thousands of faces costs
// one short query per scroll rather than one enormous one.
const PAGE_SIZE = 40;
// How long the panel takes to arrive and to leave. Short enough not to be waited on.
const TRANSITION_MS = 160;
const formatCount = (value) => Number(value || 0).toLocaleString("en-US");
const photosLabel = (value) => `${formatCount(value)} ${Number(value) === 1 ? "photo" : "photos"}`;
// A hairline scrollbar rather than the platform's, which is a slab across a panel this size.
const THIN_SCROLL = "[scrollbar-width:thin] [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300 [&::-webkit-scrollbar]:w-1.5";

/**
 * **Select People** - everyone the gallery found, in a panel of their own.
 *
 * This is what the People rail's **More** opens. It used to tip the rest of the people into the
 * rail itself, which on a gallery holding hundreds of faces meant scrolling sideways through all
 * of them to reach one; the rail is a filter, not a place to browse.
 *
 * Two columns from `md` - the faces to scroll on the left, and on the right the people
 * chosen so far, each removable, over a note saying what choosing several of them means. On a
 * phone it is a near full-height sheet and the right column folds into a row of faces under the
 * grid, since a second column at that width is a second thing to scroll rather than a summary. In
 * both, **only the grid scrolls**: the header, the count and the footer hold still,
 * and the gallery behind is locked while the panel is open.
 *
 * **A card is the whole target, and an unchosen one carries no box.** A grid of empty squares is
 * a form to fill in; this is a set of faces to recognise, so nothing is drawn on a card until it
 * is chosen, and then a tick in its corner with the card tinted behind it. Pressing anywhere on
 * the card chooses or unchooses - it is a button, so Enter and Space do too.
 *
 * **There are no page numbers.** A gallery may hold thousands of faces, so the grid is read a page
 * at a time as the reader nears its end (`useInfiniteScroll`), appended without moving what they
 * were looking at, with a quiet line at the foot while the next one is on its way. There is no
 * search box - the grid is everybody, in the gallery's own order - and choosing somebody asks for
 * nothing and moves nothing.
 *
 * **Nothing is filtered while the panel is open.** Ticking people edits a draft seeded from the
 * filter as it stands, so choosing four costs no reloads and no flicker. **Apply** hands the draft
 * over and closes, **Cancel** and Escape drop it, and **Clear all** - beside the people it
 * empties, rather than under the whole panel - empties it. None of the three touches a single
 * picked photo, which is a different thing entirely and lives on the photo.
 *
 * Several people mean the photos every one of them is in **together** - the panel chooses who,
 * never how - and it stops at ten, which is the server's own ceiling on a public query and the
 * reason there is no "select all": such a control could only ever refuse the eleventh.
 */
export default function PeoplePickerDialog({ activePersonIds = [], knownPeople = [], onApply, onClose, loadPeople, sessionToken }) {
  const [draft, setDraft] = useState(activePersonIds);
  const [people, setPeople] = useState([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refused, setRefused] = useState(false);
  // Off for the first frame and off again while it leaves, which is the whole of the animation.
  const [shown, setShown] = useState(false);
  const scrollRef = useRef(null);
  // Focus goes into the panel as it opens, Tab stays inside it, and closing hands focus back to More
  // - the same trap every dialog in this application takes.
  const panelRef = useFocusTrap();
  // Only the latest answer asked for may land, so a page that arrives late never lands twice.
  const requestRef = useRef(0);
  const pageRef = useRef(1);
  /*
   * Everybody this browser has been told about, so a person chosen from deep in the list can be
   * drawn in the right-hand column without being on the page in view. Seeded once with whatever
   * the gallery already knew - the rail's own few, and anybody chosen before - and added to as
   * pages arrive. One Map made on the first render and then written to: every render that needs
   * it is already caused by something else (a page landing, a tick), so there is nothing here for
   * a second copy in state to trigger.
   */
  const [knownById] = useState(() => new Map((knownPeople || []).map((person) => [person.id, person])));
  const personOf = (id) => knownById.get(id) || { id, label: "Person", photoCount: 0, cover: null };

  // Arrives on the frame after it mounts, and leaves before it unmounts, so both are a transition
  // rather than a jump. `requestClose` is what every way out goes through.
  useEffect(() => { const frame = requestAnimationFrame(() => setShown(true)); return () => cancelAnimationFrame(frame); }, []);
  const requestClose = useCallback((after) => {
    setShown(false);
    window.setTimeout(() => (after ? after() : onClose()), TRANSITION_MS);
  }, [onClose]);

  useEscapeKey(() => requestClose(), true);
  // The gallery behind holds its place while the panel is open - the same lock every other overlay
  // in this application takes, and put back exactly as it was found.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, []);

  const load = useCallback(async (nextPage) => {
    const request = (requestRef.current += 1);
    setLoading(true);
    try {
      const response = await loadPeople({ page: nextPage, pageSize: PAGE_SIZE });
      if (request !== requestRef.current) return;
      const batch = response?.people || [];
      batch.forEach((person) => knownById.set(person.id, person));
      pageRef.current = nextPage;
      setPeople((current) => (nextPage === 1 ? batch : [...current, ...batch]));
      setTotal(response?.total || 0);
      setHasMore(Boolean(response?.hasMore));
      setError("");
    } catch (cause) {
      if (request !== requestRef.current) return;
      setError(cause?.message || "Unable to load people.");
    } finally {
      if (request === requestRef.current) setLoading(false);
    }
  }, [loadPeople, knownById]);

  // The first page, deferred a tick as this codebase's first loads are. Choosing somebody is not in
  // here: it edits the draft and nothing else, so the grid never reloads or moves under the hand
  // that pressed it.
  useEffect(() => {
    const timer = setTimeout(() => { void load(1); }, 0);
    return () => clearTimeout(timer);
  }, [load]);

  const sentinelRef = useInfiniteScroll({
    onLoadMore: () => load(pageRef.current + 1),
    hasMore,
    loading,
    count: people.length,
    rootRef: scrollRef,
  });

  function toggle(personId) {
    const { next, refused: full } = togglePerson(draft, personId);
    setRefused(full);
    setDraft(next);
  }
  const clearDraft = () => { setDraft([]); setRefused(false); };

  const chosen = draft.length;
  const listEmpty = !loading && !people.length && !error;

  /**
   * One person, as a card.
   *
   * **Nothing is drawn on it until it is chosen.** An empty box on every face turned a set of
   * people to recognise into a form to fill in; chosen, the card tints, its edge and the ring
   * around the face go blue, and a tick appears in the corner - so the state is the card itself
   * rather than a control on it. The whole card is the button, so there is no small target to
   * find and Enter and Space work where a press does.
   */
  const personCard = (person, active) => (
    <li key={person.id}>
      <button
        type="button"
        aria-pressed={active}
        onClick={() => toggle(person.id)}
        className={`relative flex w-full cursor-pointer flex-col items-center gap-1.5 rounded-xl border px-2 py-3 text-center transition focus:outline-none focus:ring-2 focus:ring-blue-300 ${active ? "border-blue-300 bg-blue-50/70" : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"}`}
      >
        {active && (
          <span aria-hidden="true" className="absolute right-1.5 top-1.5 grid h-5 w-5 place-items-center rounded-full bg-blue-600 text-white shadow-sm">
            <CheckRounded style={{ fontSize: 14 }} />
          </span>
        )}
        <FaceAvatar cover={person.cover} label={person.label} sessionToken={sessionToken} size={52} className={active ? "ring-2 ring-blue-400" : "ring-1 ring-slate-200"} />
        <span className="w-full min-w-0">
          <span className={`block truncate text-xs font-semibold ${active ? "text-blue-800" : "text-slate-800"}`}>{person.label}</span>
          <span className={`block truncate text-[11px] ${active ? "text-blue-600" : "text-slate-500"}`}>{photosLabel(person.photoCount)}</span>
        </span>
      </button>
    </li>
  );

  const selectedCard = (person) => (
    <li key={person.id} className="flex items-center gap-2.5 rounded-xl border border-slate-200/80 bg-white px-2.5 py-2">
      <FaceAvatar cover={person.cover} label={person.label} sessionToken={sessionToken} size={32} className="ring-1 ring-slate-200" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-semibold text-slate-800">{person.label}</span>
        <span className="block truncate text-[11px] text-slate-500">{photosLabel(person.photoCount)}</span>
      </span>
      <button type="button" onClick={() => toggle(person.id)} aria-label={`Remove ${person.label} from the filter`} className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-200">
        <CloseRounded style={{ fontSize: 16 }} />
      </button>
    </li>
  );

  const andNote = <>Photos will be shown where <span className="font-semibold text-blue-700">all selected people appear together</span> in the same photo.</>;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4 lg:p-6" role="dialog" aria-modal="true" aria-labelledby="people-picker-title">
      <button
        type="button"
        aria-label="Close people"
        onClick={() => requestClose()}
        className={`absolute inset-0 bg-slate-900/40 backdrop-blur-[2px] transition-opacity duration-150 ${shown ? "opacity-100" : "opacity-0"}`}
      />
      <div
        ref={panelRef}
        className={`relative flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-3xl border border-slate-200 bg-white shadow-[0_24px_70px_rgba(15,23,42,0.18)] transition-all duration-150 ease-out sm:max-h-[86vh] sm:max-w-xl sm:rounded-3xl md:max-w-3xl lg:max-w-4xl ${shown ? "translate-y-0 opacity-100 sm:scale-100" : "translate-y-3 opacity-0 sm:translate-y-0 sm:scale-[0.98]"}`}
      >
        {/* ── Header ─────────────────────────────────────────────────────────────────────── */}
        <header className="flex shrink-0 items-start gap-3 border-b border-slate-200 px-4 py-3.5 sm:px-6 sm:py-4">
          <span aria-hidden="true" className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-blue-50 text-blue-600">
            <GroupsRounded style={{ fontSize: 22 }} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="people-picker-title" className="truncate text-base font-semibold text-slate-900">Select People</h2>
            <p className="mt-0.5 truncate text-xs text-slate-500">Choose one or more people to filter photos</p>
          </div>
          <button type="button" onClick={() => requestClose()} aria-label="Close" className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-200">
            <CloseRounded style={{ fontSize: 20 }} />
          </button>
        </header>

        {/* ── Body: the browser, and on a wide screen the people chosen beside it ────────── */}
        <div className="flex min-h-0 flex-1 md:divide-x md:divide-slate-200">
          <section className="flex min-h-0 flex-1 flex-col md:w-3/5">
            {/* How many there are, and the ceiling the server keeps. There is deliberately no
                "select all": the filter takes ten people at most, so it could only refuse. */}
            <div className="flex shrink-0 items-center gap-2 border-b border-slate-100 bg-slate-50/60 px-4 py-2 sm:px-5">
              <p className="text-xs font-medium text-slate-600">{formatCount(total)} people</p>
              <p className="ml-auto text-[11px] text-slate-400">{chosen ? `${chosen} of ${MAX_PEOPLE} selected` : `Up to ${MAX_PEOPLE} at a time`}</p>
            </div>
            {refused && <p role="alert" className="shrink-0 bg-amber-50 px-4 py-1.5 text-[11px] font-medium text-amber-800 sm:px-5">You can filter by up to {MAX_PEOPLE} people at once.</p>}

            {/* The one thing on this panel that scrolls. */}
            <div ref={scrollRef} className={`min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3 sm:px-5 ${THIN_SCROLL}`}>
              {error && <p role="alert" className="mb-2 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
              {/* Two across on a phone, three on a tablet, four where the column is widest. */}
              <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                {people.map((person) => personCard(person, draft.includes(person.id)))}
              </ul>
              {listEmpty && <p className="px-4 py-14 text-center text-sm text-slate-500">No people found in this gallery.</p>}
              {/* A quiet line at the foot while the next page is on its way - never a spinner over
                  what has already been read. */}
              {loading && <p className="px-4 py-3 text-center text-xs text-slate-400">Loading people...</p>}
              {hasMore && <div ref={sentinelRef} aria-hidden="true" className="h-px" />}
            </div>
          </section>

          {/* The people chosen so far. A column of its own from `md` - a tablet has the width for
              both - and below that a row of faces under the list instead. */}
          <aside className="hidden min-h-0 w-2/5 flex-col bg-slate-50/60 md:flex">
            <div className="flex shrink-0 items-center gap-2 px-4 pb-2.5 pt-3.5">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Selected People</h3>
              <span className="grid h-5 min-w-5 place-items-center rounded-full bg-blue-600 px-1.5 text-[11px] font-semibold text-white">{chosen}</span>
              <button type="button" onClick={clearDraft} disabled={!chosen} className="ml-auto rounded-md px-2 py-1 text-[11px] font-semibold text-blue-600 transition hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-transparent">Clear all</button>
            </div>
            {/* Scrolls on its own once there are more than the column holds, so it can never push
                the note or the footer off the bottom. */}
            <div className={`min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-3 ${THIN_SCROLL}`}>
              {chosen ? (
                <ul className="space-y-1.5">{draft.map((id) => selectedCard(personOf(id)))}</ul>
              ) : (
                /* Decorative only: three frames stacked, so the emptiness says what the panel is
                   for rather than sitting blank. */
                <div className="flex h-full flex-col items-center justify-center px-2 text-center">
                  <span aria-hidden="true" className="relative mb-4 block h-16 w-20">
                    <span className="absolute left-1 top-1 h-12 w-16 -rotate-6 rounded-lg border border-slate-200 bg-white shadow-sm" />
                    <span className="absolute left-3 top-2 h-12 w-16 rotate-3 rounded-lg border border-slate-200 bg-white shadow-sm" />
                    <span className="absolute left-2 top-3 grid h-12 w-16 place-items-center rounded-lg border border-blue-100 bg-blue-50 text-blue-400 shadow-sm"><GroupsRounded style={{ fontSize: 20 }} /></span>
                  </span>
                  <p className="text-xs font-medium text-slate-600">Find photos with these people together</p>
                  <p className="mt-1 text-[11px] leading-5 text-slate-400">Choose someone on the left and they will appear here.</p>
                </div>
              )}
            </div>
            <p className="shrink-0 border-t border-slate-200/80 bg-blue-50/40 px-4 py-2.5 text-[11px] leading-5 text-slate-600">{andNote}</p>
          </aside>
        </div>

        {/* Below `md` the chosen people are a row of faces rather than a second column: a summary
            to glance at, not another thing to scroll. */}
        {chosen > 0 && (
          <div className="flex shrink-0 items-center gap-2 border-t border-slate-200 bg-slate-50/60 px-4 py-2 sm:px-5 md:hidden">
            <span className="shrink-0 text-[11px] font-semibold text-slate-600">Selected: {chosen}</span>
            <ul className={`flex min-w-0 flex-1 gap-1 overflow-x-auto ${THIN_SCROLL}`}>
              {draft.map((id) => {
                const person = personOf(id);
                return (
                  <li key={id} className="shrink-0">
                    {/* A 36px circle inside a 44px target: the strip stays compact while the thing
                        a thumb has to hit does not. */}
                    <button type="button" onClick={() => toggle(id)} aria-label={`Remove ${person.label} from the filter`} className="relative grid h-11 w-11 place-items-center rounded-full focus:outline-none focus:ring-2 focus:ring-blue-200">
                      <FaceAvatar cover={person.cover} label={person.label} sessionToken={sessionToken} size={36} className="ring-1 ring-slate-200" />
                      <span aria-hidden="true" className="absolute right-0.5 top-0.5 grid h-4 w-4 place-items-center rounded-full bg-slate-700 text-white"><CloseRounded style={{ fontSize: 11 }} /></span>
                    </button>
                  </li>
                );
              })}
            </ul>
            {/* The same Clear all the column carries, where that column is not drawn - otherwise a
                phone could only let people go one at a time. */}
            <button type="button" onClick={clearDraft} className="shrink-0 rounded-md px-2 py-1 text-[11px] font-semibold text-blue-600 transition hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-200">Clear all</button>
          </div>
        )}
        {/* The rule the filter works by, where the column that states it is not drawn. */}
        <p className="shrink-0 border-t border-slate-200 bg-blue-50/40 px-4 py-2 text-[11px] leading-5 text-slate-600 sm:px-5 md:hidden">{andNote}</p>

        {/* ── Footer ─────────────────────────────────────────────────────────────────────── */}
        {/* Two actions and no third: emptying the choice belongs beside the people it empties
            (**Clear all**, in the column that lists them), not under the whole panel. */}
        <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-slate-200 bg-white px-4 py-3 sm:px-6">
          <button type="button" onClick={() => requestClose()} className="h-11 rounded-xl border border-slate-200 px-4 text-xs font-medium text-slate-700 transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-200 sm:h-10">Cancel</button>
          <button type="button" onClick={() => requestClose(() => onApply(draft))} className="inline-flex h-11 items-center gap-1.5 rounded-xl bg-blue-600 px-5 text-xs font-semibold text-white transition hover:bg-blue-700 focus:outline-none focus:ring-4 focus:ring-blue-200 sm:h-10">
            Apply <ArrowForward aria-hidden="true" style={{ fontSize: 15 }} />
          </button>
        </footer>
      </div>
    </div>
  );
}
