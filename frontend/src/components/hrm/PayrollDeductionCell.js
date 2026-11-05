"use client";

import Button from "@/components/shared/Button";

/**
 * A Main Page money cell a month may leave out - Salary Advance, Recovery Deduction: the amount, and
 * beside it **Skip** while it holds one and the month may still change, or - once skipped - a
 * **Skipped** tag (shown to every reader, `skippedNote` saying where the money went on hover and to a
 * screen reader) and **Undo**. `canSkip` is the caller's permission and the row's state together: a
 * paid month offers neither.
 *
 * The buttons are compact in the table and a full touch target below `md`, and swallow a double
 * click, so pressing one twice never also opens the row's form.
 *
 * The tag is drawn in the shades every theme repaints (`globals.css`): `bg-amber-50` becomes the dark
 * themes' warning tint and `text-amber-800` its ink, so it reads as a warning on any background -
 * where `bg-amber-100`, which no theme repaints, stayed a pale light-theme pill on a dark page.
 *
 * Both take the cell's own text size rather than one of their own, so they read at the table's size
 * whatever its density: `Button` brings `text-xs sm:text-sm`, a step above a table cell, hence the
 * override.
 */
const ACTION = "rounded px-1.5 py-0.5 !text-[length:inherit] font-medium text-blue-700 max-md:min-h-10 max-md:px-3";

export default function PayrollDeductionCell({ amount, hasAmount = false, skipped = false, skippedNote = "", canSkip = false, label, onSkip, onUndo }) {
  const quiet = (event) => event.stopPropagation();
  return <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
    <span>{amount}</span>
    {skipped && <span className="rounded-full bg-amber-50 px-2 py-0.5 font-medium text-amber-800" title={skippedNote || undefined} aria-label={skippedNote || undefined}>Skipped</span>}
    {canSkip && hasAmount && <Button type="button" variant="ghost" size="none" className={ACTION} aria-label={`Skip ${label}`} onClick={onSkip} onDoubleClick={quiet}>Skip</Button>}
    {canSkip && skipped && <Button type="button" variant="ghost" size="none" className={ACTION} aria-label={`Undo the skip of ${label}`} onClick={onUndo} onDoubleClick={quiet}>Undo</Button>}
  </span>;
}
