import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

/*
 * A project's Payments tab opens on where it stands with Accounts - its Accounts status and each
 * payment still owed - above the signed quotation.
 */
test("the project's Accounts status alone sits above Signed Quotation", () => {
  const view = fs.readFileSync(new URL("../src/components/project-management/ProjectPaymentsView.js", import.meta.url), "utf8");
  assert.match(view, /<AccountsStatus status=\{payments\?\.accountsStatus\} \/>\s*<SignedQuotation/);
  assert.doesNotMatch(view, /scheduledPayments/, "no list of each payment's status");
  const controller = fs.readFileSync(new URL("../../backend/src/modules/sales/projects/controller.js", import.meta.url), "utf8");
  assert.match(controller, /return \{ accountsStatus: projectAccountsStatus\(schedule\.map\(\(payment\) => payment\.status\)\) \};/);
});

test("every cash received row downloads its invoice; money spent has none", () => {
  const view = fs.readFileSync(new URL("../src/components/project-management/ProjectPaymentsView.js", import.meta.url), "utf8");
  assert.match(view, /<EntryList title="Cash Received"[^\n]*onDownload=\{\(row\) => void downloadReceipt\(row\)\} downloadingId=\{downloadingId\} onShare=\{canRecordCash \? \(row\) => setSharing\(\{ entryId: row\.entryId, cashEntryId: row\.id \}\) : null\} \/>/);
  assert.doesNotMatch(view.match(/<EntryList title="Cash Spent"[^\n]*/)[0], /onDownload/);
  const service = fs.readFileSync(new URL("../src/services/accounts/cash-entries.service.js", import.meta.url), "utf8");
  assert.match(service, /downloadPdf\(`\/api\/accounts\/cash-entries\/\$\{encodeURIComponent\(id\)\}\/receipt`, `Invoice-\$\{entryId\}\.pdf`/);
});

test("Accounts Manager's ⋮ on a cash received row downloads its invoice; money spent has none", () => {
  const table = fs.readFileSync(new URL("../src/components/accounts/AccountsTable.js", import.meta.url), "utf8");
  assert.match(table, /\.\.\.\(onDownloadInvoice && entry\.entryType === "Received" \? \[\{ label: "Download invoice", onSelect: \(\) => onDownloadInvoice\(entry\) \}\] : \[\]\),/);
  const page = fs.readFileSync(new URL("../src/components/accounts/AccountsManagerPage.js", import.meta.url), "utf8");
  assert.match(page, /onDownloadInvoice=\{downloadInvoice\}/);
  assert.match(page, /downloadCashReceipt\(entry\.id, entry\.entryId\)/);
});
