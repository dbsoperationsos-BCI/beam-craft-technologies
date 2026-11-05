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
  // The application form a candidate is sent from the Interview screen: the fourth copy-and-send
  // wording, beside the onboarding invite it is modelled on.
  INTERVIEW_APPLICATION_INVITE: "INTERVIEW_APPLICATION_INVITE",
  LOGIN_CREDENTIALS: "LOGIN_CREDENTIALS",
};

module.exports = { renderTemplate, placeholdersIn, getTemplate, renderMessage, TEMPLATE_KEYS, fold };
