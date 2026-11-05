"use client";

/**
 * The module's tick box. Kept as one component so a select-all in a table head and the row
 * boxes beneath it cannot drift apart in size, colour or alignment.
 *
 * `indeterminate` shows the mixed state used when only some rows are picked. A checkbox can
 * only be put into that state through the DOM node, never through an attribute, so it is
 * applied by ref on every render.
 */
export default function Checkbox({
  ariaLabel,
  checked = false,
  className = "",
  disabled = false,
  indeterminate = false,
  onChange,
  title,
}) {
  return (
    <input
      type="checkbox"
      aria-label={ariaLabel}
      title={title}
      checked={checked}
      disabled={disabled}
      ref={(node) => {
        if (node) node.indeterminate = !checked && indeterminate;
      }}
      onChange={(event) => onChange?.(event.target.checked, event)}
      className={`h-4 w-4 cursor-pointer rounded border-slate-300 text-blue-600 accent-blue-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
    />
  );
}
