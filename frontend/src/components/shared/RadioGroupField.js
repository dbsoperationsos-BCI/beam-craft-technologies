import SelectableOption from "./SelectableOption";

/**
 * A set of radio choices on one line.
 *
 * Options are plain strings — where the value and the label are the same word — or
 * `{ value, label }` where they are not, which is what lets a choice be stored as `SALARY_ADVANCE`
 * while reading as "Salary Advance".
 *
 * `controlClassName` is the box around the row; pass `px-0 py-0` for a bare line of choices with no
 * border, which is what a group sitting at the top of a form wants.
 *
 * `layout="column"` stacks the choices one per line instead of wrapping them in a row — for a
 * longer option list (Shoot Type, Branch) that would otherwise wrap unpredictably at narrow widths.
 *
 * `error` is what a required group left unanswered says for itself, the same way `TextField` and
 * `Dropdown` already do — a form that marks its outstanding text boxes and says nothing about the
 * radio group beside them reads as though the radio group were fine. It reddens the box where the
 * group has one; where `controlClassName` has taken the border away, the message below carries it.
 */
export default function RadioGroupField({
  label,
  value,
  onChange,
  options,
  required = false,
  disabled = false,
  error = "",
  name = label,
  className = "",
  layout = "row",
  controlClassName = "rounded-md border border-slate-300 bg-white px-3 py-2",
}) {
  const items = (options || []).map((option) => typeof option === "object" && option !== null ? option : { value: option, label: String(option) });

  // Only where the group actually draws a box: `px-0 py-0` callers have no border to redden, and
  // a rule appearing from nowhere under one unanswered group would read as a stray line.
  const errorBorder = error && controlClassName.includes("border") ? "border-red-400" : "";

  return <fieldset className={`text-sm font-medium text-slate-700 ${className}`} aria-invalid={error ? true : undefined}>
    <legend>{label}{required && <span aria-hidden="true" className="ml-0.5 text-rose-500">*</span>}</legend>
    <div className={`mt-2 flex min-h-11 gap-4 ${layout === "column" ? "flex-col items-start" : "flex-wrap items-center"} ${controlClassName} ${errorBorder}`}>
      {items.map((item) => <SelectableOption
        key={item.value}
        type="radio"
        name={name}
        value={item.value}
        checked={value === item.value}
        label={item.label}
        disabled={disabled}
        onCheckedChange={() => onChange(item.value)}
      />)}
    </div>
    {error && <p role="alert" className="mt-1.5 text-xs font-normal text-red-600">{error}</p>}
  </fieldset>;
}
