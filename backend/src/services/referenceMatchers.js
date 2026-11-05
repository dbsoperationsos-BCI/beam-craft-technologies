/**
 * How a branch, a vertical or an employee written as text is matched to the row it means.
 *
 * One rule, in one place, read by three things that must never disagree: the match report that
 * the backfill was approved from (`scripts/reportDataScopeBackfill.js`), the invariant test that
 * replays every row through it (`test/data-scope-backfill.test.js`), and every write path that
 * keeps a reference column in step with the text beside it (`lookups()` below). The backfill
 * migration (20260906160000) is the same rule in SQL; the test is what holds the two together.
 *
 *   Branch    the branch's full name, case-insensitive and inner spaces folded, with or without
 *             the state keyword the register puts on the end: "Erode TN" and "Erode" are both the
 *             Erode branch. Plus the studio's own nicknames in `BRANCH_ALIASES`, which is one
 *             entry long. Nothing else - "erd", "viza" and "Tel" are not branches, they are
 *             guesses at one.
 *   Vertical  the name, the code, the document code or the identifier code, letters and digits
 *             only; plus the CRM's own spellings - corporate / corporation / crop are Corp,
 *             wedding / weddings are Dum Dum.
 *   Employee  the employee id (DBS001), else their login username (`dhanush.m`) - read off
 *             `Employee.loginUsername`, a mirror of `User.username` kept in step by the two
 *             places that actually set it (see the note on that field in schema.prisma) - else
 *             the full name where exactly one employee has it. A first name alone is nobody; a
 *             name two employees share is ambiguous, not a match. A username cannot be ambiguous
 *             - it is unique in the database - and an employee with no login is only ever reached
 *             by their id or their name.
 *
 * Each matcher answers `{ kind, target? }`: kind is "exact", "without-state", "alias",
 * "employee-id", "username", "blank", "unmatched" or "ambiguous", and only the first five carry a
 * target.
 */
const prisma = require("../config/db");

const norm = (value) => String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
const squash = (value) => norm(value).replace(/[^a-z0-9]/g, "");

/**
 * Branch: the full name, with or without the state keyword the register ends it with.
 *
 * The register writes a branch as its place and its state - `Erode TN`, `Visakhapatnam AP` - while
 * the CRM's Nearest Branch column and the quotation's source branch have always been typed as the
 * place alone. Both are the branch, so both match: `Erode TN` exactly, and `Erode` as the same name
 * with its last word dropped.
 *
 * **And nothing shorter, except one nickname.** `erd`, `viza`, `Tel` are guesses at a branch rather
 * than a way of writing one, and a matcher that accepted them would be filing records against a
 * branch nobody named. `Vizag` is the exception, and it is worth being honest about why it is one:
 * it is not a shortening of `Visakhapatnam AP`, it is what the studio calls that branch, out loud
 * and in every file it exports - 3,667 leads had been typed that way by the time this was counted.
 * A rule that refuses the name the people using it actually say is a rule that leaves thousands of
 * records filed against no branch.
 *
 * This alias was here, was removed on the principle that the rule should read the register and
 * nothing else, and is back by an explicit decision of the studio's. The principle still holds
 * everywhere else, and `BRANCH_ALIASES` is deliberately a short, named, visible list rather than a
 * condition buried in the lookup: a second nickname is a line somebody has to add on purpose, and
 * is a standing invitation to make it a column on the branch instead.
 *
 * It resolves **through the register**, not past it. The alias names a branch by its full name, so
 * a studio that renames or removes `Visakhapatnam AP` gets an alias that matches nothing - not one
 * pointing at a branch that no longer exists.
 *
 * The state keyword is dropped by taking the name's last word off, not by matching a list of states:
 * `Bangalore Karnataka` gives `Bangalore` exactly as `Bangalore KA` does, and a register that writes
 * its branches some third way needs no edit here. A name of one word has nothing to drop.
 *
 * A bare name two branches share is **ambiguous** and matches neither. `Erode TN` and `Erode KA`
 * would both answer to `Erode`, and picking whichever loaded first is how a record ends up filed in
 * the wrong state - so it is refused and the full name has to be given. The two written in full
 * still match, because the full names are distinct.
 */
/*
 * What the studio says, against what the register writes.
 *
 * Keyed and valued in the same normalised form `norm` produces, so the lookup needs no second
 * spelling rule. The value is a branch's **full name** - the alias is resolved against the register
 * below, so it can only ever point at a branch that is actually there.
 */
const BRANCH_ALIASES = new Map([
  ["vizag", "visakhapatnam ap"],
]);

function branchMatcher(branches) {
  const byName = new Map(branches.map((b) => [norm(b.name), b]));

  const withoutState = new Map();
  const shared = new Set();
  for (const b of branches) {
    const words = norm(b.name).split(" ");
    if (words.length < 2) continue;
    const bare = words.slice(0, -1).join(" ");
    // A bare name that is already some other branch's *full* name belongs to that branch: "Erode"
    // matching a branch actually called "Erode" beats it being "Erode TN" with the state dropped.
    if (byName.has(bare)) continue;
    if (withoutState.has(bare)) shared.add(bare);
    withoutState.set(bare, b);
  }

  return (raw) => {
    const key = norm(raw);
    if (!key) return { kind: "blank" };
    if (byName.has(key)) return { kind: "exact", target: byName.get(key) };
    if (shared.has(key)) return { kind: "ambiguous" };
    if (withoutState.has(key)) return { kind: "without-state", target: withoutState.get(key) };
    /*
     * Last, so it can never overrule the register. A branch genuinely called `Vizag`, or one whose
     * bare name is `Vizag`, is matched by the two rules above and the alias is never reached - which
     * is what stops a line in this file quietly redirecting a branch the studio has since created.
     */
    const aliased = BRANCH_ALIASES.get(key);
    if (aliased && byName.has(aliased)) return { kind: "alias", target: byName.get(aliased) };
    return { kind: "unmatched" };
  };
}

