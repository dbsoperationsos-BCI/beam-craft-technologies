import HelpTip from "./HelpTip";
/**
 * One checkbox or radio with its label beside it.
 *
 * `error` is the tick that had to be given and was not - a consent, a confirmation, an agreement.
 * The box itself reddens rather than only the words, because a refusal that marks the label alone
 * reads as a note about the option rather than as the thing being asked for again.
 *
 * Only the errored state moves the tick to the top of the row. Every option in the app without one
 * is centred, as it has always been, and a one-line label centred against a two-line block is the
 * kind of drift a shared component should not introduce on behalf of a state most callers never
 * reach.
 */
export default function SelectableOption({ checked, className = "", disabled = false, error = "", helperText = "", label, name, onCheckedChange, type = "checkbox", value }) {
  return <label className={`flex gap-2 text-sm font-normal ${error ? "items-start text-red-600" : "items-center text-slate-700"} ${disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"} ${className}`}><input type={type} name={name} value={value} checked={checked} disabled={disabled} aria-invalid={error ? true : undefined} onChange={(event) => onCheckedChange?.(event.target.checked, event)} className={`h-4 w-4 shrink-0 accent-blue-600 ${error ? "mt-0.5 outline outline-1 outline-offset-1 outline-red-400" : ""}`} /><span>{label}<HelpTip text={helperText} />{error && <span role="alert" className="mt-0.5 block text-xs text-red-600">{error}</span>}</span></label>;
}
