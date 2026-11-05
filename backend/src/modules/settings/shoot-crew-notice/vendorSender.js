const crypto = require("node:crypto");
const prisma = require("../../../config/db");
const { isValidPhoneNumber } = require("../../../services/phoneNumber");
const { getTemplate, isMessageEnabled, renderTemplate, TEMPLATE_KEYS } = require("../../../services/messageTemplate");
const settings = require("./service");
const shared = require("./shared");
const projectSender = require("./projectSender");
const senderRate = require("./senderRate");
const { vendorNoticesDue, dropPastNotices } = require("./vendorDue");

/*
 * Settings → Project Management → Shoot crew notice, **vendor arm**, sent.
 *
 * What is owed is `vendorDue.js`; this takes that list and sends it, one vendor at a time, from **the
 * project's own Production Manager** (`projectSender.js`). Where that manager cannot send, this
 * project's messages wait and are tried again next sweep - they never go from another number, which is
 * the whole point of the manager sending them.
 *
 * Paced as the crew arm is, and for the same reason: these are personal numbers on real WhatsApp
 * accounts, and a burst from one number is what gets it banned. At most `MAX_PER_TRY` a sweep, a few
 * seconds apart, and - unlike the crew arm, where everybody shares one studio sender - no more than
 * `MAX_PER_SENDER_TRY` from any one manager's phone in a sweep, so a manager with twenty vendors
 * waiting does not send twenty in a minute. The rest wait for the next minute. A sweep bounds a
 * minute and not a rate, so one number's hour is bounded as well, across both arms, by
 * `senderRate.js`.
 *
 * A vendor's row is written **before** the send, so two processes cannot both tell them, and put back
 * only where the message certainly did not go.
 */

const TICK_MS = 60 * 1000;
const MAX_PER_TRY = 5;
const MAX_PER_SENDER_TRY = 3;
const CLAIM_MS = 50 * 1000;
/** A number WhatsApp has no account for is nowhere to send, not a send to try again next minute. */
const NO_WHATSAPP = new Set(["NOT_ON_WHATSAPP", "INVALID_RECIPIENT"]);
const GAP_MS = 3000;
const JITTER_MS = 2000;

/* The studio's own wording replaces these in Settings → Templates; these are what it says until then. */
const DEFAULTS = {
  CONFIRMED: "Hi {vendor name}, you are confirmed for {shoot} ({project}) on {date} ({day}) at {time}, {place}. Your service: {service}. - {manager name}",
  REMINDER: "Hi {vendor name}, a reminder: {shoot} for {project} is on {date} ({day}) at {time}, {place}. Your service: {service}. - {manager name}",
  DATE_CHANGED: "Hi {vendor name}, the date for {shoot} ({project}) has changed. It is now {date} ({day}) at {time}, {place}. Your service: {service}. - {manager name}",
  PLACE_CHANGED: "Hi {vendor name}, the place for {shoot} ({project}) on {date} ({day}) has changed. It is now {place}, {district}. - {manager name}",
  SERVICE_CHANGED: "Hi {vendor name}, your service on {shoot} ({project}) on {date} ({day}) has changed. You are now on {service}. - {manager name}",
  REMOVED: "Hi {vendor name}, you are no longer on {shoot} for {project} on {date} ({day}). Please do not travel for it. - {manager name}",
};

/** The template each kind is sent with, and the trigger the Activity Log records it under. */
const KINDS = Object.freeze({
  CONFIRMED: TEMPLATE_KEYS.VENDOR_SHOOT_CONFIRMED,
  REMINDER: TEMPLATE_KEYS.VENDOR_SHOOT_REMINDER,
  DATE_CHANGED: TEMPLATE_KEYS.VENDOR_SHOOT_DATE_CHANGED,
  PLACE_CHANGED: TEMPLATE_KEYS.VENDOR_SHOOT_PLACE_CHANGED,
  SERVICE_CHANGED: TEMPLATE_KEYS.VENDOR_SHOOT_SERVICE_CHANGED,
  REMOVED: TEMPLATE_KEYS.VENDOR_SHOOT_REMOVED,
});

