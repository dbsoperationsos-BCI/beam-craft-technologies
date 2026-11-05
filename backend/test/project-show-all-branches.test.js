const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

/*
 * `PROJECT / Show All Projects`: the register without the *owner* narrowing, and still with the
 * branch one.
 *
 * The staffed rules leave a real gap - a Yet to Start project is staffed to nobody, because those
 * seats are filled in on the Start Project form rather than the booking form - so a freshly booked
 * project could be started only by a branch administrator. This permission is that job, granted
 * rather than coded.
 *
 * Two things it must not become, and they pull in opposite directions.
 *
 * It must not be "every project in the studio for anybody who holds it" - a role carries a branch
 * list, and that list says how far this reaches. The dangerous case there is the empty list:
 * answering "no narrowing" for a role with no branches would turn the weakest grant in the system
 * into the widest.
 *
 * And it must not **take anything away**. It is added to the scope the person already had, never put
 * in its place: a Project Manager staffed on a project outside their role's branches keeps it, and
 * because `requireProjectEditor`, `requireProjectDeleter` and `requireStartedProjectEditor` all
 * resolve through this same helper, getting that wrong answered **404 on their own project**.
 */

/** The scope a plain reader gets, which every answer below has to still contain. */
const NAMED_ON = { OR: "the data scope's own named-on clause" };

const iam = require("../src/services/iam.service");
const { projectAccessWhere } = require("../src/services/projectScope");

/*
 * Login 1 is described here rather than read from the database: a plain account that opens the
 * register through Sales Manager, so the only thing each test varies is the Show All Projects grant
 * and the branch list stubbed below. Reading it from the database made the answer depend on whoever
 * happened to hold id 1 - a fresh seed's Super Admin, or nobody at all on a restored copy.
 */
const originalUser = iam.getUserWithPermissions;
const originalPermissions = iam.getUserPermissions;
test.before(() => {
  iam.getUserWithPermissions = async (userId) => ({ id: Number(userId), role: "USER" });
  iam.getUserPermissions = async () => [{ module: "SALES", feature: "Sales Manager", accessLevel: "READ_WRITE" }];
});
test.after(() => { iam.getUserWithPermissions = originalUser; iam.getUserPermissions = originalPermissions; });

/** A caller, with the two IAM answers this rule reads stubbed out. */
function caller({ showsAll = true, branchIds = [] } = {}) {
  const originalHas = iam.hasPermission;
  const originalBranches = iam.reachableBranchIds;
  iam.hasPermission = async (userId, module, feature) =>
    (module === "PROJECT" && feature === "Show All Projects" ? showsAll : false);
  iam.reachableBranchIds = async () => branchIds;
  return { restore: () => { iam.hasPermission = originalHas; iam.reachableBranchIds = originalBranches; } };
}

test("a role naming some branches gains those branches' projects, on top of its own", async () => {
  const { restore } = caller({ branchIds: [3, 7] });
  try {
    const where = await projectAccessWhere({ userId: 1 });
    // An OR, not a replacement: what they were named on **plus** the branches they reach.
    assert.ok(Array.isArray(where.OR), "the widening replaced the scope instead of adding to it");
    assert.deepEqual(where.OR[1], { branchId: { in: [3, 7] } });
    assert.ok(where.OR[0] && typeof where.OR[0] === "object", "the named-on scope was dropped");
  } finally { restore(); }
});

test("it never takes a project away from somebody named on it", async () => {
  /*
   * The regression this guards. Replacing the scope meant a Project Manager staffed on a project in
   * a branch their role does not reach lost it from the register - and was answered 404 by every
   * write guard, on their own project. Granting somebody more must not be a way to give them less.
   */
  const { restore } = caller({ branchIds: [3] });
  try {
    const widened = await projectAccessWhere({ userId: 1 });
    restore();
    const plain = await (async () => {
      const undo = caller({ showsAll: false, branchIds: [3] });
      try { return await projectAccessWhere({ userId: 1 }); } finally { undo.restore(); }
    })();
    assert.deepEqual(widened.OR[0], plain, "the widened answer no longer contains the plain one");
  } finally { /* already restored */ }
});

test("a role naming every branch reaches them all, by naming them all", async () => {
  /*
   * Nothing special-cases "all": a list holding every branch matches every project that belongs to
   * one, which is what the studio means by all. Keeping it as the same clause is what stops "all"
   * and "some" being two code paths that could answer differently.
   */
  const { restore } = caller({ branchIds: [1, 2, 3, 4] });
  try {
    const where = await projectAccessWhere({ userId: 1 });
    assert.deepEqual(where.OR[1], { branchId: { in: [1, 2, 3, 4] } });
  } finally { restore(); }
});

