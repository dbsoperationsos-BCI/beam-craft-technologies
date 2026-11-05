import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  BULK_IMPORT_FIELDS,
  BULK_IMPORT_VERTICALS,
  bulkImportFields,
  bulkImportProblem,
  bulkImportRecord,
  bulkImportRecords,
  emptyBulkImportRow,
  isBlankBulkImportRow,
  missingBulkImportFields,
} from "../src/lib/crmBulkImport.mjs";

/*
 * Bulk Entry: several leads typed in one sitting, onto one vertical.
 *
 * The vertical is chosen once, at the top, and it opens on the board being read - Add Lead's own
 * behaviour. It was asked per row, which was answering a question nobody had thirty times: a batch
 * typed in one sitting is almost always of one kind, and one vertical means one set of columns, so
 * the rows line up and a column can be read down.
 *
 * Two things decide whether this is usable and neither shows up until somebody has typed twenty
 * names: that the vertical decides what the rows are asked and where they land, and that switching
 * it mid-typing neither loses what the two verticals share nor carries what only one of them asked.
 */

const HERE = import.meta.dirname;
const DIALOG = fs.readFileSync(path.join(HERE, "..", "src", "components", "sales", "BulkImportLeadsDialog.js"), "utf8");
const PAGE = fs.readFileSync(path.join(HERE, "..", "src", "components", "sales", "CRMPage.js"), "utf8");

test("each vertical asks what it needs, and no more", () => {
  /*
   * The same six questions everywhere, plus one for Qua Qua. Description is on all three because the
   * useful thing about a name typed off a call is very often a sentence rather than a field - what
   * they asked for, when they are free, who sent them - and a vertical without somewhere to put it
   * means that sentence going into the name or nowhere.
   *
   * No Enquiry Date. The studio does not want to be asked for it here or on Add Lead: a batch typed
   * in is that day's enquiries, and the dialog stamps its own day on every row. A lead that needs
   * another date is backdated from the lead popup once it is saved.
   */
  const labels = (vertical) => bulkImportFields(vertical).map((field) => field.label);
  assert.deepEqual(labels("Dum Dum"), ["Enquire Name", "Contact", "Assigned Branch", "Assign To", "Next Follow-up Date", "Description"]);
  assert.deepEqual(labels("Qua Qua"), ["Enquire Name", "Contact", "Assigned Branch", "Date of Birth (or) EDOD", "Assign To", "Next Follow-up Date", "Description"]);
  assert.deepEqual(labels("Corp"), ["Enquire Name", "Contact", "Assigned Branch", "Assign To", "Next Follow-up Date", "Description"]);
  for (const vertical of ["Dum Dum", "Qua Qua", "Corp"]) {
    assert.ok(!labels(vertical).includes("Enquiry Date"), `${vertical} is asking for the Enquiry Date again`);
  }
  for (const vertical of ["Dum Dum", "Qua Qua", "Corp"]) {
    assert.ok(labels(vertical).includes("Description"), `${vertical} has nowhere to put a sentence about the lead`);
  }
  assert.deepEqual(BULK_IMPORT_VERTICALS, ["Dum Dum", "Qua Qua", "Corp"]);
  // Anything unrecognised reads as Dum Dum, the way a blank vertical does everywhere in this CRM.
  assert.deepEqual(labels("Calls"), labels("Dum Dum"));
  assert.deepEqual(labels(""), labels("Dum Dum"));
});

