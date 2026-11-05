import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { PENDING_REQUEST_TAB, accountsTabs } from "../src/constants/accountsConfig.js";
import { requestTabs, requestTableFields } from "../src/constants/paymentRequestConfig.js";

const PAGE = fs.readFileSync(new URL("../src/components/accounts/AccountsManagerPage.js", import.meta.url), "utf8");
const TABLE = fs.readFileSync(new URL("../src/components/accounts/PendingRequestsTable.js", import.meta.url), "utf8");
const REQUESTS_PAGE = fs.readFileSync(new URL("../src/components/accounts/PaymentRequestsPage.js", import.meta.url), "utf8");
const OPTIONS_MENU = fs.readFileSync(new URL("../src/components/ui/OptionsMenu.js", import.meta.url), "utf8");
const ACTIONS = fs.readFileSync(new URL("../src/components/accounts/usePaymentRequestActions.js", import.meta.url), "utf8");
const PAYMENT_PANEL = fs.readFileSync(new URL("../src/components/hrm/PaymentRequestPaymentPanel.js", import.meta.url), "utf8");
const SERVICE = fs.readFileSync(new URL("../src/services/hrm/payment-requests.service.js", import.meta.url), "utf8");

/*
 * Accounts Manager's Pending tab is the queue of money to release: the requests somebody has already
 * **approved** and nothing has been paid against yet, read beside the cash book that records what
 * has. Waiting for a decision is the Payment Requests screen's own Pending, and stays there.
 */

test("Pending is the last tab, and not one of the direction filters", () => {
  assert.equal(PENDING_REQUEST_TAB, "Pending");
  // The direction tabs filter rows already loaded; this one has its own source and table.
  assert.equal(accountsTabs.some((tab) => tab.label === PENDING_REQUEST_TAB), false);
  // Last, after the entries and the scheduled payments - not between them.
  assert.match(PAGE, /\.\.\.SCHEDULED_PAYMENT_TABS, \.\.\.\(canReadRequests \? \[PENDING_REQUEST_TAB\] : \[\]\)\]/);
});

test("the tab is absent for a reader who may not see payment requests", () => {
  // The rows belong to ACCOUNTS / Payment Request, not to this screen's Cash Management,
  // so holding the cash book alone must not produce a tab that then refuses to load.
  assert.match(PAGE, /useModuleAccess\("ACCOUNTS", "Payment Request"\)/);
  // Read alone: it decides whether the tab exists. Write on this permission is the approver's and
  // is not read here - what the ⋮ offers is this screen's own Cash Management write.
  assert.match(PAGE, /const \{ canRead: canReadRequests \} = useModuleAccess\("ACCOUNTS", "Payment Request"\);/);
  assert.match(PAGE, /canReadRequests \? \[PENDING_REQUEST_TAB\] : \[\]/);
  assert.doesNotMatch(PAGE, /disabled=\{!canReadRequests\}/, "absent, never shown and refused");
});

