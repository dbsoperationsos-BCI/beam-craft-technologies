"use client";

import HelpTip from "./HelpTip";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import ChevronIcon from "@/components/ui/ChevronIcon";
import EmployeeAvatar from "@/components/shared/EmployeeAvatar";
import { normalizeOptions } from "@/lib/dropdownOptions.mjs";
import { placeDropdownMenu } from "@/lib/dropdownMenu.mjs";
import useCloseWhenTriggerHidden from "./useCloseWhenTriggerHidden";
import useEscapeKey from "@/components/shared/useEscapeKey";
import { matchesWordChunks } from "@/lib/wordChunks.mjs";

/**
 * A dropdown that takes several answers at once, for the questions where one choice is not enough.
 *
 * `Dropdown` picks exactly one value and `ComboBoxField` types one in, so neither could answer
 * "which of these do you also need help with"; this is the missing third shape rather than a
 * variant of either. Values are plain strings, and the trigger summarises the selection rather than
 * growing with it, so the control keeps its height on a phone however many boxes are ticked.
 *
 * The menu is portalled to the body for the same reason `Dropdown` and `ComboBoxField` are: opened
 * inside a dialog, an absolutely positioned list is clipped by the dialog body's own scrolling box,
 * so a field near its foot showed two or three options and no way to reach the rest.
 *
 * `searchable` puts a box at the top of that menu, for a list long enough that finding a name in it
 * is work — the branches a role reaches, once a studio has more than a handful. It matches on the
 * label, which is the only part of an option anybody reads.
 */