const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
let sessionsOverride = null;
const sessions = () => sessionsOverride || require("../../sales/whatsapp-chat/sessionManager");
const whatsappActivity = () => require("../../../services/whatsappActivity");

/**
 * What the wording's placeholders are filled with.
 *
 * A removal reads its facts from the **snapshot on the row** - what this vendor was actually told -
 * because the plan that would have answered them may be withdrawn, the shoot deleted or the seat gone.
 * Every other kind reads the shoot as it now stands, which is the news.
 */
function valuesFor(item) {
  const gone = item.kind === "REMOVED";
  const notice = item.notice || {};
  const { date, day } = shared.dayWords(gone ? notice.lastDate : item.shoot?.dateCreated);
  return {
    "vendor name": item.vendor?.vendorName || "there",
    shoot: (gone ? notice.lastShoot : item.shoot?.shoot) || "the shoot",
    "shoot id": (gone ? notice.lastShootCode : item.shoot?.shootId) || "",
    project: (gone ? notice.lastProject : (item.project?.whatsappGroupName || item.project?.eventId)) || "",
    "event id": item.project?.eventId || "",
    date,
    day,
    time: (gone ? notice.lastTime : shared.timeWords(item.shoot)) || "",
    place: (gone ? notice.lastPlace : item.shoot?.shootPlace) || "",
    district: (gone ? notice.lastDistrict : item.shoot?.district) || "",
    service: item.services || "",
    "manager name": item.manager || "the production manager",
  };
}

/** The message for one notice, in the studio's own wording where it has one. */
function noticeText(item, templates) {
  const template = templates[item.kind];
  const body = template?.body?.trim() ? template.body : DEFAULTS[item.kind];
  return renderTemplate(body, valuesFor(item));
}

/** What is written on the row once a message of this kind has gone. */
function writtenFor(item, now) {
  const data = { ...(item.snapshot || {}), ...item.digests, serviceDefinitionId: item.serviceDefinitionId, needsNumber: false, sentAt: now };
  /*
   * Any message at all means this vendor now knows about this shoot, so the row says so - a change
   * sent on a row whose confirm never went (held for want of a number) would otherwise leave
   * `confirmedSentAt` null, and a later removal would be dropped as "never told" while the vendor sat
   * waiting for a shoot that is off.
   */
  if (!item.notice?.confirmedSentAt) data.confirmedSentAt = now;
  if (item.kind === "CONFIRMED") data.confirmedSentAt = now;
  if (item.kind === "REMINDER") data.reminderSentAt = now;
  // A change inside the two days answers for the reminder too, rather than being followed by one
  // saying the same day over again.
  if (item.coversReminder && item.kind !== "CONFIRMED") data.reminderSentAt = now;
  return data;
}

/**
 * Takes this vendor's notice for this sweep, and answers whether it was ours to take.
 *
 * A **claim**, not a plain write: the row is changed only while it still holds the digests the sweep
 * read, so of two sweeps running at once the second finds nothing to change and sends nothing.
 */
async function remember(item, before, now = new Date(), { client = prisma } = {}) {
  /*
   * Off the shoot: the row is what makes the message owed, so it is dropped only **after** the send
   * rather than written before it. It is still claimed, on the one field a removal moves - `sentAt` -
   * so two sweeps overlapping by more than `CLAIM_MS` cannot both tell the same vendor not to travel.
   */
  if (item.kind === "REMOVED") {
    if (!before) return false;
    const { count } = await client.projectShootVendorNotice.updateMany({ where: { id: before.id, sentAt: before.sentAt }, data: { sentAt: now } });
    return count > 0;
  }
  const data = writtenFor(item, now);
  if (!before) {
    try {
      await client.projectShootVendorNotice.create({ data: { productionId: item.production.id, vendorId: item.vendor.id, ...data } });
      return true;
    } catch (error) {
      // Another sweep created it between the read and here.
      if (error?.code === "P2002") return false;
      throw error;
    }
  }
  const { count } = await client.projectShootVendorNotice.updateMany({
    where: { id: before.id, shootDigest: before.shootDigest, placeDigest: before.placeDigest, serviceDigest: before.serviceDigest, reminderSentAt: before.reminderSentAt },
    data,
  });
  return count > 0;
}

