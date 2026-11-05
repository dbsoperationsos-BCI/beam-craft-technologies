import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { FIELD_LISTS, FIELD_LIST_SCREEN_IDS, fieldListsForScreen } from "../src/constants/moduleFieldLists.js";
import { SIDEBAR_MODULES, SIDEBAR_PARENT_BY_ITEM } from "../src/constants/navigation.mjs";

/*
 * Settings -> Field Settings: the HRM lists, and the search over them.
 *
 * The editor could be read and never added to. It posts `{ name }` - a designation is a name, and
 * the `code` beside it in the table is a machine key no screen shows - while the endpoint's create
 * schema demanded one, so every Add came back as a validation error naming a field this screen does
 * not have. The mint moved to the server, so the screen's job is to keep sending the name.
 *
 * The search is the other half of the request: these lists run to thirty entries and had no way to
 * find one. It filters what is already loaded, so it answers on the keystroke.
 *
 * Reads the source, the way the other settings tests here do: there is no DOM in this suite.
 */

const HERE = import.meta.dirname;
const read = (...parts) => fs.readFileSync(path.join(HERE, "..", "src", ...parts), "utf8");

const EDITOR = read("components", "shared", "HrmOptionListEditor.js");
const OVERLAY = read("components", "settings", "SettingsOverlay.js");

test("every list the studio maintains is offered under HRM", () => {
  /*
   * Four of these were maintainable and the rest were arrays compiled into the browser, which no
   * studio could edit: a work location could not be added, a status could not be retired, and a
   * gender the form offered was refused by the server. Blood group and the languages were the last
   * two to come across - blood group had no table at all, and `language` had one that nothing had
   * ever written a row to. Asserted as the whole set rather than a minimum, so a list quietly
   * dropping off this screen is a failure rather than something nobody notices.
   */
  const offered = fieldListsForScreen("employee-repository").map((item) => item.value).sort();
  assert.deepEqual(offered, [
    "blood-groups", "client-designations", "departments", "designations", "emergency-contact-relationships",
    "employee-statuses", "genders", "languages", "marital-statuses", "skills", "verticals",
    "work-locations", "work-types",
  ]);
  // Each carries the singular the Add box and every message are worded from.
  for (const item of FIELD_LISTS) {
    assert.ok(item.label && item.singular, `${item.value} has no label or singular to word its Add box with`);
    assert.ok(item.screens?.length, `${item.value} names no screen, so no picker can reach it`);
  }
});

test("every screen a list names is one the sidebar actually has", () => {
  /*
   * The two pickers above the field are the sidebar registry itself, so a list filed under a screen
   * id the registry does not have is a list nobody can ever reach - and nothing would say so. This
   * is what stops a screen renamed or retired in `navigation.mjs` from stranding one silently.
   */
  for (const screenId of FIELD_LIST_SCREEN_IDS) {
    assert.ok(SIDEBAR_PARENT_BY_ITEM[screenId], `no sidebar screen is called "${screenId}"`);
  }
});

test("the module and screen pickers are the sidebar's, not a second list of their own", () => {
  // Written down once. A module added to the hamburger has to reach this screen without anybody
  // editing it, which is only true while the picker reads the registry.
  const panel = read("components", "settings", "FieldSettingsPanel.js");
  assert.match(panel, /SIDEBAR_MODULES/, "the Module picker no longer reads the sidebar registry");
  assert.doesNotMatch(panel, /import \{ OS_MODULES \}/, "the Module picker is back on Table Settings' own module list");
  assert.match(panel, /fieldListsForScreen\(screenId\)/, "the Field picker is not narrowed to the chosen screen");
  // Three pickers, in the order somebody walks the hamburger.
  for (const label of ["Module", "Screen", "Field"]) {
    assert.match(panel, new RegExp(`label="${label}"`), `the ${label} picker is missing`);
  }
  /*
   * The two registry pickers are handed their options unsorted. `Dropdown` alphabetises by default,
   * which would put Accounts above HRM and Employee Attendance above Employee Repository - an order
   * nobody sees in the hamburger, on the one screen whose whole point is matching it.
   */
  // Counted as JSX props on their own line - the comment above them says the words too.
  assert.equal((panel.match(/^\s+sorted=\{false\}$/gm) || []).length, 2, "the Module and Screen pickers must keep the sidebar's own order");
});

