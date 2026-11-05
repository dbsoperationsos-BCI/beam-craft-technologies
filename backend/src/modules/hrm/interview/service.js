const { withUserNames } = require("../../../services/userNames");
const prisma = require("../../../config/db");
const { everyChunk } = require("../../../services/wordChunks");
const { lookups: referenceLookups } = require("../../../services/referenceMatchers");
const { workingEmployeeStatuses, genderNames, listPhotoUrl } = require("../../../services/employeeOptionLists");
const { optionNames } = require("../../../services/optionLists");
const { normalizeDateText, toClockTime } = require("../../sales/crm-leads/leadDates");
// The same number key the sheet importer matches on, so "the same person" means one thing across
// the module rather than one thing per way in.
const { normalizePhone } = require("../../sales/crm-leads/googleSheetsService");
const {
  CANDIDATE_STATUSES,
  DEFAULT_CANDIDATE_STATUS,
  INTERVIEW_MODES,
  EMPLOYMENT_TYPES,
  CANDIDATE_SEQUENCE_KEY,
  formatCandidateCode,
  normalizeCandidateStatus,
  normalizeEmploymentType,
  isKnownStatus,
} = require("./candidates");

/**
 * The candidate register: the rows the Interview screen reads and writes.
 *
 * Small on purpose. A candidate is a record somebody keeps up to date - a stage, an interviewer, a
 * date, a remark - rather than a workflow with verbs, so this is create, read, update, soft delete,
 * and the option lists the form draws its pickers from. Who may do any of it is decided once, by
 * `HRM / Interview` on the router; nothing here reads `req.user.role`.
 *
 * Four things write this table and all of them come through `prepareValues`, so a candidate reads
 * the same on screen whichever way they arrived: Add Application and Bulk Entry on the screen, the
 * CSV import, the public application form (`invites.js`), and the linked Google Sheets
 * (`sheetSyncService.js`, which folds its rows through the same reference lookups).
 */

const httpError = (status, message) => Object.assign(new Error(message), { status });

/** The next `DBS-INTV-000001`, from the same counter table every other generated identifier uses. */
async function nextCandidateCode(client = prisma) {
  const row = await client.appSequence.upsert({
    where: { key: CANDIDATE_SEQUENCE_KEY },
    create: { key: CANDIDATE_SEQUENCE_KEY, currentValue: 1 },
    update: { currentValue: { increment: 1 } },
  });
  return formatCandidateCode(row.currentValue);
}

