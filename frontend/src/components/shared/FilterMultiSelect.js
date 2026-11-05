"use client";

import { createPortal } from "react-dom";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import useCloseWhenTriggerHidden from "./useCloseWhenTriggerHidden";
import useListKeyboard from "./useListKeyboard";
import useEscapeKey from "@/components/shared/useEscapeKey";
import { matchesWordChunks } from "@/lib/wordChunks.mjs";

/*
 * How many options a list needs before it is worth searching rather than reading.
 *
 * Five, because that is about where a column stops being a glance - Yes/No, Active/Inactive and a
 * three-way status are read faster than a search box can be typed into, and a list of services or
 * branches is not. Named here so the two filter controls cannot drift apart on it.
 */
const SEARCH_FROM = 5;

/**
 * A column filter that takes **several** answers at once.
 *
 * The filter row's plain text box answers "show me the rows that contain this", which is the right
 * question for a name or a phone number and the wrong one for a column that holds a closed set:
 * reading two people's leads meant filtering to one, reading them, and filtering to the other -
 * the table could not put them side by side at all. This picks any number of the values a column
 * actually holds, and the rows are those matching **any** of them.
 *
 * `FilterCombobox` beside it is the single-answer version of the same idea and stays what a column
 * uses when one value is the question. Both are styled to the filter row rather than to a form: the
 * same height, border and text size as the plain inputs beside them, so the row reads as one strip
 * of controls rather than three kinds of thing.
 *
 * ── The trigger ──
 *
 * It says what is being shown, not what could be: nothing chosen reads as the placeholder (the
 * column is not filtered), one chosen reads as that value, and more read as a count - a trigger 90px
 * wide cannot list four names, and a truncated list of them says less than the number does.
 */
