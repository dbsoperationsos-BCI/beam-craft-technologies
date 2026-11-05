const prisma = require("../../../config/db");
const { renderMessage, TEMPLATE_KEYS } = require("../../../services/messageTemplate");

/**
 * The receipt the studio sends a client after money comes in.
 *
 * The wording is the `CASH_RECEIVED` template, written in Settings; this fills in the facts of one
 * entry. It is built on the server rather than in the browser for two reasons: the outstanding
 * balance is the project's whole ledger rather than anything the form holds, and the template is
 * read here with the entry the reader has just written instead of being fetched separately by a
 * screen that would then need the settings permission to see it.
 *
 * Money **spent** gets none: there is nobody to send a receipt to.
 */

const rupees = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 });

/*
 * The date, written out rather than formatted by `Intl`.
 *
 * `month: "short"` is the ICU library's idea of short, and it moved: newer Node builds render
 * September as "Sept" in en-GB. This message goes to a client, so the wording must not depend on
 * which Node the studio's server happens to be running.
 */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const money = (value) => rupees.format(Number(value) || 0);
const onDate = (value) => {
  if (!value) return "";
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return "";
  return `${String(at.getDate()).padStart(2, "0")} ${MONTHS[at.getMonth()]} ${at.getFullYear()}`;
};

/**
 * What this project still owes, on the same arithmetic the Payments tab shows.
 *
 * Signed is the quotation the project converted at plus every approved extra; received is every
 * receipt against it, this one included - the entry is written before this runs, so the balance is
 * the one that is true after the payment being acknowledged.
 *
 * Floored at zero: a project paid more than it was sold for has an *extra*, not a negative
 * outstanding, which is the reading the Payments tab already takes.
 */
async function outstandingFor(projectId, client = prisma) {
  if (!projectId) return null;
  const project = await client.salesProject.findUnique({ where: { id: projectId }, select: { initialConvertedValue: true } });
  if (!project) return null;
  const [extras, received] = await Promise.all([
    client.projectExtraQuotation.aggregate({ where: { projectId, status: "APPROVED", deletedAt: null }, _sum: { amount: true } }),
    client.cashEntry.aggregate({ where: { projectId, entryType: "Received", deletedAt: null }, _sum: { amount: true } }),
  ]);
  const signed = Number(project.initialConvertedValue || 0) + Number(extras._sum.amount || 0);
  return Math.max(0, signed - Number(received._sum.amount || 0));
}

/**
 * The rendered receipt for one entry, or null.
 *
 * Null where there is nothing to send - money spent, or a studio that has deleted the template -
 * and the screen then shows nothing rather than a message full of bare placeholders.
 */
async function receiptMessageFor(entry, client = prisma) {
  if (!entry || entry.entryType !== "Received") return null;
  const outstanding = await outstandingFor(entry.projectId, client);
  return renderMessage(TEMPLATE_KEYS.CASH_RECEIVED, {
    "payment amount": money(entry.amount),
    "payment date": onDate(entry.entryDate),
    // Named for what it was spent on where a shoot was chosen, and for the project otherwise: a
    // receipt that reads "towards the" and stops says less than one naming the booking.
    "shoot name": entry.shoot?.shoot || entry.project?.eventId || "",
    "payment mode": entry.paymentMode || "",
    // Left as the placeholder when there is no project to total - a receipt claiming a balance of
    // zero for a payment filed against nothing would be a figure nobody can check.
    "outstanding balance": outstanding === null ? undefined : money(outstanding),
    "payment id": entry.entryId || "",
    "client name": entry.clientName || entry.project?.clientName || "",
    "project id": entry.project?.eventId || "",
  }, client);
}

module.exports = { receiptMessageFor, outstandingFor };
