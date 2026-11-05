import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/*
 * The tick boxes on every table in the application, and the one permission behind them.
 *
 * `SALES / CRM Lead Select All` and `HRM / Interview Select All` gave two screens a column of
 * boxes; `ADMIN / Table Select All` is the general case underneath them, and it reaches twenty-odd
 * tables at once. That reach is what this file is about: a mistake here is not one screen's, and
 * the two that would matter most - a table left ungated, or a Delete offered on a screen somebody
 * may only read - are both a single line in a page that no other test looks at.
 *
 * Read as source text, the way the table tests beside this one are. The rules themselves live in
 * `tableSelection.js` and are exercised as functions by `interview-select-all.test.mjs`; these are
 * the wiring.
 */

const HERE = import.meta.dirname;
const src = (...parts) => fs.readFileSync(path.join(HERE, "..", "src", ...parts), "utf8");

const HOOK = src("components", "data-table", "useTableSelection.js");
const DATA_TABLE = src("components", "data-table", "DataTable.js");
const ACTIONS = src("components", "data-table", "TableSelectionActions.js");
const HEADER = src("components", "layout", "ModulePageHeader.js");
const SERVICE = src("services", "api", "tableSelection.service.js");

/*
 * Every screen wired to the shared hook, with what it is allowed to do there.
 *
 * `prefix` is the module's API prefix where a selection may be deleted, and `null` where it may
 * only be exported - a directory derived from other modules' records, a register worked by status
 * rather than by deletion. A screen moving from the second list to the first is a new destructive
 * act on a screen that had none, which is a decision rather than a wiring change, so it is taken
 * here in the open.
 */
const WIRED = [
  ["components/assets/AssetManagementPage.js", "/api/assets"],
  ["components/assets/VendorManagementView.js", "/api/vendors"],
  ["components/assets/ClientStorageManagementView.js", "/api/client-storage"],
  ["components/employees/EmployeeVerificationPage.js", "/api/hrm/employees"],
  ["components/hrm/TasksPage.js", "/api/hrm/tasks"],
  ["components/accounts/AccountsManagerPage.js", "/api/accounts/cash-entries"],
  ["components/project-management/ProjectsPage.js", "/api/sales/projects"],
  ["components/sales/SalesManagerPage.js", "/api/sales/projects"],
  ["components/sales/QuotationPage.js", "/api/sales/quotations"],
  ["components/admin/UserManagement.js", "/api/admin/users"],
  ["components/admin/RoleManagement.js", "/api/admin/roles"],
  ["components/contacts/ContactsPage.js", null],
  ["components/hrm/EmployeeReferralsPage.js", null],
  ["components/hrm/AttendanceRegisterPage.js", null],
  ["components/hrm/EmployeeAttendancePage.js", null],
  ["components/project-management/ClientGiftsPage.js", null],
  ["components/sales/CrdDocumentsPage.js", null],
  ["components/accounts/PaymentRequestsPage.js", null],
];

// ── the permission ───────────────────────────────────────────────────────────────────────────

/*
 * One permission, asked in one place.
 *
 * Every table's boxes come from this hook, so this single line is what decides whether the whole
 * application has them. A page asking the question itself would be a page that can answer it
 * differently, which is how a screen ends up with tick boxes somebody's role never granted.
 */
test("the boxes are gated on ADMIN / Table Select All, in the hook and nowhere else", () => {
  assert.match(HOOK, /useModuleAccess\("ADMIN", "Table Select All"\)/);
  for (const [file] of WIRED) {
    assert.doesNotMatch(src(...file.split("/")), /useModuleAccess\("ADMIN", "Table Select All"\)/,
      `${file} asks the permission itself instead of letting the hook answer`);
  }
});

/*
 * Absent, not disabled. CLAUDE.md Rule 4: a control the viewer may not use is not shown at all, and
 * `selection` being `undefined` is what makes `features={{ selection }}` draw no column - so a page
 * needs no condition of its own and cannot forget one.
 */
