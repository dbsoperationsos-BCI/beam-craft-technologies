const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { accountOptionLabel, receivedIntoOptions, MAX_LABEL } = require("../src/services/branchBankAccounts");

/**
 * The "received into" list on a cash entry, a payment request and a project's advance.
 *
 * All three asked the Accounts module's own bank-account register, which was a second list of the
 * same accounts kept beside the branch's. The branch register is the only one now, and this is where
 * those three read it.
 *
 * What makes the label worth a file of its own: each of those three stores the answer as **text** on
 * the record, so the label is the stored value. It has to be built in one place or the same account
 * would read two ways on two screens, and it has to fit the column that holds it.
 */

test("an account reads as its bank, its last four digits and its branch", () => {
  assert.equal(
    accountOptionLabel({ bankName: "Union Bank — Erode", accountNumber: "123456789012" }, "Erode TN"),
    "Union Bank — Erode · ••••9012 · Erode TN",
  );
  /*
   * The bank first because that is what somebody hunting for an account thinks of first; the digits
   * because one branch may bank twice at one bank; the branch last because the same bank and the same
   * four digits across two branches would otherwise be one line printed twice.
   */
  const two = [
    accountOptionLabel({ bankName: "HDFC", accountNumber: "50100000001111" }, "Erode TN"),
    accountOptionLabel({ bankName: "HDFC", accountNumber: "50100000002222" }, "Erode TN"),
  ];
  assert.notEqual(two[0], two[1], "two accounts at one bank must not read identically");
});

test("a label never outgrows the column that stores it", () => {
  /*
   * `CashEntry.receivedAccount` and the payment request's own column hold 120 characters. A longer
   * label is what MySQL truncates or refuses - and a truncated one is a record pointing at an
   * account nobody can find again.
   */
  const long = accountOptionLabel({ bankName: "B".repeat(200), accountNumber: "123456789012" }, "A".repeat(90));
  assert.ok(long.length <= MAX_LABEL, `a ${long.length}-character label would not fit`);
  /*
   * The **bank name** is what gives, because it is the part still recognisable when shortened: a
   * trimmed branch name or half an account number would be a label naming the wrong thing.
   */
  assert.ok(long.includes("••••9012"), "the digits survive");
  assert.ok(long.endsWith("A".repeat(90)), "and so does the branch");
  assert.ok(long.includes("…"), "the bank name is the part that is shortened, and says so");
});

test("only open branches offer an account, and a branch's own order is kept", async () => {
  /*
   * A branch that has stopped trading is not somewhere money is received today, and offering its
   * account would file a new entry against a closed place - the register this replaced drew the same
   * line with `isActive`. An entry already filed against it keeps its text, which is why every one of
   * these columns is text.
   */
  const asked = [];
  const client = {
    branch: {
      findMany: async (query) => {
        asked.push(query);
        return [
          { name: "Erode TN", bankAccounts: [
            { bankName: "Union Bank — Erode", accountNumber: "123456789012" },
            { bankName: "HDFC — Erode", accountNumber: "50100234567890" },
          ] },
          { name: "Bangalore KA", bankAccounts: [] },
        ];
      },
    },
  };
  const options = await receivedIntoOptions(client);
  assert.deepEqual(options, [
    "Union Bank — Erode · ••••9012 · Erode TN",
    "HDFC — Erode · ••••7890 · Erode TN",
  ], "every account of every open branch, in the branch's own order, and nothing for a branch with none");
  assert.deepEqual(asked[0].where, { isActive: true });
  assert.deepEqual(asked[0].select.bankAccounts.orderBy, { position: "asc" });
});

test("the three money screens read this and nothing else", () => {
  /*
   * The register they used to read is retired. What matters here is that none of the three grew its
   * own way of asking - one list, and one spelling of an account across all three.
   */
  const controller = (...parts) => fs.readFileSync(path.join(__dirname, "..", "src", "modules", ...parts), "utf8");
  for (const file of [
    ["accounts", "cash-entries", "controller.js"],
    ["hrm", "payment-requests", "controller.js"],
    ["sales", "projects", "controller.js"],
  ]) {
    const source = controller(...file);
    assert.match(source, /receivedIntoOptions\(\)/, `${file.join("/")} should read the branch register`);
    assert.doesNotMatch(source, /prisma\.bankAccount\.findMany/, `${file.join("/")} still reads the retired register`);
  }
  // And the master-data list behind it is gone, so nothing can write to that table any more.
  const definitions = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "hrm", "master-data", "definitions.js"), "utf8");
  assert.doesNotMatch(definitions, /"bank-accounts": \{/);
});
