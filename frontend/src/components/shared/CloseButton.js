"use client";

/**
 * The × that closes a dialog, panel or notice.
 *
 * One control rather than a hand-rolled button per dialog, so closing looks and behaves the
 * same everywhere in the OS.
 *
 * A bare glyph, deliberately: no background on hover and no tooltip.
 *
 * Nothing is drawn behind the ×. A tinted circle appearing under the cursor reads as the
 * button being selected rather than merely hovered, whatever the tint - it was blue-grey
 * before and still read wrong when it was neutralised. Hovering darkens the glyph and does
 * nothing else.
 *
 * There is no `title` either. That attribute is what draws the browser's own dark "Close"
 * bar under the cursor, which is noise on a control whose meaning is already obvious. The
 * `aria-label` stays, so a screen reader still announces it - that one renders nothing.
 */

const sizes = {
  sm: "h-8 w-8 text-xl",
  md: "h-9 w-9 text-2xl",
  lg: "h-10 w-10 text-2xl",
};

export default function CloseButton({
  ariaLabel = "Close",
  className = "",
  disabled = false,
  onClick,
  size = "md",
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      /*
       * `focus-visible` rather than `focus`: the ring is there for somebody tabbing, and a × that
       * lit up every time it was clicked would be a change to how the app looks rather than to what
       * it can do. It replaces the browser's own outline, which this was switching off and putting
       * nothing in place of — so the one control on a dialog that is reached by Tab first showed no
       * sign of having been reached.
       */
      className={`inline-flex shrink-0 items-center justify-center rounded leading-none text-slate-600 transition hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200 disabled:cursor-not-allowed disabled:opacity-50 ${sizes[size] || sizes.md} ${className}`}
    >
      ×
    </button>
  );
}