/** The row a "do not travel" message was owed by, dropped now that it has gone. */
const dropNotice = (notice, { client = prisma } = {}) => (notice
  ? client.projectShootVendorNotice.delete({ where: { id: notice.id } }).catch((error) => console.error(`[vendor-shoot-notice] could not drop notice ${notice.id}:`, error.message))
  : Promise.resolve());

/**
 * Puts the row back exactly as it was, for a message that certainly did not go - every field
 * `remember` wrote, or the next sweep would send a message built from one plan and a row remembering
 * another.
 */
async function forget(item, before, { client = prisma } = {}) {
  if (item.kind === "REMOVED") return;
  try {
    if (before) {
      await client.projectShootVendorNotice.update({
        where: { id: before.id },
        data: {
          shootDigest: before.shootDigest, placeDigest: before.placeDigest, serviceDigest: before.serviceDigest,
          confirmedSentAt: before.confirmedSentAt ?? null, reminderSentAt: before.reminderSentAt ?? null,
          needsNumber: before.needsNumber, serviceDefinitionId: before.serviceDefinitionId ?? null,
          lastShoot: before.lastShoot ?? null, lastShootCode: before.lastShootCode ?? null, lastProject: before.lastProject ?? null,
          lastDate: before.lastDate ?? null, lastTime: before.lastTime ?? null, lastPlace: before.lastPlace ?? null,
          lastDistrict: before.lastDistrict ?? null, lastService: before.lastService ?? null,
          sentAt: before.sentAt ?? new Date(),
        },
      });
    } else {
      await client.projectShootVendorNotice.deleteMany({ where: { productionId: item.production.id, vendorId: item.vendor.id } });
    }
  } catch (error) {
    // Left as told rather than lost silently: the log is where this is noticed.
    console.error(`[vendor-shoot-notice] could not put back vendor ${item.vendor?.id}'s notice on shoot ${item.shoot?.id}:`, error.message);
  }
}

/**
 * Marks a vendor nobody can message, once. Not "told" - so the moment somebody saves a number on the
 * vendor the mark is cleared and the message goes, instead of being suppressed for ever.
 */
async function markNeedsNumber(item, { client = prisma } = {}) {
  const data = { ...(item.snapshot || {}), ...item.digests, serviceDefinitionId: item.serviceDefinitionId, needsNumber: true };
  try {
    if (item.notice) await client.projectShootVendorNotice.update({ where: { id: item.notice.id }, data: { needsNumber: true } });
    else await client.projectShootVendorNotice.create({ data: { productionId: item.production.id, vendorId: item.vendor.id, ...data } });
  } catch (error) {
    if (error?.code !== "P2002") console.error(`[vendor-shoot-notice] could not mark vendor ${item.vendor?.id} as having no number:`, error.message);
  }
}

/**
 * One sweep. Answers what it did - `"sent"`, `"failed"`, or why it did nothing - for the logs and the
 * tests.
 */
