const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

/*
 * Vendors → Add Vendor → Business Details: Vendor Type is a multi-select. Several types are stored
 * in the one column joined by ", " - the way an employee's Skills are - and every path that writes or
 * reads it has to agree: the form, the API, the list's type filter, the spreadsheet import, and the
 * Vendor Types master-data list's usage count and rename.
 *
 * The database is stubbed, so this is about what the controller writes and asks for.
 */

const dbPath = require.resolve("../src/config/db");
require(dbPath);
const written = [];
const links = [];
let lastWhere = null;
// The studio's branches: 1 and 2 active, 3 disabled.
const BRANCHES = [{ id: 1, name: "Erode TN", isActive: true }, { id: 2, name: "Coimbatore TN", isActive: true }, { id: 3, name: "Closed KA", isActive: false }];
const db = {
  appSequence: { upsert: async () => ({ currentValue: written.length + 1 }) },
  vendor: {
    create: async ({ data }) => { written.push(data); return { id: written.length, ...data }; },
    findFirst: async () => ({ id: 1, vendorId: "DBS-VNMGMT-1", vendorType: "Photographer", isDeleted: false }),
    update: async ({ data }) => { written.push(data); return { id: 1, ...data }; },
    findMany: async ({ where }) => { lastWhere = where; return []; },
    count: async () => 0,
    groupBy: async () => [],
  },
  branch: {
    findMany: async ({ where }) => BRANCHES.filter((branch) => where.id.in.includes(branch.id) && (where.isActive === undefined || branch.isActive === where.isActive)),
  },
  vendorBranch: {
    deleteMany: async ({ where }) => { for (let i = links.length - 1; i >= 0; i -= 1) if (links[i].vendorId === where.vendorId) links.splice(i, 1); },
    createMany: async ({ data }) => { links.push(...data); },
    findMany: async ({ where }) => links
      .filter((link) => where.vendorId.in.includes(link.vendorId))
      .map((link) => ({ vendorId: link.vendorId, branch: { id: link.branchId, name: BRANCHES.find((branch) => branch.id === link.branchId).name } })),
  },
  user: { findMany: async () => [] },
};
// One client inside and outside a transaction, as the real one is.
db.$transaction = async (work) => work(db);
require.cache[dbPath].exports = db;

const controller = require("../src/modules/assets/vendors.controller");

async function call(handlerName, { body = {}, query = {}, params = {} } = {}) {
  const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(payload) { this.body = payload; return this; } };
  await controller[handlerName]({ body, query, params, user: { id: 1 } }, res);
  return res;
}

test("several types are saved as one tidy comma-joined value", async () => {
  written.length = 0;
  const res = await call("create", { body: { vendorName: "Lens & Light", vendorType: "Photographer,  Editor , Drone Operator" } });
  assert.equal(res.statusCode, 201);
  assert.equal(written[0].vendorType, "Photographer, Editor, Drone Operator");
});

test("a list is taken too, and a type picked twice is kept once, in its first place", async () => {
  written.length = 0;
  await call("create", { body: { vendorName: "Frames", vendorType: ["Editor", "Photographer", "editor"] } });
  assert.equal(written[0].vendorType, "Editor, Photographer");
});

test("one type still works exactly as before", async () => {
  written.length = 0;
  await call("create", { body: { vendorName: "Solo", vendorType: "Printing" } });
  assert.equal(written[0].vendorType, "Printing");
});

test("no type at all is refused, on create and on an edit that empties it", async () => {
  written.length = 0;
  for (const vendorType of ["", " , ", []]) {
    const res = await call("create", { body: { vendorName: "Nobody", vendorType } });
    assert.equal(res.statusCode, 400, `${JSON.stringify(vendorType)} was accepted`);
  }
  const edit = await call("update", { params: { vendorId: "1" }, body: { vendorType: "" } });
  assert.equal(edit.statusCode, 400);
  assert.equal(written.length, 0);
});