/** Vertical: the name (Dum Dum), the document code (WED) or the identifier code (DD), whatever the column holds. */
function verticalMatcher(verticals) {
  const index = new Map();
  for (const v of verticals) {
    for (const key of [v.name, v.code, v.documentCode, v.identifierCode]) if (key) index.set(squash(key), v);
  }
  // The CRM's own spellings, folded the way VERTICAL_SQL folds them.
  const alias = { corporate: "corp", corporation: "corp", wedding: "wed", weddings: "wed", crop: "corp" };
  return (raw) => {
    const key = squash(raw);
    if (!key) return { kind: "blank" };
    if (index.has(key)) return { kind: "exact", target: index.get(key) };
    if (alias[key] && index.has(alias[key])) return { kind: "alias", target: index.get(alias[key]) };
    return { kind: "unmatched" };
  };
}

/**
 * Owner: an employee's id, their login username, or their full name, exactly; never a first name
 * alone. `loginUsername` is read straight off the employee row - `Employee.loginUsername` mirrors
 * `User.username` the moment an account is created or its username changes, so this needs no join
 * to `User` the way it once did. Checked ahead of a name and behind the employee id: a username is
 * a unique column in the database, so unlike a name it can never be ambiguous, but the employee id
 * is the one code the studio already treats as authoritative for this table (`DBS001`) and wins
 * where a value happens to read as both.
 */
function employeeMatcher(employees) {
  const byName = new Map();
  const ambiguous = new Set();
  for (const e of employees) {
    const key = norm(e.employeeName);
    if (byName.has(key)) ambiguous.add(key);
    byName.set(key, e);
  }
  const byCode = new Map(employees.map((e) => [norm(e.employeeId), e]));
  const byUsername = new Map(employees.filter((e) => e.loginUsername).map((e) => [norm(e.loginUsername), e]));
  return (raw) => {
    const key = norm(raw);
    if (!key) return { kind: "blank" };
    if (byCode.has(key)) return { kind: "employee-id", target: byCode.get(key) };
    if (byUsername.has(key)) return { kind: "username", target: byUsername.get(key) };
    if (ambiguous.has(key)) return { kind: "ambiguous" };
    if (byName.has(key)) return { kind: "exact", target: byName.get(key) };
    return { kind: "unmatched" };
  };
}


/**
 * The matchers over the tables as they stand, for a write path: `branchId("Erode")` is the id to
 * store beside the text, or null. The three tables are small and change rarely, and a sheet sync or
 * a bulk import asks per row, so the answer is kept for a few seconds; `fresh: true` reads again,
 * and `invalidate()` forgets it for a caller that has just added a row to one of them.
 */
const CACHE_MS = 5000;
let cached = null;

async function lookups({ fresh = false } = {}) {
  if (!fresh && cached && Date.now() - cached.at < CACHE_MS) return cached.value;
  const value = await load();
  cached = { at: Date.now(), value };
  return value;
}

/** Forgets the cached tables, for a caller that has just added a branch, a vertical or an employee. */
function invalidate() { cached = null; }

async function load() {
  const [branches, verticals, employees] = await Promise.all([
    prisma.branch.findMany({ select: { id: true, name: true, code: true } }),
    prisma.vertical.findMany({ select: { id: true, name: true, code: true, documentCode: true, identifierCode: true } }),
    prisma.employee.findMany({ select: { id: true, employeeId: true, employeeName: true, loginUsername: true } }),
  ]);
  const branch = branchMatcher(branches);
  const vertical = verticalMatcher(verticals);
  const employee = employeeMatcher(employees);
  const idOf = (match) => (value) => match(value).target?.id ?? null;
  /*
   * The branch **name** to store beside that id: the studio's own spelling of whatever the text
   * meant. `"Erode"` from a CSV's Nearest Branch column is `"Erode TN"`, because that is what the
   * branch is called in the register the pickers are built from.
   *
   * It matters because the text is not only a label. Assigned Branch in the lead popup and in Add
   * Lead is a picker over the branch table, and a lead carrying the file's own spelling matched no
   * option in it - so a row the matcher had happily filed under the right `branch_id` showed an
   * empty Assigned Branch on the one screen somebody opens to check it. The reference was right and
   * the thing on screen was not.
   *
   * Text that names no branch is given back exactly as it arrived. A value the studio does not
   * recognise is a value somebody has to look at, and blanking it would hide the one thing that says
   * the file said something unexpected.
   */
  const nameFor = (match) => (value) => match(value).target?.name ?? value;
  return {
    branchId: idOf(branch),
    branchName: nameFor(branch),
    verticalId: idOf(vertical),
    employeeId: idOf(employee),
    branch,
    vertical,
    employee,
  };
}

module.exports = { norm, squash, BRANCH_ALIASES, branchMatcher, verticalMatcher, employeeMatcher, lookups, invalidate };
