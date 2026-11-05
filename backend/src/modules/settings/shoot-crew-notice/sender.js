const crypto = require("node:crypto");
const prisma = require("../../../config/db");
const { isValidPhoneNumber } = require("../../../services/phoneNumber");
const { getTemplate, isMessageEnabled, renderTemplate, TEMPLATE_KEYS } = require("../../../services/messageTemplate");
const settings = require("./service");
const { dayWords, timeWords, clock } = require("./shared");
const projectSender = require("./projectSender");
const senderRate = require("./senderRate");
const { crewNoticesDue } = require("./due");

/*
 * Settings → Project Management → Shoot crew notice, sent.
 *
 * What is owed is `due.js`; this takes that list and sends it, one person at a time, from **the
 * project's own Pre-Production Coordinator** (`projectSender.js`) - not from a Sender picked once in
 * Settings, which is what this used to do. One message per person per change, to their own number,
 * recorded in the WhatsApp Activity Log like every other automatic send.
 *
 * Where that coordinator cannot send - nobody named on the project, no login, Allow WhatsApp not
 * ticked, chat switched off, WhatsApp not connected - **this project's messages wait** and are tried
 * again next sweep. They never go from somebody else's number, and the reason is kept for Settings to
 * show beside the project. Another project's messages in the same sweep are unaffected, since each
 * has its own sender.
 *
 * Paced the way the payment reminder and the wishes are, and for the same reason: these are personal
 * numbers on one studio WhatsApp, and a burst from one number is what gets it banned. At most
 * `MAX_PER_TRY` a sweep, a few seconds apart; the rest wait for the next minute. A person is written
 * into `project_shoot_crew_notice` **before** the send, so two processes cannot both tell them, and
 * the row is put back only where the message certainly did not go.
 */

const TICK_MS = 60 * 1000;
const MAX_PER_TRY = 5;
// Just under the tick, so one sweep a minute - and a crashed one is not held for long.
const CLAIM_MS = 50 * 1000;
const GAP_MS = 3000;
const JITTER_MS = 2000;

const DEFAULT_ASSIGNED = "Hi {employee name}, you are on {shoot} for {project} on {date} ({day}) at {time}, {place}. Your service: {service}.";
const DEFAULT_REMOVED = "Hi {employee name}, you are no longer on {shoot} for {project} on {date} ({day}). Please do not travel for it.";

const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
let sessionsOverride = null;
const sessions = () => sessionsOverride || require("../../sales/whatsapp-chat/sessionManager");
const whatsappActivity = () => require("../../../services/whatsappActivity");

/** What the wording's placeholders are filled with, for one person's notice. */
function valuesFor(item) {
  const { date, day } = dayWords(item.shoot?.dateCreated);
  return {
    "employee name": item.employee?.employeeName || "there",
    shoot: item.shoot?.shoot || "the shoot",
    "shoot id": item.shoot?.shootId || "",
    project: item.project?.whatsappGroupName || item.project?.eventId || "",
    "event id": item.project?.eventId || "",
    date,
    day,
    time: timeWords(item.shoot),
    place: item.shoot?.shootPlace || "",
    district: item.shoot?.district || "",
    service: item.services || "",
    coordinator: item.coordinator || "the production coordinator",
  };
}

/** The message for one notice, in the studio's own wording where it has one. */
function noticeText(item, templates) {
  const assigned = item.kind === "ASSIGNED";
  const template = assigned ? templates.assigned : templates.removed;
  const body = template?.body?.trim() ? template.body : (assigned ? DEFAULT_ASSIGNED : DEFAULT_REMOVED);
  return renderTemplate(body, valuesFor(item));
}

/**
 * Takes this person's notice for this sweep, and answers whether it was ours to take.
 *
 * A **claim**, not a plain write: the row is changed only while it still holds what the sweep read
 * (`before.digest`), so of two sweeps running at once - two API processes - the second finds nothing
 * to change and sends nothing. The same reason the payment reminder claims a payment before sending
 * it. `false` means somebody else has already dealt with this person.
 */
async function remember(item, before, { client = prisma } = {}) {
  // Off the shoot: the row is what makes the message owed, so it is dropped only once it has gone.
  if (item.kind === "REMOVED") return Boolean(before);
  const data = { digest: item.digest, serviceDefinitionId: item.serviceDefinitionId, sentAt: new Date() };
  if (!before) {
    try {
      await client.projectShootCrewNotice.create({ data: { productionId: item.production.id, employeeId: item.employee.id, ...data } });
      return true;
    } catch (error) {
      // Another sweep created it between the read and here.
      if (error?.code === "P2002") return false;
      throw error;
    }
  }
  const { count } = await client.projectShootCrewNotice.updateMany({ where: { id: before.id, digest: before.digest }, data });
  return count > 0;
}

