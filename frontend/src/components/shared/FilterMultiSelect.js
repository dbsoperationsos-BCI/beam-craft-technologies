"use client";

import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import useCloseWhenTriggerHidden from "./useCloseWhenTriggerHidden";
import useEscapeKey from "@/components/shared/useEscapeKey";

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
  /*
   * Opening and closing, with the search cleared as it goes.
   *
   * Done here rather than in an effect on `open`: writing state from an effect is the pattern this
   * codebase keeps out of components, and the search has one lifetime - this menu being open - so
   * the gesture that ends it is the honest place to end the search too.
   */
  const setMenu = (next) => {
    setOpen(next);
    if (!next) setQuery("");
  };
  const [menuStyle, setMenuStyle] = useState(null);
  const wrapperRef = useRef(null);
  const menuRef = useRef(null);
  /*
   * Through a ref, so a caller may pass a fresh arrow every render - which every caller does -
   * without the effect below re-firing and asking the server again on each keystroke. The same
   * arrangement `FilterCombobox` uses, and for the same caller: a board whose column values are a
   * question only the server can answer, asked when the menu opens rather than on mounting.
   */
  const onOpenRef = useRef(onOpen);
  useEffect(() => { onOpenRef.current = onOpen; }, [onOpen]);

  // Portalled, so scrolling the pane moves the field but not the popover; closing is the honest
  // answer, and reopening is one click.
  useCloseWhenTriggerHidden(open, wrapperRef, () => setMenu(false));
  useEscapeKey(() => setMenu(false), open);

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
  const shown = typed ? normalized.filter((option) => String(option.label).toLowerCase().includes(typed)) : normalized;

  // An empty list is **no filter**, not a filter matching nothing - so it is handed back as
  // undefined, which is what the table reads as "this column is not filtered".
  const commit = (next) => onChange?.(next.length ? next : undefined);

  const toggle = (value) => {
    commit(chosen.includes(value) ? chosen.filter((entry) => entry !== value) : [...chosen, value]);
  };

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

  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => {
      if (wrapperRef.current?.contains(event.target)) return;
      if (menuRef.current?.contains(event.target)) return;
      setMenu(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

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
        const next = {
          position: "fixed",
          left: rect.left,
          minWidth: Math.max(rect.width, 180),
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
      role="listbox"
      aria-multiselectable="true"
      aria-label={ariaLabel}
      style={menuStyle}
      className="z-[9999] flex flex-col overflow-hidden rounded-lg border border-slate-200 bg-white text-sm shadow-[0_12px_28px_rgba(15,23,42,0.16)]"
    >
      {/* A search box only where the list is long enough to hunt through. Below that it is one more
          thing between the reader and four values they can already see. */}
      {normalized.length > 8 && <div className="border-b border-slate-100 p-1.5">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search"
          aria-label={`Search ${ariaLabel || "values"}`}
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

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-1">
        {shown.length === 0
          // "Still asking" and "nothing to offer" are different answers, and a menu saying the
          // second while the first is true reads as a column with no values in it.
          ? <p className="px-3 py-2 text-slate-500">{loading ? "Loading..." : "No matches."}</p>
          : shown.map((option) => {
            const picked = chosen.includes(option.value);
            return <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={picked}
              onClick={() => toggle(option.value)}
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-left ${picked ? "bg-blue-50 text-blue-900" : "text-slate-700 hover:bg-slate-50"}`}
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
    className={`relative flex min-h-7 w-full items-center rounded border bg-white ${open ? "border-blue-500 ring-2 ring-blue-100" : "border-slate-200"}`}
  >
    <button
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
