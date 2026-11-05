const prisma = require("../../../config/db");
// Lazily, as `senderPolicy` does: these modules send through each other and a require at the top
// would meet one of them half-loaded.
const reportGroup = () => require("../../hrm/attendance/reportGroup");
const chatSwitches = () => require("../../sales/whatsapp-chat/repository");

/**
 * **Who a shoot notice comes from: the project's own person, not a studio setting.**
 *
 * The employee notice sends from the project's **Pre-Production Coordinator** and the vendor notice
 * from its **Production Manager**, so the phone changes from project to project and a vendor who
 * replies "can we shift by an hour?" is replying to somebody who can answer. This replaces the Sender
 * and Rotation that `automatic-whatsapp/senderPolicy.js` picked: the precedent is already there in
 * that file - *"New Lead Welcome is not one of these: it always goes from the lead's own owner."*
 *
 * **There is no fallback.** Where that person cannot send, the message waits and is tried again next
 * sweep; it never leaves somebody else's number. A vendor must not hear about a shoot from a phone
 * they do not know, and the studio asked for the same rule on the employee side rather than two.
 *
 * So "cannot send" is not one condition but five, and `resolve` says **which**, because each is fixed
 * by a different person: the project needs the role filled in (Project Management), the employee needs
 * a login with Allow WhatsApp (Admin → Users), and the login needs its WhatsApp connected and its chat
 * switch on (the person themselves). Settings shows the reason beside the project.
 */

/**
 * A failure in words that may be shown.
 *
 * What comes back from the WhatsApp library is its own text, and it carries a jid - which is a phone
 * number - often enough that it cannot be put on a Settings screen as it stands. This panel is read
 * by anybody with `SETTINGS / Shoot Crew Notice` Read, so the number is taken out and the library's
 * own wording kept only where it says something a reader can act on.
 */
function plainly(error) {
  const said = String(error?.message || "could not send").replace(/\.$/, "");
  // A jid (`919876500011@s.whatsapp.net`) or a bare run of digits long enough to be a number.
  return said.replace(/\b\d{6,}@\S+/g, "a number").replace(/\b\d{9,}\b/g, "a number");
}

const ROLES = Object.freeze({
  PRE_PRODUCTION_COORDINATOR: {
    key: "PRE_PRODUCTION_COORDINATOR",
    label: "Pre-Production Coordinator",
    employeeIdField: "preProductionCoordinatorEmployeeId",
    employeeField: "preProductionCoordinatorEmployee",
  },
  PRODUCTION_MANAGER: {
    key: "PRODUCTION_MANAGER",
    label: "Production Manager",
    employeeIdField: "productionManagerEmployeeId",
    employeeField: "productionManagerEmployee",
  },
});

/** What a project has to select for either role to be resolvable - both, so one read serves both arms. */
const PROJECT_SENDER_SELECT = {
  preProductionCoordinatorEmployeeId: true,
  productionManagerEmployeeId: true,
  preProductionCoordinatorEmployee: { select: { id: true, employeeName: true } },
  productionManagerEmployee: { select: { id: true, employeeName: true } },
};

/** `NOBODY_NAMED` is the studio's data to fix, the rest are the person's or an administrator's. */
const WHY = Object.freeze({
  NOBODY_NAMED: "NOBODY_NAMED",
  NO_LOGIN: "NO_LOGIN",
  NOT_ELIGIBLE: "NOT_ELIGIBLE",
  CHAT_OFF: "CHAT_OFF",
  NOT_CONNECTED: "NOT_CONNECTED",
});

/** The sentence Settings and the error line both read, naming the role so two arms never read alike. */
function reasonWords(role, why, name) {
  const who = name ? `${name}, this project's ${role.label},` : `This project's ${role.label}`;
  switch (why) {
    case WHY.NOBODY_NAMED: return `No ${role.label} is named on this project, so there is nobody to send it from.`;
    case WHY.NO_LOGIN: return `${who} has no login in the app, so they cannot send WhatsApp messages yet.`;
    case WHY.NOT_ELIGIBLE: return `${who} is not an active login with Allow WhatsApp ticked.`;
    case WHY.CHAT_OFF: return `${who} has WhatsApp chat switched off.`;
    case WHY.NOT_CONNECTED: return `${who} has not connected their WhatsApp.`;
    default: return `${who} cannot send it.`;
  }
}

/**
 * Who this project's notice goes from: `{ ok: true, userId, name }`, or `{ ok: false, why, name,
 * reason }` - never somebody else.
 *
 * `project` is read with `PROJECT_SENDER_SELECT`. The checks run in the order they can be fixed in,
 * so the reason names the first real gap rather than the last one met.
 */
async function resolve(project, role, {
  client = prisma,
  sessions = null,
  isChatEnabledForUser = (userId) => chatSwitches().isChatEnabledForUser(userId),
} = {}) {
  const refused = (why, name) => ({ ok: false, userId: null, name: name || null, why, reason: reasonWords(role, why, name) });
  const employeeId = project?.[role.employeeIdField] || null;
  const name = project?.[role.employeeField]?.employeeName || "";
  if (!employeeId) return refused(WHY.NOBODY_NAMED, "");

  // An employee may hold no login at all (`linked_employee_id` is unique but nullable), which is a
  // different gap from holding one that is not allowed WhatsApp - and a different person fixes it.
  const login = await client.user.findFirst({ where: { linkedEmployeeId: employeeId }, select: { id: true, status: true, whatsappRequired: true } });
  if (!login) return refused(WHY.NO_LOGIN, name);
  const eligible = await client.user.findFirst({ where: { id: login.id, ...reportGroup().ELIGIBLE_SENDER }, select: { id: true } });
  if (!eligible) return refused(WHY.NOT_ELIGIBLE, name);
  if (!(await isChatEnabledForUser(login.id))) return refused(WHY.CHAT_OFF, name);
  const live = sessions || reportGroup().currentSessions();
  if (live.sessionState(login.id)?.status !== "connected") return refused(WHY.NOT_CONNECTED, name);
  return { ok: true, userId: login.id, name: name || null, why: null, reason: "" };
}

/**
 * One send from one named person, answering in the shape `senderPolicy.trySenders` answers in so the
 * two sweeps read alike: `"sent"`, `"failed"` (certainly not sent - the next sweep has it again) or
 * `"maybe-sent"` (it may have gone, so it is never tried twice).
 *
 * There is no list to fall through to, so `attempted` says only whether this one person was asked.
 */
async function sendFrom(sender, attempt) {
  const who = sender.name ? `${sender.name}` : `user ${sender.userId}`;
  try {
    const result = await attempt({ id: sender.userId, name: sender.name, who });
    return { outcome: "sent", userId: sender.userId, who, code: null, reasons: [], attempted: true, result };
  } catch (error) {
    const code = error?.code || null;
    const reasons = [`${who}: ${plainly(error)}`];
    const answer = { userId: null, who, code, reasons, result: null };
    if (error?.skip) return { ...answer, outcome: "failed", attempted: false };
    if (reportGroup().certainlyNotSent(error)) return { ...answer, outcome: "failed", attempted: true };
    return { ...answer, outcome: "maybe-sent", attempted: true };
  }
}

module.exports = { ROLES, WHY, PROJECT_SENDER_SELECT, reasonWords, plainly, resolve, sendFrom };
