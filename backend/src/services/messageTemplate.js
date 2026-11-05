const prisma = require("../config/db");

/**
 * The studio's messages: a wording held in Settings, filled in from a record.
 *
 * A template is prose with its facts left as `{placeholders}` - `{payment amount}`, `{shoot name}` -
 * and this fills them from whatever the module holding the record hands over. The wording is the
 * studio's, so nothing in the application reads it: only which placeholders it may use.
 *
 * ── What an unknown placeholder does ──
 *
 * It is left exactly as typed. A template mentioning `{invoice number}` is somebody in the middle of
 * writing one, or a placeholder from a message this record does not have; blanking it would hand the
 * studio a sentence with a hole in it and no way to see what was meant to be there. Leaving it makes
 * the mistake visible in the one place it will be read.
 *
 * ── Why the studio's own text is not trusted as a pattern ──
 *
 * The body is replaced by a plain scan for `{name}` rather than by building a regular expression out
 * of it, so a stray `(`, `*` or `\\` somebody types is text like everything else.
 */

/** `{ this }` and `{this}` are the same placeholder: names are matched folded and spaces collapsed. */
const fold = (name) => String(name || "").trim().toLowerCase().replace(/\s+/g, " ");

/**
 * Fills a body from `values`, keyed by placeholder name.
 *
 * Values are read folded, so a template typed `{Payment Amount}` finds `payment amount`. A value of
 * `0` or an empty string is an answer and is used; only a placeholder nothing answers is left alone.
 */
function renderTemplate(body, values = {}) {
  const answers = new Map(Object.entries(values).map(([name, value]) => [fold(name), value]));
  return String(body || "").replace(/\{([^{}]+)\}/g, (whole, name) => {
    const answer = answers.get(fold(name));
    return answer === undefined || answer === null ? whole : String(answer);
  });
}

/** Every placeholder a body uses, in the order it uses them, without repeats. */
function placeholdersIn(body) {
  const found = [...String(body || "").matchAll(/\{([^{}]+)\}/g)].map((match) => fold(match[1]));
  return [...new Set(found)];
}

/** One template by key, or null where the studio has not written that message. */
async function getTemplate(key, client = prisma) {
  return client.messageTemplate.findUnique({ where: { key: String(key || "").trim() } });
}

/**
 * **Whether this message is sent at all** - the switch beside its wording on Settings → Templates.
 *
 * `true` for a template the studio has never written, which is the point: a sender with its own
 * built-in wording should go on sending it, and only an explicit `enabled = false` stops it. Asking
 * `getTemplate` instead would conflate the two - a template that is off would read as one nobody has
 * written, which is exactly the case every sender answers by sending its default wording.
 *
 * Every automatic sender asks this **before** it sends. One that does not is a message the studio
 * cannot switch off, which is the thing this exists to fix.
 */
async function isMessageEnabled(key, client = prisma) {
  const row = await client.messageTemplate.findUnique({
    where: { key: String(key || "").trim() },
    select: { enabled: true },
  }).catch(() => null);
  return row ? row.enabled !== false : true;
}

/**
 * Which of these messages are switched **off**, as a Set of keys, in one query.
 *
 * `isMessageEnabled` asked one key at a time, which is right for a sender about to send one message
 * and wrong for a screen deciding what to show about several. Same rule as that one: a template
 * nobody has written is on, and only an explicit `enabled = false` is off.
 */
async function disabledMessages(keys = [], client = prisma) {
  const wanted = [...new Set(keys.map((key) => String(key || "").trim()).filter(Boolean))];
  if (!wanted.length) return new Set();
  const rows = await client.messageTemplate.findMany({ where: { key: { in: wanted } }, select: { key: true, enabled: true } }).catch(() => []);
  return new Set(rows.filter((row) => row.enabled === false).map((row) => row.key));
}

/**
 * One template, rendered for a record - or null.
 *
 * Null rather than a half-written message when the studio has deleted the template or has not
 * written it yet: the caller then shows nothing, which is honest, instead of a body of bare
 * placeholders.
 */
async function renderMessage(key, values, client = prisma) {
  const template = await getTemplate(key, client);
  if (!template?.body) return null;
  return { key: template.key, name: template.name, body: renderTemplate(template.body, values) };
}

/**
 * The keys the application itself fills in. A studio-written message is any key it likes.
 *
 * All three are **copy-and-send** messages - the wording somebody pastes into WhatsApp - and not the
 * emails the application sends itself. The onboarding invite and the credentials both still send
 * their own email with its own wording; these are the versions handed over by a person, which is the
 * one that has to work when the mail quota is spent or the mail never arrives.
 */
