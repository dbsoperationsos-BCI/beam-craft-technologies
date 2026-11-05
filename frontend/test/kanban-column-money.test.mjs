import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { columnTotal } from "../src/lib/kanbanSummary.mjs";

const read = (file) => fs.readFileSync(new URL(`../src/components/${file}`, import.meta.url), "utf8");

/*
 * The money boards show, under each column's heading, the money its cards add up to - the way CRM
 * shows "Est." and Bookings "Converted" (`KanbanBoard`'s `columnAmount`, drawn by `ColumnAmount`).
 */
test("columnTotal adds the column's amounts, counting what is not a number as nothing", () => {
  assert.deepEqual(columnTotal([{ a: 1000 }, { a: "2500.5" }, { a: null }, {}], (row) => row.a, "Owed"), { label: "Owed", amount: 3500.5, title: "Owed: the total of the cards in this column" });
  assert.equal(columnTotal([], (row) => row.a, "Paid").amount, 0);
});

test("every money board names its figure", () => {
  const boards = {
    "accounts/PaymentRequestsPage.js": /columnTotal\(rows, \(request\) => request\.amount, \{ PENDING: "Requested", APPROVED: "Approved", REJECTED: "Rejected" \}\[column\.value\] \|\| "Total"\)/,
    "hrm/PayrollAdvanceSection.js": /columnTotal\(rows, \(row\) => row\.amount, column\.value === "Deducted" \? "Deducted" : "Owed"\)/,
    "hrm/PayrollRecoverySection.js": /columnTotal\(rows, \(row\) => \(row\.deductBy === "LOP" \? 0 : row\.totalAmount\), "Total"\)/,
    "hrm/PayrollMainSection.js": /columnTotal\(rows, \(row\) => row\.roundedSalary, "Net pay"\)/,
    "sales/QuotationPage.js": /columnTotal\(rows, \(chain\) => chain\.amount, "Quoted"\)/,
    "assets/AssetManagementPage.js": /columnTotal\(rows, \(asset\) => asset\.purchasePrice, "Value"\)/,
  };
  for (const [file, pattern] of Object.entries(boards)) assert.match(read(file), pattern, file);
  const accounts = read("accounts/AccountsManagerPage.js");
  assert.match(accounts, /columnTotal\(rows, \(row\) => row\.pending, "Pending"\)/);
  assert.match(accounts, /columnTotal\(rows, \(entry\) => entry\.amount, entryGroupKey === "entryType" \? column\.value : "Total"\)/);
});

test("Employee Referral: Owed while outstanding, Paid once paid, Cancelled for what never will be; a card reads short", () => {
  const page = read("hrm/EmployeeReferralsPage.js");
  assert.match(page, /column\.value === "Paid" \? columnTotal\(rows, \(referral\) => paidTotal\(referral\), "Paid"\)/);
  assert.match(page, /column\.value === "Cancelled" \? columnTotal\(rows, \(referral\) => cancelledTotal\(referral\), "Cancelled"\)/);
  assert.match(page, /: columnTotal\(rows, \(referral\) => outstandingTotal\(\[referral\]\), "Owed"\)/);
  assert.match(page, /const cancelledTotal = \(referral\) => sumOf\(referral, \["Cancelled", STOPPED\]\);/);
  assert.match(page, /meta: \(referral\) => \[currency\(referral\.total\), instalmentProgress\(referral\)\]\.join\(" · "\),/);
});

test("Pre Production and Production say how many shoots each column holds, and the nearest still to come", async () => {
  const { columnShoots } = await import("../src/lib/kanbanSummary.mjs");
  const now = new Date(2026, 10, 4);
  const rows = [
    { mainEventDate: "2026-11-20", shoots: [{ shootDate: "2026-11-14" }, { shootDate: "2026-10-01" }] },
    { mainEventDate: "2026-12-01", shoots: [{}] },
  ];
  assert.deepEqual(columnShoots(rows, now), { label: "", text: "3 shoots, next on 14 Nov", title: "Shoots in this column, and the day of the nearest one still to come" });
  assert.equal(columnShoots([{ shoots: [{ shootDate: "2026-01-01" }] }], now).text, "1 shoot", "nothing still to come: the count alone");
  assert.equal(columnShoots([], now), null, "an empty column says nothing");
  for (const file of ["project-management/PreProductionPage.js", "project-management/production/ProductionPage.js"]) {
    // The shoots figure stays for whoever does not see the projects' money.
    assert.match(read(file), /columnAmount=\{money \? \(rows\) => moneyColumn\(rows, money\) : \(rows\) => columnShoots\(rows\)\}/, file);
  }
  // The column figure can be words as well as money.
  assert.match(read("data-table/KanbanSummary.js"), /String\(text \?\? formatRupees\(amount\)\)/);
});

