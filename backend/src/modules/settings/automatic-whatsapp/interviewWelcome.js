const prisma = require("../../../config/db");
const { switchOffData } = require("../../../services/notificationSwitches");
const { getTemplate, renderTemplate, TEMPLATE_KEYS } = require("../../../services/messageTemplate");
const whatsappActivity = require("../../../services/whatsappActivity");
const { safeName, isPhoneShaped, shownError, whenValues, officeSlot, SLOTS } = require("./newLeadWelcome");
const senderPolicy = require("./senderPolicy");

/*
 * Settings → Templates → Interview Welcome.
 *
 * When a linked interview Google Sheet brings a new candidate into the Interview register, one
 * WhatsApp message goes to the candidate's number **from the Sender chosen beside the wording, or its
 * Rotation** through the employees with Allow WhatsApp ticked (`senderPolicy.js`). The candidate's
 * reply lands in the WhatsApp of whoever sent it.
 *
 * Only the sheet sync calls this (`interview/sheetSyncService.js`), and only for a candidate it has
 * just created; Add Application, the public form and a CSV import never do. It is New Lead
 * Welcome's machinery (`newLeadWelcome.js`) with a Sender or Rotation in place of each lead's owner:
 *
 *   - the queue is the WhatsApp Activity Log - a QUEUED row per candidate, keyed by the candidate,
 *     so nobody is welcomed twice - worked every minute in the API process;
 *   - a refused try (no sender chosen, nobody linked, chat switched off) is retried on up
 *     to three passes, five minutes apart, within two hours, then left Failed with its reason, where
 *     it can be resent;
 *   - a sync that brings in more than `MAX_PER_SYNC` new candidates welcomes the first ones and logs
 *     the rest as Failed, and each sender sends at most `MAX_PER_SENDER_HOUR` in any hour - past it
 *     the next in the order is asked. These are personal numbers, and a burst of first messages to
 *     strangers is what gets one banned.
 */

const TRIGGER = "INTERVIEW_WELCOME";
const MESSAGE_KEY = senderPolicy.MESSAGE_KEYS.INTERVIEW_WELCOME;
const TEMPLATE_KEY = TEMPLATE_KEYS.INTERVIEW_WELCOME;
/*
 * Two wordings, as New Lead Welcome has: Interview Welcome itself for a candidate arriving in office
 * time - the attendance shift on a working day - and this one for any other time, a weekly off or a
 * holiday included (`newLeadWelcome.officeSlot`). Chosen when the candidate arrives and kept on the
 * queued row, so every try sends the same; an after-hours wording deleted since is sent as Interview
 * Welcome's.
 */
const AFTER_HOURS_KEY = TEMPLATE_KEYS.INTERVIEW_WELCOME_AFTER_HOURS;
const TICK_MS = 60 * 1000;
const MAX_PASSES = 3;
const RETRY_GAP_MS = 5 * 60 * 1000;
const MAX_AGE_MS = 2 * 60 * 60 * 1000;
const MAX_ERROR_CHARS = 4000;
const MAX_PER_SYNC = 20;
const MAX_PER_SENDER_HOUR = 30;
const DEFAULT_BODY = "Hey thanks for your interest on this job, Please fill this questions";
const PLACEHOLDERS = ["candidate name", "sender name", "greeting", "date", "day", "time", "position", "department", "branch", "city", "candidate id"];
const SETTINGS_ID = require("../../hrm/attendance/reportGroup").SETTINGS_ID;

const failure = (status, message, code) => Object.assign(new Error(message), { status, ...(code ? { code } : {}) });
const reportGroup = () => require("../../hrm/attendance/reportGroup");

const settingsRow = (client = prisma) => client.hrmSettings.findUnique({
  where: { id: SETTINGS_ID },
  select: { interviewWelcomeEnabled: true, interviewWelcomeLastError: true },
});
const upsert = (data, client) => client.hrmSettings.upsert({ where: { id: SETTINGS_ID }, update: data, create: { id: SETTINGS_ID, ...data } });
const phoneOf = (candidate) => String(candidate?.whatsappNumber || candidate?.phone || "").trim();