test("a screen with no lists is still offered, and says it has none", () => {
  // The picker describes the same application the hamburger does. Hiding the screens with nothing
  // to edit would make the two disagree about what the studio has.
  const withLists = new Set(FIELD_LIST_SCREEN_IDS);
  const everyScreen = SIDEBAR_MODULES.flatMap((group) => group.items.map((item) => item.id));
  const withoutLists = everyScreen.filter((id) => !withLists.has(id));
  assert.ok(withoutLists.length, "this test is pointless if every screen has a list");
  // Whichever screen currently has none, rather than one named here: a list added to the named one
  // used to fail this test for no reason but its own example going out of date.
  assert.deepEqual(fieldListsForScreen(withoutLists[0]), [], "a screen with no lists must answer with none rather than throw");
  assert.deepEqual(fieldListsForScreen(""), [], "no screen chosen is no lists");
  const panel = read("components", "settings", "FieldSettingsPanel.js");
  assert.match(panel, /has no fields whose answers are set up here/, "a screen with no lists says nothing about it");
});

test("a list used on two screens is offered under both", () => {
  /*
   * One list, offered wherever it takes effect. Relationship is asked for on Add Lead and on the
   * quotation's Client Details, and filing it under one of them would leave somebody hunting for it
   * from the other - it is the same rows and the same endpoint either way.
   */
  for (const [value, screens] of [
    ["lead-relationships", ["leads-followups", "quotations"]],
    ["referral-sources", ["leads-followups", "quotations"]],
    ["payment-schedule-categories", ["bookings-converted", "projects"]],
    ["payment-modes", ["accounts-manager", "projects"]],
  ]) {
    for (const screen of screens) {
      assert.ok(fieldListsForScreen(screen).some((item) => item.value === value),
        `${value} is not offered under ${screen}`);
    }
  }
});

test("adding sends the name and lets the server mint the key", () => {
  /*
   * Not a `code` derived here. The three other screens that write these rows each derive one of
   * their own, which is what let this screen forget: the server mints it now, so there is one rule
   * and no screen has to know it.
   */
  /*
   * Through `masterDataApi`, the editor's default source. It takes its four calls as a prop now,
   * so a list living somewhere other than the HRM master data - the quotation brands keep their
   * shoots on the brand - borrows this same screen instead of growing a second one beside it.
   * What is asserted is unchanged: the Add posts the name and nothing else.
   */
  assert.match(EDITOR, /add: \(resource, name\) => saveMasterData\(resource, \{ name \}\)/, "the Add no longer posts the name");
  assert.match(EDITOR, /await api\.add\(resource, value\)/, "the Add no longer goes through the editor's data source");
});

