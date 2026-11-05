/**
 * Which vertical a Callyzer call belongs to, and which calls are not leads at all.
 *
 * Two faults, one cause: the webhook turned every delivered call into a lead and set no vertical
 * on any of them. A lead with a blank `vertical` is read as Dum Dum by the tab query, so newborn
 * enquiries, corporate enquiries, a call between two members of staff and an employee ringing home
 * all landed in the wedding board together.
 *
 * Nothing here writes anything. It answers two questions about one call - "is this a lead?" and
 * "whose lead is it?" - so both can be tested against real payload shapes without a database, and
 * so the webhook reads as a filter and a router rather than as a pile of conditions.
 *
 * The signals, in the order they are trusted:
 *
 *   1. A vertical named outright on the call (`branch`, `vertical`), for a sender configured to
 *      send one.
 *   2. The labels and the note the employee put on the call. This is about this call, so it beats
 *      any standing fact about who took it.
 *   3. The employee, through `CALLYZER_EMPLOYEE_VERTICALS`. The studio runs three businesses with
 *      their own CRMs, so who answered usually is the vertical - and in practice most calls carry
 *      no note at all, which makes this the signal that fires.
 *   4. The saved contact name, last and on its own, because "Baby" and "Wedding" are both things
 *      people put in a phonebook next to a name.
 *
 * When nothing answers, the answer is nothing. A guessed vertical is worse than an unassigned one:
 * a wedding lead sitting in Qua Qua is invisible to the people who would have called it back.
 */

const VERTICAL_NAMES = ["Dum Dum", "Qua Qua", "Corp"];

// The spellings a vertical is written in, wherever it is written by hand. The same aliases the
// Google Sheets importer already recognises, including the "Crop" typo, so a value that routes a
// sheet row routes a call the same way.
const VERTICAL_ALIASES = {
  dumdum: "Dum Dum",
  wed: "Dum Dum",
  wedding: "Dum Dum",
  weddings: "Dum Dum",
  quaqua: "Qua Qua",
  qq: "Qua Qua",
  corp: "Corp",
  crop: "Corp",
  corporate: "Corp",
  corporates: "Corp",
};

/*
 * What each vertical's work is called when somebody types it into a call note.
 *
 * Tamil and transliterated words are in deliberately: the notes are written by the CRM staff on
 * their own phones, and "muhurtham" and "seemantham" are what they write. Every entry is matched on
 * word boundaries, which is why "wed" can be listed at all - it is a real shorthand in these notes
 * and it must not match "Wednesday".
 */
const VERTICAL_KEYWORDS = {
  "Dum Dum": [
    "wed", "wedding", "weddings", "marriage", "marriages", "engagement", "engagements", "reception",
    "bride", "bridal", "groom", "muhurtham", "muhurtam", "mahurath", "nikah", "nikkah", "haldi",
    "mehendi", "mehandi", "sangeet", "sangeeth", "save the date", "pre wedding", "prewedding",
    "post wedding", "kalyanam", "thirumanam", "betrothal", "wedding shoot", "candid wedding",
  ],
  "Qua Qua": [
    "newborn", "new born", "baby", "babies", "babys", "infant", "toddler", "maternity", "pregnancy",
    "pregnant", "prenatal", "antenatal", "expecting", "naming ceremony", "namakaran", "namakarana",
    "cradle", "cradle ceremony", "seemantham", "valaikappu", "baby shower", "first birthday",
    "birthday shoot", "milestone shoot", "mother and baby", "edod", "edd", "delivery date",
  ],
  Corp: [
    "corporate", "corporates", "company", "conference", "seminar", "summit", "expo", "exhibition",
    "product shoot", "product shot", "headshot", "headshots", "profile shoot", "annual day",
    "award night", "awards night", "launch event", "team shoot", "office shoot", "factory",
    "industrial", "catalogue", "catalog", "brand shoot", "corporate video", "agm",
  ],
};

/*
 * A call an employee marked as their own.
 *
 * Matched as the whole of a label or the whole of a note, never as a word inside a sentence: "the
 * client will come personally" is a lead, and dropping it because it contains "personal" would be
 * the same class of mistake as filing every lead in Dum Dum.
 */
const PERSONAL_MARKERS = new Set([
  "personal", "personal call", "private", "private call", "family", "family call", "home",
  "own", "own number", "self", "not a lead", "non business", "non-business",
]);

/** Digits only, lowercase, single-spaced - the shape everything here compares in. */
function normalizeText(value) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * The key two numbers are the same person by: the last ten digits.
 *
 * The same rule `phoneMatchKey` uses for leads, restated here rather than imported, because this
 * module must stay free of the database layer to be testable on its own. A number shorter than five
 * digits is nobody in particular and matches nothing.
 */
