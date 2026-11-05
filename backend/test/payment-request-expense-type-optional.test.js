const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");

/*
 * An expense submission settling an **excess** is unspent advance money being handed back. There is
 * nothing it was spent on, so the form does not ask what the expense was for — and the column has
 * to accept NULL for it, rather than a line storing "" to mean "none".
 */

test("the expense type is optional on the line and required by the request instead", () => {
  const controller = read("src/modules/hrm/payment-requests/controller.js");
  // Only the request knows which settlement it is, so the line itself cannot decide this.
  assert.match(controller, /expenseType: optionalText\(60\),/);
  assert.doesNotMatch(controller, /expenseType: requiredText\(60/);
  assert.match(controller, /if \(await asksExpenseType\(value\)\) \{/);
  assert.match(controller, /issue\("expenses", `Expense line \$\{index \+ 1\}: choose what the expense was for`\)/);
});

test("an excess is the one itemising kind not asked, and the advance still is", () => {
  const controller = read("src/modules/hrm/payment-requests/controller.js");
  // Read off the same rule the QR code field uses, which is the `means_excess` flag on the list.
  assert.match(controller, /const asksExpenseType = async \(input\) => TYPES_WITH_EXPENSES\.includes\(input\.type\) && await takesQrCode\(input\);/);
  assert.match(controller, /const takesQrCode = async \(input\) => !\(input\.type === "EXPENSE_SUBMISSION" && input\.settlement === await excessSettlement\(\)\);/);
});

test("a type sent on an excess anyway is not stored", () => {
  const controller = read("src/modules/hrm/payment-requests/controller.js");
  assert.match(controller, /function expenseRows\(input, asksType = true\) \{/);
  // `|| null` too: the per-line schema would let "" through, and NULL is how the column says none.
  assert.match(controller, /expenseType: asksType \? \(line\.expenseType \|\| null\) : null,/);
  // Both writers pass the answer, so neither create nor edit can fill the column behind the form.
  assert.equal((controller.match(/expenseRows\(input, await asksExpenseType\(input\)\)/g) || []).length, 2);
});

test("the column accepts NULL, and widening it cannot fail on existing rows", () => {
  assert.match(read("prisma/schema.prisma"), /expenseType String\?\s+@map\("expense_type"\) @db\.VarChar\(60\)/);
  const sql = read("prisma/migrations/20261102130000_expense_type_optional_on_an_excess/migration.sql");
  assert.match(sql, /ALTER TABLE `payment_request_expense` MODIFY COLUMN `expense_type` VARCHAR\(60\) NULL;/);
});
