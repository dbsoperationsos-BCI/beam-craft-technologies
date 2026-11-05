const crypto = require("node:crypto");
const prisma = require("../../../config/db");
const { STUDIO_TIME_ZONE, studioDateKey, studioParts } = require("../../../services/studioTime");
const { renderTemplate, placeholdersIn } = require("../../../services/messageTemplate");
const reportGroup = require("../../hrm/attendance/reportGroup");
const { KINDS, WISH_KEY } = require("./controller");
const scheduler = require("./scheduler");
const senderPolicy = require("../automatic-whatsapp/senderPolicy");
const messageSwitches = () => require("../../../services/messageTemplateSwitches");

/**
 * Settings → Wishes, sent: on each employee's birthday, wedding anniversary and work anniversary (each
 * year since their Date Of Joining, the 1st onwards), one of the ten wishes of that kind - picked at
 * random - is filled in with their name (and years) and sent into the WhatsApp group
 * named in Settings → Wishes → Wishes Scheduler (`scheduler.js`).
 *
 * It goes the way the daily report goes, with the scheduler's own group, time (10:00 am unless set)
 * and Priority 1, the other Allow-WhatsApp employees tried after (`reportGroup.deliverToGroup`), in
 * the same 135-minute window, retried every five
 * minutes while nobody can send. Whose day it is comes from the register's own celebrations
 * (`celebrationsOn`): active, unarchived employees, matched on the month and day, 29 February marked
 * on the 28th in a year without one.
 *
 * One message a person. Each one sent is written to `EmployeeWish` straight away - with the wish
 * picked - so a run that stops halfway through picks up where it left off, and nobody is wished twice.
 * At most five a try, a few seconds apart, so a day with many birthdays does not post a burst from the
 * studio's number - the rest go at the next try, five minutes on.
 */

const KIND_DETAILS = {
  birthday: { kind: "BIRTHDAY", prefix: KINDS.birthday, list: "birthdays", label: "Birthday", trigger: "WISH_BIRTHDAY" },
  weddingAnniversary: { kind: "WEDDING_ANNIVERSARY", prefix: KINDS.weddingAnniversary, list: "anniversaries", label: "Anniversary", trigger: "WISH_WEDDING_ANNIVERSARY" },
  workAnniversary: { kind: "WORK_ANNIVERSARY", prefix: KINDS.workAnniversary, list: "workAnniversaries", label: "Work anniversary", trigger: "WISH_WORK_ANNIVERSARY" },
};
const DETAILS_OF = Object.fromEntries(Object.values(KIND_DETAILS).map((details) => [details.kind, details]));
const YEARS = "years";
// "1 year", "3 years" - what `{years}` reads in a work anniversary wish.
const yearsLabel = (years) => (years ? `${years} ${years === 1 ? "year" : "years"}` : "");
const SPOUSE = "spouse name";
// Only where every anniversary wish has been reworded to need a spouse's name and the record has none.
const NO_SPOUSE_NAME = "your spouse";
const TICK_MS = 60 * 1000;
const MAX_PER_TRY = 5;
const GAP_MS = 3000;
const JITTER_MS = 2000;
const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
const MAX_ERROR_CHARS = 4000;

const minutesOf = ({ hour, minute }) => hour * 60 + minute;
const dayOf = (iso) => new Date(`${iso}T00:00:00.000Z`);
const randomPick = (list) => list[crypto.randomInt(list.length)];

/**
 * Today's birthdays, wedding anniversaries and work anniversaries not yet wished: `[{ employeeId,
 * employeeName, spouseName, years, kind }]`, birthdays first.
 */
async function wishesDue(today, { client = prisma } = {}) {
  const employees = await client.employee.findMany({
    where: { archivedAt: null, employmentStatus: "Active", OR: [{ dateOfBirth: { not: null } }, { weddingAnniversary: { not: null } }, { dateOfJoining: { not: null } }] },
    select: { id: true, employeeName: true, spouseName: true, employmentStatus: true, archivedAt: true, dateOfBirth: true, weddingAnniversary: true, dateOfJoining: true, branchId: true },
  });
  // Required here: the attendance service is large, and tests of this file need none of the rest of it.
  const celebrations = require("../../hrm/attendance/service").celebrationsOn(today, employees, new Map());
  const spouseOf = new Map(employees.map((employee) => [employee.id, employee.spouseName]));
  const due = Object.values(KIND_DETAILS).flatMap(({ kind, list }) => (celebrations[list] || []).map((person) => ({
    employeeId: person.employeeId,
    employeeName: person.employeeName,
    spouseName: String(spouseOf.get(person.employeeId) || "").trim() || null,
    years: person.years ?? null,
    kind,
  })));
  if (!due.length) return [];
  const sent = await client.employeeWish.findMany({
    where: { wishedOn: dayOf(today), employeeId: { in: [...new Set(due.map((wish) => wish.employeeId))] } },
    select: { employeeId: true, kind: true },
  });
  const done = new Set(sent.map((wish) => `${wish.employeeId}|${wish.kind}`));
  return due.filter((wish) => !done.has(`${wish.employeeId}|${wish.kind}`));
}

