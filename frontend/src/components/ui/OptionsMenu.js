"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import IconButton from "@/components/shared/IconButton";
import useCloseWhenTriggerHidden from "@/components/shared/useCloseWhenTriggerHidden";
import useEscapeKey from "@/components/shared/useEscapeKey";

/** Breathing room kept between the menu and the edge of the window. */
const EDGE_MARGIN = 8;
/** The menu hangs directly off the trigger, with no gap for the eye to cross. */
const TRIGGER_GAP = 0;
/** Used only before a menu has been rendered once and can be measured for real. */
const ESTIMATED_WIDTH = 176;
const ESTIMATED_ROW_HEIGHT = 36;

/**
 * The ⋮ menu used for row actions and table options.
 *
 * An item is `{ label, onSelect }` plus optional `disabled`, `title`, `tone: "danger"`, a
 * `detail` for a quiet second line inside the row itself, `description` for a line of explanatory
 * text standing on its own, a `submenu` of its own choices, an `action` - `{ label, onSelect }`, a
 * small button at the end of the row that acts on it and leaves the menu open, `switchOn` - true or
 * false - for a setting drawn as an on/off switch rather than a tick, or `separator: true`
 * for a rule between groups. `title` on the menu itself draws a heading above the first group, the
 * way a desktop context menu names what it is acting on.
 *
 * Both the menu and its submenus are placed against the window rather than the table, so neither can
 * end up hidden under the edge of a scrolling container: each one flips to the other side, or slides
 * along, whichever keeps it on screen.
 */
/**
 * How the trigger presents itself. Picked by name rather than passed in as classes, because a
 * caller's utility cannot reliably beat the base one it conflicts with - Tailwind decides between
 * two `h-*` classes by its own ordering, not by the order they appear here. Only the colours live
 * here; the dimensions come from IconButton's `size`, so the two cannot fight.
 */
/*
 * How big the ⋮ itself is drawn. A caller may name a size instead - `triggerSize` - which is what a
 * table whose rows are otherwise a line of text uses: the trigger is the tallest thing in the row,
 * so it, rather than the type, decides how tall a row is.
 */
const TRIGGER_SIZES = { plain: "sm", button: "md" };

const TRIGGER_TONES = {
  // Quiet control for a table row, where a border on every row would be noise.
  plain: "text-slate-500 hover:bg-slate-100 hover:text-slate-700",
  // Matches the buttons beside it in a page header.
  button: "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50",
};

// The open look replaces the resting one rather than being appended to it. Appending would leave
// two `bg-*` classes on the element and let Tailwind's own ordering decide, which is how the
// highlight silently lost to the resting background.
const TRIGGER_TONES_OPEN = {
  plain: "bg-slate-100 text-slate-900",
  button: "border border-blue-500 bg-blue-50 text-blue-700",
};

/**
 * `compact` is the small menu a Board card's ⋮ opens: as wide as its longest option (never a fixed
 * width that cuts "Mark 3rd month paid" short), tighter rows in smaller type, and a
 * short grow-and-fade from the ⋮ (`.animate-options-menu-pop`, still under reduced motion). On a
 * phone the rows keep a finger's height; from `sm` up they tighten.
 *
 * `zIndex` is the numeric escape hatch for a trigger that lives inside its own portal - the menu is
 * a sibling of that portal under document.body, not a child of it, so a caller stacked above the
 * default would otherwise paint straight over its own open menu. When given it wins over
 * `menuZIndexClassName`, which stays the usual, layer-scale way to say the same thing.
 */
