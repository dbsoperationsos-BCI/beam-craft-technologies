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

// `title` so a switch that is off-limits can say why on hover, which is the only place there is
// room to say it.
//
// `error` is for the switch that had to be turned on and was not - an agreement, a confirmation.
// A ring around the track rather than a colour on it: the track's colour is the answer itself, and
// reddening it would say "off" and "wrong" in the same mark with no way to tell which is which.
export default function ToggleSwitch({ ariaLabel, checked, className = "", disabled = false, error = "", label, onCheckedChange, size = "md", title }) {
  return <label title={title} className={`inline-flex gap-2 text-sm ${error ? "items-start text-red-600" : "items-center text-slate-700"} ${disabled ? "cursor-restricted opacity-60" : "cursor-pointer"} ${className}`}><input type="checkbox" aria-label={ariaLabel} checked={checked} disabled={disabled} aria-invalid={error ? true : undefined} onChange={(event) => onCheckedChange?.(event.target.checked, event)} className="peer sr-only" /><span aria-hidden="true" className={`toggle-track relative shrink-0 rounded-full bg-slate-300 transition-colors after:absolute after:left-0.5 after:top-0.5 after:rounded-full after:bg-white after:shadow-sm after:transition-transform peer-checked:bg-blue-600 peer-focus-visible:ring-2 peer-focus-visible:ring-blue-500 peer-focus-visible:ring-offset-2 ${error ? "mt-0.5 ring-2 ring-red-400 ring-offset-1" : ""} ${sizes[size] || sizes.md}`} />{label && <span>{label}{error && <span role="alert" className="mt-0.5 block text-xs text-red-600">{error}</span>}</span>}</label>;
}
