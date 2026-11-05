import { formatRupees } from "./saleExtras.mjs";

/*
 * A project Board's money, read the way a project's Payments tab reads it: what has come in and
 * what is still to come. `money` is `{ [projectId]: { received, spent, toReceive } }`
 * (`/api/sales/projects/payments-summary`); a row is found by its `projectId`, else its `id`.
 */
const moneyOf = (row, money) => money?.[row?.projectId || row?.id] || null;

/** Under a column: "Client paid ₹2,81,500 · Balance due ₹833", over the projects the column holds once each. */
export function moneyColumn(rows, money) {
  const seen = new Set();
  let received = 0;
  let toReceive = 0;
  for (const row of rows || []) {
    const id = row?.projectId || row?.id;
    const figures = moneyOf(row, money);
    // A project standing in two columns (Pre Production, Production) is counted in each, once.
    if (!figures || seen.has(id)) continue;
    seen.add(id);
    received += figures.received;
    toReceive += figures.toReceive;
  }
  if (!seen.size) return null;
  return {
    label: "",
    text: `Client paid ${formatRupees(received)} · Balance due ${formatRupees(toReceive)}`,
    title: "What the clients of these projects have paid so far, and what they still owe on their payment schedules - each project's Payments tab has the detail",
  };
}

/** On a card whose client still owes money: "Balance due ₹833". */
export function moneyFlag(row, money) {
  const figures = moneyOf(row, money);
  return figures && figures.toReceive > 0 ? `Balance due ${formatRupees(figures.toReceive)}` : "";
}
