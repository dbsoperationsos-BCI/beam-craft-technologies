import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/*
 * The advance on Create Project asks for money the same way Accounts does.
 *
 * Both screens draw the same fields from `projectAdvanceFormSections` / `cashEntryFormSections`,
 * and both feed them a context. Create Project built its own by hand and left `paymentModes` out,
 * so the field config's `options: "paymentModes"` resolved to nothing: the Payment Mode dropdown
 * opened empty and, since the advance is required in full, nobody who could see the section could
 * create a project at all.
 *
 * One hook answers it for both now. These pins are about that staying true - a third screen
 * recording money is the next chance to get it wrong.
 */

const read = (file) => fs.readFileSync(path.join(import.meta.dirname, "..", "src", file), "utf8");

test("both money forms read their payment modes from the one hook", () => {
  for (const file of ["components/accounts/CashEntryFormPanel.js", "components/sales/CreateProjectFormPanel.js"]) {
    const source = read(file);
    assert.match(source, /usePaymentModes\(/, `${file} no longer asks the shared payment mode list`);
    assert.doesNotMatch(
      source,
      /getMasterData\("payment-modes"/,
      `${file} reads the payment modes itself again, which is how the two came to disagree`,
    );
  }
});

test("Create Project's advance context carries the payment modes", () => {
  // The missing key is the whole bug. Named explicitly so a refactor that drops it fails here
  // rather than as an empty dropdown somebody reports weeks later.
  const source = read("components/sales/CreateProjectFormPanel.js");
  const context = source.slice(source.indexOf("const advanceContext = useMemo"), source.indexOf("const advanceProblems"));
  assert.ok(context, "advanceContext has been renamed; this pin no longer reads it");
  assert.match(context, /paymentModes: paymentModeOptions\.paymentModes/);
});

test("the advance also gets what each mode asks for, not just the names", () => {
  /*
   * Without these three, `listed()` in accountsConfig falls back to its compiled arrays - so a mode
   * the studio added would ask for no reference and no account, and a mode it renamed would stop
   * asking. The dropdown would look right and the follow-up fields would be wrong.
   */
  const source = read("components/sales/CreateProjectFormPanel.js");
  const context = source.slice(source.indexOf("const advanceContext = useMemo"), source.indexOf("const advanceProblems"));
  for (const key of ["modesWithTransactionId", "modesWithAccount", "modesWithDetails"]) {
    assert.match(context, new RegExp(`${key}: paymentModeOptions\\.${key}`), `the advance ignores ${key}`);
  }
});

test("the list is never empty, because an empty one records no money at all", () => {
  const hook = read("components/accounts/usePaymentModes.js");
  // The studio's list, then what the options endpoint sent, then the compiled fallback.
  assert.match(hook, /fallbackModes\?\.length \? fallbackModes : PAYMENT_MODES/);
});
