const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const bcrypt = require("bcryptjs");
const prisma = require("../src/config/db");
const { protect, CLIENT_ROUTES } = require("../src/middleware/authMiddleware");
const { clientLoginFor, deleteProject, sendClientLoginWhatsApp, getClientLogin, createClientLogin } = require("../src/modules/sales/projects/controller");
const { TEMPORARY_PASSWORD_ALPHABET } = require("../src/services/loginCredentials");

/*
 * Create Project → Client Credentials: a client's own sign-in.
 *
 * The account is made with the project, **on the booking's own permission** - it reaches one
 * project's portal and nothing of the studio's (`protect` refuses a CLIENT token everywhere but
 * its own account routes), so making it is the last step of booking rather than an errand belonging
 * to `ADMIN / User Management`. Asking for that admin permission meant the person booking could not
 * finish the booking: the whole project was refused with a 403 about a permission the Sales screen
 * never mentions. Real rows, removed at the end.
 */

const STAMP = String(Date.now()).slice(-6);
const tag = (name) => `TCL-${STAMP}-${name}`;
const F = {};
/*
 * A client's username is their mobile number, so each project here gets one made from this run's
 * stamp - never a number a real client could hold - and the logins made with them are deleted by
 * username in `after`, since no fixture prefix can find them.
 */
const mobile = (suffix) => `97${STAMP}${suffix}`;
const NUMBERS = { bare: mobile("11"), fresh: mobile("22"), taken: mobile("33") };
const CONTROLLER = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "sales", "projects", "controller.js"), "utf8");

const leadFor = (enquiryId) => prisma.salesCrmLead.upsert({ where: { enquiryId }, create: { enquiryId, name: enquiryId }, update: {} });

before(async () => {
  await leadFor(tag("enq"));
  F.project = await prisma.salesProject.create({ data: {
    enquiryId: tag("enq"), eventId: tag("ev"), whatsappGroupName: `WED client ${STAMP}`, clientMainNumber: "+919876543210",
    sourceBranch: "Erode TN", vertical: "WED", deliverables: "[]", initialConvertedValue: 0, crmName: "Test",
  } });
  // A project booked without a client login, for Edit Sale Details to give it one.
  await leadFor(tag("enq-bare"));
  F.bare = await prisma.salesProject.create({ data: {
    enquiryId: tag("enq-bare"), eventId: tag("ev-bare"), whatsappGroupName: `WED bare ${STAMP}`, clientMainNumber: `+91${NUMBERS.bare}`,
    sourceBranch: "Erode TN", vertical: "WED", deliverables: "[]", initialConvertedValue: 0, crmName: "Test",
  } });
  // A client login holds no email, as Create Project makes it.
  F.client = await prisma.user.create({ data: { name: "Client", email: null, username: tag("client-live").toLowerCase(), password: "x", role: "CLIENT", status: "ACTIVE", clientProjectId: F.project.id } });
  F.admin = await prisma.user.create({ data: { name: "Deleter", email: `${tag("admin")}@test.local`.toLowerCase(), username: tag("admin").toLowerCase(), password: "x", role: "SUPER_ADMIN" } });
  F.staff = await prisma.user.create({ data: { name: "Client login maker", email: `${tag("staff")}@test.local`.toLowerCase(), username: tag("staff").toLowerCase(), password: "x", role: "EMPLOYEE" } });
  F.taken = await prisma.user.create({ data: { name: "Already here", email: `${tag("taken")}@test.local`.toLowerCase(), username: tag("taken").toLowerCase(), password: "x", role: "EMPLOYEE" } });
});

after(async () => {
  await prisma.userRole.deleteMany({ where: { userId: { in: [F.staff?.id, F.taken?.id].filter(Boolean) } } });
  await prisma.user.deleteMany({ where: { OR: [{ email: { startsWith: `tcl-${STAMP}` } }, { username: { startsWith: `tcl-${STAMP}` } }, { username: { in: Object.values(NUMBERS) } }] } });
  await prisma.salesProject.deleteMany({ where: { eventId: { startsWith: `TCL-${STAMP}` } } });
  await prisma.salesCrmLead.deleteMany({ where: { enquiryId: { startsWith: `TCL-${STAMP}` } } });
  await prisma.$disconnect();
});

/** Runs `protect` for one request and says what it did: "next", or the status it answered with. */
async function run(role, method, url, id = F.client?.id) {
  const jwt = require("jsonwebtoken");
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test-secret";
  const token = jwt.sign({ id, role }, process.env.JWT_SECRET);
  let outcome = null;
  const res = { status: (code) => ({ json: () => { outcome = code; } }) };
  await protect({ method, originalUrl: url, headers: { authorization: `Bearer ${token}` } }, res, () => { outcome = "next"; });
  return outcome;
}