/**
 * One of the kind's wishes, at random, filled in for this person. An anniversary wish naming the
 * spouse is only picked when the record has the spouse's name - otherwise one that does not.
 */
function wishFor(person, templates, pick = randomPick) {
  const usable = templates.filter((template) => template.body.trim());
  if (!usable.length) return null;
  const withoutSpouse = usable.filter((template) => !placeholdersIn(template.body).includes(SPOUSE));
  const choices = person.spouseName || !withoutSpouse.length ? usable : withoutSpouse;
  const template = pick(choices);
  return {
    templateKey: template.key,
    body: renderTemplate(template.body, { "employee name": person.employeeName, [SPOUSE]: person.spouseName || NO_SPOUSE_NAME, [YEARS]: yearsLabel(person.years) }),
  };
}

/** Every kind's wishes, as Settings → Wishes holds them: `{ BIRTHDAY: [...], WEDDING_ANNIVERSARY: [...], WORK_ANNIVERSARY: [...] }`. */
async function wishTemplates(client = prisma) {
  const rows = await client.messageTemplate.findMany({
    where: { OR: Object.values(KIND_DETAILS).map(({ prefix }) => ({ key: { startsWith: `${prefix}_` } })) },
    select: { key: true, body: true },
    orderBy: { key: "asc" },
  });
  const wishes = rows.filter((row) => WISH_KEY.test(row.key));
  return Object.fromEntries(Object.values(KIND_DETAILS).map(({ kind, prefix }) => [kind, wishes.filter((row) => row.key.startsWith(`${prefix}_`))]));
}

/**
 * One look at the clock: sends today's wishes if they are due and not all sent. Answers what it did -
 * `"sent"`, `"failed"`, or why it did nothing - for the logs and the tests.
 *
 * Claimed first, the way the report is, so two processes cannot both send. A wish nobody could send
 * stops the run there; it and the rest wait for the next try five minutes on, and the reason is kept
 * for Settings → Wishes to show. A wish that may have gone (`"maybe-sent"`) stops the run too, but is
 * logged as sent - without a sender - since trying it again could put it in the group twice.
 */
