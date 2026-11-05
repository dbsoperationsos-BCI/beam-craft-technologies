import HelpTip from "./HelpTip";
/*
 * The two sizes a switch comes in.
 *
 * `md` is the switch every settings row and every standalone toggle uses. `sm` is for one sitting
 * in a line of form fields, where the full-size track reads as the loudest thing on the row and
 * pulls the eye away from the answers beside it - the Yes/No pair a date field hangs off.
 *
 * The knob travels the track's width less its own width and the two 2px insets, so the numbers in
 * each row have to move together: 36 - 16 - 4 and 32 - 12 - 4 both come to the 16px `translate-x-4`
 * that lands the knob flush against the far edge when it is on.
 */
const sizes = {
  md: "h-5 w-9 after:h-4 after:w-4 peer-checked:after:translate-x-4",
  sm: "h-4 w-8 after:h-3 after:w-3 peer-checked:after:translate-x-4",
};

// The label is `relative` so the visually hidden checkbox inside it is contained by the label.
// `sr-only` positions that checkbox absolutely, and with no positioned ancestor its containing
// block was the app shell: a switch far down a scrolling pane then sat far down the *shell's*
// layout, gave the shell scrollable overflow, and pressing it - which focuses the checkbox -
// scrolled the whole shell to bring the box into view, dragging the header off the screen. Kept
// inside the label, the box is where the switch is, and the pane it sits in is what scrolls.
//
// `title` so a switch that is off-limits can say why on hover, which is the only place there is
// room to say it.
//
// `error` is for the switch that had to be turned on and was not - an agreement, a confirmation.
// A ring around the track rather than a colour on it: the track's colour is the answer itself, and
// reddening it would say "off" and "wrong" in the same mark with no way to tell which is which.
//
// `mixed` is the third state of a switch that stands for a group - some of the group on, some off.
// The box is `indeterminate` (a screen reader says "mixed"), the knob rests halfway and the track
// is pale blue; a press means "all on", as it does for any group checkbox.
export default function ToggleSwitch({ ariaLabel, checked, className = "", disabled = false, error = "", helperText = "", label, mixed = false, onCheckedChange, size = "md", title }) {
  const setIndeterminate = (input) => { if (input) input.indeterminate = Boolean(mixed); };
  const mixedClass = mixed ? "!bg-blue-300 after:translate-x-2" : "";
  return <label title={title} className={`relative inline-flex gap-2 text-sm ${error ? "items-start text-red-600" : "items-center text-slate-700"} ${disabled ? "cursor-restricted opacity-60" : "cursor-pointer"} ${className}`}><input ref={setIndeterminate} type="checkbox" aria-label={ariaLabel} checked={mixed ? false : checked} disabled={disabled} aria-invalid={error ? true : undefined} onChange={(event) => onCheckedChange?.(mixed ? true : event.target.checked, event)} className="peer sr-only" /><span aria-hidden="true" className={`toggle-track relative shrink-0 rounded-full bg-slate-300 transition-colors after:absolute after:left-0.5 after:top-0.5 after:rounded-full after:bg-white after:shadow-sm after:transition-transform peer-checked:bg-blue-600 peer-focus-visible:ring-2 peer-focus-visible:ring-blue-500 peer-focus-visible:ring-offset-2 ${error ? "mt-0.5 ring-2 ring-red-400 ring-offset-1" : ""} ${sizes[size] || sizes.md} ${mixedClass}`} />{label && <span>{label}<HelpTip text={helperText} />{error && <span role="alert" className="mt-0.5 block text-xs text-red-600">{error}</span>}</span>}</label>;
}