test("a name, a number and a branch are required; who takes it and when is not", () => {
  /*
   * The line Add Lead draws for these fields, and no further. A batch is very often typed before
   * anybody has decided who is taking it, and requiring Assign To would mean inventing an answer -
   * a lead assigned to the wrong person is worse than one assigned to nobody, which the board
   * already shows as unassigned.
   */
  const blank = emptyBulkImportRow();
  assert.deepEqual(missingBulkImportFields(blank, "Dum Dum"), ["Enquire Name", "Contact", "Assigned Branch"]);
  // Next Follow-up Date is answered for the person, so it is never one of the answers still owed.
  assert.equal(missingBulkImportFields(emptyBulkImportRow({ today: "2026-09-08" }), "Dum Dum").includes("Next Follow-up Date"), false);
  assert.deepEqual(
    missingBulkImportFields({ ...blank, name: "Anitha", phone: "9876543210", assignedBranch: "Erode" }, "Dum Dum"),
    [],
    "a lead with a name, a number and a branch is still refused",
  );

  /*
   * Qua Qua asks for the date as well - its shoots are scheduled from the baby's date of birth or
   * the mother's expected date, and it is what the Newborns and Birthdays tabs read - but it does
   * not refuse the row for it. A batch is typed off names nobody has spoken to yet, so demanding a
   * date buys an invented one, which those two tabs would then plan shoots off.
   */
  const quaQua = { ...emptyBulkImportRow(), name: "Anitha", phone: "9876543210", assignedBranch: "Erode" };
  assert.deepEqual(missingBulkImportFields(quaQua, "Qua Qua"), []);
  assert.deepEqual(missingBulkImportFields({ ...quaQua, dateOfBirthOrEdod: "2026-04-01" }, "Qua Qua"), []);
  // It is still one of the questions Qua Qua asks, which is what keeps it on the form and in the row.
  assert.equal(bulkImportFields("Qua Qua").some((field) => field.key === "dateOfBirthOrEdod"), true);
});

test("switching the batch vertical keeps what the two share and drops what only one asked", () => {
  /*
   * The rows hold every key the three verticals between them use, so a Qua Qua batch moved to Corp
   * keeps its names, numbers and branches - retyping those would be most of the work already done.
   * What only the old vertical asked is dropped on the way out rather than on the switch, so moving
   * back finds those answers still there.
   */
  const row = {
    ...emptyBulkImportRow(),
    name: "Anitha", phone: "9876543210", assignedBranch: "Erode",
    dateOfBirthOrEdod: "2026-04-01", remarks: "kept across the switch",
  };
  const asCorp = bulkImportRecord(row, { vertical: "Corp" });
  assert.equal(asCorp.lead.vertical, "Corp");
  assert.equal(asCorp.lead.name, "Anitha");
  assert.equal(asCorp.lead.assignedBranch, "Erode");
  assert.equal(asCorp.lead.dateOfBirthOrEdod, "", "Corp carries a date only Qua Qua asks for");
  // The description survives the switch, because every vertical asks for one - it is the date that
  // is Qua Qua's alone.
  assert.equal(asCorp.details.remarks, "kept across the switch");
  // And back on Qua Qua the date is carried again, so nothing was lost by switching away.
  assert.equal(bulkImportRecord(row, { vertical: "Qua Qua" }).lead.dateOfBirthOrEdod, "2026-04-01");
});

