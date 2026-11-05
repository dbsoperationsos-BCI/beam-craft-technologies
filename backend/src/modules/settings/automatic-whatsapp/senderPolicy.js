const prisma = require("../../../config/db");
// Lazily: `reportGroup` sends through this file, and a require at the top would meet it half-loaded.
const reportGroup = () => require("../../hrm/attendance/reportGroup");

/**
 * Who an automatic WhatsApp message goes from, chosen per message in one of two ways:
 *
 * - **`SAME` - "Sender".** One chosen employee sends it every time (`senderUserId`); where they
 *   cannot, everybody else with Allow WhatsApp ticked is tried in the fallback order an administrator
 *   dragged them into (`FALLBACK` places; anybody given Allow WhatsApp since, after them by name).
 *   With no sender chosen, nothing is sent.
 * - **`ROTATE` - "Rotation".** Every employee with Allow WhatsApp ticked takes a turn, in the order an
 *   administrator dragged them into (`ROTATION` places; anybody given Allow WhatsApp since, after
 *   them by name). Each message starts from the next after the one that sent the last
 *   (`lastSenderUserId`); one who cannot send is passed over for the one after.
 *
 * Each mode keeps its own setting and its own order, so switching between them loses neither. Everybody is checked at
 * every send - an active employee with Allow WhatsApp ticked (`reportGroup.ELIGIBLE_SENDER`), their
 * own chat switch, a connected WhatsApp. A send that may have gone (`reportGroup.certainlyNotSent`
 * false - a timeout, a dropped socket) stops there rather than risk the message twice.
 *
 * Two messages are not one of these, and always go from the person the record names rather than from
 * a chosen sender: **New Lead Welcome**, from the lead's own owner, and the **shoot crew notice** -
 * both arms - from the project's own Pre-Production Coordinator or Production Manager
 * (`shoot-crew-notice/projectSender.js`). Its `SHOOT_CREW_NOTICE` key was removed from this list, and
 * its row deleted, when that shipped.
 */

const MESSAGE_KEYS = Object.freeze({
  ATTENDANCE_REPORT: "ATTENDANCE_REPORT",
  WISHES: "WISHES",
  PHOTO_SELECTION_SUBMITTED: "PHOTO_SELECTION_SUBMITTED",
  // The payment reminder and the money-received message share one sender setting.
  PAYMENT_REMINDER: "PAYMENT_REMINDER",
  INTERVIEW_WELCOME: "INTERVIEW_WELCOME",
});
const MODES = Object.freeze({ SAME: "SAME", ROTATE: "ROTATE" });
const LISTS = Object.freeze({ FALLBACK: "FALLBACK", ROTATION: "ROTATION" });
const NO_SENDER = "No sender is chosen for this message.";

const failure = (status, message) => Object.assign(new Error(message), { status });
// The WhatsApp sessions `reportGroup` sends through - its test stand-in too, where one is set.
const defaultSessions = () => reportGroup().currentSessions();
const chatSwitches = () => require("../../sales/whatsapp-chat/repository");
const SENDER_USER_SELECT = () => ({ ...reportGroup().SENDER_SELECT, linkedEmployee: { select: { employeeName: true, employeeId: true } } });

function knownKey(messageKey) {
  if (!Object.values(MESSAGE_KEYS).includes(messageKey)) throw new Error(`Unknown automatic WhatsApp message: ${messageKey}`);
  return messageKey;
}

/**
 * The rotation in the order this message tries it: starting after the one who sent the last - from
 * the top where nobody has yet, or where they are no longer in the rotation.
 */
function rotateOrder(list, lastSenderUserId) {
  const at = list.findIndex((entry) => entry.id === lastSenderUserId);
  if (at < 0) return [...list];
  return [...list.slice(at + 1), ...list.slice(0, at + 1)];
}

/**
 * How a message's senders stand: `{ mode, sender, fallback, senders, lastSenderUserId }`.
 *
 * - `sender` - the `SAME` mode's sender, `{ priority: 1, id, name, code, connected, eligible }`, or
 *   null. `eligible` false for somebody chosen who has since lost Allow WhatsApp or left, so the page
 *   can say why they are passed over.
 * - `fallback` - everybody else with Allow WhatsApp ticked, in the saved fallback order and then
 *   anybody not in it yet by name, as Priority 2, 3, ...
 * - `senders` - the rotation: every employee with Allow WhatsApp ticked, in the saved rotation order
 *   and then anybody not in it yet by name, from 1.
 * Both orders are read whatever the mode, so the page has them the moment either is chosen.
 */
