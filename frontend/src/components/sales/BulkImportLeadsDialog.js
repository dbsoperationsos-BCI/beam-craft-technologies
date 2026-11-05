"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import Button from "@/components/shared/Button";
import DateField from "@/components/shared/DateField";
import Dropdown from "@/components/shared/Dropdown";
import IconButton from "@/components/shared/IconButton";
import PhoneField from "@/components/shared/PhoneField";
import RadioGroupField from "@/components/shared/RadioGroupField";
import TextAreaField from "@/components/shared/TextAreaField";
import TextField from "@/components/shared/TextField";
import Dialog from "@/components/ui/Dialog";
import DeleteOutlineRoundedIcon from "@mui/icons-material/DeleteOutlineRounded";
import { dayKey } from "@/lib/crmDateRange.mjs";
import useBranchOptions from "@/components/sales/useBranchOptions";
import {
  BULK_IMPORT_VERTICALS,
  bulkImportFields,
  bulkImportProblem,
  bulkImportRecords,
  bulkImportVertical,
  emptyBulkImportRow,
  isBlankBulkImportRow,
  missingBulkImportFields,
} from "@/lib/crmBulkImport.mjs";

/**
 * Bulk Entry: several clients typed in one sitting, onto one vertical.
 *
 * Add Lead asks one client everything its vertical knows how to ask, which is right for the lead
 * somebody is about to work and wrong for twenty names off an event or a call with a planner. This
 * asks the few things that make a lead findable and assignable, and asks them again for the next
 * client.
 *
 * ── Built like Add Lead, because it is the same question asked more times ──
 *
 * The Vertical block on its own grey band at the top, then a white Client Details card under it:
 * that is Add Lead's own shape, and a reader arriving here from that dialog should not have to work
 * out where they are. The controls are the application's own throughout — the shared phone field,
 * the branch and CRM pickers, the calendar — so what is different about this form is how many
 * clients it takes, and nothing else.
 *
 * ── One vertical, chosen once, and it opens on the board being read ──
 *
 * It was asked per row, which was answering a question nobody had thirty times: a batch typed in one
 * sitting is almost always of one kind. Standing on Qua Qua and opening this gives a Qua Qua import
 * without a press, exactly as Add Lead does — and one vertical means one set of columns, so the rows
 * line up and a column can be read down. A batch of two kinds is two imports, which is one press.
 *
 * ── Adding a client is typing, not pressing ──
 *
 * A blank row sits at the end and filling it grows the next one behind it, so a batch is typed
 * straight down. There was an "Add another client" button under the card and it has gone: it asked
 * for a press before every client that typing had already made unnecessary, and an empty numbered
 * row under a filled one says "type here" more plainly than a button below the card does.
 *
 * That trailing row carries **no remove button**, and that is the one thing this arrangement has to
 * get right. It cannot be removed - the form puts another one straight back, because there always
 * has to be somewhere to type - so a button on it was a control that did nothing when pressed, over
 * and over, with no way to tell that from the form being broken.
 *
 * ── One client, one line, and nothing scrolls ──
 *
 * Every field a client has sits on one line, Description included, and the line is *fitted* rather
 * than measured: the fields share whatever width the dialog has, in proportion to what each needs,
 * and none of them has a fixed width to overflow. So the row is always exactly as wide as the card
 * — never wider, never behind a scrollbar, never with the first column cut in half.
 *
 * That is what the dialog's `wide` size is for. Seven fields on one line is a real width, and the
 * default card would have meant either a scrollbar or seven boxes too narrow to read.
 *
 * Below `lg` there is no width to fit seven fields into, and one line would be seven boxes of forty
 * pixels — so there the row becomes a two-column grid instead. One line where one line is legible,
 * and never a sideways scroll at any width: the same rule every table in this application follows.
 */

const MAX_ENTRIES = 50;

/**
 * A blank row at the end, always exactly one, so there is somewhere to type without pressing
 * anything. `blank` makes one — the dialog's own, carrying today's date and a fresh key.
 */
function withTrailingBlank(rows, vertical, blank) {
  const trimmed = [...rows];
  while (trimmed.length > 1 && isBlankBulkImportRow(trimmed.at(-1), vertical) && isBlankBulkImportRow(trimmed.at(-2), vertical)) trimmed.pop();
  if (trimmed.length < MAX_ENTRIES && !isBlankBulkImportRow(trimmed.at(-1), vertical)) trimmed.push(blank());
  return trimmed;
}

