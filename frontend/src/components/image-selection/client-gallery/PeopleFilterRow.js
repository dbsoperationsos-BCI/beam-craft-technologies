"use client";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import CheckRounded from "@mui/icons-material/CheckRounded";
import GridViewRounded from "@mui/icons-material/GridViewRounded";
import FaceAvatar from "./FaceAvatar";

// How many people the rail leads with before the strip has been measured; once it has, as many as
// fit its width lead, and the rest are reached through More.
const FEATURED = 5;
// The least space between items, the most the rail will stretch it to when the items do not fill
// the width exactly, and the strip's own left padding, in px, as the classes below draw them.
const GAP = 4;
const MAX_GAP = 18;
const STRIP_PADDING = 6;
const formatCount = (value) => Number(value || 0).toLocaleString("en-US");
const photosLabel = (value) => `${formatCount(value)} ${Number(value) === 1 ? "photo" : "photos"}`;

// The circle's size follows the screen: a thumb-sized 48px on a phone, 56px on a tablet, 64px on
// a desktop. Read through matchMedia rather than CSS because the face is placed inside the circle
// by arithmetic (`faceCropStyle`), which needs the size in pixels.
const SIZES = [["(min-width: 1024px)", 64], ["(min-width: 640px)", 56]];
function subscribeToSize(callback) {
  const lists = SIZES.map(([query]) => window.matchMedia(query));
  lists.forEach((list) => list.addEventListener("change", callback));
  return () => lists.forEach((list) => list.removeEventListener("change", callback));
}
function currentSize() { const hit = SIZES.find(([query]) => window.matchMedia(query).matches); return hit ? hit[1] : 48; }
const useAvatarSize = () => useSyncExternalStore(subscribeToSize, currentSize, () => 64);

/**
 * The People rail above the gallery's All Photos / Selected tabs, always one row: All anchored on
 * the left, and beside it a strip of face circles - name and photo count beneath each - that
 * scrolls sideways and never wraps, so the section is the same height whether three people were
 * found or thirty.
 *
 * A filter and nothing more, and one that takes several people at once: pressing a person adds
 * them (blue ring, soft blue background, a tick on the circle), pressing them again takes them
 * out, and the grid shows the photos ANY chosen person is in through the handler the gallery
 * already owns. All - or Clear, beside the heading with two or more chosen - empties the set. People
 * chosen here are not photos chosen: the tick on a photo card is the photo's own and is untouched.
 *
 * The strip leads with as many people as fit its width - measured, so a wide desktop shows nine
 * and a phone three - and a More item made of the next faces stacked with "+N"; pressing it puts
 * the rest into the same strip and scrolls towards them - no menu, no dialog, no second row -
 * after which the strip simply scrolls, natively: a finger, a trackpad, a shift-wheel, with a Less
 * item at its end that folds the rail back to the featured few. There are no arrow buttons; fades
 * at the edges say there is more. Absent when nobody has been found.
 */
