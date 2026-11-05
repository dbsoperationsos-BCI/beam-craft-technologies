const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");
const prisma = require("../src/config/db");
const { newTemporaryPassword, generatedTemporaryPassword } = require("../src/services/loginCredentials");

/*
 * Somebody offboarded rejoins months later: Move to Active brings back the same record, username and
 * roles, but the login reopens on a new auto-generated password - never the one they left with -
 * every desktop session saved before they went is revoked, and the new password is emailed to them.
 *
 * The mailer is stubbed: the point is what is sent and said back, not a real email.
 */

const EMAIL_SERVICE = require.resolve("../src/services/emailService");
const CONTROLLER = require.resolve("../src/modules/hrm/employees/controller");

const STAMP = String(Date.now()).slice(-6);
const tag = (name) => `TRJ-${STAMP}-${name}`;

function controllerWithMailer(sendImpl) {
  delete require.cache[CONTROLLER];
  const realEmail = require.cache[EMAIL_SERVICE];
  require.cache[EMAIL_SERVICE] = { id: EMAIL_SERVICE, filename: EMAIL_SERVICE, loaded: true, paths: [], exports: { ...require("../src/services/emailService"), sendEmployeeCredentialsEmail: sendImpl } };
  const loaded = require(CONTROLLER);
  if (realEmail) require.cache[EMAIL_SERVICE] = realEmail;
  return loaded;
}

function reply() {
  const answer = { statusCode: 200, body: null };
  answer.status = (code) => { answer.statusCode = code; return answer; };
  answer.json = (body) => { answer.body = body; return answer; };
  return answer;
}

after(async () => {
  await prisma.user.deleteMany({ where: { username: { startsWith: `trj-${STAMP}` } } }).catch(() => {});
  await prisma.employee.deleteMany({ where: { employeeId: { startsWith: `TRJ-${STAMP}-` } } }).catch(() => {});
  delete require.cache[CONTROLLER];
  await prisma.$disconnect();
});

async function offboarded(name) {
  const employee = await prisma.employee.create({ data: { employeeName: tag(name), employeeId: tag(name), employmentStatus: "Relieved", emailId: `${tag(name)}@example.com` } });
  await prisma.employeeSeparation.create({ data: { employeeId: employee.id, separationType: "Resignation", separationReason: "Others", employmentStatus: "Relieved", previousEmploymentStatus: "Active", proposedLastWorkingDate: new Date(), relievedAt: new Date() } });
  const login = await prisma.user.create({ data: {
    name: tag(name), email: `${tag(name)}@test.local`, username: `trj-${STAMP}-${name}`, role: "EMPLOYEE", status: "INACTIVE",
    password: await bcrypt.hash("the-old-password", 4), mustChangePassword: false, linkedEmployeeId: employee.id,
  } });
  await prisma.authSession.create({ data: { userId: login.id, tokenHash: tag(name).padEnd(64, "0").slice(0, 64), expiresAt: new Date(Date.now() + 86400000) } });
  return { employee, login };
}

test("a generated password has the shape the credentials form accepts, and is never the same twice", () => {
  const made = new Set(Array.from({ length: 200 }, newTemporaryPassword));
  assert.equal(made.size, 200);
  for (const password of made) assert.ok(generatedTemporaryPassword.safeParse(password).success, password);
});

test("rejoining reopens the same login on a new password, revokes old sessions and emails it", async () => {
  const admin = await prisma.user.create({ data: { name: tag("admin"), email: `${tag("admin")}@test.local`, username: `trj-${STAMP}-admin`, password: "x", role: "SUPER_ADMIN", status: "ACTIVE" } });
  const { employee, login } = await offboarded("back");
  const sent = [];
  const controller = controllerWithMailer(async (mail) => { sent.push(mail); return { sent: true }; });
  const answer = reply();
  await controller.reactivateEmployee({ params: { id: String(employee.id) }, body: { reason: "Rejoined" }, user: { id: admin.id, role: "SUPER_ADMIN" } }, answer);

  assert.equal(answer.statusCode, 200, JSON.stringify(answer.body));
  const account = await prisma.user.findUnique({ where: { id: login.id } });
  assert.equal(account.status, "ACTIVE");
  assert.equal(account.username, login.username, "the same login comes back");
  assert.equal(account.mustChangePassword, true);
  assert.equal(await bcrypt.compare("the-old-password", account.password), false, "the old password no longer works");

  const { credentials } = answer.body;
  assert.ok(await bcrypt.compare(credentials.temporaryPassword, account.password), "the password handed back is the one set");
  assert.equal(credentials.emailSent, true);
  assert.equal(credentials.sentTo, employee.emailId);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].temporaryPassword, credentials.temporaryPassword);
  assert.equal(sent[0].email, employee.emailId);

  assert.equal(await prisma.authSession.count({ where: { userId: login.id, revokedAt: null } }), 0);
  assert.equal((await prisma.employee.findUnique({ where: { id: employee.id } })).employmentStatus, "Active");
});

test("a refused email does not undo the rejoin; the screen is told why", async () => {
  const admin = await prisma.user.findFirst({ where: { username: `trj-${STAMP}-admin` } });
  const { employee, login } = await offboarded("nomail");
  const controller = controllerWithMailer(async () => { throw new Error("quota"); });
  const answer = reply();
  await controller.reactivateEmployee({ params: { id: String(employee.id) }, body: { reason: "Rejoined" }, user: { id: admin.id, role: "SUPER_ADMIN" } }, answer);

  assert.equal(answer.statusCode, 200);
  assert.equal(answer.body.credentials.emailSent, false);
  assert.ok(answer.body.credentials.warning);
  assert.ok(answer.body.credentials.temporaryPassword, "shown so it can be handed over by hand");
  assert.equal((await prisma.user.findUnique({ where: { id: login.id } })).status, "ACTIVE");
});
