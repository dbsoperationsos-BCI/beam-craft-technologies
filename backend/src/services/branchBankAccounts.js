const prisma = require("../config/db");

/**
 * The accounts the studio is paid into, as the money screens offer them.
 *
 * Cash entries, payment requests and a project's advance all ask "which account did this go into",
 * and all three used to read the Accounts module's own bank-account register - a second list of the
 * same accounts, kept beside the branch's and by different hands. The branch register is the only
 * one now, so this is where those three get their list.
 *
 * **The label is the stored value.** Each of those three keeps the answer as *text* on the record
 * (`CashEntry.receivedAccount` and the payment request's own column, both VarChar(120)), on purpose:
 * it is the account as chosen on the day, so a branch renamed or an account closed later cannot
 * rewrite what a past entry says. Two consequences, and this file exists for both. The label has to
 * be built in one place or the same account would read two ways on two screens - and it has to fit
 * 120 characters, because what will not fit is what MySQL refuses or truncates.
 */

/** What the column that stores the chosen label holds. */
const MAX_LABEL = 120;

/** The last four digits, which is as much of an account number as anybody needs to tell two apart. */
const lastFour = (accountNumber) => String(accountNumber ?? "").trim().slice(-4);

/**
 * One account, as it reads in a dropdown: the bank, the last four digits, and the branch.
 *
 * The bank first because that is what somebody looking for an account thinks of first, the digits
 * because a branch may bank twice at one bank, and the branch last because the same bank and the
 * same four digits across two branches would otherwise be one line twice over.
 *
 * The **bank name** is what gives if the three together will not fit: it is the part a reader can
 * still recognise when it is shortened, where a trimmed branch name or half an account number would
 * be a label that names the wrong thing. A label is never built longer than the column that stores
 * it - a truncated one is a record pointing at an account nobody can find again.
 */
function accountOptionLabel(account = {}, branchName = "") {
  const tail = ` · ••••${lastFour(account.accountNumber)} · ${String(branchName ?? "").trim()}`;
  const bank = String(account.bankName ?? "").trim();
  const room = MAX_LABEL - tail.length;
  if (room <= 0) return `${bank}${tail}`.slice(0, MAX_LABEL);
  return `${bank.length > room ? `${bank.slice(0, room - 1).trimEnd()}…` : bank}${tail}`;
}

/**
 * Every account a client's money may be recorded into, in the register's own order - the head office
 * first, then branches by name, and within a branch the order the studio listed its accounts in.
 *
 * **Open branches only.** A branch that has stopped trading is not somewhere money is received
 * today, and offering its account would file a new entry against a closed place; the register this
 * replaced drew the same line with `isActive`. An entry already filed against it keeps its text, as
 * everything about this column is text for that reason.
 */
async function receivedIntoOptions(client = prisma) {
  const branches = await client.branch.findMany({
    where: { isActive: true },
    orderBy: [{ isHeadOffice: "desc" }, { name: "asc" }],
    select: {
      name: true,
      bankAccounts: { select: { bankName: true, accountNumber: true }, orderBy: { position: "asc" } },
    },
  });
  return branches.flatMap((branch) => (branch.bankAccounts || []).map((account) => accountOptionLabel(account, branch.name)));
}

/**
 * The same accounts grouped under their open branch, with the branch's id - what a branch transfer
 * picks from, where the account the money left must be one of the branch it left. Same labels as
 * `receivedIntoOptions`, so an account reads one way on every money screen.
 */
async function accountsByBranch(client = prisma) {
  const branches = await client.branch.findMany({
    where: { isActive: true },
    orderBy: [{ isHeadOffice: "desc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      bankAccounts: { select: { bankName: true, accountNumber: true }, orderBy: { position: "asc" } },
    },
  });
  return branches.map((branch) => ({
    id: branch.id,
    name: branch.name,
    accounts: (branch.bankAccounts || []).map((account) => accountOptionLabel(account, branch.name)),
  }));
}

module.exports = { accountOptionLabel, receivedIntoOptions, accountsByBranch, MAX_LABEL };
