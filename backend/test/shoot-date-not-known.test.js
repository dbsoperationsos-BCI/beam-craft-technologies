const test = require("node:test");
const assert = require("node:assert/strict");
const { projectShootSchema } = require("../src/modules/sales/projects/controller");

/*
 * "Shoot Date Known: No" means no date, not 1 January 1970.
 *
 * The schema was a union with `z.coerce.date()` first, and a union takes its first match:
 * `new Date(null)` is the epoch, a perfectly valid Date, so the shoot was stored as 1970 instead of
 * unscheduled - and read as scheduled everywhere a date is only tested for being there (Main Event
 * Date Known, the pre production count, the production availability window). `""` escaped it only
 * because `new Date("")` is an Invalid Date and that branch happened to fail.
 */
const shoot = { shoot: "Reception", shootType: "Outdoor / On-Location", shootPlace: "Erode", preference: "Both", sessionTimings: ["Full Session"] };
const dateOf = (dateCreated) => {
  const parsed = projectShootSchema.safeParse({ ...shoot, dateCreated });
  return parsed.success ? parsed.data.dateCreated : "refused";
};

test("a shoot whose date is not known is stored as no date", () => {
  // What Add Shoot sends when the toggle is turned off.
  assert.equal(dateOf(null), null);
  // And what a form sends for a field it never drew.
  assert.equal(dateOf(""), null);
  assert.equal(dateOf(undefined), null);
  // Nothing here is a Date at all: 1 January 1970 is what `new Date(null)` makes of "no date".
  for (const empty of [null, "", undefined]) assert.ok(!(dateOf(empty) instanceof Date), `${JSON.stringify(empty)} is no date`);
});

test("a date that was given is kept, and one that cannot be read is refused", () => {
  assert.equal(dateOf("2026-11-12").toISOString().slice(0, 10), "2026-11-12");
  // Not quietly turned into "no date": a date somebody typed and the server cannot read is a
  // question for them, where an empty box is an answer.
  assert.equal(dateOf("nonsense"), "refused");
});
