"use client";

import AddRoundedIcon from "@mui/icons-material/AddRounded";
import DeleteOutlineRoundedIcon from "@mui/icons-material/DeleteOutlineRounded";
import IconButton from "./IconButton";
import TextField from "./TextField";

/**
 * A short list of the same single box, repeated up to a cap: a candidate's portfolio links today,
 * and anything else that is two or three of one plain value.
 *
 * `RepeatableDetailsField` beside it is the other shape and deliberately not this one: it draws a
 * framed card per row with a heading and a grid of fields inside, which is right for a
 * qualification or a job and far too much furniture for a URL. A candidate with one link should see
 * **one box**, not a card inviting them to add a second - so this starts at a single row, puts the
 * add control next to it as a plus rather than a button below the list, and stops offering it once
 * `max` rows are on screen.
 *
 * The value is a plain array of strings, which is what a list of one-value rows actually is: a row
 * of `{ url }` would put a key in the payload that nothing reads and that every caller would have
 * to unwrap again.
 *
 * Always at least one box. An empty list and a list holding one empty string look the same to
 * somebody filling the form in, and rendering nothing at all would leave a labelled fieldset with
 * no way into it.
 */
export default function RepeatableTextList({
  addAriaLabel = "Add another",
  className = "",
  disabled = false,
  error = "",
  errors = {},
  hint,
  label,
  max = 3,
  onChange,
  placeholder,
  required = false,
  rowLabel = (index) => `Entry ${index + 1}`,
  type = "text",
  value,
}) {
  const stored = Array.isArray(value) ? value : [];
  // The box that is always there: a list nobody has typed into yet still has to be typed into.
  const rows = stored.length ? stored : [""];
  const canAdd = !disabled && rows.length < max;

  /* Written back whole. The empties are kept while the form is open - a candidate who adds a third
     box and fills the second first should not have the third taken away underneath them - and the
     submit drops them, which is where a blank row stops being something somebody is still using. */
  const replace = (next) => onChange?.(next);
  const editRow = (index, next) => replace(rows.map((row, at) => at === index ? next : row));
  const addRow = () => replace([...rows, ""]);
  const removeRow = (index) => {
    const next = rows.filter((row, at) => at !== index);
    replace(next.length ? next : [""]);
  };

  return <fieldset className={`min-w-0 rounded-lg border bg-slate-50/60 p-3 sm:p-4 ${error ? "border-red-400" : "border-slate-200"} ${className}`}>
    <legend className="px-1 text-[11px] font-semibold text-slate-600 sm:text-xs">{label}{required && <span aria-hidden="true" className="ml-0.5 text-rose-500">*</span>}</legend>
    {hint && <p className="text-[11px] font-normal leading-5 text-slate-500 sm:text-xs">{hint}</p>}
    {error && <p role="alert" className="mt-1 text-[11px] font-normal text-red-600 sm:text-xs">{error}</p>}

    <ul className={hint || error ? "mt-3 space-y-2" : "mt-2 space-y-2"}>
      {rows.map((row, index) => <li key={index} className="flex min-w-0 items-end gap-2">
        {/* `min-w-0` on the box rather than a width on the row: the icons keep their own size and
            the field takes what is left, so three of these still fit a 360px screen. */}
        <TextField
          className="min-w-0 flex-1"
          label={rowLabel(index)}
          type={type}
          disabled={disabled}
          error={errors?.[index] || ""}
          placeholder={placeholder}
          value={row || ""}
          onChange={(event) => editRow(index, event.target.value)}
        />
        {/*
          * The controls sit in a row of their own height so they line up with the box rather than
          * with its label, and they are only ever drawn where they do something: Remove once there
          * is more than one row, Add on the last row until the cap is reached. A disabled plus on
          * the third row would be a control that exists to refuse, which this application does not
          * draw - the icon is simply absent, and the cap is said in the hint instead.
          */}
        <div className={`flex shrink-0 items-center gap-1 ${errors?.[index] ? "self-start pt-6" : ""}`}>
          {rows.length > 1 && <IconButton
            size="sm"
            variant="plain"
            ariaLabel={`Remove ${rowLabel(index)}`}
            disabled={disabled}
            onClick={() => removeRow(index)}
            className="text-slate-400 hover:text-red-600 disabled:opacity-50"
          >
            <DeleteOutlineRoundedIcon sx={{ fontSize: 18 }} />
          </IconButton>}
          {canAdd && index === rows.length - 1 && <IconButton
            size="sm"
            variant="plain"
            ariaLabel={addAriaLabel}
            onClick={addRow}
            className="text-slate-400 hover:text-blue-600"
          >
            <AddRoundedIcon sx={{ fontSize: 18 }} />
          </IconButton>}
        </div>
      </li>)}
    </ul>
  </fieldset>;
}