export default function BulkImportLeadsDialog({ defaultVertical = "Dum Dum", crmOptions = [], onClose, onImport }) {
  /*
   * The branches an imported row may be assigned to, threaded down beside the CRM roster for the
   * same reason: both are the studio's own lists, maintained on their own screens, and a copy
   * written into this dialog would offer branches the studio does not have - which is exactly
   * what the array this replaces did.
   */
  const { branches: branchOptions } = useBranchOptions();
  // The board being read, the way Add Lead opens on it. `bulkImportVertical` answers Dum Dum for
  // anything that is not one of the three - the Call Box included, which lends no vertical.
  const [vertical, setVertical] = useState(() => bulkImportVertical(defaultVertical));

  /*
   * A key per row that is not its position.
   *
   * Keyed by index, removing a row hands its React instance to the row that moves up into its place
   * — so a half-typed phone number, which `PhoneField` keeps in state of its own, appears to jump to
   * the client below. A counter is enough: nothing here is reordered, only added and removed.
   */
  const nextKey = useRef(0);

  /*
   * Today, for the Next Follow-up Date every new row opens on.
   *
   * Read once when the dialog is opened rather than per row, so a batch of thirty carries one day
   * rather than two either side of midnight — and read on *opening* rather than when the board was
   * built, so a page left open overnight still offers today.
   */
  const today = useMemo(() => dayKey(new Date()), []);
  const blank = useCallback(() => ({ ...emptyBulkImportRow({ today }), key: nextKey.current += 1 }), [today]);

  const [rows, setRows] = useState(() => [{ ...emptyBulkImportRow({ today: dayKey(new Date()) }), key: 0 }]);
  const [showErrors, setShowErrors] = useState(false);
  const [saving, setSaving] = useState(false);
  // Written synchronously, so a second press in the same tick is refused before it can post.
  const savingRef = useRef(false);

  const fields = bulkImportFields(vertical);
  const problem = bulkImportProblem(rows, vertical);

  /*
   * The rows the server refused for carrying a number their vertical already holds, by row number.
   *
   * Kept here rather than only in the toast that also reports them. The dialog stays open on a
   * refusal - which is the point, since the batch is about to be corrected - and a message that has
   * scrolled away or timed out leaves somebody looking at twenty rows with no idea which two were
   * the problem. The number is named on the row it is on.
   */
  const [duplicates, setDuplicates] = useState({});

  const update = (index, key, value) => setRows((current) => withTrailingBlank(
    current.map((row, position) => (position === index ? { ...row, [key]: value } : row)),
    vertical,
    blank,
  ));

  // A row being edited is a row being fixed, so its refusal goes as soon as it is touched rather
  // than surviving until the next submit and reading as though the correction did not take.
  const clearDuplicate = (rowKey) => setDuplicates((current) => {
    if (!current[rowKey]) return current;
    const next = { ...current };
    delete next[rowKey];
    return next;
  });

  // Never below one: an empty dialog with nothing to type into is one that has to be closed and
  // reopened to be used.
  const removeRow = (index) => setRows((current) => withTrailingBlank(
    current.length > 1 ? current.filter((_, position) => position !== index) : [blank()],
    vertical,
    blank,
  ));

  /*
   * Switching the vertical keeps what has been typed.
   *
   * The rows hold every key the three verticals between them use, so the names, numbers and branches
   * already entered survive; what only the old vertical asked is dropped on the way out rather than
   * on the switch, so moving back finds those answers still there. What does have to be reconsidered
   * is which rows count as blank, since the field list has changed under them.
   */
  const changeVertical = (next) => {
    setVertical(next);
    setRows((current) => withTrailingBlank(current, next, blank));
  };

  async function submit(event) {
    event?.preventDefault?.();
    if (problem) {
      setShowErrors(true);
      return;
    }
    /*
     * The ref, checked before anything awaits. `saving` below disables the button, but React applies
     * that on the next render - so two clicks in the same tick, which is what a double-click is,
     * both read the old value and both post the batch. The state is what the reader sees; this is
     * what actually stops the second one.
     */
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setDuplicates({});
    // The rows the server is about to number, in its order - the same filter `bulkImportRecords`
    // applies, kept so the refusal below can be read back onto the right clients.
    const sent = rows.filter((row) => !isBlankBulkImportRow(row, vertical));
    try {
      await onImport(bulkImportRecords(rows, { vertical, today }));
    } catch (error) {
      /*
       * A refused batch, marked row by row. The caller has already said so in a message - this is
       * the same verdict put where it can be acted on. Anything else is the caller's to report,
       * and is swallowed here rather than left to reach the console as an unhandled rejection.
       */
      /*
        * ── Which row the server means ───────────────────────────────────────────────────────────
        *
        * `clash.row` counts the records that were **sent**, and `bulkImportRecords` drops every
        * blank row on the way out. The grid, meanwhile, keeps blanks - the trailing one always, and
        * any row somebody cleared and left in place, since `withTrailingBlank` only trims from the
        * end. So the two lists are not the same list, and reading the verdict as a screen position
        * put the refusal on whatever row happened to be standing there: a blank one, or the client
        * after it, from the very first submit.
        *
        * Resolved against `sent` - the same filter, in the same order - and held against the row's
        * own `key` rather than its position. That is what makes the mark survive the grid moving
        * underneath it: deleting a row used to leave `{2: ...}` pointing at whatever slid up into
        * second place, so removing the offending client moved its error onto the innocent one below
        * - or onto the empty row at the end. A key is the row, wherever it goes, and it leaves with
        * it.
        */
      const clashes = Array.isArray(error?.data?.errors) ? error.data.errors : [];
      const byKey = {};
      for (const clash of clashes) {
        const row = sent[Number(clash?.row) - 1];
        if (row) byKey[row.key] = String(clash.reason || "This number is already in this vertical.");
      }
      setDuplicates(byKey);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  return <Dialog
    title="Bulk Entry"
    description="Add several clients at once. They all land on the vertical chosen below."
    size="wide"
    /*
     * As tall as what it holds, not a fixed 42rem.
     *
     * `tall` is for a dialog showing a *list* — one that must not resize as rows load or are
     * filtered. This is a form that grows one row at a time as somebody types, so a fixed height was
     * a card with a single client's line at the top and two thirds of it empty underneath, which
     * reads as content that failed to load. The viewport cap in `Dialog` still applies, so a batch
     * long enough to run past the screen scrolls inside the card rather than off it.
     */
    busy={saving}
    onClose={onClose}
    onSubmit={submit}
    // No padding of its own: the grey band runs to the edges of the card, the way it does on Add
    // Lead, and what sits on it carries its own.
    bodyClassName="p-0"
    footer={<>
      <Button type="button" onClick={onClose} disabled={saving}>Cancel</Button>
      {/* "Add", not "Add 3 Clients": the count is already on screen as the numbered rows, and
          a button whose words change as the form is filled in is a moving target to aim at. */}
      <Button variant="primary" disabled={saving}>{saving ? "Adding..." : "Add"}</Button>
    </>}
  >
    <div className="space-y-4 bg-slate-50 p-4 sm:p-5">
      {/*
        The Vertical block, on Add Lead's own measures: the label above a white box holding the three
        radios in a row. One question for the whole batch, and the one that decides what the rows
        below are asked.
      */}
      {/*
        `w-fit`, so the box is as wide as the three choices in it.

        Add Lead sets `max-w-2xl` here, which is right on a form whose fields are two columns of that
        width - the box lines up with the card below it. This card is the full width of a wide
        dialog, so the same measure left a box stretched across half the screen around three radios,
        with the emptiness reading as somewhere a fourth option had failed to load.
      */}
      <RadioGroupField label="Vertical" value={vertical} onChange={changeVertical} options={BULK_IMPORT_VERTICALS} className="w-fit" />

      {/* Add Lead's own Client Details card, on its own measures - the rounded white panel and the
          heading rule across the top - so the two dialogs read as one form asked twice. */}
      <section className="overflow-hidden rounded-2xl bg-white">
        <h3 className="border-b border-slate-200 px-5 py-3 text-lg font-medium text-slate-700">Client Details</h3>

        <div className="divide-y divide-slate-100">
          {rows.map((row, index) => (
            <BulkImportRow
              key={row.key}
              position={index + 1}
              row={row}
              fields={fields}
              crmOptions={crmOptions}
              branchOptions={branchOptions}
              showErrors={showErrors}
              duplicate={duplicates[row.key] || ""}
              vertical={vertical}
              onChange={(fieldKey, value) => { clearDuplicate(row.key); update(index, fieldKey, value); }}
              /*
               * Removable unless it is the trailing blank.
               *
               * That row cannot be removed - the form puts another one straight back, because there
               * always has to be somewhere to type - so a button on it was a control that did
               * nothing when pressed, over and over, with no way to tell that from the form being
               * broken. It is the one row a person will try to delete, too: it is the empty one.
               *
               * Absent rather than disabled, which is this application's rule for a control the
               * reader may not use.
               */
              onRemove={rows.length > 1 && !isBlankBulkImportRow(row, vertical) ? () => removeRow(index) : null}
            />
          ))}
        </div>

        {/*
          No "Add another client" button.

          There was one, and it was a second way to do what the form already does by itself: a blank
          row sits at the end, and filling it grows the next one behind it. The button asked for a
          press before every client that typing had already made unnecessary - and once the rows are
          numbered, an empty row 3 under a filled row 2 says "type here" more plainly than a button
          under the card does.

          The cap still says so when it is reached, because that is the one thing the form cannot
          show by itself: no new blank row appears, and without a word that reads as the form having
          stopped working.
        */}
        {rows.length >= MAX_ENTRIES && <p className="border-t border-slate-200 px-5 py-3 text-xs font-normal text-slate-500 sm:text-sm">
          That is {MAX_ENTRIES} clients, which is as many as one sitting takes. Add these, then start another.
        </p>}
      </section>

      {showErrors && problem && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-normal text-red-700 sm:text-sm">{problem}</p>}
    </div>
  </Dialog>;
}

/*
 * How much width each field would like on the row.
 *
 * A basis rather than a fixed width: the row is `flex-wrap`, so a field takes this much where there
 * is room and folds onto the next line where there is not. Nothing is ever cut off and nothing
 * scrolls sideways — which is what a fixed width cost on a laptop, and what the earlier version of
 * this dialog did cost.
 *
 * The values are what each answer actually needs: a phone is a country code and ten digits, a date
 * is `Select date` plus a calendar, a name and a branch are words.
 */
const FIELD_GROW = {
  // A country code and ten digits in one box, which is the widest answer on the row.
  phone: "lg:flex-[1.5_1_0%]",
  // A name and a sentence want more room than a picker; a picker's answer is one or two words.
  text: "lg:flex-[1.2_1_0%]",
  textarea: "lg:flex-[1.6_1_0%]",
  branch: "lg:flex-[1_1_0%]",
  crm: "lg:flex-[1_1_0%]",
  date: "lg:flex-[1_1_0%]",
};

/**
 * One client, on one line.
 *
 * `flex-[n_1_0%]` from `lg` up: a basis of zero and a weight, so the fields divide the row's width
 * between them in proportion to what each answer needs rather than each claiming a width the row
 * then has to find. Nothing can overflow, because nothing has a size of its own — which is the whole
 * of why this never scrolls sideways, at any dialog width.
 *
 * Below `lg` it is a two-column grid. Seven fields on one line needs a wide card; on a tablet or a
 * phone it would be seven boxes nobody can read or tap, so the line folds rather than shrinking past
 * legibility. `min-w-0` throughout, or a flex item refuses to go below its content's width and puts
 * the row back over the edge.
 *
 * The fields are drawn from the rule rather than written out per vertical, which is what keeps the
 * three lists in one place — and means a field added to a vertical appears here without this
 * component being touched.
 */
function BulkImportRow({ position, row, fields, crmOptions, branchOptions, showErrors, duplicate = "", vertical, onChange, onRemove }) {
  const missing = showErrors ? missingBulkImportFields(row, vertical) : [];
  /*
   * What each box has to say, as the sentence itself rather than a bare `invalid` flag.
   *
   * The number field wears the refusal as well as the row, so the eye lands on the box to change
   * rather than on a sentence under a line of seven boxes. It used to wear the *wrong* one: a
   * single boolean covered both reasons a box can be red, and the field turned it into
   * "<label> is required." - so a duplicate number was reported as an unanswered field, on a box
   * with a number plainly sitting in it, while the sentence that actually explained it was under
   * the row.
   *
   * The box says which box; the line under the row names the number and the enquiry holding it.
   */
  const errorFor = (field) => {
    if (field.required && missing.includes(field.label)) return `${field.label} is required.`;
    if (duplicate && field.type === "phone") return "Already in this vertical.";
    return "";
  };

  /*
   * `items-end`, so the number and the remove button sit level with the *boxes* rather than with
   * whatever is above them.
   *
   * They were pushed down by a fixed `mt-7`, which is only ever right while every label on the row
   * is one line high. It is not: "Date of Birth (or) EDOD" and "Next Follow-up Date" wrap at some
   * widths and "Description" does not, so the labels sit at different heights and the number ended
   * up level with a label on one row and with a box on the next. Bottom-aligning needs no guess -
   * the inputs all end at the same line whatever their labels did.
   */
  return <div className="px-5 py-4">
  <div className="flex items-end gap-3">
    {/* Numbered, because that is how a problem names the row it belongs to. Hidden below `lg`,
        where the fields fold into a grid several rows tall and a single number beside them would
        be pointing at all of them. */}
    <span className="hidden min-h-9 w-5 shrink-0 items-center text-xs font-semibold text-slate-400 lg:flex">{position}</span>

    <div className="grid min-w-0 flex-1 gap-3 sm:grid-cols-2 lg:flex lg:items-end">
      {fields.map((field) => <div key={field.key} className={`min-w-0 ${FIELD_GROW[field.type] || "lg:flex-[1_1_0%]"}`}>
        <BulkImportField
          field={field}
          value={row[field.key]}
          crmOptions={crmOptions}
          branchOptions={branchOptions}
          error={errorFor(field)}
          onChange={(value) => onChange(field.key, value)}
        />
      </div>)}
    </div>

    {/* Absent on the only row, rather than shown and refused. The box is held whether or not the
        button is in it, so the fields do not shift sideways as rows are added and removed. */}
    <span className="flex min-h-9 w-9 shrink-0 items-center">
      {onRemove && <IconButton label={`Remove client ${position}`} size="sm" onClick={onRemove} className="text-slate-500 hover:text-red-600">
        <DeleteOutlineRoundedIcon fontSize="small" aria-hidden="true" />
      </IconButton>}
    </span>
  </div>

  {/* Under the row, naming the number rather than the rule: "9876543210 is already held by
      DBS-EID-QQ-ERD-000012" is the whole of what somebody needs to decide what to do with it.
      Indented to the fields on `lg`, where the row carries its number in the gutter. */}
  {duplicate && <p className="mt-2 text-xs text-rose-600 lg:pl-8">{duplicate}</p>}
  </div>;
}

/*
 * One field, drawn through the control its `type` names — all of them the application's own.
 *
 * Neither option list carries a default. `branchOptions = []` used to, and the row above forgot to
 * pass the prop at all: the default answered for it, `Dropdown` takes an empty list without
 * complaint, and Assigned Branch drew a picker with nothing in it on every row of every batch —
 * a required field that could not be answered, so no batch could be saved. A default that stands in
 * for a list somebody else is fetching is a way for the thread to be cut and nothing to say so.
 */
function BulkImportField({ field, value, crmOptions, branchOptions, error = "", onChange }) {

  if (field.type === "phone") {
    return <PhoneField label={field.label} field={field.key} required={field.required} error={error} value={value} onChange={(_field, next) => onChange(next)} />;
  }
  if (field.type === "branch") {
    return <Dropdown mode="input" searchable ariaLabel={field.label} label={field.label} required={field.required} error={error} value={value} onChange={onChange} options={branchOptions} />;
  }
  if (field.type === "crm") {
    // The Sales roster, as the board reads it — fetched rather than written down, so somebody who
    // joined this week can be assigned a lead the day they arrive.
    return <Dropdown mode="input" searchable ariaLabel={field.label} label={field.label} required={field.required} error={error} placeholder={crmOptions.length ? "Select" : "No CRMs available"} value={value} onChange={onChange} options={crmOptions} disabled={crmOptions.length === 0} />;
  }
  if (field.type === "date") {
    return <DateField label={field.label} required={field.required} error={error} value={value} onChange={onChange} />;
  }
  if (field.type === "textarea") {
    /*
     * One row tall, like everything beside it on the line.
     *
     * `TextAreaField` floors itself at `min-h-20`, which would make every client's row three times
     * the height of its own controls for the sake of one field — and did, because a plain `min-h-9`
     * beside it is the same specificity and loses on stylesheet order. `!min-h-9` is how the rest of
     * this codebase overrides that floor (see the radio controls in AddShootDialog). It stays a
     * textarea rather than becoming a text box — a description is a sentence, it takes newlines and
     * it drags open — but it starts level with the fields it shares a line with.
     */
    return <TextAreaField label={field.label} required={field.required} error={error} rows={1} value={value} onChange={(event) => onChange(event.target.value)} inputClassName="!min-h-9 py-1.5" />;
  }
  return <TextField label={field.label} required={field.required} error={error} value={value} onChange={(event) => onChange(event.target.value)} />;
}