// ── Settings ────────────────────────────────────────────────────────────────────────────────────

/** How it stands: the switch, the senders and how they share it, the last message that went, the last error. */
async function status({ client = prisma, canWrite = false } = {}) {
  const row = await settingsRow(client);
  const last = await client.whatsAppActivity.findFirst({
    where: { trigger: TRIGGER, status: { in: ["SENT", "DELIVERED", "READ"] } },
    orderBy: { sentAt: "desc" },
    select: { sentAt: true },
  });
  const policy = await senderPolicy.readPolicy(MESSAGE_KEY, { client });
  return {
    enabled: Boolean(row?.interviewWelcomeEnabled),
    ...senderPolicy.statusFields(policy),
    lastSentAt: last?.sentAt || null,
    lastError: row?.interviewWelcomeLastError || null,
    canWrite,
    templateKey: TEMPLATE_KEY,
    afterHoursTemplateKey: AFTER_HOURS_KEY,
    placeholders: PLACEHOLDERS,
  };
}

async function setEnabled(enabled, { client = prisma } = {}) {
  if (typeof enabled !== "boolean") throw failure(400, "Say whether the interview message is on or off.");
  await upsert({ interviewWelcomeEnabled: enabled, ...switchOffData("interviewWelcomeEnabled", enabled) }, client);
}

/** Who it is sent from: `{ mode, senderUserId, fallbackUserIds, userIds }` - Sender or Rotation, the sender, its fallback order and the rotation order (`senderPolicy.setPolicy`). */
async function setSender(input, { client = prisma } = {}) {
  await senderPolicy.setPolicy(MESSAGE_KEY, input || {}, { client });
  await upsert({ interviewWelcomeLastError: null }, client);
}

/** Who may be chosen as the sender: the same list every automatic sender is picked from. */
const senderCandidates = (options) => reportGroup().senderCandidates(options);

// ── The message ─────────────────────────────────────────────────────────────────────────────────

/** The wording for a candidate arriving at `now`: after hours outside the shift, where it is written. */
async function templateKeyFor(candidate, now, client = prisma) {
  const branchId = candidate?.branchId ?? (candidate?.candidateCode
    ? (await client.hrmInterviewCandidate.findFirst({ where: { candidateCode: candidate.candidateCode }, select: { branchId: true } }))?.branchId
    : null) ?? null;
  if ((await officeSlot(now, client, branchId)) !== SLOTS.AFTER_HOURS) return TEMPLATE_KEY;
  const own = await getTemplate(AFTER_HOURS_KEY, client).catch(() => null);
  return own?.body ? AFTER_HOURS_KEY : TEMPLATE_KEY;
}

async function renderBody(values, client = prisma, key = TEMPLATE_KEY) {
  const own = key !== TEMPLATE_KEY ? await getTemplate(key, client).catch(() => null) : null;
  if (own?.body) return renderTemplate(own.body, values);
  const template = await getTemplate(TEMPLATE_KEY, client).catch(() => null);
  return renderTemplate(template?.body || DEFAULT_BODY, values);
}

/**
 * The placeholders' values for a candidate. The date and time are when they came in - the row's
 * `createdAt`, or the sync's own moment before the row is read back - so every try says the same.
 * Each sheet cell is reduced to a short single line, as the name is: it goes out from a real number.
 */
const valuesFor = (candidate, name, arrivedAt = null) => ({
  "candidate name": safeName(candidate?.name) || "there",
  "sender name": safeName(name) || "our HR team",
  ...whenValues(arrivedAt || candidate?.createdAt || new Date()),
  position: safeName(candidate?.position) || "",
  department: safeName(candidate?.department) || "",
  branch: safeName(candidate?.branch) || "",
  city: safeName(candidate?.city) || "",
  "candidate id": safeName(candidate?.candidateCode) || "",
});

// ── After a candidate is created ────────────────────────────────────────────────────────────────

/**
 * Called by the sheet sync once a new candidate is written. Writes one QUEUED row for them - or none,
 * and answers why - and asks the loop to run. Never throws into the sync.
 */