const TEMPLATE_KEYS = {
  CASH_RECEIVED: "CASH_RECEIVED",
  EMPLOYEE_ONBOARDING_INVITE: "EMPLOYEE_ONBOARDING_INVITE",
  /*
   * The other end of the employment, in the four messages the flow actually sends.
   *
   * `FORM` hands the link over; `REMINDER` chases a form nobody has filled in; `APPROVED` confirms
   * the dates once HR records the resignation, which is the one message the leaver will keep; and
   * `NOT_ACCEPTED` says the form was refused and why. All four are the studio's words rather than a
   * dialog's, because a resignation is the correspondence a studio most wants to word in its own
   * voice - and the last two are what somebody is told about their own exit.
   */
  EMPLOYEE_OFFBOARDING_FORM: "EMPLOYEE_OFFBOARDING_FORM",
  EMPLOYEE_OFFBOARDING_REMINDER: "EMPLOYEE_OFFBOARDING_REMINDER",
  EMPLOYEE_OFFBOARDING_APPROVED: "EMPLOYEE_OFFBOARDING_APPROVED",
  EMPLOYEE_OFFBOARDING_NOT_ACCEPTED: "EMPLOYEE_OFFBOARDING_NOT_ACCEPTED",
  // The application form a candidate is sent from the Interview screen: the fourth copy-and-send
  // wording, beside the onboarding invite it is modelled on.
  INTERVIEW_APPLICATION_INVITE: "INTERVIEW_APPLICATION_INVITE",
  LOGIN_CREDENTIALS: "LOGIN_CREDENTIALS",
  // A client's login, handed over from Create Project's Client Login Ready: no email, and a password
  // the client keeps.
  CLIENT_LOGIN_CREDENTIALS: "CLIENT_LOGIN_CREDENTIALS",
  // A project's CRD document link, handed over from the CRD Documents screen's CRD Link Ready.
  CRD_DOCUMENT_LINK: "CRD_DOCUMENT_LINK",
  // The client's answer to their feedback, copied or sent from the Feedback page once it is given:
  // a thank-you asking for a review and a follow (Completed), or a note that the team will sort the
  // issues out (Issues).
  FEEDBACK_THANK_YOU: "FEEDBACK_THANK_YOU",
  FEEDBACK_ISSUES: "FEEDBACK_ISSUES",
  // The three production messages, posted to the project's WhatsApp group by the coordinator's
  // steps (project-management/production/messages.js). Sent, not copy-and-send.
  PRODUCTION_STARTED_FROM_STUDIO: "PRODUCTION_STARTED_FROM_STUDIO",
  PRODUCTION_REACHED_SHOOT_PLACE: "PRODUCTION_REACHED_SHOOT_PLACE",
  PRODUCTION_SHOOT_COMPLETED: "PRODUCTION_SHOOT_COMPLETED",
  /*
   * Settings → Project Management → Shoot crew notice: what each person given a service on a shoot
   * is told two days before it, and what somebody taken off it afterwards is told instead.
   */
  SHOOT_CREW_ASSIGNED: "SHOOT_CREW_ASSIGNED",
  SHOOT_CREW_REMOVED: "SHOOT_CREW_REMOVED",
  /*
   * The same notice for a **vendor** confirmed on a shoot, from the project's Production Manager. Six
   * wordings rather than two, because a vendor is told four different things and a reminder that
   * reads like a first contact is read as one: the confirm, the two-days-before reminder, and a
   * wording for each kind of change. All six take the same placeholders - {vendor name}, {shoot},
   * {shoot id}, {project}, {event id}, {date}, {day}, {time}, {place}, {district}, {service},
   * {manager name} - so the studio can move a detail between them.
   */
  VENDOR_SHOOT_CONFIRMED: "VENDOR_SHOOT_CONFIRMED",
  VENDOR_SHOOT_REMINDER: "VENDOR_SHOOT_REMINDER",
  VENDOR_SHOOT_DATE_CHANGED: "VENDOR_SHOOT_DATE_CHANGED",
  VENDOR_SHOOT_PLACE_CHANGED: "VENDOR_SHOOT_PLACE_CHANGED",
  VENDOR_SHOOT_SERVICE_CHANGED: "VENDOR_SHOOT_SERVICE_CHANGED",
  VENDOR_SHOOT_REMOVED: "VENDOR_SHOOT_REMOVED",
  // Settings → Project Management → Payment reminder: into the project's WhatsApp group two days
  // before a payment is due. {client name}, {event id}, {payment}, {amount}, {due date}.
  PAYMENT_DUE_REMINDER: "PAYMENT_DUE_REMINDER",
  // Settings → Automatic WhatsApp Message → Photo Selection Submitted: into a group, once a client
  // has submitted their selection. {client name}, {project name}, {event name}, {category breakdown}, {total selected count}, {deliverables},
  // {selected count}, {submitted at}.
  PHOTO_SELECTION_SUBMITTED: "PHOTO_SELECTION_SUBMITTED",
  // Settings → Automatic WhatsApp Message → New Lead Welcome: to a lead a linked Google Sheet brings
  // in, from its owner's WhatsApp. {client name}, {sender name}.
  CRM_LEAD_WELCOME: "CRM_LEAD_WELCOME",
  // Settings → Templates → Interview Welcome: to a candidate a linked interview sheet brings in, from
  // the one HR login chosen beside it. {candidate name}, {sender name}, {greeting}, {date}, {day},
  // {time}, {position}, {department}, {branch}, {city}, {candidate id}.
  INTERVIEW_WELCOME: "INTERVIEW_WELCOME",
  // The same message for a candidate arriving after hours - outside the attendance shift, a weekly
  // off or a holiday. Interview Welcome is sent where it is not written.
  INTERVIEW_WELCOME_AFTER_HOURS: "INTERVIEW_WELCOME_AFTER_HOURS",
};

module.exports = { renderTemplate, placeholdersIn, getTemplate, isMessageEnabled, disabledMessages, renderMessage, TEMPLATE_KEYS, fold };