async function runWishesOnce({ now = new Date(), client = prisma, switches = null, mayStillSend, pick = randomPick, isMessageOn = (key) => messageSwitches().isEnabled(key), pause = () => wait(GAP_MS + crypto.randomInt(JITTER_MS)) } = {}) {
  const settings = await client.hrmSettings.findUnique({ where: { id: reportGroup.SETTINGS_ID }, select: { wishesSendAt: true, wishesGroupName: true } });
  if (!settings?.wishesGroupName) return "no-group";
  const clockNow = minutesOf(studioParts(now));
  const due = minutesOf(scheduler.wishesSendAt(settings));
  if (clockNow < due) return "not-yet";
  if (clockNow >= due + reportGroup.SEND_WINDOW_MINUTES) return "too-late";
  const today = studioDateKey(now);

  // A kind switched off under Settings → Templates → Wishes Scheduler is not sent: today's wishes of
  // that kind are left out, as if nobody had one.
  const { WISH_SWITCH_OF } = messageSwitches();
  const kindsOff = new Set();
  for (const [kind, key] of Object.entries(WISH_SWITCH_OF)) if (!(await isMessageOn(key))) kindsOff.add(kind);
  const waiting = (await wishesDue(today, { client })).filter((person) => !kindsOff.has(person.kind));
  if (!waiting.length) return "nothing-due";
  // No sender chosen: the wishes are not set up, so nothing is tried and no claim is taken.
  if (!senderPolicy.hasSender(await senderPolicy.readPolicy(senderPolicy.MESSAGE_KEYS.WISHES, { client }))) return "nothing-to-do";

  const { count } = await client.hrmSettings.updateMany({
    where: {
      id: reportGroup.SETTINGS_ID,
      wishesGroupName: { not: null },
      OR: [{ wishesLastAttemptAt: null }, { wishesLastAttemptAt: { lt: new Date(now.getTime() - reportGroup.RETRY_GAP_MS) } }],
    },
    data: { wishesLastAttemptAt: now },
  });
  if (!count) return "nothing-to-do";

  const reasons = [];
  const keepError = async (message) => {
    await client.hrmSettings.update({ where: { id: reportGroup.SETTINGS_ID }, data: { wishesLastError: message ? message.slice(0, MAX_ERROR_CHARS) : null } }).catch(() => {});
    // The names stay on the settings row for Settings → Wishes; the log only says to look there.
    if (message) console.warn(`[wishes] ${today}: not every wish went cleanly - see Settings → Wishes`);
  };
  try {
    const { isChatEnabled, isChatEnabledForUser } = switches || require("../../sales/whatsapp-chat/repository");
    if (!(await isChatEnabled())) throw new Error("WhatsApp chat is switched off for the studio.");
    const row = await scheduler.settingsRow(client);
    const templates = await wishTemplates(client);

    const logSent = (person, templateKey, sentByUserId) => client.employeeWish.create({
      data: { employeeId: person.employeeId, kind: person.kind, wishedOn: dayOf(today), templateKey, sentByUserId },
    }).catch((error) => {
      // Another process wrote it first - the claim should stop that, but the row is the guard.
      if (error?.code !== "P2002") throw error;
    });

    let sentThisTry = 0;
    for (const person of waiting.slice(0, MAX_PER_TRY)) {
      const label = `${DETAILS_OF[person.kind]?.label || "A"} wish for ${person.employeeName}`;
      const wish = wishFor(person, templates[person.kind] || [], pick);
      if (!wish) { reasons.push(`${label}: no wish of that kind is written in Settings → Wishes`); continue; }
      if (sentThisTry) await pause();
      const delivery = await reportGroup.deliverToGroup(scheduler.wishesTarget(row), wish.body, {
        client, isChatEnabledForUser, ...(mayStillSend ? { mayStillSend } : {}),
        // Settings → WhatsApp Activity Log: one row a person, a kind and a day - the same key `EmployeeWish` is unique on.
        activity: { trigger: DETAILS_OF[person.kind]?.trigger, logicalKey: `wish:${person.employeeId}:${person.kind}:${today}`, eventRef: `wish:${person.employeeId}:${person.kind}:${today}`, templateKey: wish.templateKey, links: { employeeId: person.employeeId } },
      });
      if (delivery.outcome === "maybe-sent") {
        await logSent(person, wish.templateKey, null);
        await keepError([...reasons, `${label} may not have gone, and is not tried again so as not to send it twice: ${delivery.reasons.join(" · ")}`].join(" · "));
        return "failed";
      }
      if (delivery.outcome !== "sent") {
        await keepError([...reasons, `${label} could not be sent: ${delivery.reasons.join(" · ") || "nobody could send it."}`].join(" · "));
        return "failed";
      }
      sentThisTry += 1;
      if (delivery.reasons.length) reasons.push(`${label}: sent, but only after ${delivery.reasons.join(" · ")}`);
      await logSent(person, wish.templateKey, delivery.userId);
      console.log(`[wishes] ${person.kind} wish for employee ${person.employeeId} sent by user ${delivery.userId}`);
    }
    await keepError(reasons.join(" · "));
    return "sent";
  } catch (error) {
    await keepError(String(error?.message || "The wishes could not be sent."));
    return "failed";
  }
}

/** Where the wishes go and how the last try went, for Settings → Wishes. */
async function wishDeliveryStatus({ client = prisma } = {}) {
  const row = await client.hrmSettings.findUnique({
    where: { id: reportGroup.SETTINGS_ID },
    select: { wishesGroupName: true, wishesSendAt: true, wishesLastAttemptAt: true, wishesLastError: true },
  });
  return {
    groupName: row?.wishesGroupName || null,
    sendAt: scheduler.timeLabel(scheduler.wishesSendAt(row)),
    lastAttemptAt: row?.wishesLastAttemptAt || null,
    lastError: row?.wishesLastError || null,
  };
}

let timer = null;
let running = false;

/** Every minute, in the API process - the only one holding WhatsApp sockets. Off with WISHES_AUTOSEND=false. */
function startWishesSender() {
  if (timer) return timer;
  if (String(process.env.WISHES_AUTOSEND ?? "true").toLowerCase() === "false") {
    console.log("[wishes] automatic send disabled via WISHES_AUTOSEND=false");
    return null;
  }
  timer = setInterval(async () => {
    if (running) return;
    running = true;
    try { await runWishesOnce(); } catch (error) { console.warn(`[wishes] ${error.message}`); } finally { running = false; }
  }, TICK_MS);
  if (typeof timer.unref === "function") timer.unref();
  console.log(`[wishes] birthday and anniversary wishes go to the Wishes Scheduler's group at its send time (${STUDIO_TIME_ZONE})`);
  return timer;
}

function stopWishesSender() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { runWishesOnce, startWishesSender, stopWishesSender, wishDeliveryStatus, wishFor, wishesDue };
