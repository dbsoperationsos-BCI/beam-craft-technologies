import HelpTip from "./HelpTip";
import { useId } from "react";

/**
 * `suggestions` offers values already used elsewhere without closing the field to new ones, which is
 * what a free-text field backed by past entries wants — the studio account a receipt was paid into,
 * say. A dropdown would refuse anything new and an empty one would offer nothing at all on the first
 * entry; this stays a text box that happens to know what has been typed before.
 */
/*
 * A field with no `label` is one whose label belongs to the group it sits in - a list of the same
 * box repeated, where naming every row would say the same word three times (`RepeatableTextField`).
 * The label's own line and the gap under it are then not drawn at all, so the box sits where the
 * group put it, and the row is named for a screen reader with an `aria-label` instead. Every field
 * that names itself is unchanged.
 */
/*
 * `note` is a remark about the answer rather than a fault in it - amber, under the box, in the slot
 * `error` uses. The two never show together: a field that is wrong is told so first, since a remark
 * about a value that has not been accepted yet is a remark about nothing. Destructured rather than
 * left in `props`, or it would reach the `<input>` as an attribute the browser does not know.
 */
/*
 * `prefix` and `suffix` are a unit drawn inside the box - the ₹ before rupees, the % after a
 * percentage - so the value itself stays a plain number. They are not read out (the field's label
 * says what it is) and cannot be clicked, so a click on one lands in the box. A number field with
 * one loses the browser's up/down arrows, which would sit on top of the unit. A field with neither
 * is drawn exactly as it always was.
 */
export default function TextField({ label, required = false, error = "", note = "", helperText = "", className = "", inputClassName = "", suggestions, prefix, suffix, ...props }) {
  const listId = useId();
  const hasSuggestions = Array.isArray(suggestions) && suggestions.length > 0;
  // A value the form only shows sits on grey with dimmed text, so it reads as something to look at
  // rather than a box waiting to be filled in.
  const tone = props.readOnly ? "bg-slate-100 text-slate-600 cursor-default" : "bg-white text-slate-700";
  const adorned = Boolean(prefix || suffix);
  // Spanning the input itself - below a label's gap, to its bottom - and centred in it, so a unit or
  // an icon sits in the middle of the box whatever height a caller gives the box.
  const adornment = `pointer-events-none absolute bottom-0 ${label ? "top-1.5" : "top-0"} flex items-center text-xs font-normal text-slate-500 sm:text-sm`;
  const input = <input {...props} list={hasSuggestions ? listId : undefined} aria-invalid={error ? true : undefined} className={`${label ? "mt-1.5" : ""} block min-h-9 w-full rounded-lg border px-3 text-xs font-normal outline-none transition sm:text-sm focus:ring-2 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500 ${tone} ${error ? "border-red-400 focus:border-red-500 focus:ring-red-100" : "border-slate-300 focus:border-blue-500 focus:ring-blue-100"} ${prefix ? "!pl-6" : ""} ${suffix ? "!pr-6" : ""} ${adorned ? "[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" : ""} ${inputClassName}`} />;
  return <label className={`block text-[11px] font-semibold text-slate-600 sm:text-xs ${className}`}>{label ? <span>{label}{required && <span aria-hidden="true" className="ml-0.5 text-rose-500">*</span>}<HelpTip text={helperText} /></span> : null}{adorned ? <span className="relative block">{prefix && <span aria-hidden="true" className={`${adornment} left-2.5`}>{prefix}</span>}{input}{suffix && <span aria-hidden="true" className={`${adornment} right-2.5`}>{suffix}</span>}</span> : input}{hasSuggestions && <datalist id={listId}>{suggestions.map((suggestion) => <option key={suggestion} value={suggestion} />)}</datalist>}{error && <p role="alert" className="mt-1.5 font-normal text-red-600">{error}</p>}{!error && note && <p className="mt-1.5 font-normal text-amber-700">{note}</p>}</label>;
}
