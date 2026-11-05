import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (file) => fs.readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8");

/*
 * Every Board card can carry the ⋮ its table row has (`cardActions`), so a card is acted on without
 * going back to the table. The ⋮ sits beside the card's open button - never inside it - and a card
 * with nothing to offer has none.
 */
test("a card draws its ⋮ beside the open button, from the board's cardActions, and none when empty", () => {
  const board = read("components/data-table/KanbanBoard.js");
  assert.match(board, /export default function KanbanBoard\(\{[^}]*\bcardActions,/);
  assert.match(board, /actions=\{cardMenu\(row, opener\)\}/);
  assert.match(board, /const menu = Array\.isArray\(actions\) && actions\.length > 0;/);
  assert.match(board, /\{menu && <span className="shrink-0 p-1\.5"><OptionsMenu ariaLabel=\{`Actions for \$\{title \|\| "record"\}`\} items=\{actions\} compact \{\.\.\.menuProps\} \/><\/span>\}/);
  // The open button closes before the ⋮ opens: a button never holds another.
  assert.match(board, /<\/Tag>\n\s+\{menu && <span/);
  // The frame is what is dragged, so a card with a ⋮ still moves between columns.
  assert.match(board, /return <div\n\s+draggable/);
});

test("Payment Requests' cards offer the row's own ⋮", () => {
  assert.match(read("components/accounts/PaymentRequestsPage.js"), /cardActions=\{requestActions\.items\}/);
});

/*
 * The other boards whose rows have a ⋮: each card is handed the very function its table row's ⋮
 * reads, so the two cannot drift, and a write-only menu stays absent on the card for a reader.
 */
test("Accounts Manager's payment and cash-entry cards offer the row's own ⋮", () => {
  const page = read("components/accounts/AccountsManagerPage.js");
  assert.match(page, /cardActions=\{\(row\) => paymentActionItems\(row, \{ canWrite, onOpen: /);
  assert.match(page, /cardActions=\{\(entry\) => cashEntryActionItems\(entry, \{ canWrite, onView: setViewingEntry, onDownloadInvoice: downloadInvoice, onShareInvoice: shareInvoice, onEdit: editEntry, onDelete: setDeleteEntry \}\)\}/);
  assert.match(page, /onShareInvoice=\{shareInvoice\}/);
  assert.match(read("components/accounts/ScheduledPaymentsTable.js"), /items=\{paymentActionItems\(row\.original, \{ canWrite, onOpen \}\)\}/);
  assert.match(read("components/accounts/AccountsTable.js"), /items=\{cashEntryActionItems\(entry, \{ canWrite, onView: onRowDoubleClick, onDownloadInvoice, onShareInvoice, onEdit, onDelete \}\)\}/);
});

test("Role and User Management cards offer the row's own ⋮", () => {
  for (const file of ["components/admin/RoleManagement.js", "components/admin/UserManagement.js"]) {
    const source = read(file);
    assert.match(source, /cardActions=\{menuFor\}/, file);
    assert.match(source, /renderActions=\{\((role|user)\) => <OptionsMenu ariaLabel=\{`Actions for \$\{\1\.name\}`\} items=\{menuFor\(\1\)\} \/>\}/, file);
  }
});

test("Asset, Vendor, Client Storage and Contacts cards offer the row's own ⋮", () => {
  const assets = read("components/assets/AssetManagementPage.js");
  assert.match(assets, /cardActions=\{assetActionItems\}/);
  assert.match(assets, /const items = assetActionItems\(row\.original\);/);

  const vendors = read("components/assets/VendorManagementView.js");
  assert.match(vendors, /cardActions=\{vendorActionItems\}/);
  assert.match(vendors, /items=\{vendorActionItems\(row\.original\)\}/);

  // The table's actions column exists only with Read / Write, so the card's ⋮ does too.
  const storage = read("components/assets/ClientStorageManagementView.js");
  assert.match(storage, /cardActions=\{canWrite \? recordActionItems : undefined\}/);
  assert.match(storage, /\.\.\.\(canWrite \? \[\{ \.\.\.ACTIONS_COLUMN, cell: \(\{ row \}\) => <OptionsMenu ariaLabel=\{`Actions for \$\{row\.original\.storageId\}`\} items=\{recordActionItems\(row\.original\)\} \/> \}\] : \[\]\)/);

  const contacts = read("components/contacts/ContactsPage.js");
  assert.match(contacts, /cardActions=\{contactActionItems\}/);
  assert.match(contacts, /items=\{contactActionItems\(row\)\}/);
});

test("the Employee Repository's cards offer the row's own ⋮, invites included", () => {
  const table = read("components/employees/EmployeeTable.js");
  // One item list, read by the table's RowActions and exported for the board.
  assert.match(table, /export function employeeRowActionItems\(employee, \{/);
  assert.match(table, /function RowActions\(\{ employee, \.\.\.handlers \}\) \{\n\s+const items = employeeRowActionItems\(employee, handlers\);/);
  assert.match(table, /const items = employee\.type === "invite" \? \[/);
  const page = read("components/employees/EmployeeVerificationPage.js");
  // The same handlers reach the table and the card.
  assert.match(page, /<EmployeeTable [^\n]*\{\.\.\.rowMenu\}[^\n]*onRowDoubleClick=\{setViewingRow\}/);
  assert.match(page, /cardActions=\{\(row\) => employeeRowActionItems\(row, \{ \.\.\.rowMenu, onView: setViewingRow \}\)\}/);
});

test("the HR registers' cards offer the row's own ⋮", () => {
  // Attendance Requests: rowActionItems feeds renderActions and the card.
  const requests = read("components/hrm/AttendanceRequestsPage.js");
  assert.match(requests, /function renderActions\(row\) \{\n\s+const items = rowActionItems\(row\);/);
  assert.match(requests, /cardActions=\{rowActionItems\}/);
  // Interview: one list, and like the row's ⋮ only for a writer.
  const interview = read("components/hrm/InterviewPage.js");
  assert.match(interview, /const candidateActionItems = useCallback\(\(candidate\) => \{/);
  assert.match(interview, /renderActions: canWrite \? \(candidate\) => <OptionsMenu[^]*?items=\{candidateActionItems\(candidate\)\}/);
  assert.match(interview, /cardActions=\{canWrite \? candidateActionItems : undefined\}/);
  // The onboarding and offboarding registers: `menuItemsFor` already fed the row's ⋮.
  const onboarding = read("components/employees/OnboardingInviteTable.js");
  assert.match(onboarding, /: menuItemsFor\(invite\);/);
  assert.match(onboarding, /cardActions=\{menuItemsFor\}/);
  const offboarding = read("components/employees/OffboardingInviteDialog.js");
  assert.match(offboarding, /const items = menuItemsFor\(invite\);/);
  assert.match(offboarding, /cardActions=\{menuItemsFor\}/);
});

test("a board inside a dialog lifts its cards' ⋮ over the dialog, as its rows' ⋮ is lifted", () => {
  assert.match(read("components/employees/OffboardingInviteDialog.js"), /cardActions=\{menuItemsFor\}\n\s+cardMenuProps=\{\{ menuZIndexClassName: layers\.menuOverPanel \}\}/);
  assert.match(read("components/employees/OnboardingInviteTable.js"), /cardActions=\{menuItemsFor\}\n\s+cardMenuProps=\{\{ menuZIndexClassName \}\}/);
});

test("Excluded Numbers' cards offer the row's Edit and Remove, over the settings panel, for Read / Write only", () => {
  const panel = read("components/sales/ExcludedNumbersPanel.js");
  assert.match(panel, /const numberActionItems = useCallback\(\(number\) => \(canWrite \? \[/);
  assert.match(panel, /items=\{numberActionItems\(row\.original\)\}/);
  assert.match(panel, /cardActions=\{numberActionItems\}\n\s+cardMenuProps=\{\{ zIndex: MENU_Z_INDEX \}\}/);
});

test("a card's ⋮ opens the compact menu - smaller, sized to its options, with a short animation", () => {
  const menu = read("components/ui/OptionsMenu.js");
  assert.match(menu, /onOpen, compact = false \}\) \{/);
  assert.match(menu, /\$\{compact \? "px-2\.5 py-1\.5 text-\[13px\] sm:py-1 sm:text-xs" : "px-3 py-2 text-sm"\}/);
  assert.match(menu, /\$\{compact \? `animate-options-menu-pop \$\{menuClassName === "w-44" \? "w-max min-w-28 max-w-56" : menuClassName\}` : menuClassName\}/);
  const css = fs.readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");
  assert.match(css, /@keyframes options-menu-pop/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\n\s+\.animate-options-menu-pop \{\n\s+animation: none;/);
  assert.match(read("components/sales/CrmKanbanBoard.js"), /items=\{actions\} compact \/>/);
});

test("every card on every board has a ⋮: its row's items, else its open action, and always Copy details", () => {
  const board = read("components/data-table/KanbanBoard.js");
  assert.match(board, /openLabel = "View",/);
  assert.match(board, /const items = Array\.isArray\(own\) && own\.length \? own : opener \? \[\{ label: openLabel, onSelect: \(\) => opener\(row\) \}\] : \[\];/);
  assert.match(board, /return \[\.\.\.items, \.\.\.\(items\.length \? \[\{ separator: true \}\] : \[\]\), \{ label: "Copy details", onSelect: \(\) => void copy\(\) \}\];/);
  assert.match(board, /await copyToClipboard\(text\)/);
  // The two boards whose card does something other than View say so.
  assert.match(read("components/hrm/MyPayslipPage.js"), /openLabel="Download payslip"/);
  assert.match(read("components/hrm/PayrollMainSection.js"), /openLabel="Edit"/);
  // The CRM board's own cards follow the same rule.
  const crm = read("components/sales/CrmKanbanBoard.js");
  assert.match(crm, /const items = Array\.isArray\(own\) && own\.length \? own : onOpenLead \? \[\{ label: "View", onSelect: \(\) => onOpenLead\(lead\) \}\] : \[\];/);
  assert.match(crm, /\{ label: "Copy details", onSelect: \(\) => void copy\(\) \}/);
  assert.match(crm, /leadActions=\{leadMenu\}/);
});
