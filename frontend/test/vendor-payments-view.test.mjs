import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { vendorPaymentInfoSections, vendorPaymentTableFields } from "../src/constants/paymentRequestConfig.js";

/*
 * Asset Management → Vendors → **Vendor Payments**: the studio's bills to its vendors, read from the
 * vendor's side, with what has actually been paid against each.
 *
 * Three things this pins, all of them things that would be wrong in a way nobody notices until the
 * money is wrong:
 *
 *   - the view answers for `ACCOUNTS / Payment Request`, not for Vendor Management. Who may
 *     read what the studio is paying is that permission's answer, and the screen offering the view
 *     is not what decides it - the endpoint is;
 *   - it is read-only. Raising a bill and deciding one stay on the screens that own them, because a
 *     second place to approve money is a second answer to "has this been paid";
 *   - a bill names its vendor by **id**. The form always picked the vendor from the register but
 *     only the name was stored, so "this vendor's payments" could be matched by name alone - which a
 *     rename, or two vendors called the same thing, answers wrongly.
 */

const root = path.join(import.meta.dirname, "..", "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const VIEW = read("frontend/src/components/assets/VendorPaymentsView.js");
const SWITCH = read("frontend/src/components/assets/VendorViewSwitch.js");
const REGISTER = read("frontend/src/components/assets/VendorManagementView.js");
const CONTROLLER = read("backend/src/modules/hrm/payment-requests/controller.js");
const ROUTES = read("backend/src/modules/hrm/payment-requests/routes.js");
const MIGRATION = read("backend/prisma/migrations/20261102150000_payment_request_vendor_link/migration.sql");

test("the Vendors page switches between the register and the payments", () => {
  assert.match(REGISTER, /params\.get\("view"\) === "payments"\n\s*\? <VendorPaymentsView \/>/);
  assert.match(SWITCH, /ariaLabel="Vendors view"/);
  // Beside the heading in both views, from one definition, so switching back lands where it left.
  for (const source of [REGISTER, VIEW]) assert.match(source, /titleAccessory=\{<VendorViewSwitch/);
  assert.match(SWITCH, /if \(next === "payments"\) query\.set\("view", "payments"\);/, "kept in the URL, so a link holds the view");
});

test("the payments view is offered only to somebody the endpoint would answer", () => {
  assert.match(REGISTER, /const \{ canRead: canSeePayments \} = useModuleAccess\("ACCOUNTS", "Payment Request"\);/);
  assert.match(REGISTER, /canSeePayments && params\.get\("view"\) === "payments"/, "a reader holding only Vendor Management is never taken there");
  assert.match(SWITCH, /if \(!canSeePayments\) return null;/);
  // The guard on the router is the authority - the whole router, so the new route is covered by it.
  assert.match(ROUTES, /router\.use\(requireModule\("ACCOUNTS", "Payment Request"\)\);/);
  assert.match(ROUTES, /router\.get\("\/vendor-payments", controller\.vendorPayments\);/);
  // Above the `/:id` routes, or "vendor-payments" is read as an id.
  assert.ok(ROUTES.indexOf('router.get("/vendor-payments"') < ROUTES.indexOf('router.get("/:id"'), "the static route sits above the identifier routes");
});

test("it reads by the same visibility rule as the Payment Requests screen", () => {
  const handler = CONTROLLER.slice(CONTROLLER.indexOf("async function vendorPayments("), CONTROLLER.indexOf("async function listRequests("));
  assert.match(handler, /const visibility = await visibilityWhere\(req\.user\);/, "not a way around who may see which requests");
  assert.match(handler, /\.\.\.NOT_ON_A_BINNED_PROJECT,/);
  assert.match(handler, /type: "VENDOR_PAYMENT",/);
  // The status narrows the rows after they are read, so the counts and the totals are of everything
  // the reader can see rather than of the tab in front of them.
  assert.match(handler, /const shown = status \? rows\.filter\(\(row\) => row\.status === status\) : rows;/);
  assert.match(handler, /ALL: rows\.length,/);
  // No vendor picker above a table that already filters by vendor in its own column, and so no
  // vendor or search parameter behind one.
  assert.doesNotMatch(handler, /vendorId,|search/);
});

test("what has been paid is the cash entries' own sum, not arithmetic on the screen", () => {
  assert.match(CONTROLLER, /cashEntries: \{\n\s*where: \{ deletedAt: null, entryType: "Spent" \},/);
  assert.match(CONTROLLER, /const paid = entries\.reduce\(\(sum, entry\) => sum \+ entry\.amount, 0\);/);
  // Only an approved bill is owed anything: a pending one is not owed until it is decided, and a
  // rejected one never will be.
  assert.match(CONTROLLER, /balance: request\.status === "APPROVED" \? Number\(\(amount - paid\)\.toFixed\(2\)\) : 0,/);
});

test("the view changes nothing - it only reads", () => {
  for (const call of ["createPaymentRequest", "approvePaymentRequest", "rejectPaymentRequest", "updatePaymentRequest", "recordCashEntry"]) {
    assert.doesNotMatch(VIEW, new RegExp(call), `${call} belongs to the screen that owns it`);
  }
  assert.doesNotMatch(VIEW, /method: "POST"|method: "PATCH"|method: "DELETE"/);
  // The ⋮ offers reading, which is also what gives the row the height every other table here has.
  assert.match(VIEW, /items=\{\[\n\s*\{ label: "View", onSelect: \(\) => setViewing\(row\) \},\n\s*\]\}/);
});

test("a bill names its vendor by id, with the name kept as the copy it was raised with", () => {
  assert.match(CONTROLLER, /return \{ vendorId: vendor\.id, vendorName: vendor\.vendorName, vendorPhone: vendor\.mobileNumber \|\| null \};/);
  assert.match(CONTROLLER, /vendorId: isVendor \? vendor\.vendorId : null,/, "written by both the create and the edit, which share `requestData`");
  // The linked name as it reads today, falling back to the copy for a vendor since removed.
  assert.match(CONTROLLER, /vendorName: request\.vendor\?\.vendorName \|\| request\.vendorName \|\| "",/);
  assert.match(MIGRATION, /ADD COLUMN `vendor_id` INT NULL/);
  assert.match(MIGRATION, /CREATE INDEX `payment_request_vendor_id_idx`/);
  assert.match(MIGRATION, /FOREIGN KEY \(`vendor_id`\) REFERENCES `vendor`\(`id`\) ON DELETE SET NULL/);
  // Backfilled only where the name belongs to exactly one live vendor: two vendors sharing a name is
  // the one case a name cannot answer, so those rows are left to be set by hand rather than guessed.
  assert.match(MIGRATION, /AND `v`\.`found` = 1/);
  assert.match(MIGRATION, /WHERE `is_deleted` = 0/);
});

test("the ledger reads as a ledger: asked, gone out, still owed", () => {
  const fields = vendorPaymentTableFields.map(([key]) => key);
  for (const key of ["requestCode", "status", "vendorName", "amount", "paid", "balance", "cashEntryCode"]) {
    assert.ok(fields.includes(key), `${key} is a column`);
  }
  for (const key of ["amount", "paid", "balance"]) {
    assert.equal(vendorPaymentTableFields.find(([field]) => field === key)[2], "amount", `${key} is money`);
  }
  assert.deepEqual(vendorPaymentInfoSections.map((section) => section.title), ["Bill", "Vendor", "Raised By", "Paid", "Bills"]);
});
