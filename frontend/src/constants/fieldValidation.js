/**
 * The formats the identity, contact and bank fields actually take, in one place, so the public
 * onboarding form and the HR employee form accept and reject exactly the same values. The server
 * checks the same shapes again — this is here to tell someone what is wrong while they are typing
 * it, not to be the only guard.
 */

/** Indian mobile numbers are ten digits starting 6–9. The country code is optional in the input. */
const MOBILE = /^[6-9]\d{9}$/;

export const fieldFormats = {
  email: {
    pattern: /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/,
    message: "Enter a valid email address, for example name@example.com.",
  },
  phone: {
    // Checked against the digits alone, so "+91 98765 43210" and "9876543210" both pass.
    pattern: /^(\d{1,3})?[6-9]\d{9}$/,
    message: "Enter a 10-digit mobile number, optionally with a country code.",
  },
  aadhaar: {
    pattern: /^[2-9]\d{11}$/,
    message: "Aadhar Card Number must be 12 digits and cannot start with 0 or 1.",
  },
  pan: {
    // Five letters, four digits, one letter — ABCDE1234F.
    pattern: /^[A-Z]{5}[0-9]{4}[A-Z]$/,
    message: "PAN must be five letters, four digits, then a letter, for example ABCDE1234F.",
  },
  ifsc: {
    // Four letters for the bank, a fixed 0, then six characters for the branch — SBIN0001234.
    pattern: /^[A-Z]{4}0[A-Z0-9]{6}$/,
    message: "IFSC must be four letters, then 0, then six characters, for example SBIN0001234.",
  },
  accountNumber: {
    pattern: /^\d{9,18}$/,
    message: "Account Number must be between 9 and 18 digits.",
  },
  gstin: {
    // Two digits for the state, the holder's PAN, an entity digit, a fixed Z, then a checksum
    // character — 33ABCDE1234F1Z5. The PAN sits inside it, which is why a branch's GSTIN and its
    // PAN should agree with each other.
    pattern: /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/,
    message: "GSTIN must be 15 characters, for example 33ABCDE1234F1Z5.",
  },
};

/** Phone and Aadhaar are judged on their digits, so spacing and a country code never fail them. */
const valueFor = (kind, value) => {
  const raw = String(value ?? "").trim();
  if (kind === "phone" || kind === "aadhaar" || kind === "accountNumber") return raw.replace(/\D/g, "");
  if (kind === "pan" || kind === "ifsc" || kind === "gstin") return raw.toUpperCase();
  return raw;
};

/** Empty passes: whether a field is required is a separate question from whether it is well formed. */
export function fieldError(kind, value) {
  const format = fieldFormats[kind];
  if (!format) return "";
  const candidate = valueFor(kind, value);
  if (!candidate) return "";
  return format.pattern.test(candidate) ? "" : format.message;
}

export const isValidField = (kind, value) => !fieldError(kind, value);

/** Which format each field name is checked against, shared by both forms. */
export const fieldFormatByName = {
  emailId: "email",
  contactNumber: "phone",
  emergencyContactNumber: "phone",
  reference1PersonPhone: "phone",
  reference2PersonPhone: "phone",
  nominee1PersonPhone: "phone",
  nominee2PersonPhone: "phone",
  aadharCardNumber: "aadhaar",
  panCardNumber: "pan",
  ifscCode: "ifsc",
  accountNumber: "accountNumber",
};

/** Every format problem in a set of values, as `[label, message]`, in the order the fields are listed. */
export function formatErrors(values, labels) {
  return Object.entries(fieldFormatByName)
    .map(([name, kind]) => [name, fieldError(kind, values[name])])
    .filter(([, message]) => message)
    .map(([name, message]) => [labels[name] || name, message]);
}

/*
 * ── Dates of birth ────────────────────────────────────────────────────────────────────────────
 *
 * The studio does not take anybody on under eighteen, so both the public onboarding form and the
 * HR employee form refuse a younger date of birth. The calendar is given `latestDateOfBirth()` as
 * its last selectable day, so the days are never offered in the first place; `dateOfBirthError`
 * is what says why when one arrives another way — a prefilled submission, an imported row, a
 * record typed before this rule existed.
 */
export const MINIMUM_EMPLOYEE_AGE = 18;

const pad = (value) => String(value).padStart(2, "0");

/** A date as the `YYYY-MM-DD` key every date field in the OS stores, in local time. */
const toDateKey = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

/** Whatever a field holds, as a `YYYY-MM-DD` key — or "" if it is not a date at all. */
function dateKeyOf(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  // Already a plain date key: parsed as-is rather than through `Date`, which reads a bare
  // "1998-04-02" as UTC midnight and can hand back the day before in a negative timezone.
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? "" : toDateKey(date);
}

/** Today, as a date key. */
export const todayKey = () => toDateKey(new Date());

/**
 * The most recent birthday that still leaves somebody `minimumAge` today — the last day a date of
 * birth calendar may offer. Read at render time rather than at import, so a tab left open
 * overnight does not keep yesterday's boundary.
 */
