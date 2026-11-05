"use client";

import { useRef } from "react";
import CloseIcon from "@/components/ui/CloseIcon";
import SearchIcon from "@/components/ui/SearchIcon";
import IconButton from "@/components/shared/IconButton";
import TextField from "@/components/shared/TextField";

/**
 * A search box with its own clear button: `TextField type="search"`, with the browser's cancel
 * glyph hidden and the app's Material close icon in its place, so the × looks the same in every
 * browser and beside every other close in the app. A leading search glyph marks it as a search box
 * at a glance, everywhere this component is used - the page-wide search and a module's own alike.
 *
 * The button is there only while something is typed, and hands the box back its focus once it has
 * emptied it, so clearing a search and typing the next one is one motion. `onChange` receives the
 * text, not the event. `preventSubmit` stops Enter submitting a form the box sits in - a search
 * inside a form panel is looking, not saving.
 */
// `compact`: a shorter box in smaller type - a board column's own search, under its trend line.
export default function SearchField({ value = "", onChange, ariaLabel, placeholder, preventSubmit = false, className = "", label = "", compact = false }) {
  const inputRef = useRef(null);
  const clear = () => {
    onChange("");
    inputRef.current?.focus();
  };

  /*
   * `label` draws a heading over the box in `TextField`'s own label style, for a search that sits
   * in a row of labelled filters: without it the box starts a label's height higher than its
   * neighbours. Drawn here rather than handed to `TextField`, so the icon and the clear button stay
   * centred on the input and not on the label-plus-input block.
   */
  return <div className={className}>
    {label && <span className="block text-[11px] font-semibold text-slate-600 sm:text-xs">{label}</span>}
    <div className={`relative ${label ? "mt-1.5" : ""}`}>
    <SearchIcon className={`pointer-events-none absolute top-1/2 -translate-y-1/2 text-slate-400 ${compact ? "left-2.5 h-3.5 w-3.5" : "left-3 h-4 w-4"}`} />
    <TextField
      ref={inputRef}
      type="search"
      label=""
      aria-label={ariaLabel}
      placeholder={placeholder}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={preventSubmit ? (event) => { if (event.key === "Enter") event.preventDefault(); } : undefined}
      inputClassName={`pr-9 [&::-webkit-search-cancel-button]:appearance-none ${compact ? "!min-h-7 pl-8 !text-xs" : "pl-9"}`}
    />
    {value && <IconButton
      size="xs"
      onClick={clear}
      label="Clear search"
      className="absolute right-1 top-1/2 -translate-y-1/2 text-slate-400 hover:bg-transparent hover:text-slate-700"
    >
      <CloseIcon className="h-4 w-4" />
    </IconButton>}
  </div>
  </div>;
}