async function afterCandidateCreated({ candidate, queuedThisSync = 0, now = new Date(), client = prisma, activity = whatsappActivity, kick = sendSoon } = {}) {
  const code = String(candidate?.candidateCode || "").trim();
  if (!code) return "no-candidate";
  const row = await settingsRow(client);
  if (!row?.interviewWelcomeEnabled) return "off";
  const phone = phoneOf(candidate);
  if (!isPhoneShaped(phone)) return "no-phone";
  const base = {
    client, mode: "AUTOMATIC", provider: "baileys", trigger: TRIGGER,
    logicalKey: `interview-welcome:${code}`, eventRef: `interview-candidate:${code}`,
    recipient: { kind: "PERSON", address: phone, name: safeName(candidate.name) || null },
    templateKey: TEMPLATE_KEY,
  };
  // A wording that cannot be worked out never costs the candidate their message: Interview Welcome's.
  const templateKey = await templateKeyFor(candidate, now, client).catch(() => TEMPLATE_KEY);
  if (queuedThisSync >= MAX_PER_SYNC) {
    await activity.recordFailure({ ...base, body: "", resendable: false },
      failure(429, `More than ${MAX_PER_SYNC} new candidates arrived in one sync, so this one was not messaged automatically. Message them by hand.`));
    return "volume-limit";
  }
  // Worded with the name of whoever would send it now; each try words it again for whoever actually does.
  const firstSender = senderPolicy.orderOf(await senderPolicy.readPolicy(MESSAGE_KEY, { client }))[0] || null;
  const body = await renderBody(valuesFor(candidate, firstSender?.name, now), client, templateKey);
  const { created } = await activity.queue({ ...base, templateKey, body, resendable: true });
  if (!created) return "duplicate";
  kick();
  return "queued";
}

// ── The loop ────────────────────────────────────────────────────────────────────────────────────

/**
 * One try for one queued candidate: the candidate read again (deleted meanwhile is not messaged), the
 * studio's chat switch and the number, then the Sender or Rotation as the settings stand now
 * (`senderPolicy.trySenders`) - each sender's own switch, link and hourly cap, the wording with their
 * name, and the send, all inside `track` so every try lands on the row with its reason.
 */
async function sendOne(item, { client, activity, sessions, switches }) {
  const code = String(item.logicalKey || "").replace(/^interview-welcome:/, "");
  const candidate = code
    ? await client.hrmInterviewCandidate.findFirst({ where: { candidateCode: code, deletedAt: null }, select: { candidateCode: true, name: true, phone: true, whatsappNumber: true, position: true, department: true, branch: true, city: true, createdAt: true } })
    : null;
  const phone = phoneOf(candidate) || item.recipientAddress || "";
  const contextFor = (senderUserId, body) => ({
    client, mode: "AUTOMATIC", provider: "baileys", trigger: TRIGGER,
    logicalKey: item.logicalKey, eventRef: item.eventRef, templateKey: item.templateKey,
    senderUserId,
    recipient: { kind: "PERSON", address: phone, name: safeName(candidate?.name) || item.recipientName || null },
    body, resendable: true, requireClaim: true,
  });
  // Nothing any sender could change: the row is failed once, with the reason.
  const refuse = (error) => activity.track(contextFor(null, item.body || item.bodyPreview || ""), async () => { throw error; });
  if (!candidate) return refuse(failure(404, "This candidate has been deleted, so they were not messaged."));
  if (!(await switches.isChatEnabled())) return refuse(failure(403, "WhatsApp chat is switched off for the studio."));
  if (!isPhoneShaped(phone)) return refuse(failure(400, "The candidate's number is not a phone number, so they were not messaged."));

  const delivery = await senderPolicy.trySenders(MESSAGE_KEY, async (sender) => {
    const lastHour = await client.whatsAppActivity.count({ where: { trigger: TRIGGER, senderUserId: sender.id, status: { in: ["SENT", "DELIVERED", "READ"] }, sentAt: { gt: new Date(Date.now() - 60 * 60 * 1000) } } });
    if (lastHour >= MAX_PER_SENDER_HOUR) throw senderPolicy.skip(`already sent ${MAX_PER_SENDER_HOUR} interview messages in the last hour`);
    const body = await renderBody(valuesFor(candidate, sender.name), client, item.templateKey || TEMPLATE_KEY);
    return activity.track(contextFor(sender.id, body), () => sessions.sendMessageToPerson({ userId: sender.id, phone, body }));
  }, { client, sessions, isChatEnabledForUser: switches.isChatEnabledForUser });
  if (delivery.outcome === "sent") return delivery.result;
  const reason = delivery.outcome === "maybe-sent"
    ? `It may have gone, so it is not tried again: ${delivery.reasons.join(" · ")}`
    : `${delivery.reasons.join(" · ")}. Senders are chosen under Templates → Interview Welcome.`;
  // A try that was made is on the row already; one nobody could make is written there now.
  if (!delivery.attempted) return refuse(failure(409, reason));
  throw failure(409, reason);
}

