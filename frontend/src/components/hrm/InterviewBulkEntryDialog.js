"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import Button from "@/components/shared/Button";
import DateField from "@/components/shared/DateField";
import ComboBoxField from "@/components/shared/ComboBoxField";
import IconButton from "@/components/shared/IconButton";
import PhoneField from "@/components/shared/PhoneField";
import TextAreaField from "@/components/shared/TextAreaField";
import TextField from "@/components/shared/TextField";
import Dialog from "@/components/ui/Dialog";
import DeleteOutlineRoundedIcon from "@mui/icons-material/DeleteOutlineRounded";
import {
  BULK_ENTRY_FIELDS,
  MAX_BULK_ENTRIES,
  bulkEntryProblem,
  bulkEntryRecords,
  emptyBulkEntryRow,
  isBlankBulkEntryRow,
  missingBulkEntryFields,
} from "@/lib/interviewBulkEntry.mjs";

/**
 * Bulk Entry: several candidates typed in one sitting.
 *
 * The CRM's Bulk Entry dialog for candidates rather than leads, and deliberately the same dialog: a
 * reader who has used one should not have to work out where they are in the other. The same wide
 * card, the same white Candidate Details panel, the same one-line-per-row layout that fits rather
 * than measures, the same trailing blank row that grows as it is typed into and carries no remove
 * button, and the same rule about what a row must answer - see `lib/interviewBulkEntry.mjs`.
 *
 * What is different is only what the rows ask, and that Interview has no vertical: the CRM chooses
 * one at the top because its three boards ask different questions, and the Interview register is
 * one register. So the grey band above the card is gone and the card starts the dialog. There is no
 * Interviewer column either - one HR means nobody to assign a batch to.
 */

/**
 * A blank row at the end, always exactly one, so there is somewhere to type without pressing
 * anything. `blank` makes one - the dialog's own, carrying today's date and a fresh key.
 */
function withTrailingBlank(rows, blank) {
  const trimmed = [...rows];
  while (trimmed.length > 1 && isBlankBulkEntryRow(trimmed.at(-1)) && isBlankBulkEntryRow(trimmed.at(-2))) trimmed.pop();
  if (trimmed.length < MAX_BULK_ENTRIES && !isBlankBulkEntryRow(trimmed.at(-1))) trimmed.push(blank());
  return trimmed;
}

const todayKey = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};