test("the non-money column figures: a count, a lapse soon, the next date and a sum in its own unit", async () => {
  const { columnCount, expiresSoon, columnNext, columnSumText } = await import("../src/lib/kanbanSummary.mjs");
  const now = new Date(2026, 10, 4);
  assert.equal(columnCount([{ late: true }, { late: false }, { late: true }], (row) => row.late, "Overdue").text, "2 overdue", "the number first, as a sentence");
  assert.equal(columnCount([{ late: false }], (row) => row.late, "Overdue"), null, "no \"0\" alert");
  assert.equal(expiresSoon("2026-11-05", 2, now), "Expires 5 Nov", "within two days ahead");
  assert.equal(expiresSoon("2026-11-09", 2, now), "", "too far ahead");
  assert.equal(expiresSoon("2026-11-01", 2, now), "", "already past");
  assert.equal(columnNext([{ at: "2026-11-06" }, { at: "2026-10-06" }], (row) => row.at, "Next", now).text, "6 Nov");
  assert.equal(columnNext([{ at: "2026-10-06" }], (row) => row.at, "Next", now), null, "nothing to come says nothing");
  assert.equal(columnSumText([{ h: 5 }, { h: "7" }], (row) => row.h, "Requested", (sum) => `${sum} h`).text, "12 h");
});

test("a long column figure wraps beside the period picker and never squeezes it shut", () => {
  const summary = fs.readFileSync(new URL("../src/components/data-table/KanbanSummary.js", import.meta.url), "utf8");
  // The picker keeps its width; the figure takes what is left.
  assert.match(summary, /<div className="flex shrink-0 items-center">\n\s+<Dropdown mode="switch" compact/);
  assert.match(summary, /<div className="flex min-w-0 flex-1 items-center justify-end gap-1\.5 pr-1 text-right">/);
  // It wraps rather than being cut to "To receive ₹3,2…".
  assert.match(summary, /<span className="min-w-0 break-words text-xs font-semibold leading-snug tabular-nums text-slate-600" title=\{title\}>/);
  assert.doesNotMatch(summary, /<span className="truncate text-xs font-semibold tabular-nums text-slate-600"/);
  // A two-part figure wraps only between its parts: "Client paid ₹…" and "Balance due ₹…" each stay
  // on one line. A one-part sentence ("Oldest invite sent 19 days ago") wraps between its words.
  assert.match(summary, /const parts = String\(text \?\? formatRupees\(amount\)\)\.split\(" · "\);/);
  assert.match(summary, /<span className=\{parts\.length > 1 \? "whitespace-nowrap" : undefined\}>\{part\}<\/span>/);
});

test("a column's name and its cards' lines wrap rather than being cut off", () => {
  const board = fs.readFileSync(new URL("../src/components/data-table/KanbanBoard.js", import.meta.url), "utf8");
  const crm = read("sales/CrmKanbanBoard.js");
  assert.match(board, /<span className="min-w-0 break-words text-sm font-semibold leading-snug text-slate-800">\{label\}<\/span>/);
  assert.match(board, /<span className="block break-words text-sm font-medium leading-snug text-slate-800">\{title \|\| "—"\}<\/span>/);
  assert.match(board, /<span className="mt-0\.5 block break-words text-\[11px\] leading-snug text-slate-500">\{subtitle\}<\/span>/);
  assert.match(board, /className="max-w-full break-words rounded-md bg-slate-100/);
  assert.match(crm, /<span className="block break-words text-sm font-medium leading-snug text-slate-800">\{lead\.name/);
  assert.doesNotMatch(board, /truncate text-sm font-(semibold|medium) text-slate-800/);
});