export function latestDateOfBirth(minimumAge = MINIMUM_EMPLOYEE_AGE) {
  const today = new Date();
  return toDateKey(new Date(today.getFullYear() - minimumAge, today.getMonth(), today.getDate()));
}

/** Whole years between a date of birth and today, or null if there is no usable date. */
export function ageInYears(value) {
  const key = dateKeyOf(value);
  if (!key) return null;
  const [year, month, day] = key.split("-").map(Number);
  const today = new Date();
  let age = today.getFullYear() - year;
  // The birthday has not come round yet this year, so one of those years has not been lived.
  if (today.getMonth() + 1 < month || (today.getMonth() + 1 === month && today.getDate() < day)) age -= 1;
  return age;
}

/**
 * Why a date of birth cannot be accepted, or "" when it can. Empty passes: whether the field is
 * required is a separate question, the same way `fieldError` treats it.
 */
export function dateOfBirthError(value, { minimumAge = MINIMUM_EMPLOYEE_AGE, label = "Date of Birth" } = {}) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const key = dateKeyOf(raw);
  if (!key) return `Enter a valid ${label.toLowerCase()}.`;
  if (key > todayKey()) return `${label} cannot be in the future.`;
  return key > latestDateOfBirth(minimumAge) ? `Must be at least ${minimumAge} years old — this date of birth is ${ageInYears(key)}.` : "";
}

/** Why a date that can only be in the past is not, or "". Used for a child's date of birth. */
export function pastDateError(value, label = "Date") {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const key = dateKeyOf(raw);
  if (!key) return `Enter a valid ${label.toLowerCase()}.`;
  return key > todayKey() ? `${label} cannot be in the future.` : "";
}

/*
 * ── The repeating detail lists ────────────────────────────────────────────────────────────────
 *
 * Children, qualifications and experience are all lists of the same small form repeated, and all
 * three are judged the same way: a row nobody filled in is not a complaint, and a row somebody
 * started is asked for the parts that make it mean anything. One rule here, three descriptions in
 * `employeeDetailFields`, so a new list costs a description rather than another copy of this.
 */

/** Whether a cell holds an answer. A file field holds a list, so an empty list is no answer. */
const hasAnswer = (value) => Array.isArray(value) ? value.length > 0 : String(value ?? "").trim().length > 0;

/** Whether the whole row is untouched — an "Add" click nobody went on to fill in. */
const isBlankRow = (row, fields) => !fields.some((field) => hasAnswer(row?.[field]));

/**
 * Every problem with a list of rows, keyed by the row it belongs to, as
 * `{ [index]: { [field]: message } }` — the shape `RepeatableDetailsField` draws its messages from.
 *
 * `rules.required` names the cells a started row cannot go without; `rules.checks` maps a cell to a
 * function returning why its value is wrong, or "". A row left entirely blank is skipped: it is
 * dropped on save rather than complained about.
 */
export function detailRowErrors(rows, rules = {}, fieldNames = []) {
  const required = rules.required || [];
  const checks = rules.checks || {};
  // Whatever the caller named, plus everything the rules speak about, so "is this row blank" is
  // asked of every cell the row actually has rather than only the ones with a rule.
  const judged = fieldNames.length ? fieldNames : [...new Set([...required, ...Object.keys(checks)])];
  const problems = {};
  (Array.isArray(rows) ? rows : []).forEach((row, index) => {
    if (isBlankRow(row, judged)) return;
    const found = {};
    required.forEach((field) => { if (!hasAnswer(row?.[field])) found[field] = "Required"; });
    Object.entries(checks).forEach(([field, check]) => {
      if (found[field]) return;
      const message = check(row?.[field], row);
      if (message) found[field] = message;
    });
    if (Object.keys(found).length) problems[index] = found;
  });
  return problems;
}

/**
 * The rows worth storing: the blank ones an "Add" click leaves behind are not, and the `key` each
 * row carries is the field's own bookkeeping rather than anything the record holds.
 */
export function filledRows(rows, fieldNames) {
  return (Array.isArray(rows) ? rows : [])
    .map(({ key, ...row }) => Object.fromEntries(fieldNames.map((field) => [field, typeof row[field] === "string" ? row[field].trim() : row[field] ?? (Array.isArray(row[field]) ? [] : "")])))
    .filter((row) => !isBlankRow(row, fieldNames));
}

/**
 * Children, kept as its own name because both forms and their tests speak of children rather than
 * of rows. Both halves are asked for once a row exists at all — a name with no date of birth is a
 * child somebody started adding and left.
 */
export function childrenErrors(children) {
  return detailRowErrors(children, {
    required: ["name", "dateOfBirth"],
    checks: { dateOfBirth: (value) => pastDateError(value, "Date of Birth") },
  }, ["name", "dateOfBirth"]);
}

/** The children worth storing: the blank rows an "Add Child" click leaves behind are not. */
export function filledChildren(children) {
  return filledRows(children, ["name", "dateOfBirth"]);
}
