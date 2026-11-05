const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { lastWorkingDateFrom, classifyInviteIdentifier, inviteStatuses, OPEN_STATUSES } = require("../src/modules/hrm/offboarding-invites/controller");

/*
 * The offboarding invite: the form HR sends somebody who is leaving.
 *
 * The flow is HR raises it against an employee with a number of notice days → the employee opens a
 * tokenised link and says when their notice starts → the form works out the last working day → HR
 * approves, and **that** writes the separation, which is what puts them on Serving Notice.
 *
 * Source-level where it has to be (the routes, the guards, the reuse), behavioural where the
 * arithmetic is - the date a person's last day falls on is the one figure here nobody should have to
 * work out twice.
 */

const read = (...parts) => fs.readFileSync(path.join(__dirname, "..", ...parts), "utf8");
const CONTROLLER = read("src", "modules", "hrm", "offboarding-invites", "controller.js");
const PUBLIC_ROUTES = read("src", "modules", "hrm", "offboarding-invites", "publicRoutes.js");
const HR_ROUTES = read("src", "modules", "hrm", "master-data", "routes.js");
const SEPARATIONS = read("src", "modules", "hrm", "separations", "controller.js");
const SCHEMA = read("prisma", "schema.prisma");
const HR_TEMPLATE_ROUTES = read("src", "modules", "settings", "message-templates", "routes.js");

const day = (date) => date.toISOString().slice(0, 10);

test("the last working day is the notice period counted from the day it starts", () => {
  /*
   * Calendar days, which is what a notice period means: 30 days from 5 Nov is 4 Dec - their last
   * working day - and the day after it is their first day gone. The first day of notice is a day
   * served, so a one-day notice starting today ends today; counting from the next day instead would
   * hand everybody an extra day.
   */
  assert.equal(day(lastWorkingDateFrom("2026-11-05", 30)), "2026-12-04");
  assert.equal(day(lastWorkingDateFrom("2026-11-05", 1)), "2026-11-05");
  assert.equal(day(lastWorkingDateFrom("2026-11-05", 0)), "2026-11-05");
  // Across a month end and a year end, since the arithmetic is days and not months.
  assert.equal(day(lastWorkingDateFrom("2026-12-20", 30)), "2027-01-18");
  assert.equal(day(lastWorkingDateFrom("2026-01-31", 60)), "2026-03-31");
  // Worked in UTC on a date-only value, so nobody's last day moves with the server's zone.
  assert.equal(day(lastWorkingDateFrom("2026-11-05T19:30:00+05:30", 30)), "2026-12-04");
  // Nothing to count from, or nothing to count: no date rather than a guess.
  assert.equal(lastWorkingDateFrom("", 30), null);
  assert.equal(lastWorkingDateFrom("2026-11-05", -1), null);
  assert.equal(lastWorkingDateFrom("2026-11-05", 1.5), null);
});

test("the link is opened by its short code or its long token, and by nothing else", () => {
  // The same two identifiers the onboarding link accepts, for the same reason: the shared URL
  // carries the short code, and the 64-hex token keeps links already sent working.
  assert.deepEqual(classifyInviteIdentifier("A7K9C2M4"), { where: { shortCode: "A7K9C2M4" } });
  assert.equal(classifyInviteIdentifier("a".repeat(64)).where.tokenHash.length, 64);
  for (const bad of ["", "   ", "123", "not-a-code", "a".repeat(63), "'; DROP TABLE"]) {
    assert.equal(classifyInviteIdentifier(bad), null, `${bad || "(blank)"} is not an identifier`);
  }
});

test("a form is open only before it is filled in, and Approved and Rejected are the end of it", () => {
  assert.deepEqual(inviteStatuses, ["Sent", "Verified", "Submitted", "Sent Back", "Approved", "Rejected", "Cancelled", "Expired"]);
  /*
   * The statuses the link still opens on. **Sent Back** is among them, which is the whole point of
   * it: a form with the wrong date is not a resignation to refuse, so it goes back on the same link
   * with their own answers still on it. A submitted form is with HR and a decided one is history.
   */
  assert.deepEqual(OPEN_STATUSES, ["Sent", "Verified", "Sent Back"]);
  assert.match(CONTROLLER, /if \(!OPEN_STATUSES\.includes\(invite\.status\)\) return \{ invite, state: "unavailable" \};/);
  // Cancelling is for a form nobody has filled in; a submitted one is read, not called off.
  assert.match(CONTROLLER, /if \(!OPEN_STATUSES\.includes\(invite\.status\)\) return res\.status\(409\)\.json\(\{ message: "Only a form that is still open can be cancelled\." \}\);/);
});

