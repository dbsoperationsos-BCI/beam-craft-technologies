/**
 * What Nebula is allowed to answer.
 *
 * It is a CRM assistant, and it was answering anything. Asked what Salem is famous for it produced
 * a paragraph of tourism; asked who the Prime Minister is it named him. Both were confident, both
 * were outside anything the studio can check, and neither belongs in a panel beside a client's
 * record.
 *
 * The system prompt was told to refuse these and did not - it held for a coding request and let
 * every factual question through. That is the same lesson as the language, the dates and the email
 * addresses: a small model does not reliably follow a negative instruction, so the decision is made
 * here instead.
 *
 * The test is deliberately generous, because refusing a real question is worse than answering a
 * stray one. A question is in scope if it mentions the studio's work at all, or refers to a person
 * the CRM knows about. Only a question that does neither is turned away.
 */

// The work: what the studio sells, how a lead is handled, and the studio's own schedule.
const DOMAIN = new RegExp([
  // The CRM itself
  "lead", "client", "customer", "enquir", "crm", "follow.?up", "status", "pipeline", "remark",
  "meeting", "transcript", "call log", "whatsapp", "assign",
  // What is sold
  "shoot", "photo", "photograph", "videograph", "album", "package", "quote", "price", "budget",
  "advance", "booking", "book", "deposit", "discount", "invoice", "payment",
  "project", "projects", "calendar", "schedule", "diary", "timeline", "appointment",
  // The three verticals
  "wedding", "engagement", "reception", "muhurtham", "bride", "groom",
  "newborn", "baby", "maternity", "mother",
  "corporate", "company", "conference", "product launch", "headshot",
  // Doing the job
  "candid", "traditional", "drone", "edit", "deliver", "venue", "event", "date", "convince",
  "objection", "negotiate", "reply", "message", "draft", "call", "contact", "visit",
  /*
   * The fields a record actually has.
   *
   * Without these, "what city is Shivani in" was refused as general knowledge - it names no lead
   * word and no pronoun, so nothing marked it as being about the studio. Asking for a field of a
   * record is the most ordinary thing anyone does here, and refusing it is far worse than
   * occasionally answering a stray question that happens to share a word.
   */
  "city", "town", "location", "address", "phone", "email", "vertical", "branch",
  "owner", "assigned", "name", "detail", "profile", "record",
  // Questions about the running board or the current day are studio work, not outside it.
  "today", "today's", "current", "currently", "now", "how many", "count", "total", "overview",
].join("|"), "i");

/*
 * Someone the CRM knows about.
 *
 * Third person only. "Write me a python function" is about the person asking, not about a client,
 * and first-person pronouns would wave it through.
 */
const ABOUT_A_PERSON = /\b(her|him|she|he|they|them|their|his|hers)\b/i;

/*
 * Each module's own vocabulary, on top of the shared one above.
 *
 * The shared list grew up around the CRM, so it knows about shoots and follow-ups and nothing about
 * headcount or cash entries. Applying it unchanged to an HRM session would refuse "how many staff do
 * we have" as though it were a question about football - the guard would be doing more damage than
 * the behaviour it was written to stop.
 */
const MODULE_DOMAIN = {
  /*
   * Substrings, not whole words - the same style as the shared list above, and for the same reason
   * it was written that way. `\bemployee\b` does not match "employees", so an HRM session asked
   * "how many employees do we have" refused it as though it were a question about football. A guard
   * that strict does more damage than the behaviour it was written to stop.
   */
  SALES: ["vertical", "branch", "source", "campaign", "referral", "conversion"],
  HRM: [
    "employee", "staff", "headcount", "team", "attendance", "leave", "salary", "payroll",
    "designation", "department", "joining", "onboard", "separation", "hire", "hiring", "resign",
    // HRM → Requests, in the words people use for it.
    "hrm", "request", "approv", "permission", "on duty", "comp off",
  ],
  IMAGE_SELECTION: ["selection", "gallery", "folder", "image", "photo", "upload", "cull", "deliverable", "proof", "archive"],
  ASSET: [
    "asset", "equipment", "camera", "lens", "lighting", "gear", "inspection", "vendor",
    "repair", "maintenance", "assign", "storage", "serial",
  ],
  ACCOUNTS: ["cash", "entry", "entries", "expense", "spent", "received", "payment", "ledger", "account", "reimburse", "petty"],
  PROJECT: ["project", "production", "coordinator", "manager", "deliverable", "schedule", "timeline", "shoot"],
  ADMIN: ["user", "role", "permission", "access", "admin", "branch", "login", "account"],
};

// Compiled once rather than per question, and in the same shape as DOMAIN.
const MODULE_PATTERNS = Object.fromEntries(
  Object.entries(MODULE_DOMAIN).map(([module, words]) => [module, new RegExp(words.join("|"), "i")]),
);