function parseJson(value, fallback = null) {
  if (!value) return fallback;
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return parsed && typeof parsed === "object" ? parsed : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Which round a candidate is on: how many they have been called for.
 *
 * Derived rather than stored, so a count and the rounds behind it cannot drift apart - which they
 * would the first time anybody corrected a round by hand. A row written before the column existed
 * has no list and reads as **one** round where an interview date is set, which is what it is, and
 * none where it is not.
 */
function roundCount(candidate, rounds) {
  if (rounds.length) return rounds.length;
  return candidate.interviewDate || candidate.interviewTime || candidate.meetLink ? 1 : 0;
}

/** A candidate as the screen reads it: the row, its two lists parsed, and whether its status is one the tab row names. */
function toRow(candidate) {
  if (!candidate) return null;
  const interviewRounds = parseJson(candidate.interviewRounds, []);
  return {
    ...candidate,
    // Why they were selected, held or turned down - one entry per decision, newest last.
    statusNotes: parseJson(candidate.statusNotes, []),
    // Every round they have been called for, and which one that makes the current.
    interviewRounds,
    interviewRound: roundCount(candidate, interviewRounds),
    statusKnown: isKnownStatus(candidate.status),
    customFields: parseJson(candidate.customFields),
    educationEntries: parseJson(candidate.educationEntries, []),
    experienceEntries: parseJson(candidate.experienceEntries, []),
    // A plain array of URL strings rather than rows, so it is parsed with the same guard and given
    // the same empty fallback: a record written before the column existed reads as no list, which
    // with `portfolioUrl` beside it is exactly one link.
    portfolioLinks: parseJson(candidate.portfolioLinks, []),
    // `{ name, url }` rows, parsed with the same guard: a record written before the column existed
    // reads as nothing attached rather than as a string the screen would try to render.
    attachments: parseJson(candidate.attachments, []),
  };
}

const text = (value, max) => {
  const trimmed = String(value ?? "").trim();
  return trimmed ? trimmed.slice(0, max) : null;
};

const dateText = (value) => (value ? normalizeDateText(value).slice(0, 40) : null);

/**
 * The candidate's links as they are stored: up to three non-empty URLs, trimmed, in the order given.
 *
 * Its own serialiser rather than `listJson` below, because these are strings and that one keeps
 * objects - a row of `{ url }` would put a key in the JSON that nothing reads and that the form
 * would have to unwrap on the way back out.
 */
const MAX_PORTFOLIO_LINKS = 3;
function linksJson(value) {
  if (value === undefined) return undefined;
  const links = (Array.isArray(value) ? value : [])
    .map((link) => String(link ?? "").trim().slice(0, 1000))
    .filter(Boolean)
    .slice(0, MAX_PORTFOLIO_LINKS);
  return JSON.stringify(links);
}

/** A repeating list as it is stored: the rows somebody filled in, and nothing the field used to tell them apart. */
function listJson(value) {
  if (value === undefined) return undefined;
  const rows = (Array.isArray(value) ? value : [])
    .filter((row) => row && typeof row === "object")
    .map((row) => Object.fromEntries(Object.entries(row).filter(([key, entry]) => key !== "key" && entry !== null && entry !== undefined && String(entry).trim() !== "")))
    .filter((row) => Object.keys(row).length);
  return JSON.stringify(rows.slice(0, 50));
}

const todayKey = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

/**
 * The columns a form writes, folded the way every other writer folds them: dates to `YYYY-MM-DD`,
 * the interview time to the 12-hour clock the CRM shows, the status and the employment type to the
 * module's own spelling, the branch to the register's spelling with the reference beside it, and
 * the interviewer to a name with the employee id beside it.
 *
 * `partial` writes only what was sent, which is what the public application form and the sheet
 * import need: neither knows the screening fields, and a full write from them would blank the
 * interviewer HR had already chosen.
 */
async function prepareValues(values = {}, { partial = false } = {}) {
  const refs = await referenceLookups();
  const has = (key) => !partial || values[key] !== undefined;
  const data = {};
  const set = (key, value) => { if (has(key)) data[key] = value; };

  if (has("branch")) {
    const branch = refs.branchName(text(values.branch, 120) || "") || text(values.branch, 120);
    data.branch = branch;
    data.branchId = refs.branchId(branch || "");
  }

  if (has("interviewerEmployeeId") || has("interviewer")) {
    let interviewer = text(values.interviewer, 150);
    let interviewerEmployeeId = null;
    if (values.interviewerEmployeeId !== undefined && values.interviewerEmployeeId !== null && values.interviewerEmployeeId !== "") {
      const id = Number(values.interviewerEmployeeId);
      const employee = Number.isInteger(id) && id > 0
        ? await prisma.employee.findUnique({ where: { id }, select: { id: true, employeeName: true } })
        : null;
      if (!employee) throw httpError(400, "That interviewer could not be found.");
      interviewer = employee.employeeName;
      interviewerEmployeeId = employee.id;
    } else if (interviewer) {
      interviewerEmployeeId = refs.employeeId(interviewer);
    }
    data.interviewer = interviewer;
    data.interviewerEmployeeId = interviewerEmployeeId;
  }

  set("name", text(values.name, 191) || "");
  set("phone", text(values.phone, 40));
  set("whatsappNumber", text(values.whatsappNumber, 40));
  set("email", text(values.email, 191)?.toLowerCase() || null);
  set("position", text(values.position, 150));
  set("department", text(values.department, 120));
  set("employmentType", normalizeEmploymentType(values.employmentType) || null);
  set("gender", text(values.gender, 30));
  set("dateOfBirth", dateText(values.dateOfBirth));
  set("address", text(values.address, 5000));
  set("experience", text(values.experience, 60));
  set("currentCompany", text(values.currentCompany, 191));
  set("currentDesignation", text(values.currentDesignation, 150));
  set("currentCtc", text(values.currentCtc, 60));
  set("minExpectedCtc", text(values.minExpectedCtc, 60));
  set("expectedCtc", text(values.expectedCtc, 60));
  set("noticePeriod", text(values.noticePeriod, 60));
  set("availableFrom", dateText(values.availableFrom));
  set("highestQualification", text(values.highestQualification, 191));
  set("skills", text(values.skills, 5000));
  set("languagesKnown", text(values.languagesKnown, 5000));
  set("portfolioUrl", text(values.portfolioUrl, 1000));
  set("city", text(values.city, 120));
  set("state", text(values.state, 120));
  // Where they are from and where they are now - what the screening form asks in place of a state
  // and a postal address. `state` stays beside them because a linked sheet and the CSV still fill it.
  set("nativePlace", text(values.nativePlace, 191));
  set("currentLocation", text(values.currentLocation, 191));
  set("source", text(values.source, 120));
  set("campaignName", text(values.campaignName, 191));
  set("adsetName", text(values.adsetName, 191));
  set("adName", text(values.adName, 191));
  set("referredBy", text(values.referredBy, 191));
  set("howYouKnowUs", text(values.howYouKnowUs, 1000));
  set("aboutUs", text(values.aboutUs, 5000));
  set("resumeUrl", text(values.resumeUrl, 1000));
  set("status", normalizeCandidateStatus(values.status) || DEFAULT_CANDIDATE_STATUS);
  set("interviewDate", dateText(values.interviewDate));
  set("interviewTime", values.interviewTime ? (toClockTime(values.interviewTime) || text(values.interviewTime, 40)) : null);
  set("interviewMode", text(values.interviewMode, 40));
  set("meetLink", text(values.meetLink, 1000));
  set("appliedDate", dateText(values.appliedDate));
  set("lastFollowUpDate", dateText(values.lastFollowUpDate));
  set("nextFollowUpDate", dateText(values.nextFollowUpDate));
  set("remarks", text(values.remarks, 5000));
  /*
   * The links, and the single column that goes on standing for them.
   *
   * `portfolioUrl` is written from the first link whenever a list is given, so the register's table
   * column, the linked sheets and the CSV importer - none of which has anywhere to put three - keep
   * reading the one column they always have. A caller that sends only `portfolioUrl` (HR correcting
   * the record, a sheet, a CSV) is untouched by this and sets it directly above.
   */
  if (has("portfolioLinks")) {
    data.portfolioLinks = linksJson(values.portfolioLinks);
    const first = (Array.isArray(values.portfolioLinks) ? values.portfolioLinks : [])
      .map((link) => String(link ?? "").trim()).find(Boolean) || null;
    data.portfolioUrl = first ? first.slice(0, 1000) : null;
  }
  /*
   * The rounds, and the four flat columns that stand for the latest of them.
   *
   * Written together and only when a list is given: the table, the linked sheets and the CSV
   * importer read the flat columns, so a round scheduled here has to leave them pointing at it.
   * A caller that sends only the flat four - HR correcting a date, a sheet, a CSV - is untouched by
   * this and sets them directly above.
   */
  /*
   * The files a candidate attached. **This was missing**, and the column was the only one the
   * module read back without ever writing: `submitPublicInvite` uploaded every attachment to R2 and
   * handed the rows here, `prepareValues` named no key for them, and they were dropped on the floor
   * - so the submission's files existed in the bucket and on no record.
   */
  if (has("attachments")) data.attachments = listJson(values.attachments);
  if (has("statusNotes")) data.statusNotes = listJson(values.statusNotes);
  if (has("interviewRounds")) {
    data.interviewRounds = listJson(values.interviewRounds);
    const rounds = Array.isArray(values.interviewRounds) ? values.interviewRounds : [];
    const latest = rounds[rounds.length - 1];
    /*
     * Only from a round that actually says something.
     *
     * The four flat columns are what the table, the linked sheets and the CSV importer read, so a
     * round carrying no date, time, mode or link would have blanked all four - turning "schedule
     * the next round" into "erase the interview that is in the diary". A round with nothing in it
     * is still appended, because the count is what Round N means, but it leaves the columns alone.
     */
    const says = latest && [latest.interviewDate, latest.interviewTime, latest.interviewMode, latest.meetLink]
      .some((value) => String(value ?? "").trim());
    if (says) {
      data.interviewDate = dateText(latest.interviewDate);
      data.interviewTime = latest.interviewTime ? (toClockTime(latest.interviewTime) || text(latest.interviewTime, 40)) : null;
      data.interviewMode = text(latest.interviewMode, 40);
      data.meetLink = text(latest.meetLink, 1000);
    }
  }
  if (has("educationEntries")) data.educationEntries = listJson(values.educationEntries);
  if (has("experienceEntries")) data.experienceEntries = listJson(values.experienceEntries);
  return data;
}

/** The register, newest first; `status` narrows it to one stage. */
/**
 * A page of the register, and the counts the tabs are drawn from.
 *
 * It used to answer with the whole table, which was fine while the register was a few hundred
 * candidates and stopped being fine at several thousand: the browser waited on every row before it
 * could draw the first, and then held all of them. A page at a time, the way the CRM lead board
 * reads: `offset` / `limit`, newest first, with `total` so the footer can say how far down the set
 * the reader has got.
 *
 * `counts` is every tab's total - not this page's - because a tab's number describes the register
 * rather than what has been scrolled in so far. Costed as one grouped query rather than one per
 * status, and skipped entirely when a later page is being appended: the set cannot change while
 * somebody scrolls, so counting it again per page is paying repeatedly for the same answer.
 */
const CANDIDATE_PAGE_SIZE = 100;
const CANDIDATE_PAGE_MAX = 500;

/**
 * Every candidate id the given stage matches, for a selection that means "all of them".
 *
 * The register is read a page at a time, so the browser has only ever seen the rows scrolled into
 * view - it cannot hand a bulk action the ids of a selection it never rendered. This answers that:
 * the same `where` the list uses, ids only, and the reader's own exceptions are removed on the
 * other side.
 *
 * Capped, because the answer is held in memory and posted back to a bulk route: a register of two
 * hundred thousand is a different conversation from a bulk action, and one that should fail loudly
 * rather than by silently acting on the first slice.
 */
const SELECT_ALL_MAX = 20000;
async function listCandidateIds({ status = "", filters = {} } = {}) {
  // The same rows the table is showing - a "select all" over a filtered board means the filtered
  // set, not the stage.
  const where = candidateWhere({ status, filters });
  const rows = await prisma.hrmInterviewCandidate.findMany({
    where,
    select: { id: true },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: SELECT_ALL_MAX + 1,
  });
  return { ids: rows.slice(0, SELECT_ALL_MAX).map((row) => row.id), truncated: rows.length > SELECT_ALL_MAX, max: SELECT_ALL_MAX };
}

/**
 * The values one column actually holds, for the filter menu above it.
 *
 * The register is read a page at a time, so a menu built from the rows in the browser offers the
 * values of the hundred scrolled into view - which is a filter that grows as you scroll and hides
 * the very rows you are looking for. This is the question that menu has to ask instead: what does
 * this column hold, across the whole stage?
 *
 * Narrowed by the stage being read, so the menu describes the tab in front of the reader rather
 * than the register. Blank cells are left out - "no value" is not something anybody picks - and the
 * list is capped, because it is drawn as a menu.
 *
 * **The column name is never interpolated.** It is looked up in `FILTERABLE_COLUMNS`, which maps a
 * field the screen may ask about to the Prisma field it means; anything else answers nothing.
 */
/*
 * The free-text columns a filter may narrow by matching part of - a name, a number, an address.
 * They offer no menu, because their values are not a set anybody picks from, but they are still
 * filtered on the server for the reason every other column is: the browser holds one page.
 */
const FILTERABLE_TEXT_COLUMNS = new Set([
  "name", "phone", "whatsappNumber", "email", "candidateCode", "currentCompany", "currentDesignation",
  "currentCtc", "expectedCtc", "minExpectedCtc", "skills", "languagesKnown", "remarks", "aboutUs",
  "address", "interviewTime", "availableFrom", "appliedDate", "interviewDate",
  "lastFollowUpDate", "nextFollowUpDate",
]);

const FILTERABLE_COLUMNS = new Set([
  "position", "department", "branch", "status", "source", "employmentType", "interviewer",
  "interviewMode", "gender", "city", "state", "campaignName", "adsetName", "adName",
  "experience", "noticePeriod", "highestQualification", "referredBy", "howYouKnowUs",
]);
const COLUMN_VALUES_LIMIT = 500;

/**
 * A column filter as Prisma reads it, or null where the column is not one anybody may filter.
 *
 * Two shapes, and the shape is the question. A **list** is what somebody ticked in a menu built
 * from the column's own values, so it is an exact `in`. A **string** is what they typed into the
 * box above a column, so it narrows by matching text - Word Chunk Search: every word typed, in any
 * order, one `contains` per word, which `candidateWhere` adds under `AND`.
 *
 * The register is read a page at a time, which is why this has to exist at all: filtering in the
 * browser filters the hundred rows scrolled into view, so picking a value the column holds but the
 * page does not answered "no records found" over a register that had plenty.
 */
function columnFilterFor(field, raw) {
  if (!FILTERABLE_COLUMNS.has(field) && !FILTERABLE_TEXT_COLUMNS.has(field)) return null;
  if (Array.isArray(raw)) {
    const values = [...new Set(raw.map((entry) => String(entry ?? "").trim()).filter(Boolean))].slice(0, 500);
    // An empty list is no filter, not a filter matching nothing - the same reading the menu gives.
    return values.length ? { in: values } : null;
  }
  const chunks = everyChunk(raw, (chunk) => ({ [field]: { contains: chunk } }));
  return chunks.length ? { AND: chunks } : null;
}

/** The `where` one stage and its column filters come to. */
function candidateWhere({ status = "", filters = {}, exceptColumn = "" } = {}) {
  const where = { deletedAt: null };
  if (status) where.status = status;
  for (const [field, raw] of Object.entries(filters || {})) {
    /*
     * A column's **own** filter is left out of the question its menu asks.
     *
     * Otherwise ticking one value would narrow that menu to the one value ticked, and there would
     * be no way back to the others - which is the difference between a filter that cascades and one
     * that closes behind you.
     */
    if (exceptColumn && field === exceptColumn) continue;
    const clause = columnFilterFor(field, raw);
    if (clause?.AND) where.AND = [...(where.AND || []), ...clause.AND];
    else if (clause) where[field] = clause;
  }
  return where;
}
async function candidateColumnValues({ column = "", status = "", filters = {} } = {}) {
  const field = String(column || "").trim();
  if (!FILTERABLE_COLUMNS.has(field)) return [];
  // Narrowed by every **other** column's filter, so a menu offers what is reachable rather than
  // what exists - picking one of its values can then never answer "no records found".
  /*
   * No `{ [field]: { not: null } }` here, deliberately.
   *
   * It read as a free way to keep an empty column out of the menu, and it threw on the one column
   * that cannot be null: Prisma refuses `not: null` against a required field - "Argument `not` must
   * not be null" - so asking Status for its values was a 500, the page swallowed it, and the Status
   * menu was simply empty. Every other filterable column is nullable, which is why it was the only
   * one.
   *
   * Blanks are dropped below instead, where nulls and the empty strings a spreadsheet import leaves
   * behind are the same thing and both have to go. The cost is at most one wasted row of the cap.
   */
  const where = candidateWhere({ status, filters, exceptColumn: field });
  const rows = await prisma.hrmInterviewCandidate.findMany({
    where,
    select: { [field]: true },
    distinct: [field],
    take: COLUMN_VALUES_LIMIT,
  });
  const seen = new Set();
  for (const row of rows) {
    const value = String(row?.[field] ?? "").trim();
    if (value) seen.add(value);
  }
  return [...seen].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

async function listCandidates({ status = "", offset = 0, limit = CANDIDATE_PAGE_SIZE, withCounts = true, filters = {} } = {}) {
  const where = candidateWhere({ status, filters });
  const size = Math.min(Math.max(Number(limit) || CANDIDATE_PAGE_SIZE, 1), CANDIDATE_PAGE_MAX);
  const start = Math.max(Number(offset) || 0, 0);

  // `total` and `counts` are both skipped while appending, rather than computed and thrown away by
  // the controller: a COUNT over the whole stage on every page is most of what a scroll waits on.
  const [rows, total, grouped] = await Promise.all([
    // `id` breaks the tie: several thousand rows imported by one sync share a `createdAt` to the
    // millisecond, and without a second key MySQL is free to order them differently per page -
    // which shows up as a row appearing twice while another never arrives.
    prisma.hrmInterviewCandidate.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: start, take: size }),
    withCounts ? prisma.hrmInterviewCandidate.count({ where }) : null,
    withCounts ? prisma.hrmInterviewCandidate.groupBy({ by: ["status"], where: { deletedAt: null }, _count: { _all: true } }) : null,
  ]);

  const counts = grouped
    ? grouped.reduce((all, row) => ({ ...all, [String(row.status || "")]: row._count._all }), {})
    : null;

  // Who added each candidate, by name (`services/userNames`).
  return { rows: await withUserNames(rows.map(toRow)), total, counts };
}