async function readPolicy(messageKey, { client = prisma, sessions = defaultSessions() } = {}) {
  const row = await client.whatsAppSenderPolicy.findUnique({
    where: { messageKey: knownKey(messageKey) },
    select: {
      mode: true,
      senderUserId: true,
      lastSenderUserId: true,
      sender: { select: SENDER_USER_SELECT() },
      members: { orderBy: { position: "asc" }, select: { userId: true, list: true } },
    },
  });
  const candidates = await reportGroup().senderCandidates({ client });
  const byId = new Map(candidates.map((person) => [person.id, person]));
  const connected = (id) => sessions.sessionState(id)?.status === "connected";
  const chosen = row?.senderUserId || null;
  // A saved order, everybody still eligible in it, then anybody it does not name yet by name.
  const savedOrder = (list, leaveOut = null) => {
    const saved = (row?.members || []).filter((member) => (member.list || LISTS.ROTATION) === list).map((member) => member.userId).filter((id) => byId.has(id) && id !== leaveOut);
    return [...saved, ...candidates.map((person) => person.id).filter((id) => !saved.includes(id) && id !== leaveOut)];
  };
  const entry = (id, priority) => ({ priority, id, name: byId.get(id).name, code: byId.get(id).code || "", connected: connected(id), eligible: true });
  return {
    mode: row?.mode || MODES.SAME,
    lastSenderUserId: row?.lastSenderUserId || null,
    sender: chosen ? {
      priority: 1,
      id: chosen,
      name: byId.get(chosen)?.name || reportGroup().senderName(row.sender),
      code: byId.get(chosen)?.code || row.sender?.linkedEmployee?.employeeId || "",
      connected: connected(chosen),
      eligible: byId.has(chosen),
    } : null,
    fallback: savedOrder(LISTS.FALLBACK, chosen).map((id, index) => entry(id, index + 2)),
    senders: savedOrder(LISTS.ROTATION).map((id, index) => entry(id, index + 1)),
  };
}

/** Who a send tries, in order: the sender then its fallback in `SAME`; the rotation from its next turn in `ROTATE`. */
function orderOf(policy) {
  if (policy.mode === MODES.ROTATE) return rotateOrder(policy.senders, policy.lastSenderUserId);
  return policy.sender ? [policy.sender, ...policy.fallback] : [];
}

/**
 * Saves a message's mode and its settings: `senderUserId`, the `SAME` sender (null for nobody),
 * `fallbackUserIds`, its fallback order, and `userIds`, the rotation order. Repeats and blanks are
 * dropped, the first place kept. A sender newly chosen, and everybody in either order, has to be
 * somebody the picker offers - an active employee
 * with Allow WhatsApp ticked - so a request cannot choose anyone the page would not have. The sender
 * already saved may stay saved after losing it, so switching mode does not quietly clear them.
 */
async function setPolicy(messageKey, { mode, senderUserId = null, fallbackUserIds = [], userIds = [] } = {}, { client = prisma, sessions = defaultSessions() } = {}) {
  knownKey(messageKey);
  if (!Object.values(MODES).includes(mode)) throw failure(400, "Choose Sender or Rotation.");
  const sender = senderUserId === null || senderUserId === undefined || senderUserId === "" ? null : Number(senderUserId);
  if (sender !== null && (!Number.isInteger(sender) || sender <= 0)) throw failure(400, "Choose the sender.");
  const idsOf = (list, message) => {
    if (list !== null && list !== undefined && !Array.isArray(list)) throw failure(400, message);
    const raw = (list || []).filter((value) => value !== null && value !== "");
    if (raw.some((value) => !Number.isInteger(Number(value)) || Number(value) <= 0)) throw failure(400, message);
    return [...new Set(raw.map(Number))];
  };
  const ids = idsOf(userIds, "Choose the rotation order.");
  const fallbackIds = idsOf(fallbackUserIds, "Choose the fallback order.");

  const existing = await client.whatsAppSenderPolicy.findUnique({ where: { messageKey }, select: { senderUserId: true } });
  const toCheck = [...new Set([...ids, ...fallbackIds, ...(sender !== null && sender !== existing?.senderUserId ? [sender] : [])])];
  if (toCheck.length) {
    const found = await client.user.findMany({ where: { id: { in: toCheck }, ...reportGroup().ELIGIBLE_SENDER }, select: { id: true } });
    if (found.length !== toCheck.length) throw failure(400, "Every sender has to be an active employee with Allow WhatsApp ticked on their login.");
  }
  await client.$transaction(async (tx) => {
    await tx.whatsAppSenderPolicy.upsert({ where: { messageKey }, update: { mode, senderUserId: sender }, create: { messageKey, mode, senderUserId: sender } });
    await tx.whatsAppSenderPolicyMember.deleteMany({ where: { messageKey } });
    const places = [
      ...ids.map((userId, index) => ({ messageKey, list: LISTS.ROTATION, userId, position: index + 1 })),
      ...fallbackIds.map((userId, index) => ({ messageKey, list: LISTS.FALLBACK, userId, position: index + 1 })),
    ];
    if (places.length) await tx.whatsAppSenderPolicyMember.createMany({ data: places });
  });
  return readPolicy(messageKey, { client, sessions });
}

