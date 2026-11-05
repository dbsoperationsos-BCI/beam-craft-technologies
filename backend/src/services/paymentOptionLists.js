const prisma = require("../config/db");

/**
 * The payment lists whose *meaning* the code depends on, read from the list itself.
 *
 * How money moved is not just a word on a form: a mode that arrives with a reference from the
 * payment app or the bank is asked for it, one that moves money through an account is asked which,
 * and "Other" is the way out that then says what it actually was. Those three answers were three
 * arrays - `MODES_WITH_TRANSACTION_ID`, `MODES_WITH_ACCOUNT`, `OTHER_PAYMENT_MODE` - written out
 * twice over: once in `constants/accountsConfig.js` for the form and again in
 * `cash-entries/controller.js`, where they decide whether an entry is accepted. A studio that added
 * a mode of its own got one the form offered and the server refused.
 *
 * The meaning is on the row now (`asks_for_transaction_id`, `asks_for_account`, `asks_for_details`)
 * and this is what reads it, so the list can be edited in Settings → Field Settings → Accounts →
 * Payment Mode and the validation follows.
 *
 * Falling back and caching work exactly as they do in `employeeOptionLists` beside this, and for the
 * same reasons: every read falls back to what the code used to say, because answering "no mode is
 * valid" would refuse every cash entry the studio tried to record; and these are read on the write
 * path of every entry, so a round trip per call for a table of six rows is a cost worth avoiding.
 * `forgetPaymentOptionLists()` empties the cache the moment Field Settings writes to one.
 */

/** What the code said before these lists were editable. */
const FALLBACK_MODES = ["UPI", "Bank Transfer", "Net Banking", "Cash", "Credit / Debit Cards", "Other"];
const FALLBACK_MODES_WITH_TRANSACTION_ID = ["UPI", "Bank Transfer", "Net Banking"];
const FALLBACK_MODES_WITH_ACCOUNT = ["Bank Transfer", "Net Banking", "Credit / Debit Cards"];
const FALLBACK_MODES_WITH_DETAILS = ["Other"];

const MEANINGFUL_RESOURCES = new Set(["payment-modes", "payment-schedule-categories", "tiers"]);

const TTL_MS = 60_000;
const cache = new Map();

/** One read, cached, and never allowed to answer with nothing - see the note above. */
async function cached(key, read, fallback) {
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;
  let value;
  try {
    value = await read();
  } catch (error) {
    console.warn(`Unable to read the ${key} list, using what the code used to say:`, error?.message || error);
    return fallback;
  }
  if (!value || (Array.isArray(value) && !value.length)) return fallback;
  cache.set(key, { value, expires: Date.now() + TTL_MS });
  return value;
}

/** Every mode with its three answers, which is what the four readers below are cut from. */
function paymentModeRows() {
  return cached("payment-modes", () => prisma.paymentMode.findMany({
    where: { isActive: true },
    select: { name: true, asksForTransactionId: true, asksForAccount: true, asksForDetails: true },
    orderBy: { sortOrder: "asc" },
  }), null);
}

/** The modes a cash entry may name. */
async function paymentModes() {
  const rows = await paymentModeRows();
  return rows ? rows.map((row) => row.name) : FALLBACK_MODES;
}

/** The modes that carry a reference from the payment app or the bank. */
async function modesWithTransactionId() {
  const rows = await paymentModeRows();
  return rows ? rows.filter((row) => row.asksForTransactionId).map((row) => row.name) : FALLBACK_MODES_WITH_TRANSACTION_ID;
}

/** The modes that move money through one of the studio's accounts. */
async function modesWithAccount() {
  const rows = await paymentModeRows();
  return rows ? rows.filter((row) => row.asksForAccount).map((row) => row.name) : FALLBACK_MODES_WITH_ACCOUNT;
}

/** The modes that say what they actually were - "Other" and anything the studio adds like it. */
async function modesWithDetails() {
  const rows = await paymentModeRows();
  return rows ? rows.filter((row) => row.asksForDetails).map((row) => row.name) : FALLBACK_MODES_WITH_DETAILS;
}

/** Field Settings has written to one of these lists, so what is cached is out of date. */
function forgetPaymentOptionLists(resource) {
  if (!resource || MEANINGFUL_RESOURCES.has(resource)) cache.clear();
}

module.exports = {
  paymentModes,
  modesWithTransactionId,
  modesWithAccount,
  modesWithDetails,
  forgetPaymentOptionLists,
  FALLBACK_MODES,
  FALLBACK_MODES_WITH_TRANSACTION_ID,
  FALLBACK_MODES_WITH_ACCOUNT,
  FALLBACK_MODES_WITH_DETAILS,
};
