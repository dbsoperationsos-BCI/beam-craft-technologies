"use client";

import { createPortal } from "react-dom";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import useCloseWhenTriggerHidden from "./useCloseWhenTriggerHidden";
import useListKeyboard from "./useListKeyboard";
import useEscapeKey from "@/components/shared/useEscapeKey";
import { matchesWordChunks } from "@/lib/wordChunks.mjs";

/**
 * A column filter that can be typed into as well as picked from.
 *
 * The other column filters are plain text boxes; a closed set like Status is easier to pick
 * from a list. This is both: the text is the filter, and the list narrows as it is typed, so
 * a known value can be typed straight in without hunting the menu, and an unfamiliar one can
 * still be found by opening it.
 *
 * Styled to the filter row it sits in - the same height, border and text size as the plain
 * inputs beside it, so the row reads as one strip of controls.
 *
 * ── Options that are fetched rather than known ──
 *
 * `onOpen` is called each time the list opens, for a caller whose options are the values a column
 * actually holds - a question only the server can answer when the table is paged. It is called on
 * opening rather than on mounting because there is one of these per column and a reader opens one:
 * asking for every column's values up front would be a dozen queries over the whole board to fill a
 * menu nobody looked at. `loading` is what the menu says while that answer is on its way, so an
 * empty list reads as "still asking" rather than as "nothing here".
 */