test("a record is the shape Add Lead posts, minus the id the server mints", () => {
  /*
   * `id` is empty on purpose: an enquiry id counts within its own vertical and branch, and only the
   * server's counter knows where that pair has got to. The group fields say a person typed this
   * rather than it arriving from Callyzer or a sheet - the Source column, the group menu and the
   * reports all read them, and a lead with none reads as having come from nowhere.
   */
  const record = bulkImportRecord(
    { ...emptyBulkImportRow(), name: " Anitha ", phone: " 9876543210 ", assignedBranch: "Erode", crm: "Priya S", nextFollowUpDate: "2026-09-12", remarks: "walked in" },
    { vertical: "Dum Dum", today: "2026-09-08", addedTime: "04:42 pm" },
  );
  assert.equal(record.lead.id, "");
  assert.equal(record.lead.vertical, "Dum Dum");
  // Trimmed, so a pasted name does not become a lead nobody can find by searching for it.
  assert.equal(record.lead.name, "Anitha");
  assert.equal(record.lead.phone, "9876543210");
  assert.equal(record.lead.crm, "Priya S");
  assert.equal(record.lead.createdDate, "2026-09-08");
  assert.equal(record.lead.addedTime, "04:42 pm");
  assert.deepEqual(
    { groupId: record.details.groupId, groupName: record.details.groupName, groupType: record.details.groupType },
    { groupId: "manual", groupName: "Manual entry leads", groupType: "manual" },
  );
  /*
   * No status, which is what files the lead under **Yet to connect**.
   *
   * That label is derived rather than stored - an empty status column is what both the board's SQL
   * and `resolveLeadStatus` read as Yet to connect - so an empty string here is not a missing value
   * but the queue itself. Stamping "Interested", as this used to, said somebody had spoken to a name
   * that had only just been written down, and took the batch straight past the queue it belongs in.
   */
  assert.equal(record.details.leadStatus, "");
  assert.equal(record.details.nextFollowUpDate, "2026-09-12");
  /*
   * The description lands in both halves. The board's Remarks column reads the flat string and the
   * lead popup reads the entries, so a note in only one of them is visible in one place and gone
   * from the other.
   */
  assert.equal(record.details.remarks, "walked in");
  assert.equal(record.details.remarkEntries.length, 1);
  assert.equal(record.details.remarkEntries[0].text, "walked in");
  // And no remark at all rather than an empty one, which would draw a blank row in the popup.
  assert.deepEqual(bulkImportRecord(emptyBulkImportRow(), { vertical: "Dum Dum" }).details.remarkEntries, []);
});

test("a row opens on today's follow-up date, and that alone does not make it a client", () => {
  /*
   * A lead being written down is one somebody is about to work, and the next call is almost always
   * the same day it was taken. Left blank it was a field answered by hand on every row, and the rows
   * nobody answered it on are the leads that appear on no Pending Followups tab and are chased by
   * nobody.
   *
   * The trap it opens is the one this pins: the dialog keeps a blank row at the end to type into,
   * and a row carrying a date counts as *filled* unless something says otherwise - so that row would
   * be posted as a lead with a follow-up date and no name, and the dialog would grow another one
   * behind it, for ever. Blankness is judged on what the person answers, not on what the form
   * answered for them.
   */
  const row = emptyBulkImportRow({ today: "2026-09-08" });
  assert.equal(row.nextFollowUpDate, "2026-09-08");
  assert.equal(isBlankBulkImportRow(row, "Dum Dum"), true, "the trailing blank row counts as a client to import");
  assert.deepEqual(bulkImportRecords([row], { vertical: "Dum Dum" }), [], "a row nobody filled in was posted as a nameless lead");
  assert.equal(bulkImportProblem([row], "Dum Dum"), "Fill in at least one client before importing.");
  // And a row somebody has filled in carries the date through to the record.
  const named = { ...row, name: "Anitha", phone: "9876543210", assignedBranch: "Erode" };
  assert.equal(isBlankBulkImportRow(named, "Dum Dum"), false);
  assert.equal(bulkImportRecord(named, { vertical: "Dum Dum" }).details.nextFollowUpDate, "2026-09-08");
  // Blank where the caller names no day, so the lib never invents one of its own.
  assert.equal(emptyBulkImportRow().nextFollowUpDate, "");
});

test("the whole batch lands on the chosen vertical, and blanks are dropped", () => {
  const rows = [
    { ...emptyBulkImportRow(), name: "A", phone: "1", assignedBranch: "Erode", dateOfBirthOrEdod: "2026-04-01" },
    { ...emptyBulkImportRow(), name: "B", phone: "2", assignedBranch: "Erode", dateOfBirthOrEdod: "2026-05-01" },
    // The trailing blank the dialog always keeps, so there is somewhere to type.
    emptyBulkImportRow(),
  ];
  const records = bulkImportRecords(rows, { vertical: "Qua Qua" });
  assert.deepEqual(records.map((record) => record.lead.vertical), ["Qua Qua", "Qua Qua"]);
  assert.equal(records.length, 2, "the trailing blank was posted as a nameless lead");
  assert.equal(isBlankBulkImportRow(emptyBulkImportRow(), "Dum Dum"), true);
  assert.equal(isBlankBulkImportRow({ ...emptyBulkImportRow(), name: "A" }, "Dum Dum"), false);
  /*
   * "Blank" is answered against the vertical on screen, which is why it is passed in. A row holding
   * only a Qua Qua date is blank on Corp - Corp does not ask for one - and posting it would create a
   * nameless lead out of an answer the batch no longer carries.
   */
  assert.equal(isBlankBulkImportRow({ ...emptyBulkImportRow(), dateOfBirthOrEdod: "2026-04-01" }, "Qua Qua"), false);
  assert.equal(isBlankBulkImportRow({ ...emptyBulkImportRow(), dateOfBirthOrEdod: "2026-04-01" }, "Corp"), true);
});

