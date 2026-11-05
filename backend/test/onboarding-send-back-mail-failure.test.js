const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const prisma = require("../src/config/db");

/*
 * Both mails this controller sends, and what each does when the send is refused.
 *
 * Sending an onboarding back is the reopening; the email is the last thing it does, and the least.
 *
 * The order was already right - the invite and the employee move first, the mail goes after - but a
 * *thrown* refusal escaped to the generic catch and answered 500 "Unable to send this onboarding
 * back", carrying no link. That reads as "nothing happened" when in fact everything had: the
 * submission was reopened and the employee moved to Employee Submission Pending, and the only thing
 * missing was the candidate being told. The screen closed on it, so the message that could have been
 * sent by hand went with it - which matters most exactly when it fails, because the common cause is
 * the studio's mail quota being spent.
 *
 * `smtpPool` is what makes the two shapes: it returns `{ sent: false }` for the one case of no
 * sender configured at all, and *throws* when senders exist and every one refuses. Both are the
 * same answer to the caller now.
 *
 * The mailer is stubbed rather than a real send being attempted: this is about what happens when it
 * fails, and a suite that emails a candidate to find out is not one anybody can run twice.
 */

const EMAIL_SERVICE = require.resolve("../src/services/emailService");
const CONTROLLER = require.resolve("../src/modules/hrm/onboarding-invites/controller");

const STAMP = String(Date.now()).slice(-6);
const tag = (name) => `TSB-${STAMP}-${name}`;
const F = {};

/** Loads the controller against a stubbed mailer, so a send can be made to fail on demand. */
function controllerWithMailer(sendImpl, key = "sendOnboardingSendBackEmail") {
  delete require.cache[CONTROLLER];
  const realEmail = require.cache[EMAIL_SERVICE];
  require.cache[EMAIL_SERVICE] = {
    id: EMAIL_SERVICE,
    filename: EMAIL_SERVICE,
    loaded: true,
    paths: [],
    exports: { ...require("../src/services/emailService"), [key]: sendImpl },
  };
  const loaded = require(CONTROLLER);
  if (realEmail) require.cache[EMAIL_SERVICE] = realEmail;
  return loaded;
}

/** The bare minimum of an Express response, as this only ever reads the status and the body. */
function reply() {
  const answer = { statusCode: 200, body: null };
  answer.status = (code) => { answer.statusCode = code; return answer; };
  answer.json = (body) => { answer.body = body; return answer; };
  return answer;
}

before(async () => {
  F.employee = await prisma.employee.create({ data: {
    employeeName: tag("candidate"), employeeId: tag("emp"), employmentStatus: "HR Onboarding Pending",
  } });
});

beforeEach(async () => {
  // Each case starts from a fresh submitted invite and a pending employee, because the first thing
  // a send-back does is change both.
  await prisma.employeeOnboardingInvite.deleteMany({ where: { candidateName: { startsWith: `TSB-${STAMP}-` } } });
  F.invite = await prisma.employeeOnboardingInvite.create({ data: {
    candidateName: tag("candidate"), candidateEmail: `${tag("c")}@example.com`, candidatePhone: "+91 9876543210",
    employeeId: String(F.employee.id), status: "Submitted", submittedAt: new Date(),
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    tokenHash: tag("hash").slice(0, 60), shortCode: `TSB${STAMP}`.slice(0, 8).toUpperCase(),
  } });
  await prisma.employee.update({ where: { id: F.employee.id }, data: { employmentStatus: "HR Onboarding Pending" } });
});

after(async () => {
  await prisma.employeeOnboardingInvite.deleteMany({ where: { candidateName: { startsWith: `TSB-${STAMP}-` } } });
  await prisma.employee.deleteMany({ where: { employeeId: { startsWith: `TSB-${STAMP}-` } } });
  delete require.cache[CONTROLLER];
});

const sendBack = async (sendImpl) => {
  const controller = controllerWithMailer(sendImpl);
  const answer = reply();
  await controller.sendBackOnboarding({ params: { id: String(F.employee.id) } }, answer);
  return answer;
};

const stateNow = async () => ({
  employee: (await prisma.employee.findUnique({ where: { id: F.employee.id }, select: { employmentStatus: true } })).employmentStatus,
  invite: (await prisma.employeeOnboardingInvite.findUnique({ where: { id: F.invite.id }, select: { status: true, submittedAt: true } })),
});