test("an edit can change the types without touching anything else", async () => {
  written.length = 0;
  const res = await call("update", { params: { vendorId: "1" }, body: { vendorType: "Photographer, Videographer" } });
  assert.equal(res.statusCode, 200);
  assert.equal(written.at(-1).vendorType, "Photographer, Videographer");
});

test("the list's type filter finds a vendor by any one of its types, as a whole entry", async () => {
  await call("list", { query: { vendorType: "Editor" } });
  const clause = lastWhere.AND[0].OR;
  // Alone, first, last, or in the middle - never `contains` "Editor", which would match "Photo Editor".
  assert.deepEqual(clause, [
    { vendorType: "Editor" },
    { vendorType: { startsWith: "Editor, " } },
    { vendorType: { endsWith: ", Editor" } },
    { vendorType: { contains: ", Editor, " } },
  ]);
  // Beside the search box's words in the same AND, not overwriting them.
  await call("list", { query: { vendorType: "Editor", q: "lens" } });
  assert.equal(lastWhere.AND.length, 2, "the search or the type filter was dropped");
  assert.deepEqual(lastWhere.AND[0].OR, clause, "the type filter was dropped");
  assert.equal(lastWhere.AND[1].OR[1].vendorName.contains, "lens", "the search was dropped");
  // Word Chunk Search: every word typed, any order - one clause per word, still beside the type.
  await call("list", { query: { vendorType: "Editor", q: "studio ravi" } });
  assert.deepEqual(lastWhere.AND.slice(1).map((part) => part.OR[1].vendorName.contains), ["studio", "ravi"]);
});

test("an imported cell holding several types is read as a list", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "assets", "vendors.controller.js"), "utf8");
  assert.match(source, /\{ field: "vendorType", label: "Vendor Type", required: true, parse: asList \}/);
});

test("the Vendor Types list reads vendors entry by entry, for its usage count and its renames", () => {
  const { definitions } = require("../src/modules/hrm/master-data/definitions");
  const vendorTypes = definitions["vendor-types"];
  assert.ok(vendorTypes, "no vendor-types definition");
  assert.deepEqual(vendorTypes.usedBy, [{ model: "vendor", field: "vendorType", match: "csv", label: "vendor" }]);
});

test("a Vendor Type name may not contain a comma, which the vendor column could not tell apart", () => {
  const { definitions } = require("../src/modules/hrm/master-data/definitions");
  const { createSchema, updateSchema } = definitions["vendor-types"];
  assert.equal(createSchema.safeParse({ name: "Lights, Sound" }).success, false);
  assert.equal(updateSchema.safeParse({ name: "Lights, Sound" }).success, false);
  assert.equal(createSchema.safeParse({ name: "Lights and Sound" }).success, true);
  // An update that does not touch the name is not refused by it.
  assert.equal(updateSchema.safeParse({ sortOrder: 3 }).success, true);
  // The other lists are untouched by this rule.
  assert.equal(definitions["storage-shipment-types"].createSchema.safeParse({ name: "Box, Large" }).success, true);
});

/*
 * Capabilities → Supported Branches: branch ids, held as `vendor_branch` rows - never names in a
 * column - and read back through the branch, so a renamed branch shows its new name.
 */
test("supported branches are saved as links to the branches, and read back with their names", async () => {
  written.length = 0; links.length = 0;
  const res = await call("create", { body: { vendorName: "Lens", vendorType: "Photographer", supportedBranchIds: ["2", 1, 2] } });
  assert.equal(res.statusCode, 201);
  // No branch text on the vendor row itself.
  assert.equal("supportedBranchIds" in written[0], false);
  assert.deepEqual(links.map((link) => link.branchId).sort(), [1, 2]);
  // Read back sorted by name, as ids for the form and names for the details panel.
  assert.deepEqual(res.body.data.supportedBranchIds, [2, 1]);
  assert.equal(res.body.data.supportedBranchNames, "Coimbatore TN, Erode TN");
});