export default function FilterMultiSelect({ ariaLabel, loading = false, onChange, onOpen, options = [], placeholder = "Filter", values = [] }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const listId = useId();
  const [menuStyle, setMenuStyle] = useState(null);
  const wrapperRef = useRef(null);
  const menuRef = useRef(null);
  const listRef = useRef(null);
  const triggerRef = useRef(null);
  const searchRef = useRef(null);
  /*
   * Through a ref, so a caller may pass a fresh arrow every render - which every caller does -
   * without the effect below re-firing and asking the server again on each keystroke. The same
   * arrangement `FilterCombobox` uses, and for the same caller: a board whose column values are a
   * question only the server can answer, asked when the menu opens rather than on mounting.
   */
  const onOpenRef = useRef(onOpen);
  useEffect(() => { onOpenRef.current = onOpen; }, [onOpen]);

  const chosen = Array.isArray(values) ? values : [];
  /*
   * A blank option is dropped, wherever it came from.
   *
   * The single-select filters are handed an **"All"** row with an empty value, because a menu can
   * only ever move a field from one answer to another and that row is the way back to no filter.
   * A multi-select has no such problem - unticking everything *is* the way back - so on this control
   * "All" is a value somebody can tick, which means filtering the column to the empty string. Its
   * job is done by the Select all row below instead.
   *
   * Filtered here rather than at each caller so the option lists stay what they are: the same
   * `leadStatusFilterOptionsForBoard` still feeds the single-select filters, where the row belongs.
   */
  const normalized = options
    .map((option) => (typeof option === "string" ? { value: option, label: option } : option))
    .filter((option) => String(option?.value ?? "").trim() !== "");
  const typed = query.trim().toLowerCase();
  // The tables' word-chunk search: an option holding any typed word is listed.
  const shown = typed ? normalized.filter((option) => matchesWordChunks(option.label, typed)) : normalized;
  // The arrow keys, Home and End, and keeping the highlight in view - one rule, shared with
  // `FilterCombobox`, counted against the options actually on screen.
  const { activeIndex, setActiveIndex, walk } = useListKeyboard({ count: shown.length, listRef });
  // Whether the list is long enough to be worth searching, which decides both whether the box is
  // drawn and whether there is anything for the focus below to move to.
  const searchable = normalized.length >= SEARCH_FROM;

  /*
   * Opening and closing, with the search and the walk cleared as it goes.
   *
   * **Every** close goes through here, which is the point: the mousedown outside, the trigger
   * scrolling out of view, Escape and the chevron are four different gestures, and a highlight left
   * behind by one of them came back on the next open - pointing at a row the reader never walked to
   * and, where the options had been refetched meanwhile, at a different value entirely. Its
   * single-answer twin had exactly that bug for the want of this.
   *
   * Done here rather than in an effect on `open`: writing state from an effect is the pattern this
   * codebase keeps out of components, and the search has one lifetime - this menu being open - so
   * the gesture that ends it is the honest place to end it.
   */
  // Stable, so the mousedown listener below can name it as a dependency and still be attached once
  // per opening rather than on every render.
  const setMenu = useCallback((next) => {
    setOpen(next);
    if (!next) {
      setQuery("");
      setActiveIndex(-1);
    }
  }, [setActiveIndex]);

  // Portalled, so scrolling the pane moves the field but not the popover; closing is the honest
  // answer, and reopening is one click.
  useCloseWhenTriggerHidden(open, wrapperRef, () => setMenu(false));
  // Escape closes it and puts focus back where it came from, so the next Tab carries on along the
  // filter row rather than starting again from the top of the document.
  useEscapeKey(() => { setMenu(false); triggerRef.current?.focus(); }, open);

  // An empty list is **no filter**, not a filter matching nothing - so it is handed back as
  // undefined, which is what the table reads as "this column is not filtered".
  const commit = (next) => onChange?.(next.length ? next : undefined);

  const toggle = (value) => {
    commit(chosen.includes(value) ? chosen.filter((entry) => entry !== value) : [...chosen, value]);
  };

  /*
   * ── Working it without a mouse ────────────────────────────────────────────────────────────────
   *
   * The walk itself - Down, Up, Home, End, and keeping the highlight in view - is `useListKeyboard`,
   * shared with `FilterCombobox`. What is left here is what only this control can answer.
   *
   * Down on a closed menu opens it, because that is what the key means on every other listbox and a
   * reader who has tabbed to the filter should not have to find the mouse to open it.
   *
   * Enter **ticks** rather than closing, which is the one place this parts company with an ordinary
   * dropdown: this control takes several answers, so closing on the first would make the second one
   * cost another journey through the menu. The menu is left by Escape, by Tab or by clicking away,
   * all three of which already worked. Escape is the one listener the whole application shares.
   *
   * ── One handler, and why it has to be choosy ──
   *
   * It is hung on the field alone, and that is enough even though the search box sits in a menu
   * portalled to `document.body`: a React portal propagates its events up the **React** tree rather
   * than the document one, so a key pressed in the menu reaches the field it visually belongs to
   * without being a descendant of it. A second handler on the menu therefore ran every keystroke
   * twice, and one ArrowDown moved the highlight by two.
   *
   * The same reach is why Enter is taken only from the search box and the trigger. Select all,
   * Clear and the option rows are buttons inside that portal, so their Enter arrives here too - and
   * taking it would tick the highlighted row and swallow the button the reader had tabbed to.
   */
  function handleKeyDown(event) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (!open) { event.preventDefault(); setMenu(true); return; }
    }
    if (!open || walk(event)) return;
    if (event.key !== "Enter") return;
    // A button in the menu answers its own Enter; this one is only for the two controls that have
    // no other meaning for the key.
    if (event.target !== searchRef.current && event.target !== triggerRef.current) return;
    // And only where a row is actually highlighted. Enter over a list nobody has walked would
    // otherwise tick whichever option happened to be first, which is not a choice anybody made.
    const option = shown[activeIndex];
    if (!option) return;
    event.preventDefault();
    toggle(option.value);
  }

  /*
   * Select all takes **what is on screen**; Clear takes **everything**.
   *
   * The asymmetry is deliberate, and it is what a selection stranded off the list taught. Selecting
   * is additive and has to respect a search: a list somebody has narrowed on purpose means all of
   * those, not the whole catalogue from behind the search. Clearing is the way out, so it must be
   * able to reach a value that is **not** in front of the reader - otherwise a column can hold a
   * filter with no control on screen that clears it.
   *
   * That is not a hypothetical. A column whose values are fetched shows a fallback list while the
   * answer is on its way; Select all against that provisional list chose values the real one turned
   * out not to have, and a Clear that acted only on what was shown left them filtering the board
   * from nowhere. `loading` below is the other half of that fix - the row is not offered against a
   * list that is still a guess.
   */
  const shownValues = shown.map((option) => option.value);
  const allShownChosen = shownValues.length > 0 && shownValues.every((value) => chosen.includes(value));
  const selectAllShown = () => commit([...chosen, ...shownValues.filter((value) => !chosen.includes(value))]);

  useEffect(() => {
    if (open) onOpenRef.current?.();
  }, [open]);

  /*
   * The search box takes focus, so opening a filter and typing is one gesture rather than a click
   * on the trigger and a second one into the box.
   *
   * An effect rather than `autoFocus`, because the box does not always exist when the menu opens: a
   * column whose values are fetched - the leads board's, the interview register's - opens with no
   * options and no search box, and mounts one when the answer lands. `autoFocus` runs on mount, so
   * that is hundreds of milliseconds later, and it would snatch focus back from wherever the reader
   * had moved on to in the meantime.
   *
   * So it is keyed on the box **existing** rather than on the menu being open, and takes focus only
   * where nobody else has claimed it: the trigger still holds it from the click that opened the
   * menu, or nothing does. A reader who has tabbed into the menu or away from it is left alone.
   *
   * `menuMounted` rather than `open` because the portal is drawn a render late - it waits for
   * `track()` below to measure where the field is, so on the render that opens the menu there is no
   * input to focus yet, and an effect keyed on `open` alone fires once, finds nothing, and never
   * runs again.
   */
  const menuMounted = open && Boolean(menuStyle);
  useEffect(() => {
    if (!menuMounted || !searchable) return;
    const held = document.activeElement;
    if (held && held !== document.body && held !== triggerRef.current) return;
    searchRef.current?.focus();
  }, [menuMounted, searchable]);

  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => {
      if (wrapperRef.current?.contains(event.target)) return;
      if (menuRef.current?.contains(event.target)) return;
      setMenu(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open, setMenu]);

  /*
   * The menu is portalled, so it has to be told where the field is on every frame it is open - the
   * table it sits in scrolls horizontally underneath it. Same rule as `FilterCombobox`: it opens
   * upward when there is more room above, and never taller than the room it has.
   */
  useEffect(() => {
    if (!open) return undefined;
    let frame = 0;
    let previous = "";
    const track = () => {
      const rect = wrapperRef.current?.getBoundingClientRect();
      if (rect) {
        const padding = 12;
        const below = window.innerHeight - rect.bottom - padding;
        const above = rect.top - padding;
        const openAbove = below < 200 && above > below;
        /*
         * Held inside the window, on both edges.
         *
         * `left` used to be the field's own, which is right while the field is fully on screen and
         * wrong the moment it is not: the filter row scrolls sideways with the table, so a column
         * half off the left edge gave the menu a negative `left`, and a column wider than a phone
         * gave it a `minWidth` wider than the screen - a menu overflowing both edges at once, with
         * no way to scroll to either. `min-width` also beats `max-width` in CSS, so capping the
         * width alone could not fix it.
         *
         * Three steps, in this order, because each needs the one before it. The menu is at least as
         * wide as the field but never wider than the room there is; it is then slid back inside if
         * that puts it over an edge; and only then is it capped at the room to the right of where
         * it actually landed - capping it before the slide left it free to grow past the edge again,
         * which is what a single long option did.
         *
         * A field comfortably on screen is unaffected: none of the three binds, and the menu opens
         * flush with it exactly as it always has.
         */
        const room = window.innerWidth - padding * 2;
        const width = Math.min(Math.max(rect.width, 180), room);
        const left = Math.min(Math.max(rect.left, padding), window.innerWidth - padding - width);
        const next = {
          position: "fixed",
          left,
          minWidth: width,
          maxWidth: window.innerWidth - padding - left,
          top: openAbove ? "auto" : rect.bottom + 4,
          bottom: openAbove ? window.innerHeight - rect.top + 4 : "auto",
          maxHeight: Math.max(160, Math.min(300, openAbove ? above : below)),
        };
        const signature = JSON.stringify(next);
        if (signature !== previous) {
          previous = signature;
          setMenuStyle(next);
        }
      }
      frame = window.requestAnimationFrame(track);
    };
    track();
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  const trigger = chosen.length === 0 ? placeholder : (chosen.length === 1 ? String(chosen[0]) : `${chosen.length} selected`);

  const menu = open && menuStyle && typeof document !== "undefined" ? createPortal(
    <div
      ref={menuRef}
      /*
       * A plain container, deliberately. The `listbox` is the scroller at the bottom of it, because
       * a listbox may hold nothing but options and this box also holds the search field and the
       * Select all / Clear row - and an `<input role="combobox">` nested inside a listbox is a
       * shape screen readers are entitled to skip. `aria-controls` on the search box names that
       * scroller, and `aria-activedescendant` names a row inside it.
       */
      style={menuStyle}
      className="z-[9999] flex flex-col overflow-hidden rounded-lg border border-slate-200 bg-white text-sm shadow-[0_12px_28px_rgba(15,23,42,0.16)]"
    >
      {/*
        * A search box from `SEARCH_FROM` options up. Below that it is one more thing between the
        * reader and a handful of values already in front of them - a box to type into above Yes and
        * No is furniture, and the two rows are quicker to read than the word is to type.
        *
        * It takes focus as the menu opens - see the effect above, which is careful about when -
        * so opening a filter and typing is one gesture rather than two clicks.
        */}
      {searchable && <div className="border-b border-slate-100 p-1.5">
        <input
          ref={searchRef}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            // The list is rebuilt under it, so an index kept from the old one would point at a
            // different value. Searching starts the walk again.
            setActiveIndex(-1);
          }}
          placeholder="Search"
          aria-label={`Search ${ariaLabel || "values"}`}
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={activeIndex >= 0 && shown[activeIndex] ? `${listId}-${activeIndex}` : undefined}
          className="w-full min-w-0 rounded border border-slate-200 px-2 py-1 text-xs font-normal text-slate-600 outline-none placeholder:text-slate-300 focus:border-blue-400"
        />
      </div>}

      {/*
        * Above the list and under the search, so "all of these" means the rows beneath it.
        *
        * Two controls rather than one toggle: **Clear** has to be reachable whenever anything is
        * chosen, including when what is chosen is not on the list any more - a toggle that only
        * appeared once everything shown was ticked was exactly the state with no way out.
        *
        * Neither is offered while the values are still being fetched: the list is a fallback then,
        * and choosing all of a guess is what stranded a selection in the first place.
        */}
      {!loading && (shown.length > 1 || chosen.length > 0) && <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-3 py-1.5 text-xs">
        {shown.length > 1 && !allShownChosen
          ? <button type="button" onClick={selectAllShown} className="font-semibold text-slate-600 hover:text-slate-900">
            Select all{typed && shown.length !== normalized.length ? ` (${shown.length})` : ""}
          </button>
          : <span className="font-semibold text-slate-400">{allShownChosen ? "All selected" : ""}</span>}
        {chosen.length > 0 && <button type="button" onClick={() => onChange?.(undefined)} className="font-medium text-blue-600 hover:text-blue-800">
          {/* The count, because it is the one place a selection the list no longer holds is visible
              at all - "Clear 6" over a list of 4 is the reader's clue that two are off it. */}
          Clear{chosen.length > 1 ? ` (${chosen.length})` : ""}
        </button>}
      </div>}

      <div
        ref={listRef}
        id={listId}
        role="listbox"
        aria-multiselectable="true"
        aria-label={ariaLabel}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-1"
      >
        {shown.length === 0
          // "Still asking" and "nothing to offer" are different answers, and a menu saying the
          // second while the first is true reads as a column with no values in it.
          ? <p className="px-3 py-2 text-slate-500">{loading ? "Loading..." : "No matches."}</p>
          : shown.map((option, index) => {
            const picked = chosen.includes(option.value);
            const active = index === activeIndex;
            /*
             * One background class, chosen here rather than written as two that override each
             * other: which of two Tailwind classes wins is decided by their order in the generated
             * stylesheet and not by their order in the attribute, so `bg-blue-50 bg-blue-100` is a
             * coin toss. The highlight is a step darker than the state underneath it, so a ticked
             * row being walked past still reads as ticked.
             */
            const background = active
              ? (picked ? "bg-blue-100" : "bg-slate-100")
              : (picked ? "bg-blue-50" : "hover:bg-slate-50");
            return <button
              key={option.value}
              id={`${listId}-${index}`}
              type="button"
              role="option"
              aria-selected={picked}
              // The pointer and the keyboard agree about which row is live, so moving the mouse
              // across the list does not leave a highlight behind somewhere else.
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => toggle(option.value)}
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-left ${background} ${picked ? "text-blue-900" : "text-slate-700"}`}
            >
              {/* A drawn box rather than a real checkbox: the row is the control, and a nested
                  input would take the click the row is already handling. */}
              <span aria-hidden="true" className={`grid h-3.5 w-3.5 shrink-0 place-items-center rounded-[3px] border ${picked ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300 bg-white"}`}>
                {picked && <span className="text-[9px] leading-none">✓</span>}
              </span>
              <span className="min-w-0 flex-1 truncate">{option.label}</span>
            </button>;
          })}
      </div>
    </div>,
    document.body,
  ) : null;

  /*
   * The trigger is `FilterCombobox`'s own box, to the class: the same `min-h-7`, the same border and
   * focus ring, the same `px-2 py-1 text-[11px]` on the text and the same chevron in its own little
   * column. Written without those it drew a box a third shorter than the plain inputs beside it, and
   * the filter row stopped reading as one strip of controls.
   */
  return <div
    ref={wrapperRef}
    // Where every key is heard: the trigger on a short list, and the portalled search box on a long
    // one, which reaches here through the React tree.
    onKeyDown={handleKeyDown}
    className={`relative flex min-h-7 w-full items-center rounded border bg-white ${open ? "border-blue-500 ring-2 ring-blue-100" : "border-slate-200"}`}
  >
    <button
      ref={triggerRef}
      type="button"
      onClick={() => setMenu(!open)}
      aria-label={ariaLabel}
      aria-haspopup="listbox"
      aria-expanded={open}
      className={`min-w-0 flex-1 truncate bg-transparent px-2 py-1 text-left text-[11px] outline-none ${chosen.length ? "text-slate-600" : "text-slate-400"}`}
    >
      {trigger}
    </button>
    <button
      type="button"
      tabIndex={-1}
      aria-label={`${ariaLabel} options`}
      aria-expanded={open}
      onClick={() => setMenu(!open)}
      className="flex h-full shrink-0 items-center px-1 text-slate-400 transition hover:text-slate-700"
    >
      <ExpandMoreIcon aria-hidden="true" className={`transition-transform ${open ? "rotate-180" : ""}`} fontSize="small" />
    </button>
    {menu}
  </div>;
}
