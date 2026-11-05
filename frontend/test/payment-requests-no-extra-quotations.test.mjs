import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (file) => fs.readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8");

/*
 * Payment Requests offers payment requests only. Extra quotations are raised, approved and rejected
 * on the project's own Payments view.
 */
test("Payment Requests has no Extra Quotation button or tab; the project's Payments still does them", () => {
  const page = read("components/accounts/PaymentRequestsPage.js");
  assert.doesNotMatch(page, /ExtraQuotationFormPanel|getExtraQuotations|approveExtraQuotation|EXTRA_TAB|canRaiseExtra/);
  assert.match(page, /useStickyTab\("payment-requests", "All", requestTabs\.map\(\(tab\) => tab\.label\)\)/);
  const payments = read("components/project-management/ProjectPaymentsView.js");
  assert.match(payments, /import ExtraQuotationFormPanel from "\.\/ExtraQuotationFormPanel";/);
  assert.match(payments, /approveExtraQuotation|rejectExtraQuotation/);
});