test("it asks for the approved and unpaid ones, as soon as the page loads", () => {
  // Not `status: "PENDING"`. A request waiting for a decision has no business in the cash book, and
  // asking for it here is what let one person approve and pay in a single breath.
  assert.match(PAGE, /getPaymentRequests\(\{ status: "APPROVED", paid: "no" \}\)/);
  assert.doesNotMatch(PAGE, /getPaymentRequests\(\{ status: "PENDING"/);
  /*
   * Loaded with the page, not on the tab's first open. Lazy, the tab read "Pending (0)" beside
   * All (27) and Overdue (16) until somebody clicked it - the one tab whose job is to say money is
   * waiting was the one saying none was.
   */
  assert.match(PAGE, /if \(!canReadRequests\) return undefined;\n\s+const timer = setTimeout\(\(\) => void loadPendingRequests\(\), 0\);/);
  assert.doesNotMatch(PAGE, /if \(!onPendingTab \|\| !canReadRequests\)/, "the count must not wait for the tab to be opened");
  // The dropdowns the payment panel needs stay lazy - nothing else asks for them.
  assert.match(PAGE, /if \(!onPendingTab \|\| !canReadRequests \|\| requestOptions\) return;/);
});

test("each screen offers its own half of the flow, from the one shared definition", () => {
  assert.match(PAGE, /usePaymentRequestActions\(\{/);
  assert.match(REQUESTS_PAGE, /usePaymentRequestActions\(\{/);
  for (const label of ['"Approve"', '"Reject"', '"Edit"', '"Withdraw"', '"View"', '"Record Payment"']) {
    assert.match(ACTIONS, new RegExp(`label: ${label}`), `${label} is one of the shared actions`);
  }
  /*
   * Which half each screen gets is the permissions it passes in, not a second copy of the menu.
   * Accounts Manager pays and does not decide: `canWrite: false` drops Approve, Reject, Edit and
   * Withdraw, and `canPay` is this screen's own Cash Management write.
   */
  assert.match(PAGE, /canWrite: false,\n\s+canPay: canWrite,/);
  assert.doesNotMatch(REQUESTS_PAGE, /canPay/, "the Payment Requests screen authorises, it does not release");
  assert.match(ACTIONS, /if \(canPay && request\.status === "APPROVED" && !request\.paid\) \{/);
  // Neither screen keeps its own copy of the payment panel or the rejection's reason.
  assert.doesNotMatch(REQUESTS_PAGE, /PaymentRequestPaymentPanel/);
  assert.doesNotMatch(PAGE, /PaymentRequestPaymentPanel/);
  assert.match(ACTIONS, /PaymentRequestPaymentPanel/);
  // Both mount the panels the actions open.
  assert.match(PAGE, /\{requestActions\.panels\}/);
  assert.match(REQUESTS_PAGE, /\{requestActions\.panels\}/);
});

test("approving asks for a remark and nothing else", () => {
  /*
   * It used to open the payment form, which is why approving and paying were the same act. The
   * dialog says where the money is actually released, so nobody is left wondering why approving
   * produced no cash entry.
   */
  assert.match(ACTIONS, /await approvePaymentRequest\(approving\.id, \{ remarks: approveRemarks\.trim\(\) \|\| null \}\);/);
  assert.match(ACTIONS, /description="This authorises the payment\. The money is released separately, from Accounts Manager → Pending/);
  // Releasing is its own call, on its own route, from the panel that asks how the money moved.
  assert.match(PAYMENT_PANEL, /await payPaymentRequest\(request\.id, \{/);
  assert.match(SERVICE, /payment-requests\/\$\{id\}\/pay`, \{ method: "POST"/);
});

test("the rows stand as tall as every other table's here", () => {
  /*
   * The ⋮ trigger's `min-h-10` is what sets a row's height, so a table without one reads as a
   * cramped band of text beside the cash entries and the scheduled payments.
   */
  assert.match(TABLE, /renderActions:/);
  assert.match(OPTIONS_MENU, /min-h-10/);
});

test("the three columns that would say nothing on this tab are left out", () => {
  // Every row is APPROVED, awaiting payment, and has written no cash entry. Decided On stays: here
  // it is how long the money has been waiting.
  assert.match(TABLE, /const DECIDED_ONLY = \["status", "paymentStatus", "cashEntryCode"\];/);
  for (const key of ["status", "paymentStatus", "cashEntryCode"]) {
    assert.equal(requestTableFields.some(([field]) => field === key), true, `${key} is a column on the requests screen`);
  }
});

test("the board is off on Pending, where every row holds the same status", () => {
  assert.match(PAGE, /const onBoard = layout === "board" && !onPendingTab;/);
});

test("the tab carries its own count, and the footer its own total", () => {
  assert.match(PAGE, /\[PENDING_REQUEST_TAB\]: pendingRequests\.length,/);
  assert.match(PAGE, /onPendingTab \? pendingStats\.total/);
});

test("the Payment Requests screen keeps the Pending tab it already had", () => {
  assert.deepEqual(requestTabs.map((tab) => tab.label), ["All", "Pending", "Approved", "Rejected"]);
  assert.match(REQUESTS_PAGE, /requestTabs/);
});