/** The senders in the order this send tries them. */
async function orderForSend(messageKey, { client = prisma, sessions = defaultSessions() } = {}) {
  return orderOf(await readPolicy(messageKey, { client, sessions }));
}

/** Whether there is anybody to send from at all - a sender chosen, or anyone to rotate through. */
const hasSender = (policy) => orderOf(policy).length > 0;

/**
 * Remembers who sent the last, for `ROTATE`'s next turn. Never fatal: the message has gone, and a
 * turn taken twice is only an uneven share - two processes sending at once may both read the same
 * last sender, which is accepted for the same reason.
 */
async function markSent(messageKey, userId, { client = prisma } = {}) {
  try {
    await client.whatsAppSenderPolicy.updateMany({ where: { messageKey }, data: { lastSenderUserId: userId } });
  } catch (error) {
    console.warn(`[sender-policy] could not note ${messageKey}'s last sender: ${error.message}`);
  }
}

/** A sender this attempt cannot use - not in the group, over its hourly cap - so the next is tried. */
const skip = (message) => Object.assign(new Error(message), { skip: true });

/**
 * Sends one message: each sender in this send's order is asked - switched off, no longer an active
 * Allow-WhatsApp employee, or not connected passes them over with the reason - and `attempt(sender)`
 * does the send itself. It either returns (sent), throws `skip(...)` (this sender cannot - try the
 * next), or throws a send error, which moves on only where it certainly did not go.
 *
 * Answers `{ outcome, userId, who, reasons, attempted, result }`: `"sent"` (and who), `"failed"`
 * (nobody asked could), or `"maybe-sent"` (stopped rather than risk it twice). `attempted` says
 * whether any send was actually made.
 */
async function trySenders(messageKey, attempt, {
  client = prisma,
  sessions = defaultSessions(),
  isChatEnabledForUser = (userId) => chatSwitches().isChatEnabledForUser(userId),
  mayStillSend = async (userId) => Boolean(await client.user.findFirst({ where: { id: userId, ...reportGroup().ELIGIBLE_SENDER }, select: { id: true } })),
} = {}) {
  const reasons = [];
  const order = await orderForSend(messageKey, { client, sessions });
  if (!order.length) return { outcome: "failed", userId: null, who: null, reasons: [NO_SENDER], attempted: false, result: null };
  let attempted = false;
  for (const sender of order) {
    const who = `Priority ${sender.priority}${sender.name ? ` (${sender.name})` : ""}`;
    if (!(await isChatEnabledForUser(sender.id))) { reasons.push(`${who}: WhatsApp chat is switched off for them`); continue; }
    if (!(await mayStillSend(sender.id))) { reasons.push(`${who}: no longer an active employee with Allow WhatsApp ticked`); continue; }
    if (sessions.sessionState(sender.id)?.status !== "connected") { reasons.push(`${who}: WhatsApp is not connected`); continue; }
    let result;
    try {
      result = await attempt({ ...sender, who });
    } catch (error) {
      const why = String(error?.message || "could not send").replace(/\.$/, "");
      reasons.push(`${who}: ${why}`);
      if (!error?.skip) attempted = true;
      if (error?.skip || reportGroup().certainlyNotSent(error)) continue;
      return { outcome: "maybe-sent", userId: null, who: null, reasons, attempted: true, result: null };
    }
    await markSent(messageKey, sender.id, { client });
    return { outcome: "sent", userId: sender.id, who, reasons, attempted: true, result };
  }
  return { outcome: "failed", userId: null, who: null, reasons, attempted, result: null };
}

/** The shape every sender panel reads: the mode, the sender and its fallback order, and the rotation. */
const statusFields = (policy) => ({ senderMode: policy.mode, sender: policy.sender, fallback: policy.fallback, senders: policy.senders });

module.exports = { MESSAGE_KEYS, MODES, NO_SENDER, rotateOrder, orderOf, hasSender, readPolicy, setPolicy, orderForSend, markSent, skip, trySenders, statusFields };
