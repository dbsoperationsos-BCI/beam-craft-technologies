const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const prisma = require("../src/config/db");
const iamService = require("../src/services/iam.service");

/*
 * **Branch reach belongs to the permission, not to the person.**
 *
 * The scenario this exists for, in the studio's own words: somebody holds *CRM Leads across every
 * branch* through one role and *Asset Management in one branch* through another. Those are two
 * statements about two different jobs. Read together as "this person reaches every branch" - which
 * is what one `reachableBranchIds(userId)` did - the wider role silently widened the narrower one,
 * and they got every branch's assets as well.
 *
 * So every question about reach names a `{ module, feature }`, and the answer is the branches of the
 * roles that grant **that**. Two rules follow, both deliberate and both checked below:
 *
 *   * a role that names no branches contributes none - it is not read as "all of them";
 *   * the person's own `user.branch_id` is not added. It used to be, which is what made a
 *     restriction unenforceable: a role saying "branch 2 only" still showed a branch-1 person the
 *     whole of branch 1, so "one branch" was never true for the one branch that mattered most.
 *
 * Somebody narrowed to nothing is not shown nothing: `dataScope` still gives everybody the work
 * their own name is on and their team's. It is the *widening* that the roles alone control.
 */

const STAMP = `${Date.now()}-${Math.round(process.hrtime()[1] / 1000)}`;
const tag = (name) => `BRP-${STAMP}-${name}`;
const F = {};

/** A role granting one permission in the branches named, and nothing else. */
async function roleGranting(name, permissionId, branchIds) {
  const role = await prisma.role.create({ data: { name: tag(name) } });
  await prisma.rolePermission.create({ data: { roleId: role.id, permissionId, accessLevel: "READ_WRITE" } });
  if (branchIds.length) await prisma.roleBranch.createMany({ data: branchIds.map((branchId) => ({ roleId: role.id, branchId })) });
  await prisma.userRole.create({ data: { userId: F.user.id, roleId: role.id } });
  F.roles.push(role.id);
  return role;
}

test.before(async () => {
  F.roles = [];
  F.leadsPermission = await prisma.permission.findFirst({ where: { module: "SALES", feature: "CRM Leads" }, select: { id: true } });
  F.assetPermission = await prisma.permission.findFirst({ where: { module: "ASSET", feature: "Asset Management" }, select: { id: true } });
  assert.ok(F.leadsPermission && F.assetPermission, "the seed no longer has SALES / CRM Leads or ASSET / Asset Management - reseed");

  F.br1 = await prisma.branch.create({ data: { code: tag("B1"), name: `Reach One ${STAMP}` } });
  F.br2 = await prisma.branch.create({ data: { code: tag("B2"), name: `Reach Two ${STAMP}` } });
  F.br3 = await prisma.branch.create({ data: { code: tag("B3"), name: `Reach Three ${STAMP}` } });
  F.user = await prisma.user.create({
    data: {
      name: `Reach ${STAMP}`,
      email: `reach-${STAMP}@test.local`,
      username: `reach-${STAMP}`,
      password: "x",
      role: "EMPLOYEE",
      // Where they sit. Deliberately a branch **no role names**, so the cases below say whether it
      // comes free - and it must not.
      branchId: F.br3.id,
    },
  });

  // The studio's own example: leads everywhere, assets in one branch.
  await roleGranting("leads-all", F.leadsPermission.id, [F.br1.id, F.br2.id, F.br3.id]);
  await roleGranting("assets-one", F.assetPermission.id, [F.br1.id]);
});

test.after(async () => {
  await prisma.userRole.deleteMany({ where: { roleId: { in: F.roles } } });
  await prisma.roleBranch.deleteMany({ where: { roleId: { in: F.roles } } });
  await prisma.rolePermission.deleteMany({ where: { roleId: { in: F.roles } } });
  await prisma.role.deleteMany({ where: { id: { in: F.roles } } });
  await prisma.user.deleteMany({ where: { id: F.user.id } });
  await prisma.branch.deleteMany({ where: { id: { in: [F.br1.id, F.br2.id, F.br3.id] } } });
});

const sorted = (ids) => [...ids].sort((a, b) => a - b);

test("the wide role does not widen the narrow one", async () => {
  // The whole scenario, in two assertions. Leads reach all three branches; assets reach the one the
  // role granting assets names, and no more - though the same person reaches all three for leads.
  const forLeads = await iamService.reachableBranchIds(F.user.id, { module: "SALES", feature: "CRM Leads" });
  assert.deepEqual(sorted(forLeads), sorted([F.br1.id, F.br2.id, F.br3.id]));

  const forAssets = await iamService.reachableBranchIds(F.user.id, { module: "ASSET", feature: "Asset Management" });
  assert.deepEqual(forAssets, [F.br1.id], "the leads role widened the assets one");
});

test("a permission no role grants reaches no branch at all", async () => {
  // Not "every branch". Reach comes from the roles that give the access; where none does, there is
  // nothing to give. The guard is what refuses the screen - this only says where, not whether.
  const forQuotations = await iamService.reachableBranchIds(F.user.id, { module: "SALES", feature: "Quotation Management" });
  assert.deepEqual(forQuotations, []);
});

