import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/*
 * A branch's bank accounts, in Settings → Organization → Branches.
 *
 * Four columns on the branch held exactly one, and a studio is commonly paid into more than that - a
 * current account per bank, or one kept for a particular kind of work. The register keeps a list now,
 * and the client's quotation payment page prints a card per account in the studio's own order.
 *
 * The same change retired the **other** bank-account list, the one behind Accounts → ⋮ → Settings:
 * the same accounts were typed in two places, by two different permissions, with nothing to say
 * which was right. The three money screens that read it - "received into" on a cash entry, a payment
 * request and a project's advance - read the branch register instead.
 */

const read = (...parts) => fs.readFileSync(path.join(import.meta.dirname, "..", ...parts), "utf8");
const PANEL = read("src", "components", "settings", "BranchesPanel.js");
const ACCOUNTS_PAGE = read("src", "components", "accounts", "AccountsManagerPage.js");
const PAYMENT_PAGE = read("src", "components", "sales", "PublicQuotationPaymentPage.js");

test("the accounts are a list with an Add button, through the control this application already repeats forms with", () => {
  /*
   * `RepeatableDetailsField` is what the employee form adds children and qualifications with: the
   * framed section, the Add, the Remove per row, the empty state, the row keys and the per-box errors
   * are all its own, and the cells are drawn by `SchemaFormField` from a description. So a second
   * repeated form costs a field list rather than a component, and this one reads like the others.
   */
  assert.match(PANEL, /import RepeatableDetailsField from "@\/components\/shared\/RepeatableDetailsField";/);
  assert.match(PANEL, /<RepeatableDetailsField[\s\S]*?label="Bank Accounts"[\s\S]*?addLabel="\+ Add Account"[\s\S]*?fields=\{accountFields\}[\s\S]*?value=\{form\.bankAccounts\}/);
  // No typed boxes left behind beside it: the row is the field list, and nothing else draws one.
  assert.doesNotMatch(PANEL, /label="Account Holder Name" value=\{form\./, "the single-account boxes are gone");
  assert.doesNotMatch(PANEL, /form\.bankAccountNumber|form\.bankIfsc|form\.bankAccountName/, "the branch no longer holds one account in fields of its own");
});

test("every box of an account is asked for, and a row nobody started is not a fault", () => {
  /*
   * All four, because an account missing one of them cannot be paid into - which is the rule the four
   * columns on the branch enforced before they became a list. A client handed a card with no IFSC
   * would try to use it, so a half-filled account is worse than none.
   *
   * A row with nothing in it at all is different: it is the blank row the form opens on, or one
   * somebody added and has not reached yet. It says nothing under its own boxes; the message under the list
   * is what says the branch still needs an account.
   */
  const validate = PANEL.slice(PANEL.indexOf("function validate()"), PANEL.indexOf("/** The form as the server takes it"));
  assert.match(validate, /if \(accountIsBlank\(account\)\) return;/);
  assert.match(validate, /if \(!String\(account\[field\.name\] \?\? ""\)\.trim\(\)\) row\[field\.name\] = `\$\{field\.label\} is required\.`;/);
  // The shapes come from the one table the GSTIN, the PAN and the UPI IDs are checked against.
  assert.match(validate, /fieldError\("accountNumber", number\)/);
  assert.match(validate, /fieldError\("ifsc", ifsc\)/);
  // A repeat is said on the row that repeats, not on the one that came first - the studio meant that one.
  assert.match(validate, /This account number is already listed\./);
  // And a branch with no filled-in account cannot be saved at all.
  // (A started row is caught above, box by box; no started row at all is said under the list.)
  assert.match(PANEL, /\(form\.bankAccounts \|\| \[\]\)\.some\(\(account\) => !accountIsBlank\(account\)\) \? \{\} : \{ bankAccountsList: "Add the account this branch is paid into\." \}/);
});

test("the order on screen is the order that is sent, and blank rows are not sent at all", () => {
  // `position` is the server's, written from this order - so the list on screen is the order the
  // client's payment page prints the cards in.
  assert.match(PANEL, /bankAccounts: \(values\.bankAccounts \|\| \[\]\)\s*\n\s*\.filter\(\(account\) => !accountIsBlank\(account\)\)/);
  assert.match(PANEL, /\.map\(\(account\) => Object\.fromEntries\(ACCOUNT_FIELD_NAMES\.map\(\(name\) => \[name, String\(account\[name\] \?\? ""\)\.trim\(\)\]\)\)\)/);
  // An existing branch opens on the accounts it holds, and on one blank row where it holds none -
  // the same row a new branch opens on, never a spare row under the ones it has.
  assert.match(PANEL, /bankAccounts: accounts\.length \? accounts : \[blankAccount\(\)\],/);
  assert.match(PANEL, /bankAccounts: \[blankAccount\(\)\],/);
});

test("the register's rows show every account, not the first", () => {
  /*
   * Which accounts a branch is paid into is a question somebody opens this register to answer, and a
   * row that showed one of three would answer it wrongly. The bank and the number only: the holder
   * and the IFSC are the same on every account of one studio, so printing them per row would say the
   * same thing three times.
   */
  assert.match(PANEL, /const accountLinesOf = \(branch\) =>/);
  assert.match(PANEL, /accountLinesOf\(branch\)\.length > 1 \? `Bank Accounts \(\$\{accountLinesOf\(branch\)\.length\}\)` : "Bank Account"/);
});

test("the Accounts module's own bank-account list is gone, and its screen with it", () => {
  /*
   * It was the same accounts kept twice. Worse, it was kept behind a *different* permission - the
   * panel asked for HRM / Employee Management, because its rows were HRM master data - so who could
   * correct an account depended on which of the two lists they opened.
   */
  assert.equal(
    fs.existsSync(path.join(import.meta.dirname, "..", "src", "components", "accounts", "BankAccountsPanel.js")),
    false,
    "the panel that edited the second list should be gone, not merely unreachable",
  );
  assert.doesNotMatch(ACCOUNTS_PAGE, /BankAccountsPanel|canEditBankAccounts|settingsOpen/);
  /*
   * The defect was the same *records* being editable from two screens under two different ticks, so
   * who could correct an account depended on which one they opened. What the page must not do is ask
   * for `HRM / Employee Management` - a permission about employees deciding who may edit money.
   *
   * It does now ask about `ACCOUNTS / Payment Request`, for the Pending tab, which is not
   * that mistake: those are other records, read-only here, behind the very permission their own
   * screen and their own endpoint require. Narrowed from "asks about no other permission at all",
   * which forbade reading anything a second permission governs.
   */
  assert.doesNotMatch(ACCOUNTS_PAGE, /HRM", "Employee Management/, "no employee permission decides anything about money here");
  assert.doesNotMatch(ACCOUNTS_PAGE, /canEditBankAccounts/);
  // Import keeps the ⋮ it shared with Settings; what is gone is the Settings entry beside it.
  assert.match(ACCOUNTS_PAGE, /\{ label: "Import", onSelect: \(\) => setImportOpen\(true\) \},/);
  assert.doesNotMatch(ACCOUNTS_PAGE, /label: "Settings"/);
});

test("the client is shown a card per account, in the branch's own order", () => {
  assert.match(PAYMENT_PAGE, /const accounts = \(Array\.isArray\(payment\?\.accounts\) \? payment\.accounts : \[\]\)/);
  // Each card prints only what its account holds, as a single account always did: a label over a
  // blank tells a client nothing and makes the sheet look unfinished.
  assert.match(PAYMENT_PAGE, /\]\.filter\(\(\[, value\]\) => Boolean\(value\)\),/);
  // Keyed by the number, which is what makes an account that account - never by its position.
  assert.match(PAYMENT_PAGE, /key=\{account\.rows\.find\(\(\[label\]\) => label === "Account Number"\)\?\.\[1\] \|\| `account-\$\{index\}`\}/);
});

