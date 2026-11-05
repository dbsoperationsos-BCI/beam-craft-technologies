import { useId } from "react";

/**
 * `suggestions` offers values already used elsewhere without closing the field to new ones, which is
 * what a free-text field backed by past entries wants — the studio account a receipt was paid into,
 * say. A dropdown would refuse anything new and an empty one would offer nothing at all on the first
 * entry; this stays a text box that happens to know what has been typed before.
 */
/*
 * `note` is a remark about the answer rather than a fault in it - amber, under the box, in the slot
 * `error` uses. The two never show together: a field that is wrong is told so first, since a remark
 * about a value that has not been accepted yet is a remark about nothing. Destructured rather than
 * left in `props`, or it would reach the `<input>` as an attribute the browser does not know.
 */
export default function TextField({ label, required = false, error = "", note = "", className = "", inputClassName = "", suggestions, ...props }) {
  const listId = useId();
  const hasSuggestions = Array.isArray(suggestions) && suggestions.length > 0;
  // A value the form only shows sits on grey with dimmed text, so it reads as something to look at
  // rather than a box waiting to be filled in.
  const tone = props.readOnly ? "bg-slate-100 text-slate-600 cursor-default" : "bg-white text-slate-700";
  return <label className={`block text-[11px] font-semibold text-slate-600 sm:text-xs ${className}`}><span>{label}{required && <span aria-hidden="true" className="ml-0.5 text-rose-500">*</span>}</span><input {...props} list={hasSuggestions ? listId : undefined} aria-invalid={error ? true : undefined} className={`mt-1.5 block min-h-9 w-full rounded-lg border px-3 text-xs font-normal outline-none transition sm:text-sm focus:ring-2 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500 ${tone} ${error ? "border-red-400 focus:border-red-500 focus:ring-red-100" : "border-slate-300 focus:border-blue-500 focus:ring-blue-100"} ${inputClassName}`} />{hasSuggestions && <datalist id={listId}>{suggestions.map((suggestion) => <option key={suggestion} value={suggestion} />)}</datalist>}{error && <p role="alert" className="mt-1.5 font-normal text-red-600">{error}</p>}{!error && note && <p className="mt-1.5 font-normal text-amber-700">{note}</p>}</label>;
}
