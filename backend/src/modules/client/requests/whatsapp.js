const prisma = require("../../../config/db");
const whatsappActivity = require("../../../services/whatsappActivity");

/*
 * WhatsApp for a client's request (Bookings -> Services / Deliverables -> Raise request in the app).
 *
 * When a client sends a request, three kinds of message are made:
 *
 *   - to the **owners** (every active Super Admin and Admin with a contact number), and
 *   - to the **project's manager** - what was asked for, on which shoot, for which booking;
 *   - to the **client** (the booking's main number) - that the studio has their request.
 *
 * Each goes out from the WhatsApp of the booking's CRM (else its project manager) - a real person's
 * number, so a reply lands in their own chat - as `sendMessageToPerson`, queued first as a
 * `whatsapp_activity` row keyed by the request, so a repeat makes one row and one message, and every
 * send (or why one could not go) shows in Settings -> WhatsApp Activity Log.
 *
 * ── Off until switched on ───────────────────────────────────────────────────────────────────────
 *
 * Nothing is queued and nothing is sent unless `CLIENT_REQUEST_WHATSAPP=on` is set in the server's
 * environment. Off, `afterRequest` returns "off" at once and the sender loop is never started - the
 * bell and push notices to the team go on as they do now.
 */

const TRIGGER_TEAM = "CLIENT_REQUEST_TEAM";
const TRIGGER_CLIENT = "CLIENT_REQUEST_CLIENT";
const TICK_MS = 60 * 1000;
const MAX_PASSES = 3;
const RETRY_GAP_MS = 5 * 60 * 1000;
const MAX_AGE_MS = 2 * 60 * 60 * 1000;

const enabled = () => process.env.CLIENT_REQUEST_WHATSAPP === "on";
const failure = (status, message) => Object.assign(new Error(message), { status });
const digits = (value) => String(value || "").replace(/\D/g, "");
// A number saved as ten digits is an Indian one.
const phoneOf = (value) => { const raw = digits(value); return raw.length === 10 ? `91${raw}` : raw; };
const isPhone = (value) => /^\d{11,15}$/.test(value);

/** What the team is told: the booking, the shoot, and every item asked for with how many. */
function teamBody({ project, shoot, rows }) {
  const lines = rows.map((row) => `- ${row.itemName}${row.quantity > 1 ? ` x${row.quantity}` : ""}${row.note ? ` (${row.note})` : ""}`);
  return [
    "New client request in the app",
    "",
    `Client: ${project.whatsappGroupName || project.eventId}`,
    `Booking: ${project.eventId}`,
    `Shoot: ${shoot.shoot}`,
    "",
    "Requested:",
    ...lines,
    "",
    "Please review it in DBS -> Client Management -> Client Requests.",
  ].join("\n");
}

/** What the client is told: their request reached the studio, and the team will be in touch. */
function clientBody({ shoot, rows }) {
  const names = rows.map((row) => `${row.itemName}${row.quantity > 1 ? ` x${row.quantity}` : ""}`);
  return [
    "Hello from Don't Blink Studioz,",
    "",
    `We have received your request for ${shoot.shoot}:`,
    ...names.map((name) => `- ${name}`),
    "",
    "Our team will review it and contact you soon. Thank you!",
  ].join("\n");
}

/** Who sends: the booking's CRM's login, else its project manager's. */
async function senderFor(project, client = prisma) {
  for (const employeeId of [project.crmEmployeeId, project.projectManagerEmployeeId].filter(Boolean)) {
    const user = await client.user.findFirst({ where: { linkedEmployeeId: employeeId, status: "ACTIVE" }, select: { id: true } });
    if (user) return user.id;
  }
  return null;
}

/** Who is told on the team: the owners and the project's manager, each once, by their contact number. */
async function teamRecipients(project, client = prisma) {
  const owners = await client.user.findMany({ where: { status: "ACTIVE", role: { in: ["SUPER_ADMIN", "ADMIN"] } }, select: { name: true, linkedEmployee: { select: { employeeName: true, contactNumber: true } } } });
  const manager = project.projectManagerEmployeeId
    ? await client.employee.findUnique({ where: { id: project.projectManagerEmployeeId }, select: { employeeName: true, contactNumber: true } }).catch(() => null)
    : null;
  const people = [
    ...owners.map((user) => ({ name: user.linkedEmployee?.employeeName || user.name, phone: phoneOf(user.linkedEmployee?.contactNumber) })),
    ...(manager ? [{ name: manager.employeeName, phone: phoneOf(manager.contactNumber) }] : []),
  ];
  const seen = new Set();
  return people.filter((person) => isPhone(person.phone) && !seen.has(person.phone) && seen.add(person.phone));
}

/**
 * A client sent `rows` (one or several requests, one shoot): the team's and the client's messages
 * queued. "off" while the switch is off - nothing is queued then. Never throws.
 */