test("a role naming no branches gains nothing, and keeps what it had", async () => {
  /*
   * The one that has to fail in the right direction. `{}` here - no narrowing - would hand the whole
   * studio to a role somebody had deliberately given no branches to, which is the exact opposite of
   * what an empty list says. It adds nothing instead, and the person is left with the projects they
   * are named on: an empty branch list is a permission that grants nothing, not one that takes the
   * register away.
   */
  const withEmptyList = await (async () => {
    const undo = caller({ branchIds: [] });
    try { return await projectAccessWhere({ userId: 1 }); } finally { undo.restore(); }
  })();
  const withoutThePermission = await (async () => {
    const undo = caller({ showsAll: false, branchIds: [] });
    try { return await projectAccessWhere({ userId: 1 }); } finally { undo.restore(); }
  })();
  /*
   * Compared against the plain answer rather than against a literal, because what the data scope
   * hands back depends on the login behind it - and what is being asserted is that holding the
   * permission with no branches changes *nothing*, whatever that answer happens to be.
   */
  assert.deepEqual(withEmptyList, withoutThePermission, "an empty branch list changed what the reader sees");
  assert.equal(withEmptyList.OR, undefined, "an empty branch list still widened something");
});

test("a Super Admin is confined to no branch and sees everything", async () => {
  // `reachableBranchIds` answers `null` for them, which is "not confined" rather than "none" - the
  // two are opposite answers and the code has to tell them apart.
  const { restore } = caller({ branchIds: null });
  try {
    assert.deepEqual(await projectAccessWhere({ userId: 1 }), {});
  } finally { restore(); }
});

test("without the permission, the register narrows as it always did", async () => {
  /*
   * The widening is the *only* thing this permission does to the read. Somebody without it falls
   * through to `dataScope.resolve`, which answers by who is named on a project - so this cannot
   * quietly change what everybody else sees.
   */
  const { restore } = caller({ showsAll: false, branchIds: [3] });
  try {
    const where = await projectAccessWhere({ userId: 1 });
    assert.notDeepEqual(where, { branchId: { in: [3] } }, "the branch clause leaked to somebody without the permission");
  } finally { restore(); }
});

test("Read widens what you see; only Read / Write widens what you may touch", async () => {
  /*
   * The escalation this closes, and it was a real one.
   *
   * `projectAccessWhere` is not only the register's list - it is the row filter inside
   * `requireProjectEditor`, `requireProjectDeleter`, `requireStartedProjectEditor` and
   * `saveStartProjectWork`. And `mayEditStartedProject` waves through any project still *Yet to
   * Start*, asking nothing else once the guard has found the row. So while the widening was asked at
   * READ for every caller, putting a project in somebody's **read** scope put it in their **write**
   * scope: a holder of `PROJECT / Projects` `READ_WRITE` plus this permission at **Read** - the one
   * the catalogue describes as "offers nothing else" - could open a freshly booked project they were
   * not staffed to, PATCH their own employee id into `projectManagerEmployeeId`, and then delete it
   * as its Project Manager.
   */
  const asked = [];
  const originalHas = iam.hasPermission;
  const originalBranches = iam.reachableBranchIds;
  iam.hasPermission = async (userId, module, feature, level) => {
    if (module === "PROJECT" && feature === "Show All Projects") { asked.push(level); return level === "READ"; }
    return false;
  };
  iam.reachableBranchIds = async () => [3];
  try {
    // Reading: the Read grant widens, as it is meant to.
    const read = await projectAccessWhere({ userId: 1 });
    assert.ok(Array.isArray(read.OR), "Read no longer widens the register");
    // Writing: the same login, the same grant, and no widening at all.
    const write = await projectAccessWhere({ userId: 1, forWrite: true });
    assert.equal(write.OR, undefined, "a Read-only grant still widens what may be written");
    assert.deepEqual(asked, ["READ", "READ_WRITE"], "the level asked for does not follow what the answer is for");
  } finally {
    iam.hasPermission = originalHas;
    iam.reachableBranchIds = originalBranches;
  }
});

test("the branch list is the application's own reading, not a second one", () => {
  const SOURCE = fs.readFileSync(path.join(__dirname, "..", "src", "services", "projectScope.js"), "utf8");
  /*
   * `reachableBranchIds` is what the data scope and the branch pickers read, so "which branches" is
   * answered by one rule rather than one per screen - **asked of this permission**. Branch reach is
   * per-permission now: the branches of the roles granting `Show All Projects` are what widen the
   * register, not every branch the person reaches through whatever else they hold.
   */
  assert.match(SOURCE, /const branchIds = await iamService\.reachableBranchIds\(userId, SHOW_ALL_PROJECTS\);/);
  assert.match(SOURCE, /if \(branchIds === null\) return \{\};/);
  // Added to the scope, never in place of it - and an empty list adds nothing rather than closing.
  assert.match(SOURCE, /if \(!branchIds\.length\) return scope\.where;/);
  assert.match(SOURCE, /return \{ OR: \[scope\.where, \{ branchId: \{ in: branchIds \} \}\] \};/);
  // Read at READ, because being shown rows is a read; acting on them is asked elsewhere.
  /*
   * The permission carries no level of its own: the level is chosen per call, and that is the whole
   * of the read/write split below.
   */
  assert.match(SOURCE, /const SHOW_ALL_PROJECTS = \{ module: "PROJECT", feature: "Show All Projects" \};/);
});