test("the branch somebody sits in does not come free", async () => {
  /*
   * `F.user` sits in branch three, and the **assets** role names only branch one. Their own branch
   * used to be added to every answer, which is what made a branch restriction unenforceable: a role
   * saying "branch one only" still showed them the whole of branch three.
   */
  const forAssets = await iamService.reachableBranchIds(F.user.id, { module: "ASSET", feature: "Asset Management" });
  assert.equal(forAssets.includes(F.br3.id), false, "the branch they sit in came free");
  assert.equal(await iamService.canAccessBranch(F.user.id, F.br3.id, { module: "ASSET", feature: "Asset Management" }), false);
  // And it is reachable for leads - because a role that grants leads names it, not because they sit there.
  assert.equal(await iamService.canAccessBranch(F.user.id, F.br3.id, { module: "SALES", feature: "CRM Leads" }), true);
});

test("a role holding the permission at DISABLED brings no branches with it", async () => {
  // `DISABLED` is a row saying "explicitly not", so it grants nothing and carries nothing. A role
  // that merely *names* the permission must not widen the screen it refuses.
  const role = await roleGranting("assets-disabled", F.assetPermission.id, [F.br2.id]);
  await prisma.rolePermission.updateMany({ where: { roleId: role.id }, data: { accessLevel: "DISABLED" } });
  const forAssets = await iamService.reachableBranchIds(F.user.id, { module: "ASSET", feature: "Asset Management" });
  assert.deepEqual(forAssets, [F.br1.id], "a DISABLED grant brought its branches along");
});

test("a screen read under either of two permissions reaches the branches of both", async () => {
  // Some screens are opened by any of several permissions - `dataScope.resolve` takes the list - and
  // the branches reachable there are the branches of the roles granting any of them. Passed as the
  // same list the guard was asked about, so the two cannot name different sets.
  const either = await iamService.reachableBranchIds(F.user.id, {
    permissions: [{ module: "ASSET", feature: "Asset Management" }, { module: "SALES", feature: "CRM Leads" }],
  });
  assert.deepEqual(sorted(either), sorted([F.br1.id, F.br2.id, F.br3.id]));
});

test("asking without naming a permission is refused, not answered widely", () => {
  /*
   * The failure mode this rewrite exists to remove: a caller that forgets to say which permission it
   * means. Answered with the union it would be the old bug again, silently, on a read - so it throws
   * instead, and `{ anyRole: true }` is how the two callers that really do mean "anywhere at all"
   * say so out loud.
   */
  return assert.rejects(
    () => iamService.reachableBranchIds(F.user.id, {}),
    /needs the \{ module, feature \}/,
  );
});

test("every call site names the permission it is asking about", () => {
  /*
   * Source text, because this is the part that rots: a new module calling the branch API without a
   * scope would throw at runtime on a path nobody exercises until somebody in two branches opens
   * that screen. The three that pass `anyRole` are listed by name so adding a fourth is a decision
   * somebody takes here rather than an omission nobody notices.
   */
  const root = path.join(__dirname, "..", "src");
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".js") && full !== path.join(root, "services", "iam.service.js")) files.push(full);
    }
  };
  walk(root);

  /*
   * The arguments are read by **balancing parentheses** from the call's opening bracket rather than
   * by a regex ending at the first `)`. A call carrying a nested one - `parseInt(branchId)` - or
   * spread over several lines truncates otherwise, and the scan then reports a call site that is
   * perfectly correct. A checker that cries wolf is one somebody switches off.
   */
  const CALL = /iamService\.(reachableBranchIds|reachableBranches|buildBranchFilter|canAccessBranch|canUseBranchId|canUseBranchName)\(/g;
  const argsAt = (source, openIndex) => {
    let depth = 0;
    for (let i = openIndex; i < source.length; i += 1) {
      if (source[i] === "(") depth += 1;
      else if (source[i] === ")") {
        depth -= 1;
        if (depth === 0) return source.slice(openIndex + 1, i);
      }
    }
    return source.slice(openIndex + 1);
  };

  const unscoped = [];
  for (const file of files) {
    const source = fs.readFileSync(file, "utf8");
    for (const match of source.matchAll(CALL)) {
      const args = argsAt(source, match.index + match[0].length - 1).trim();
      /*
       * "Names a permission" in any of the forms the codebase uses: an inline `module:` or a
       * `permissions:` list, a named constant passed whole or spread into an object literal, a
       * `scope` threaded down from a caller, or the deliberate `anyRole`. A call satisfying none of
       * these is the one that throws at runtime, on a path nobody exercises until somebody in two
       * branches opens that screen.
       */
      const named = /module:|permissions:|anyRole|scope|\.\.\.[A-Z_]/.test(args)
        || /,\s*[A-Z][A-Za-z0-9_]*\s*$/.test(args);
      if (!named) unscoped.push(`${path.relative(root, file)}: ${match[0]}${args.split("\n")[0].slice(0, 70)}`);
    }
  }
  assert.deepEqual(unscoped, [], `these ask about branch reach without naming a permission:\n${unscoped.join("\n")}`);
});