/*
 * Questions about the assistant itself.
 *
 * "Who are you", "what can you do", "can you read my leads" - these are about the tool in front of
 * the person, and refusing them as off-topic is both unhelpful and slightly absurd.
 */
const ABOUT_ITSELF = new RegExp([
  "\\b(who are you|what are you|what can you (do|see|read)|can you|your name|what do you know)\\b",
  "\\bhelp me with\\b",
  /*
   * Questions about the assistant's own capabilities, including its language.
   *
   * "What are the language you know?" was refused as general knowledge - it names nothing in the
   * CRM, so nothing marked it as belonging here. Refusing to say what you can do is a strange thing
   * for an assistant to do, and the reply somebody then got to "Language ?" was "I know Tamil and
   * English", which was both answered and wrong.
   */
  "\\blanguages?\\b",
  "\\b(are|do) you (able|support|understand|speak)\\b",
].join("|"), "i");

/*
 * Scripts this assistant does not read.
 *
 * Nebula works in English. Asked a question in Tamil script it does not fail cleanly - it produces
 * confident nonsense, and on one measured attempt invented a lead count rather than saying it had
 * not understood. A wrong number stated plainly is worse than a refusal, so the refusal is made
 * here rather than left to the model.
 *
 * Script only, and that limit is worth being honest about: Tamil written in English letters cannot
 * be told from English without the language detector this system deliberately no longer carries.
 * Such a question reaches the model and gets an English answer, which is the intended behaviour.
 */
const NON_LATIN_SCRIPT = /[\p{Script=Tamil}\p{Script=Devanagari}\p{Script=Telugu}\p{Script=Malayalam}\p{Script=Kannada}\p{Script=Bengali}\p{Script=Arabic}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Cyrillic}]/u;

/** Whether a question is written in a script this assistant does not read. */
function isUnreadableScript(question) {
  return NON_LATIN_SCRIPT.test(String(question || ""));
}

/** Said plainly, in English, because that is the language being asked for. */
function unreadableScriptReply() {
  return "I work in English only. Please ask your question in English and I can help.";
}

/**
 * Whether a question is outside the studio's work and this module's subject.
 *
 * Deliberately generous: refusing a real question is worse than answering a stray one. A question is
 * in scope if it touches the studio's work at all, names this module's own subject, refers to a
 * person the records know about, or asks about the assistant itself.
 */
function isOutOfScope(question, { module } = {}) {
  const asked = String(question || "").trim();
  if (!asked) return false;
  // Too short to judge, and a greeting or a one-word follow-up is handled before this anyway.
  if (asked.split(/\s+/).filter(Boolean).length < 3) return false;
  if (DOMAIN.test(asked) || ABOUT_A_PERSON.test(asked) || ABOUT_ITSELF.test(asked)) return false;

  const own = MODULE_PATTERNS[String(module || "").toUpperCase()];
  return !(own && own.test(asked));
}

/*
 * Said once, in a line, and it offers the way back.
 *
 * A bare refusal reads as a fault in the app. Naming what it does cover turns a dead end into a
 * prompt for the next question.
 */
const REFUSAL = "That is outside the CRM - I only cover this lead and the studio's work. Ask me about the lead, what to say to them, or how to handle a shoot.";

/*
 * What each module says it covers, so the refusal names something useful.
 *
 * "That is outside the CRM" in an Assets session is both wrong and confusing. A refusal that names
 * what this session *does* cover turns a dead end into a prompt for the next question.
 */
const MODULE_SUBJECTS = {
  SALES: "leads, follow-ups and the studio's work",
  HRM: "employees, the team and how the studio is staffed",
  IMAGE_SELECTION: "selection projects and how they are progressing",
  ASSET: "the studio's equipment and where it is",
  ACCOUNTS: "cash entries and what has moved",
  PROJECT: "projects and where they have got to",
  ADMIN: "users, roles and access",
};

const GREETINGS = /^(hi+|hey+|hello+|hai+|helo+|yo|good\s*(morning|afternoon|evening)|thanks?|thank\s*you|ok+|okay)[\s!.?]*$/i;

/** Fast, warm greetings without spending a model generation or exposing context. */
function greetingReply(question, module) {
  const asked = String(question || "").trim();
  if (!asked || asked.length > 24 || !GREETINGS.test(asked)) return null;
  const subject = MODULE_SUBJECTS[String(module || "").toUpperCase()] || "the studio's work";
  return `Hello. I can help with ${subject}. What would you like to look at?`;
}

/** The refusal, naming what this session does cover. */
function outOfScopeReply(module) {
  const subject = MODULE_SUBJECTS[String(module || "").toUpperCase()];
  return subject
    ? `That is outside DBS Operations OS - I only cover ${subject}. Ask me about that and I can help.`
    : REFUSAL;
}

module.exports = { isOutOfScope, outOfScopeReply, greetingReply, isUnreadableScript, unreadableScriptReply, DOMAIN, MODULE_DOMAIN, ABOUT_A_PERSON, ABOUT_ITSELF };
