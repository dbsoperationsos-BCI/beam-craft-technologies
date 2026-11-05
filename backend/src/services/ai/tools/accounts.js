const cash = require("../../../modules/accounts/cash-entries/read.service");
const dataScope = require("../../dataScope.service");

// The same scope, on the same columns, as the Cash Management screen: the session's grant decides
// whose entries are read, so the assistant can never answer with more than the screen shows.
const scopeFor = (session) => dataScope.resolve({
  userId: session?.userId,
  module: "ACCOUNTS",
  feature: "Cash Management",
  columns: { branch: "branchId", employee: "handlerEmployeeId", user: "createdBy" },
});

/**
 * Read-only tools for ACCOUNTS / Cash Management.
 *
 * Money, so the shape is narrow: bank account numbers, transaction ids and payment proofs are never
 * selected. Totals are summed in the database rather than by the model - asking one to add up a
 * page of amounts is how a figure ends up wrong, and a wrong figure about money is worse than most.
 *
 * The module's permission is what gates this. A user without ACCOUNTS access cannot open the scope,
 * and the tools are never offered to a session that did not.
 */

const TOOLS = [
  {
    name: "accounts.getCashSummary",
    module: "ACCOUNTS",
    risk: "READ",
    summary: true,
    description:
      "What has come in and gone out, totalled by type and category. Use this for any question "
      + "about how much, rather than listing entries and adding them up.",
    schema: { type: "object", properties: {} },
    execute: async (_args, session) => cash.getCashSummary({ scope: await scopeFor(session) }),
    renderSummary: (result) => [
      `Cash entries: ${result.entries}`,
      ...result.byType.map((row) => `${row.value}: ${row.count} entries totalling ${row.amount}`),
    ].join("\n"),
  },

  {
    name: "accounts.searchEntries",
    module: "ACCOUNTS",
    risk: "READ",
    description:
      "Find cash entries by client name or entry id, optionally filtered by type or category. "
      + "Returns amounts and dates - never account numbers or transaction ids.",
    schema: {
      type: "object",
      properties: {
        search: { type: "string", description: "Part of a client name or entry id." },
        entryType: { type: "string", description: "Received or Spent." },
        category: { type: "string" },
        limit: { type: "integer", description: "Up to 50; defaults to 20." },
      },
    },
    execute: async (args, session) => cash.searchEntries({ ...args, scope: await scopeFor(session) }),
  },
];

module.exports = { TOOLS };