test("what is wrong with a batch names the entry it is wrong in", () => {
  // "2 answers missing" on a form of eight entries is a message somebody has to go and search; the
  // entries are numbered on screen for exactly this.
  assert.equal(bulkImportProblem([emptyBulkImportRow()], "Dum Dum"), "Fill in at least one client before importing.");
  const rows = [
    { ...emptyBulkImportRow(), name: "A", phone: "1", assignedBranch: "Erode", dateOfBirthOrEdod: "2026-04-01" },
    { ...emptyBulkImportRow(), name: "B", phone: "2" },
  ];
  assert.equal(bulkImportProblem(rows, "Qua Qua"), "Client 2: Assigned Branch");
  assert.equal(bulkImportProblem([rows[0]], "Qua Qua"), "");
  // And the row is imported without a date, on Qua Qua as on the other two - it is asked, not owed.
  assert.equal(bulkImportProblem([{ ...rows[1], assignedBranch: "Erode" }], "Qua Qua"), "");
});

test("the dialog is reachable, opens on the board being read, and posts one request", () => {
  // Named Bulk Entry, and offered with no permission test around it: it types leads in, which is
  // what the board's own Read / Write is granted for, and it is what is left in the ⋮ menu for a
  // role that may not import a file. The CSV beside it answers for `SALES / CRM Lead Import`.
  assert.match(PAGE, /\{ label: "Bulk Entry", onSelect: \(\) => setShowBulkImport\(true\) \}/, "Bulk Entry is gone from the ⋮ menu");
  /*
   * Opened on the board being read, exactly as Add Lead is: standing on Qua Qua and importing gives
   * Qua Qua leads without a press. `normalizeVertical` answers "" for the Call Box, which has no
   * vertical to lend, and the dialog falls back to Dum Dum there.
   */
  assert.match(PAGE, /defaultVertical=\{normalizeVertical\(board\) \|\| "Dum Dum"\}/, "the import opens on a fixed vertical again");
  /*
   * One request rather than one per client: twenty leads is twenty round trips otherwise, and half a
   * batch written before a failure is a state nobody can see or undo from this screen.
   */
  assert.match(PAGE, /apiRequest\("\/api\/sales\/crm-leads\/bulk", \{ method: "POST", body: JSON\.stringify\(\{ records \}\) \}\)/);
  // The board is re-read from the server rather than guessed at: the Enquiry IDs are minted there.
  assert.match(PAGE, /setShowBulkImport\(false\);\s*\n\s*await loadLeads\(\);/);
  // Assign To offers the board's own roster, so a lead can be assigned here to exactly who it could
  // be assigned to anywhere else.
  assert.match(PAGE, /crmOptions=\{crmChoices\}/);
});

