const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const prisma = require("../src/config/db");
const service = require("../src/modules/hrm/interview/service");

/*
 * Last Follow-up on a candidate is written by the act of working them, and by nothing else.
 *
 * It used to be a date box on the Schedule Interview form, which asked HR to tell the register
 * something the register already knew - and worse, a box that had to be *remembered*. The column
 * means "the day somebody last worked this candidate", so one nobody updated said the opposite of
 * the truth rather than nothing at all.
 *
 * The half that is easy to lose is the other one: **the things that are not somebody following up
 * must not stamp it.** Three other paths write a candidate, and none of them is the studio working
 * one - the candidate's own submitted form, the CSV import and a linked sheet. If any of those
 * stamped it, the column would fill with days nobody did anything, which is worse than an empty one
 * because it reads as true. That is the same line the CRM board draws for its own Last Followup
 * Date, where a posted remark deliberately does not stamp it.
 *
 * Real rows, removed at the end - what is asserted is what the column actually holds afterwards.
 */

const STAMP = String(Date.now()).slice(-6);
const code = (suffix) => `LFU-${STAMP}-${suffix}`;
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

const SERVICE = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "hrm", "interview", "service.js"), "utf8");

after(async () => {
  await prisma.hrmInterviewCandidate.deleteMany({ where: { candidateCode: { startsWith: `LFU-${STAMP}` } } });
});

/** A candidate already carrying a stale follow-up date, so a stamp is visible when it happens. */
async function candidate(suffix, extra = {}) {
  return prisma.hrmInterviewCandidate.create({ data: {
    candidateCode: code(suffix), name: `Follow up ${suffix}`, status: "Yet to Connect",
    lastFollowUpDate: "2020-01-01", ...extra,
  } });
}

test("saving a candidate stamps the day they were worked", async () => {
  const row = await candidate("edit");
  await service.updateCandidate(row.id, { name: row.name, status: "Interview Scheduled" });
  const after = await prisma.hrmInterviewCandidate.findUnique({ where: { id: row.id }, select: { lastFollowUpDate: true } });
  assert.equal(after.lastFollowUpDate, today());
});

test("moving a stage from the row menu counts as working them", async () => {
  // The status route applies partially, and it is still somebody dealing with this candidate today -
  // putting them on hold or turning them down is the most definite kind of follow-up there is.
  const row = await candidate("status");
  await service.updateCandidate(row.id, { status: "On Hold" }, null, { partial: true });
  const after = await prisma.hrmInterviewCandidate.findUnique({ where: { id: row.id }, select: { lastFollowUpDate: true, status: true } });
  assert.equal(after.status, "On Hold");
  assert.equal(after.lastFollowUpDate, today());
});

test("a date posted in the body cannot set it to a day of its choosing", async () => {
  /*
   * The stamp is written **last**, over whatever arrived. An older tab still posting the field - or
   * anybody curious about the endpoint - must not be able to backdate when a candidate was worked.
   */
  const row = await candidate("posted");
  await service.updateCandidate(row.id, { name: row.name, status: "Yet to Connect", lastFollowUpDate: "1999-12-31" });
  const after = await prisma.hrmInterviewCandidate.findUnique({ where: { id: row.id }, select: { lastFollowUpDate: true } });
  assert.equal(after.lastFollowUpDate, today());
});

test("the candidate's own submitted form does not stamp it", async () => {
  /*
   * A candidate filling in their application is the candidate acting, not the studio following them
   * up. `invites.js` writes through `prepareValues` directly rather than through `updateCandidate`,
   * which is what keeps the two apart - so the stamp lives in `updateCandidate` and not in
   * `prepareValues`, where every one of those three other paths would have picked it up.
   */
  const row = await candidate("submitted");
  const prepared = await service.prepareValues({ city: "Chennai" }, { partial: true });
  assert.equal("lastFollowUpDate" in prepared, false, "preparing a submission stamped a follow-up");
  await prisma.hrmInterviewCandidate.update({ where: { id: row.id }, data: prepared });
  const after = await prisma.hrmInterviewCandidate.findUnique({ where: { id: row.id }, select: { lastFollowUpDate: true, city: true } });
  assert.equal(after.city, "Chennai", "the submission should still have been written");
  assert.equal(after.lastFollowUpDate, "2020-01-01", "a candidate's own submission stamped a follow-up");
});

test("the stamp is in the one path that means somebody worked the candidate", () => {
  // Pinned against the source as well as the rows, because "not in `prepareValues`" is an *absence*
  // - and an absence is exactly the kind of thing a later edit restores without anyone noticing.
  assert.match(SERVICE, /lastFollowUpDate: todayKey\(\)/);
  assert.equal((SERVICE.match(/lastFollowUpDate: todayKey\(\)/g) || []).length, 1, "the stamp is written in more than one place");
  const prepare = SERVICE.slice(SERVICE.indexOf("async function prepareValues"), SERVICE.indexOf("async function listCandidates"));
  assert.doesNotMatch(prepare, /lastFollowUpDate: todayKey\(\)/, "preparing values stamps a follow-up");
});
