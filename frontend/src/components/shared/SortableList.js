"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import KeyboardArrowUpIcon from "@mui/icons-material/KeyboardArrowUp";
import { edgeScrollSpeed } from "@/lib/dragEdgeScroll.mjs";
import { dropIndex, moveInList } from "@/lib/sidebarLayout.mjs";

/**
 * The thing that actually scrolls around this list.
 *
 * Walked for rather than passed in, because a list does not know what it has been put inside: the
 * Sidebar Layout editor scrolls in the settings panel's own pane, and the same list dropped on an
 * ordinary page would scroll the page. Whichever it is, it is the nearest ancestor that both may
 * scroll and has somewhere to scroll to.
 */
function scrollableAncestor(element) {
  for (let node = element?.parentElement; node; node = node.parentElement) {
    const { overflowY } = window.getComputedStyle(node);
    if ((overflowY === "auto" || overflowY === "scroll") && node.scrollHeight > node.clientHeight) return node;
  }
  const page = document.scrollingElement;
  return page && page.scrollHeight > page.clientHeight ? page : null;
}

/**
 * The scroll that runs while a row is held near the top or bottom of the view.
 *
 * Without it a list taller than its pane can only be reordered within one screenful: held against
 * the bottom edge, the pointer sits there while the rows it should be passing stay out of sight,
 * and the only way to move a module to the end is to drop it, scroll by hand and pick it up again.
 * The same gesture the data table has had sideways for its columns, on the other axis — the rule
 * itself is shared (`@/lib/dragEdgeScroll.mjs`) so the two cannot drift apart.
 *
 * The pointer is read from a listener on the document rather than from the rows' own `dragover`,
 * which fires only over a row: between two of them, or beside the list, the scroll would stall
 * exactly where somebody is trying to reach past it.
 *
 * Refs throughout, not state: this is read and written many times a second by an animation frame,
 * and re-rendering the list on each would make the drag stutter just when it has to be smooth.
 */
function useEdgeScroll() {
  const scroller = useRef(null);
  const run = useRef({ frame: 0, speed: 0 });

  const stop = useCallback(() => {
    if (run.current.frame) cancelAnimationFrame(run.current.frame);
    run.current = { frame: 0, speed: 0 };
  }, []);

  const follow = useCallback((event) => {
    const element = scroller.current;
    if (!element) return stop();
    const speed = edgeScrollSpeed(element.getBoundingClientRect(), event.clientX, event.clientY, { axis: "y" });
    if (!speed) return stop();

    const running = run.current.speed !== 0;
    run.current.speed = speed;
    // Only one loop, whatever the speed becomes: the running one reads the new speed off the ref on
    // its next frame, and starting a second would scroll at the sum of the two.
    if (running) return undefined;

    /* One frame, queueing the next until the speed drops to nothing or the list runs out. */
    const step = () => {
      const scrolling = scroller.current;
      if (!scrolling || !run.current.speed) return stop();
      const before = scrolling.scrollTop;
      scrolling.scrollTop = before + run.current.speed;
      // The end of the list. Stopping here rather than queueing frames that move nothing means a
      // pointer parked against the edge costs nothing once there is nothing left to reveal.
      if (scrolling.scrollTop === before) return stop();
      run.current.frame = requestAnimationFrame(step);
      return undefined;
    };
    run.current.frame = requestAnimationFrame(step);
    return undefined;
  }, [stop]);

  const begin = useCallback((element) => {
    scroller.current = scrollableAncestor(element);
    document.addEventListener("dragover", follow);
  }, [follow]);

  const end = useCallback(() => {
    document.removeEventListener("dragover", follow);
    scroller.current = null;
    stop();
  }, [follow, stop]);

  // A drag interrupted by the list unmounting - the panel closed mid-gesture - must not leave a
  // listener on the document or a frame queued against an element that has gone.
  useEffect(() => end, [end]);

  return { begin, end };
}

/**
 * A list whose order a person sets: drag a row, or move it with the arrows beside it.
 *
 * The whole row is the handle. It used to be a small grip at the left, which meant a person had to
 * find and hit an 18px target to move something that is the width of the panel — so the row itself
 * is what starts the drag now, and the grip is gone rather than sitting there as decoration.
 *
 * Three ways to reorder, because dragging alone reaches only one kind of user. The drag is native
 * HTML5, which is what the data table's column reordering uses and what a desk mouse expects. The
 * arrows do the same thing with a tap — HTML5 drag does not fire from touch at all, so without them
 * this would be unusable on a phone — and with a keypress, so the order can be set without a
 * pointer. A focused row answers the arrow keys too.
 *
 * ── Each list is its own world ────────────────────────────────────────────────────────────────
 *
 * Which row is being dragged is this component's own state, so a row can only be dropped into the
 * list it was picked up from: another instance never learns a drag started, and ignores the drop.
 * Every handler stops the event from travelling further.
 *
 * One thing the whole-row handle gives up: a list can no longer be nested inside a row of another
 * list, because the outer row would take the drag before the inner one saw it. Nothing nests today
 * — Sidebar Layout arranges modules only — and a nested list would need its old grip back.
 *
 * ── Where it will land is a line, not a lit-up row ─────────────────────────────────────────────
 *
 * While a row is carried, a 2px line is drawn in the gap it will drop into — above or below the row
 * under the pointer, by which half of that row the pointer is in — the way the data table marks the
 * side of a column. It used to light up the whole row under the pointer instead, which said *which
 * row* the drag was over but not *which side of it* the drop would take, so the same hover could
 * mean "above" or "below" and the answer was only found out by letting go. `dropIndex` turns the
 * gap the line marks into the index the row ends up at, so the line and the drop cannot disagree.
 */