function phoneKey(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (digits.length >= 10) return digits.slice(-10);
  return digits.length >= 5 ? digits : "";
}

function pickFirst(...values) {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return "";
}

/** Every label on a call, however the sender spells the field, as plain strings. */
function labelsOf(callLog = {}) {
  const raw = [callLog.label, callLog.labels, callLog.tag, callLog.tags, callLog.call_tag, callLog.callTag];
  const out = [];
  for (const item of raw) {
    if (!item) continue;
    if (Array.isArray(item)) {
      for (const entry of item) {
        // Callyzer sends labels as strings; an object with a name is accepted so a richer payload
        // does not silently contribute nothing.
        const text = typeof entry === "string" ? entry : pickFirst(entry?.name, entry?.label, entry?.title);
        if (text) out.push(text);
      }
      continue;
    }
    if (typeof item === "string") out.push(item);
  }
  return out;
}

/** The note the employee typed against the call, under any of the names senders give it. */
function noteOf(callLog = {}) {
  return pickFirst(
    callLog.note, callLog.notes, callLog.remark, callLog.remarks, callLog.comment, callLog.comments,
    callLog.description,
  );
}

/** The client's number as the call reports it, country code and all. */
function clientNumberOf(callLog = {}) {
  return pickFirst(
    callLog.client_number, callLog.clientNumber, callLog.customer_number, callLog.customerNumber,
    callLog.phone, callLog.mobile, callLog.number,
  );
}

function employeeNumberOf(employee = {}, callLog = {}) {
  return pickFirst(employee.emp_number, employee.empNumber, callLog.emp_number, callLog.empNumber);
}

function employeeNameOf(employee = {}, callLog = {}) {
  return pickFirst(employee.emp_name, employee.empName, callLog.emp_name, callLog.empName);
}

/** A vertical named outright, or "" when the value is blank or is not one of the three. */
function verticalFromValue(value) {
  const key = normalizeText(value).replace(/ /g, "");
  return key ? VERTICAL_ALIASES[key] || "" : "";
}

/**
 * The vertical whose words appear most often in a piece of text.
 *
 * Counted rather than first-match, because a note reads "wedding album for the corporate client"
 * often enough that whichever keyword happened to be checked first would decide it. A tie is not a
 * decision, so a tie answers nothing.
 */
function verticalFromText(text) {
  const haystack = ` ${normalizeText(text)} `;
  if (haystack.trim() === "") return "";

  let best = "";
  let bestScore = 0;
  let tied = false;
  for (const name of VERTICAL_NAMES) {
    let score = 0;
    for (const keyword of VERTICAL_KEYWORDS[name]) {
      // Space-delimited on a string that has been reduced to words and single spaces, which is
      // word-boundary matching without a regex per keyword: " wed " does not match " wednesday ".
      if (haystack.includes(` ${keyword} `)) score += 1;
    }
    if (score > bestScore) { best = name; bestScore = score; tied = false; }
    else if (score > 0 && score === bestScore) tied = true;
  }
  return tied ? "" : best;
}

/**
 * `CALLYZER_EMPLOYEE_VERTICALS` read into a lookup.
 *
 *   CALLYZER_EMPLOYEE_VERTICALS="9876500000=Qua Qua, 9876500001=Corp, Priya S=Dum Dum"
 *
 * Numbers and names both, because Callyzer accounts are set up either way and the studio should not
 * have to look up a number to say who works on newborns. Numbers are keyed on their last ten digits
 * so the country code does not have to be written; names are keyed on their normalized form so
 * "Priya S" and "priya  s" are the same person.
 *
 * An entry naming a vertical that does not exist is dropped rather than guessed at - the whole point
 * of this map is that it is exact.
 */
function parseEmployeeVerticals(value) {
  const byNumber = new Map();
  const byName = new Map();
  for (const pair of String(value || "").split(/[,;\n]/)) {
    const [rawKey, ...rest] = pair.split("=");
    const key = String(rawKey || "").trim();
    const vertical = verticalFromValue(rest.join("="));
    if (!key || !vertical) continue;
    const number = phoneKey(key);
    if (number && /^[\d\s+()-]+$/.test(key)) byNumber.set(number, vertical);
    else byName.set(normalizeText(key), vertical);
  }
  return { byNumber, byName };
}

/**
 * A comma-separated list of phone numbers, as match keys.
 *
 * Split on commas, semicolons and line breaks but never on spaces: "+91 80907 12345" is one number
 * written the way people write numbers, and splitting it on whitespace turned it into three
 * fragments, none of which was long enough to match anybody.
 */
