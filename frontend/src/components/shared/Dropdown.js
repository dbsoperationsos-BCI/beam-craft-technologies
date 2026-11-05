"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import ChevronIcon from "@/components/ui/ChevronIcon";
import { CLEAR_OPTION_VALUE, normalizeOptions, sortOptionsByLabel, typeaheadIndex, withClearOption } from "@/lib/dropdownOptions.mjs";
import { placeDropdownMenu } from "@/lib/dropdownMenu.mjs";
import useCloseWhenTriggerHidden from "./useCloseWhenTriggerHidden";
import useEscapeKey from "@/components/shared/useEscapeKey";

/**
 * How long a typed letter waits for the next one before it counts as a fresh search. A shade under
 * a second, which is the ballpark every native `<select>` uses.
 */
const TYPEAHEAD_WINDOW_MS = 900;

export default function Dropdown({
  ariaLabel,
  className = "",
  /*
   * Offer a way back to no answer at all.
   *
   * A menu can only ever move a field from one option to another, so an **optional** field answered
   * by mistake used to stay answered for good. Opt-in rather than automatic: the form renderers
   * turn it on for the optional fields they draw, while the pickers that are not a question with a
   * blank answer - a phone's country code, a filter switch that already offers "All" - are left
   * alone. Never set on a required field, where an empty answer is one the form would refuse.
   *
   * The row appears only once something is selected: with nothing chosen the placeholder already
   * says so, and a menu that opens on "None" above every fresh list is noise.
   */
  clearable = false,
  clearLabel = "None",
  disabled = false,
  // Two different silences, and they must not look alike. `disabled` is a control that is off for
  // now — the shoot picker before a project is chosen — so it keeps its chevron: it is still a
  // dropdown, waiting on an answer it names in its placeholder. `readOnly` is a value being read
  // back, on a record nobody is editing; there is no menu behind it to open, so the chevron would
  // be pointing at nothing. It reads as a field, not as a control that refuses to work.
  readOnly = false,
  error = "",
  label,
  // The menu is portalled to the body, so it needs to out-stack whatever it opens over. A value
  // from the layers scale is not enough on its own: the CRM's dialogs sit at z-150 to z-200, so a
  // default of z-120 put the menu behind the dialog that opened it, which reads as the control
  // being dead. the other portalled controls of this kind.
  // Callers inside a known surface may still pass a lower, layer-scale value of their own.
  menuZIndexClassName = "z-[9999]",
  mode = "input",
  onChange,
  options = [],
  placeholder = "Select",
  required = false,
  searchable = false,
  // The menu lists its options in alphabetical ascending order whatever order the caller holds
  // them in, so the same values read the same way in every picker. Pass `sorted={false}` for the
  // rare list whose order *is* its meaning — a duration scale, where "1 hour" belongs after
  // "45 minutes" however the alphabet feels about it.
  sorted = true,
  // How wide the menu may open, whatever the trigger's own width. For a field that is
  // deliberately narrow - the country picker - a menu matching it wraps every row.
  menuMinWidth = 0,
  // What the closed trigger reads, when that differs from the option's own row in the menu.
  // The country picker needs this: its rows say "🇮🇳 India +91" so they can be read and searched,
  // while the trigger sits in a 5rem box and may only show the flag and the code.
  triggerLabel,
  value,
}) {
  const inert = disabled || readOnly;
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [position, setPosition] = useState(null);
  // Which option the arrow keys are sitting on, as an index into what is currently listed.
  const [activeIndex, setActiveIndex] = useState(0);
  const listboxId = useId();
  const triggerRef = useRef(null);
  const inputRef = useRef(null);
  const menuRef = useRef(null);
  // Accepts a plain list of strings as well as {label, value} pairs; see `normalizeOptions`.
  // Two entries that are not options: `{ separator: true }` draws a rule between groups, and
  // `{ heading: "..." }` names the group that follows. Both are marked disabled so the arrow-key
  // stepping, which already skips disabled options, steps over them too.
  //
  // A list that names its own groups has an order of its own, so it is never alphabetised: sorting
  // would float them out of place - neither has a label to sort by - and scatter the entries they
  // were drawn around.
  const listed = normalizeOptions(options);
  const grouped = listed.some((option) => option.separator || option.heading);
  const ordered = (sorted && !grouped ? sortOptionsByLabel(listed) : listed)
    .map((option) => (option.separator || option.heading ? { ...option, disabled: true } : option));
  // Added after the sorting, so the row stays at the top instead of being filed under "N".
  const answered = value !== CLEAR_OPTION_VALUE && value !== null && value !== undefined;
  const normalizedOptions = clearable && answered ? withClearOption(ordered, { label: clearLabel }) : ordered;
  const selected = normalizedOptions.find((option) => option.value === value);
  const visibleOptions = searchable && search.trim()
    ? normalizedOptions.filter((option) => String(option.label ?? "").toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))
    : normalizedOptions;
  const isInput = mode === "input";

  const updatePosition = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;

    // Opens upward when there is more room there, so a trigger low on the page never gets a menu
    // laid over the field it belongs to; see `placeDropdownMenu`.
    const { openUpward, ...style } = placeDropdownMenu({
      rect,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      // The helper calls it `minWidth`. Passing it under this component's own prop name left it
      // undefined there, so the menu kept matching a 76px trigger and wrapped every row.
      minWidth: menuMinWidth,
    });
    setPosition(style);
  }, [menuMinWidth]);

  const close = useCallback(() => {
    setOpen(false);
    setSearch("");
  }, []);
  useCloseWhenTriggerHidden(open, triggerRef, close);

  /*
   * Escape closes the list and puts focus back on the control that opened it.
   *
   * Through the shared arbiter, which is what makes it close the *list* and not the dialog this
   * dropdown may be sitting inside. Both used to hear the same press. See `useEscapeKey`.
   */
  useEscapeKey(() => {
    setOpen(false);
    setSearch("");
    (inputRef.current || triggerRef.current)?.focus();
  }, open);

  useEffect(() => {
    if (!open) return undefined;

    const dismiss = (event) => {
      if (
        !triggerRef.current?.contains(event.target) &&
        !menuRef.current?.contains(event.target)
      ) {
        setOpen(false);
      }
    };
    updatePosition();
    document.addEventListener("mousedown", dismiss);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);

    return () => {
      document.removeEventListener("mousedown", dismiss);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open, updatePosition]);

  // The list scrolls, so the option the arrows are on is brought into view rather than left below.
  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector(`#${CSS.escape(`${listboxId}-option-${activeIndex}`)}`)?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, listboxId, open]);

  function select(option) {
    if (option.disabled) return;
    setOpen(false);
    setSearch("");
    onChange?.(option.value, option);
    (inputRef.current || triggerRef.current)?.focus();
  }

  function openMenu() {
    if (inert) return;
    if (!open) {
      setSearch("");
      // Opens on whatever is already chosen, so the arrows carry on from there rather than the top.
      setActiveIndex(Math.max(0, normalizedOptions.findIndex((option) => option.value === value)));
      setOpen(true);
    }
  }

  /*
   * What has been typed at the list in the last moment, and the timer that forgets it.
   *
   * A ref rather than state: nothing on screen is drawn from it, and it has to be read and written
   * inside one keypress without waiting for a render.
   *
   * The pause is measured by a timer that clears the buffer rather than by comparing clocks on each
   * press. Both say the same thing, and this one says it without reading the time during a render
   * the compiler has to treat as pure.
   */
  const typeaheadRef = useRef({ text: "", timer: 0 });

  // A list unmounted mid-word leaves no timer running behind it.
  useEffect(() => () => clearTimeout(typeaheadRef.current.timer), []);

  /**
   * Typing a letter goes to the option that starts with it — `y` for Yes, `st` for Studio.
   *
   * The list already answered the arrows, Enter and Home/End, which is enough to *operate* it but
   * not enough to use one comfortably: a shoot type list is a dozen entries, and arrowing to the
   * right one is a dozen presses for something the person can already name.
   *
   * Which option a run of characters points at is `typeaheadIndex` in `lib/dropdownOptions.mjs` —
   * a decision about a list and nothing else, so it is kept where it can be read and tested on its
   * own. What is here is the part that needs a component: when a run begins and when it ends.
   *
   * It moves the highlight and never the answer, even while the list is closed — exactly what
   * ArrowDown already does here. A key that changed a saved value without the list having been
   * seen would be a different and far more dangerous control.
   */
  function typeahead(character) {
    const held = typeaheadRef.current;
    // Whatever is still in the buffer plus this key. The buffer empties itself after the pause, so
    // a letter arriving late is simply the first letter of a new search.
    const text = held.text + character;
    clearTimeout(held.timer);
    held.text = text;
    held.timer = setTimeout(() => { typeaheadRef.current.text = ""; }, TYPEAHEAD_WINDOW_MS);

    const index = typeaheadIndex(visibleOptions, text, activeIndex);
    // Nothing starts with it: the highlight stays where it is rather than jumping to the top, so a
    // mistyped letter costs nothing.
    if (index !== -1) setActiveIndex(index);
  }

  /** Skips past anything disabled, and stops at the ends rather than wrapping around. */
  function moveActive(step) {
    setActiveIndex((current) => {
      let next = current + step;
      while (next >= 0 && next < visibleOptions.length && visibleOptions[next].disabled) next += step;
      return next >= 0 && next < visibleOptions.length ? next : current;
    });
  }

  /**
   * The arrows walk the list and Enter takes what they land on, so a search can be finished without
   * reaching for the mouse. Enter is swallowed while the menu is open — in a form it would otherwise
   * submit rather than choose.
   */
  function handleKeyDown(event) {
    if (inert) return;

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        openMenu();
        return;
      }
      moveActive(event.key === "ArrowDown" ? 1 : -1);
      return;
    }

    if (event.key === "Enter") {
      if (!open) return;
      event.preventDefault();
      const option = visibleOptions[activeIndex];
      if (option) select(option);
      return;
    }

    if (event.key === "Home" || event.key === "End") {
      if (!open) return;
      event.preventDefault();
      setActiveIndex(event.key === "Home" ? 0 : visibleOptions.length - 1);
      return;
    }

    if (event.key === "Tab" && open) setOpen(false);

    /*
     * Anything else that is a single printable character is a search; see `typeahead`.
     *
     * Last, so every key with a meaning of its own has already been answered and returned. Three
     * things are deliberately not treated as typing:
     *
     *   - **A chord.** Ctrl, Meta or Alt held makes it a shortcut — the browser's or the operating
     *     system's — and swallowing those would take ⌘F off the page.
     *   - **Space.** On the trigger it is the button's own press, which is what opens the list, and
     *     a leading space is not something anybody means to search for.
     *   - **A key typed into a text box.** A searchable dropdown shares this handler with its own
     *     input, where the character belongs to the search text and already filters the list.
     */
    const target = event.target;
    const intoATextBox = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
    if (event.key.length !== 1 || event.key === " " || event.ctrlKey || event.metaKey || event.altKey || intoATextBox) return;
    event.preventDefault();
    if (!open) openMenu();
    typeahead(event.key);
  }

  const optionId = (index) => `${listboxId}-option-${index}`;

  // A closed dropdown that cannot be opened reads as inert from its grey fill alone. The ⊘ cursor is
  // the browser refusing an action, which is the wrong answer for a field being read rather than
  // withheld — and for the disabled-until-answered case the placeholder says what is missing, which
  // is more use than a cursor. The options inside an open menu keep it: there, one really is refused.
  // Left with the chevron gone, the value sits against one edge with the space the arrow used to
  // fill left open beside it, which reads as a field cut short. Centred, the box is the value's own.
  const readOnlyAlignment = readOnly ? "justify-center text-center" : "justify-between text-left";
  const triggerClassName = isInput
    ? `mt-1.5 flex min-h-9 w-full items-center ${readOnlyAlignment} rounded-lg border bg-white px-3 text-xs font-normal text-slate-700 outline-none transition sm:text-sm focus:ring-2 disabled:cursor-default disabled:bg-slate-50 ${error ? "border-red-400 hover:border-red-500 focus:border-red-500 focus:ring-red-100" : "border-slate-300 hover:border-slate-400 focus:border-blue-500 focus:ring-blue-100"}`
    /*
     * A switch is the width of its longest option — no more, and never less.
     *
     * Three things have to hold at once and only this sizing gets all three. The control must not
     * *resize* as you move between "All" and "Employee Attendance". The menu, which is measured
     * from the trigger, must not come out wider than the control it hangs from. And there must be
     * no spare width behind the chevron: a 160px box holding a 125px label put the menu's right
     * edge a finger's width past the arrow, which is what reads as the list not lining up with the
     * thing that opened it.
     *
     * A fixed `min-w-40` floor gave the first two and cost the third. The width instead comes from
     * the options themselves — every label is laid in one grid cell below, all but the chosen one
     * invisible — so the box is exactly as wide as the longest thing that can ever sit in it. It
     * cannot resize, it cannot be narrower than the menu needs, and it has nothing spare in it.
     *
     * `w-full` keeps the button filling the wrapper that sizing produces; `justify-start` keeps the
     * label and its arrow together as one control, where `justify-between` threw the arrow against
     * the far edge and the pair stopped reading as one thing. No `gap`: the glyph carries its own
     * inset, so a gap on top of it is the space the arrow was being pushed away by.
     */
    : `flex min-h-9 w-full items-center rounded-lg bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 sm:text-sm disabled:cursor-default disabled:opacity-60 ${readOnly ? "justify-center" : "justify-start"}`;

  /*
   * What the closed trigger reads, and — in switch mode — what holds its width.
   *
   * Every option's label is stacked into the same grid cell. The chosen one is drawn; the rest are
   * `invisible`, so they take their space without being seen or read out. The cell is therefore the
   * width of the longest option whatever is selected, which is what stops the control resizing and
   * what makes the menu exactly the shape of the control.
   */
  const shownLabel = (selected && triggerLabel) || selected?.label || placeholder;
  const sizerLabels = isInput
    ? []
    : normalizedOptions
      .filter((option) => !option.separator && !option.heading && option.label !== shownLabel)
      .map((option) => option.label);
  const triggerText = (
    <span className={`grid min-w-0 ${isInput ? "" : "text-left"}`}>
      {sizerLabels.map((label, index) => (
        <span key={`sizer-${index}`} aria-hidden="true" className="invisible col-start-1 row-start-1 truncate">{label}</span>
      ))}
      <span className={`col-start-1 row-start-1 truncate ${selected ? "" : "text-slate-500"}`}>{shownLabel}</span>
    </span>
  );

  const standardTrigger = (
    <button
      ref={triggerRef}
      type="button"
      aria-label={ariaLabel || label}
      aria-expanded={open}
      aria-haspopup="listbox"
      aria-controls={open ? listboxId : undefined}
      disabled={inert}
      onClick={() => { if (open) setOpen(false); else openMenu(); }}
      onKeyDown={handleKeyDown}
      className={triggerClassName}
    >
      {triggerText}
      {!readOnly && <ChevronIcon size={isInput ? 20 : 24} className="-mr-1 shrink-0 text-slate-500" />}
    </button>
  );

  const searchableTrigger = (
    <div
      ref={triggerRef}
      /*
       * The same red the standard trigger turns, and it was missing here.
       *
       * `triggerClassName` above carries the error colours, and a searchable dropdown does not use
       * it - this trigger is a wrapper around a text input rather than a button, so it has its own
       * classes and had the border hard-coded to `border-slate-300`. A refused searchable field
       * therefore printed its message underneath and left the box looking untouched, which on a form
       * that marks everything else in red reads as the field being fine.
       *
       * `focus-within` rather than `focus`, unlike the standard trigger: the focus lands on the
       * input inside this wrapper, not on the wrapper itself.
       */
      className={`mt-1.5 flex min-h-9 w-full items-center rounded-lg border bg-white text-slate-700 transition focus-within:ring-2 ${error ? "border-red-400 hover:border-red-500 focus-within:border-red-500 focus-within:ring-red-100" : "border-slate-300 hover:border-slate-400 focus-within:border-blue-500 focus-within:ring-blue-100"} ${inert ? "cursor-default bg-slate-50" : ""}`}
    >
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-label={ariaLabel || label}
        aria-controls={listboxId}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-autocomplete="list"
        aria-activedescendant={open && visibleOptions[activeIndex] ? optionId(activeIndex) : undefined}
        autoComplete="off"
        disabled={inert}
        value={open ? search : ((selected && triggerLabel) || selected?.label || "")}
        placeholder={placeholder}
        onClick={openMenu}
        onFocus={openMenu}
        onKeyDown={handleKeyDown}
        onChange={(event) => {
          setSearch(event.target.value);
          // Every keystroke narrows the list, so the arrows start again from the top of what is left.
          setActiveIndex(0);
          setOpen(true);
        }}
        className={`min-h-9 min-w-0 flex-1 rounded-lg bg-transparent px-3 text-xs font-normal text-black placeholder:text-slate-500 outline-none sm:text-sm disabled:cursor-default ${readOnly ? "text-center" : ""}`}
      />
      {!readOnly && <button
        type="button"
        tabIndex={-1}
        aria-label={`Toggle ${ariaLabel || label || "options"}`}
        disabled={disabled}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          if (open) {
            setOpen(false);
            setSearch("");
          } else {
            openMenu();
            inputRef.current?.focus();
          }
        }}
        className="flex min-h-9 shrink-0 items-center px-3 text-slate-500"
      >
        <ChevronIcon size={20} />
      </button>}
    </div>
  );

  const trigger = searchable && isInput ? searchableTrigger : standardTrigger;

  const menu =
    open && position
      ? createPortal(
          <div
            ref={menuRef}
            id={listboxId}
            role="listbox"
            aria-label={ariaLabel || label}
            // The height comes from `position.maxHeight`, measured against the room the trigger
            // actually has. A `max-h-*` class here as well would win or lose by stylesheet order.
            className={`fixed ${menuZIndexClassName} overflow-y-auto rounded-md border border-slate-200 bg-white py-1 text-xs shadow-lg sm:text-sm`}
            style={position}
          >
            {visibleOptions.length === 0 ? (
              <p className="px-3 py-2 text-slate-500">No options available.</p>
            ) : (
              visibleOptions.map((option, index) => option.separator ? (
                // A rule between groups. Marked `disabled` upstream as well, so the arrow keys step
                // over it and it can never be the active option.
                <div key={`separator-${index}`} role="presentation" className="my-1 border-t border-slate-200" />
              ) : option.heading ? (
                <p key={`heading-${index}`} role="presentation" className="px-3 pb-1 pt-1.5 text-[11px] font-semibold text-slate-500">{option.heading}</p>
              ) : (
                <button
                  /*
                   * The position as well as the value.
                   *
                   * Two options sharing a value is a caller's mistake, but React's answer to a
                   * repeated key is to warn and then render one of them or the other - so the list
                   * quietly loses an entry, which is a worse way to find out than a console line.
                   * The separators and headings beside this are already keyed by position for the
                   * same reason; a menu is a static list, so nothing is reordered by it.
                   */
                  key={`${option.value}-${index}`}
                  id={optionId(index)}
                  type="button"
                  role="option"
                  aria-selected={option.value === value}
                  disabled={option.disabled}
                  // Pressed with the mouse, the focus must stay in the search box for the keys to keep working.
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => select(option)}
                  // The clear row is an option like any other to the keys and the mouse, and reads
                  // as the quieter answer it is - it withdraws one rather than giving one.
                  className={`block w-full px-3 py-2 text-left disabled:cursor-not-allowed disabled:text-slate-400 ${option.value === value ? "bg-blue-50 font-medium text-blue-700" : index === activeIndex ? "bg-slate-100 text-slate-900" : option.clear ? "text-slate-500" : "text-slate-700"}`}
                >
                  {option.label}
                </button>
              ))
            )}
          </div>,
          document.body,
        )
      : null;

  if (isInput) {
    return (
      <div className={`block text-[11px] font-semibold text-slate-600 sm:text-xs ${className}`}>
        <span>
          {label}
          {/* The same mark TextField draws, so a required dropdown does not read as optional
              next to a required text field. */}
          {required && <span aria-hidden="true" className="ml-0.5 text-rose-500">*</span>}
        </span>
        {trigger}
        {menu}
        {error && <p role="alert" className="mt-1.5 font-normal text-red-600">{error}</p>}
      </div>
    );
  }

  return (
    // Sized by its trigger, which is sized by its longest option - and capped at the room it has, so
    // a switch whose options are long still fits a 360px header rather than pushing it sideways.
    <div className={`inline-flex min-w-0 max-w-full ${className}`}>
      {trigger}
      {menu}
    </div>
  );
}