async function getCandidate(id) {
  const row = await prisma.hrmInterviewCandidate.findFirst({ where: { id: String(id || ""), deletedAt: null } });
  if (!row) throw httpError(404, "That candidate could not be found.");
  return toRow(row);
}

/* ── The same person, twice ──────────────────────────────────────────────────────────────────── */

const normalizeEmail = (value) => String(value ?? "").trim().toLowerCase();

/**
 * The candidate already on the register who is this same person, or null.
 *
 * Matched on **phone or email**, which is what the sheet importer has always matched on - and on
 * the same normalised keys, so a number typed as `98765 43210` and one stored as `+91 9876543210`
 * are recognised as one person rather than two. A name is deliberately not part of it: two
 * Priya Sharmas are two people, and one person spelling their own name differently on two
 * application forms is still one.
 *
 * Read in two steps because the stored shape is not the match key. The database narrows on the last
 * ten digits - the only part of a formatted number a `contains` can find - and the comparison is
 * then made properly in code. A handful of rows can share those ten digits across dial codes, which
 * is why `take` is more than one and the answer is confirmed rather than assumed.
 *
 * `exceptId` is the row being edited, which must not count as its own duplicate.
 */
async function matchingCandidates(values, client = prisma, exceptId = "") {
  const email = normalizeEmail(values?.email);
  const phone = normalizePhone(values?.phone);
  const digits = String(values?.phone ?? "").replace(/\D/g, "").slice(-10);

  const or = [];
  if (email) or.push({ email });
  if (phone && digits.length === 10) or.push({ phone: { contains: digits } });
  // Neither a number nor an address is nothing to match on. A candidate can be entered from a
  // referral with only a name, and refusing that would be refusing a real record.
  if (!or.length) return [];

  const rows = await client.hrmInterviewCandidate.findMany({
    where: { deletedAt: null, ...(exceptId ? { id: { not: String(exceptId) } } : {}), OR: or },
    select: {
      id: true, candidateCode: true, name: true, phone: true, email: true,
      // Carried for the warning the forms show as a number is typed: "already on the register" is
      // only useful with enough of the record to recognise who it is and what became of them.
      status: true, position: true, appliedDate: true,
    },
    // Newest first, so where somebody has somehow been entered twice already the reply names the
    // record most likely to be the one being worked on.
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 25,
  });

  // Email before phone, the order the screening invite resolves a candidate in: an address is typed
  // once and belongs to one person, where a number can be a household's or an agency's.
  return [
    ...(email ? rows.filter((row) => normalizeEmail(row.email) === email).map((candidate) => ({ candidate, matchedBy: "email" })) : []),
    ...(phone ? rows
      .filter((row) => normalizePhone(row.phone) === phone && !(email && normalizeEmail(row.email) === email))
      .map((candidate) => ({ candidate, matchedBy: "phone number" })) : []),
  ];
}

