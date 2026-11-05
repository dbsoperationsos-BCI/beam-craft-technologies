import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { SCHEDULED_PAYMENT_TABS, accountsStatusLabel, paymentStatusAction, pendingAfter, statusChoices } from "../src/lib/scheduledPayments.mjs";
import { scheduleFormRows, scheduleSavePayload, undatedPayments } from "../src/lib/paymentSchedule.mjs";

const read = (file) => fs.readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8");

test("Accounts Manager's status bar gains Due, Overdue and On Hold - no Cleared, no Partial Payment, no Follow-up", () => {
  assert.deepEqual(SCHEDULED_PAYMENT_TABS, ["Due", "Overdue", "On Hold"]);
  const page = read("components/accounts/AccountsManagerPage.js");
  // On the screen's own permission - no permission of their own. (The Pending tab between them is
  // the one exception, and carries the payment-request permission its rows belong to.)
  assert.match(page, /\.\.\.accountsTabs\.map\(\(tab\) => tab\.label\), \.\.\.SCHEDULED_PAYMENT_TABS,/);
  assert.doesNotMatch(page, /SCHEDULED_PAYMENT_TABS\.includes\(activeTab\) \?\s*\w+\.canRead/, "the scheduled tabs gained no permission of their own");
  assert.match(page, /payments\.filter\(\(row\) => row\.status === activeTab\)/);
  assert.doesNotMatch(page, /Scheduled Payments"\)/);
  // No page of its own any more.
  assert.equal(fs.existsSync(new URL("../src/app/(app)/accounts/scheduled-payments/page.js", import.meta.url)), false);
  assert.doesNotMatch(read("constants/navigation.mjs"), /scheduled-payments/);
});

test("the project's Accounts status is its payments' alone - the project's own status changes nothing", () => {
  assert.equal(accountsStatusLabel({ projectStatus: "Delivered", projectAccountsStatus: "Overdue" }), "Overdue");
  assert.equal(accountsStatusLabel({ projectStatus: "On Hold", projectAccountsStatus: "Due" }), "Due");
  assert.equal(accountsStatusLabel({ projectStatus: "Work in Progress - Pre & Production", projectAccountsStatus: "Overdue" }), "Overdue");
});

test("Record's Status: Clear and Partially paid only for someone who may record cash; Take off hold for a held one", () => {
  const due = { status: "Due", pending: 1000 };
  assert.deepEqual(statusChoices(due, { canRecordCash: true }).map((choice) => choice.value), ["AUTO", "CLEAR", "PARTIAL", "HOLD"]);
  assert.deepEqual(statusChoices(due, { canRecordCash: false }).map((choice) => choice.value), ["AUTO", "HOLD"]);
  assert.equal(statusChoices({ ...due, holdAt: "x" }, { canRecordCash: true })[0].label, "Take off hold");
  assert.deepEqual(statusChoices({ status: "Due", pending: 0 }, { canRecordCash: true }).map((choice) => choice.value), ["AUTO", "HOLD"], "nothing to receive, nothing to clear");
});

test("a double click or ⋮ View reads the payment; ⋮ Record, for a writer, opens it to work", () => {
  const table = read("components/accounts/ScheduledPaymentsTable.js");
  assert.match(table, /onRowDoubleClick=\{\(row\) => \{ if \(!row\.isProjectGroup\) onOpen\(row\); \}\}/);
  assert.match(table, /\{ label: "View", onSelect: \(\) => onOpen\(row\) \},\s*\.\.\.\(canWrite \? \[\{ label: "Record", onSelect: \(\) => onOpen\(row, true\) \}\] : \[\]\)/);
  const panel = read("components/accounts/ScheduledPaymentPanel.js");
  assert.match(panel, /const working = recording && canWrite;/);
  // Read in the usual read-only view: the project, and what is due, when and why.
  assert.match(panel, /if \(!working\) \{\s*return <RecordViewPanel/);
  assert.match(read("constants/accountsConfig.js"), /\{ title: "Payment", fields: \[\["category", "Category"\], \["dueDate", "Due Date", "date"\], \["pending", "Due Amount", "amount"\], \["remarks", "Remarks"\]/);
  assert.match(panel, /<Dropdown label="Status" required/);
  assert.doesNotMatch(panel, /Followups|aside=/, "no follow-up column");
  // One badge beside the title - the project's, as every panel on it shows.
  assert.match(panel, /const badge = <ProjectHoldBadge status=\{payment\.projectStatus\} holds=\{payment\.holds\} paymentsDue=\{payment\.paymentsDue\} \/>;/);
});

test("partially paid asks the amount paid, shows what is left, and needs the pending amount's due date", () => {
  const payment = { status: "Due", pending: 10000 };
  const today = "2026-10-13";
  assert.equal(pendingAfter(payment, 4000), 6000);
  assert.equal(paymentStatusAction(payment, { choice: "PARTIAL", paidAmount: "" }, today).problem, "Enter the amount paid.");
  assert.match(paymentStatusAction(payment, { choice: "PARTIAL", paidAmount: "10000" }, today).problem, /less than the pending/);
  assert.equal(paymentStatusAction(payment, { choice: "PARTIAL", paidAmount: "4000" }, today).problem, "Choose the due date for the pending amount.");
  assert.match(paymentStatusAction(payment, { choice: "PARTIAL", paidAmount: "4000", pendingDueDate: "2026-10-01" }, today).problem, /cannot be in the past/);
  assert.deepEqual(paymentStatusAction(payment, { choice: "PARTIAL", paidAmount: "4000", pendingDueDate: "2026-11-01" }, today), { action: "partial", problem: "" });
  assert.equal(paymentStatusAction(payment, { choice: "HOLD", remarks: " " }, today).problem, "Add the remarks for the hold.");
  assert.deepEqual(paymentStatusAction({ ...payment, holdAt: "x" }, { choice: "AUTO" }, today), { action: "release", problem: "" });
  assert.deepEqual(paymentStatusAction(payment, { choice: "CLEAR" }, today), { action: "clear", problem: "" });
});

test("a saved schedule comes back into the form, a worked payment locked; only answered rows are sent", () => {
  const rows = scheduleFormRows([
    { id: "a", category: "Advance", dueDate: "2026-10-20", percentage: 5, locked: true, status: "Cleared" },
    { id: "b", category: "Partial Payment", dueDate: "2026-11-01", percentage: null, amount: 50000, remarks: "Pending from Partial Payment" },
  ], 200000);
  assert.equal(rows[0].locked, true);
  assert.equal(rows[1].percentage, 25, "a split's fixed amount drawn as its share");
  assert.deepEqual(scheduleSavePayload([...rows, { id: "new", category: "", percentage: "" }]).map((row) => row.id), ["a", "b"]);
});

test("wired: the forms' saves, the cash form opened filled in, Cash Management's write for recording", () => {
  assert.match(read("components/project-management/StartProjectFormPanel.js"), /await saveSchedule\(\);\s*await onStart\(payload\(\)\);/);
  const booking = read("components/sales/ProjectBookingPanel.js");
  assert.match(booking, /savedSchedule = \(await saveProjectPaymentSchedule\(created\.data\.id, rows, \{ creating: true \}\)\)\?\.data \|\| \[\];/);
  // The schedule first, then the advance, which may settle one of the payments just saved.
  assert.ok(booking.indexOf("await saveProjectPaymentSchedule(") < booking.indexOf("await recordProjectAdvance("));
  assert.match(booking, /await recordProjectAdvance\(created\?\.data\?\.id, withSavedPayment\(payment, savedSchedule\)\);/);
  const panel = read("components/accounts/ScheduledPaymentPanel.js");
  assert.match(panel, /amountFixed: true,/);
  assert.match(panel, /onRecord=\{recordCash\}/);
  assert.match(read("components/accounts/AccountsManagerPage.js"), /cashOptions=\{canWrite \? options : null\}/);
});

test("every payment needs a date, except the one settling the balance, one already worked, and the blank row", () => {
  const rows = [
    { id: "dated", category: "Advance", percentage: 5, date: "2026-10-20" },
    { id: "undated", category: "Partial Payment 1", percentage: 45, date: "" },
    { id: "worked", category: "Partial Payment 2", percentage: 20, date: "", locked: true },
    { id: "settles", category: "Final Settlement", percentage: 30, date: "" },
    { id: "blank", category: "", percentage: "", date: "" },
  ];
  assert.deepEqual(undatedPayments(rows, ["Final Settlement"]).map((row) => row.id), ["undated"]);
  // Date not known: it follows a shoot, so it needs no date of its own.
  assert.deepEqual(undatedPayments([{ id: "on-shoot", category: "Advance", percentage: 5, date: "", dateKnown: false }], []), []);
  // A row being typed into with no category or share yet is not a payment, so it is not refused.
  assert.deepEqual(undatedPayments([{ id: "half", category: "Advance", percentage: "", date: "" }], []), []);
  // Both forms refuse the save on it and mark the cells; the section takes the form's list.
  for (const form of ["components/sales/CreateProjectFormPanel.js", "components/project-management/StartProjectFormPanel.js"]) {
    const source = fs.readFileSync(new URL(`../src/${form}`, import.meta.url), "utf8");
    assert.match(source, /undatedPayments\(schedulePayments, paymentCategories\.settling\)\.length/, form);
    assert.match(source, /categories=\{paymentCategories\}\s*\n\s*showDateErrors=\{showScheduleDateErrors\}/, form);
  }
});

test("Settles Payment: Full is exactly what is pending, Partial less with the rest's date, None asks nothing", async () => {
  const { settleProblems, cashEntryPayload, openPaymentChoices } = await import("../src/constants/accountsConfig.js");
  const context = { openPayments: [{ id: "s1", category: "Advance", pending: 30000, status: "Due", dueDate: "2026-10-29" }] };
  const base = { entryType: "Received", settlesPayment: "s1" };
  assert.deepEqual(Object.keys(settleProblems({ ...base, amount: "30000" }, context)), ["settleMode"]);
  assert.deepEqual(settleProblems({ ...base, settleMode: "FULL", amount: "30000" }, context), {});
  assert.match(settleProblems({ ...base, settleMode: "FULL", amount: "20000" }, context).amount, /whole pending ₹30,000/);
  assert.match(settleProblems({ ...base, settleMode: "PARTIAL", amount: "30000", pendingDueDate: "2026-11-01" }, context).amount, /less than the pending/);
  assert.deepEqual(Object.keys(settleProblems({ ...base, settleMode: "PARTIAL", amount: "10000" }, context)), ["pendingDueDate"]);
  assert.deepEqual(settleProblems({ entryType: "Received", settlesPayment: "", amount: "5" }, context), {}, "None settles nothing");
  assert.deepEqual(settleProblems({ entryType: "Spent", settlesPayment: "s1", amount: "5" }, context), {}, "money out never settles");
  // Sent only when asked and answered.
  assert.deepEqual(cashEntryPayload({ ...base, settleMode: "PARTIAL", amount: "10000", pendingDueDate: "2026-11-01" }, {}, context).settles, { paymentScheduleId: "s1", mode: "PARTIAL", pendingDueDate: "2026-11-01" });
  assert.deepEqual(cashEntryPayload({ ...base, settleMode: "FULL", amount: "30000", pendingDueDate: "2026-11-01" }, {}, context).settles, { paymentScheduleId: "s1", mode: "FULL", pendingDueDate: null });
  assert.equal(cashEntryPayload({ entryType: "Received", settlesPayment: "", amount: "5" }, {}, context).settles, undefined);
  assert.match(openPaymentChoices(context.openPayments)[0].label, /^Advance · ₹30,000 pending · Due · due 29 Oct 2026$/);
});

test("the settle choice follows the payments on offer, and changing it never leaves a stale amount", async () => {
  const { withSettledPayment, settleChange, settleNotes } = await import("../src/constants/accountsConfig.js");
  const payments = [{ id: "s1", category: "Advance", pending: 30000 }];
  // Full is always exactly what is pending, however the schedule moved after it was chosen.
  assert.equal(withSettledPayment({ settlesPayment: "s1", settleMode: "FULL", amount: "1" }, payments).amount, "30000");
  assert.equal(withSettledPayment({ settlesPayment: "s1", settleMode: "FULL", amount: "1" }, [{ id: "s1", pending: 25000 }]).amount, "25000");
  // A payment no longer open is let go, with what was chosen for it.
  assert.deepEqual(withSettledPayment({ settlesPayment: "gone", settleMode: "PARTIAL", pendingDueDate: "2026-11-01", amount: "5" }, payments), { settlesPayment: "", settleMode: "", pendingDueDate: "", amount: "5" });
  // Leaving Full - for Partial, another payment or None - empties the amount it filled in.
  assert.equal(settleChange({ settleMode: "FULL", amount: "30000" }, "settleMode", "PARTIAL").amount, "");
  assert.equal(settleChange({ settleMode: "FULL", amount: "30000" }, "settlesPayment", "").amount, "");
  assert.equal(settleChange({ settleMode: "PARTIAL", amount: "100" }, "settleMode", "FULL").amount, "100");
  assert.match(settleNotes({ entryType: "Received", settlesPayment: "s1", settleMode: "FULL" }, { openPayments: payments }).amount, /₹30,000/);
});

test("Bookings and Converted: the advance settles the schedule's first payment unless told otherwise", () => {
  const form = read("components/sales/CreateProjectFormPanel.js");
  assert.match(form, /!advanceSettleChosen && !advance\.settlesPayment && bookingPayments\.length \? \{ \.\.\.advance, settlesPayment: bookingPayments\[0\]\.id \} : advance/);
  assert.match(form, /cashEntryPayload\(advanceShown, \{ projectId: null \}, \{ openPayments: bookingPayments \}\)/);
  // Only what was typed starts the section, so the default never makes the advance required.
  assert.match(form, /const advanceStarted = showAdvance && Object\.entries\(projectAdvanceInitialValues\)\s*\.some\(\(\[field, blank\]\) => String\(advance\?\.\[field\]/);
});

test("Partial asks two amounts - paid now and to pay later - that always add up to what is pending", async () => {
  const { withSettledPayment, settleChange, cashEntryFormSections } = await import("../src/constants/accountsConfig.js");
  const payments = [{ id: "s1", pending: 30000 }];
  const partial = { entryType: "Received", settlesPayment: "s1", settleMode: "PARTIAL" };
  assert.equal(withSettledPayment({ ...partial, amount: "10000" }, payments).amountLater, "20000");
  assert.equal(withSettledPayment({ ...partial, amount: "" }, payments).amountLater, "");
  // Typed in the second box, the first follows.
  assert.equal(settleChange({ ...partial, amount: "" }, "amountLater", "5000.5", payments).amount, "24999.5");
  assert.equal(settleChange({ ...partial, amount: "100" }, "amountLater", "", payments).amount, "");
  const amount = cashEntryFormSections.flatMap((section) => section.fields).find((field) => field.name === "amount");
  assert.equal(amount.label({ ...partial }, { openPayments: payments }), "Amount Paid Now");
  assert.equal(amount.label({ entryType: "Received" }, { openPayments: payments }), "Amount");
});

test("Share invoice's receipt opens over the cash form; saving no longer opens it - the server sends it", () => {
  assert.match(read("components/project-management/ProjectPaymentsView.js"), /<ReceiptMessageDialog \{\.\.\.sharing\} layer="confirmOverDialog"/);
  assert.match(read("components/accounts/AccountsManagerPage.js"), /<ReceiptMessageDialog entryId=\{receipt\.entryId\}[^>]*layer="dialogOverPanel"/);
  assert.doesNotMatch(read("components/accounts/AccountsManagerPage.js"), /receiptMessage\?\.body/);
  assert.doesNotMatch(read("components/project-management/ProjectPaymentsView.js"), /receiptMessage\?\.body/);
});

test("a payment whose date is not known follows a shoot: saved as days from it, read back the same", async () => {
  const { scheduleSavePayload, scheduleFormRows, shootLinkLabel, dueDateText } = await import("../src/lib/paymentSchedule.mjs");
  const shoots = [{ id: "s1", shoot: "Reception" }, { id: "s2", shoot: "Wedding", isMainEvent: true }];
  const [before] = scheduleSavePayload([{ id: "p1", category: "Advance", percentage: 10, date: "2026-12-01", dateKnown: false, shootKey: "s1", timing: "BEFORE", days: "3" }]);
  assert.deepEqual([before.dueRule, before.dueShootId, before.dueOffsetDays, before.date], ["SHOOT", "s1", -3, null]);
  const [dated] = scheduleSavePayload([{ id: "p2", category: "Advance", percentage: 10, date: "2026-12-01" }]);
  assert.deepEqual([dated.dueRule, dated.dueShootId, dated.dueOffsetDays, dated.date], ["DATE", null, null, "2026-12-01"]);
  const [row] = scheduleFormRows([{ id: "p1", category: "Advance", percentage: 10, dueRule: "SHOOT", dueShootId: "s1", dueOffsetDays: 7, dueDate: "2026-12-08" }], 0);
  assert.deepEqual([row.dateKnown, row.shootKey, row.timing, row.days, row.date], [false, "s1", "AFTER", "7", ""]);
  assert.equal(shootLinkLabel(row, shoots), "7 days after Reception");
  assert.equal(shootLinkLabel({ shootKey: "", timing: "ON" }, shoots), "On the main event day");
  assert.equal(dueDateText({ dueDate: null, dueRule: "SHOOT" }, String), "Waiting for shoot date");
  assert.equal(dueDateText({ dueDate: null, dueRule: "DATE" }, String), "Final settlement");
});

test("the payments Board holds the tab's own rows - the very ones its table lists, never an Active payment", () => {
  const page = read("components/accounts/AccountsManagerPage.js");
  const board = page.slice(page.indexOf("{onPaymentBoard ?"), page.indexOf('ariaLabel="Scheduled payments board"'));
  assert.match(board, /rows=\{tabPayments\}/);
  assert.doesNotMatch(board, /rows=\{payments\}/, "every payment held would put the Active ones, on no tab, in an Other column");
  assert.match(page, /<ScheduledPaymentsTable[\s\S]*?rows=\{tabPayments\}/);
  assert.equal(SCHEDULED_PAYMENT_TABS.includes("Active"), false, "Active has no tab, so no column either");
});