test("approving writes the separation through the one path that records one", () => {
  /*
   * The whole point of the feature's shape: Serving Notice, the hand-over, the reports shifted up,
   * the login closed on the right day and the roll-up that relieves them are all the separation's,
   * and approving a form goes through `recordSeparation` rather than touching the employee itself.
   * A second implementation of that would be the one that went stale.
   */
  assert.match(CONTROLLER, /const \{ recordSeparation \} = require\("\.\.\/separations\/controller"\);/);
  assert.match(CONTROLLER, /separation = await recordSeparation\(\{/);
  assert.match(CONTROLLER, /separationType: "Resignation",/);
  assert.match(CONTROLLER, /proposedLastWorkingDate: invite\.proposedLastWorkingDate,/);
  // Their own answers, in HR's vocabulary: the reason comes from the separation form's own list, so
  // the record reads - and reports - as though HR had filled it in.
  assert.match(CONTROLLER, /resignationDate: invite\.resignationDate \|\| invite\.submittedAt,/);
  assert.match(CONTROLLER, /noticePeriodRequired: invite\.noticePeriodDays,/);
  // And nothing here writes the employee: no status, no relieving date, no login.
  assert.doesNotMatch(CONTROLLER, /prisma\.employee\.update|employmentStatus:\s*"/);
  // The hand-over question comes back with what is pending, so the screen can ask it and retry.
  assert.match(CONTROLLER, /if \(error\?\.status === 409 && error\.pending\) return res\.status\(409\)\.json\(\{ message: error\.message, pending: error\.pending \}\);/);
  // `recordSeparation` is the extraction the route handler now calls too - one path, two callers.
  assert.match(SEPARATIONS, /async function recordSeparation\(\{ employeeId, inviteId, resignationLetter, handOverToEmployeeId, actorId, input \}\)/);
  assert.match(SEPARATIONS, /const data = await recordSeparation\(\{ employeeId, inviteId, resignationLetter, handOverToEmployeeId, actorId, input \}\);/);
});

test("a submitted form changes nothing about the employee until HR approves it", () => {
  // The studio's own rule: filling it in records the dates and queues it; HR is who commits an exit,
  // so a form filled in by mistake and rejected leaves the employment exactly as it was.
  // The function itself, not the comment of the next one: `reviewInvite`'s doc names the separation
  // path it calls, and this is about what the submission *does*.
  const submitAt = CONTROLLER.indexOf("async function submitPublicInvite");
  const submit = CONTROLLER.slice(submitAt, CONTROLLER.indexOf("\n/**", submitAt));
  assert.match(submit, /status: "Submitted",/);
  assert.doesNotMatch(submit, /recordSeparation|dateOfRelieving/);
  // Rejection says why, and the form cannot be decided twice.
  assert.match(CONTROLLER, /if \(decision === "Rejected" && !remark\) return res\.status\(400\)\.json\(\{ message: "Say why the form was not accepted\." \}\);/);
  assert.match(CONTROLLER, /if \(invite\.status !== "Submitted"\)/);
});

test("who a form can be raised against, and only one at a time", () => {
  // Somebody working here, not already serving notice, with no form open - which is also the
  // dropdown HR picks from, so the list and the refusal cannot disagree.
  assert.match(CONTROLLER, /employmentStatus: \{ in: await workingEmployeeStatuses\(\) \}, dateOfRelieving: null, AND: \[visible\.where\]/);
  assert.match(CONTROLLER, /status: \{ in: \[\.\.\.OPEN_STATUSES, "Submitted"\] \}/);
  assert.match(CONTROLLER, /is already serving notice\./);
  assert.match(CONTROLLER, /This employee already has an offboarding form open\./);
});

test("the employee's own form is public by token, rate-limited and never cached; HR's side is guarded", () => {
  assert.match(PUBLIC_ROUTES, /router\.use\(createPublicLinkLimiter\("offboarding"\)\);/);
  assert.match(PUBLIC_ROUTES, /res\.set\("Cache-Control", "no-store, must-revalidate"\);/);
  assert.match(PUBLIC_ROUTES, /router\.get\("\/invites\/:token", getPublicInvite\);/);
  assert.match(PUBLIC_ROUTES, /router\.post\("\/invites\/:token\/verify", verifyPublicInvite\);/);
  assert.match(PUBLIC_ROUTES, /router\.post\("\/invites\/:token\/submit", submitPublicInvite\);/);
  // Nothing is handed back before the link's holder proves who they are: masked until then.
  assert.match(CONTROLLER, /maskedEmail: maskEmail\(invite\.employee\?\.emailId\)/);
  assert.match(CONTROLLER, /if \(!invite\.verifiedAt\) return res\.status\(409\)\.json\(\{ message: "Verify your email or phone before sending the form\." \}\);/);
  // A public form may not point the studio's letter link at a url of its own choosing.
  assert.match(CONTROLLER, /folder: OFFBOARDING_LETTER_FOLDER, trustUrls: false/);

  // HR's side: the same permission that records a separation by hand - this is the same act.
  assert.match(HR_ROUTES, /router\.get\("\/offboarding-invites", checkPermission\("HRM", "Employee Management", "READ"\), offboarding\.listInvites\);/);
  assert.match(HR_ROUTES, /router\.get\("\/offboarding-invites\/candidates", checkPermission\("HRM", "Employee Management", "READ"\), offboarding\.listCandidates\);/);
  for (const route of ["offboarding-invites\", offboarding.createInvite", "/:id/send-email\", offboarding.sendInviteEmail", "/:id/cancel\", offboarding.cancelInvite", "/:id/review\", offboarding.reviewInvite"]) {
    assert.ok(HR_ROUTES.includes(route), `${route} is mounted`);
  }
  // `/candidates` above `/:id`, or "candidates" is read as a form's id.
  assert.ok(HR_ROUTES.indexOf("/offboarding-invites/candidates") < HR_ROUTES.indexOf("/offboarding-invites/:id"));
});

test("the table links by id, keeps the dates it acts on, and is added by a migration", () => {
  // Rule 5: the employee is a link, not a name typed onto the row - they already have a record.
  const model = SCHEMA.slice(SCHEMA.indexOf("model EmployeeOffboardingInvite"));
  const body = model.slice(0, model.indexOf("\n}\n"));
  assert.match(body, /employeeId\s+Int\s+@map\("employee_id"\)/);
  assert.match(body, /employee\s+Employee\s+@relation\("EmployeeOffboardingInvites", fields: \[employeeId\], references: \[id\], onDelete: Cascade\)/);
  assert.doesNotMatch(body, /employeeName/);
  /*
   * The two dates the employee answers with, and **only** those two.
   *
   * The resignation date and the day they propose as their last are answers; where the notice period
   * ends is arithmetic over them and the days HR set, so it is computed on every read rather than
   * stored. A third column holding it would be the one that disagreed the moment either input was
   * corrected - and HR's screen needs the difference between the proposal and the computed end,
   * which is exactly what a stale copy would get wrong.
   */
  assert.match(body, /resignationDate\s+DateTime\? @map\("resignation_date"\) @db\.Date/);
  assert.match(body, /proposedLastWorkingDate DateTime\? @map\("proposed_last_working_date"\) @db\.Date/);
  assert.doesNotMatch(body, /expectedLastWorkingDate|noticeEndsOn|noticeStartDate/);
  assert.match(body, /noticePeriodDays\s+Int\s+@map\("notice_period_days"\)/);
  // One form becomes one separation.
  assert.match(body, /separationId\s+Int\?\s+@unique @map\("separation_id"\)/);

  const dir = path.join(__dirname, "..", "prisma", "migrations");
  const folder = fs.readdirSync(dir).find((name) => name.endsWith("_employee_offboarding_invite"));
  assert.ok(folder, "the migration is missing - a schema change that never reaches production");
  const sql = fs.readFileSync(path.join(dir, folder, "migration.sql"), "utf8");
  assert.match(sql, /CREATE TABLE `employee_offboarding_invite`/);
  assert.match(sql, /`employee_offboarding_invite_employee_id_fkey`[\s\S]*ON DELETE CASCADE/);
  assert.match(sql, /`employee_offboarding_invite_separation_id_fkey`[\s\S]*ON DELETE SET NULL/);
  // A new table only: nothing existing is touched, so nothing can fail on production data.
  assert.doesNotMatch(sql, /DROP TABLE|ALTER TABLE `employee`|ALTER TABLE `employee_separation` (?!ADD)/);
});

test("the code is the studio's own run, and the email goes where the studio reaches them", () => {
  assert.match(read("src", "services", "identifiers.js"), /OFFBOARDING_INVITE: \{ tag: "OFB", parts: \[\], width: 5, model: "employeeOffboardingInvite", field: "offboardingId" \}/);
  // Their own address, not the login one, which stops working the day they are relieved.
  assert.match(CONTROLLER, /const to = invite\.employee\?\.emailId;/);
  assert.match(read("src", "services", "emailService.js"), /async function sendOffboardingInviteEmail\(\{ employeeName, email, offboardingUrl, expiresAt, noticePeriodDays \}\)/);
});

test("nobody reads or writes a form about somebody out of their reach", () => {
  /*
   * `HRM / Employee Management` is held per branch. Without this the register listed every
   * resignation in the studio to a branch's HR, the dropdown offered them anybody to raise one
   * against, and the four writes took an id straight from the request - so a form could be raised,
   * sent, cancelled or **approved** for an employee in a branch the caller does not reach.
   *
   * One definition does all of it: the Employee Repository's own `employeeVisibility`, which names
   * the permission it is asking about, as Rule 4's branch reach requires.
   */
  assert.match(CONTROLLER, /require\("\.\.\/employees\/controller"\)\.employeeVisibility\(req, level\)/);
  // The register and the dropdown are narrowed by it.
  // Archived people are left out too: a form about one was listed and then 404'd on every action.
  assert.match(CONTROLLER, /where: \{ employee: \{ archivedAt: null, AND: \[visible\.where\] \} \}/);
  // Picking somebody is the start of changing their record, so the dropdown asks at write level.
  assert.match(CONTROLLER, /employeeVisibility\(req, "READ_WRITE"\)/);
  // An id from the body is never trusted, and a form by id is loaded through the same reach.
  assert.match(CONTROLLER, /const employee = await reachableEmployee\(req, employeeId, "READ_WRITE"\);/);
  assert.match(CONTROLLER, /async function scopedInvite\(req, res, level = "READ_WRITE"\)/);
  assert.match(CONTROLLER, /if \(!invite \|\| !\(await reachableEmployee\(req, invite\.employeeId, level\)\)\)/);
  // Out of reach reads as "no such form" - which is what their own register already told them -
  // rather than a 403 that confirms it exists.
  const scoped = CONTROLLER.slice(CONTROLLER.indexOf("async function scopedInvite"), CONTROLLER.indexOf("/** Emails the form"));
  assert.doesNotMatch(scoped, /403/);
  assert.equal(scoped.match(/Offboarding form not found\./g).length, 2);
  // Delete - a row's ⋮ and the ticked rows alike - asks the same reach at write level, and out of
  // reach is "not found" there too.
  const remove = CONTROLLER.slice(CONTROLLER.indexOf("async function deleteInviteRecord"), CONTROLLER.indexOf("async function deleteInvite("));
  assert.match(remove, /if \(!invite \|\| !\(await reachableEmployee\(req, invite\.employeeId, "READ_WRITE"\)\)\) \{\n\s+throw Object\.assign\(new Error\("Offboarding form not found\."\), \{ status: 404 \}\);/);
  // And the three :id handlers go through it rather than a bare findUnique.
  for (const handler of ["sendInviteEmail", "cancelInvite", "reviewInvite"]) {
    const at = CONTROLLER.indexOf(`async function ${handler}`);
    const body = CONTROLLER.slice(at, CONTROLLER.indexOf("\n}", at));
    assert.match(body, /await scopedInvite\(req, res\)/, handler);
    assert.doesNotMatch(body, /employeeOffboardingInvite\.findUnique\(\{ where: \{ id: id\.data \}/, handler);
  }
});

test("a form is submitted once and decided once, whatever arrives at the same moment", () => {
  /*
   * Check-then-write was a race on both sides. Two sends - a double tap, a link open twice - both
   * passed the status check and the second overwrote the first's dates while storing a second
   * letter; two approvals both reached `recordSeparation` and would have written the person two
   * separations. Each is claimed with a conditional update, and the loser is told so.
   */
  assert.match(CONTROLLER, /where: \{ id: invite\.id, status: \{ in: OPEN_STATUSES \} \},[\s\S]{0,400}status: "Submitted",/);
  assert.match(CONTROLLER, /return res\.status\(410\)\.json\(\{ state: "submitted", message: "You have already sent this form to HR\." \}\);/);
  /*
   * And the letter is stored **before** the claim, with the claim writing it.
   *
   * The other way round - claim, then store - spent the employee's one submission on an error:
   * `storeDocument` refuses a file too large, a type this form does not take, or bytes that do not
   * carry the type they claim, and by then the form was Submitted with no letter and their link
   * answered "already sent". Stored first, a refusal leaves the form open and they try again; a
   * submission that loses the race deletes what it uploaded.
   */
  const submit = CONTROLLER.slice(CONTROLLER.indexOf("async function submitPublicInvite"));
  assert.ok(submit.indexOf("await storeDocument") < submit.indexOf("const claimed ="));
  assert.match(submit, /\.\.\.\(letter \? \{ letterKey: letter\.key/);
  assert.match(submit, /if \(letter\?\.key\) await deleteObject\(letter\.key\)\.catch\(\(\) => \{\}\);/);
  // The decision is claimed before the separation is written, and put back if writing it fails -
  // so an approval that bounces on the hand-over returns to HR's queue rather than being lost.
  assert.match(CONTROLLER, /where: \{ id: invite\.id, status: "Submitted" \},[\s\S]{0,200}status: decision,/);
  assert.match(CONTROLLER, /data: \{ status: "Submitted", reviewedAt: null, reviewedByUserId: null, reviewRemark: null \},/);
  const review = CONTROLLER.slice(CONTROLLER.indexOf("async function reviewInvite"));
  assert.ok(review.indexOf("await claim()") < review.indexOf("await recordSeparation"));
  // Three: the read before the claim, and the claim itself on each branch of the decision.
  assert.equal((review.match(/This form has already been decided\./g) || []).length, 3);
  // Cancelling is claimed too: a form being filled in at that moment is not called off from under
  // a submission that has already gone through.
  assert.match(CONTROLLER, /This form has just been filled in, so it can no longer be cancelled\./);
});

test("the link's gate narrows with every wrong answer, and says little to begin with", () => {
  /*
   * The only throttle was the network-wide miss budget, which a guesser defeats by changing
   * address, and the mask handed them the shape of the answer: the first two letters of the email
   * name, its length, and the last four digits of the phone. Behind the link is somebody's
   * resignation, so the mask is part of the gate.
   */
  assert.match(CONTROLLER, /const MAX_VERIFY_FAILURES = 5;/);
  /*
   * The try is **taken** in the statement that checks for one, because read-then-compare-then-
   * increment was not a cap: fifty requests at once all read the count as 0 and all passed.
   */
  assert.match(CONTROLLER, /where: \{ id: invite\.id, verifyFailures: \{ lt: MAX_VERIFY_FAILURES \} \},\s*\n\s*data: \{ verifyFailures: \{ increment: 1 \} \},/);
  assert.match(CONTROLLER, /if \(!tryTaken\.count\)/);
  // And the lock is a window, not for ever: a permanent one is a weapon against the leaver, since
  // anybody holding a forwarded link could spend the five and shut them out of their own form.
  assert.match(CONTROLLER, /const VERIFY_LOCK_MINUTES = 30;/);
  assert.match(CONTROLLER, /verifyLockedUntil: new Date\(now\.getTime\(\) \+ VERIFY_LOCK_MINUTES \* 60_000\)/);
  assert.match(CONTROLLER, /if \(invite\.verifyLockedUntil && invite\.verifyLockedUntil > now\)/);
  // HR sending the link again hands the tries back, so a lock never costs a cancel and re-raise.
  assert.match(CONTROLLER, /data: \{ verifyFailures: 0, verifyLockedUntil: null \} \}\);/);
  // A success clears the count, and moves the status only while the form is still open - a form HR
  // cancelled mid-answer must not be reopened as Verified.
  assert.match(CONTROLLER, /verifiedAt: now, verifyFailures: 0, verifyLockedUntil: null,/);
  assert.match(CONTROLLER, /const opened = await prisma\.employeeOffboardingInvite\.updateMany\(\{\s*\n\s*where: \{ id: invite\.id, status: \{ in: OPEN_STATUSES \} \},/);
  // The mask keeps the domain and two digits, and neither the local part's letters nor its length.
  assert.match(CONTROLLER, /return `••••@\$\{domain\}`;/);
  assert.match(CONTROLLER, /digits\.length >= 2 \? `••••••\$\{digits\.slice\(-2\)\}`/);
  // The number is compared by the onboarding invite's own rule rather than a second copy of it.
  assert.match(CONTROLLER, /const \{ phonesMatch \} = require\("\.\.\/onboarding-invites\/controller"\);/);
  assert.match(CONTROLLER, /phonesMatch\(typed, invite\.employee\?\.contactNumber\)/);
  // The column the counter lives in exists, with its default.
  assert.match(SCHEMA, /verifyFailures\s+Int\s+@default\(0\) @map\("verify_failures"\)/);
  const migration = fs.readFileSync(path.join(__dirname, "..", "prisma", "migrations", "20261026090000_employee_offboarding_invite", "migration.sql"), "utf8");
  assert.match(migration, /`verify_failures` INTEGER NOT NULL DEFAULT 0/);
  assert.match(SCHEMA, /verifyLockedUntil\s+DateTime\? @map\("verify_locked_until"\)/);
  assert.match(migration, /`verify_locked_until` DATETIME\(3\) NULL/);
});

test("an unauthenticated upload is a letter, and the bytes have to agree", () => {
  // The form accepts a signed page or a photograph of one. A spreadsheet or a Word macro document
  // is not a resignation letter, and HR is who opens whatever lands here.
  assert.deepEqual(require("../src/modules/hrm/offboarding-invites/controller").LETTER_TYPES, ["application/pdf", "image/jpeg", "image/png", "image/webp"]);
  assert.match(CONTROLLER, /trustUrls: false, types: LETTER_TYPES/);
  // No `url` field at all: `trustUrls: false` discards one anyway, and a field that is always
  // dropped is one somebody later believes in.
  assert.doesNotMatch(CONTROLLER.slice(CONTROLLER.indexOf("const documentSchema"), CONTROLLER.indexOf("const createSchema")), /url:/);
  // And the declared type is checked against the file's own first bytes.
  const { matchesSignature } = require("../src/services/documentStorage");
  assert.equal(matchesSignature(Buffer.from("%PDF-1.7 ..."), "application/pdf"), true);
  assert.equal(matchesSignature(Buffer.from("<html><script>"), "application/pdf"), false);
  assert.equal(matchesSignature(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), "image/png"), true);
  assert.equal(matchesSignature(Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP")]), "image/webp"), true);
  // A type with no signature to check - a docx is a zip, a csv is text - is left to the allow-list.
  assert.equal(matchesSignature(Buffer.from("a,b,c"), "text/csv"), true);
});

test("a public route's error log carries no part of what was submitted", () => {
  // A Prisma error prints its query's arguments, and here those are the reason somebody is leaving,
  // the note they wrote, and in development the letter itself as inline base64.
  assert.match(CONTROLLER, /function handlePublicError\(res, error, fallback\)/);
  assert.match(CONTROLLER, /console\.error\(`\$\{fallback\} \[\$\{error\?\.code \|\| error\?\.name \|\| "error"\}\] \$\{String\(error\?\.message \|\| ""\)\.slice\(0, 200\)\}`\)/);
  for (const handler of ["getPublicInvite", "verifyPublicInvite", "submitPublicInvite"]) {
    const at = CONTROLLER.indexOf(`async function ${handler}`);
    assert.match(CONTROLLER.slice(at, CONTROLLER.indexOf("\n}", at)), /handlePublicError/, handler);
  }
});

test("the invite's designation is the linked one, not the copy the row was written with", () => {
  // `designation` is a name copy, and the extension that resolves copies does not reach inside a
  // nested include - so an invite read through `include: { employee }` carried whatever the copy
  // said when it was written, which a rename in master data has since moved on from.
  assert.match(CONTROLLER, /designationRef: \{ select: \{ name: true \} \},/);
  assert.match(CONTROLLER, /designation: employee\?\.designationRef\?\.name \|\| employee\?\.designation \|\| null,/);
});

test("a dead link says why in a word, so the page can tell an ending from a failure", () => {
  /*
   * A form already sent in is not an error: it is this link's ordinary end, and a red "cannot be
   * opened" for somebody who did everything right reads as their resignation having gone wrong. The
   * page tones itself from `state` rather than matching on the wording of the message.
   */
  assert.match(CONTROLLER, /Cancelled: \["cancelled",/);
  assert.match(CONTROLLER, /Submitted: \["submitted", "You have already sent this form to HR\."\],/);
  assert.match(CONTROLLER, /\|\| \["expired",/);
  assert.match(CONTROLLER, /return res\.status\(410\)\.json\(\{ state, message \}\);/);
});

test("an approval that fails is not reported as one, and one that lands is never undone", () => {
  /*
   * Three states this has to get right, and each of them was wrong once:
   *
   *   - `recordSeparation` refusing (the hand-over question) must return the form to HR's queue;
   *   - a revert that itself fails must not swallow that refusal, or HR is left with a form reading
   *     Approved and the question never asked;
   *   - and once the separation exists the person **is** serving notice, so a stamp that will not
   *     write is logged rather than used as a reason to pretend the exit did not happen.
   */
  const review = CONTROLLER.slice(CONTROLLER.indexOf("async function reviewInvite"));
  assert.match(review, /data: \{ status: "Submitted", reviewedAt: null, reviewedByUserId: null, reviewRemark: null \},/);
  assert.match(review, /\} catch \(revertError\) \{/);
  assert.match(review, /throw error;/);
  assert.ok(review.indexOf("catch (revertError)") < review.indexOf("throw error"));
  assert.match(review, /data: \{ separationId: separation\.id \}, include: listInclude \}\)\s*\n\s*\.catch\(/);
  // The hand-over is the last id that came from the body, so it is checked like the first one.
  assert.match(review, /const taker = await reachableEmployee\(req, handOverToEmployeeId, "READ_WRITE"\);/);
  assert.match(review, /Pick somebody other than the person leaving/);
  assert.match(review, /so the work cannot be handed to them/);
});

test("every employee field this module selects exists on the model", () => {
  /*
   * Not a source pin: the field names themselves, checked against `schema.prisma`.
   *
   * The register shipped selecting `loginEmail`, which is not a column on Employee at all - the
   * login's address lives on the `login` relation - and nothing here noticed, because every other
   * test in this file reads the source as text. Prisma refused the query at runtime, so the screen
   * was empty and the log carried a validation error, which is the wrong place to find out.
   */
  const model = SCHEMA.slice(SCHEMA.indexOf("\nmodel Employee {"));
  const fields = new Set(model.slice(0, model.indexOf("\n}")).split("\n")
    .map((line) => /^\s{2}(\w+)\s/.exec(line)?.[1])
    .filter(Boolean));
  assert.ok(fields.size > 50, "the Employee model was not read");
  const { listInclude } = require("../src/modules/hrm/offboarding-invites/controller");
  for (const field of Object.keys(listInclude.employee.select)) {
    assert.ok(fields.has(field), `employeeSelect names \`${field}\`, which Employee does not have`);
  }
  // The two the screens actually read through, named here so a rename cannot quietly drop them.
  assert.ok(fields.has("emailId") && fields.has("designationRef"));
});

test("the flow's four messages are template keys with a migration behind them", () => {
  /*
   * A key the application fills in is only half of a message: without a row in `message_template`
   * the Settings box opens empty and every screen falls back to its built-in wording, silently. The
   * seed cannot be run on the VPS, so the rows ship in a migration with `WHERE NOT EXISTS` - a
   * studio that has already reworded one keeps what it wrote.
   */
  const { TEMPLATE_KEYS } = require("../src/services/messageTemplate");
  const migration = fs.readFileSync(path.join(__dirname, "..", "prisma", "migrations", "20261027090000_offboarding_form_message_template", "migration.sql"), "utf8");
  const keys = ["EMPLOYEE_OFFBOARDING_FORM", "EMPLOYEE_OFFBOARDING_REMINDER", "EMPLOYEE_OFFBOARDING_APPROVED", "EMPLOYEE_OFFBOARDING_NOT_ACCEPTED"];
  for (const key of keys) {
    assert.equal(TEMPLATE_KEYS[key], key);
    assert.match(migration, new RegExp(`SELECT '${key}', '[^']+', '`), key);
    assert.match(migration, new RegExp(`WHERE NOT EXISTS \\(SELECT 1 FROM \`message_template\` WHERE \`key\` = '${key}'\\)`), key);
  }
  // Every placeholder the bodies use is one a screen answers, and nothing is left as `{...}` prose.
  const { placeholdersIn } = require("../src/services/messageTemplate");
  const answered = new Set(["employee name", "offboarding link", "notice period", "expiry date", "notice start date", "last working day", "hr remark"]);
  for (const body of migration.match(/SELECT 'EMPLOYEE_OFFBOARDING[^']+', '[^']+', '([\s\S]*?)'\nWHERE NOT EXISTS/g) || []) {
    for (const name of placeholdersIn(body)) assert.ok(answered.has(name), `no screen answers {${name}}`);
  }
  // Reading a template is already granted to HRM / Employee Management, which is what the
  // offboarding screens hold - so no route changes, and HR is not handed the fallback wording.
  assert.match(HR_TEMPLATE_ROUTES, /\{ module: "HRM", feature: "Employee Management", level: "READ" \}/);
});

test("the form asks the four questions a resignation is made of, and the reason is a list", () => {
  /*
   * The studio's own resignation form: the record read back (employee id, name, designation, team,
   * manager, joining date, official email), then the resignation date, the reason, anything more
   * they want to say, and the last working day they propose.
   *
   * The reason is `z.enum` over HR's own list rather than free text. A typed reason is
   * unreportable - the studio cannot count how many people left for a better opportunity if each of
   * them worded it differently - and the list is sent **with the form** so the two sides cannot
   * drift. Anything that does not fit is "Others" plus the detailed reason.
   */
  const { RESIGNATION_REASONS, autoFilledFrom } = require("../src/modules/hrm/offboarding-invites/controller");
  const { separationReasonsByType } = require("../../frontend/src/constants/separationFormConfig.js");
  assert.deepEqual(RESIGNATION_REASONS, separationReasonsByType.Resignation, "the list has drifted from the separation form's own");
  assert.match(CONTROLLER, /reason: z\.enum\(RESIGNATION_REASONS\)/);
  assert.match(CONTROLLER, /reasons: RESIGNATION_REASONS,/);

  // The seven auto-filled answers, read off the record rather than asked for - and the login
  // address is deliberately not among them: it is a credential, not a contact detail.
  const filled = autoFilledFrom({
    employeeId: "DBS-12",
    employeeName: "Asha",
    designation: "Editor",
    designationRef: { name: "Senior Editor" },
    department: "Post",
    departments: [{ department: { name: "Post Production" } }, { department: { name: "Design" } }],
    reportsTo: { employeeName: "Ravi", designation: "Lead", designationRef: { name: "Creative Lead" } },
    dateOfJoining: new Date("2024-03-01T00:00:00.000Z"),
    workEmailId: "asha@studio.example",
    emailId: "asha@personal.example",
  });
  assert.deepEqual(Object.keys(filled).sort(), ["dateOfJoining", "department", "designation", "employeeCode", "employeeName", "officialEmail", "reportingManager", "reportingManagerDesignation"]);
  // The linked name wins over the text copy, in both places one exists.
  assert.equal(filled.designation, "Senior Editor");
  assert.equal(filled.department, "Post Production, Design");
  assert.equal(filled.reportingManagerDesignation, "Creative Lead");
  // The work address where the studio gave them one; their own only as the fallback.
  assert.equal(filled.officialEmail, "asha@studio.example");
  assert.equal(autoFilledFrom({ emailId: "only@personal.example" }).officialEmail, "only@personal.example");
  // Nothing linked leaves the text copy to answer, and no employee leaves nothing to answer with.
  assert.equal(autoFilledFrom({ department: "Post" }).department, "Post");
  assert.equal(autoFilledFrom(null), null);
});

test("the last working day is the server's arithmetic and nothing else", () => {
  /*
   * The employee answers with **one** date - the day they are resigning - and the last working day
   * is the notice period counted from it. The browser is shown that date and never sends it: a form
   * that posted it would be a second answer to the one question this form exists to settle, and the
   * one somebody could quietly shorten. Leaving earlier is a conversation with HR, who set the notice
   * period and can change the date on the separation itself.
   */
  const submit = CONTROLLER.slice(CONTROLLER.indexOf("async function submitPublicInvite"));
  assert.match(submit, /const proposed = lastWorkingDateFrom\(resignationKey, invite\.noticePeriodDays\);/);
  assert.match(submit, /proposedLastWorkingDate: proposed,/);
  // Nothing about that date is read off the request.
  assert.doesNotMatch(submit, /parsed\.data\.proposedLastWorkingDate/);
  const schema = CONTROLLER.slice(CONTROLLER.indexOf("const submitSchema"), CONTROLLER.indexOf("const reviewSchema"));
  assert.doesNotMatch(schema, /proposedLastWorkingDate/);
  // And it is stored rather than recomputed on every read: it is the date the studio acts on, and
  // the date the employee was shown when they submitted.
  assert.match(CONTROLLER, /proposedLastWorkingDate: invite\.proposedLastWorkingDate,/);
  assert.doesNotMatch(CONTROLLER, /noticeEndsOn/);
});

test("a submission can be handed back for a correction, which is not a refusal", () => {
  /*
   * The move that was missing between approving and rejecting. Rejecting says the resignation itself
   * was not accepted - a different thing to tell somebody, and it leaves them nothing to fix. This
   * reopens the same link with their own answers on it and HR's remark saying what to look at.
   */
  const { sendBackSchema } = require("../src/modules/hrm/offboarding-invites/controller");
  // The remark is required: "please check it" is not an answer to which of four fields is wrong.
  assert.equal(sendBackSchema.safeParse({}).success, false);
  assert.equal(sendBackSchema.safeParse({ remark: "   " }).success, false);
  assert.equal(sendBackSchema.safeParse({ remark: "The date is wrong" }).success, true);
  // And nothing else rides along with it.
  assert.equal(sendBackSchema.safeParse({ remark: "ok", status: "Approved" }).success, false);

  const sendBack = CONTROLLER.slice(CONTROLLER.indexOf("async function sendBackInvite"), CONTROLLER.indexOf("the employee's own link"));
  // Only a form waiting on HR, scoped like every other write, and claimed on that status - a form
  // being approved in another tab must not be reopened from under the separation it is writing.
  assert.match(sendBack, /const invite = await scopedInvite\(req, res\);/);
  assert.match(sendBack, /if \(invite\.status !== "Submitted"\)/);
  assert.match(sendBack, /where: \{ id: invite\.id, status: "Submitted" \},[\s\S]{0,300}status: "Sent Back",/);
  assert.match(sendBack, /This form has just been decided, so it cannot be sent back\./);
  // Their answers stay; only the submission is undone, and the link is given a week to be fixed in.
  assert.match(sendBack, /submittedAt: null,/);
  assert.doesNotMatch(sendBack, /resignationDate: null|reason: null|proposedLastWorkingDate: null|letterKey: null/);
  assert.match(sendBack, /Math\.max\(invite\.expiresAt\.getTime\(\), Date\.now\(\) \+ 7 \* 86_400_000\)/);
  // Nothing about the employee is touched, because a submission never changed it.
  assert.doesNotMatch(sendBack, /prisma\.employee\.update|recordSeparation/);
  // The email is the least of it: the form is already open again, so a refusal is a warning beside
  // a success rather than an error that suggests nothing happened.
  assert.match(sendBack, /emailSent: !emailFailure,/);
  assert.match(sendBack, /warning: `The form was reopened, but the email could not be sent/);

  // The employee's own answers are handed back so the form is an edit, and only for a form that has
  // actually been round once.
  assert.match(CONTROLLER, /answers: updated\.sentBackAt \? \{/);
  assert.match(CONTROLLER, /sendBackRemark: updated\.sentBackAt \? updated\.sendBackRemark : null,/);

  // The route is mounted under the same permission as the other writes.
  assert.match(HR_ROUTES, /router\.post\("\/offboarding-invites\/:id\/send-back", offboarding\.sendBackInvite\);/);
  // And the three columns it needs exist, in a migration of their own.
  assert.match(SCHEMA, /sentBackAt\s+DateTime\? @map\("sent_back_at"\)/);
  assert.match(SCHEMA, /sendBackRemark\s+String\?\s+@map\("send_back_remark"\) @db\.Text/);
  const migration = fs.readFileSync(path.join(__dirname, "..", "prisma", "migrations", "20261027120000_offboarding_send_back", "migration.sql"), "utf8");
  assert.match(migration, /ADD COLUMN `sent_back_at` DATETIME\(3\) NULL/);
  assert.match(migration, /ADD COLUMN `send_back_remark` TEXT NULL/);
  assert.match(migration, /`employee_offboarding_invite_sent_back_by_user_id_fkey`[\s\S]*ON DELETE SET NULL/);
});

test("a form still open can be corrected, and only in the two ways HR answered it", () => {
  /*
   * The notice period typed wrongly, or the note HR meant to add. Not who the form is for: that
   * would leave the employee who was emailed the link holding one that names somebody else, and the
   * register would lose the fact that the first form existed. And not once it has been filled in -
   * changing the notice period then moves a last working day the employee has already been shown
   * and agreed to, which is what Send Back exists for.
   */
  const { updateSchema } = require("../src/modules/hrm/offboarding-invites/controller");
  assert.equal(updateSchema.safeParse({ noticePeriodDays: 45 }).success, true);
  assert.equal(updateSchema.safeParse({ noticePeriodDays: 45, hrNote: "Sorry, 45 not 30" }).success, true);
  // Neither the subject nor the status rides along.
  assert.equal(updateSchema.safeParse({ noticePeriodDays: 45, employeeId: 7 }).success, false);
  assert.equal(updateSchema.safeParse({ noticePeriodDays: 45, status: "Approved" }).success, false);
  // And the notice period is still a whole number of days within a year.
  assert.equal(updateSchema.safeParse({ noticePeriodDays: -1 }).success, false);
  assert.equal(updateSchema.safeParse({ noticePeriodDays: 400 }).success, false);

  const update = CONTROLLER.slice(CONTROLLER.indexOf("async function updateInvite"), CONTROLLER.indexOf("A submission handed back"));
  // Scoped like every other write, and open only.
  assert.match(update, /const invite = await scopedInvite\(req, res\);/);
  assert.match(update, /if \(!OPEN_STATUSES\.includes\(invite\.status\)\)/);
  assert.match(update, /Send it back if the notice period is wrong/);
  // The token, the hash and the short code are not touched, so their copy of the link keeps working.
  assert.doesNotMatch(update, /tokenHash|shortCode|token:/);
  assert.match(HR_ROUTES, /router\.patch\("\/offboarding-invites\/:id", offboarding\.updateInvite\);/);
});

test("approving only puts them on Serving Notice: the work and the team move when they go", () => {
  /*
   * The studio's own rule, and it is about *when*, not whether.
   *
   * `recordSeparation` used to move the leaver's direct reports up and demand a receiver for their
   * pending work the moment a separation was recorded. For anybody serving notice that is weeks
   * early: they are still coming in, still running their team, still the person doing the work on
   * their own name - and it made approving a resignation either ask who takes over a day that had
   * not arrived, or refuse the resignation outright because nobody above them was free to take
   * their reports.
   *
   * So both wait for the day they become **InActive**. The reporting line moves itself then
   * (`relieve.js`), and the pending work is handed over by HR from the InActive row, through the
   * same `handOver` an immediate separation runs.
   *
   * A separation with no notice to serve - an absconding, a termination today, a last working day
   * already past - makes them InActive *now*, so for those this still happens in `recordSeparation`.
   */
  const record = SEPARATIONS.slice(SEPARATIONS.indexOf("async function recordSeparation"), SEPARATIONS.indexOf("async function getPendingWork"));
  // The effect is decided before either step, and both sit behind it.
  assert.ok(record.indexOf("const effect = separationEffect(") < record.indexOf("shiftDirectReportsUp"));
  assert.match(record, /if \(!effect\.relievedAt\) \{\s*\n\s*\/\/ Serving notice: nothing is taken off them yet\.\s*\n\s*\} else \{/);
  assert.match(record, /\} else \{[\s\S]{0,600}await shiftDirectReportsUp\(subject\.id, tx\);/);
  assert.match(record, /\} else \{[\s\S]{0,900}Choose who takes over this employee's pending work\./);

  // Relieving moves the reporting line, and a refusal there does not block the exit: the login must
  // close on the right day whatever the org chart looks like.
  const relieve = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "hrm", "separations", "relieve.js"), "utf8");
  assert.match(relieve, /const \{ shiftDirectReportsUp \} = require\("\.\.\/\.\.\/\.\.\/services\/reportingLine"\);/);
  assert.match(relieve, /try \{\s*\n\s*await shiftDirectReportsUp\(separation\.employeeId, tx\);\s*\n\s*\} catch \(error\) \{/);
  assert.match(relieve, /unmovedReports\.push/);
  assert.ok(relieve.indexOf("await closeLogin(tx, separation.employeeId);") < relieve.indexOf("await shiftDirectReportsUp"));

  // And HR's way to move the work once they have gone, refused while they still work here.
  const handOver = SEPARATIONS.slice(SEPARATIONS.indexOf("async function handOverPendingWork"), SEPARATIONS.indexOf("async function updateSeparation"));
  assert.match(handOver, /const \{ scopedEmployee \} = require\("\.\.\/employees\/controller"\);/);
  assert.match(handOver, /level: "READ_WRITE"/);
  assert.match(handOver, /is serving notice and is still doing their own work/);
  assert.match(handOver, /still works here, so there is nothing to hand over/);
  assert.match(HR_ROUTES, /router\.post\("\/separations\/pending-work\/:employeeId", checkPermission\("HRM", "Employee Management", "READ_WRITE"\), handOverPendingWork\);/);
});
