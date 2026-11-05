const prisma = require("../config/db");

/**
 * The employee option lists whose *meaning* the code depends on, read from the list itself.
 *
 * Three of the lists Settings → Field Settings maintains are not just words on a form. Which
 * employee statuses mean somebody is working here decides who may be handed an asset, who the CRM
 * lists as a salesperson and who may link a WhatsApp session; which marital statuses ask for a
 * spouse decides what the employee and onboarding forms collect and what the public submission
 * endpoint requires; and the set of genders is what that endpoint validates against.
 *
 * All three used to be written into the code - `["Active", "in Training", "PIP"]` in eight separate
 * files, the literal `"Married"` in four more, and a `z.enum` of three genders - which made the
 * lists editable in name only. Renaming a status dropped people out of the CRM; renaming "Married"
 * stopped the form asking for a spouse; adding a gender was refused on submit. The meaning lives on
 * the row now (`counts_as_working`, `requires_spouse_details`), and this is what reads it.
 *
 * ── Falling back ──
 *
 * Every read falls back to exactly what the code used to say. An empty table means the migration
 * has run but nothing has been seeded, and an unreadable one means the database is having a bad
 * moment; in both cases answering "nobody is working here" would empty the CRM's employee list and
 * refuse every asset handover. The fallback is the old behaviour, so the worst case is what the
 * application did before this existed.
 *
 * ── Cached ──
 *
 * These are read inside `where` clauses on hot paths - the project register, the asset assignment
 * check - so a database round trip per call would be a real cost for a table of seven rows. The
 * cache is small and short, and `forgetEmployeeOptionLists()` empties it the moment Field Settings
 * writes to one of these lists, so an edit is visible immediately rather than within the TTL.
 */

/** What the code said before any of these lists were editable. */
const FALLBACK_WORKING_STATUSES = ["Active", "in Training", "PIP"];
const FALLBACK_SPOUSE_STATUSES = ["Married"];
const FALLBACK_GENDERS = ["Male", "Female", "Other"];
/*
 * The two the candidate is offered rather than the application reasoning about. Blood group is the
 * eight the browser held; languages the seventeen. Both are seeded by
 * `20260910160000_blood_group_and_language_lists`, so these stand in only for a database that has
 * not run it - and then offer exactly what the apply page offered before.
 */
const FALLBACK_BLOOD_GROUPS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];
const FALLBACK_LANGUAGES = [
  "English", "Tamil", "Telugu", "Kannada", "Malayalam", "Hindi", "Marathi", "Bengali", "Gujarati",
  "Punjabi", "Urdu", "Odia", "Assamese", "Sanskrit", "Konkani", "Manipuri", "Nepali",
];

/*
 * The resources read here, so a write to one knows to empty the cache. Three carry meaning the
 * application reads; the other two are only ever offered to a candidate, and are cached for the
 * same reason - the public onboarding page loads them with every invite.
 */
const MEANINGFUL_RESOURCES = new Set(["employee-statuses", "marital-statuses", "genders", "work-types", "emergency-contact-relationships", "blood-groups", "languages"]);

const TTL_MS = 60_000;
const cache = new Map();

/**
 * One list, cached, and never allowed to answer with nothing.
 *
 * A read that throws or comes back empty is not an answer - it is the absence of one - so the
 * fallback stands in and is *not* cached, leaving the next caller to try the database again.
 */
async function names(key, read, fallback) {
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;
  let value;
  try {
    value = await read();
  } catch (error) {
    console.warn(`Unable to read the ${key} list, using what the code used to say:`, error?.message || error);
    return fallback;
  }
  if (!value.length) return fallback;
  cache.set(key, { value, expires: Date.now() + TTL_MS });
  return value;
}

/** The statuses that mean somebody works here, for an `employmentStatus: { in: ... }` clause. */
function workingEmployeeStatuses() {
  return names("employee-statuses", async () => (await prisma.employeeStatus.findMany({
    where: { isActive: true, countsAsWorking: true },
    select: { name: true },
    orderBy: { sortOrder: "asc" },
  })).map((row) => row.name), FALLBACK_WORKING_STATUSES);
}

/** The marital statuses that ask for a spouse name and a wedding anniversary. */
function spouseRequiringMaritalStatuses() {
  return names("marital-statuses", async () => (await prisma.maritalStatus.findMany({
    where: { isActive: true, requiresSpouseDetails: true },
    select: { name: true },
    orderBy: { name: "asc" },
  })).map((row) => row.name), FALLBACK_SPOUSE_STATUSES);
}

/** Whether this answer is one that asks for a spouse. Blank is not, and neither is an unknown one. */
async function asksForSpouseDetails(maritalStatus) {
  const answer = String(maritalStatus || "").trim();
  if (!answer) return false;
  const asking = await spouseRequiringMaritalStatuses();
  return asking.some((name) => name.toLocaleLowerCase() === answer.toLocaleLowerCase());
}