export default function PeopleFilterRow({ people = [], activePersonIds = [], onSelect, sessionToken, totalCount = 0 }) {
  const [expanded, setExpanded] = useState(false);
  const stripRef = useRef(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  // How many items the strip has room for, counted from its measured width, and that width; null
  // until measured.
  const [slots, setSlots] = useState(null);
  const [stripWidth, setStripWidth] = useState(0);
  const size = useAvatarSize();

  // Which way the strip can still go, and how many items fit across it, read from the strip
  // whenever it scrolls or its size - or its content's - changes. State is only ever set from
  // those callbacks.
  const measure = useCallback(() => {
    const strip = stripRef.current;
    if (!strip) return;
    // Past the strip's own left padding, not merely past zero: a snap that lands the first item
    // on the padding edge is not "scrolled", and the fade drawn for it would wash that item out.
    const left = strip.scrollLeft > STRIP_PADDING + 2;
    const right = strip.scrollLeft + strip.clientWidth < strip.scrollWidth - 2;
    setEdges((current) => (current.left === left && current.right === right ? current : { left, right }));
    const itemWidth = currentSize() + 24;
    setSlots(Math.max(2, Math.floor((strip.clientWidth - STRIP_PADDING + GAP) / (itemWidth + GAP))));
    setStripWidth(strip.clientWidth);
  }, []);
  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(strip);
    if (strip.firstElementChild) observer.observe(strip.firstElementChild);
    strip.addEventListener("scroll", measure, { passive: true });
    return () => { observer.disconnect(); strip.removeEventListener("scroll", measure); };
  }, [measure, people.length, size]);

  if (!people.length) return null;
  // Everyone fits: no More. Otherwise the last slot is More and the ones before it are people.
  const featured = slots === null ? FEATURED : people.length <= slots ? people.length : slots - 1;
  const hidden = expanded ? [] : people.slice(featured);
  const shown = expanded ? people : people.slice(0, featured);
  const chosen = activePersonIds.length;
  const allActive = chosen === 0;
  function showMore() {
    setExpanded(true);
    // Once the rest are in the strip, move towards them so the press visibly opens something.
    requestAnimationFrame(() => { const strip = stripRef.current; if (strip) strip.scrollBy({ left: strip.clientWidth * 0.75, behavior: "smooth" }); });
  }
  function showLess() {
    setExpanded(false);
    requestAnimationFrame(() => { const strip = stripRef.current; if (strip) strip.scrollTo({ left: 0, behavior: "smooth" }); });
  }

  const width = size + 24;
  // Whole items never fill the width exactly; the remainder is shared out between them so the
  // last item sits at the edge rather than a stray gap - capped, and back to the compact gap the
  // moment the rail holds more than fits and scrolls.
  const itemCount = shown.length + (hidden.length ? 1 : 0) + (expanded && people.length > featured ? 1 : 0);
  const spare = stripWidth - STRIP_PADDING - itemCount * width;
  const gap = itemCount > 1 && spare > 0 ? Math.min(MAX_GAP, Math.max(GAP, spare / (itemCount - 1))) : GAP;
  const item = (active) => `group flex shrink-0 snap-start flex-col items-center gap-1.5 rounded-2xl px-1 pb-1.5 pt-2 text-center transition-colors ${active ? "bg-blue-50" : "hover:bg-slate-50"}`;
  const ring = (active) => (active ? "ring-2 ring-blue-500 ring-offset-2 ring-offset-blue-50" : "ring-1 ring-slate-200 group-hover:ring-slate-300");
  const name = (active) => `w-full truncate text-xs font-medium leading-tight ${active ? "text-blue-700" : "text-slate-700"}`;
  const count = (active) => `w-full truncate text-[10px] leading-tight ${active ? "text-blue-500" : "text-slate-400"}`;
  const dot = (active) => <span aria-hidden="true" className={`mt-0.5 h-1 w-1 rounded-full ${active ? "bg-blue-500" : "bg-transparent"}`} />;
  const clearButton = () => <button type="button" onClick={() => onSelect(null)} className="shrink-0 rounded-md px-2 py-1 text-[11px] font-semibold text-blue-600 hover:bg-blue-50">Clear</button>;

  return (
    <section aria-label="Filter by person" className="shrink-0 border-b border-slate-200 bg-white px-3 pb-1 pt-2.5 sm:px-5">
      <div className="mb-1 flex min-h-6 items-center gap-2">
        <h2 className="flex items-baseline gap-1.5 text-xs font-semibold text-slate-500">People <span className="font-normal text-slate-400">{people.length}</span></h2>
        {/* Two or more chosen: how many, and the way to none, beside the heading. */}
        {chosen >= 2 && (
          <span className="flex items-center gap-1">
            <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700">{chosen} selected</span>
            {clearButton()}
          </span>
        )}
        <p className="ml-auto hidden truncate text-[11px] text-slate-400 sm:block">Select multiple people to view all their photos</p>
      </div>
      <div className="flex items-start">
        {/* All is the anchor: it stays put, so the way back to the whole folder is never scrolled out of reach. */}
        <div className="shrink-0 border-r border-slate-100 pr-1.5">
          <button type="button" aria-pressed={allActive} onClick={() => onSelect(null)} style={{ width }} className={item(allActive)}>
            <span aria-hidden="true" style={{ width: size, height: size }} className={`grid place-items-center rounded-full bg-gradient-to-br ${allActive ? "from-blue-50 to-blue-100 text-blue-600" : "from-slate-50 to-slate-200 text-slate-500"} ${ring(allActive)}`}><GridViewRounded style={{ fontSize: Math.round(size * 0.4) }} /></span>
            <span className={`${name(allActive)} font-semibold`}>All</span>
            <span className={count(allActive)}>{photosLabel(totalCount)}</span>
            {dot(allActive)}
          </button>
        </div>
        {/* The rail: one row that scrolls sideways and never wraps. */}
        <div className="relative min-w-0 flex-1">
          {edges.left && <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-0 z-10 w-12 bg-gradient-to-r from-white via-white/70 to-transparent" />}
          {edges.right && <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-0 z-10 w-12 bg-gradient-to-l from-white via-white/70 to-transparent" />}
          <div ref={stripRef} role="group" className="flex snap-x items-start overflow-x-auto pl-1.5 scroll-pl-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <div className="flex items-start" style={{ gap }}>
              {shown.map((person) => {
                const active = activePersonIds.includes(person.id);
                return (
                  <button key={person.id} type="button" aria-pressed={active} onClick={() => onSelect(person.id)} title={`${person.label} · ${photosLabel(person.photoCount)}`} style={{ width }} className={item(active)}>
                    <span className="relative">
                      <FaceAvatar cover={person.cover} label={person.label} sessionToken={sessionToken} size={size} className={ring(active)} />
                      {/* The tick that says "chosen, with others": a small blue badge on the circle's corner. */}
                      {active && <span aria-hidden="true" className="absolute -bottom-0.5 -right-0.5 grid h-4 w-4 place-items-center rounded-full bg-blue-600 text-white ring-2 ring-blue-50 sm:h-5 sm:w-5"><CheckRounded style={{ fontSize: size >= 56 ? 14 : 11 }} /></span>}
                    </span>
                    <span className={name(active)}>{person.label}</span>
                    <span className={count(active)}>{photosLabel(person.photoCount)}</span>
                    {dot(active)}
                  </button>
                );
              })}
              {hidden.length > 0 && (
                // The next faces themselves, stacked, with how many are behind them: the cue that
                // there is more is the people there are more of.
                <button type="button" aria-label={`Show ${hidden.length} more ${hidden.length === 1 ? "person" : "people"}`} onClick={showMore} style={{ width }} className={item(false)}>
                  <span aria-hidden="true" style={{ width: size, height: size }} className="relative grid place-items-center rounded-full bg-slate-50 ring-1 ring-dashed ring-slate-300 group-hover:ring-slate-400">
                    <span className="flex items-center" style={{ marginLeft: Math.round(size * 0.12) }}>
                      {hidden.slice(0, 3).map((person, index) => (
                        <span key={person.id} className="rounded-full ring-2 ring-white" style={{ marginLeft: index ? -Math.round(size * 0.14) : 0, zIndex: 3 - index }}>
                          <FaceAvatar cover={person.cover} label={person.label} sessionToken={sessionToken} size={Math.round(size * 0.36)} />
                        </span>
                      ))}
                    </span>
                    <span className="absolute -bottom-0.5 -right-0.5 rounded-full bg-slate-800 px-1.5 py-px text-[10px] font-semibold leading-4 text-white ring-2 ring-white">+{hidden.length}</span>
                  </span>
                  <span className={name(false)}>More</span>
                  <span className={count(false)}>{hidden.length} {hidden.length === 1 ? "person" : "people"}</span>
                  {dot(false)}
                </button>
              )}
              {expanded && people.length > featured && (
                // The way back: folds the rail to the featured few and returns to its start.
                <button type="button" aria-label="Show fewer people" onClick={showLess} style={{ width }} className={item(false)}>
                  <span aria-hidden="true" style={{ width: size, height: size }} className="grid place-items-center rounded-full bg-slate-50 text-lg font-semibold text-slate-500 ring-1 ring-dashed ring-slate-300 group-hover:ring-slate-400">–</span>
                  <span className={name(false)}>Less</span>
                  <span className={count(false)}>{formatCount(people.length)} people</span>
                  {dot(false)}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