export default function InterviewBulkEntryDialog({ options = {}, onClose, onSubmit }) {
  /*
   * A key per row that is not its position.
   *
   * Keyed by index, removing a row hands its React instance to the row that moves up into its place
   * - so a half-typed phone number, which `PhoneField` keeps in state of its own, appears to jump
   * to the candidate below. A counter is enough: nothing here is reordered, only added and removed.
   */
  const nextKey = useRef(0);
  /*
   * Today, for the Next Follow-up Date every new row opens on. Read once when the dialog is opened
   * rather than per row, so a batch of thirty carries one day rather than two either side of
   * midnight - and read on opening rather than when the page was built.
   */
  const today = useMemo(() => todayKey(), []);
  const blank = useCallback(() => ({ ...emptyBulkEntryRow({ today }), key: nextKey.current += 1 }), [today]);

  const [rows, setRows] = useState(() => [{ ...emptyBulkEntryRow({ today: todayKey() }), key: 0 }]);
  const [showErrors, setShowErrors] = useState(false);
  const [saving, setSaving] = useState(false);
  /*
   * The rows the register refused, by row key rather than by position.
   *
   * Held against the key because the grid moves underneath the mark: removing the offending
   * candidate would slide everything below it up, and a mark held at "candidate 2" would then be
   * pointing at whoever took that place - or at the empty row on the end. A key is the row wherever
   * it goes, and it leaves with it. The CRM board's bulk entry marks its duplicates the same way.
   */
  const [duplicates, setDuplicates] = useState({});
  const clearDuplicate = (key) => setDuplicates((current) => (current[key]
    ? Object.fromEntries(Object.entries(current).filter(([held]) => held !== String(key)))
    : current));

  const problem = bulkEntryProblem(rows);

  const update = (index, key, value) => setRows((current) => withTrailingBlank(
    current.map((row, position) => (position === index ? { ...row, [key]: value } : row)),
    blank,
  ));

  // Never below one: an empty dialog with nothing to type into is one that has to be closed and
  // reopened to be used.
  const removeRow = (index) => setRows((current) => withTrailingBlank(
    current.length > 1 ? current.filter((_, position) => position !== index) : [blank()],
    blank,
  ));

  async function submit(event) {
    event?.preventDefault?.();
    if (problem) {
      setShowErrors(true);
      return;
    }
    setSaving(true);
    try {
      setDuplicates({});
      await onSubmit(bulkEntryRecords(rows, { today }));
    } catch (error) {
      /*
       * A refused batch names its rows, and they are marked here rather than only described.
       *
       * The register refuses the batch **whole** when any row is somebody it already holds, so
       * nothing was written and this dialog stays open to be corrected. The message alone would
       * leave somebody counting down a grid of twenty to find which two lines were the problem.
       *
       * Resolved against the rows actually sent - the same filter, in the same order - because the
       * blank row on the end is dropped before posting and the server counts what it received.
       */
      const clashes = Array.isArray(error?.data?.errors) ? error.data.errors : [];
      const sent = rows.filter((row) => !isBlankBulkEntryRow(row));
      const byKey = {};
      for (const clash of clashes) {
        const row = sent[Number(clash?.row) - 1];
        if (row) byKey[row.key] = String(clash.reason || "This candidate is already on the register.");
      }
      setDuplicates(byKey);
    } finally {
      setSaving(false);
    }
  }

  return <Dialog
    title="Bulk Entry"
    description="Add several candidates at once. They all land in Yet to Connect, for somebody to call."
    size="wide"
    busy={saving}
    onClose={onClose}
    onSubmit={submit}
    // No padding of its own: the grey band runs to the edges of the card, the way it does on Add
    // Application, and what sits on it carries its own.
    bodyClassName="p-0"
    footer={<>
      <Button type="button" onClick={onClose} disabled={saving}>Cancel</Button>
      {/* "Add", not "Add 3 Candidates": the count is already on screen as the numbered rows, and a
          button whose words change as the form is filled in is a moving target to aim at. */}
      <Button variant="primary" disabled={saving}>{saving ? "Adding..." : "Add"}</Button>
    </>}
  >
    <div className="space-y-4 bg-slate-50 p-4 sm:p-5">
      {/* Add Application's own Candidate Details card, on its own measures - the rounded white
          panel and the heading rule across the top - so the two forms read as one asked twice. */}
      <section className="overflow-hidden rounded-2xl bg-white">
        <h3 className="border-b border-slate-200 px-5 py-3 text-lg font-medium text-slate-700">Candidate Details</h3>

        <div className="divide-y divide-slate-100">
          {rows.map((row, index) => (
            <BulkEntryRow
              key={row.key}
              position={index + 1}
              row={row}
              options={options}
              showErrors={showErrors}
              duplicate={duplicates[row.key] || ""}
              // Cleared as the row is edited: the mark describes what was posted, and the moment
              // that changes it is describing something that is no longer on screen.
              onChange={(key, value) => { clearDuplicate(row.key); update(index, key, value); }}
              /*
               * Removable unless it is the trailing blank. That row cannot be removed - the form
               * puts another one straight back, because there always has to be somewhere to type -
               * so a button on it was a control that did nothing when pressed. Absent rather than
               * disabled, which is this application's rule for a control the reader may not use.
               */
              onRemove={rows.length > 1 && !isBlankBulkEntryRow(row) ? () => removeRow(index) : null}
            />
          ))}
        </div>

        {/* The cap says so when it is reached, because that is the one thing the form cannot show by
            itself: no new blank row appears, and without a word that reads as the form having
            stopped working. */}
        {rows.length >= MAX_BULK_ENTRIES && <p className="border-t border-slate-200 px-5 py-3 text-xs font-normal text-slate-500 sm:text-sm">
          That is {MAX_BULK_ENTRIES} candidates, which is as many as one sitting takes. Add these, then start another.
        </p>}
      </section>

      {showErrors && problem && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-normal text-red-700 sm:text-sm">{problem}</p>}
    </div>
  </Dialog>;
}

/*
 * How much width each field would like on the row.
 *
 * A basis rather than a fixed width: the row is a flex line from `lg`, so the fields share whatever
 * width the card has in proportion to what each answer needs, and nothing has a size of its own to
 * overflow. That is the whole of why this never scrolls sideways, at any dialog width.
 */
const FIELD_GROW = {
  phone: "lg:flex-[1.4_1_0%]",
  text: "lg:flex-[1.1_1_0%]",
  position: "lg:flex-[1.2_1_0%]",
  source: "lg:flex-[1_1_0%]",
  date: "lg:flex-[1_1_0%]",
  textarea: "lg:flex-[1.5_1_0%]",
};

/**
 * One candidate, on one line.
 *
 * `flex-[n_1_0%]` from `lg` up, a two-column grid below it: eight fields on one line needs a wide
 * card, and on a tablet or a phone it would be eight boxes nobody can read or tap, so the line
 * folds rather than shrinking past legibility. `min-w-0` throughout, or a flex item refuses to go
 * below its content's width and puts the row back over the edge.
 */
function BulkEntryRow({ position, row, options, showErrors, duplicate = "", onChange, onRemove }) {
  const missing = showErrors ? missingBulkEntryFields(row) : [];
  const invalid = (field) => field.required && missing.includes(field.label);

  /*
   * `items-end`, so the number and the remove button sit level with the boxes rather than with
   * whatever is above them: the labels wrap at some widths and not others, so bottom-aligning is
   * the only arrangement that needs no guess.
   */
  return <div className="px-5 py-4">
    <div className="flex items-end gap-3">
    {/* Numbered, because that is how a problem names the row it belongs to. Hidden below `lg`,
        where the fields fold into a grid several rows tall and one number would point at all. */}
    <span className="hidden min-h-9 w-5 shrink-0 items-center text-xs font-semibold text-slate-400 lg:flex">{position}</span>

    <div className="grid min-w-0 flex-1 gap-3 sm:grid-cols-2 lg:flex lg:items-end">
      {BULK_ENTRY_FIELDS.map((field) => <div key={field.key} className={`min-w-0 ${FIELD_GROW[field.type] || "lg:flex-[1_1_0%]"}`}>
        <BulkEntryField
          field={field}
          value={row[field.key]}
          options={options}
          invalid={invalid(field)}
          // The refused row's number is marked where the clash actually is, so the box to correct
          // is the one carrying the mark rather than one named in a sentence above the grid.
          clash={Boolean(duplicate) && field.type === "phone"}
          onChange={(value) => onChange(field.key, value)}
        />
      </div>)}
    </div>

    {/* The box is held whether or not the button is in it, so the fields do not shift sideways as
        rows are added and removed. */}
    <span className="flex min-h-9 w-9 shrink-0 items-center">
      {onRemove && <IconButton label={`Remove candidate ${position}`} size="sm" onClick={onRemove} className="text-slate-500 hover:text-red-600">
        <DeleteOutlineRoundedIcon fontSize="small" aria-hidden="true" />
      </IconButton>}
    </span>
    </div>
    {/* Named in full under the row, because "already on the register" is only useful with the
        candidate it clashes with - somebody has to be able to go and open that record. */}
    {duplicate && <p className="mt-2 text-xs text-rose-600 lg:pl-8">{duplicate}</p>}
  </div>;
}

/**
 * One field, drawn through the control its `type` names - all of them the application's own.
 *
 * `options` is still taken, for the two comboboxes that read the studio's own lists.
 */
function BulkEntryField({ field, value, options, invalid, clash = false, onChange }) {
  // The clash first: a row refused as a duplicate is answered, not unanswered, and reporting it as
  // "Phone Number is required." would send somebody to fill in a box that is already filled in.
  const error = clash ? "Already on the register." : invalid ? `${field.label} is required.` : "";

  if (field.type === "phone") {
    return <PhoneField label={field.label} field={field.key} required={field.required} error={error} value={value} onChange={(_field, next) => onChange(next)} />;
  }
  if (field.type === "position") {
    // A combobox, not a closed list: the studio's designations are what it hires for most of the
    // time and not all of it, and a position typed here is the one the candidate applied for.
    return <ComboBoxField label={field.label} required={field.required} error={error} value={value} onChange={onChange} options={options.positions || []} placeholder="Select or type" />;
  }
  if (field.type === "source") {
    return <ComboBoxField label={field.label} required={field.required} error={error} value={value} onChange={onChange} options={options.sources || []} placeholder="Select or type" />;
  }
  if (field.type === "date") {
    return <DateField label={field.label} required={field.required} error={error} value={value} onChange={onChange} />;
  }
  if (field.type === "textarea") {
    /*
     * One row tall, like everything beside it on the line. `TextAreaField` floors itself at
     * `min-h-20`, which would make every candidate's row three times the height of its own
     * controls; `!min-h-9` is how the rest of this codebase overrides that floor. It stays a
     * textarea - a note is a sentence, it takes newlines and it drags open - but it starts level.
     */
    return <TextAreaField label={field.label} required={field.required} error={error} rows={1} value={value} onChange={(event) => onChange(event.target.value)} inputClassName="!min-h-9 py-1.5" />;
  }
  return <TextField label={field.label} required={field.required} error={error} value={value} onChange={(event) => onChange(event.target.value)} />;
}
