const prisma = require("../config/db");
const { lookups: referenceLookups, norm } = require("./referenceMatchers");
const { splitCsv } = require("./nameCopies");

/**
 * The references that belong beside an employee's master-data text, and how they are kept in step.
 *
 * ── Why ──
 *
 * The employee form offers twelve lists - designation, department, skills, work type, gender,
 * blood group, marital status, emergency-contact relationship, work location, languages, vertical,
 * employee status - and stored every answer as the **words**: `designation = "Team Leader"`,
 * `department = "Sales, Accounts"`, `skills = "Photography, Editing"`. The lists themselves are
 * tables with ids. Nothing joined the two, so "everyone in Sales" was a `contains` over free text
 * that also found "Sales Support", a renamed list entry had to be chased through every row by text
 * (`renameUsage`), and a department could never be counted, grouped or indexed except by its
 * spelling.
 *
 * This is the same move the data-scope work made for branch and vertical (DATA-SCOPE.md D2, D6):
 * put the reference **beside** the text, derive it on every write, backfill it once, and leave the
 * text as what the API carries and the screens print until the readers move. The single-valued
 * answers become `*_id` columns on the employee; the three lists somebody holds several of -
 * department, skills, languages - become rows of `employee_department`, `employee_skill` and
 * `employee_language`, because a comma-separated column is the one shape a database cannot ask a
 * question of.
 *
 * ── The rule ──
 *
 * A text answer is matched to the list's row whose name folds to the same thing (`norm`: trimmed,
 * lower-cased, whitespace collapsed). Exactly one row must match: two entries spelt the same are
 * ambiguous and resolve to NULL rather than to whichever the database returned first, the way
 * `referenceMatchers` treats two employees with one name. Inactive rows still match, so a person
 * filed under an entry the studio has since disabled keeps their reference. Text naming nothing on
 * the list is left as text with a NULL reference, which is also what the match report would show.
 *
 * Only what a save actually carries is resolved: a patch that does not mention the designation must
 * not blank the reference beside it, so a key absent from `data` is absent from the answer - the
 * same contract `referenceColumnsFor` has always had for the vertical and the branch, both of which
 * now live here too.
 */

/** [text column, reference column, list model] for the answers an employee holds one of. */
const SINGLE_REFERENCES = [
  ["designation", "designationId", "designation"],
  ["workType", "workTypeId", "workType"],
  ["gender", "genderId", "gender"],
  ["bloodGroup", "bloodGroupId", "bloodGroup"],
  ["maritalStatus", "maritalStatusId", "maritalStatus"],
  ["emergencyContactRelationship", "emergencyContactRelationshipId", "emergencyContactRelationship"],
  ["workBaseLocation", "workBaseLocationId", "workLocation"],
  ["currentWorkLocation", "currentWorkLocationId", "workLocation"],
];

/** [text column, junction model, junction reference column, list model] for the answers held several of. */
const LIST_REFERENCES = [
  ["department", "employeeDepartment", "departmentId", "department"],
  ["skills", "employeeSkill", "skillId", "skill"],
  ["languagesKnown", "employeeLanguage", "languageId", "language"],
];

const LIST_MODELS = [...new Set([...SINGLE_REFERENCES.map((r) => r[2]), ...LIST_REFERENCES.map((r) => r[3])])];

const CACHE_MS = 5000;
let cached = null;

/** `folded name -> id`, with a name two rows share mapped to null so it can never be guessed. */
function matcherFor(rows) {
  const byName = new Map();
  for (const row of rows) {
    const key = norm(row.name);
    if (!key) continue;
    byName.set(key, byName.has(key) ? null : row.id);
  }
  return (value) => {
    const key = norm(value);
    return key ? byName.get(key) ?? null : null;
  };
}

async function load() {
  const entries = await Promise.all(LIST_MODELS.map(async (model) => [model, matcherFor(await prisma[model].findMany({ select: { id: true, name: true } }))]));
  return Object.fromEntries(entries);
}

/** The matchers, cached briefly: an import resolves the same twelve lists for every row. */
async function matchers({ fresh = false } = {}) {
  if (!fresh && cached && Date.now() - cached.at < CACHE_MS) return cached.value;
  const value = await load();
  cached = { at: Date.now(), value };
  return value;
}

/** Forgets the cached lists, for Field Settings after it has added, renamed or removed an entry. */
function invalidate() { cached = null; }

/**
 * The reference columns to write beside the text in `data`, for the keys `data` actually carries.
 *
 * Includes the vertical and the branch, which used to be resolved by `referenceColumnsFor` in the
 * employees controller: the branch is the work base, falling back to where the person is currently
 * working - the rule the data-scope backfill applied and `data-scope-backfill.test.js` holds the
 * table to.
 */
async function referenceColumns(data = {}) {
  const columns = {};
  const match = await matchers();
  for (const [text, reference, model] of SINGLE_REFERENCES) {
    if (data[text] !== undefined) columns[reference] = match[model](data[text]);
  }
  const refs = await referenceLookups();
  if (data.vertical !== undefined) columns.verticalId = refs.verticalId(data.vertical);
  if (data.workBaseLocation !== undefined || data.currentWorkLocation !== undefined) {
    columns.branchId = refs.branchId(data.workBaseLocation) ?? refs.branchId(data.currentWorkLocation);
  }
  return columns;
}

/** The ids a ", "-joined answer names, each once, in the order written; names matching nothing are dropped. */
async function listIds(model, text) {
  const match = (await matchers())[model];
  return [...new Set(splitCsv(text).map(match).filter(Boolean))];
}

/**
 * Replaces the employee's department, skill and language rows with what `data` says - for the
 * lists `data` mentions, and only those. Runs inside the caller's transaction, beside the write of
 * the text it mirrors, so the two cannot disagree.
 */
async function syncLists(tx, employeeId, data = {}) {
  for (const [text, junction, reference, model] of LIST_REFERENCES) {
    if (data[text] === undefined) continue;
    const ids = await listIds(model, data[text]);
    await tx[junction].deleteMany({ where: { employeeId } });
    if (ids.length) await tx[junction].createMany({ data: ids.map((id) => ({ employeeId, [reference]: id })), skipDuplicates: true });
  }
}

module.exports = { SINGLE_REFERENCES, LIST_REFERENCES, referenceColumns, syncLists, listIds, matchers, invalidate };
