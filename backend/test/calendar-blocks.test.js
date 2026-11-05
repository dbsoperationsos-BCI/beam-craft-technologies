const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

/*
 * Calendar → a day's ⋮ → Block Period, behind `SALES / Block Period`: a branch's hours on one day held
 * from a start to an end time and why. Two blocks in one branch on one day never overlap, a block is
 * made only in a branch the caller may write in, and one is removed only from such a branch.
 */

const iamService = require("../src/services/iam.service");
const dataScope = require("../src/services/dataScope.service");
const service = require("../src/modules/schedule/blocks/service");
const controller = require("../src/modules/schedule/blocks/controller");
const calendar = require("../src/modules/schedule/calendar/service");

const BRANCHES = [{ id: 1, name: "Erode TN" }, { id: 2, name: "Tiruppur TN" }];

// The caller reaches branches 1 and 2.
function stubAccess(t) {
  t.mock.method(iamService, "reachableBranches", async () => BRANCHES);
  t.mock.method(iamService, "canUseBranchId", async (userId, branchId) => BRANCHES.some((branch) => branch.id === branchId));
  t.mock.method(dataScope, "resolve", async () => ({ where: { branchId: { in: [1, 2] } }, allows: (row) => [1, 2].includes(row.branchId), unlimited: false }));
}

/** An in-memory `calendar_block`: enough of Prisma for the service's reads, writes and overlap check. */
function fakeClient(rows = []) {
  let nextId = rows.length + 1;
  const fits = (value, rule) => {
    if (rule === undefined) return true;
    if (rule instanceof Date) return value.getTime() === rule.getTime();
    if (typeof rule !== "object") return value === rule;
    const comparable = (one) => (one instanceof Date ? one.getTime() : one);
    const v = comparable(value);
    return (!rule.in || rule.in.some((one) => comparable(one) === v)) && (rule.lt === undefined || v < comparable(rule.lt)) && (rule.gt === undefined || v > comparable(rule.gt))
      && (rule.gte === undefined || v >= comparable(rule.gte)) && (rule.lte === undefined || v <= comparable(rule.lte));
  };
  const matches = (row, where) => Object.entries(where).every(([key, rule]) => (key === "AND" ? rule.every((part) => matches(row, part)) : fits(row[key], rule)));
  const shaped = (row) => ({ ...row, branch: BRANCHES.find((branch) => branch.id === row.branchId), createdByUser: { name: "Mukesh" } });
  const client = {
    rows,
    $transaction: async (work, options) => { client.isolation = options?.isolationLevel; return work(client); },
    calendarBlock: {
      findMany: async ({ where }) => rows.filter((row) => matches(row, where)).map(shaped),
      findFirst: async ({ where }) => rows.find((row) => matches(row, where)) || null,
      findUnique: async ({ where }) => rows.find((row) => row.id === where.id) || null,
      create: async ({ data }) => { const row = { id: nextId++, ...data }; rows.push(row); return shaped(row); },
      delete: async ({ where }) => { rows.splice(rows.findIndex((row) => row.id === where.id), 1); },
    },
  };
  return client;
}

const block = (overrides = {}) => ({ userId: 9, branchId: 1, date: "2026-10-14", startTime: "10:00", endTime: "12:30", reason: "Lighting repair", ...overrides });

test("a block may not overlap another in the same branch and day; touching times, other days and other branches may", async (t) => {
  stubAccess(t);
  const client = fakeClient();
  const made = await service.createBlock(block(), client);
  assert.deepEqual(made, { id: 1, branchId: 1, branchName: "Erode TN", date: "2026-10-14", startTime: "10:00", endTime: "12:30", reason: "Lighting repair", createdBy: "Mukesh" });
  await assert.rejects(service.createBlock(block({ startTime: "12:00", endTime: "13:00" }), client), { status: 409, message: /already blocked from 10:00 to 12:30/ });
  await service.createBlock(block({ startTime: "12:30", endTime: "13:00" }), client);
  await service.createBlock(block({ branchId: 2 }), client);
  await service.createBlock(block({ date: "2026-10-15" }), client);
  assert.equal(client.rows.length, 4);
  // The check and the write in one serializable transaction.
  assert.equal(client.isolation, "Serializable");
});

test("a write that loses a race to the same hour is told to try again", async (t) => {
  stubAccess(t);
  const client = fakeClient();
  client.$transaction = async () => { throw Object.assign(new Error("write conflict"), { code: "P2034" }); };
  await assert.rejects(service.createBlock(block(), client), { status: 409, message: /same moment/ });
});

test("the calendar's block source reads the viewer's blocks for the window, as grey day entries", async (t) => {
  const asked = [];
  t.mock.method(service, "listBlocks", async (query) => {
    asked.push(query);
    return [{ id: 4, branchId: 1, branchName: "Erode TN", date: "2026-10-14", startTime: "14:00", endTime: "16:00", reason: "Repair", createdBy: "Mukesh" }];
  });
  const source = calendar.SOURCES.find((one) => one.key === "block");
  const entries = await source.load({ from: new Date("2026-10-01T00:00:00Z"), to: new Date("2026-10-31T00:00:00Z"), viewer: { userId: 9 } });
  assert.deepEqual(asked, [{ userId: 9, from: "2026-10-01", to: "2026-10-31" }]);
  assert.deepEqual(entries[0], {
    branchId: 1, id: "block:4", kind: "block", title: "Repair", reference: "", day: "2026-10-14", startAt: null, endAt: null,
    location: "", owner: "Mukesh", subject: "", meta: { blockId: 4, startTime: "14:00", endTime: "16:00" },
  });
});

