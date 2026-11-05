"use client";

import HelpTip from "./HelpTip";
import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";
import useCloseWhenTriggerHidden from "./useCloseWhenTriggerHidden";
import useEscapeKey from "@/components/shared/useEscapeKey";
import EmployeeAvatar from "@/components/shared/EmployeeAvatar";
import { matchesWordChunks } from "@/lib/wordChunks.mjs";

/**
 * The module's multi-email input: each address becomes a chip inside the field, with its own
 * × to take it off again.
 *
 * A plain comma-separated text box hides its own mistakes - one missing comma silently sends
 * two addresses as one, and nothing tells you until the invite fails. Committing each entry
 * to a chip makes the list you are about to send visible, and lets a wrong one be removed
 * without retyping the rest.
 *
 * The field borrows TextField's label, height, radius and focus ring so it lines up with the
 * inputs beside it; the ring moves to the box rather than the inner input, which has no
 * border of its own.
 *
 * **Not only for emails.** Anything typed as a short list of free entries - a vendor's preferred
 * languages - is the same control, so it takes the two things that make it an email field as props:
 * `isValid`, which decides whether an entry may become a chip (and `invalidMessage`, what is said
 * when one may not), and `separators`, what splits a typed or pasted run into entries. Both default
 * to the email behaviour, so every existing caller is unchanged. A list of names passes separators
 * without whitespace, or "Old English" would come out as two chips.
 */

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Anything a person might separate addresses with, including a paste out of a mail client.
const SEPARATORS = /[\s,;]+/;

const isEmail = (entry) => EMAIL_PATTERN.test(entry);
const notAnEmail = (rejected) => `${rejected.join(", ")} is not a valid email address.`;

