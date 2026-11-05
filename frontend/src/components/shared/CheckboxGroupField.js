import SelectableOption from "./SelectableOption";

/**
 * A set of tick boxes on one line — several answers to one question.
 *
 * The counterpart to `RadioGroupField`, and deliberately its mirror: the same legend, the same row,
 * the same `SelectableOption`, the same `controlClassName` escape hatch. A screen that offers one
 * choice here and several there should differ only in the shape of the box, which is the one thing
 * that actually tells a reader the difference.
 *
 * Options are plain strings — where the value and the label are the same words, as with a shoot's
 * "Studio / In-House" — or `{ value, label }` where they are not, which is what lets a choice be
 * stored as `HALF_SESSION` while reading as "Half Session".
 *
 * `value` is an array and `onChange` is given the next array. Order follows the options rather than
 * the order they were ticked, so what is stored does not depend on which box somebody pressed first.
 */
export default function CheckboxGroupField({
  label,
  value,
  onChange,
  options,
  required = false,
  disabled = false,
  name = label,
  className = "",
  controlClassName = "rounded-md border border-slate-300 bg-white px-3 py-2",
}) {
  const items = (options || []).map((option) => typeof option === "object" && option !== null ? option : { value: option, label: String(option) });
  const selected = Array.isArray(value) ? value : [];

  const toggle = (optionValue) => {
    const next = selected.includes(optionValue)
      ? selected.filter((item) => item !== optionValue)
      : [...selected, optionValue];
    // Sorted back into the order the options are declared in, so two shoots ticked the same way
    // store the same list whichever box was pressed first.
    onChange(items.map((item) => item.value).filter((item) => next.includes(item)));
  };

  return <fieldset className={`text-sm font-medium text-slate-700 ${className}`}>
    <legend>{label}{required && <span aria-hidden="true" className="ml-0.5 text-rose-500">*</span>}</legend>
    <div className={`mt-2 flex min-h-11 flex-wrap items-center gap-4 ${controlClassName}`}>
      {items.map((item) => <SelectableOption
        key={item.value}
        type="checkbox"
        name={name}
        value={item.value}
        checked={selected.includes(item.value)}
        label={item.label}
        disabled={disabled}
        onCheckedChange={() => toggle(item.value)}
      />)}
    </div>
  </fieldset>;
}