/**
 * The candidate already on the register who is this same person, or null.
 *
 * The first of `matchingCandidates`, which is the one a refusal names. The two share a definition
 * deliberately: the warning a form shows as a number is typed and the refusal that stops the save
 * have to be answering the same question, or a form warns about something it then accepts, or
 * accepts something it then refuses.
 */
async function findDuplicateCandidate(values, client = prisma, exceptId = "") {
  const [first] = await matchingCandidates(values, client, exceptId);
  return first || null;
}

/** What the studio is told, which has to name the record so they can go and look at it. */
function duplicateMessage({ candidate, matchedBy }) {
  const who = [candidate.name, candidate.candidateCode].filter(Boolean).join(" — ") || "A candidate";
  return `${who} is already on the register with this ${matchedBy}.`;
}

/**
 * The refusal, with the record it is about attached.
 *
 * `code` is what lets a screen tell this apart from an ordinary validation failure, and `data`
 * carries the candidate so the form can name them and offer to open their record. The CRM board
 * refuses a duplicate number the same way, for the same reason: "already on the register" with
 * nothing else leaves somebody hunting a register of thousands for a row they cannot see.
 */
function duplicateError(clash) {
  return Object.assign(new Error(duplicateMessage(clash)), {
    status: 409,
    code: "DUPLICATE_CANDIDATE",
    data: {
      id: clash.candidate.id,
      candidateCode: clash.candidate.candidateCode,
      name: clash.candidate.name || "",
      matchedBy: clash.matchedBy,
    },
  });
}

