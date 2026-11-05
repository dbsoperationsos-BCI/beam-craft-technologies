import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const PANEL = fs.readFileSync(new URL("../src/components/settings/EmployeeWhatsAppGroupsPanel.js", import.meta.url), "utf8");
const TABLE = fs.readFileSync(new URL("../src/components/settings/DepartmentWhatsAppGroupsTable.js", import.meta.url), "utf8");
const DIALOG = fs.readFileSync(new URL("../src/components/settings/DepartmentGroupsEditDialog.js", import.meta.url), "utf8");
const SERVICE = fs.readFileSync(new URL("../src/services/hrm/whatsapp-groups.service.js", import.meta.url), "utf8");
const code = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "").replace(/^\s*\/\/.*$/gm, "");

/*
 * Settings → Employee → WhatsApp Groups, read one row per department with its groups comma
 * separated, and changed from the row's ⋮ → Edit. This is the list onboarding reads to know which
 * groups a new employee belongs in.
 */

test("the row is a department, and its groups are one comma-separated cell", () => {
  assert.match(TABLE, /\["departmentName", "Department"/);
  assert.match(TABLE, /\["groupNames", "WhatsApp Groups"/);
  assert.match(SERVICE, /export const getDepartmentWhatsAppGroups = \(\) => apiRequest\(`\$\{base\}\/department-groups`\)/);
  // Joined on the server, so the table's search and its CSV read the same text the cell shows.
  assert.doesNotMatch(code(TABLE), /\.join\(", "\)/, "the cell is handed over ready, not built here");
});

test("the section is wide, which is what the blank strip down the right really was", () => {
  /*
   * `SchemaFormSection` caps at `max-w-[1040px]` unless the section asks to be wide - right for a
   * form, wrong for a table, and it ended the table halfway across the pane. `layout: "fill"` looked
   * like the answer but only bites on a fixed layout (a resized column, or a server-paged table), so
   * it did nothing here: the table was already `w-full` inside a container that was not.
   */
  const overlay = fs.readFileSync(new URL("../src/components/settings/SettingsOverlay.js", import.meta.url), "utf8");
  assert.match(overlay, /id: "employee-whatsapp-groups",\n\s+title: "WhatsApp Groups",\n\s+\/\/[^\n]*\n\s+wide: true,/);
  assert.doesNotMatch(code(TABLE), /layout: "fill"/, "which the table no longer pretends to need");
});

test("it is a real table, not a hand-rolled list", () => {
  // Rule 1: the filtering, sorting, column visibility and CSV are the shared table's, not retyped.
  assert.match(TABLE, /import DataTable from "@\/components\/data-table\/DataTable"/);
  assert.match(TABLE, /buildTableColumns\(\{/);
  assert.match(TABLE, /csvExport: \{ enabled: true/);
  assert.doesNotMatch(code(TABLE), /<table|<tbody|<ul[\s>]/, "no markup is typed for what DataTable does");
});

test("every department is a row, including one with no groups", () => {
  // A department missing from the table is one nobody would think to give groups to.
  assert.match(TABLE, /emptyMessage="No departments yet\./);
  assert.match(PANEL, /rows=\{rows \|\| \[\]\}/);
});

test("the menu opens above the Settings overlay it lives inside", () => {
  /*
   * `OptionsMenu` defaults to `layers.menu` (60), which is right for a ⋮ on a page. Settings is a
   * form panel at 110, so the menu opened *underneath* it - the ⋮ looked pressed and nothing
   * appeared, which reads exactly like a menu with no items in it.
   *
   * Derived from `layers.formPanel` rather than typed, so the overlay moving takes the menu with it.
   */
  assert.match(TABLE, /import \{ layers \} from "@\/constants\/layers"/);
  // The layer the app already keeps for a menu opened from inside a panel, not a number worked out.
  assert.match(TABLE, /const MENU_Z = Number\(layers\.menuOverPanel\.replace\(\/\\D\/g, ""\)\);/);
  assert.match(TABLE, /<OptionsMenu[^>]*zIndex=\{MENU_Z\}/);
});

test("the three dot menu is where a department's groups are changed", () => {
  assert.match(TABLE, /renderActions:\s*\n?\s*items/);
  assert.match(TABLE, /<OptionsMenu ariaLabel=\{`Actions for \$\{row\.departmentName\}`\}/);
  assert.match(PANEL, /\{ label: "Edit", onSelect: \(\) => setEditing\(department\) \}/);
  // A double click opens the same editor, as it does on every table here.
  assert.match(TABLE, /onRowDoubleClick=\{onOpen \? \(row\) => onOpen\(row\) : undefined\}/);
});

test("a reader who may not edit gets a menu that says so", () => {
  // Rather than one that opens onto nothing, and rather than a control that refuses on press.
  assert.match(PANEL, /Only someone who can edit employees changes these/);
  assert.match(PANEL, /disabled: true/);
  assert.match(PANEL, /onOpen=\{canWrite \? setEditing : undefined\}/);
});

test("the dialog opens above the Settings panel it was opened from", () => {
  /*
   * `Dialog` defaults to the page's dialog layer (100), which is *under* the form panel (110): the
   * dialog opened and was painted behind the thing that asked for it, so Edit appeared to do
   * nothing - the same way the ⋮ appeared to do nothing before it. Every other dialog opened from a
   * settings panel passes this.
   */
  assert.match(DIALOG, /layer="dialogOverPanel"/);
});

test("Edit adds and removes in one place, saving each change as it is made", () => {
  assert.match(DIALOG, /await addGroupToDepartment\(department\.id, name\.trim\(\)\)/);
  assert.match(DIALOG, /await removeGroupFromDepartment\(department\.id, group\.id\)/);
  assert.match(SERVICE, /addGroupToDepartment = \(departmentId, name\) =>/);
  assert.match(SERVICE, /removeGroupFromDepartment = \(departmentId, groupId\) =>/);
  // Each change is one row written; there is no half-finished list worth gathering behind a Save.
  assert.doesNotMatch(code(DIALOG), /Save|pending|draft/i);
});

test("adding attaches a group the studio already uses, rather than refusing the name", () => {
  // A group's name is unique because it is one group on WhatsApp.
  assert.match(DIALOG, /A group the studio already uses is put under this department too/);
});

test("removing keeps the group, and the dialog says so", () => {
  assert.match(DIALOG, /is no longer under \$\{department\.departmentName\}\. The group itself is kept/);
});

test("the dialog says what the list is for, and what editing it does not do", () => {
  /*
   * The one thing the screen cannot show: editing this changes what happens the *next* time somebody
   * joins or leaves. Without saying so, a person could reasonably expect Remove to take the staff
   * out of the group on WhatsApp.
   */
  assert.match(DIALOG, /Nobody is added or removed on WhatsApp by changing this list/);
  assert.match(PANEL, /nobody is added or removed on WhatsApp by editing it/);
  assert.match(DIALOG, /No groups under \{department\.departmentName\} yet, so onboarding adds nobody/);
});

test("an open dialog is refreshed from the answer, not re-read", () => {
  // So adding two groups in a row shows the first without the dialog closing and reopening.
  assert.match(PANEL, /setEditing\(\(open\) => \(open \? next\.find\(\(row\) => row\.id === open\.id\) \|\| null : null\)\)/);
});

test("the dialog reads at phone width", () => {
  assert.match(DIALOG, /className="flex flex-wrap items-end gap-2"/);
  assert.match(DIALOG, /className="max-sm:w-full"/);
  assert.match(DIALOG, /min-w-0 flex-1 break-words/, "a long group name wraps rather than being clipped");
  assert.doesNotMatch(code(DIALOG), /w-\[\d+px\]|min-w-\[\d+px\]/);
});

test("it reuses the shared dialog, field and button rather than typing its own", () => {
  assert.match(DIALOG, /import Dialog from "@\/components\/ui\/Dialog"/);
  assert.match(DIALOG, /import TextField from "@\/components\/shared\/TextField"/);
  assert.match(DIALOG, /import Button from "@\/components\/shared\/Button"/);
  assert.doesNotMatch(code(DIALOG), /<button[\s>]|<input[\s>]/, "no raw button or input is typed");
});

const EMPLOYEE = fs.readFileSync(new URL("../src/components/employees/EmployeeWhatsAppGroups.js", import.meta.url), "utf8");

test("the employee's picker offers only their departments' groups", () => {
  /*
   * Settings decided which groups a department has. Listing every group in the studio asked whoever
   * is on the employee's screen to decide it again, differently and without the context to.
   */
  assert.match(EMPLOYEE, /setGroups\(Array\.isArray\(result\?\.data\?\.groups\) \? result\.data\.groups : \[\]\)/);
  assert.doesNotMatch(code(EMPLOYEE), /getWhatsAppGroups/, "not the studio-wide list any more");
  // One read for both halves, so the groups and the rows can never disagree about the same person.
  assert.match(EMPLOYEE, /result\?\.data\?\.memberships/);
});

test("their departments' groups are ticked for them, and taking one off is the decision", () => {
  /*
   * Derived, not written into state by an effect: a tick somebody has just removed is never put
   * back by a reload, which is exactly what setting it on every read would have done.
   */
  assert.match(EMPLOYEE, /const \[picked, setPicked\] = useState\(null\);/);
  assert.match(EMPLOYEE, /const values = picked \?\? offerable\.filter\(\(group\) => group\.fromDepartment\)\.map\(\(group\) => String\(group\.id\)\);/);
  assert.match(EMPLOYEE, /values=\{values\}/);
  assert.match(EMPLOYEE, /onClick=\{\(\) => void add\(values\.map\(Number\)\)\}/);
  // Back to derived after an add, so the next read's defaults show rather than a stale set of ticks.
  assert.match(EMPLOYEE, /setPicked\(null\);/);
});

test("a group they are in that their department no longer claims is still shown, and labelled", () => {
  // A membership that exists has to be visible, or it is one nobody could see or act on.
  assert.match(EMPLOYEE, /\$\{group\.subject\} \(not in their department\)/);
});

test("an empty box says which departments it looked at, so it is not a dead end", () => {
  /*
   * "No groups" alone cannot be acted on: no departments **saved** and departments-that-have-no-
   * groups are different problems with opposite fixes - save the employee, or go to Settings. And a
   * department picked on the form but not yet saved is not a department here, which is exactly the
   * case that had somebody staring at an empty box having just selected several.
   */
  // And it names the one place departments are set, rather than a second field on this tab.
  assert.match(EMPLOYEE, /No departments saved for this employee yet - set them under Employment Details and save/);
  assert.doesNotMatch(code(EMPLOYEE), /label="Departments"/, "departments live in Employment Details, not here");
  assert.match(EMPLOYEE, /\$\{departmentNames\.join\(", "\)\} \$\{departmentNames\.length === 1 \? "has" : "have"\} no WhatsApp groups/);
  // Said in the placeholder and the helper both, since an empty box shows the placeholder.
  assert.match(EMPLOYEE, /placeholder=\{!groups\.length \? nothingToOffer/);
  assert.match(EMPLOYEE, /helperText=\{!groups\.length\n\s+\? nothingToOffer/);
});

test("a full box names the departments whose groups it ticked", () => {
  assert.match(EMPLOYEE, /\$\{departmentNames\.join\(", "\)\}: their groups are ticked for them/);
  assert.match(EMPLOYEE, /Already in every group their departments have/);
});


const FORM = fs.readFileSync(new URL("../src/components/employees/EmployeeFormPanel.js", import.meta.url), "utf8");

test("department saves the moment it changes, so the groups tab can list them", () => {
  /*
   * It is the one field on the employee form another screen reads **before** Save: the credentials
   * page's WhatsApp Groups offers the groups of the employee's departments, and those come from the
   * saved record. Picked and left unsaved, that box sat empty while somebody had visibly chosen
   * departments a moment earlier, and nothing on either screen said why.
   */
  assert.match(FORM, /if \(key === "department"\) saveDepartmentNow\(value\);/);
  assert.match(FORM, /void updateEmployee\(employee\.id, \{ department: value \}\)/);
  // The form's own partial update, not a second endpoint for one field.
  assert.match(FORM, /import \{ getPayslipDetailsSetting, updateEmployee \} from "@\/services\/hrm\/employees\.service"/);
});

test("only that field, only on an edit, and a failure stays quiet", () => {
  /*
   * A new employee has no id to save against - their departments go in with the rest on Save. And
   * the form's own Save is still coming and writes it again, so a WhatsApp list that has not caught
   * up is never a reason to interrupt somebody filling in an employee.
   */
  assert.match(FORM, /if \(!employee\?\.id\) return;/);
  assert.match(FORM, /\.catch\(\(\) => \{\}\);/);
  // No other field is saved early.
  const handler = FORM.slice(FORM.indexOf("function saveDepartmentNow"), FORM.indexOf("function update(key, value)"));
  assert.doesNotMatch(handler, /designation|vertical|workBaseLocation/);
});

const CREDENTIAL_FORM = fs.readFileSync(new URL("../src/components/employees/useCredentialForm.js", import.meta.url), "utf8");

test("changing the department re-reads the groups on the other page", () => {
  /*
   * Employment Details saves the department on the spot, but it is another page of the same panel -
   * and the credentials page holds the employee as it was when the panel opened. So the groups box
   * had already fetched and had no reason to ask again: it sat empty right after somebody had
   * chosen departments, which is exactly what it looked like before any of this was wired up.
   */
  assert.match(FORM, /departmentSignal: form\.department \|\| ""/);
  assert.match(CREDENTIAL_FORM, /departmentSignal = ""/);
  assert.match(CREDENTIAL_FORM, /<EmployeeWhatsAppGroups[^>]*departmentSignal=\{departmentSignal\}/);
  assert.match(EMPLOYEE, /\}, \[departmentSignal, employeeId\]\);/, "a change to it re-reads");
  // The memo that builds the field has to see it too, or it hands down the value it first had.
  assert.match(CREDENTIAL_FORM, /employee\?\.contactNumber, departmentSignal\]\);/);
});