test("without the permission the hook hands back nothing, so no column is drawn", () => {
  assert.match(HOOK, /const selection = useMemo\(\(\) => \(canSelect \? \{/);
  assert.match(HOOK, /\} : undefined\)/);
  /*
   * The column is drawn for a table that hands back a selection **either way** it can express one:
   * the plain set of ids every client-side table uses, or the `model` a paged table passes because
   * the set of ids is not its selection - it has only rendered what was scrolled into view.
   */
  assert.match(DATA_TABLE, /const selectable = Boolean\(\(selectedIds && onSelectionChange\) \|\| selectionModel\)/);
});

/*
 * Deleting a selection asks for the screen's own Read / Write **as well**. `ADMIN / Table Select
 * All` says this reader may act on a selection; it never says which rows are theirs, and it must
 * not become a way around a screen somebody may only read.
 */
test("Delete is offered only where the screen's own write permission is held", () => {
  assert.match(HOOK, /const deletable = canDelete && Boolean\(prefix \|\| customDelete\)/);
  assert.match(HOOK, /onDelete: deletable \? runDelete : undefined/);
  // And every screen that offers a delete passes its own answer rather than defaulting to true.
  for (const [file, prefix] of WIRED) {
    if (!prefix) continue;
    const page = src(...file.split("/"));
    const hook = page.slice(page.indexOf("useTableSelection({"));
    assert.match(hook, /canDelete: can\w+/, `${file} offers a bulk delete without naming a write permission`);
  }
});

// ── what each screen is wired to ─────────────────────────────────────────────────────────────

test("every wired screen reads the shared hook rather than rolling its own selection", () => {
  for (const [file] of WIRED) {
    const page = src(...file.split("/"));
    assert.match(page, /import useTableSelection from "@\/components\/data-table\/useTableSelection"/, `${file} does not import the hook`);
    assert.match(page, /useTableSelection\(\{/, `${file} imports the hook and never calls it`);
  }
});

test("a screen deletes against its own module's prefix, and a derived one deletes nothing", () => {
  for (const [file, prefix] of WIRED) {
    const page = src(...file.split("/"));
    if (prefix) {
      assert.ok(page.includes(`prefix: "${prefix}"`), `${file} should delete against ${prefix}`);
    } else {
      /*
       * No prefix and no `onDelete`, so the bar offers Export alone. These are registers with no
       * delete on the server at all - a contact is whatever phone number a record elsewhere
       * carries, an attendance row is a day as it was marked - and inventing one here would be a
       * destructive act on a screen that has never had one.
       */
      const hook = page.slice(page.indexOf("useTableSelection({"));
      const call = hook.slice(0, hook.indexOf("});") + 3);
      assert.doesNotMatch(call, /prefix:/, `${file} is a read-only register and must not delete`);
      assert.doesNotMatch(call, /onDelete:/, `${file} is a read-only register and must not delete`);
    }
  }
});

/*
 * The two registers whose delete carries a reason.
 *
 * A vendor and a client storage record are removed *with a reason on them* - the module's
 * `deleteInput` refuses a body without one, and the audit row is what carries it. A bulk delete
 * that skipped the prompt would either be refused for the whole selection or, worse, write an empty
 * reason against every row.
 */
test("a removal that needs a reason asks for one over a selection too", () => {
  for (const file of ["components/assets/VendorManagementView.js", "components/assets/ClientStorageManagementView.js"]) {
    assert.match(src(...file.split("/")), /requireReason: true/, `${file} removes records without asking why`);
  }
  assert.match(DATA_TABLE, /confirmDisabled=\{selectionRequiresReason && !selectionReason\.trim\(\)\}/);
  assert.match(HOOK, /reason \? \{ reason \} : undefined/);
});

/*
 * The Employee Repository lists onboarding invites beside employees, and an invite is not a row of
 * the employee register: its id is `invite:<id>`, it is withdrawn rather than deleted, and sending
 * one to `/api/hrm/employees/bulk` could only ever be rejected. It gets no box at all.
 */
test("a table mixing records with rows it cannot act on draws boxes only on the records", () => {
  const page = src("components", "employees", "EmployeeVerificationPage.js");
  assert.match(page, /const isEmployeeRow = \(row\) => row\?\.type !== "invite"/);
  assert.match(page, /canSelectRow: isEmployeeRow/);
  // Excluded from the boxes, from the header's select-all, and from what the bar acts on.
  assert.match(DATA_TABLE, /if \(canSelectRow && !canSelectRow\(row\.original\)\) return null;/);
  assert.match(DATA_TABLE, /row\.depth === 0 && \(!canSelectRow \|\| canSelectRow\(row\.original\)\)/);
  /*
   * Asked of the **model** rather than of a set of ids, because a paged table's selection is not a
   * set: it is "everything this stage matches, less these exceptions", and only the page can say
   * whether a given row is in it. `canSelectRow` still joins the filter either way.
   */
  assert.match(DATA_TABLE, /resolvedSelection\.isSelected\(rowKey\(row\)\) && \(!canSelectRow \|\| canSelectRow\(row\.original\)\)/);
});

// ── what a selection leads to ────────────────────────────────────────────────────────────────

/*
 * The buttons are in the module header, where the screen's own actions are, rather than in a bar
 * over the page. One implementation still reaches twenty-odd differently shaped pages, because the
 * shell holds the provider, the header offers a slot and the table portals into it - so no page
 * wires any of it up and none of them can drift.
 */
test("a selection's buttons are handed to the module header rather than drawn over the page", () => {
  // The shell mounts it once, above every header and every table.
  assert.match(src("components", "app-shell", "AppShell.js"), /<SelectionActionsProvider>/);
  assert.match(HEADER, /\{selection && <TableSelectionActions \{\.\.\.selection\} \/>\}/);
  // `publishSelectionActions`: on unless a page draws its own actions over a selection - the CRM
  // board's Update Details - which the header would otherwise replace the moment a row was ticked.
  assert.match(DATA_TABLE, /useSelectionActions\(useMemo\(\(\) => \(selectionCount && publishSelectionActions \?/);
  assert.match(DATA_TABLE, /const publishSelectionActions = features\.selection\?\.publish !== false;/);
});

/*
 * And they arrive in the same commit the screen's own actions leave in.
 *
 * The header can only be told to stand its actions down from an effect, so a table that drew its
 * buttons on the render before that landed put them *beside* the Add button for one frame: the row
 * grew, everything shifted right, and then the Add button disappeared from under the reader. The
 * portal waits for its own claim, which makes the swap one change rather than two.
 */
test("the buttons appear exactly as the ones they replace go, not a frame earlier", () => {
  // One state update carries both halves of the swap: the header draws the published buttons and
  // drops its own from the same render, so the row never shows both and never changes width twice.
  assert.match(HEADER, /\{selection && !ownsSelectionActions \? null : actions\}\{selection &&/);
});

/*
 * And at the height every other button in that row is held to.
 */
test("a selection's buttons are the same height as the ones they stand in for", () => {
  const css = fs.readFileSync(path.join(HERE, "..", "src", "app", "globals.css"), "utf8");
  // The rule is a child combinator, so these buttons have to be the header's own children. Handed
  // over as props they are exactly that; portalled into a wrapper they were grandchildren, missed
  // the rule, and stood four pixels taller than the Add button they replace.
  assert.match(css, /\.module-page-header-actions > button \{/);
  assert.doesNotMatch(ACTIONS, /createPortal/, "portalled buttons are not children of the header and miss its sizing");
  assert.match(ACTIONS, /export default function TableSelectionActions\(\{ count/);
  assert.match(ACTIONS, /return <>/);
});

/*
 * The same rule read from the other end: **a page may not wrap its own actions either.**
 *
 * `.module-page-header-actions > button` is a child combinator, so it sizes the header's own
 * children and nothing deeper. A page handing its buttons over inside a `<div>` of its own makes
 * them grandchildren - they miss the rule, keep Tailwind's taller default, and the title bar stands
 * a step too tall. Nobody notices until a selection replaces those buttons with ones that *are*
 * children, and the bar visibly shrinks as rows are ticked. Payment Requests shipped exactly that.
 *
 * A component whose own root element is the button - `ImportMenuButton`, an `IconButton` - is fine
 * and is why this looks for a wrapper rather than insisting on a fragment.
 */
test("no page wraps its header actions, which would cost them the header's sizing", () => {
  const wrapped = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!entry.name.endsWith(".js")) continue;
      // A lowercase tag straight after `actions={<` is a plain container; `<>` is a fragment and
      // an uppercase tag is a component that renders its own button.
      if (/actions=\{<[a-z]/.test(fs.readFileSync(full, "utf8"))) wrapped.push(path.relative(path.join(HERE, ".."), full));
    }
  };
  walk(path.join(HERE, "..", "src", "components"));
  assert.deepEqual(wrapped, [], "these pass their header actions inside a wrapper, so the buttons are grandchildren of .module-page-header-actions and miss its height");
});

/*
 * And the screen's own actions stand down while they are there. Two sets of buttons side by side
 * would put an action on thirty rows beside one that adds a thirty-first.
 */
test("the page's own actions step aside for a selection, unless the page swaps them itself", () => {
  assert.match(HEADER, /selection && !ownsSelectionActions \? null : actions/);
  // The Interview register puts Delete and Change Stage where Add Application stands, so it keeps
  // drawing its own and takes Export and Clear beside them.
  assert.match(src("components", "hrm", "InterviewPage.js"), /ownsSelectionActions/);
});

/*
 * Which is only possible where there *is* a header. Every screen wired to the hook draws one, or -
 * Users and Roles - is a tab inside a page that does; a twentieth that does not would have nowhere
 * to put its buttons and would silently lose them.
 */
test("every screen with tick boxes has a module header for them to appear in", () => {
  const inAdminPage = ["components/admin/UserManagement.js", "components/admin/RoleManagement.js"];
  for (const [file] of WIRED) {
    if (inAdminPage.includes(file)) continue;
    assert.match(src(...file.split("/")), /<ModulePageHeader/, `${file} has tick boxes and no module header to draw their actions in`);
  }
  // The two that do not are tabs inside this one, whose header is the one on screen.
  assert.match(src("components", "admin", "AdminPage.js"), /<ModulePageHeader/);
});

test("Export writes the ticked rows through the table's own exporter, not a second one", () => {
  // The same columns and the same file name as the ⋮ menu's Export, over fewer rows: only the table
  // knows which columns survived Manage Columns and what each cell actually says.
  assert.match(DATA_TABLE, /async function exportRows\(rowsToExport\) \{/);
  assert.match(DATA_TABLE, /const originals = \(rowsToExport \|\| allRows\)\.map\(\(row\) => row\.original\)/);
  assert.match(DATA_TABLE, /await exportRows\(selectedTableRows\)/);
});

test("a bulk delete is asked for once, over the whole set", () => {
  assert.match(DATA_TABLE, /remove: \(\) => \{ setSelectionReason\(""\); setPendingSelectionDelete\(true\); \}/);
  assert.match(DATA_TABLE, /onDelete: deletableSelection \? deleteSelection : undefined/);
  assert.match(DATA_TABLE, /\{pendingSelectionDelete && <ConfirmDialog/);
});

/*
 * The count the bar shows is read against every row the table *holds*, not the ones surviving its
 * column filters - because a tick is not dropped by a filter typed after it. Counting the filtered
 * set would show "3 selected" over a bar that then deleted seven.
 */
test("the count and the delete agree about which rows are ticked", () => {
  assert.match(DATA_TABLE, /table\.getCoreRowModel\(\)\.rows/);
  /*
   * The drawn-and-ticked rows for a table that holds all of them - and for a paged one, what its
   * model answers, because "everything this stage matches" is a number only the page knows and is
   * never the length of what has been scrolled into view.
   */
  assert.match(DATA_TABLE, /const selectionCount = selectable \? \(resolvedSelection\.count\?\.\(\) \?\? selectedTableRows\.length\) : 0;/);
  assert.match(DATA_TABLE, /onSelectionDelete\(selectedTableRows\.map\(\(row\) => row\.original\)/);
});

/*
 * Only the rows that actually went lose their tick. What is left ticked is precisely what the
 * server would not delete, so the bar still reads a count, the reader can see which rows those
 * were, and a second press retries that part rather than the whole selection again.
 */
test("a partial delete clears the ticks it earned and keeps the rest", () => {
  assert.match(HOOK, /const gone = new Set\(deleted\)/);
  assert.match(HOOK, /setSelectedIds\(\(current\) => new Set\(\[\.\.\.current\]\.filter\(\(id\) => !gone\.has\(id\)\)\)\)/);
  assert.match(HOOK, /could not be deleted and \$\{left === 1 \? "was" : "were"\} left alone/);
});

test("a selection larger than one request is chunked rather than refused", () => {
  // `services/bulkDelete.js` caps a request at 500; sending 600 in one go would be a refusal the
  // reader can do nothing about.
  assert.match(HOOK, /const CHUNK = 500;/);
  assert.match(HOOK, /for \(let at = 0; at < ids\.length; at \+= CHUNK\)/);
});

test("the delete goes to the one endpoint every module mounts", () => {
  assert.match(SERVICE, /apiRequest\(`\$\{prefix\}\/bulk`, \{ method: "DELETE"/);
  assert.match(SERVICE, /JSON\.stringify\(\{ ids, \.\.\.\(extra \|\| \{\}\) \}\)/);
});

// ── the parts that would quietly cost something ──────────────────────────────────────────────

/*
 * `DataTable` rebuilds its whole column list whenever `selection` changes, and pages write their
 * callbacks inline - `onDeleted: () => load()` is the honest way to say it. Depended on directly,
 * an inline arrow would make `selection` new on every render, and every table in the application
 * would rebuild every column on every keystroke in a filter box.
 */
test("the hook survives the inline callbacks every page passes it", () => {
  assert.match(HOOK, /const handlers = useRef\(\{ rowId, customDelete, onDeleted, showSuccess, showError \}\)/);
  // The memo may only depend on plain values, never on the functions held in the ref.
  const deps = HOOK.match(/\} : undefined\), \[([^\]]+)\]\);/);
  assert.ok(deps, "the selection memo is no longer where this test looked for it");
  for (const forbidden of ["onDeleted", "showSuccess", "showError", "customDelete", "rowId"]) {
    assert.equal(deps[1].includes(forbidden), false, `selection depends on ${forbidden}, which is new every render`);
  }
});

/*
 * Ticking a row must not also open it. The row underneath answers a click by opening the info panel
 * and a double-click by opening the record in full, and they are two events - stopping one does not
 * stop the other.
 */
test("the tick box swallows the clicks the row would otherwise answer", () => {
  assert.match(DATA_TABLE, /onClick=\{\(event\) => event\.stopPropagation\(\)\} onDoubleClick=\{\(event\) => event\.stopPropagation\(\)\}/);
});

/*
 * The Schedule used to be its own `<table>`, like the CRM board, and drew its tick boxes by hand
 * to the shared rules. It draws through `DataTable` now, so what is pinned is that it hands the
 * table a selection rather than a copy of one - and that the copy is gone.
 */
test("the Schedule hands its selection to the table rather than drawing its own", () => {
  const page = src("components", "sales", "MeetingsPage.js");
  assert.match(page, /useModuleAccess\("ADMIN", "Table Select All"\)/);
  assert.match(page, /selection: canSelectRows \? \{ selectedIds, onChange: setSelectedIds, noun: "meeting", rowLabel: scheduleRowLabel \} : undefined,/);
  // Export only, over the ticked rows: the table's own export calls back with the rows it holds,
  // and no `onDelete` is passed, so no Delete is offered - there is no endpoint for one.
  assert.match(page, /csvExport: \{ enabled: true, onExport: exportMeetingsCsv \}/);
  assert.doesNotMatch(page, /onDelete:/);
  // The hand-drawn copy is gone with the table it drew.
  assert.doesNotMatch(page, /useSelectionActions|selectionHeaderState|toggleAllIds/);
});