/*
 * Written once, here, rather than at each way in.
 *
 * Add Application, Bulk Entry and the CSV import are three screens and one function - they all land
 * on `createCandidate` - so the check belongs where they meet. Put at the routes it would have to be
 * written three times and would be missing from the fourth way in somebody adds later.
 *
 * It also covers **within one batch** at no extra cost: Bulk Entry and the CSV import write their
 * rows one at a time and in order, so the second copy of a row is checked against the first, which
 * is by then on the register.
 *
 * The sheet importer does not pass through here - it classifies every row against the register
 * before writing any of them, and reports a repeat rather than failing on it - and the screening
 * invite resolves an existing candidate before it ever asks for a new one. So this is the guard for
 * the three ways in that had none.
 */
async function createCandidate(values, actor, client = prisma) {
  const clash = await findDuplicateCandidate(values, client);
  if (clash) throw duplicateError(clash);
  const data = await prepareValues(values);
  const created = await client.hrmInterviewCandidate.create({
    data: {
      ...data,
      candidateCode: await nextCandidateCode(client),
      // Today, so a candidate typed in with no applied date still files under the day they arrived.
      appliedDate: data.appliedDate || todayKey(),
      addedTime: new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" }),
      createdByUserId: actor?.id ?? null,
    },
  });
  return toRow(created);
}

