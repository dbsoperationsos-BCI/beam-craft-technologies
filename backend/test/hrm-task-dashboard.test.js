const test = require("node:test");
const assert = require("node:assert/strict");
const { CARD_KEYS, ALL_CARD_KEYS, statusAt, cardsFor, allCardsFor } = require("../src/modules/hrm/tasks/dashboard");

// The Tasks dashboard: ten figures over the reader's own tasks, and where each stood at the start
// of the range, replayed from the task's activity log.

const ME = 1;
const OTHER = 2;
const DAY = new Date("2026-10-28T00:00:00Z");
const log = (...entries) => entries.map(([action, createdAt, detail = ""]) => ({ action, createdAt, detail }));

test("ten cards, five for each side", () => {
  assert.equal(CARD_KEYS.length, 10);
  assert.deepEqual(CARD_KEYS.slice(0, 5), ["myTotal", "myPending", "myInProgress", "myOverdue", "myCompleted"]);
  assert.deepEqual(CARD_KEYS.slice(5), ["givenTotal", "givenPending", "givenInProgress", "givenSentBack", "givenCompleted"]);
});

test("the status at an earlier moment is replayed from the activity log", () => {
  const task = {
    createdAt: "2026-10-01T10:00:00Z",
    activities: log(
      ["CREATED", "2026-10-01T10:00:00Z"],
      ["STATUS_CHANGED", "2026-10-05T10:00:00Z", "Status changed from Pending to In Progress."],
      ["ATTACHED", "2026-10-06T10:00:00Z"],
      ["SUBMITTED", "2026-10-10T10:00:00Z"],
      ["REVOKED", "2026-10-12T10:00:00Z"],
      ["COMPLETED", "2026-10-20T10:00:00Z"],
    ),
  };
  assert.equal(statusAt(task, new Date("2026-09-30T00:00:00Z")), null, "not yet created");
  assert.equal(statusAt(task, new Date("2026-10-02T00:00:00Z")), "PENDING");
  assert.equal(statusAt(task, new Date("2026-10-07T00:00:00Z")), "IN_PROGRESS", "a file attached changes nothing");
  assert.equal(statusAt(task, new Date("2026-10-11T00:00:00Z")), "SUBMITTED");
  assert.equal(statusAt(task, new Date("2026-10-13T00:00:00Z")), "PENDING", "revoked: waiting to be picked up again");
  assert.equal(statusAt(task, new Date("2026-10-21T00:00:00Z")), "COMPLETED");
});

test("work sent back is Completed for its holder and Finish & Send Back for its giver", () => {
  const sentBack = { assignedToUserId: ME, assignedByUserId: OTHER };
  assert.deepEqual(cardsFor(sentBack, "SUBMITTED", ME, DAY), ["myTotal", "myCompleted"]);
  const given = { assignedToUserId: OTHER, assignedByUserId: ME };
  assert.deepEqual(cardsFor(given, "SUBMITTED", ME, DAY), ["givenTotal", "givenSentBack"]);
});

test("overdue is open work past its due date, never finished or sent-back work", () => {
  const due = { assignedToUserId: ME, assignedByUserId: OTHER, dueOn: "2026-10-20T00:00:00Z" };
  assert.ok(cardsFor(due, "IN_PROGRESS", ME, DAY).includes("myOverdue"));
  assert.ok(!cardsFor(due, "SUBMITTED", ME, DAY).includes("myOverdue"));
  assert.ok(!cardsFor(due, "COMPLETED", ME, DAY).includes("myOverdue"));
  assert.ok(!cardsFor({ ...due, dueOn: "2026-10-30T00:00:00Z" }, "PENDING", ME, DAY).includes("myOverdue"));
});

test("a task the reader neither holds nor gave counts nowhere, and one not yet created counts nowhere", () => {
  assert.deepEqual(cardsFor({ assignedToUserId: OTHER, assignedByUserId: 3 }, "PENDING", ME, DAY), []);
  assert.deepEqual(cardsFor({ assignedToUserId: ME, assignedByUserId: OTHER }, null, ME, DAY), []);
});

test("the All Tasks row counts every task in scope, sent-back work as Completed", () => {
  assert.deepEqual(ALL_CARD_KEYS, ["allTotal", "allPending", "allInProgress", "allOverdue", "allCompleted"]);
  const task = { dueOn: "2026-10-20T00:00:00Z" };
  assert.deepEqual(allCardsFor(task, "IN_PROGRESS", DAY), ["allTotal", "allInProgress", "allOverdue"]);
  assert.deepEqual(allCardsFor(task, "SUBMITTED", DAY), ["allTotal", "allCompleted"]);
  assert.deepEqual(allCardsFor(task, "CANCELLED", DAY), ["allTotal"]);
  assert.deepEqual(allCardsFor(task, null, DAY), []);
});