test("a client token reaches its own account routes and nothing else", async () => {
  assert.deepEqual([...CLIENT_ROUTES], [
    "GET /api/user/profile",
    "POST /api/user/change-password",
    "GET /api/client/projects",
    "GET /api/client/project",
    "GET /api/client/payments",
    "GET /api/client/package",
    "GET /api/client/quotation/pdf",
    "GET /api/client/quotation/view",
    "GET /api/client/offers",
    "GET /api/client/chats",
    "POST /api/client/chats",
    "GET /api/client/referrals",
    "POST /api/client/referrals",
    "GET /api/client/coins",
    "GET /api/client/receipt",
    "GET /api/client/reviews",
    "GET /api/client/notifications",
    "GET /api/client/crd",
    "GET /api/client/pre-production",
    "POST /api/client/push-token",
    "DELETE /api/client/push-token",
    "GET /api/client/invitations",
    "GET /api/client/invitations/designs",
    "POST /api/client/invitations",
    "GET /api/client/requests",
    "POST /api/client/requests",
  ]);
  assert.equal(await run("CLIENT", "GET", "/api/user/profile"), "next");
  assert.equal(await run("CLIENT", "GET", "/api/client/project"), "next", "the client portal's own project");
  assert.equal(await run("CLIENT", "GET", "/api/client/payments"), "next", "the client's own money");
  assert.equal(await run("CLIENT", "GET", "/api/client/receipt?entry=DBS-MR-1"), "next", "a receipt is asked for by a query");
  assert.equal(await run("CLIENT", "GET", "/api/client/receipt/DBS-MR-1"), 403, "never by a path the list does not name");
  assert.equal(await run("CLIENT", "POST", "/api/client/payments"), 403);
  assert.equal(await run("CLIENT", "POST", "/api/client/project"), 403);
  // A client sets their own password in place of the studio's - that route alone of the account's.
  assert.equal(await run("CLIENT", "POST", "/api/user/change-password"), "next");
  assert.equal(await run("CLIENT", "PATCH", "/api/user/profile"), 403, "but not the rest of the profile");
  assert.equal(await run("CLIENT", "GET", "/api/user/profile?x=1"), "next", "a query string does not change the route");
  // Everything a studio account reaches by being signed in alone is closed to a client - spelled
  // however Express would still route it.
  assert.equal(await run("CLIENT", "GET", "/api/user/permissions"), 403);
  assert.equal(await run("CLIENT", "GET", "/api/hrm/master-data/branches"), 403);
  assert.equal(await run("CLIENT", "GET", "/api/sales/projects"), 403);
  assert.equal(await run("CLIENT", "PATCH", "/api/user/profile"), 403, "only the methods listed");
  assert.equal(await run("CLIENT", "HEAD", "/api/user/profile"), 403);
  assert.equal(await run("CLIENT", "GET", "/API/USER/PROFILE"), 403);
  assert.equal(await run("CLIENT", "GET", "/api//user/profile"), 403);
  assert.equal(await run("CLIENT", "GET", "/api/user/%70rofile"), 403);
  // Studio accounts are untouched. The test's own ACTIVE staff account, not a fixed id: `protect` now
  // asks whether a staff login still stands, and user 1 need not exist in the database the suite runs on.
  assert.equal(await run("EMPLOYEE", "GET", "/api/user/permissions", F.staff.id), "next");
});

test("a client token stops working the moment its account or project does", async () => {
  await prisma.user.update({ where: { id: F.client.id }, data: { status: "INACTIVE" } });
  assert.equal(await run("CLIENT", "GET", "/api/user/profile"), 401);
  await prisma.user.update({ where: { id: F.client.id }, data: { status: "ACTIVE" } });
  assert.equal(await run("CLIENT", "GET", "/api/user/profile"), "next");
  // A token naming an account that is not a client's is not honoured as one.
  assert.equal(await run("CLIENT", "GET", "/api/user/profile", F.staff.id), 401);
});

/** Calls a handler and says what it answered: `{ code, body }`. */
async function answer(handler, req) {
  let out = null;
  const res = { status: (code) => ({ json: (body) => { out = { code, body }; } }), json: (body) => { out = { code: 200, body }; } };
  await handler(req, res);
  return out;
}

