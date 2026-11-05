const prisma = require("../../../config/db");

/*
 * How much one person's WhatsApp may send in an hour, counted across **both** arms of the shoot
 * notice.
 *
 * The per-sweep caps in `sender.js` and `vendorSender.js` bound a minute, not a rate: five a sweep,
 * one sweep a minute, is 300 an hour for the studio and - before this - 180 from a single number.
 * These are real personal WhatsApp accounts and a steady stream of automated messages from one is
 * what gets one banned, which is the worst outcome this feature has.
 *
 * It is counted in one place for both arms deliberately. Somebody may be the Production Manager on one
 * project and the Pre-Production Coordinator on another, and the two sweeps are separate timers: each
 * arm staying within its own cap would still let that one number send both arms' share in the same
 * minute, and neither arm would know. So the question asked here is never "how many has this arm
 * sent" but "how many has **this number** sent", whoever asked for it.
 *
 * `MAX_PER_SENDER_HOUR` is the same 30 the New Lead Welcome holds its owners to
 * (`automatic-whatsapp/newLeadWelcome.js`), for the same reason and so the studio has one number to
 * remember rather than two.
 */

const MAX_PER_SENDER_HOUR = 30;
const HOUR_MS = 60 * 60 * 1000;

/** Every trigger that leaves a sender's own WhatsApp on behalf of a shoot, both arms. */
const SHOOT_NOTICE_TRIGGERS = [
  "SHOOT_CREW_ASSIGNED", "SHOOT_CREW_REMOVED",
  "VENDOR_SHOOT_CONFIRMED", "VENDOR_SHOOT_REMINDER", "VENDOR_SHOOT_DATE_CHANGED",
  "VENDOR_SHOOT_PLACE_CHANGED", "VENDOR_SHOOT_SERVICE_CHANGED", "VENDOR_SHOOT_REMOVED",
];

/**
 * Whether this person's WhatsApp may send one more right now: `{ ok }`, or `{ ok: false, reason }`
 * in the words the panel shows.
 *
 * Read from the WhatsApp Activity Log rather than from a counter of its own, so a restart does not
 * forget what has gone and the number the studio can audit is the number this obeys. Only messages
 * that actually went are counted - a refusal sent nothing and is already paced by the sweep.
 */
async function mayStillSend(senderUserId, { client = prisma, now = new Date(), max = MAX_PER_SENDER_HOUR } = {}) {
  if (!senderUserId) return { ok: false, sent: 0, reason: "There is nobody to send it from." };
  const sent = await client.whatsAppActivity.count({
    where: {
      trigger: { in: SHOOT_NOTICE_TRIGGERS },
      senderUserId,
      status: { in: ["SENT", "DELIVERED", "READ"] },
      sentAt: { gt: new Date(now.getTime() - HOUR_MS) },
    },
  });
  if (sent < max) return { ok: true, sent, reason: "" };
  return { ok: false, sent, reason: `has already sent ${sent} shoot messages in the last hour, which is as many as one WhatsApp number should; the rest go over the next hour` };
}

module.exports = { MAX_PER_SENDER_HOUR, SHOOT_NOTICE_TRIGGERS, mayStillSend };