export default function FilterCombobox({ ariaLabel, loading = false, onChange, onOpen, options = [], placeholder = "Filter", value = "" }) {
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState(null);
  const listId = useId();
  const wrapperRef = useRef(null);
  const menuRef = useRef(null);
  /*
   * Through a ref, so a caller may pass a fresh arrow every render - which every caller does -
   * without the effect below re-firing and asking the server again on each keystroke.
   */
  const onOpenRef = useRef(onOpen);
  useEffect(() => { onOpenRef.current = onOpen; }, [onOpen]);

  const normalized = options.map((option) => (typeof option === "string" ? { value: option, label: option } : option));
  const typed = String(value || "").trim().toLowerCase();
  // Typing narrows the list, but a value that exactly matches an option is treated as a
  // choice already made rather than a search - otherwise picking one leaves a menu of one.
  // `String()`: a column's values may come back as numbers or empty, and must never crash the filter.
  const exact = normalized.some((option) => String(option.label ?? "").toLowerCase() === typed);
  const shown = typed && !exact ? normalized.filter((option) => matchesWordChunks(option.label, typed)) : normalized;

  // The arrow keys, Home and End, and keeping the highlight in view - one rule, shared with
  // `FilterMultiSelect`, counted against the options actually on screen.
  const { activeIndex, setActiveIndex, walk } = useListKeyboard({ count: shown.length, listRef: menuRef });

  /*
   * Opening and closing, with the walk forgotten as it goes.
   *
   * **Every** close goes through here. There are four gestures that end this menu - Escape, a
   * mousedown outside it, the field scrolling out of view and the chevron - and while three of them
   * simply called `setOpen(false)`, a highlight left behind by one came back on the next open:
   * focusing the field reopens the menu, so the list would reappear scrolled to a row the reader
   * never walked to, announce it, and hand it to Enter. Where the options had been refetched
   * meanwhile it was a different value again.
   */
  const setMenu = useCallback((next) => {
    setOpen(next);
    if (!next) setActiveIndex(-1);
  }, [setActiveIndex]);

  // Portalled, so scrolling the pane moves the field but not the popover; closing is
  // the honest answer, and reopening is one click.
  useCloseWhenTriggerHidden(open, wrapperRef, () => setMenu(false));
  // Closes the list and leaves the filter row, and the board behind it, exactly as they were.
  useEscapeKey(() => setMenu(false), open);

  /**
   * Choosing one, from the menu or from the keyboard: the value **is** the filter here, so picking
   * writes it into the box and the list has nothing left to narrow.
   */
  function choose(option) {
    onChange?.(option.value);
    setMenu(false);
  }

  /*
   * ── Working it without a mouse ────────────────────────────────────────────────────────────────
   *
   * The walk itself - Down, Up, Home, End, and keeping the highlight in view - is `useListKeyboard`,
   * shared with `FilterMultiSelect`. Down on a closed menu opens it, because that is what the key
   * means on every other listbox. Escape is the one listener the whole application shares.
   *
   * Enter **closes**, unlike the multi-select beside it, because one answer is the whole question
   * here: there is nothing to come back to the list for.
   *
   * Hung on the field rather than on the menu: this control's search box is the field itself, so
   * focus never leaves it and the portalled menu is never what a key is pressed in.
   */
  function handleKeyDown(event) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (!open) { event.preventDefault(); setMenu(true); return; }
    }
    if (!open || walk(event)) return;
    if (event.key !== "Enter") return;
    // Only where a row is actually highlighted - Enter over a list nobody has walked leaves the
    // typed text as the filter, which is what this control has always meant by typing.
    const option = shown[activeIndex];
    if (!option) return;
    event.preventDefault();
    choose(option);
  }

  // Opening is three gestures - the field taking focus, typing into it, and the chevron - so the
  // callback hangs off the state rather than off any one of them.
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
    return () => {
      document.removeEventListener("mousedown", close);
    };
  }, [open, setMenu]);

  // The menu is portalled, so it has to be told where the field is on every frame it is
  // open - the table it sits in scrolls horizontally underneath it.
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
        const openAbove = below < 180 && above > below;
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
        const width = Math.min(rect.width, room);
        const left = Math.min(Math.max(rect.left, padding), window.innerWidth - padding - width);
        /*
         * The cap is also what the options truncate against. They used to be `whitespace-nowrap`
         * against a menu with no cap at all, so one long value - a service named in full, a venue -
         * stretched the menu past the edge of the window and carried the end of every other option
         * out with it.
         */
        const next = {
          position: "fixed",
          left,
          minWidth: width,
          maxWidth: window.innerWidth - padding - left,
          top: openAbove ? "auto" : rect.bottom + 4,
          bottom: openAbove ? window.innerHeight - rect.top + 4 : "auto",
          maxHeight: Math.max(160, Math.min(280, openAbove ? above : below)),
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

  const menu = open && menuStyle && typeof document !== "undefined" ? createPortal(
    <div
      ref={menuRef}
      role="listbox"
      aria-label={ariaLabel}
      style={menuStyle}
      id={listId}
      className="z-[9999] overflow-y-auto overscroll-contain rounded-lg border border-slate-200 bg-white py-1 text-sm shadow-[0_12px_28px_rgba(15,23,42,0.16)]"
    >
      {shown.length === 0 ? (
        // "Still asking" and "nothing to offer" are different answers, and a menu that says the
        // second while the first is true reads as a column with no values in it.
        <p className="px-3 py-2 text-slate-500">{loading ? "Loading..." : "No matches."}</p>
      ) : shown.map((option, index) => {
        const picked = option.value === value;
        const active = index === activeIndex;
        // One background class rather than two overriding each other: which of two Tailwind classes
        // wins is their order in the stylesheet, not their order in the attribute.
        const background = active
          ? (picked ? "bg-blue-100" : "bg-slate-100")
          : (picked ? "bg-blue-50" : "hover:bg-slate-50");
        return <button
          key={option.value}
          id={`${listId}-${index}`}
          type="button"
          role="option"
          aria-selected={picked}
          onMouseEnter={() => setActiveIndex(index)}
          onClick={() => choose(option)}
          className={`block w-full truncate px-3 py-2 text-left transition ${background} ${
            picked ? "font-medium text-blue-700" : "text-slate-700"
          }`}
        >
          {option.label}
        </button>;
      })}
    </div>,
    document.body,
  ) : null;

  return (
    <div ref={wrapperRef} className="relative flex min-h-7 w-full items-center rounded border border-slate-200 bg-white focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-100">
      <input
        value={value}
        onChange={(event) => {
          onChange?.(event.target.value);
          // The list is rebuilt under it, so an index kept from the old one would point at a
          // different value. Typing starts the walk again.
          setActiveIndex(-1);
          if (!open) setMenu(true);
        }}
        onKeyDown={handleKeyDown}
        onFocus={() => setMenu(true)}
        placeholder={placeholder}
        aria-label={ariaLabel}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open && activeIndex >= 0 && shown[activeIndex] ? `${listId}-${activeIndex}` : undefined}
        className="min-w-0 flex-1 bg-transparent px-2 py-1 text-[11px] text-slate-600 outline-none placeholder:text-slate-400"
      />
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
    </div>
  );
}