test("sending a client their login needs a message and a project with a live client login", async () => {
  // No `ADMIN / User Management`: handing a client the credentials for their own project is the
  // last step of booking it, and the route is already narrowed to projects this caller may reach.
  const req = (user, body = { message: "Hi" }, id = F.project.id) => ({ params: { id }, body, user: { id: user.id } });
  assert.equal((await answer(sendClientLoginWhatsApp, req(F.admin, { message: "  " }))).code, 400);
  // A project this caller cannot reach, or one with no client login, is not found.
  assert.equal((await answer(sendClientLoginWhatsApp, req(F.admin, { message: "Hi" }, "no-such-project"))).code, 404);
  await prisma.user.update({ where: { id: F.client.id }, data: { status: "INACTIVE" } });
  try {
    const noLogin = await answer(sendClientLoginWhatsApp, req(F.admin));
    assert.equal(noLogin.code, 404);
    assert.match(noLogin.body.message, /no client login/);
  } finally {
    await prisma.user.update({ where: { id: F.client.id }, data: { status: "ACTIVE" } });
  }
});

test("Edit Sale Details gives a project without one a client login - once, and shows it back without its password", async () => {
  const req = (user, id, body = {}) => ({ params: { id }, body, user: { id: user.id } });
  // No admin permission in it: the project's own reach decides, which is what the route guards.
  assert.deepEqual((await answer(getClientLogin, req(F.admin, F.bare.id))).body, { data: null });
  // Asked for nothing, nothing is made.
  assert.equal((await answer(createClientLogin, req(F.admin, F.bare.id))).code, 400);
  // A username typed anyway is ignored: the login is the project's own mobile number.
  const made = await answer(createClientLogin, req(F.admin, F.bare.id, { clientLogin: { username: tag("bare").toLowerCase(), temporaryPassword: "abcd-efgh-jkmn" } }));
  assert.equal(made.code, 201, JSON.stringify(made.body));
  assert.equal(made.body.data.username, NUMBERS.bare);
  const account = await prisma.user.findUnique({ where: { username: NUMBERS.bare }, select: { role: true, email: true, clientProjectId: true, mustChangePassword: true } });
  assert.deepEqual(account, { role: "CLIENT", email: null, clientProjectId: F.bare.id, mustChangePassword: true });

  assert.deepEqual((await answer(getClientLogin, req(F.admin, F.bare.id))).body, { data: { username: NUMBERS.bare, active: true, passwordChanged: false, shared: false } });
  // One login per project.
  const again = await answer(createClientLogin, req(F.admin, F.bare.id, { clientLogin: { username: tag("bare2").toLowerCase(), temporaryPassword: "abcd-efgh-jkmn" } }));
  assert.equal(again.code, 409);
});

test("the Edit Sale Details routes are guarded as the edit is", () => {
  const routes = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "sales", "projects", "routes.js"), "utf8");
  assert.match(routes, /router\.get\("\/projects\/:id\/client-login", answersForAProject, getClientLogin\);/);
  assert.match(routes, /router\.post\("\/projects\/:id\/client-login", answersForAProject, requireProjectEditor, createClientLogin\);/);
  assert.match(routes, /router\.post\("\/projects\/:id\/client-login\/whatsapp", salesManager, requireTemplateOn\("CLIENT_LOGIN_CREDENTIALS"\), whatsappLimits\.send, sendClientLoginWhatsApp\);/);
});

test("a client's password cannot be reset by phone either", () => {
  const auth = fs.readFileSync(path.join(__dirname, "..", "src", "controllers", "authController.js"), "utf8");
  assert.match(auth, /return unique\[0\]\.status === "ACTIVE" && unique\[0\]\.role !== "CLIENT" \? unique\[0\] : null;/);
});

test("deleting a project switches its client's login off", async () => {
  let answered = null;
  const res = { status: (code) => ({ json: (body) => { answered = { code, body }; } }), json: (body) => { answered = { code: 200, body }; } };
  await deleteProject({ params: { id: F.project.id }, user: { id: F.admin.id, role: "SUPER_ADMIN" } }, res);
  assert.equal(answered?.code, 200, JSON.stringify(answered?.body));
  const account = await prisma.user.findUnique({ where: { id: F.client.id }, select: { status: true } });
  assert.equal(account.status, "INACTIVE");
  assert.equal(await run("CLIENT", "GET", "/api/user/profile"), 401);
});

test("no client login is asked for: nothing is checked and nothing is made", async () => {
  assert.equal(await clientLoginFor({ body: {}, user: { id: F.staff.id } }), null);
  assert.equal(await clientLoginFor({ body: { clientLogin: null }, user: { id: F.staff.id } }), null);
});