test("a thrown refusal still reopens the submission, and answers with the link", async () => {
  const answer = await sendBack(async () => { throw new Error("550-5.4.5 Daily user sending limit exceeded"); });

  const state = await stateNow();
  assert.equal(state.employee, "Employee Submission Pending", "the employee moves before the mail is attempted");
  assert.equal(state.invite.status, "Verified", "and the invite is open for the candidate again");
  assert.equal(state.invite.submittedAt, null);

  // 502, not the 500 the generic catch used to give: the screen keeps the dialog open on this one
  // and shows the message to send by hand.
  assert.equal(answer.statusCode, 502);
  assert.equal(answer.body.emailSent, false);
  assert.ok(answer.body.onboardingUrl, "the link the candidate needs, which a 500 carried none of");
  assert.equal(answer.body.candidateName, tag("candidate"));
  assert.ok(answer.body.expiresAt);
  // Named in words somebody can act on, and never the raw SMTP text.
  assert.equal(answer.body.warning, "the studio's mail account has reached its sending limit for today");
  assert.equal(answer.body.message.includes("5.4.5"), false, "the thrown SMTP text must not reach the browser");
});

test("an unconfigured mail server answers the same way", async () => {
  // `{ sent: false }` rather than a throw - the other shape `smtpPool` produces.
  const answer = await sendBack(async () => ({ sent: false, reason: "SMTP is not configured." }));
  assert.equal(answer.statusCode, 502);
  assert.equal(answer.body.emailSent, false);
  assert.ok(answer.body.onboardingUrl);
  assert.equal((await stateNow()).employee, "Employee Submission Pending");
});

test("a send that works says so, and the reopening is the same either way", async () => {
  const answer = await sendBack(async () => ({ sent: true }));
  assert.equal(answer.statusCode, 200);
  assert.equal(answer.body.emailSent, true);
  assert.ok(answer.body.onboardingUrl);
  assert.equal((await stateNow()).employee, "Employee Submission Pending");
});

test("an employee who is not awaiting review is refused before anything moves", async () => {
  await prisma.employee.update({ where: { id: F.employee.id }, data: { employmentStatus: "Active" } });
  let attempted = false;
  const answer = await sendBack(async () => { attempted = true; return { sent: true }; });
  assert.equal(answer.statusCode, 400);
  assert.equal(attempted, false, "no mail is sent for a send-back that is refused");
  assert.equal((await prisma.employeeOnboardingInvite.findUnique({ where: { id: F.invite.id }, select: { status: true } })).status, "Submitted");
});


/*
 * ── The invite email, refused the same way ────────────────────────────────────────────────────
 *
 * The same fault, on the other mail this controller sends: `{ sent: false }` was answered with its
 * reason and a *throw* was not, so a studio out of sends for the day was told only "Unable to send
 * onboarding invite email" - which reads identically to a typo in the address, and leaves nothing
 * to act on. Unlike the send-back there is nothing to undo here: the invite already exists and
 * keeps its link, so this is purely about saying why.
 */

/*
 * A fresh invite per case, because `beforeEach` clears this suite's rows between tests - the
 * send-back cases need a submitted invite each time, and one left over from a previous case would
 * be a different starting point than the test says it is.
 */
const sendableInvite = (suffix) => prisma.employeeOnboardingInvite.create({ data: {
  candidateName: tag(`invitee-${suffix}`), candidateEmail: `${tag(`i${suffix}`)}@example.com`, candidatePhone: "+91 9876543210",
  status: "Created", expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  tokenHash: tag(`invhash-${suffix}`).slice(0, 60), shortCode: `TSB${suffix}${STAMP}`.slice(0, 8).toUpperCase(),
} });

const sendInvite = async (invite, sendImpl) => {
  const controller = controllerWithMailer(sendImpl, "sendOnboardingInviteEmail");
  const answer = reply();
  await controller.sendInviteEmail({ params: { id: invite.id }, body: { token: invite.shortCode } }, answer);
  return answer;
};

test("a thrown refusal on the invite email is named, not swallowed as a server error", async () => {
  const invite = await sendableInvite("a");
  const answer = await sendInvite(invite, async () => { throw new Error("Data command failed: 550-5.4.5 Daily user sending limit exceeded"); });

  // 502 with the reason, where the generic catch used to give a bare 500.
  assert.equal(answer.statusCode, 502);
  assert.equal(answer.body.emailSent, false);
  assert.equal(answer.body.warning, "the studio's mail account has reached its sending limit for today");
  assert.match(answer.body.message, /sending limit for today/);
  assert.equal(answer.body.message.includes("5.4.5"), false, "the thrown SMTP text must not reach the browser");

  // The invite is untouched: it was already created, and a failed send is not a reason to spoil it.
  const after = await prisma.employeeOnboardingInvite.findUnique({ where: { id: invite.id }, select: { status: true, shortCode: true } });
  assert.equal(after.status, "Created");
  assert.equal(after.shortCode, invite.shortCode);
});

test("and a send that works still answers plainly", async () => {
  const answer = await sendInvite(await sendableInvite("b"), async () => ({ sent: true }));
  assert.equal(answer.statusCode, 200);
  assert.match(answer.body.message, /sent successfully/);
});