async function afterRequest({ rows, shoot, client = prisma, activity = whatsappActivity } = {}) {
  if (!enabled()) return "off";
  try {
    if (!rows?.length || !shoot) return "nothing";
    const project = await client.salesProject.findUnique({
      where: { id: rows[0].projectId },
      select: { id: true, eventId: true, whatsappGroupName: true, clientMainNumber: true, crmEmployeeId: true, projectManagerEmployeeId: true },
    });
    if (!project) return "no-project";
    const key = `client-request:${rows.map((row) => row.id).join("-")}`.slice(0, 180);
    const base = { client, mode: "AUTOMATIC", provider: "baileys", eventRef: key, resendable: true };
    for (const person of await teamRecipients(project, client)) {
      await activity.queue({ ...base, trigger: TRIGGER_TEAM, logicalKey: `${key}:team:${person.phone}`, recipient: { kind: "PERSON", address: person.phone, name: person.name || null }, body: teamBody({ project, shoot, rows }) });
    }
    const clientPhone = phoneOf(project.clientMainNumber);
    if (isPhone(clientPhone)) {
      await activity.queue({ ...base, trigger: TRIGGER_CLIENT, logicalKey: `${key}:client`, recipient: { kind: "PERSON", address: clientPhone, name: project.whatsappGroupName || null }, body: clientBody({ shoot, rows }) });
    }
    sendSoon();
    return "queued";
  } catch (error) {
    console.warn("[client-request-whatsapp] not queued:", error?.code || error?.message || error);
    return "failed";
  }
}

/** One try for one queued message, from the booking's CRM (else manager) WhatsApp. */
async function sendOne(item, { client, activity, sessions, switches }) {
  const requestIds = String(item.eventRef || "").replace("client-request:", "").split("-").map(Number).filter(Boolean);
  const first = requestIds.length ? await client.clientServiceRequest.findFirst({ where: { id: { in: requestIds } }, select: { projectId: true } }) : null;
  const project = first ? await client.salesProject.findUnique({ where: { id: first.projectId }, select: { crmEmployeeId: true, projectManagerEmployeeId: true } }) : null;
  const senderUserId = project ? await senderFor(project, client) : null;
  const context = {
    client, mode: "AUTOMATIC", provider: "baileys", trigger: item.trigger,
    logicalKey: item.logicalKey, eventRef: item.eventRef, senderUserId,
    recipient: { kind: "PERSON", address: item.recipientAddress, name: item.recipientName || null },
    body: item.body || item.bodyPreview || "", resendable: true, requireClaim: true,
  };
  return activity.track(context, async () => {
    if (!senderUserId) throw failure(409, "The booking has no CRM or project manager with an active login, so there was no WhatsApp to send from.");
    if (!(await switches.isChatEnabled())) throw failure(403, "WhatsApp chat is switched off for the studio.");
    if (!(await switches.isChatEnabledForUser(senderUserId))) throw failure(403, "WhatsApp chat is switched off for the sender.");
    return sessions.sendMessageToPerson({ userId: senderUserId, phone: item.recipientAddress, body: context.body });
  });
}

/** One pass over both queues; nothing at all while the switch is off. */
async function runOnce({ now = new Date(), client = prisma, activity = whatsappActivity, sessions = null, switches = null } = {}) {
  if (!enabled()) return { sent: 0, failed: 0, skipped: "off" };
  const deps = {
    client, activity,
    sessions: sessions || require("../../sales/whatsapp-chat/sessionManager"),
    switches: switches || require("../../sales/whatsapp-chat/repository"),
  };
  let sent = 0;
  let failed = 0;
  for (const trigger of [TRIGGER_TEAM, TRIGGER_CLIENT]) {
    await activity.expirePending({ trigger, now, maxAgeMs: MAX_AGE_MS, reason: "Not sent within two hours of the request", client });
    const pending = await activity.listPending({ trigger, now, maxPasses: MAX_PASSES, retryGapMs: RETRY_GAP_MS, maxAgeMs: MAX_AGE_MS, client });
    for (const item of pending) {
      try {
        await sendOne({ ...item, trigger }, deps);
        sent += 1;
      } catch (error) {
        failed += 1;
        console.warn(`[client-request-whatsapp] not sent (${item.logicalKey}): ${error?.code || error?.status || "SEND_FAILED"}`);
      }
    }
  }
  return { sent, failed };
}

let timer = null;
let running = false;

async function tick() {
  if (running) return;
  running = true;
  try { await runOnce(); } catch (error) { console.warn("[client-request-whatsapp] pass failed:", error?.message || error); } finally { running = false; }
}

function sendSoon() {
  if (timer) setTimeout(() => { void tick(); }, 1000).unref?.();
}

/** Started with the server - and only when the switch is on. */
function startClientRequestWhatsapp() {
  if (!enabled() || timer) return;
  timer = setInterval(() => { void tick(); }, TICK_MS);
  timer.unref?.();
}

function stopClientRequestWhatsapp() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { afterRequest, runOnce, teamBody, clientBody, teamRecipients, enabled, startClientRequestWhatsapp, stopClientRequestWhatsapp, TRIGGER_TEAM, TRIGGER_CLIENT };
