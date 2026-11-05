"use client";

import HelpTip from "./HelpTip";
import DeleteOutlineRoundedIcon from "@mui/icons-material/DeleteOutlineRounded";
import SchemaFormField, { visibleFields } from "@/components/schema-form/SchemaFormFields";
import Button from "./Button";
import IconButton from "./IconButton";

/**
 * A list of the same small form, repeated: an employee's children, their qualifications, the
 * companies they have worked at.
 *
 * All three ask for a handful of fields per row and nothing else, so this owns everything they
 * share — the framed section and its hint (the legend's ⓘ, beside `helperText`), the empty state, Add and Remove, the row keys — and the
 * cells themselves are drawn by `SchemaFormField`, the same renderer the public onboarding form and
 * the credential form already describe their fields to. So a row is a field list, exactly like a
 * section of either form, and a new one costs a description rather than a component.
 *
 * The rows carry a `key` of their own because a row the form adds has no id yet, and removing one
 * from the middle of a list by index moves every row below it.
 *
 * `errors` is `{ [index]: { [fieldName]: message } }` — the shape `detailRowErrors()` returns — so
 * a problem is shown on the input it belongs to rather than as one line under the whole list.
 * `error` is the other kind: one message about the list itself rather than about a row in it, which
 * is what a list that has to hold something and holds nothing has to say. `required` stars the
 * legend the same way every labelled control stars its own, so a list somebody must fill in reads
 * as one before they submit rather than after.
 */

/*
 * Two namespaces, and they must not meet.
 *
 * A row that arrives without a key - every row read back from a record - is keyed by its position,
 * and a row the form adds is keyed from this seed. Both used to spell it `row-N`, so a record
 * holding two rows (`row-0`, `row-1`) and one press of Add (`row-1`, the seed's first) produced
 * **two rows with one key**: React reused a cell for the wrong row, and Remove, which filters by
 * key, deleted both of them at once. `added-` can never collide with an index.
 */
let rowKeySeed = 0;
const nextRowKey = () => `added-${(rowKeySeed += 1)}`;

/** A row as this field holds it, whatever shape it arrived in — the record's, or a submission's. */
export const withRowKey = (row = {}, index = 0) => ({ ...row, key: row.key || `loaded-${index}` });

export default function RepeatableDetailsField({
  addLabel = "+ Add",
  className = "",
  disabled = false,
  emptyText = "Nothing added yet.",
  error = "",
  helperText = "",
  errors = {},
  fields,
  hint,
  label,
  // Classes for the list of rows, e.g. a max height with its own scroll for a list that can grow long.
  listClassName = "",
  onChange,
  // What each row is called, for its heading and the Remove control's accessible name.
  required = false,
  rowLabel = (index) => `Entry ${index + 1}`,
  value,
}) {
  const rows = (Array.isArray(value) ? value : []).map(withRowKey);
  // The hint explains the list, so it joins the legend's ⓘ rather than a grey line under it.
  const tip = [helperText, hint].filter(Boolean).join(" ");
  const blankRow = () => ({ key: nextRowKey(), ...Object.fromEntries(fields.map((field) => [field.name, field.type === "file" ? [] : ""])) });

  const replace = (next) => onChange?.(next);
  const addRow = () => replace([...rows, blankRow()]);
  const removeRow = (key) => replace(rows.filter((row) => row.key !== key));
  function editRow(key, name, fieldValue) {
    const normalize = fields.find((field) => field.name === name)?.normalize;
    replace(rows.map((row) => row.key === key ? { ...row, [name]: normalize ? normalize(fieldValue) : fieldValue } : row));
  }

  return <fieldset className={`min-w-0 rounded-lg border bg-slate-50/60 p-3 sm:p-4 ${error ? "border-red-400" : "border-slate-200"} ${className}`}>
    <legend className="px-1 text-[11px] font-semibold text-slate-600 sm:text-xs">{label}{required && <span aria-hidden="true" className="ml-0.5 text-rose-500">*</span>}<HelpTip text={tip} /></legend>
    {error && <p role="alert" className="mt-1 text-[11px] font-normal text-red-600 sm:text-xs">{error}</p>}

    {rows.length === 0
      ? <p className={`rounded-md border border-dashed border-slate-300 bg-white px-3 py-4 text-center text-[11px] font-normal text-slate-500 sm:text-xs mt-2`}>{emptyText}</p>
      : <ul className={`mt-3 space-y-3 ${listClassName}`}>
        {rows.map((row, index) => <li key={row.key} className="min-w-0 rounded-md border border-slate-200 bg-white p-3">
          {/* The heading names the row and gives Remove a place of its own, so the control never
              has to share a column with the fields or wrap under them on a narrow screen. */}
          <div className="mb-3 flex items-center justify-between gap-2 border-b border-slate-100 pb-2">
            <p className="truncate text-[11px] font-semibold text-slate-500 sm:text-xs">{rowLabel(index)}</p>
            {/* `variant="plain"` for the reason the payment rows use it: the shared button's own
                grey hover is not this module's idea of an icon button, which changes colour only. */}
            <IconButton
              size="xs"
              variant="plain"
              ariaLabel={`Remove ${rowLabel(index)}`}
              disabled={disabled}
              onClick={() => removeRow(row.key)}
              className="text-slate-400 hover:text-red-600 disabled:opacity-50"
            >
              <DeleteOutlineRoundedIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {visibleFields(fields, row).map((field) => <SchemaFormField
              key={field.name}
              field={disabled ? { ...field, props: { ...(typeof field.props === "function" ? field.props(row) : field.props), disabled: true } } : field}
              values={row}
              onChange={(name, next) => editRow(row.key, name, next)}
              errors={errors?.[index] || {}}
            />)}
          </div>
        </li>)}
      </ul>}

    <Button type="button" variant="secondary" size="sm" disabled={disabled} onClick={addRow} className="mt-3 max-sm:w-full">{addLabel}</Button>
  </fieldset>;
}
