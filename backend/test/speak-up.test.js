const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const CONTROLLER = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "hrm", "speak-up", "controller.js"), "utf8");
const ROUTES = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "hrm", "speak-up", "routes.js"), "utf8");

test("the six types are exact and nothing else validates", () => {
  assert.match(CONTROLLER, /const TYPES = \["Team \/ Manager Issue", "HR \/ People", "Work Environment", "Suggestion", "App \/ System Issue", "Other"\];/);
  assert.match(CONTROLLER, /type: z\.enum\(TYPES\)/);
});

test("title and description are required; attachment is optional and nullable", () => {
  assert.match(CONTROLLER, /title: z\.string\(\)\.trim\(\)\.min\(1\)/);
  assert.match(CONTROLLER, /description: z\.string\(\)\.trim\(\)\.min\(1\)/);
  assert.match(CONTROLLER, /attachment: attachmentSchema/);
  assert.match(CONTROLLER, /\}\)\.nullable\(\)\.optional\(\);/);
});

test("the employee is always resolved from the login, never trusted from the body", () => {
  assert.doesNotMatch(CONTROLLER, /req\.body\.employeeId/);
  assert.doesNotMatch(CONTROLLER, /req\.body\?\.employeeId/);
  assert.match(CONTROLLER, /req\.user\?\.linkedEmployeeId/);
});

test("a login with no linked employee is refused rather than writing an unattributed row", () => {
  const fn = CONTROLLER.slice(CONTROLLER.indexOf("async function create("), CONTROLLER.indexOf("\nasync function mine("));
  assert.match(fn, /if \(!employee\) return res\.status\(400\)/);
});

test("create needs Speak-up Read / Write; mine needs Speak-up Read; the review list needs Speak-up Review", () => {
  assert.match(ROUTES, /router\.post\("\/", canSubmit, controller\.create\);/);
  assert.match(ROUTES, /const canSubmit = checkPermission\("HRM", "Speak-up", "READ_WRITE"\);/);
  assert.match(ROUTES, /router\.get\("\/mine", canReadMine, controller\.mine\);/);
  assert.match(ROUTES, /router\.get\("\/", canReview, controller\.all\);/);
  assert.match(ROUTES, /const canReview = checkPermission\("HRM", "Speak-up Review", "READ"\);/);
});