function parseNumberList(value) {
  const out = new Set();
  for (const entry of String(value || "").split(/[,;\n]/)) {
    const key = phoneKey(entry);
    if (key) out.add(key);
  }
  return out;
}

/**
 * The routing configuration this server was started with.
 *
 * Read from the environment on every call rather than cached at load, so a `.env` change takes
 * effect on a restart of the process and never on a stale module-level constant - and so a test can
 * pass its own environment in.
 */
function loadRoutingConfig(env = process.env) {
  return {
    employeeVerticals: parseEmployeeVerticals(env.CALLYZER_EMPLOYEE_VERTICALS),
    // Staff numbers beyond the ones Callyzer itself reports, for a colleague whose phone is not
    // tracked but who other staff still ring.
    staffNumbers: parseNumberList(env.CALLYZER_STAFF_NUMBERS),
    // Numbers that are never a lead however they are called: an owner's own second phone, a
    // supplier, the office landline.
    personalNumbers: parseNumberList(env.CALLYZER_IGNORE_NUMBERS),
  };
}

/**
 * The vertical one call belongs to, or "" when nothing in it says.
 *
 * `staffNumbers` is not consulted here - a call that should not be a lead at all is refused by
 * `callFilterReason` before this is ever asked.
 */
function verticalForCall(callLog = {}, employee = {}, config = {}) {
  const named = verticalFromValue(pickFirst(callLog.branch, callLog.vertical, callLog.verticals, callLog.business));
  if (named) return named;

  // The labels and the note together: a label is a deliberate marker and a note is what happened,
  // and both are about this call rather than about whoever took it.
  const fromCall = verticalFromText([...labelsOf(callLog), noteOf(callLog)].join(" "));
  if (fromCall) return fromCall;

  const employeeVerticals = config.employeeVerticals || { byNumber: new Map(), byName: new Map() };
  const byNumber = employeeVerticals.byNumber?.get(phoneKey(employeeNumberOf(employee, callLog)));
  if (byNumber) return byNumber;
  const byName = employeeVerticals.byName?.get(normalizeText(employeeNameOf(employee, callLog)));
  if (byName) return byName;

  // Last, and only on its own: a contact saved as "Anitha wedding" is a real signal, and "Baby" is
  // a real name, so this is asked after everything that cannot be somebody's actual name.
  return verticalFromText(pickFirst(callLog.client_name, callLog.clientName, callLog.contact_name, callLog.contactName));
}

/**
 * Why this call is not a lead, or "" when it is one.
 *
 * Two reasons, both of which were filling the sheet with rows nobody could act on:
 *
 *   "staff"     one member of staff rang another. Callyzer reports it against the caller, so it
 *               arrived as a lead whose name and number were a colleague's.
 *   "personal"  an employee's own call, either marked as such on the call or made to a number the
 *               studio has said is never a lead.
 *
 * A reason rather than a boolean so the webhook can report how many of each it set aside, which is
 * the only way to tell "the filter is working" from "the filter is eating leads" without printing
 * the numbers themselves into a log.
 */
function callFilterReason(callLog = {}, employee = {}, config = {}) {
  const staffNumbers = config.staffNumbers || new Set();
  const personalNumbers = config.personalNumbers || new Set();
  const client = phoneKey(clientNumberOf(callLog));

  // A call with no number on it is not a lead either - there is nobody to ring back.
  if (!client) return "unknown-number";

  // The employee ringing their own phone, and the employee ringing a colleague. The first is not
  // covered by the second when the batch reports only one employee.
  if (client && client === phoneKey(employeeNumberOf(employee, callLog))) return "staff";
  if (staffNumbers.has(client)) return "staff";

  if (personalNumbers.has(client)) return "personal";

  // A label is a deliberate mark, so the word anywhere in one counts.
  for (const label of labelsOf(callLog)) {
    if (PERSONAL_MARKERS.has(normalizeText(label))) return "personal";
  }
  // A note has to be the marker and nothing else. "He will come personally to the studio" is a
  // lead, and reading "personal" out of the middle of a sentence would throw it away.
  if (PERSONAL_MARKERS.has(normalizeText(noteOf(callLog)))) return "personal";

  // An explicit flag, for a sender that sets one.
  if (callLog.is_personal === true || callLog.isPersonal === true || callLog.personal === true) return "personal";

  return "";
}

module.exports = {
  VERTICAL_NAMES,
  VERTICAL_KEYWORDS,
  PERSONAL_MARKERS,
  phoneKey,
  normalizeText,
  labelsOf,
  noteOf,
  clientNumberOf,
  employeeNumberOf,
  verticalFromValue,
  verticalFromText,
  parseEmployeeVerticals,
  parseNumberList,
  loadRoutingConfig,
  verticalForCall,
  callFilterReason,
};