async function runOnce({ now = new Date(), client = prisma, switches = null, pause = () => wait(GAP_MS + crypto.randomInt(JITTER_MS)) } = {}) {
  const row = await settings.settingsRow(client);
  if (!row?.vendorEnabled) return "off";

  // Rows the owed-list can no longer reach, so nothing else would ever drop them.
  await dropPastNotices(now, { client }).catch((error) => console.error("[vendor-shoot-notice] could not drop past notices:", error.message));

  const due = await vendorNoticesDue(now, { client });
  if (!due.length) return "nothing-due";

  // One sweep at a time across processes, on the vendor arm's own claim so it never contends with the
  // crew arm's.
  const { count: mine } = await client.shootCrewNoticeSettings.updateMany({
    where: { id: settings.SETTINGS_ID, OR: [{ vendorLastAttemptAt: null }, { vendorLastAttemptAt: { lt: new Date(now.getTime() - CLAIM_MS) } }] },
    data: { vendorLastAttemptAt: now },
  });
  if (!mine) return "nothing-to-do";

  const { isChatEnabled, isChatEnabledForUser } = switches || require("../../sales/whatsapp-chat/repository");
  if (!(await isChatEnabled())) {
    await settings.keepVendorError(`${due.length} vendor ${due.length === 1 ? "message is" : "messages are"} waiting. WhatsApp chat is switched off for the studio.`, client);
    return "no-sender";
  }

  const templates = Object.fromEntries(await Promise.all(Object.entries(KINDS)
    .map(async ([kind, key]) => [kind, await getTemplate(key, client).catch(() => null)])));
  /*
   * Which of the six the studio still wants sent (Settings → Templates). Asked once a sweep rather
   * than per vendor, and asked of the **switch** rather than of the wording: a kind nobody has
   * written is still sent, from the built-in wording, so only an explicit Off stops it.
   */
  const sending = Object.fromEntries(await Promise.all(Object.entries(KINDS)
    .map(async ([kind, key]) => [kind, await isMessageEnabled(key, client)])));

  const senders = new Map();
  const senderFor = async (project) => {
    const key = project?.id || "none";
    if (!senders.has(key)) senders.set(key, await projectSender.resolve(project, projectSender.ROLES.PRODUCTION_MANAGER, { client, isChatEnabledForUser }));
    return senders.get(key);
  };
  const perSender = new Map();
  const hours = new Map();

  const trouble = [];
  let tried = 0;
  let sent = 0;
  for (const item of due) {
    // A row for a shoot nobody was ever told about, now off the plan: nothing to take back.
    if (item.kind === "STALE") { await dropNotice(item.notice, { client }); continue; }
    /*
     * Switched off: skipped, and the row is left exactly as it is. Not marked as sent - switching the
     * wording back on should send what was owed while it was off, not swallow it - and not reported
     * as trouble either, since nothing is wrong.
     */
    if (!sending[item.kind]) continue;
    if (!item.vendor?.id) continue;
    const label = `${item.vendor.vendorName || "A vendor"} on ${item.shoot?.shootId || item.shoot?.shoot || "a shoot"}`;

    if (!isValidPhoneNumber(item.phone)) {
      trouble.push(`${label}: no WhatsApp or mobile number on the vendor`);
      if (item.kind === "REMOVED") await dropNotice(item.notice, { client });
      else await markNeedsNumber(item, { client });
      continue;
    }
    // Every attempt counts, not only the ones that go: a run of refusals is a burst from one number
    // just as much as a run of sends.
    if (tried >= MAX_PER_TRY) { trouble.push(`${due.length - due.indexOf(item)} more wait for the next minute`); break; }

    const sender = await senderFor(item.project);
    if (!sender.ok) { trouble.push(`${label}: ${sender.reason}`); continue; }
    // One manager's phone, not the studio's: their own share of the sweep.
    const already = perSender.get(sender.userId) || 0;
    if (already >= MAX_PER_SENDER_TRY) { trouble.push(`${label}: waiting so as not to send more than ${MAX_PER_SENDER_TRY} from ${sender.name || "one number"} at once`); continue; }
    // And of their hour, across both arms: a sweep bounds a minute, not a rate.
    const hour = hours.get(sender.userId) || await senderRate.mayStillSend(sender.userId, { client, now });
    hours.set(sender.userId, hour);
    if (!hour.ok) { trouble.push(`${label}: ${sender.name || "This sender"} ${hour.reason}`); continue; }

    const body = noticeText(item, templates);
    const template = templates[item.kind];
    if (tried) await pause();
    tried += 1;
    perSender.set(sender.userId, already + 1);

    /*
     * Claimed immediately before the send, so the window in which a restart could leave a vendor
     * recorded as told but never messaged is as narrow as it can be. Not ours to send means another
     * sweep has it.
     */
    const before = item.notice;
    if (!(await remember(item, before, now, { client }))) continue;
    const delivery = await projectSender.sendFrom(sender, ({ id: senderId }) => whatsappActivity().track({
        client,
        mode: "AUTOMATIC",
        provider: "baileys",
        trigger: `VENDOR_SHOOT_${item.kind}`,
        /*
         * The **move** rather than the destination: told one day, then another, then the first again
         * is a third message, and a key naming only the day would be read as one already sent and
         * quietly skipped - leaving the vendor believing the second. The row's own `sentAt` is in the
         * key for the same reason, since a shoot moved A → B → A → B repeats every digest it has.
         */
        logicalKey: `vendor-shoot:${item.production.id}:${item.vendor.id}:${item.kind}:${before?.sentAt?.toISOString?.() || "new"}>${item.digests.shootDigest.slice(0, 12)}:${item.digests.placeDigest.slice(0, 8)}:${item.digests.serviceDigest.slice(0, 8)}`,
        eventRef: `vendor-shoot:${item.production.id}:${item.vendor.id}`,
        senderUserId: senderId,
        recipient: { kind: "VENDOR", address: item.phone, name: item.vendor.vendorName || null },
        templateKey: template?.key || null,
        body,
        resendable: false,
        links: { salesProjectId: item.project?.id || null, vendorId: item.vendor.id, productionId: item.production.id },
      }, () => sessions().sendMessageToPerson({ userId: senderId, phone: item.phone, body })));

    if (delivery.outcome === "maybe-sent") {
      // It may have gone out: kept as told, and the sweep stops rather than risk telling them twice.
      await settings.keepVendorError([...trouble, `${label} may not have gone, and is not tried again so as not to send it twice: ${delivery.reasons.join(" · ")}`].join(" · "), client);
      return "failed";
    }
    if (delivery.outcome !== "sent") {
      // It certainly did not go: the next sweep has it again.
      await forget(item, before, { client });
      /*
       * Unless the number itself is the problem. A number nobody holds a WhatsApp account on fails
       * the same way every minute, from the manager's own phone, for the rest of the month - and a
       * handful of them use the whole sweep, starving every vendor behind them. A number WhatsApp
       * does not know is the same situation as no number at all, so it is marked as one.
       */
      if (NO_WHATSAPP.has(delivery.code) && item.kind !== "REMOVED") {
        await markNeedsNumber(item, { client });
        trouble.push(`${label}: ${item.phone} is not on WhatsApp. Check the number on the vendor.`);
        continue;
      }
      trouble.push(`${label}: ${delivery.reasons.join(" · ")}`);
      continue;
    }
    // Its row is what makes a removal owed, so it goes only once the message has.
    if (item.kind === "REMOVED") await dropNotice(item.notice, { client });
    if (!delivery.result?.duplicate) sent += 1;
    console.log(`[vendor-shoot-notice] ${item.kind} for vendor ${item.vendor.id} on shoot ${item.shoot?.id} ${delivery.result?.duplicate ? "already sent" : `sent by user ${delivery.userId}`}`);
  }

  await settings.keepVendorError(trouble.join(" · "), client);
  return sent ? "sent" : trouble.length ? "failed" : "nothing-due";
}

let timer = null;
let running = false;

/** Every minute, in the API process - the only one holding WhatsApp sockets. Off with VENDOR_SHOOT_NOTICE_AUTOSEND=false. */
function startVendorShootNoticeSender() {
  if (timer || process.env.VENDOR_SHOOT_NOTICE_AUTOSEND === "false") return;
  timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await runOnce();
    } catch (error) {
      console.error("[vendor-shoot-notice] sweep failed:", error.message);
    } finally {
      running = false;
    }
  }, TICK_MS);
  if (typeof timer.unref === "function") timer.unref();
}

function stopVendorShootNoticeSender() {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}

function setSessionsForTest(stub) { sessionsOverride = stub; }

module.exports = {
  runOnce, noticeText, valuesFor, writtenFor, remember, forget, dropNotice, markNeedsNumber,
  DEFAULTS, KINDS, MAX_PER_TRY, MAX_PER_SENDER_TRY,
  startVendorShootNoticeSender, stopVendorShootNoticeSender, setSessionsForTest,
};