test("a speak-up is decided, never edited - and the only delete is the tick boxes', one path per screen", () => {
  /*
   * No PATCH and no PUT: a Speak-up is answered, not rewritten, and `/:id` has no delete of its own.
   * The two the selection uses are mounted through `mountBulkDelete`, which adds
   * `ADMIN / Table Select All` on top of the guard named here, and both sit **above** `/:id` so
   * "bulk" is never read as an id.
   *
   * Two paths because the two screens are different acts: `/mine/bulk` is taking back your own while
   * it is still pending (`own: true`), `/bulk` is HR clearing a record it has finished with.
   */
  assert.doesNotMatch(ROUTES, /router\.(patch|put)\(/i);
  assert.doesNotMatch(ROUTES, /router\.delete\(/i, "no delete written by hand - both go through mountBulkDelete");
  assert.match(ROUTES, /mountBulkDelete\(router, \{ path: "\/mine\/bulk", guard: canSubmit, deleteOne: \(id, req\) => controller\.deleteSpeakUpRecord\(req, id, \{ own: true \}\)/);
  assert.match(ROUTES, /mountBulkDelete\(router, \{ guard: canDecide, deleteOne: \(id, req\) => controller\.deleteSpeakUpRecord\(req, id\)/);
  const mine = ROUTES.indexOf('path: "/mine/bulk"');
  assert.ok(mine > -1 && mine < ROUTES.indexOf('router.get("/:id/attachment"'), "mounted above the :id routes");
});

test("deciding one, and listing who it can go to, needs Speak-up Review with write", () => {
  assert.match(ROUTES, /const canDecide = checkPermission\("HRM", "Speak-up Review", "READ_WRITE"\);/);
  assert.match(ROUTES, /router\.post\("\/:id\/review", canDecide, controller\.review\);/);
  assert.match(ROUTES, /router\.get\("\/assignees", canDecide, controller\.assignees\);/);
});

test("the attachment endpoint is reachable on either permission, and the controller checks ownership itself", () => {
  assert.match(ROUTES, /const canOpenAttachment = checkAnyPermission\(\[/);
  assert.match(ROUTES, /router\.get\("\/:id\/attachment", canOpenAttachment, controller\.attachment\);/);
  assert.match(CONTROLLER, /const canReviewAll = await iamService\.hasPermission\(req\.user\.id, "HRM", "Speak-up Review", "READ"\);/);
  assert.match(CONTROLLER, /allowed = Boolean\(employee\) && employee\.id === row\.employeeId;/);
});

const { Readable, PassThrough } = require("node:stream");
const prisma = require("../src/config/db");
const iamService = require("../src/services/iam.service");
const objectStorage = require("../src/services/objectStorage");
const { create, mine, all, attachment, review, assignees } = require("../src/modules/hrm/speak-up/controller");
const controller = require("../src/modules/hrm/speak-up/controller");
const { IDENTIFIER_PATTERN, parseIdentifier } = require("../src/services/identifiers");
const tasks = require("../src/modules/hrm/tasks/service");

// Reserved fixture prefix, swept by scripts/clear-test-fixtures.js if a run dies before `t.after`.
const STAMP = `TSU-${Date.now().toString(36)}`;

function fakeRes() {
  const res = { statusCode: 200 };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  return res;
}

/** A writable response that collects what is piped into it, with the Express bits `attachment` uses. */
function streamRes() {
  const res = new PassThrough();
  const chunks = [];
  res.on("data", (chunk) => chunks.push(chunk));
  res.statusCode = 200;
  res.headers = {};
  res.setHeader = (name, value) => { res.headers[name.toLowerCase()] = value; };
  res.attachment = (name) => { res.headers["content-disposition"] = `attachment; filename="${name}"`; };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  res.text = () => Buffer.concat(chunks).toString("utf8");
  return res;
}

/*
 * The two employees these tests write as, made here rather than borrowed from whatever the database
 * already holds. CI builds its database from the migrations and the seed, which has no employees, so
 * a test reading "the first employee" passed on a developer's copy and failed there. Created once,
 * on first use, under the file's own prefix, and removed when the file is done.
 */
let fixtures;
function twoEmployees() {
  fixtures ??= Promise.all(["A", "B"].map((name) => prisma.employee.create({
    // Archived so that no other suite running beside this one - every picker and report that lists
    // the studio's people - counts them; Speak-up finds its author by id alone.
    data: { employeeId: `${STAMP}-${name}`, employeeName: `${STAMP} Employee ${name}`, archivedAt: new Date() },
    select: { id: true },
  })));
  return fixtures;
}
test.after(() => prisma.employee.deleteMany({ where: { employeeId: { startsWith: STAMP } } }));

async function rowWithAttachment(t, ownerId) {
  const created = await prisma.speakUp.create({
    data: { employeeId: ownerId, employeeName: `${STAMP} Owner`, type: "Other", title: `${STAMP} attachment`, description: "y", attachmentKey: "hrm/speak-up/2026/09/test.txt", attachmentFileName: "test.txt" },
  });
  t.after(() => prisma.speakUp.delete({ where: { id: created.id } }));
  return created;
}

test("create writes the caller's own employee id and name; mine and all both find it, without the object key", async (t) => {
  const [employee] = await twoEmployees();
  const req = { user: { linkedEmployeeId: employee.id }, body: { type: "Suggestion", title: `${STAMP} subject`, description: "Test description", attachment: null } };
  const res = fakeRes();
  await create(req, res);
  assert.equal(res.statusCode, 201);
  const createdId = res.body.data.id;
  t.after(() => prisma.speakUp.delete({ where: { id: createdId } }));
  assert.equal("attachmentKey" in res.body.data, false);
  assert.equal(res.body.data.hasAttachment, false);

  const mineRes = fakeRes();
  await mine({ user: { linkedEmployeeId: employee.id } }, mineRes);
  const mineRow = mineRes.body.data.find((row) => row.id === createdId);
  assert.ok(mineRow);
  assert.equal("attachmentKey" in mineRow, false);

  const allRes = fakeRes();
  await all({ user: { linkedEmployeeId: employee.id } }, allRes);
  const allRow = allRes.body.data.find((row) => row.id === createdId);
  assert.ok(allRow);
  assert.equal("attachmentKey" in allRow, false);
});

test("create mints a DBS-SPK-##### code, minted inside the same transaction as the row", async (t) => {
  const [employee] = await twoEmployees();
  const req = { user: { linkedEmployeeId: employee.id }, body: { type: "Suggestion", title: `${STAMP} identifier`, description: "Test description", attachment: null } };
  const res = fakeRes();
  await create(req, res);
  assert.equal(res.statusCode, 201);
  t.after(() => prisma.speakUp.delete({ where: { id: res.body.data.id } }));

  assert.match(res.body.data.speakUpId, IDENTIFIER_PATTERN);
  assert.match(res.body.data.speakUpId, /^DBS-SPK-\d{5}$/);
  assert.ok(parseIdentifier("SPEAK_UP", res.body.data.speakUpId), "must parse as a SPEAK_UP identifier");

  const row = await prisma.speakUp.findUnique({ where: { id: res.body.data.id }, select: { speakUpId: true } });
  assert.equal(row.speakUpId, res.body.data.speakUpId);
});

test("a login with no linked employee is refused, not written as Unknown", async () => {
  const req = { user: { linkedEmployeeId: null }, body: { type: "Other", title: `${STAMP} x`, description: "y", attachment: null } };
  const res = fakeRes();
  await create(req, res);
  assert.equal(res.statusCode, 400);
});

test("an out-of-range type is refused with a field-level message", async () => {
  const [employee] = await twoEmployees();
  const req = { user: { linkedEmployeeId: employee.id }, body: { type: "Not A Real Type", title: `${STAMP} x`, description: "y", attachment: null } };
  const res = fakeRes();
  await create(req, res);
  assert.equal(res.statusCode, 400);
  assert.ok(res.body.errors.fieldErrors.type);
});

test("an attachment that is not a base64 data URL is refused", async () => {
  const [employee] = await twoEmployees();
  const req = { user: { linkedEmployeeId: employee.id }, body: { type: "Other", title: `${STAMP} x`, description: "y", attachment: { name: "a.pdf", data: "not a data url" } } };
  const res = fakeRes();
  await create(req, res);
  assert.equal(res.statusCode, 400);
});

test("an attachment of a type outside the allow-list is refused", async () => {
  const [employee] = await twoEmployees();
  const html = Buffer.from("<script>alert(1)</script>").toString("base64");
  const req = { user: { linkedEmployeeId: employee.id }, body: { type: "Other", title: `${STAMP} x`, description: "y", attachment: { name: "a.pdf", data: `data:text/html;base64,${html}` } } };
  const res = fakeRes();
  await create(req, res);
  assert.equal(res.statusCode, 400);
});

test("an image attachment is compressed before it is stored, the same way every other image in the app is", async (t) => {
  const [employee] = await twoEmployees();
  // A 1x1 PNG - real bytes `sharp` can decode, so this exercises `compressImage` itself rather
  // than a stub of it.
  const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
  let uploaded = null;
  t.mock.method(require("../src/services/objectStorage"), "uploadPrivateObject", async (buffer, options) => {
    uploaded = { buffer, ...options };
    return { key: "hrm/speak-up/2026/09/compressed.webp" };
  });
  const req = { user: { linkedEmployeeId: employee.id }, body: { type: "Other", title: `${STAMP} image`, description: "y", attachment: { name: "a.png", data: `data:image/png;base64,${png}` } } };
  const res = fakeRes();
  await create(req, res);
  assert.equal(res.statusCode, 201);
  t.after(() => prisma.speakUp.delete({ where: { id: res.body.data.id } }));
  // Re-encoded to WebP, like every other photo the app stores - not kept as the PNG it arrived as.
  assert.equal(uploaded.contentType, "image/webp");
  assert.equal(uploaded.extension, "webp");
  assert.notEqual(uploaded.buffer.toString("base64"), png);
});

test("an oversized attachment is refused before anything is stored", async () => {
  const [employee] = await twoEmployees();
  const data = `data:application/pdf;base64,${"A".repeat(7_000_001)}`;
  const req = { user: { linkedEmployeeId: employee.id }, body: { type: "Other", title: `${STAMP} x`, description: "y", attachment: { name: "a.pdf", data } } };
  const res = fakeRes();
  await create(req, res);
  assert.equal(res.statusCode, 400);
  assert.ok(res.body.errors.fieldErrors.attachment);
});

test("a non-integer id on the attachment route is refused", async () => {
  const res = fakeRes();
  await attachment({ params: { id: "1.5" }, user: { id: 999999, linkedEmployeeId: null } }, res);
  assert.equal(res.statusCode, 400);
});

test("an attachment cannot be read by someone who did not write it and holds no review permission - and says only 404", async (t) => {
  const [owner, someoneElse] = await twoEmployees();
  const created = await rowWithAttachment(t, owner.id);

  // Stubbed rather than granted through a real role, so this test does not depend on which roles
  // happen to hold Speak-up Review on whichever database it runs against.
  t.mock.method(iamService, "hasPermission", async () => false);

  const res = fakeRes();
  await attachment({ params: { id: String(created.id) }, user: { id: 999999, linkedEmployeeId: someoneElse.id } }, res);
  assert.equal(res.statusCode, 404);

  // Indistinguishable from a row that does not exist at all.
  const missing = fakeRes();
  await attachment({ params: { id: "2147483000" }, user: { id: 999999, linkedEmployeeId: someoneElse.id } }, missing);
  assert.equal(missing.statusCode, 404);
  assert.deepEqual(missing.body, res.body);
});

test("the author downloads their own attachment", async (t) => {
  const [owner] = await twoEmployees();
  const created = await rowWithAttachment(t, owner.id);
  t.mock.method(iamService, "hasPermission", async () => false);
  t.mock.method(objectStorage, "getPrivateObject", async () => ({ body: Readable.from([Buffer.from("hello")]), contentType: "text/plain", contentLength: 5 }));

  const res = streamRes();
  await attachment({ params: { id: String(created.id) }, user: { id: 999999, linkedEmployeeId: owner.id } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.text(), "hello");
  assert.equal(res.headers["content-type"], "text/plain");
  assert.equal(res.headers["x-content-type-options"], "nosniff");
  assert.match(res.headers["content-disposition"], /^attachment/);
});

test("a Speak-up Review holder downloads somebody else's attachment", async (t) => {
  const [owner, reviewer] = await twoEmployees();
  const created = await rowWithAttachment(t, owner.id);
  t.mock.method(iamService, "hasPermission", async () => true);
  t.mock.method(objectStorage, "getPrivateObject", async () => ({ body: Readable.from([Buffer.from("for HR")]), contentType: "text/plain", contentLength: 6 }));

  const res = streamRes();
  await attachment({ params: { id: String(created.id) }, user: { id: 999999, linkedEmployeeId: reviewer.id } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.text(), "for HR");
});

test("a download that breaks mid-stream is caught, not left to crash the process", async (t) => {
  const [owner] = await twoEmployees();
  const created = await rowWithAttachment(t, owner.id);
  t.mock.method(iamService, "hasPermission", async () => true);
  const broken = new Readable({ read() { this.destroy(new Error("ECONNRESET")); } });
  t.mock.method(objectStorage, "getPrivateObject", async () => ({ body: broken, contentType: "text/plain", contentLength: null }));
  const logged = t.mock.method(console, "error", () => {});

  const res = streamRes();
  await attachment({ params: { id: String(created.id) }, user: { id: 999999, linkedEmployeeId: owner.id } }, res);
  assert.equal(res.destroyed, true);
  assert.equal(logged.mock.callCount(), 1);
});

test("an unexpected failure answers a plain 500 without the internal error message", async (t) => {
  t.mock.method(iamService, "hasPermission", async () => { throw new Error("internal prisma detail"); });
  t.mock.method(console, "error", () => {});
  const res = fakeRes();
  await attachment({ params: { id: "1" }, user: { id: 999999, linkedEmployeeId: null } }, res);
  assert.equal(res.statusCode, 500);
  assert.doesNotMatch(JSON.stringify(res.body), /internal prisma detail/);
});

/*
 * ── The reviewer's decision ───────────────────────────────────────────────────────────────────
 *
 * Two logins of the file's own: the reviewer, and the person an assignment goes to. Whether that
 * person may answer tasks is stubbed, as the attachment tests stub Speak-up Review, so nothing here
 * depends on which roles a database happens to hold.
 */
let logins;
function twoLogins() {
  logins ??= Promise.all(["reviewer", "assignee"].map((name) => prisma.user.create({
    data: { name: `${STAMP} ${name}`, email: `${STAMP}-${name}@test.local`.toLowerCase(), username: `${STAMP}-${name}`.toLowerCase(), password: "x", role: "ADMIN" },
    select: { id: true, name: true },
  })));
  return logins;
}
test.after(async () => {
  if (!logins) return;
  const ids = (await logins).map((user) => user.id);
  await prisma.speakUp.deleteMany({ where: { reviewedByUserId: { in: ids } } });
  await prisma.hrmTask.deleteMany({ where: { OR: [{ assignedToUserId: { in: ids } }, { assignedByUserId: { in: ids } }] } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
});

async function pendingSpeakUp(t, title = "review") {
  const [owner] = await twoEmployees();
  const created = await prisma.speakUp.create({
    data: { speakUpId: `${STAMP}-${title}`.slice(0, 30), employeeId: owner.id, employeeName: `${STAMP} Owner`, type: "Team / Manager Issue", title: `${STAMP} ${title}`, description: "What happened, in full." },
  });
  t.after(() => prisma.speakUp.deleteMany({ where: { id: created.id } }));
  return created;
}

const decideAs = async (reviewer, id, body) => {
  const res = fakeRes();
  await review({ params: { id: String(id) }, user: reviewer, body }, res);
  return res;
};

test("Approve marks it Approved, by whom and when, and raises no task", async (t) => {
  const [reviewer] = await twoLogins();
  const row = await pendingSpeakUp(t, "approve");
  const res = await decideAs(reviewer, row.id, { decision: "APPROVE" });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.status, "APPROVED");
  assert.equal(res.body.data.reviewedByUserId, reviewer.id);
  assert.equal(res.body.data.reviewedByName, reviewer.name);
  assert.equal(res.body.data.taskId, null);
});

test("Reject needs a reason, and keeps it out of the employee's own list", async (t) => {
  const [reviewer] = await twoLogins();
  const row = await pendingSpeakUp(t, "reject");
  const refused = await decideAs(reviewer, row.id, { decision: "REJECT" });
  assert.equal(refused.statusCode, 400);
  assert.equal((await prisma.speakUp.findUnique({ where: { id: row.id } })).status, "PENDING");

  const res = await decideAs(reviewer, row.id, { decision: "REJECT", remark: "Not something HR can act on." });
  assert.equal(res.body.data.status, "REJECTED");
  assert.equal(res.body.data.reviewRemark, "Not something HR can act on.");

  const own = fakeRes();
  await mine({ user: { linkedEmployeeId: row.employeeId } }, own);
  const mineRow = own.body.data.find((item) => item.id === row.id);
  assert.equal(mineRow.status, "REJECTED");
  for (const hidden of ["reviewRemark", "reviewedByUserId", "reviewedByName", "taskId", "taskCode"]) assert.equal(hidden in mineRow, false, hidden);
});

test("Approve & Assign makes it a task for that person - saying what happened, never who raised it", async (t) => {
  const [reviewer, assignee] = await twoLogins();
  t.mock.method(iamService, "hasPermission", async () => true);
  const row = await pendingSpeakUp(t, "assign");
  const res = await decideAs(reviewer, row.id, { decision: "ASSIGN", assignedToUserId: assignee.id, priority: "HIGH", dueOn: "2026-12-31", remark: "Please look into it." });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.status, "ASSIGNED");
  assert.match(res.body.data.taskCode, /\S/);

  const task = await prisma.hrmTask.findUnique({ where: { id: res.body.data.taskId } });
  assert.equal(task.assignedToUserId, assignee.id);
  assert.equal(task.priority, "HIGH");
  assert.equal(task.taskType, "Speak-up");
  assert.match(task.title, new RegExp(row.speakUpId));
  assert.match(task.description, /What happened, in full\./);
  assert.match(task.description, /Please look into it\./);
  assert.doesNotMatch(`${task.title} ${task.description}`, new RegExp(`${STAMP} Owner|${STAMP} Employee`));

  // Raised by a speak-up, not written by hand, so it is not offered for duplication.
  const shown = await tasks.getTask(task.id, assignee.id, true);
  assert.equal(shown.canDuplicate, false);
});

test("Approve & Assign needs a person who can answer tasks, and leaves it pending otherwise", async (t) => {
  const [reviewer, assignee] = await twoLogins();
  const row = await pendingSpeakUp(t, "nobody");
  const missing = await decideAs(reviewer, row.id, { decision: "ASSIGN" });
  assert.equal(missing.statusCode, 400);

  t.mock.method(iamService, "hasPermission", async () => false);
  const unable = await decideAs(reviewer, row.id, { decision: "ASSIGN", assignedToUserId: assignee.id });
  assert.equal(unable.statusCode, 400);
  assert.equal((await prisma.speakUp.findUnique({ where: { id: row.id } })).status, "PENDING");
});

test("a speak-up is decided once - a second decision is refused", async (t) => {
  const [reviewer] = await twoLogins();
  const row = await pendingSpeakUp(t, "twice");
  assert.equal((await decideAs(reviewer, row.id, { decision: "APPROVE" })).statusCode, 200);
  const again = await decideAs(reviewer, row.id, { decision: "REJECT", remark: "Changed my mind." });
  assert.equal(again.statusCode, 409);
  assert.equal((await prisma.speakUp.findUnique({ where: { id: row.id } })).status, "APPROVED");
});

test("only logins that can answer a task are offered for an assignment", async (t) => {
  const [, assignee] = await twoLogins();
  t.mock.method(iamService, "hasPermission", async (userId) => userId === assignee.id);
  const res = fakeRes();
  await assignees({ user: { id: 1 } }, res);
  assert.deepEqual(res.body.data.map((user) => user.id), [assignee.id]);
});

test("Approve & Assign never gives it back to the person who raised it", async (t) => {
  const [reviewer] = await twoLogins();
  t.mock.method(iamService, "hasPermission", async () => true);
  const row = await pendingSpeakUp(t, "raiser");
  // The raiser's own login.
  const raiser = await prisma.user.create({
    data: { name: `${STAMP} raiser`, email: `${STAMP}-raiser@test.local`.toLowerCase(), username: `${STAMP}-raiser`.toLowerCase(), password: "x", role: "ADMIN", linkedEmployeeId: row.employeeId },
    select: { id: true },
  });
  t.after(() => prisma.user.delete({ where: { id: raiser.id } }));
  const res = await decideAs(reviewer, row.id, { decision: "ASSIGN", assignedToUserId: raiser.id });
  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /other than the person who raised it/);
  assert.equal((await prisma.speakUp.findUnique({ where: { id: row.id } })).status, "PENDING");
});

test("deleting a Speak-up: HR may remove any, the person who raised it only their own, and only until it is answered", async (t) => {
  /*
   * The two acts behind one Delete. HR clearing a record it has finished with reaches any row; the
   * employee taking back something they sent reaches only their own, and only while it is still
   * PENDING - once a reviewer has answered it, the decision is the studio's record of what was
   * raised and answered, and letting the person who raised it withdraw it afterwards would erase
   * that. The attachment goes with the row; the HRM task an ASSIGNED one became does not.
   *
   * Whether there are tick boxes to press at all is `ADMIN / Table Select All` ("Select Table Rows
   * in Bulk"), which `mountBulkDelete` puts on top of the guards above - so this is a Super Admin's
   * by default, and anybody else's only once the studio ticks that row onto their role.
   */
  const [owner, other] = await twoEmployees();
  const made = async (data) => {
    const row = await prisma.speakUp.create({ data: { employeeId: owner.id, employeeName: `${STAMP} Owner`, type: "Other", title: `${STAMP} delete`, description: "y", ...data } });
    t.after(() => prisma.speakUp.deleteMany({ where: { id: row.id } }));
    return row;
  };
  const asOwner = { user: { linkedEmployeeId: owner.id } };
  const asHr = { user: { id: 0, linkedEmployeeId: other.id } };
  const gone = async (id) => !(await prisma.speakUp.findFirst({ where: { id }, select: { id: true } }));

  // HR: any row, whatever its state.
  const answered = await made({ status: "APPROVED" });
  assert.deepEqual(await controller.deleteSpeakUpRecord(asHr, answered.id), { id: answered.id, taskId: null });
  assert.ok(await gone(answered.id));

  // Their own, still pending: theirs to take back.
  const mine = await made({});
  assert.deepEqual(await controller.deleteSpeakUpRecord(asOwner, mine.id, { own: true }), { id: mine.id, taskId: null });
  assert.ok(await gone(mine.id));

  // Their own, already answered: refused, with the reason - and still there afterwards.
  const decided = await made({ status: "REJECTED" });
  await assert.rejects(() => controller.deleteSpeakUpRecord(asOwner, decided.id, { own: true }), (error) => error.status === 409 && /already been reviewed/.test(error.message));
  assert.ok(!(await gone(decided.id)));

  // Somebody else's reads as not found rather than as refused - it is not theirs to know about.
  const theirs = await prisma.speakUp.create({ data: { employeeId: other.id, employeeName: `${STAMP} Other`, type: "Other", title: `${STAMP} theirs`, description: "y" } });
  t.after(() => prisma.speakUp.deleteMany({ where: { id: theirs.id } }));
  await assert.rejects(() => controller.deleteSpeakUpRecord(asOwner, theirs.id, { own: true }), (error) => error.status === 404);
  assert.ok(!(await gone(theirs.id)));

  // And an id that is not one - "bulk" reaching the handler as a record name, for instance.
  await assert.rejects(() => controller.deleteSpeakUpRecord(asOwner, "bulk", { own: true }), (error) => error.status === 404);
});

test("the attachment goes with the Speak-up it came with", async (t) => {
  // Best-effort and after the row: a bucket that cannot be reached must not leave a Speak-up nobody
  // can delete, which is why `deleteObject` is called outside the write and never throws.
  const objectStorage = require("../src/services/objectStorage");
  const removed = [];
  t.mock.method(objectStorage, "deleteObject", async (key) => { removed.push(key); });
  const [owner] = await twoEmployees();
  const row = await prisma.speakUp.create({ data: { employeeId: owner.id, employeeName: `${STAMP} Owner`, type: "Other", title: `${STAMP} attach`, description: "y", attachmentKey: "hrm/speak-up/x.png", attachmentFileName: "x.png" } });
  await controller.deleteSpeakUpRecord({ user: { id: 0 } }, row.id);
  assert.deepEqual(removed, ["hrm/speak-up/x.png"]);
});