test("only in a branch the caller reaches at Read / Write, and only ending after it starts", async (t) => {
  stubAccess(t);
  const client = fakeClient();
  await assert.rejects(service.createBlock(block({ branchId: 5 }), client), { status: 403 });
  await assert.rejects(service.createBlock(block({ startTime: "12:00", endTime: "12:00" }), client), { status: 400 });
  const asked = iamService.canUseBranchId.mock.calls[0].arguments[2];
  assert.deepEqual(asked, { module: "SALES", feature: "Block Period", level: "READ_WRITE" });
});

test("listed in the caller's branches, and removed only from them", async (t) => {
  stubAccess(t);
  const client = fakeClient([
    { id: 1, branchId: 1, blockDate: new Date("2026-10-14T00:00:00Z"), startTime: "10:00", endTime: "11:00", reason: "Repair" },
    { id: 2, branchId: 3, blockDate: new Date("2026-10-14T00:00:00Z"), startTime: "10:00", endTime: "11:00", reason: "Elsewhere" },
    { id: 3, branchId: 2, blockDate: new Date("2026-11-01T00:00:00Z"), startTime: "09:00", endTime: "10:00", reason: "Later" },
  ]);
  const listed = await service.listBlocks({ userId: 9, from: "2026-10-01", to: "2026-10-31" }, client);
  assert.deepEqual(listed.map((one) => one.id), [1]);
  await assert.rejects(service.removeBlock({ userId: 9, id: 2 }, client), { status: 404 });
  await service.removeBlock({ userId: 9, id: 1 }, client);
  assert.deepEqual(client.rows.map((row) => row.id), [2, 3]);
  // Removing asks for the branches the caller may write in.
  assert.equal(dataScope.resolve.mock.calls.at(-1).arguments[0].level, "READ_WRITE");
});

test("the request is checked: a branch, a date, two times of day and a reason", async () => {
  const replies = [];
  const res = { status(code) { replies.push(code); return this; }, json(body) { replies.push(body); return this; } };
  await controller.create({ user: { id: 9 }, body: { branchId: 1, date: "2026-02-31", startTime: "10:00", endTime: "11:00", reason: "x" } }, res);
  assert.equal(replies[0], 400);
  await controller.create({ user: { id: 9 }, body: { branchId: 1, date: "2026-10-14", startTime: "11:00", endTime: "10:00", reason: "x" } }, res);
  assert.match(replies.at(-1).message, /end after it starts/);
  await controller.create({ user: { id: 9 }, body: { branchId: 1, date: "2026-10-14", startTime: "10:00", endTime: "11:00", reason: " " } }, res);
  assert.match(replies.at(-1).message, /Say why/);
  // Nothing the form does not send: a body naming who made it is refused.
  await controller.create({ user: { id: 9 }, body: { branchId: 1, date: "2026-10-14", startTime: "10:00", endTime: "11:00", reason: "x", createdByUserId: 1 } }, res);
  assert.deepEqual([replies.at(-2), typeof replies.at(-1).message], [400, "string"]);
  await controller.remove({ user: { id: 9 }, params: { id: "abc" } }, res);
  assert.equal(replies.at(-2), 400);
});

test("guarded by SALES / Block Period, mounted before the calendar, a calendar source, and the permission ships in a migration", () => {
  const read = (...parts) => fs.readFileSync(path.join(__dirname, "..", ...parts), "utf8");
  const routes = read("src", "modules", "schedule", "blocks", "routes.js");
  assert.ok(routes.indexOf("router.use(protect);") < routes.indexOf('router.use(requireModule("SALES", "Block Period"));'));
  const server = read("src", "server.js");
  assert.ok(server.indexOf('app.use("/api/schedule/blocks", scheduleBlockRoutes);') < server.indexOf('app.use("/api/schedule", scheduleCalendarRoutes);'));
  const source = calendar.SOURCES.find((one) => one.key === "block");
  assert.deepEqual([source.module, source.feature], ["SALES", "Block Period"]);
  const migration = read("prisma", "migrations", "20261014180000_calendar_block", "migration.sql");
  assert.match(migration, /CREATE TABLE `calendar_block`/);
  assert.match(migration, /'SALES', 'Block Period', 'SALES_BLOCK_PERIOD'/);
  assert.match(migration, /WHERE `role`\.`name` = 'SUPER_ADMIN'/);
  assert.match(read("prisma", "seeds", "permission-catalogue.js"), /module: "SALES",\s*feature: "Block Period"/);
});

test("a blocked period is a placeholder: booking a meeting never looks at the blocks", () => {
  const meetings = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "sales", "crm-leads", "meetingService.js"), "utf8");
  assert.doesNotMatch(meetings, /schedule\/blocks|blockDuring|calendarBlock/);
  assert.equal(service.blockDuring, undefined);
});
