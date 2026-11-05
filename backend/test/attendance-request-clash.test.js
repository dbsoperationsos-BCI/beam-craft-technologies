const test = require("node:test");
const assert = require("node:assert/strict");
const prisma = require("../src/config/db");
const { overlapProblem } = require("../src/modules/hrm/attendance/controller");

/*
 * A day cannot hold both a leave and a permission: a day away has no hours to be excused from, and
 * a permission raised over one would still be spent against the month's limit. Either is refused over
 * the other while it is pending or approved - a rejected one never blocks - and the refusal names the
 * request in the way, so the form can offer to delete it first.
 */
function withRequests(found) {
  const asked = [];
  const original = prisma.attendanceRequest.findFirst;
  prisma.attendanceRequest.findFirst = async ({ where }) => { asked.push(where); return found; };
  return { asked, restore: () => { prisma.attendanceRequest.findFirst = original; } };
}
const day = (iso) => new Date(`${iso}T00:00:00.000Z`);

test("a permission is refused on a day that already has a leave, naming it and its status", async () => {
  const { asked, restore } = withRequests({ id: 41, type: "LEAVE", status: "APPROVED", fromDate: day("2026-11-03"), toDate: day("2026-11-03"), fromTime: null, toTime: null });
  try {
    const refusal = await overlapProblem(7, { type: "PERMISSION", fromDate: "2026-11-03", toDate: "2026-11-03" });
    assert.deepEqual(asked[0].type, { in: ["PERMISSION", "LEAVE", "COMP_OFF"] });
    assert.deepEqual(asked[0].status, { in: ["PENDING", "APPROVED"] }, "a rejected request never blocks");
    assert.equal(refusal.status, 409);
    assert.equal(refusal.code, "REQUEST_CLASH");
    assert.equal(refusal.message, "You already have an approved leave on 3 Nov 2026. Delete that request first to raise this one.");
    assert.deepEqual(refusal.clash, { id: 41, type: "LEAVE", status: "APPROVED", fromDate: "2026-11-03", toDate: "2026-11-03", fromTime: null, toTime: null });
  } finally { restore(); }
});

test("a leave or comp-off is refused over a day that already has a permission, pending or approved", async () => {
  const { asked, restore } = withRequests({ id: 52, type: "PERMISSION", status: "PENDING", fromDate: day("2026-11-03"), toDate: day("2026-11-03"), fromTime: "09:30", toTime: "12:00" });
  try {
    const refusal = await overlapProblem(7, { type: "LEAVE", fromDate: "2026-11-02", toDate: "2026-11-04" });
    assert.deepEqual(asked[0].type, { in: ["LEAVE", "COMP_OFF", "PERMISSION"] });
    assert.equal(refusal.message, "You already have a pending permission on 3 Nov 2026. Delete that request first to raise this one.");
    assert.equal(refusal.clash.fromTime, "09:30");
    await overlapProblem(7, { type: "COMP_OFF", fromDate: "2026-11-03", toDate: "2026-11-03", workedDate: "2026-11-01" });
    assert.deepEqual(asked[1].type, { in: ["LEAVE", "COMP_OFF", "PERMISSION"] });
  } finally { restore(); }
});

test("nothing in the way is no refusal, and other kinds still clash only with their own", async () => {
  const { asked, restore } = withRequests(null);
  try {
    assert.equal(await overlapProblem(7, { type: "PERMISSION", fromDate: "2026-11-03", toDate: "2026-11-03" }), null);
    await overlapProblem(7, { type: "ON_DUTY", fromDate: "2026-11-03", toDate: "2026-11-03" });
    assert.equal(asked[1].type, "ON_DUTY");
  } finally { restore(); }
});