test("the list can be searched, and the search is what the rows are drawn from", () => {
  // A filter nothing reads is the shape this bug would take next: the box exists, the list ignores it.
  assert.match(EDITOR, /const shown = useMemo\(/, "there is no filtered list");
  assert.match(EDITOR, /\{shown\.map\(\(record\) =>/, "the rows are drawn from the unfiltered list, so the search does nothing");
  assert.doesNotMatch(EDITOR, /\{records\.map\(\(record\) =>/);
  // Matched on the name, which is the only thing this screen shows.
  assert.match(EDITOR, /String\(record\.name \|\| ""\)\.toLowerCase\(\)\.includes\(needle\)/);
  assert.match(EDITOR, /aria-label=\{`Search \$\{label\.toLowerCase\(\)\}`\}/);
});

test("a search says how much of the list it is showing, and empties honestly", () => {
  // "3 of 30 shown" rather than "3 in the list": a filtered list must not read as a list that has
  // lost entries.
  //
  // Counted off `rows` - the staged copy where a list is staged, the server's own rows everywhere
  // else, and in both cases the very thing the list below is drawn from. Counting `records` instead
  // would leave an entry just added out of its own list's count until it had been saved.
  assert.match(EDITOR, /searching \? `\$\{shown\.length\} of \$\{rows\.length\} shown` : `\$\{rows\.length\} in the list`/);
  // And no match is not the same as nothing added - the way back is to clear the box.
  assert.match(EDITOR, /Nothing here matches/);
  assert.match(EDITOR, /Nothing in this list yet/);
});

test("the search does not outlive the list it was typed against", () => {
  /*
   * Both resets sit in the deferred callback rather than in an effect body: setting state
   * synchronously in an effect is the cascading render React warns about, and the load beside them
   * is deferred for exactly that reason.
   */
  const effect = EDITOR.slice(EDITOR.indexOf("const timer = setTimeout("), EDITOR.indexOf("}, [load]);"));
  assert.match(effect, /setQuery\(""\)/, "the search survives a change of Field, hiding most of the next list");
  assert.match(effect, /setEditing\(null\)/, "a half-typed rename survives a change of Field");
  // And an add clears it, or the entry just made is filtered out of the list it was added to.
  assert.match(EDITOR.slice(EDITOR.indexOf("async function add(")), /setName\(""\);[\s\S]{0,600}setQuery\(""\);/);
});

test("Field Settings is offered to whoever the endpoint lets write, not to whoever holds the CRM", () => {
  /*
   * It edits HRM master data, and `/api/hrm/<resource>` gates every write on
   * `HRM / Employee Management` READ_WRITE. It used to sit in the `SALES / CRM Leads` block beside
   * Table Settings, so the screen and the endpoint disagreed both ways round: the CRM manager was
   * shown an editor whose every Add came back 403, and the HR manager who maintains these lists
   * could not reach the section at all.
   *
   * Both permissions now, since Settings became a module of its own: `SETTINGS / Field Settings`
   * decides whether the rail lists the section, and `HRM / Employee Management` still decides
   * whether it saves - because `/api/hrm/<resource>` is shared with every screen that reads those
   * lists and cannot be narrowed to a Settings row without taking them with it. The Settings row can
   * only ever withhold the section, never open one the server would refuse.
   */
  assert.match(OVERLAY, /const \{ canWrite: canWriteEmployeeLists \} = useModuleAccess\("HRM", "Employee Management"\);/);
  assert.match(OVERLAY, /const \{ canWrite: canWriteFieldSettings \} = useModuleAccess\("SETTINGS", "Field Settings"\);/);
  assert.match(OVERLAY, /\.\.\.\(canWriteEmployeeLists && canWriteFieldSettings \? \[\{\s*id: "field-settings"/);
});

test("every change says so on the application's own snackbar", () => {
  /*
   * A screen with no Save has nothing to press and nothing to grey out, so an entry that was added
   * and an entry that was refused looked identical - the box cleared either way. `FloatingNotice`
   * is the component the rest of the OS answers on, and Employee Settings already raises it for the
   * same four lists, so both ways into them behave alike.
   */
  assert.match(EDITOR, /import FloatingNotice, \{ useNotice \} from "@\/components\/shared\/FloatingNotice";/);
  assert.match(EDITOR, /<FloatingNotice notice=\{notice\} onClose=\{clearNotice\} \/>/, "the editor raises no snackbar");

  // All three actions, in both outcomes: a success nobody sees and a failure nobody sees are the
  // same bug.
  assert.match(EDITOR, /showSuccess\(`\$\{value\} added to \$\{label\}\.`\)/);
  // Still both names, and now the server's own sentence after it where there was one: renaming an
  // entry rewrites that word on every record holding it, which is not a thing to do silently.
  assert.match(EDITOR, /const renamed = previous && previous !== value \? `\$\{previous\} renamed to \$\{value\}\.`/);
  assert.match(EDITOR, /showSuccess\(response\?\.message \? `\$\{renamed\} \$\{response\.message\}` : renamed\)/,
    "a rename no longer reports how many records it rewrote");
  assert.match(EDITOR, /showSuccess\(`\$\{record\.name\} removed from \$\{label\}\.`\)/);
  for (const verb of ["add", "rename", "remove"]) {
    assert.match(EDITOR, new RegExp(`showError\\(error\\?\\.message \\|\\| \`Unable to ${verb} that`), `${verb} still fails silently`);
  }
  // And it is raised only after the list has been re-read, so the message and the rows agree.
  assert.match(EDITOR, /await load\(\);\s*showSuccess/);
});

test("a list that could not be loaded is not left to a bar that fades", () => {
  /*
   * The one thing that is not an action. A failed load describes the state of the whole section -
   * the rows are missing, and the empty state would otherwise read "nothing in this list yet",
   * which is a different and untrue statement - so it stays on the panel's own notice line through
   * `onError` rather than on a snackbar that clears itself after five seconds.
   */
  assert.match(EDITOR, /onError\?\.\(error\?\.message \|\| `Unable to load the \$\{label\.toLowerCase\(\)\}\.`\)/);
});