/** The row this person's "off the shoot" message was owed by, dropped now that it has gone. */
const dropNotice = (item, { client = prisma } = {}) => (item.notice
  ? client.projectShootCrewNotice.delete({ where: { id: item.notice.id } }).catch((error) => console.error(`[shoot-crew-notice] could not drop notice ${item.notice.id}:`, error.message))
  : Promise.resolve());

/**
 * Puts the row back exactly as it was, for a message that certainly did not go - every field
 * `remember` wrote, not only the digest, or the next sweep would send a message built from one plan
 * and a row remembering another.
 */
async function forget(item, before, { client = prisma } = {}) {
  // Nothing was written for a REMOVED: its row is dropped after the send, not before.
  if (item.kind === "REMOVED") return;
  try {
    if (before) await client.projectShootCrewNotice.update({ where: { id: before.id }, data: { digest: before.digest, serviceDefinitionId: before.serviceDefinitionId ?? null, sentAt: before.sentAt ?? new Date() } });
    else await client.projectShootCrewNotice.deleteMany({ where: { productionId: item.production.id, employeeId: item.employee.id } });
  } catch (error) {
    // Left as told rather than lost silently: the log is where this is noticed.
    console.error(`[shoot-crew-notice] could not put back employee ${item.employee?.id}'s notice on shoot ${item.shoot?.id}:`, error.message);
  }
}

/**
 * One sweep. Answers what it did - `"sent"`, `"failed"`, or why it did nothing - for the logs and
 * the tests.
 */