export default function OptionsMenu({ ariaLabel = "Options", title, items, menuClassName = "w-44", menuBodyClassName = "", menuZIndexClassName = "z-[60]", triggerClassName = "", triggerVariant = "plain", zIndex, triggerContent = "⋮", triggerSize, preferAbove = false, onOpen, compact = false }) {
  const zIndexClass = zIndex === undefined ? menuZIndexClassName : "";
  const zIndexStyle = zIndex === undefined ? null : { zIndex };
  const [open, setOpen] = useState(false);
  const [openSubmenu, setOpenSubmenu] = useState(null);
  const [position, setPosition] = useState(null);
  const [submenuPosition, setSubmenuPosition] = useState(null);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  const submenuRef = useRef(null);
  const submenuAnchorRef = useRef(null);
  const submenuTimer = useRef(null);
  // Portalled, so scrolling the pane moves the field but not the popover; closing is
  // the honest answer, and reopening is one click.
  useCloseWhenTriggerHidden(open, triggerRef, () => setOpen(false));

  const closeAll = useCallback(() => { window.clearTimeout(submenuTimer.current); setOpen(false); setOpenSubmenu(null); }, []);

  /**
   * A submenu sits flush against the side of the menu, but the pointer still leaves the parent row
   * on its way across. Closing is therefore held back briefly and cancelled the moment the pointer
   * lands anywhere in the submenu, so the choices cannot vanish out from under it.
   */
  const showSubmenu = useCallback((label) => { window.clearTimeout(submenuTimer.current); setOpenSubmenu(label); }, []);
  const hideSubmenu = useCallback((label) => {
    window.clearTimeout(submenuTimer.current);
    submenuTimer.current = window.setTimeout(() => setOpenSubmenu((current) => current === label ? null : current), 180);
  }, []);

  useEffect(() => () => window.clearTimeout(submenuTimer.current), []);

  const updatePosition = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;

    // Measured once the menu exists; estimated on the very first open, then corrected below.
    const width = menuRef.current?.offsetWidth || ESTIMATED_WIDTH;
    const height = menuRef.current?.offsetHeight || Math.min(items.length * ESTIMATED_ROW_HEIGHT + 8, window.innerHeight - EDGE_MARGIN * 2);
    const spaceBelow = window.innerHeight - rect.bottom - EDGE_MARGIN;
    const spaceAbove = rect.top - EDGE_MARGIN;
    // Dropped below the trigger normally, raised above it when the room below has run out.
    // A composer sits at the foot of its panel, so its menu belongs above the button the way
    // WhatsApp draws it - dropping below would take it out of the panel entirely. Room permitting;
    // the ordinary rule still applies when there is none.
    const openAbove = (preferAbove && spaceAbove > height) || (spaceBelow < height && spaceAbove > spaceBelow);

    setPosition({
      top: openAbove
        ? Math.max(EDGE_MARGIN, rect.top - height - TRIGGER_GAP)
        : Math.max(EDGE_MARGIN, Math.min(rect.bottom + TRIGGER_GAP, window.innerHeight - height - EDGE_MARGIN)),
      // Right-aligned to the trigger, then pulled back inside whichever edge it would have crossed.
      left: Math.max(EDGE_MARGIN, Math.min(rect.right - width, window.innerWidth - width - EDGE_MARGIN)),
    });
  }, [items.length, preferAbove]);

  /**
   * A submenu opens to the right of the menu, and only swaps to the left when the right would take
   * it off screen — so a table's ⋮ near the window edge still shows its choices instead of hiding
   * them. Its top follows the item it belongs to, clamped so a long list cannot run off the bottom.
   */
  const positionSubmenu = useCallback((label) => {
    const anchor = submenuAnchorRef.current?.getBoundingClientRect();
    const menu = menuRef.current?.getBoundingClientRect();
    if (!anchor || !menu) return;

    const width = submenuRef.current?.offsetWidth || ESTIMATED_WIDTH;
    const height = submenuRef.current?.offsetHeight || ESTIMATED_ROW_HEIGHT * 4;
    const fitsRight = menu.right + width + EDGE_MARGIN <= window.innerWidth;

    // Tagged with the item it was measured for, so opening a second submenu cannot briefly reuse
    // the first one's coordinates before this runs again.
    setSubmenuPosition({
      label,
      top: Math.max(EDGE_MARGIN, Math.min(anchor.top - 4, window.innerHeight - height - EDGE_MARGIN)),
      left: fitsRight ? menu.right : Math.max(EDGE_MARGIN, menu.left - width),
    });
  }, []);

  /*
   * Click-outside closes the menu - but only while there is a menu to close.
   *
   * This ran unconditionally, so every mounted OptionsMenu held a document-level `mousedown`
   * listener whether or not it was open. One per row of a table is fine at twenty rows and is not
   * at fifty thousand: the CRM board put 50,000 listeners on `document`, and every click anywhere
   * in the application then ran 50,000 handlers, each walking the DOM twice through
   * `Node.contains`. That is a click that takes seconds, on a page that is already struggling.
   *
   * Gated on `open` the cost is one listener, because only one menu can be open at a time.
   */
  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => {
      if (!triggerRef.current?.contains(event.target) && !menuRef.current?.contains(event.target)) closeAll();
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open, closeAll]);

  // Escape closes the menu, not whatever it was opened over.
  useEscapeKey(closeAll, open);

  useEffect(() => {
    if (!open) return undefined;
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [closeAll, open, updatePosition]);

  // Measured after the submenu has rendered, which is why it stays hidden until placed.
  useEffect(() => {
    if (openSubmenu) positionSubmenu(openSubmenu);
  }, [openSubmenu, positionSubmenu]);

  function choose(item) {
    closeAll();
    item.onSelect?.();
  }

  const headingClass = "px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500";

  function renderItem(item, index) {
    const key = `${item.label || "separator"}-${index}`;
    if (item.separator) return <div key={key} role="separator" className="my-1 border-t border-slate-100" />;
    if (item.description) return <p key={key} className="px-3 py-2 text-xs leading-4 text-slate-400">{item.description}</p>;

    if (item.submenu) {
      const showing = openSubmenu === item.label;
      const placed = submenuPosition?.label === item.label ? submenuPosition : null;
      return <div
        key={key}
        className="relative"
        ref={showing ? submenuAnchorRef : undefined}
        onMouseEnter={() => showSubmenu(item.label)}
        onMouseLeave={() => hideSubmenu(item.label)}
      >
        <button type="button" role="menuitem" aria-haspopup="menu" aria-expanded={showing} onClick={() => setOpenSubmenu((current) => current === item.label ? null : item.label)} className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50 ${showing ? "bg-slate-50 text-slate-900" : "text-slate-700"}`}>
          <span>{item.label}</span>
          <span aria-hidden="true" className="text-slate-400">›</span>
        </button>
        {showing && <div
          ref={submenuRef}
          role="menu"
          aria-label={item.label}
          onMouseEnter={() => showSubmenu(item.label)}
          onMouseLeave={() => hideSubmenu(item.label)}
          /* As wide as its longest choice, never narrower than `w-40` nor wider than the screen,
             unless the row asks for a width of its own: the choices never wrap (a name on two lines
             reads as two options), so a fixed width let "Employment Certificate" run into the edge. */
          className={`fixed ${zIndexClass} ${item.submenuClassName || "w-max min-w-40 max-w-[calc(100vw-1rem)]"} rounded-md border border-slate-200 bg-white py-1 shadow-lg`}
          style={{ ...(placed ? { top: placed.top, left: placed.left } : { top: 0, left: 0, visibility: "hidden" }), ...zIndexStyle }}
        >
          {/* The flyout repeats what it is choosing, so it still reads on its own once it has
              flipped to the other side of the menu and is no longer beside its parent row. */}
          <div className={`${headingClass} border-b border-slate-200 pb-1.5`}>{item.label}</div>
          <div className="pt-1">
            {item.submenu.map((subItem) => <button
              key={subItem.label}
              type="button"
              role="menuitemradio"
              aria-checked={Boolean(subItem.selected)}
              onClick={() => choose(subItem)}
              className={`flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm hover:bg-slate-50 ${subItem.selected ? "bg-blue-50 font-medium text-blue-700" : "text-slate-700"}`}
            >
              {/* A choice may bring an icon of its own; it leads the row, the way an icon does
                  everywhere else in the module. `whitespace-nowrap` because these are names, and
                  a name broken across two lines looks like two choices. */}
              <span className="flex min-w-0 items-center gap-2 whitespace-nowrap">
                {subItem.icon}
                {subItem.label}
              </span>
              {/* The tick is for a row that has nothing else to mark it. Where a choice carries an
                  icon, the highlight behind the row already says which one is on, and the tick was
                  a second mark saying the same thing. */}
              {subItem.selected && !subItem.icon && <span aria-hidden="true">✓</span>}
            </button>)}
          </div>
        </div>}
      </div>;
    }

    // An item that can be on or off says so with a tick, the way the submenu choices already do - or,
    // with `switchOn`, with a switch: a setting the row turns on and off rather than a choice made.
    const switchable = item.switchOn !== undefined;
    const checkable = item.selected !== undefined || switchable;
    const row = <button
      key={key}
      type="button"
      role={checkable ? "menuitemcheckbox" : "menuitem"}
      aria-checked={checkable ? Boolean(switchable ? item.switchOn : item.selected) : undefined}
      disabled={item.disabled}
      onClick={() => choose(item)}
      title={item.title}
      className={`flex w-full items-center justify-between gap-2 text-left hover:bg-slate-50 disabled:cursor-not-allowed ${compact ? "px-2.5 py-1.5 text-[13px] sm:py-1 sm:text-xs" : "px-3 py-2 text-sm"} disabled:bg-transparent disabled:text-slate-400 ${item.tone === "danger" ? "text-red-600 hover:bg-red-50" : item.selected ? "bg-blue-50 font-medium text-blue-700" : "text-slate-700"}`}
    >
      {/* `detail` is a second line of the same row, not a row of its own: a description item
          beneath carries its own padding, so one entry read as two and the menu grew twice as tall
          as it needed to be. Inside the button it is also part of the same hover and the same
          click target, which is what it always described. */}
      <span className="min-w-0">
        <span className="block truncate">{item.label}</span>
        {item.detail && <span className="mt-0.5 block truncate text-xs font-normal text-slate-400">{item.detail}</span>}
      </span>
      {item.selected && <span aria-hidden="true">✓</span>}
      {switchable && <span aria-hidden="true" className={`relative h-4 w-8 shrink-0 rounded-full transition-colors ${item.switchOn ? "bg-blue-600" : "bg-slate-300"}`}><span className={`absolute left-0.5 top-0.5 h-3 w-3 rounded-full bg-white shadow-sm transition-transform ${item.switchOn ? "translate-x-4" : ""}`} /></span>}
    </button>;
    if (!item.action) return row;
    // Beside the row rather than inside it - a button cannot hold a button - and it does not close
    // the menu, so several rows can be acted on in one visit.
    return <div key={key} className="flex items-center gap-1 pr-2 hover:bg-slate-50">
      <span className="min-w-0 flex-1">{row}</span>
      <button
        type="button"
        onClick={() => item.action.onSelect?.()}
        aria-label={`${item.action.label}: ${item.label}`}
        // 40px tall, like every other thing a finger has to hit: on a phone this sits beside a
        // row that opens something else, and a miss is the wrong action rather than no action.
        className="min-h-10 shrink-0 whitespace-nowrap rounded px-2 text-[11px] font-medium text-blue-600 hover:bg-blue-50 hover:text-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200 sm:text-xs"
      >
        {item.action.label}
      </button>
    </div>;
  }

  return <div className="flex justify-center">
    <IconButton ref={triggerRef} onClick={(event) => { event.stopPropagation(); if (!open) { updatePosition(); onOpen?.(); } setOpen((current) => !current); }} label={ariaLabel} aria-expanded={open} size={triggerSize || TRIGGER_SIZES[triggerVariant] || TRIGGER_SIZES.plain} className={`${(open ? TRIGGER_TONES_OPEN : TRIGGER_TONES)[triggerVariant] || (open ? TRIGGER_TONES_OPEN : TRIGGER_TONES).plain} ${triggerClassName}`}>{triggerContent}</IconButton>
    {open && position && createPortal(
      <div
        ref={menuRef}
        role="menu"
        aria-label={title || ariaLabel}
        onClick={(event) => event.stopPropagation()}
        className={`fixed ${zIndexClass} rounded-md border border-slate-200 bg-white py-1 text-left shadow-lg ${compact ? `animate-options-menu-pop ${menuClassName === "w-44" ? "w-max min-w-28 max-w-56" : menuClassName}` : menuClassName}`}
        style={{ ...position, ...zIndexStyle }}
      >
        {title && <div className={`${headingClass} mb-1 border-b border-slate-200 pb-2`}>{title}</div>}
        {/*
          * The rows scroll, the heading does not.
          *
          * A menu long enough to need a scroller is rare - the notifications panel is the only one
          * that gets there - and the obvious way to do it is a `max-h` on the box above with the
          * heading stuck to the top of it. That leaves the box's own `py-1` *above* the stuck
          * heading, and scrolled rows show through those four pixels: a line of text floating over
          * the title. Scrolling the list on its own has no such seam, and the heading stays put
          * because it was never inside the moving part.
          */}
        {menuBodyClassName ? <div className={menuBodyClassName}>{items.map(renderItem)}</div> : items.map(renderItem)}
      </div>,
      document.body,
    )}
  </div>;
}