test("a row read back and a row just added can never share a key", () => {
  /*
   * `RepeatableDetailsField` keys a row that arrived without one by its **position**, and a row the
   * form adds from a seed of its own. Both used to spell it `row-N`, so a branch holding two accounts
   * (`row-0`, `row-1`) and one press of Add (`row-1`, the seed's first) ended up with **two rows
   * under one key**: React reused a cell for the wrong row, and Remove - which filters by key -
   * deleted both of them at once. Four typed boxes gone on one press, with nothing said.
   *
   * It bit here first because a branch opens on the accounts it already holds, but the control is the
   * employee form's too - children, qualifications, previous companies - so the fix is in the control
   * and every list gains it.
   */
  const control = read("src", "components", "shared", "RepeatableDetailsField.js");
  assert.match(control, /const nextRowKey = \(\) => `added-\$\{\(rowKeySeed \+= 1\)\}`;/);
  assert.match(control, /key: row\.key \|\| `loaded-\$\{index\}`/);
  assert.equal(/`row-\$\{/.test(control), false, "one namespace for both kinds of row is how they collided");
});

test("the account field list is in hand before the empty form is built", () => {
  /*
   * `emptyForm` opens a new branch on one blank account, so it **calls** `blankAccount()` while this
   * module is still being evaluated - and `blankAccount` reads `ACCOUNT_FIELD_NAMES`, a `const` that
   * does not exist until its own line has run. Declared after the form, importing the file threw
   * "Cannot access 'ACCOUNT_FIELD_NAMES' before initialization", and because the settings overlay is
   * reached from the app shell that took down every signed-in page rather than this panel alone.
   *
   * `blankAccount` being a hoisted function declaration is what made it look safe: what runs early is
   * the call, not the definition. Nothing else catches it - the build compiles it happily, the code
   * being legal and only the order wrong - so the order is asserted.
   */
  const fields = PANEL.indexOf("const ACCOUNT_FIELD_NAMES = ");
  const form = PANEL.indexOf("const emptyForm = {");
  assert.notEqual(fields, -1);
  assert.notEqual(form, -1);
  assert.ok(fields < form, "ACCOUNT_FIELD_NAMES must be declared above the form whose construction reads it");
});