async function runOnce({ now = new Date(), client = prisma, switches = null, pause = () => wait(GAP_MS + crypto.randomInt(JITTER_MS)) } = {}) {
  const row = await settings.settingsRow(client);
  if (!row?.enabled) return "off";

  const due = await crewNoticesDue(now, { client });
  if (!due.length) return "nothing-due";

  /*
   * One sweep at a time across processes. Each person is claimed again before their own send, so
   * this is the belt to that pair of braces - and the thing that keeps two API processes from each
   * sending their five a minute from the same number.
   */
  const { count: mine } = await client.shootCrewNoticeSettings.updateMany({
    where: { id: settings.SETTINGS_ID, OR: [{ lastAttemptAt: null }, { lastAttemptAt: { lt: new Date(now.getTime() - CLAIM_MS) } }] },
    data: { lastAttemptAt: now },
  });
  if (!mine) return "nothing-to-do";

  const { isChatEnabled, isChatEnabledForUser } = switches || require("../../sales/whatsapp-chat/repository");
  const waitingWith = (why) => settings.keepError(`${due.length} crew ${due.length === 1 ? "message is" : "messages are"} waiting. ${why}`, client);
  if (!(await isChatEnabled())) {
    await waitingWith("WhatsApp chat is switched off for the studio.");
    return "no-sender";
  }

  const [assigned, removed, sendsAssigned, sendsRemoved] = await Promise.all([
    getTemplate(TEMPLATE_KEYS.SHOOT_CREW_ASSIGNED, client).catch(() => null),
    getTemplate(TEMPLATE_KEYS.SHOOT_CREW_REMOVED, client).catch(() => null),
    // The switch beside each wording on Settings → Templates: the studio may want the one that says
    // "you are on this shoot" and not the one that says "you are off it".
    isMessageEnabled(TEMPLATE_KEYS.SHOOT_CREW_ASSIGNED, client),
    isMessageEnabled(TEMPLATE_KEYS.SHOOT_CREW_REMOVED, client),
  ]);
  const templates = { assigned, removed };
  const sending = { ASSIGNED: sendsAssigned, REMOVED: sendsRemoved };

  const trouble = [];
  // One answer per project, not per message: a project with four people waiting asks once and reads
  // the same reason four times.
  const senders = new Map();
  const senderFor = async (project) => {
    const key = project?.id || "none";
    if (!senders.has(key)) senders.set(key, await projectSender.resolve(project, projectSender.ROLES.PRE_PRODUCTION_COORDINATOR, { client, isChatEnabledForUser }));
    return senders.get(key);
  };
  const hours = new Map();
  let tried = 0;
  let sent = 0;
  for (const item of due) {
    const label = `${item.employee?.employeeName || "Somebody"} on ${item.shoot?.shootId || item.shoot?.shoot || "a shoot"}`;
    if (!item.employee?.id) continue;
    // Switched off: skipped with the row untouched, so switching it back on still owes this person
    // their message rather than having quietly spent it.
    if (!sending[item.kind]) continue;
    if (!isValidPhoneNumber(item.phone)) {
      trouble.push(`${label}: no WhatsApp number on their record`);
      // Nobody to tell they are off the shoot: the row would otherwise be listed again every minute
      // for the rest of the two days. Dropped, and the trouble line says why once.
      if (item.kind === "REMOVED") await dropNotice(item, { client });
      continue;
    }
    // Every attempt counts, not only the ones that go: a run of refusals is a burst from one number
    // just as much as a run of sends, and this number is bannable.
    if (tried >= MAX_PER_TRY) { trouble.push(`${due.length - due.indexOf(item)} more wait for the next minute`); break; }

    /*
     * Who it comes from, before the wording is built: a project whose coordinator cannot send has
     * nothing to send **with**, and asking costs a read rather than a message. The row is left
     * untouched, so the next sweep owes it again and it goes the moment they connect.
     */
    const sender = await senderFor(item.project);
    if (!sender.ok) { trouble.push(`${label}: ${sender.reason}`); continue; }
    /*
     * And what that one number has already sent this hour, counting the vendor arm's messages too
     * (`senderRate.js`): the same person is often both roles on different projects, and the two
     * sweeps are separate timers that would otherwise each stay within a cap the number does not.
     */
    const hour = hours.get(sender.userId) || await senderRate.mayStillSend(sender.userId, { client, now });
    hours.set(sender.userId, hour);
    if (!hour.ok) { trouble.push(`${label}: ${sender.name || "This sender"} ${hour.reason}`); continue; }

    const body = noticeText(item, templates);
    const template = item.kind === "ASSIGNED" ? assigned : removed;
    if (tried) await pause();
    tried += 1;
    /*
     * Claimed immediately before the send, so the window in which a restart could leave somebody
     * recorded as told but never messaged is as narrow as it can be - the wording and the pause are
     * both already done. Not ours to send means another sweep has it.
     */
    const before = item.notice;
    if (!(await remember(item, before, { client }))) continue;
    const delivery = await projectSender.sendFrom(sender, ({ id: senderId }) => whatsappActivity().track({
        client,
        mode: "AUTOMATIC",
        provider: "baileys",
        trigger: item.kind === "ASSIGNED" ? "SHOOT_CREW_ASSIGNED" : "SHOOT_CREW_REMOVED",
        /*
         * The **move** rather than the destination: told A, then B, then A again is a third message,
         * and a key naming only A would be read as one already sent and quietly skipped - leaving
         * somebody believing B. `sentAt` does the same for a person removed, re-added and removed.
         */
        logicalKey: `shoot-crew:${item.production.id}:${item.employee.id}:${item.kind}:${before?.digest || "new"}>${item.kind === "REMOVED" ? (before?.sentAt?.toISOString?.() || "gone") : item.digest}`,
        eventRef: `shoot-crew:${item.production.id}:${item.employee.id}`,
        senderUserId: senderId,
        recipient: { kind: "PERSON", address: item.phone, name: item.employee.employeeName || null },
        templateKey: template?.key || null,
        body,
        resendable: false,
        links: { salesProjectId: item.project?.id || null, employeeId: item.employee.id },
      }, () => sessions().sendMessageToPerson({ userId: senderId, phone: item.phone, body })));
    if (delivery.outcome === "maybe-sent") {
      // It may have gone out: kept as told, and the sweep stops rather than risk telling them twice.
      await settings.keepError([...trouble, `${label} may not have gone, and is not tried again so as not to send it twice: ${delivery.reasons.join(" · ")}`].join(" · "), client);
      return "failed";
    }
    if (delivery.outcome !== "sent") {
      // It certainly did not go: the next sweep has it again. There is no second sender to try, so
      // this is this project's trouble line and not the sweep's - another project may still send.
      await forget(item, before, { client });
      trouble.push(`${label}: ${delivery.reasons.join(" · ")}`);
      continue;
    }
    // Its row is what makes a removal owed, so it goes only once the message has.
    if (item.kind === "REMOVED") await dropNotice(item, { client });
    if (!delivery.result?.duplicate) sent += 1;
    console.log(`[shoot-crew-notice] ${item.kind} for employee ${item.employee.id} on shoot ${item.shoot?.id} ${delivery.result?.duplicate ? "already sent" : `sent by user ${delivery.userId}`}`);
  }

  await settings.keepError(trouble.join(" · "), client);
  return sent ? "sent" : trouble.length ? "failed" : "nothing-due";
}

let timer = null;
let running = false;

/** Every minute, in the API process - the only one holding WhatsApp sockets. Off with SHOOT_CREW_NOTICE_AUTOSEND=false. */
function startShootCrewNoticeSender() {
  if (timer || process.env.SHOOT_CREW_NOTICE_AUTOSEND === "false") return;
  timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await runOnce();
    } catch (error) {
      console.error("[shoot-crew-notice] sweep failed:", error.message);
    } finally {
      running = false;
    }
  }, TICK_MS);
  if (typeof timer.unref === "function") timer.unref();
}

function stopShootCrewNoticeSender() {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}

function setSessionsForTest(stub) { sessionsOverride = stub; }

module.exports = {
  runOnce, noticeText, valuesFor, timeWords, dayWords, remember, forget, dropNotice,
  DEFAULT_ASSIGNED, DEFAULT_REMOVED, MAX_PER_TRY,
  startShootCrewNoticeSender, stopShootCrewNoticeSender, setSessionsForTest,
};
