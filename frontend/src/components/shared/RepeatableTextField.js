"use client";

import DeleteOutlineRoundedIcon from "@mui/icons-material/DeleteOutlineRounded";
import Button from "./Button";
import IconButton from "./IconButton";
import TextField from "./TextField";

/**
 * One labelled field that holds a list of plain values: a branch's UPI IDs, and anything else a
 * record may have several of and nothing more than text.
 *
 * Deliberately not `RepeatableDetailsField`, which is the other shape this application needs: that
 * one repeats a *form* - several fields per row, each row a framed card with a heading and a
 * Remove of its own - and is right for an employee's children or qualifications. A list of single
 * values framed that way is three boxes wearing three cards, which is a great deal of furniture
 * around one word each. This draws what the group is called once, the boxes under it, and Add
 * beneath them, so it reads exactly like the single field it grew out of.
 *
 * There is always one box, and the first is never removable: a field that can empty itself
 * entirely leaves nowhere to type, and "no UPI IDs" is already said by leaving the box blank. Every
 * box after it can be taken away, which only edits this form - what the record holds changes when
 * the form is saved, like every other field on it.
 *
 * `values` is the list as the form holds it, blanks and all; `onChange` is given the whole next
 * list. `errors` is one message per index, so a fault is shown under the box it belongs to, and
 * `error` is the other kind - one message about the list itself rather than about a box in it,
 * which is what a list held to a length has to say. `maxRows` stops Add at that length, so the
 * form cannot build a list the server will refuse.
 */
export default function RepeatableTextField({
  addLabel = "+ Add",
  className = "",
  disabled = false,
  error = "",
  errors = [],
  // What one entry is called, where that is not simply the group's own name.
  itemName,
  label,
  maxLength,
  maxRows = 0,
  onChange,
  placeholder = "",
  values,
}) {
  // The list this draws, which always has a first box even when the form is holding nothing.
  const rows = Array.isArray(values) && values.length ? values : [""];
  const name = itemName || label;
  const replace = (next) => onChange?.(next);
  // Add stops where the record stops, so the form never offers a box the server would refuse.
  const full = maxRows > 0 && rows.length >= maxRows;

  return <div className={`min-w-0 ${className}`}>
    <p className="text-[11px] font-semibold text-slate-600 sm:text-xs">{label}</p>
    {/* About the list rather than about a box in it, so it is said once and above them. */}
    {error && <p role="alert" className="mt-1 text-[11px] font-normal text-red-600 sm:text-xs">{error}</p>}
    <div className="mt-1.5 space-y-2">
      {/*
        * Keyed by position, which is what these rows are: the value is the whole of a row, the
        * inputs hold no state of their own, and a row taken from the middle leaves the rows below
        * it showing their own values at their new positions.
        */}
      {rows.map((value, index) => <div key={index} className="flex items-start gap-2">
        <TextField
          className="min-w-0 flex-1"
          aria-label={rows.length > 1 ? `${name} ${index + 1}` : name}
          value={value}
          error={errors?.[index] || ""}
          disabled={disabled}
          maxLength={maxLength}
          placeholder={placeholder}
          onChange={(event) => replace(rows.map((row, at) => (at === index ? event.target.value : row)))}
        />
        {/* Never on the first: see above. `mt-0.5` sets the 32px control in the middle of the 36px
            box beside it, which a height of its own would have to fight the shared sizes for. */}
        {index > 0 && <IconButton
          size="sm"
          variant="plain"
          ariaLabel={`Remove ${name} ${index + 1}`}
          disabled={disabled}
          onClick={() => replace(rows.filter((_, at) => at !== index))}
          className="mt-0.5 text-slate-400 hover:text-red-600 disabled:opacity-50"
        >
          <DeleteOutlineRoundedIcon sx={{ fontSize: 18 }} />
        </IconButton>}
      </div>)}
    </div>
    {!full && <Button type="button" variant="secondary" size="sm" disabled={disabled} onClick={() => replace([...rows, ""])} className="mt-2 max-sm:w-full">{addLabel}</Button>}
  </div>;
}