test("the dialog draws its fields from the rule rather than writing them out per vertical", () => {
  /*
   * Three lists written out in a component is how the dialog and the record it posts come to
   * disagree about what a vertical asks. The labels appear once, in `crmBulkImport.mjs`.
   */
  const code = DIALOG.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  for (const label of BULK_IMPORT_FIELDS["Qua Qua"].map((field) => field.label)) {
    assert.equal(code.includes(`"${label}"`), false, `the dialog writes out "${label}" itself`);
  }
  assert.match(DIALOG, /const fields = bulkImportFields\(vertical\);/);
  // And a blank entry sits at the end, so typing the next client needs no button pressed first.
  assert.match(DIALOG, /function withTrailingBlank\(rows, vertical, blank\)/);
  /*
   * And that trailing row is the *only* way in. The "Add another client" button under the card was a
   * second way to do what the form already does by itself, and asked for a press before every client
   * that typing had made unnecessary.
   */
  assert.doesNotMatch(DIALOG.replace(/\/\*[\s\S]*?\*\//g, ""), /Add another client/, "the add button is back beside the row that already adds itself");
  assert.match(DIALOG, /bulkImportRecords\(rows, \{ vertical, today \}\)/);
});

test("every field of a client sits on one line, and nothing scrolls sideways", () => {
  /*
   * The line is *fitted*, not measured: `flex-[n_1_0%]` gives each field a basis of zero and a
   * weight, so they divide the row's width between them in proportion to what each answer needs
   * rather than each claiming a width the row then has to find. Nothing can overflow, because
   * nothing has a size of its own - which is the whole of why this never scrolls at any width.
   *
   * Fixed widths and an `overflow-x-auto` strip were the first attempt, and they cost exactly what
   * this pins against: a scrollbar, and the first column cut in half on a laptop.
   */
  assert.doesNotMatch(DIALOG, /overflow-x-auto|min-w-max|basis-\d/, "the row scrolls sideways again instead of fitting");
  assert.match(DIALOG, /const FIELD_GROW = \{/);
  assert.match(DIALOG, /lg:flex-\[1\.5_1_0%\]/, "the phone field no longer gets the extra width a country code and ten digits need");
  // Every field, Description included - one line, not a line plus a note beneath it.
  assert.match(DIALOG, /\{fields\.map\(\(field\) => <div key=\{field\.key\} className=\{`min-w-0 \$\{FIELD_GROW\[field\.type\] \|\| "lg:flex-\[1_1_0%\]"\}`\}>/);
  assert.doesNotMatch(DIALOG, /field\.type !== "textarea"/, "the description was moved off the line again");
  // And the description is one row tall like the fields beside it, rather than the four-line floor
  // `TextAreaField` gives itself.
  assert.match(DIALOG, /rows=\{1\}[\s\S]{0,120}?inputClassName="!min-h-9 py-1\.5"/);
  /*
   * Below `lg` it folds to a two-column grid instead. Seven fields on one line needs a wide card; on
   * a tablet or a phone it would be seven boxes nobody can read or tap - so it wraps rather than
   * shrinking past legibility, and still never scrolls.
   */
  assert.match(DIALOG, /className="grid min-w-0 flex-1 gap-3 sm:grid-cols-2 lg:flex lg:items-end"/);
  // `min-w-0` throughout, or a flex item refuses to go below its content's width and puts the row
  // back over the edge - which is the failure mode this whole approach exists to avoid.
  assert.match(DIALOG, /className=\{`min-w-0 \$\{FIELD_GROW/);
  // The dialog is opened at the width seven fields on a line actually need.
  assert.match(DIALOG, /size="wide"/, "the card is too narrow for the line it holds");
});

test("the row's furniture is bottom-aligned rather than nudged into place", () => {
  /*
   * The number and the remove button sat on a fixed `mt-7`, which is only ever right while every
   * label on the row is one line high. It is not: "Date of Birth (or) EDOD" and "Next Follow-up
   * Date" wrap at some widths and "Description" does not, so the labels sit at different heights and
   * the number ended up level with a label on one row and with a box on the next.
   *
   * Bottom-aligning needs no guess - the inputs all end at the same line whatever their labels did.
   */
  // Comments stripped: the note explaining why the margin went is allowed to name it.
  const layout = DIALOG.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(layout, /mt-7|mt-6|mt-\[1\.6rem\]/, "the row's furniture is nudged into place with a margin again");
  /*
   * The padding sits on the row's outer box and the alignment on the line of fields inside it.
   * They were one element until the row had to be able to carry a message under itself - a refused
   * duplicate names its number there - and a line added inside a `flex items-end` would have sat
   * beside the fields rather than beneath them.
   */
  assert.match(DIALOG, /return <div className="px-5 py-4">/);
  assert.match(DIALOG, /<div className="flex items-end gap-3">/);
  assert.match(DIALOG, /<span className="hidden min-h-9 w-5 shrink-0 items-center text-xs font-semibold text-slate-400 lg:flex">\{position\}<\/span>/);
  // The remove column is held whether or not the button is in it, so the fields do not shift
  // sideways as rows are added and removed.
  assert.match(DIALOG, /<span className="flex min-h-9 w-9 shrink-0 items-center">/);
});

test("the description is one row tall, and the vertical box is as wide as its choices", () => {
  /*
   * `TextAreaField` floors itself at `min-h-20`, and a plain `min-h-9` beside it is the same
   * specificity and loses on stylesheet order - which is why the description was drawn three times
   * the height of every field it shares a line with. `!min-h-9` is how the rest of this codebase
   * overrides that floor.
   */
  assert.match(DIALOG, /inputClassName="!min-h-9 py-1\.5"/, "the description is taller than the row it sits on again");
  /*
   * And the Vertical box is `w-fit`. Add Lead sets `max-w-2xl`, which is right on a form whose
   * fields are two columns of that width; this card is the full width of a wide dialog, so the same
   * measure left a box stretched across half the screen around three radios.
   */
  assert.match(DIALOG, /options=\{BULK_IMPORT_VERTICALS\} className="w-fit"/, "the vertical box is stretched across the card again");
});

test("Assigned Branch is offered the studio's own branches, all the way down", () => {
  /*
   * The whole chain, because it was cut in the middle and nothing said so: the dialog fetched the
   * branches, the row took them as a prop, and the field was never handed them - so `Dropdown` got
   * the `branchOptions = []` default and drew a picker with nothing in it. Assigned Branch is
   * required, so every batch was unsaveable, on every vertical.
   *
   * Asserted link by link rather than on the end of it. A picker reading `options={branchOptions}`
   * says nothing about whether anything reaches that name.
   */
  assert.match(DIALOG, /const \{ branches: branchOptions \} = useBranchOptions\(\);/, "the dialog no longer fetches the branches");
  assert.match(DIALOG, /<BulkImportRow[\s\S]{0,400}?branchOptions=\{branchOptions\}/, "the rows are not given the branches");
  assert.match(DIALOG, /<BulkImportField[\s\S]{0,300}?branchOptions=\{branchOptions\}/, "the field is not given the branches - Assigned Branch will be empty");
  assert.match(DIALOG, /field\.type === "branch"[\s\S]{0,300}?options=\{branchOptions\}/, "the branch picker is drawn from something other than the fetched list");
  // No default standing in for the fetched list: that is what let the missing prop go unnoticed.
  // The signature itself, not the file - the comment above it names the old default on purpose.
  assert.doesNotMatch(DIALOG, /function BulkImportField\(\{[^}]*branchOptions = \[\]/, "a default is answering for the branches again");
});

test("the submit button says Add, and nothing else", () => {
  // The count is already on screen as the numbered rows, and a button whose words change as the form
  // is filled in is a moving target to aim at. "Add" rather than "Import" since the dialog became
  // Bulk Entry: nothing here takes a file, and the CSV beside it in the ⋮ menu is the one that does.
  assert.match(DIALOG, /<Button variant="primary" disabled=\{saving\}>\{saving \? "Adding\.\.\." : "Add"\}<\/Button>/);
});

test("the row that cannot be removed does not offer a remove button", () => {
  /*
   * The trailing blank cannot be removed: the form puts another one straight back, because there
   * always has to be somewhere to type. A button on it was therefore a control that did nothing when
   * pressed, over and over, with no way to tell that from the form being broken - and it is the one
   * row a person will try to delete, because it is the empty one.
   *
   * Absent rather than disabled, which is this application's rule for a control the reader may not
   * use.
   */
  assert.match(DIALOG, /onRemove=\{rows\.length > 1 && !isBlankBulkImportRow\(row, vertical\) \? \(\) => removeRow\(index\) : null\}/);
});

test("a row keeps its own identity when the one above it is removed", () => {
  /*
   * Keyed by index, removing a row hands its React instance to the row that moves up into its place -
   * so a half-typed phone number, which `PhoneField` keeps in state of its own, appears to jump to
   * the client below. A counter is enough: nothing here is reordered, only added and removed.
   */
  assert.match(DIALOG, /key=\{row\.key\}/, "the rows are keyed by position again");
  assert.match(DIALOG, /const nextKey = useRef\(0\);/);
  assert.match(DIALOG, /key: nextKey\.current \+= 1/);
});

test("the card is as tall as what it holds", () => {
  /*
   * `tall` is for a dialog showing a list - one that must not resize as rows load or are filtered.
   * This is a form that grows one row at a time as somebody types, so a fixed height was a card with
   * a single client's line at the top and two thirds of it empty underneath, which reads as content
   * that failed to load.
   */
  assert.doesNotMatch(DIALOG, /height="(tall|mid)"/, "the card is a fixed height again, with empty space under one client");
});

test("the dialog is built out of Add Lead's own blocks", () => {
  /*
   * The Vertical band above a white Client Details card is Add Lead's shape, and a reader arriving
   * from that dialog should not have to work out where they are. The measures are copied rather than
   * approximated - `rounded-2xl`, the `px-5 py-3` heading rule - so the two read as one form asked
   * twice rather than as two forms that resemble each other.
   */
  assert.match(DIALOG, /<RadioGroupField label="Vertical" value=\{vertical\} onChange=\{changeVertical\} options=\{BULK_IMPORT_VERTICALS\} className="w-fit" \/>/);
  assert.match(DIALOG, /<section className="overflow-hidden rounded-2xl bg-white">/);
  assert.match(DIALOG, /<h3 className="border-b border-slate-200 px-5 py-3 text-lg font-medium text-slate-700">Client Details<\/h3>/);
  // Add Lead draws the same block through the same component, which is what makes the two read
  // alike. The *width* is deliberately this dialog's own - see the `w-fit` note above.
  const page = PAGE.slice(PAGE.indexOf('<RadioGroupField label="Vertical"'));
  assert.match(page, /options=\{\["Dum Dum", "Qua Qua", "Corp"\]\}/, "Add Lead's own Vertical block has moved; this dialog is built to match it");
});

test("every row in a batch is filed under the day the batch was typed", () => {
  /*
   * The dialog asks for no Enquiry Date, so the batch's own day is the only date these leads have -
   * and it is the one every tab on the board files them under. `today` comes from the caller, which
   * mounts the dialog when it is opened, so it is the day the sitting actually happened rather than
   * the day the page was built.
   */
  const [record] = bulkImportRecords(
    [{ ...emptyBulkImportRow({ today: "2026-09-14" }), name: "Anitha", phone: "9876543210", assignedBranch: "Erode" }],
    { vertical: "Dum Dum", today: "2026-09-14" },
  );
  assert.equal(record.lead.createdDate, "2026-09-14");

  // A date typed into a row cannot reach the record, because there is no field to type it into -
  // pinned so that removing the field and leaving a stray reader behind would show up here.
  const [ignored] = bulkImportRecords(
    [{ ...emptyBulkImportRow({ today: "2026-09-14" }), name: "Anitha", phone: "9876543210", assignedBranch: "Erode", createdDate: "2026-09-12" }],
    { vertical: "Dum Dum", today: "2026-09-14" },
  );
  assert.equal(ignored.lead.createdDate, "2026-09-14");

  // And the prefilled follow-up date alone is still not a client - otherwise the trailing blank row
  // the dialog keeps would post itself as a nameless lead.
  assert.equal(isBlankBulkImportRow(emptyBulkImportRow({ today: "2026-09-14" }), "Dum Dum"), true);
});