export default function EmailChipsField({
  className = "",
  disabled = false,
  label,
  helperText = "",
  onChange,
  options = [],
  optionsLabel = "Suggestions",
  placeholder = "name@example.com",
  required = false,
  values = [],
  isValid = isEmail,
  invalidMessage = notAnEmail,
  separators = SEPARATORS,
  // The form's own problem with the field ("Add at least one attendee."); an address typed wrong
  // says so itself and is shown first.
  error: formError = "",
}) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const shownError = error || formError;
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState(null);
  const inputRef = useRef(null);
  const wrapperRef = useRef(null);
  const menuRef = useRef(null);
  // Portalled, so scrolling the pane moves the field but not the popover; closing is
  // the honest answer, and reopening is one click.
  useCloseWhenTriggerHidden(open, wrapperRef, () => setOpen(false));

  // Someone already invited is dropped from the list rather than shown and refused.
  const search = draft.trim().toLowerCase();
  const suggestions = options
    .filter((option) => !values.includes(option.value))
    .filter((option) => matchesWordChunks(`${option.label} ${option.value || ""}`, search));

  // Closes the suggestions and nothing else - not the form they are being typed into.
  useEscapeKey(() => setOpen(false), open);

  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => {
      if (wrapperRef.current?.contains(event.target)) return;
      if (menuRef.current?.contains(event.target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => {
      document.removeEventListener("mousedown", close);
    };
  }, [open]);

  // Read each frame while open: the field grows as chips are added, and the dialog around it
  // moves with them.
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
          width: rect.width,
          top: openAbove ? "auto" : rect.bottom + 4,
          bottom: openAbove ? window.innerHeight - rect.top + 4 : "auto",
          maxHeight: Math.max(160, Math.min(260, openAbove ? above : below)),
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

  /**
   * Turns whatever has been typed or pasted into chips.
   *
   * Valid addresses are always taken, even when the same entry also contains a bad one, so
   * pasting a list of ten with one typo keeps the nine. Only the part that failed stays
   * behind in the box to be corrected.
   */
  function commit(text) {
    const candidates = String(text || "").split(separators).map((item) => item.trim()).filter(Boolean);
    if (!candidates.length) return true;

    const accepted = [];
    const rejected = [];
    for (const candidate of candidates) {
      if (!isValid(candidate)) rejected.push(candidate);
      else if (!values.includes(candidate) && !accepted.includes(candidate)) accepted.push(candidate);
    }

    if (accepted.length) onChange?.([...values, ...accepted]);
    setDraft(rejected.join(" "));
    setError(rejected.length ? invalidMessage(rejected) : "");
    return rejected.length === 0;
  }

  function handleKeyDown(event) {
    if (event.key === "Enter" || event.key === "," || event.key === ";" || event.key === "Tab") {
      // Tab still moves on when there is nothing to commit, so the field does not trap focus.
      if (!draft.trim() && event.key === "Tab") return;
      event.preventDefault();
      commit(draft);
      return;
    }
    // Backspace on an empty box takes the last chip off, the usual behaviour for this kind
    // of field and quicker than reaching for its ×.
    if (event.key === "Backspace" && !draft && values.length) {
      onChange?.(values.slice(0, -1));
    }
  }

  function addOption(option) {
    if (!values.includes(option.value)) onChange?.([...values, option.value]);
    setDraft("");
    setError("");
    setOpen(false);
    inputRef.current?.focus();
  }

  function removeAt(index) {
    onChange?.(values.filter((item, position) => position !== index));
    inputRef.current?.focus();
  }

  return (
    <div className={`block text-xs font-semibold text-slate-600 ${className}`}>
      <span>{label}{required && <span aria-hidden="true" className="ml-0.5 text-rose-500">*</span>}<HelpTip text={helperText} /></span>
      {/* Clicking anywhere in the box focuses the input, so the whole control behaves like
          the single-line fields it sits beside.

          The box is capped and scrolls its own chips rather than growing. Left to grow it
          pushed the row it sits in taller with every address added, which shifted the fields
          beside it and stretched the dialog - the field has to stay the size of its
          neighbours however many guests are on it. */}
      <div
        ref={wrapperRef}
        onClick={() => inputRef.current?.focus()}
        className={`mt-1.5 flex max-h-[4.5rem] min-h-9 w-full flex-wrap items-center gap-1.5 overflow-y-auto rounded-lg border bg-white px-2 py-1 transition focus-within:ring-2 ${
          shownError ? "border-rose-400 focus-within:border-rose-500 focus-within:ring-rose-100" : "border-slate-300 focus-within:border-blue-500 focus-within:ring-blue-100"
        } ${disabled ? "cursor-not-allowed bg-slate-50" : ""}`}
      >
        {values.map((email, index) => {
          // An address that belongs to an employee wears their face; one typed in for anybody else stays a plain chip.
          const avatar = options.find((option) => option.value === email)?.avatar;
          return (
          <span key={email} className={`inline-flex max-w-full items-center gap-1 rounded-full border border-blue-200 bg-blue-50 py-0.5 ${avatar ? "pl-0.5" : "pl-2"} pr-1 text-xs font-medium text-blue-700`}>
            {avatar && <EmployeeAvatar {...avatar} size="2xs" decorative />}
            <span className="truncate">{email}</span>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                removeAt(index);
              }}
              disabled={disabled}
              aria-label={`Remove ${email}`}
              className="inline-flex h-4 w-4 shrink-0 items-center justify-center text-sm leading-none text-blue-600 transition hover:text-blue-900 disabled:cursor-not-allowed"
            >
              ×
            </button>
          </span>
          );
        })}
        <input
          ref={inputRef}
          type="text"
          aria-invalid={shownError ? true : undefined}
          value={draft}
          disabled={disabled}
          // Committed on blur too: a list typed but never confirmed with Enter would
          // otherwise be dropped the moment the user moved on to press Schedule.
          onBlur={() => commit(draft)}
          onChange={(event) => {
            setDraft(event.target.value);
            if (error) setError("");
            if (options.length) setOpen(true);
          }}
          onFocus={() => options.length && setOpen(true)}
          onKeyDown={handleKeyDown}
          onPaste={(event) => {
            const pasted = event.clipboardData?.getData("text") || "";
            if (!separators.test(pasted)) return;
            event.preventDefault();
            commit(pasted);
          }}
          placeholder={values.length ? "" : placeholder}
          aria-label={label}
          className="min-w-[7rem] flex-1 border-0 bg-transparent px-1 py-0.5 text-sm font-normal text-slate-700 outline-none placeholder:text-slate-400 disabled:cursor-not-allowed"
        />
        {/* Opens the whole list without typing, for picking a colleague by name rather than
            by remembering their address. */}
        {options.length > 0 && !disabled && (
          <button
            type="button"
            tabIndex={-1}
            aria-label={optionsLabel}
            aria-expanded={open}
            onClick={(event) => {
              event.stopPropagation();
              setOpen((current) => !current);
            }}
            className="ml-auto shrink-0 self-center px-1 text-slate-400 transition hover:text-slate-700"
          >
            <span aria-hidden="true" className={`block text-xs transition-transform ${open ? "rotate-180" : ""}`}>▾</span>
          </button>
        )}
      </div>
      {shownError && <p role="alert" className="mt-1 text-xs font-normal text-rose-600">{shownError}</p>}

      {open && menuStyle && typeof document !== "undefined" && createPortal(
        <div
          ref={menuRef}
          role="listbox"
          aria-label={optionsLabel}
          style={menuStyle}
          className="z-[9999] overflow-y-auto overscroll-contain rounded-lg border border-slate-200 bg-white py-1 text-sm shadow-[0_12px_28px_rgba(15,23,42,0.16)]"
        >
          {suggestions.length === 0 ? (
            <p className="px-3 py-2 font-normal text-slate-500">
              {options.length ? "No matching employee. Type an email address to add anyone else." : "No employees found."}
            </p>
          ) : suggestions.map((option) => (
            <button
              key={option.value || option.label}
              type="button"
              role="option"
              aria-selected="false"
              // An employee with no address on file is listed but cannot be picked - hiding
              // them would read as the person being missing from the repository.
              disabled={!option.value}
              onClick={() => addOption(option)}
              className={`${option.avatar ? "flex items-center gap-2" : "block"} w-full px-3 py-2 text-left font-normal transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60`}
            >
              {option.avatar && <EmployeeAvatar {...option.avatar} size="sm" decorative />}
              <span className="block min-w-0">
                <span className="block truncate text-slate-700">{option.label}</span>
                <span className="block truncate text-xs text-slate-400">{option.value || "No email on file"}</span>
              </span>
            </button>
          ))}
        </div>,
        document.body)}
    </div>
  );
}