test("a client login takes the client's mobile number as its username and the generated password - and no email", async () => {
  const login = { temporaryPassword: "abcd-efgh-jkmn" };
  const forNumber = (clientMainNumber, body = login) => clientLoginFor({ body: { clientLogin: body }, user: { id: F.staff.id } }, { clientMainNumber });
  /*
   * `F.staff` holds no admin permission at all, and makes one: the booking's own guard on the route
   * is the whole of it. It used to need `ADMIN / User Management` here, which refused the entire
   * project to whoever was booking it.
   */
  {
    // The username is the ten digits of the Client Main Number, without the country code - whatever
    // username is sent.
    const ready = await forNumber(`+91 ${NUMBERS.fresh}`, { ...login, username: "typed-by-hand" });
    assert.equal(ready.username, NUMBERS.fresh);
    // No valid number, no username: said on the Username, before anything is made.
    for (const missing of [null, "", "12345"]) {
      await assert.rejects(forNumber(missing), (error) => error.status === 400 && /Username: Add the client's 10-digit mobile number/.test(error.message), String(missing));
    }
    // Only the generated shape: a request sent around the form cannot give a client a weak password.
    for (const weak of ["short", "12345678", "Password@123", "ABCD-EFGH-JKMN"]) {
      await assert.rejects(forNumber(`+91 ${NUMBERS.fresh}`, { temporaryPassword: weak }), (error) => error.status === 400 && /Temporary Password/.test(error.message), weak);
    }
    // A client booking again keeps the login of their earlier event: none is made, and nothing is refused.
    const earlier = await prisma.user.create({ data: { name: "Earlier booking", email: null, username: NUMBERS.taken, password: "x", role: "CLIENT", status: "ACTIVE" } });
    assert.equal(await forNumber(`+91 ${NUMBERS.taken}`), null);
    // A staff username that happens to be the same ten digits is not the client's, and is refused.
    await prisma.user.update({ where: { id: earlier.id }, data: { role: "EMPLOYEE" } });
    await assert.rejects(forNumber(`+91 ${NUMBERS.taken}`), (error) => error.status === 409 && new RegExp(`mobile number ${NUMBERS.taken} is already used as a login username`).test(error.message));

    assert.equal(ready.email, undefined, "a client login carries no email");
    // An email sent anyway is dropped, not stored.
    const withEmail = await forNumber(`+91 ${NUMBERS.fresh}`, { ...login, email: "someone@example.com" });
    assert.equal(withEmail.email, undefined);
    assert.ok(await bcrypt.compare(login.temporaryPassword, ready.passwordHash), "the password is stored hashed");
    assert.equal(ready.temporaryPassword, undefined, "the plain password is not carried on");
  }
});

test("the account is made in the project's transaction as a CLIENT, linked to the project", () => {
  const start = CONTROLLER.indexOf("if (clientLogin) {");
  assert.match(CONTROLLER.slice(start, CONTROLLER.indexOf("}", start)), /await createClientLoginUser\(transaction, project, clientLogin\);/);
  const helper = CONTROLLER.slice(CONTROLLER.indexOf("function createClientLoginUser("), CONTROLLER.indexOf("async function getClientLogin("));
  // `role` is always set: the column's default is SUPER_ADMIN.
  assert.match(helper, /role: CLIENT_ROLE,/);
  assert.match(helper, /clientProjectId: project\.id,/);
  assert.match(helper, /email: null,/);
  // The app asks the client to set their own in place of the studio's on first sign-in.
  assert.match(helper, /mustChangePassword: true,/);
  assert.doesNotMatch(helper, /userRole/, "a client account holds no IAM role");
  // Checked before the transaction opens, so a refused login leaves no project behind.
  assert.ok(CONTROLLER.indexOf("const clientLogin = await clientLoginFor(req);") < CONTROLLER.indexOf("if (clientLogin) {"));
});

test("the server accepts the password the form generates, from the same alphabet", () => {
  const frontend = fs.readFileSync(path.join(__dirname, "..", "..", "frontend", "src", "lib", "temporaryPassword.mjs"), "utf8");
  assert.match(frontend, new RegExp(`const ALPHABET = "${TEMPORARY_PASSWORD_ALPHABET}";`));
  assert.match(frontend, /const GROUP = 4;/);
  assert.match(frontend, /const GROUPS = 3;/);
});

test("a long project name is cut to fit the account's name", () => {
  assert.match(CONTROLLER, /name: String\(project\.whatsappGroupName \|\| "Client"\)\.slice\(0, 191\),/);
});
