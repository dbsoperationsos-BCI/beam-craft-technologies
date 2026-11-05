const test = require("node:test");
const assert = require("node:assert/strict");
const { statusFromDates } = require("../src/modules/ai-feature/events/service");

const day = (offset) => { const d = new Date(); d.setDate(d.getDate() + offset); return d; };

test("an event is upcoming before it starts, active while it runs, completed after", () => {
  assert.equal(statusFromDates({ startDate: day(3), endDate: null, archivedAt: null }), "UPCOMING");
  assert.equal(statusFromDates({ startDate: day(0), endDate: null, archivedAt: null }), "ACTIVE");
  assert.equal(statusFromDates({ startDate: day(-2), endDate: day(1), archivedAt: null }), "ACTIVE");
  assert.equal(statusFromDates({ startDate: day(-5), endDate: day(-2), archivedAt: null }), "COMPLETED");
  assert.equal(statusFromDates({ startDate: day(-5), endDate: null, archivedAt: null }), "COMPLETED");
});

test("an archived event stays archived whatever its dates", () => {
  assert.equal(statusFromDates({ startDate: day(0), endDate: null, archivedAt: new Date() }), "ARCHIVED");
});