export default function MultiSelectField({
  label,
  options = [],
  values = [],
  onChange,
  placeholder = "Select",
  helperText = "",
  // What a required selection left empty says for itself, exactly as `Dropdown` and `ComboBoxField`
  // do: the trigger reddens and the message sits under it. Without it this was the one control on
  // these forms that could be refused and still look answered.
  error = "",
  required = false,
  disabled = false,
  // As in `Dropdown`: `disabled` is a control that is off for now and keeps its chevron, `readOnly`
  // is a value being read back and loses it, along with the × on each chip. Nothing opens behind
  // either, but only one of them is still a control.
  readOnly = false,
  searchable = false,
  className = "",
  // For a filter on a module header, where the placeholder names it and a label above would make the
  // header two rows tall: the label stays for screen readers and is not drawn.
  hideLabel = false,
  /*
   * `size="sm"` for a filter in a module header, where this stands beside `Dropdown mode="switch"`
   * and the header's buttons.
   *
   * A **fixed** `h-9` rather than the form's floor-and-grow: 36px whether it holds nothing, one
   * branch or five, exactly the switch beside it, so the header bar is one height before the filter
   * is used and after. The chips are 20px inside that and never wrap - the row they sit in scrolls
   * sideways - so nothing in here can push the box past it.
   *
   * What actually broke the header was not this: the row's own CSS sizes every `button[aria-label]`
   * in it to 36px square, which caught each chip's × and made the chip taller than the field. That
   * is fixed where it is caused - `data-chip-remove` on the × and a `:not()` in `globals.css` - and
   * this size is what makes the control level with its neighbours rather than merely contained.
   */
  size = "md",
  /*
   * The field is **as wide as its chips**: they stay on one line at their own width, nothing is
   * truncated, and the box grows sideways to hold them. The caller gives it room to grow into and a
   * ceiling to stop at (its own `className`, and a container that is not a fixed width).
   *
   * The default is the opposite and is right nearly everywhere: the field is the width its column
   * or its form row gives it, and its chips scroll sideways inside that. It is wrong where the
   * answers themselves are what the reader is there to see and there is room beside them - the
   * Production Schedule's Assist holds five people at the end of a row with nothing to its right,
   * and reading "emp:27068", "EXT-Sathish ..." in a 176px slot answers nothing.
   */
  fitChips = false,
  // Open from the start, for a picker mounted only once it is asked for (the Production Schedule's
  // Assist); `onClose` is told when the tick list closes, so such a picker can save what was ticked.
  defaultOpen = false,
  /*
   * How wide the **menu** may open, whatever the field's own width - as `Dropdown`'s prop of the
   * same name does.
   *
   * For a field that is deliberately narrow: the Production Schedule's Assist sits in a column one
   * name wide, and a menu matching it cut every employee's name in half. The list opens at a width
   * worth reading while the column, and the sheet's alignment with it, stay as they are.
   */
  menuMinWidth = 0,
  // The other half of it: the menu never opens wider than this, whatever the field's own width. For
  // a field that grows with its answers (`fitChips`) and a list that should not grow with it.
  menuMaxWidth = 0,
  onClose,
}) {
  const inert = disabled || readOnly;
  // Dense is a fixed height, which only holds while the chips stay on one line. Wrapping them is a
  // box that grows, so the height goes back to being a floor.
  // Dense is a fixed height, which holds whatever the chips do: fitting them makes the box wider,
  // never taller.
  const dense = size === "sm";
  const compact = size === "sm";
  const [open, setOpen] = useState(defaultOpen);
  const [query, setQuery] = useState("");
  const [position, setPosition] = useState(null);
  const wrapperRef = useRef(null);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);

  // Where the menu goes, measured against the room the field actually has; see `placeDropdownMenu`.
  const updatePosition = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const { openUpward, ...style } = placeDropdownMenu({
      rect,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      minWidth: menuMinWidth,
      maxWidth: menuMaxWidth,
    });
    setPosition(style);
  }, [menuMaxWidth, menuMinWidth]);

  const close = useCallback(() => { setOpen(false); setQuery(""); onClose?.(); }, [onClose]);
  // Portalled, so scrolling the pane moves the field but not the menu; closing is the honest answer.
  useCloseWhenTriggerHidden(open, triggerRef, close);

  // Closes the tick list without closing the form it is part of.
  useEscapeKey(close, open);

  useEffect(() => {
    if (!open) return undefined;
    // The menu no longer lives inside the wrapper, so ticking a box in it is not an outside press.
    const closeOnOutside = (event) => {
      if (wrapperRef.current?.contains(event.target)) return;
      if (menuRef.current?.contains(event.target)) return;
      close();
    };
    updatePosition();
    document.addEventListener("mousedown", closeOnOutside);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      document.removeEventListener("mousedown", closeOnOutside);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [close, open, updatePosition]);

  // Options arrive either as plain strings or as {label, value} pairs, exactly as Dropdown accepts
  // them - passing pairs here used to key every row on the object itself, so each one came out as
  // "[object Object]" and React saw a list of duplicate keys.
  const items = normalizeOptions(options);
  const labelFor = (value) => items.find((item) => item.value === value)?.label ?? String(value);
  // A person's face, when the option is one - `{ name, photoUrl, seed }`, as `Dropdown` takes it.
  const avatarFor = (value) => items.find((item) => item.value === value)?.avatar;
  // Narrowed for reading only: what is already ticked stays ticked whether or not the search still
  // shows it, so typing can never quietly drop an answer already given.
  const term = query.trim().toLocaleLowerCase();
  const shown = term ? items.filter((item) => matchesWordChunks(item.label, term)) : items;

  function toggle(value) {
    const next = values.includes(value) ? values.filter((entry) => entry !== value) : [...values, value];
    onChange?.(next);
  }

  /*
   * Select all takes **what is on screen**; Clear takes **everything**.
   *
   * The asymmetry is deliberate. Selecting is additive and has to respect a search: a list somebody
   * has narrowed on purpose means all of those, not the whole catalogue from behind the search.
   * Clearing is the way out, so it must be able to reach an answer that is **not** in front of the
   * reader - otherwise a control can hold a value with nothing on screen that removes it, which is
   * exactly what a list whose options change underneath it produces.
   */
  const shownValues = shown.map((item) => item.value);
  const allShownChosen = shownValues.length > 0 && shownValues.every((value) => values.includes(value));
  const selectAllShown = () => onChange?.([...values, ...shownValues.filter((value) => !values.includes(value))]);

  /*
   * `min-w-0` down the chain: in a grid cell or a flex row an element is as wide as its content by
   * default, and the chips laid out in one line are that content - so ten names pushed the field past
   * its column instead of scrolling inside it. Held to the column, the chip row below scrolls.
   */
  // `relative` holds a hidden label (`sr-only`) inside the field, as Dropdown's does.
  return <div ref={wrapperRef} className={`relative block min-w-0 max-w-full text-[11px] font-semibold text-slate-600 sm:text-xs ${className}`}>
    <span className={hideLabel ? "sr-only" : undefined}>{label}{required && <span aria-hidden="true" className="ml-0.5 text-rose-500">*</span>}<HelpTip text={helperText} /></span>
    <div className={`relative min-w-0 ${hideLabel ? "" : "mt-1.5"}`}>
      {/* The chosen answers sit inside the control rather than being counted above it, so the
          selection reads as itself. A div rather than a button, because each chip carries its own
          remove control and a button cannot contain buttons. */}
      <div
        ref={triggerRef}
        aria-invalid={error ? true : undefined}
        onClick={() => { if (!inert) setOpen(true); }}
        // `focus-within`, not `focus`: this is a div holding the chips and their remove buttons, so
        // the focus is always on something inside it.
        className={`flex w-full min-w-0 items-center gap-1.5 rounded-lg border bg-white px-2 ${dense ? "h-9 py-0" : compact ? "min-h-9 py-1" : "min-h-9 py-1.5"} text-left text-xs font-normal text-slate-700 transition focus-within:ring-2 sm:text-sm ${error ? "border-red-400 focus-within:border-red-500 focus-within:ring-red-100" : "border-slate-300 focus-within:border-blue-500 focus-within:ring-blue-100"} ${readOnly ? "cursor-default bg-slate-100" : disabled ? "cursor-default bg-slate-50" : "cursor-pointer"}`}
      >
        {/* Scrolls sideways with no bar showing: the control is one field tall, and a scrollbar drawn
            inside it covers the very chips it is there to reach. The chips scroll by drag, wheel or
            trackpad, and the list below is the reliable way to see everything chosen. */}
        {/* `min-w-0` lets the row be squeezed and its chips scroll; fitting them instead means the
            row keeps its natural width, which is what makes the box grow to hold it. The scroll
            stays either way, for the ceiling the caller caps the growth at. */}
        <div className={`flex flex-1 items-center gap-1.5 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${fitChips ? "" : "min-w-0"}`}>
        {values.length === 0 && <span className="shrink-0 px-1 text-slate-400">{placeholder}</span>}
        {/* A rounded rectangle rather than a pill, and roomy enough to read at a glance: these are
            the answers themselves, not annotations on them. The label is slate-700, the same as the
            option rows below it and the rest of the form's text - a chip is the answer repeated
            back, so it should not read darker than the words it was chosen from. The blue tint is
            the chip, not the word. */}
        {values.map((value) => <span key={value} className={`inline-flex max-w-full shrink-0 items-center gap-1.5 rounded bg-blue-50 ${compact ? "py-0.5" : "py-1"} ${avatarFor(value) ? "pl-1" : "pl-2.5"} text-xs font-medium text-slate-700 ${inert ? "pr-2.5" : "pr-1.5"}`}>
          {avatarFor(value) && <EmployeeAvatar {...avatarFor(value)} size="2xs" decorative />}
          <span className={fitChips ? "whitespace-nowrap" : "truncate"}>{labelFor(value)}</span>
          {/* Gone rather than greyed when the field cannot be written to: a × offers to take the
              answer away, and a role being read back has no such offer to make. Faded and inert it
              still reads as a control that ought to work, which is a worse answer than no control. */}
          {!inert && <button
            type="button"
            aria-label={`Remove ${labelFor(value)}`}
            /*
             * It is part of a chip, not a control standing in the row on its own.
             *
             * A module header sizes every `button[aria-label]` in its action row to 36px square
             * (`globals.css`), which is right for an icon button beside Add Meet and catastrophic
             * here: this × became 36px at 1rem, so the chip grew taller than the field holding it
             * and spilled out of the box. The attribute is how that rule knows to leave it alone.
             */
            data-chip-remove="true"
            onClick={(event) => { event.stopPropagation(); toggle(value); }}
            className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded text-sm leading-none text-slate-600 hover:bg-blue-200 hover:text-slate-900"
          >
            ×
          </button>}
        </span>)}
        </div>
        {!readOnly && <button
          type="button"
          disabled={disabled}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={`${label} options`}
          onClick={(event) => { event.stopPropagation(); if (open) close(); else setOpen(true); }}
          className="inline-flex shrink-0 items-center self-center text-slate-500 hover:text-slate-800 disabled:opacity-60"
        >
          <ChevronIcon direction={open ? "up" : "down"} size={18} />
        </button>}
      </div>
    </div>
    {/* Fixed rather than absolute, and z-[9999] to match the other portalled popovers: a dialog
        stacks well above the layers scale, so a lower value would put the menu behind the card it
        was opened from. The height comes from `position.maxHeight`, not a `max-h-*` class that
        would win or lose by stylesheet order. */}
    {open && position && typeof document !== "undefined" && createPortal(
      <div
        ref={menuRef}
        role="listbox"
        aria-label={label}
        aria-multiselectable="true"
        style={position}
        className="fixed z-[9999] overflow-y-auto overscroll-contain rounded-lg border border-slate-200 bg-white py-1 text-left font-normal shadow-[0_12px_28px_rgba(15,23,42,0.16)]"
      >
        {searchable && items.length > 0 && <div className="border-b border-slate-200 p-2">
          <input
            autoFocus
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label={`Search ${label}`}
            placeholder="Search"
            className="min-h-8 w-full rounded border border-slate-200 px-2.5 text-xs font-normal text-slate-700 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 sm:text-sm"
          />
        </div>}
        {/*
          * Above the list and under the search, so "all of these" means the rows under it.
          *
          * Two controls rather than one toggle: **Clear** has to be reachable whenever anything is
          * chosen, including when what is chosen is no longer on the list - a toggle that appeared
          * only once everything shown was ticked was the state with no way out.
          */}
        {(shown.length > 1 || values.length > 0) && <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-3 py-2 text-xs sm:text-sm">
          {shown.length > 1 && !allShownChosen
            ? <button type="button" onClick={selectAllShown} className="font-semibold text-slate-600 hover:text-slate-900">
              Select all{term && shown.length !== items.length ? ` (${shown.length})` : ""}
            </button>
            : <span className="font-semibold text-slate-400">{allShownChosen ? "All selected" : ""}</span>}
          {values.length > 0 && <button type="button" onClick={() => onChange?.([])} className="font-medium text-blue-600 hover:text-blue-800">
            {/* The count, because it is the one place an answer the list no longer holds is visible
                at all - "Clear (6)" over a list of 4 is the reader's clue that two are off it. */}
            Clear{values.length > 1 ? ` (${values.length})` : ""}
          </button>}
        </div>}
        {items.length === 0
          ? <p className="px-3 py-2 text-xs text-slate-500 sm:text-sm">No options available.</p>
          : shown.length === 0
          ? <p className="px-3 py-2 text-xs text-slate-500 sm:text-sm">Nothing matches “{query.trim()}”.</p>
          : shown.map((item) => {
            const selected = values.includes(item.value);
            return <label key={item.value} role="option" aria-selected={selected} className={`flex cursor-pointer ${item.avatar ? "items-center" : "items-start"} gap-2 px-3 py-2 text-xs font-normal text-slate-700 hover:bg-blue-50 sm:text-sm`}>
              <input type="checkbox" checked={selected} onChange={() => toggle(item.value)} className={`${item.avatar ? "" : "mt-0.5 "}h-4 w-4 shrink-0 accent-blue-600`} />
              {item.avatar && <EmployeeAvatar {...item.avatar} size="xs" decorative />}
              <span className="min-w-0">{item.label}</span>
            </label>;
          })}
      </div>,
      document.body,
    )}
    {error && <p role="alert" className="mt-1.5 font-normal text-red-600">{error}</p>}
  </div>;
}
