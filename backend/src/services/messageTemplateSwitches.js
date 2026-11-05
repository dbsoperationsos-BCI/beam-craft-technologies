const prisma = require("../config/db");

/**
 * Settings → Templates' ON / OFF for each message the studio sends over WhatsApp
 * (`message_template_switch`).
 *
 * A message with no row is ON: every message was sent before the switch existed, so nothing changes
 * until somebody switches one off. OFF means the message is not sent at all - its Send WhatsApp
 * button is hidden on screen and refused here (`requireTemplateOn`), and every automatic send of it
 * stops (`isEnabled`, asked by each sender before it sends).
 *
 * A switch is the message's template key, except a family that is chosen from at random - the ten
 * birthday wishes - which has one switch for the family. The messages that already had their own
 * switch keep it and are not here: Attendance WhatsApp Report, Photo Selection Submitted, New Lead
 * Welcome and Interview Welcome.
 */

const SWITCHES = Object.freeze({
  CASH_RECEIVED: "Cash Received",
  EMPLOYEE_ONBOARDING_INVITE: "Employee Invite",
  LOGIN_CREDENTIALS: "Login Credentials",
  CLIENT_LOGIN_CREDENTIALS: "Client Login Credentials",
  CRD_DOCUMENT_LINK: "CRD Document Link",
  INTERVIEW_APPLICATION_INVITE: "Interview Application Invite",
  EMPLOYEE_OFFBOARDING_FORM: "Offboarding Form",
  EMPLOYEE_OFFBOARDING_REMINDER: "Offboarding Reminder",
  EMPLOYEE_OFFBOARDING_APPROVED: "Offboarding Confirmed",
  EMPLOYEE_OFFBOARDING_NOT_ACCEPTED: "Offboarding Not Accepted",
  FEEDBACK_THANK_YOU: "Feedback Thank You",
  FEEDBACK_ISSUES: "Feedback Issues",
  PAYMENT_DUE_REMINDER: "Payment Reminder",
  SHOOT_CREW_ASSIGNED: "Shoot Crew Notice",
  SHOOT_CREW_REMOVED: "Shoot Crew Removed",
  PRODUCTION_STARTED_FROM_STUDIO: "Production — Started From Studio",
  PRODUCTION_REACHED_SHOOT_PLACE: "Production — Reached Shoot Place",
  PRODUCTION_SHOOT_COMPLETED: "Production — Shoot Completed",
  BIRTHDAY_WISH: "Birthday Wishes",
  WEDDING_ANNIVERSARY_WISH: "Anniversary Wishes",
  WORK_ANNIVERSARY_WISH: "Work Anniversary Wishes",
});
// The wishes' switches answer to `SETTINGS / Wishes`, which rewords them; every other to Message Template.
const WISH_SWITCHES = new Set(["BIRTHDAY_WISH", "WEDDING_ANNIVERSARY_WISH", "WORK_ANNIVERSARY_WISH"]);
// The wish kinds `wishes/sender.js` sends, to their switch.
const WISH_SWITCH_OF = Object.freeze({ BIRTHDAY: "BIRTHDAY_WISH", WEDDING_ANNIVERSARY: "WEDDING_ANNIVERSARY_WISH", WORK_ANNIVERSARY: "WORK_ANNIVERSARY_WISH" });

const isSwitch = (key) => Object.prototype.hasOwnProperty.call(SWITCHES, key);
const offMessage = (key) => `${SWITCHES[key] || "This message"} is switched off under Settings → Templates, so it is not sent.`;

function httpError(status, message, code) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

/** Every switch and whether it is ON: `{ KEY: true|false }`. */
async function listSwitches(client = prisma) {
  const rows = await client.messageTemplateSwitch.findMany({ select: { key: true, enabled: true } });
  const off = new Set(rows.filter((row) => !row.enabled).map((row) => row.key));
  return Object.fromEntries(Object.keys(SWITCHES).map((key) => [key, !off.has(key)]));
}

/** Whether a message may be sent. Anything that is not a switch is always ON. */
async function isEnabled(key, client = prisma) {
  if (!isSwitch(key)) return true;
  const row = await client.messageTemplateSwitch.findUnique({ where: { key }, select: { enabled: true } });
  return row?.enabled !== false;
}

/** Refuses a send of a message that is switched off - 409 `TEMPLATE_SWITCHED_OFF`. */
async function assertEnabled(key, client = prisma) {
  if (!(await isEnabled(key, client))) throw httpError(409, offMessage(key), "TEMPLATE_SWITCHED_OFF");
}

async function setEnabled(key, enabled, userId, client = prisma) {
  if (!isSwitch(key)) throw httpError(404, "That message has no ON / OFF switch.");
  if (typeof enabled !== "boolean") throw httpError(400, "Say whether the message is ON or OFF.");
  const updatedByUserId = Number(userId) || null;
  await client.messageTemplateSwitch.upsert({ where: { key }, update: { enabled, updatedByUserId }, create: { key, enabled, updatedByUserId } });
  return listSwitches(client);
}

/**
 * Route guard for a manual send: the message must be ON. Mounted after the permission guards, so it
 * is the server, not a hidden button, that refuses a message the studio switched off.
 */
function requireTemplateOn(key) {
  return (req, res, next) => {
    assertEnabled(key)
      .then(() => next())
      .catch((error) => (error.status ? res.status(error.status).json({ message: error.message, code: error.code }) : next(error)));
  };
}

module.exports = { SWITCHES, WISH_SWITCHES, WISH_SWITCH_OF, isSwitch, offMessage, listSwitches, isEnabled, assertEnabled, setEnabled, requireTemplateOn };