/*
 * `moveButtons` is the pair of arrows beside each row. They are on by default and should stay on
 * for most lists - they are the only way to reorder by touch, since a finger fires no HTML5 drag -
 * but a list whose rows already carry their own controls can turn them off and keep the drag and
 * the keyboard, which the row itself answers for (ArrowUp / ArrowDown while it has focus).
 */
export default function SortableList({ items, onReorder, label, disabled = false, className = "", renderRow, moveButtons = true }) {
  const [draggingId, setDraggingId] = useState(null);
  const [dropTarget, setDropTarget] = useState(null);
  const edgeScroll = useEdgeScroll();

  const move = (fromIndex, toIndex) => {
    const next = moveInList(items.map((item) => item.id), fromIndex, toIndex);
    if (next !== items.map((item) => item.id)) onReorder(next);
  };

  /** Which gap the pointer is nearest: the one above the row it is over, or the one below it. */
  const sideOf = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return event.clientY - rect.top < rect.height / 2 ? "before" : "after";
  };

  const dropOn = (targetId, side) => {
    const from = items.findIndex((item) => item.id === draggingId);
    const to = items.findIndex((item) => item.id === targetId);
    if (from >= 0 && to >= 0) move(from, dropIndex(from, to, side));
    edgeScroll.end();
    setDraggingId(null);
    setDropTarget(null);
  };

  return <ul aria-label={label} className={`space-y-1.5 ${className}`}>
    {items.map((item, index) => {
      const dragging = draggingId === item.id;
      return <li
        key={item.id}
        // The row is the handle: a drag may start anywhere on it, and it is a drop target too. A
        // disabled list is neither draggable nor reachable by tab, which is the whole of what
        // "disabled" means here — `aria-disabled` is not a property a list item may carry.
        draggable={!disabled}
        tabIndex={disabled ? -1 : 0}
        aria-label={`Reorder ${item.label}`}
        onDragStart={(event) => {
          if (disabled) return;
          event.stopPropagation();
          edgeScroll.begin(event.currentTarget);
          setDraggingId(item.id);
          event.dataTransfer.effectAllowed = "move";
          // Firefox starts no drag at all unless something is carried; the id is the least that
          // will do, and nothing reads it back — the state above is what the drop uses.
          event.dataTransfer.setData("text/plain", item.id);
        }}
        onDragEnd={(event) => { event.stopPropagation(); edgeScroll.end(); setDraggingId(null); setDropTarget(null); }}
        onKeyDown={(event) => {
          if (disabled) return;
          if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
          event.preventDefault();
          move(index, index + (event.key === "ArrowUp" ? -1 : 1));
        }}
        onDragOver={(event) => {
          // Nothing is being dragged *here*: either the drag began in another list, or in none.
          // Not preventing the default is what refuses the drop.
          if (disabled || !draggingId || draggingId === item.id) return;
          event.preventDefault();
          event.stopPropagation();
          event.dataTransfer.dropEffect = "move";
          const side = sideOf(event);
          // Same row, same side: leave the state alone rather than re-render the list on every
          // pixel the pointer moves.
          setDropTarget((current) => current?.id === item.id && current.side === side ? current : { id: item.id, side });
        }}
        onDrop={(event) => {
          if (disabled || !draggingId) return;
          event.preventDefault();
          event.stopPropagation();
          dropOn(item.id, sideOf(event));
        }}
        className={`relative rounded-lg border border-slate-200 bg-white transition ${disabled ? "cursor-not-allowed" : "cursor-grab hover:border-slate-300 active:cursor-grabbing"} ${dragging ? "opacity-40" : ""} focus-visible:outline-2 focus-visible:outline-blue-500`}
      >
        {/* The line in the gap the row will drop into, sitting between this row and its neighbour
            rather than on either. */}
        {dropTarget?.id === item.id && <span aria-hidden="true" className={`pointer-events-none absolute inset-x-0 z-10 h-0.5 rounded-full bg-blue-500 ${dropTarget.side === "before" ? "-top-1" : "-bottom-1"}`} />}
        <div className="flex items-center gap-2 px-3 py-2.5">
          <div className="min-w-0 flex-1">{renderRow ? renderRow(item) : <span className="block truncate text-sm text-slate-700">{item.label}</span>}</div>

          {/* The same two moves, for a finger and for a keyboard - see `moveButtons`. */}
          {moveButtons && <div className="flex shrink-0 items-center">
            <button type="button" disabled={disabled || index === 0} aria-label={`Move ${item.label} up`} onClick={() => move(index, index - 1)} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent">
              <KeyboardArrowUpIcon style={{ fontSize: 18 }} aria-hidden="true" />
            </button>
            <button type="button" disabled={disabled || index === items.length - 1} aria-label={`Move ${item.label} down`} onClick={() => move(index, index + 1)} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent">
              <KeyboardArrowDownIcon style={{ fontSize: 18 }} aria-hidden="true" />
            </button>
          </div>}
        </div>
      </li>;
    })}
  </ul>;
}