/**
 * Several candidates written in one sitting - Bulk Entry's batch, as records.
 *
 * One at a time rather than in parallel, because each mints a code from the shared counter and the
 * order they were typed in is the order they should number. A record that fails does not stop the
 * rest: the reply says which rows landed and which did not, by position, the way the CSV import does.
 */
async function createCandidatesBulk(records, actor) {
  const created = [];
  const errors = [];
  for (const [index, record] of (Array.isArray(records) ? records : []).entries()) {
    try {
      created.push(await createCandidate(record, actor));
    } catch (error) {
      errors.push({ position: index + 1, message: error?.message || "This candidate could not be saved." });
    }
  }
  return { created, errors };
}

/**
 * A partial write: only the fields sent are touched. What the public application form and the
 * sheet importer write through, so neither can blank a screening answer HR already gave.
 */
/**
 * One candidate, changed by somebody at the studio - and stamped with the day they changed it.
 *
 * ── Why Last Follow-up is written here rather than asked for ──
 *
 * It was a date box on the Schedule Interview form, which asked HR to tell the register something
 * the register already knew. Worse, it was a box that had to be *remembered*: the honest reading of
 * the column is "the day somebody last worked this candidate", and a field somebody forgets to
 * update says the opposite of the truth rather than nothing at all. So the column is now written
 * from the act itself - saving a candidate **is** working them - and the form no longer asks.
 *
 * **Here, and deliberately not in `prepareValues`.** Three other things write a candidate through
 * that, and none of them is somebody following anybody up:
 *
 *   - the candidate's **own submitted form** (`invites.js` calls `prepareValues` directly), which is
 *     the candidate acting, not the studio;
 *   - the **CSV import** and a **linked sheet**, which fill rows wholesale - stamping there would
 *     put today's date on every candidate in the file and read afterwards as a day HR worked them
 *     all.
 *
 * That distinction is the same one the CRM board draws for its own Last Followup Date, where a
 * posted remark deliberately does not stamp it: a column full of days nobody did anything is worse
 * than an empty one, because it reads as true.
 *
 * Written last, over whatever arrived in the body, so an older tab still posting the field cannot
 * set it to a day of its choosing.
 */
async function updateCandidate(id, values, actor, { partial = false } = {}) {
  const existing = await prisma.hrmInterviewCandidate.findFirst({ where: { id: String(id || ""), deletedAt: null } });
  if (!existing) throw httpError(404, "That candidate could not be found.");
  /*
   * The edit form is the fourth way to end up with two of somebody, and the quietest: guarding only
   * the ways in would leave "enter them again" refused and "enter them wrong, then correct it"
   * allowed.
   *
   * Checked only where the write actually **changes** the number or the address, which is a
   * different rule from "the form posted one". The register already holds duplicates - it was
   * written for months with nothing asking this question - and `exceptId` stops a candidate
   * clashing with itself but not with the second row that already shares its number. Guarding an
   * unchanged value would make both of those rows uneditable, so nobody could open one and correct
   * it, which is the single action that resolves the duplicate. The CRM board draws the line in
   * exactly this place, for exactly this reason.
   */
  const changing = {
    ...(values?.phone !== undefined && normalizePhone(values.phone) !== normalizePhone(existing.phone)
      ? { phone: values.phone } : {}),
    ...(values?.email !== undefined && normalizeEmail(values.email) !== normalizeEmail(existing.email)
      ? { email: values.email } : {}),
  };
  if (changing.phone !== undefined || changing.email !== undefined) {
    const clash = await findDuplicateCandidate(changing, prisma, existing.id);
    if (clash) throw duplicateError(clash);
  }
  const data = await prepareValues(values, { partial });
  const updated = await prisma.hrmInterviewCandidate.update({
    where: { id: existing.id },
    data: { ...data, ...(data.appliedDate === null ? { appliedDate: existing.appliedDate } : {}), lastFollowUpDate: todayKey() },
  });
  void actor;
  return toRow(updated);
}

