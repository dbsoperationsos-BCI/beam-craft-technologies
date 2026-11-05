/**
 * A time, with the same refusal every other field in the app shows.
 *
 * `error` reddens the border and says what is wrong under the box, the way `TextField` and
 * `DateField` do. Without it a required time refused on submit looked exactly like one that had
 * been answered - the asterisk was the only mark it ever carried, and an asterisk is there before
 * anybody gets it wrong.
 */
export default function TimeField({ label, required = false, error = "", className = "", inputClassName = "", ...props }) {
  return <label className={`block text-xs font-semibold text-slate-600 ${className}`}><span>{label}{required && <span aria-hidden="true" className="ml-0.5 text-rose-500">*</span>}</span><input type="time" {...props} aria-invalid={error ? true : undefined} className={`mt-1.5 block min-h-9 w-full rounded-lg border bg-white px-3 text-sm font-normal text-slate-700 outline-none transition focus:ring-2 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500 ${error ? "border-red-400 focus:border-red-500 focus:ring-red-100" : "border-slate-300 focus:border-blue-500 focus:ring-blue-100"} ${inputClassName}`} />{error && <p role="alert" className="mt-1.5 font-normal text-red-600">{error}</p>}</label>;
}