test("a branch that is not active, or does not exist, is refused - not dropped", async () => {
  written.length = 0; links.length = 0;
  for (const supportedBranchIds of [[3], [1, 99]]) {
    const res = await call("create", { body: { vendorName: "Lens", vendorType: "Photographer", supportedBranchIds } });
    assert.equal(res.statusCode, 400, `${JSON.stringify(supportedBranchIds)} was accepted`);
  }
  assert.equal(written.length, 0);
  assert.equal(links.length, 0);
});

test("an edit replaces the supported branches when it sends them, and keeps them when it does not", async () => {
  links.length = 0;
  links.push({ vendorId: 1, branchId: 1 });
  await call("update", { params: { vendorId: "1" }, body: { remarks: "Called back" } });
  assert.deepEqual(links, [{ vendorId: 1, branchId: 1 }]);
  await call("update", { params: { vendorId: "1" }, body: { supportedBranchIds: [2] } });
  assert.deepEqual(links, [{ vendorId: 1, branchId: 2 }]);
  await call("update", { params: { vendorId: "1" }, body: { supportedBranchIds: [] } });
  assert.deepEqual(links, []);
});

/*
 * Capabilities → "Can be a production team member?": Yes or No, and No unless somebody says Yes.
 * The form sends true / false; a spreadsheet cell sends the word.
 */
test("the production-team answer is read as Yes or No, from the form or from an imported word", async () => {
  for (const [sent, stored] of [[true, true], [false, false], ["Yes", true], ["no", false], [" Y ", true], ["FALSE", false]]) {
    written.length = 0; links.length = 0;
    const res = await call("create", { body: { vendorName: "Crew", vendorType: "Photographer", canBeProductionTeamMember: sent } });
    assert.equal(res.statusCode, 201, `${JSON.stringify(sent)} was refused`);
    assert.equal(written[0].canBeProductionTeamMember, stored, `${JSON.stringify(sent)} was stored as ${written[0].canBeProductionTeamMember}`);
  }
});

test("a blank answer is not sent at all, so a new vendor gets the column's default, No", async () => {
  for (const sent of ["", null]) {
    written.length = 0; links.length = 0;
    const res = await call("create", { body: { vendorName: "Crew", vendorType: "Photographer", canBeProductionTeamMember: sent } });
    assert.equal(res.statusCode, 201);
    // Left to the database, whose default is false - never written as null into a NOT NULL column.
    // `undefined` is Prisma's "not set", so the column default applies.
    assert.equal(written[0].canBeProductionTeamMember, undefined, `${JSON.stringify(sent)} was written as ${written[0].canBeProductionTeamMember}`);
  }
  const schema = fs.readFileSync(path.join(__dirname, "..", "prisma", "schema.prisma"), "utf8");
  assert.match(schema, /canBeProductionTeamMember Boolean\s+@default\(false\) @map\("can_be_production_team_member"\)/);
});

test("an answer that is not Yes or No is refused rather than guessed", async () => {
  written.length = 0;
  const res = await call("create", { body: { vendorName: "Crew", vendorType: "Photographer", canBeProductionTeamMember: "maybe" } });
  assert.equal(res.statusCode, 400);
  assert.equal(written.length, 0);
});

test("left out of a create it takes the default, and an edit that leaves it out does not reset it", async () => {
  written.length = 0; links.length = 0;
  await call("create", { body: { vendorName: "Crew", vendorType: "Photographer" } });
  assert.equal("canBeProductionTeamMember" in written[0], false);
  written.length = 0;
  await call("update", { params: { vendorId: "1" }, body: { remarks: "Called back" } });
  assert.equal("canBeProductionTeamMember" in written.at(-1), false);
});

test("an import has a column for it", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "assets", "vendors.controller.js"), "utf8");
  assert.match(source, /\{ field: "canBeProductionTeamMember", label: "Can Be a Production Team Member" \}/);
});