/**
 * The row goes, rather than being hidden - the same delete a CRM lead gets.
 *
 * It was a soft delete, and the register paid for it twice over. A hidden row still holds the
 * candidate's name, number and email, so a sheet sync went on recognising somebody nobody could
 * see and refusing to re-import them; and `hrm_interview_candidate` grew a permanent shadow of
 * every deletion the studio had ever made, which is what 5,880 invisible rows looked like.
 *
 * Their screening-form invites go with them. An invite names a `candidate_id` and nothing enforces
 * that it exists, so leaving them behind is how View All Invites ends up listing forms against
 * candidates that are gone - the orphans a delete should have taken.
 *
 * What keeps a deleted candidate from being re-imported is now the sheet ledger alone
 * (`hrm_interview_google_sheet_row`), exactly as it is for a lead: the row is remembered, the
 * person is not.
 */
async function deleteCandidate(id) {
  const existing = await prisma.hrmInterviewCandidate.findFirst({ where: { id: String(id || ""), deletedAt: null } });
  if (!existing) throw httpError(404, "That candidate could not be found.");
  await prisma.$transaction([
    prisma.hrmInterviewApplicationInvite.deleteMany({ where: { candidateId: existing.id } }),
    prisma.hrmInterviewCandidate.delete({ where: { id: existing.id } }),
  ]);
  return { id: existing.id, candidateCode: existing.candidateCode, deleted: true };
}

/*
 * How many ids go into one statement. The CRM lead board's own number, and chosen for the same
 * reason: well inside MySQL's placeholder and packet limits, while turning a selection of tens of
 * thousands into a couple of round trips rather than one per row.
 */
const BULK_DELETE_SLICE = 20000;

/**
 * A whole selection deleted together.
 *
 * `deleteCandidate` in a loop is what this replaces, and the loop was the reason the request was
 * capped at 2,000: each candidate cost its own two statements and its own transaction, so a large
 * selection was thousands of round trips and long enough to risk a gateway timeout - which would
 * leave somebody with no idea how much of it had happened.
 *
 * Batched, the work is a handful of statements whatever the size, so the cap can be the CRM's
 * rather than a number that exists to keep the loop short.
 *
 * Answers which ids actually went, because the screen reports it: an id that names no live
 * candidate - already deleted, or never here - is left out of `deletedIds` rather than counted.
 */
async function deleteCandidates(ids = []) {
  const wanted = [...new Set((Array.isArray(ids) ? ids : []).map((id) => String(id || "").trim()).filter(Boolean))];
  if (!wanted.length) return { deletedIds: [], missedIds: [] };

  const deletedIds = [];
  for (let offset = 0; offset < wanted.length; offset += BULK_DELETE_SLICE) {
    const slice = wanted.slice(offset, offset + BULK_DELETE_SLICE);
    /*
     * A slice that fails is reported and the rest still run.
     *
     * The loop this replaced caught per candidate and carried on, so one bad row cost one row. Let
     * a slice throw instead and the whole call becomes a 500 - which the screen reads as "nothing
     * happened" while the slices before it have already committed, leaving somebody to guess how
     * much of their selection went. Its ids stay out of `deletedIds`, so they are reported as not
     * found, which is the honest answer for a row this pass did not remove.
     */
    try {
      // Read first: after the delete there is no way to tell which of the ids asked for were real.
      const live = await prisma.hrmInterviewCandidate.findMany({
        where: { id: { in: slice }, deletedAt: null },
        select: { id: true },
      });
      if (!live.length) continue;
      const liveIds = live.map((row) => row.id);
      // The invites first, in the same transaction: an invite names a `candidate_id` and nothing
      // enforces that it exists, so a failure between the two would leave forms pointing at nobody.
      await prisma.$transaction([
        prisma.hrmInterviewApplicationInvite.deleteMany({ where: { candidateId: { in: liveIds } } }),
        prisma.hrmInterviewCandidate.deleteMany({ where: { id: { in: liveIds } } }),
      ]);
      deletedIds.push(...liveIds);
    } catch (error) {
      console.error(`Unable to delete a slice of ${slice.length} interview candidate(s):`, error?.message || error);
    }
  }

  const gone = new Set(deletedIds);
  return { deletedIds, missedIds: wanted.filter((id) => !gone.has(id)) };
}

/**
 * Who may interview: every working employee, not one department's. Names and ids only, served
 * here rather than from the HR roster endpoint, which answers to a permission an interviewer's
 * screen need not hold.
 */
