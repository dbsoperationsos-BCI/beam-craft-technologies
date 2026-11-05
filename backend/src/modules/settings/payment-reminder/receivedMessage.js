const prisma = require("../../../config/db");
const settings = require("./service");
const sender = require("./sender");
const senderPolicy = require("../automatic-whatsapp/senderPolicy");
const messageSwitches = () => require("../../../services/messageTemplateSwitches");

/**
 * Money received, sent: once a Cash Received entry against a project is saved, its receipt - the
 * `CASH_RECEIVED` wording with the invoice link (`cash-entries/receiptMessage.js`) - goes into the
 * project's own WhatsApp group automatically, from the senders chosen in Settings → Project
 * Management → Payment reminder - its Sender or its Rotation (`automatic-whatsapp/senderPolicy.js`). One message because one payment was recorded; nothing is sent for an entry
 * brought in by an import.
 *
 * Paced so a run of payments - a statement worked through row by row - does not post a burst from one
 * number: one send at a time, a few seconds apart, and at most `DAILY_CAP` a studio day; past it the
 * entry is a FAILED row saying so, and Share invoice sends it by hand. Only an entry typed in
 * (`source` "Manual") is sent: imported rows are history, not a payment just taken.
 *
 * Called after the save has answered, and never fatal: where it cannot go - no sender chosen, none of
 * them can send or is in the project's group, refused by WhatsApp - the entry stands and the reason
 * is a FAILED row in Settings → WhatsApp Activity Log. Share invoice on the row still sends
 * it by hand.
 */

const crypto = require("node:crypto");
const { studioDateKey } = require("../../../services/studioTime");

const activity = () => require("../../../services/whatsappActivity");
const GAP_MS = 3000;
const JITTER_MS = 2000;
const DAILY_CAP = 30;
const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

async function sendReceivedMessage(cashEntryId, body, { client = prisma, switches = null, isMessageOn = (key) => messageSwitches().isEnabled(key) } = {}) {
  // Cash Received switched off under Settings → Templates: not sent, and nothing to log - it was asked for.
  if (!(await isMessageOn("CASH_RECEIVED"))) return "switched-off";
  const entry = await client.cashEntry.findUnique({
    where: { id: cashEntryId },
    select: { id: true, entryType: true, project: { select: { id: true, deletedAt: true, whatsappGroupName: true, whatsappGroupJid: true } } },
  });
  const project = entry?.project;
  if (!entry || entry.entryType !== "Received" || !project || project.deletedAt || !String(body || "").trim()) return "nothing-to-send";

  const context = {
    client, mode: "AUTOMATIC", provider: "baileys", trigger: "CASH_RECEIPT_INVOICE",
    logicalKey: `cash-receipt-auto:${entry.id}`, eventRef: `cash-receipt:${entry.id}`,
    senderUserId: null, recipient: { kind: "GROUP", address: "", name: project.whatsappGroupName || null },
    body, resendable: false, links: { salesProjectId: project.id },
  };
  const refuse = async (message) => {
    await activity().recordFailure(context, Object.assign(new Error(message), { status: 409 }));
    return "failed";
  };
  const { isChatEnabled, isChatEnabledForUser } = switches || require("../../sales/whatsapp-chat/repository");
  if (!(await isChatEnabled())) return refuse("WhatsApp chat is switched off for the studio.");
  const delivery = await senderPolicy.trySenders(settings.MESSAGE_KEY, ({ id: senderId }) => sender.sendToProjectGroup(project, senderId, new Map(), (jid) => activity().track(
    { ...context, senderUserId: senderId, recipient: { ...context.recipient, address: jid }, resendable: true },
    () => sender.sessions().sendMessageToGroup({ userId: senderId, jid, body }),
  )), { client, sessions: sender.sessions(), isChatEnabledForUser });
  if (delivery.outcome === "sent") return "sent";
  // A send that was made has its own row in the log already; one nobody could make gets one saying why.
  if (delivery.attempted) return "failed";
  return refuse(`${delivery.reasons.join(" · ")}${delivery.reasons.length ? "." : ""} Senders are chosen in Settings → Project Management → Payment reminder.`);
}

// One queue for the process: each send waits for the one before it and a gap after.
let queue = Promise.resolve();
const sentOn = { day: "", count: 0 };

/** After the response: the save never waits for WhatsApp, and a failure is only ever logged. */
function sendReceivedMessageLater(cashEntryId, body, { pause = () => wait(GAP_MS + crypto.randomInt(JITTER_MS)) } = {}) {
  queue = queue.then(async () => {
    const today = studioDateKey();
    if (sentOn.day !== today) Object.assign(sentOn, { day: today, count: 0 });
    if (sentOn.count >= DAILY_CAP) {
      await activity().recordFailure({ mode: "AUTOMATIC", provider: "baileys", trigger: "CASH_RECEIPT_INVOICE", logicalKey: `cash-receipt-auto:${cashEntryId}`, eventRef: `cash-receipt:${cashEntryId}`, recipient: { kind: "GROUP", address: "" }, body, resendable: false }, Object.assign(new Error(`${DAILY_CAP} money-received messages have already gone today. Send this one from Share invoice.`), { status: 429 }));
      return;
    }
    if ((await sendReceivedMessage(cashEntryId, body)) === "sent") {
      sentOn.count += 1;
      await pause();
    }
  }).catch((error) => console.warn(`[cash-receipt] automatic send for entry ${cashEntryId} failed: ${error.message}`));
  return queue;
}

module.exports = { DAILY_CAP, sendReceivedMessage, sendReceivedMessageLater };