/** Every gender on the list, which is what a submission is checked against. */
function genderNames() {
  return names("genders", async () => (await prisma.gender.findMany({
    where: { isActive: true },
    select: { name: true },
    orderBy: { name: "asc" },
  })).map((row) => row.name), FALLBACK_GENDERS);
}

/** Every entry of one list, for a picker rather than for a rule. */
const listNames = (model, key, fallback) => names(key, async () => (await prisma[model].findMany({
  where: { isActive: true },
  select: { name: true },
  orderBy: { name: "asc" },
})).map((row) => row.name), fallback);

/**
 * The lists the *public* onboarding form offers, served with the invite it loads.
 *
 * A candidate has no session, so the apply page cannot read `/api/hrm/...` the way the employee form
 * does - and leaving it on the arrays compiled into the browser is precisely the drift this whole
 * change is against: HR would edit a work type the candidate is never offered, and the two screens
 * would ask for different things about the same person.
 *
 * `spouseRequiring` travels with the marital statuses because the form needs the meaning as well as
 * the words: it is what decides whether the spouse name and wedding anniversary are shown at all.
 * Each falls back to what the browser used to hold, so a database with these tables empty offers
 * exactly what it offered before.
 */
async function publicOnboardingOptionLists() {
  const [genders, workTypes, maritalStatuses, emergencyContactRelationships, bloodGroups, languages, spouseRequiring] = await Promise.all([
    genderNames(),
    listNames("workType", "work-types", ["Full Time", "Part Time", "Trainee", "Intern"]),
    listNames("maritalStatus", "marital-statuses-all", ["Single", "Married", "Other"]),
    listNames("emergencyContactRelationship", "emergency-contact-relationships",
      ["Father", "Mother", "Spouse", "Brother", "Sister", "Son", "Daughter", "Guardian", "Friend", "Relative", "Other"]),
    listNames("bloodGroup", "blood-groups", FALLBACK_BLOOD_GROUPS),
    listNames("language", "languages", FALLBACK_LANGUAGES),
    spouseRequiringMaritalStatuses(),
  ]);
  return { genders, workTypes, maritalStatuses, emergencyContactRelationships, bloodGroups, languages, spouseRequiringMaritalStatuses: spouseRequiring };
}

/**
 * Field Settings has just written to one of these lists, so what is cached is out of date.
 *
 * Called for every resource rather than only the three, and cheap either way: a write to skills has
 * nothing cached to drop, and a guard here would be one more place to keep in step with the set
 * above.
 */
function forgetEmployeeOptionLists(resource) {
  if (!resource || MEANINGFUL_RESOURCES.has(resource)) cache.clear();
}

/**
 * Does this employee's department include Sales?
 *
 * **An employee holds several departments, joined by ", "** - the form asks for them with the same
 * searchable multi-select `skills` and `languagesKnown` use, and the column is Text for that reason
 * (see `Employee.department` in schema.prisma). Every reader that wanted the Sales roster compared
 * the whole column against "Sales" instead, so anybody carrying a second department - "Sales,
 * Technical", "Management, Sales" - was not a salesperson to any of them. They vanished from the
 * CRM's Assign To, from the project register's CRM picker, and from the WhatsApp roster.
 *
 * Membership of the list, not a substring of it: a department named "Salesforce Admin" is not Sales,
 * and `LIKE '%Sales%'` alone would say it was.
 */
function isSalesDepartment(department) {
  return String(department || "")
    .split(",")
    .some((entry) => entry.trim().toLowerCase() === "sales");
}

/**
 * The Sales department's working employees - the one answer to "who is a CRM".
 *
 * One function rather than the same `where` written in three controllers, which is how the three
 * came to disagree in the first place. `select` is the caller's, so a screen that needs an email
 * asks for one without every other screen carrying it.
 *
 * The department filter cannot be done in SQL alone (see `isSalesDepartment`), so the database
 * narrows with a LIKE and the exact membership test runs over what comes back - a few dozen rows,
 * not the whole roster.
 */
async function salesEmployees({ select } = {}) {
  const rows = await prisma.employee.findMany({
    where: {
      archivedAt: null,
      department: { contains: "Sales" },
      employmentStatus: { in: await workingEmployeeStatuses() },
    },
    select: { ...(select || { id: true, employeeId: true, employeeName: true }), department: true },
    orderBy: { employeeName: "asc" },
  });
  const wanted = rows.filter((row) => isSalesDepartment(row.department));
  // `department` was added to the projection only to filter by; hand it back only if it was asked for.
  if (select && !select.department) return wanted.map(({ department, ...rest }) => rest);
  return wanted;
}

module.exports = {
  publicOnboardingOptionLists,
  isSalesDepartment,
  salesEmployees,
  workingEmployeeStatuses,
  spouseRequiringMaritalStatuses,
  asksForSpouseDetails,
  genderNames,
  forgetEmployeeOptionLists,
  FALLBACK_WORKING_STATUSES,
  FALLBACK_SPOUSE_STATUSES,
  FALLBACK_GENDERS,
  FALLBACK_BLOOD_GROUPS,
  FALLBACK_LANGUAGES,
};