async function interviewers() {
  const rows = await prisma.employee.findMany({
    where: { archivedAt: null, employmentStatus: { in: await workingEmployeeStatuses() } },
    select: { id: true, employeeId: true, employeeName: true, designation: true, profilePhotoUrl: true },
    orderBy: { employeeName: "asc" },
  });
  return rows.map((row) => ({ ...row, profilePhotoUrl: listPhotoUrl(row.profilePhotoUrl) }));
}

/**
 * The people a Meet can be sent to: every working employee, with the address an invite belongs on.
 *
 * **Not part of `interviewOptions`, deliberately.** That payload is served to anybody who may open
 * the register - `HRM / Interview` Read - and the roster with everyone's work email in it is not
 * something the screen's readers need. Only somebody actually booking an interview needs a guest
 * list, so this is its own route, guarded a notch tighter than the router's default: Read / Write on
 * `HRM / Interview`, which is what scheduling already needs. See `routes.js`.
 *
 * Work address first, because that is the one a meeting invite belongs on; an employee with neither
 * address is left out rather than offered as a guest nobody can invite.
 */
async function meetGuests() {
  const rows = await prisma.employee.findMany({
    where: { archivedAt: null, employmentStatus: { in: await workingEmployeeStatuses() } },
    select: { id: true, employeeId: true, employeeName: true, designation: true, workEmailId: true, emailId: true, profilePhotoUrl: true },
    orderBy: { employeeName: "asc" },
  });
  return rows
    .map((row) => ({
      id: row.id,
      employeeId: row.employeeId,
      name: row.employeeName || row.employeeId || "Employee",
      designation: row.designation || "",
      email: String(row.workEmailId || row.emailId || "").trim(),
      profilePhotoUrl: listPhotoUrl(row.profilePhotoUrl),
    }))
    .filter((row) => row.email);
}

/**
 * What the form's pickers offer. Every list falls back to nothing rather than to an error.
 *
 * `sources` is the studio's own list - `interview_source`, maintained in Settings → Fields →
 * Interview → Sources - and it falls back to **nothing** rather than to an array of the values it
 * used to hold. That is the point of the list existing: a fallback written here would be the
 * hardcoding again, one read failure away from being what the studio is offered. An empty list
 * costs nothing on this screen, because Source is an optional combobox everywhere it is asked - it
 * degrades to a box somebody types into, which is exactly what it was before the list existed.
 */
/** Two option lists as one, in order, without repeating a name that is on both. */
function mergeNames(first = [], second = []) {
  const seen = new Set();
  const merged = [];
  for (const name of [...first, ...second]) {
    const text = String(name || "").trim();
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    merged.push(text);
  }
  return merged;
}

async function interviewOptions() {
  /*
   * No interviewer list. The studio has one HR, so no screen here asks who a candidate is assigned
   * to, and an options payload that still carried the roster would be the employee directory read
   * by anybody who may open the register. `interviewers()` stays exported for the sheet assignment
   * rules, which are the one place a name is still chosen.
   */
  const [departments, designations, branches, genders, sources, extraPositions] = await Promise.all([
    prisma.department.findMany({ where: { isActive: true }, select: { name: true }, orderBy: { name: "asc" } }).catch(() => []),
    prisma.designation.findMany({ where: { isActive: true }, select: { name: true }, orderBy: { name: "asc" } }).catch(() => []),
    prisma.branch.findMany({ where: { isActive: true }, select: { name: true }, orderBy: { name: "asc" } }).catch(() => []),
    genderNames().catch(() => []),
    optionNames("interviewSource", []),
    optionNames("interviewPosition", []),
  ]);
  return {
    departments: departments.map((row) => row.name),
    /*
     * The designations the studio hires for, then the register's own positions after them.
     *
     * Position Applied For is mostly a real role, which is the designation list, already maintained
     * in Settings. What that list cannot hold is a position nobody is ever *employed* as - "General",
     * the answer to a hiring ad naming no role - because a row in `designation` is also a row in
     * every employee's designation picker. Two questions, two lists, merged here so the screen asks
     * once. Deduplicated case-insensitively, so a studio that has since made "General" a designation
     * is not offered it twice.
     *
     * This is the list somebody **picks from** when writing an application down. What the register
     * already *holds* is a different question, asked by the table's own column filter - see
     * `candidateColumnValues`, which reads the column rather than this list.
     */
    positions: mergeNames(designations.map((row) => row.name), extraPositions),
    branches: branches.map((row) => row.name),
    genders,
    statuses: CANDIDATE_STATUSES,
    sources,
    modes: INTERVIEW_MODES,
    employmentTypes: EMPLOYMENT_TYPES,
  };
}

module.exports = {
  // Exported for the test that pins how the two position lists merge.
  mergeNames,
  // Exported for the test that pins which columns can be filtered, and how a filter is read.
  candidateWhere,
  FILTERABLE_COLUMNS,
  FILTERABLE_TEXT_COLUMNS,
  findDuplicateCandidate,
  matchingCandidates,
  duplicateMessage,
  listCandidates,
  listCandidateIds,
  candidateColumnValues,
  getCandidate,
  createCandidate,
  createCandidatesBulk,
  updateCandidate,
  deleteCandidate,
  deleteCandidates,
  interviewOptions,
  interviewers,
  meetGuests,
  nextCandidateCode,
  prepareValues,
  toRow,
};