/** One pass over the queue, as New Lead Welcome's. Answers how many went, for the logs and tests. */
async function runOnce({ now = new Date(), client = prisma, activity = whatsappActivity, sessions = null, switches = null } = {}) {
  const expired = await activity.expirePending({ trigger: TRIGGER, now, maxAgeMs: MAX_AGE_MS, reason: "Not sent within two hours of the candidate arriving", client });
  if (expired) console.warn(`[interview-welcome] ${expired} message(s) waited over two hours and will not be sent`);
  const row = await settingsRow(client);
  if (!row?.interviewWelcomeEnabled) return { sent: 0, failed: 0, skipped: "off" };
  const pending = await activity.listPending({ trigger: TRIGGER, now, maxPasses: MAX_PASSES, retryGapMs: RETRY_GAP_MS, maxAgeMs: MAX_AGE_MS, client });
  if (!pending.length) return { sent: 0, failed: 0, skipped: "nothing-due" };
  const deps = {
    client, activity,
    sessions: sessions || require("../../sales/whatsapp-chat/sessionManager"),
    switches: switches || require("../../sales/whatsapp-chat/repository"),
  };
  let sent = 0;
  let failed = 0;
  for (const item of pending) {
    try {
      await sendOne(item, deps);
      sent += 1;
      await upsert({ interviewWelcomeLastError: null }, client).catch(() => {});
    } catch (error) {
      failed += 1;
      await upsert({ interviewWelcomeLastError: `The last interview message could not be sent: ${shownError(error)}`.slice(0, MAX_ERROR_CHARS) }, client).catch(() => {});
      // The code, not the message: a library's error text can carry the candidate's number.
      console.warn(`[interview-welcome] not sent (${item.logicalKey}): ${error?.code || error?.status || "SEND_FAILED"}`);
    }
  }
  return { sent, failed };
}

let timer = null;
let running = false;

async function tick() {
  if (running) return;
  running = true;
  try {
    await runOnce();
  } catch (error) {
    console.warn("[interview-welcome] pass failed:", error?.message);
  } finally {
    running = false;
  }
}

/** Asks for a pass straight away - after a candidate arrives - in the process that holds the sockets. */
function sendSoon() {
  if (!timer) return;
  setImmediate(() => { void tick(); });
}

/** Every minute, in the API process - the only one holding WhatsApp sockets. Off with INTERVIEW_WELCOME_AUTOSEND=false. */
function startInterviewWelcomeSender() {
  if (timer) return timer;
  if (String(process.env.INTERVIEW_WELCOME_AUTOSEND ?? "true").toLowerCase() === "false") {
    console.log("[interview-welcome] automatic send disabled via INTERVIEW_WELCOME_AUTOSEND=false");
    return null;
  }
  timer = setInterval(() => { void tick(); }, TICK_MS);
  timer.unref?.();
  return timer;
}

function stopInterviewWelcomeSender() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = {
  TRIGGER, MESSAGE_KEY, TEMPLATE_KEY, AFTER_HOURS_KEY, DEFAULT_BODY, PLACEHOLDERS, valuesFor, templateKeyFor, MAX_PER_SYNC, MAX_PER_SENDER_HOUR,
  status, setEnabled, setSender, senderCandidates, afterCandidateCreated, runOnce, startInterviewWelcomeSender, stopInterviewWelcomeSender,
};
