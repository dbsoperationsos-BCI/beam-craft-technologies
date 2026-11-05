const test = require("node:test");
const assert = require("node:assert/strict");

const {
  LOCATION_NOTES,
  accuracyAcceptable,
  distanceMetres,
  evaluateLocation,
  radiusFor,
  refusesCapture,
} = require("../src/modules/hrm/attendance/geofence");

/**
 * Employee Attendance: was this person at work?
 *
 * The module recorded coordinates from the day it shipped and compared them to nothing. These are
 * the rules that finally read them, and every one of them decides something about a named person
 * that they may want to argue with — so each is tested against a number somebody can check rather
 * than against the implementation's own opinion.
 */

// Two real points about 1.1km apart in Coimbatore, so the distances below are checkable on a map
// rather than being whatever the formula happened to return the first time it was run.
const office = { branchId: 3, latitude: 11.0168, longitude: 76.9558, allowedRadiusMeters: 200, isActive: true };
const atTheDoor = { latitude: 11.0168, longitude: 76.9558, accuracy: 12 };
const settings = { defaultRadiusMeters: 200, maxGpsAccuracyMeters: 150, enforceGeofence: false };

test("distance is measured on a sphere, and a non-point measures as nothing at all", () => {
  assert.equal(distanceMetres(atTheDoor, office), 0);

  // One degree of latitude is ~111.19km everywhere; a hundredth of one is ~1.11km. Checking against
  // a figure that comes from the earth rather than from this function.
  const northABit = { latitude: 11.0268, longitude: 76.9558 };
  const north = distanceMetres(northABit, office);
  assert.ok(north > 1090 && north < 1130, `expected ~1112m, got ${north}`);

  // Null, not zero. Zero is "standing on the office", and a caller that cannot tell the two apart
  // writes the one bug that reads as a pass.
  assert.equal(distanceMetres(null, office), null);
  assert.equal(distanceMetres({ latitude: 11.0168 }, office), null);
  assert.equal(distanceMetres({ latitude: 91, longitude: 76.9 }, office), null);
  assert.equal(distanceMetres({ latitude: 11.01, longitude: 181 }, office), null);
  assert.equal(distanceMetres({ latitude: "abc", longitude: "def" }, office), null);
});

test("a radius comes from the office, then from the studio, and zero means no circle", () => {
  assert.equal(radiusFor(office, settings), 200);
  // An office that has never set one falls back rather than having no circle.
  assert.equal(radiusFor({ ...office, allowedRadiusMeters: null }, settings), 200);
  assert.equal(radiusFor({ ...office, allowedRadiusMeters: 50 }, settings), 50);
  // Neither set: no circle, which `evaluateLocation` reads as "no office" rather than as a pass.
  assert.equal(radiusFor({ ...office, allowedRadiusMeters: null }, { defaultRadiusMeters: 0 }), 0);
});

test("a position too vague to place somebody is not accepted as placing them", () => {
  assert.equal(accuracyAcceptable(12, settings), true);
  assert.equal(accuracyAcceptable(150, settings), true);
  assert.equal(accuracyAcceptable(151, settings), false);
  // Absent accuracy is unusable, not perfect. A phone indoors on wifi reports hundreds of metres,
  // and a browser that reports nothing has told us nothing.
  assert.equal(accuracyAcceptable(undefined, settings), false);
  assert.equal(accuracyAcceptable(null, settings), false);
  assert.equal(accuracyAcceptable(-1, settings), false);
  // No limit configured means the check is off rather than impossible to pass.
  assert.equal(accuracyAcceptable(9000, { maxGpsAccuracyMeters: 0 }), true);
});

test("standing at the office verifies; standing a kilometre away does not", () => {
  const inside = evaluateLocation({ office, branchId: 3, position: atTheDoor, settings });
  assert.deepEqual(inside, { branchId: 3, distanceMeters: 0, verified: true, note: null });

  const outside = evaluateLocation({ office, branchId: 3, position: { latitude: 11.0268, longitude: 76.9558, accuracy: 10 }, settings });
  assert.equal(outside.verified, false);
  assert.equal(outside.note, LOCATION_NOTES.OUTSIDE);
  // The distance is still recorded: "1.1km away" is the fact HR needs, and withholding it would
  // leave the row saying only that something was wrong.
  assert.ok(outside.distanceMeters > 1000);
});

test("every way of not knowing is false with a reason, never a pass", () => {
  const cases = [
    ["no fix at all", { office, branchId: 3, position: {}, settings }, LOCATION_NOTES.NO_FIX],
    ["employee has no branch", { office: null, branchId: null, position: atTheDoor, settings }, LOCATION_NOTES.NO_BRANCH],
    ["branch has no office recorded", { office: null, branchId: 3, position: atTheDoor, settings }, LOCATION_NOTES.NO_OFFICE],
    ["the office was switched off", { office: { ...office, isActive: false }, branchId: 3, position: atTheDoor, settings }, LOCATION_NOTES.NO_OFFICE],
    ["nobody configured a radius", { office: { ...office, allowedRadiusMeters: null }, branchId: 3, position: atTheDoor, settings: { defaultRadiusMeters: 0, maxGpsAccuracyMeters: 150 } }, LOCATION_NOTES.NO_OFFICE],
    ["the fix was too vague", { office, branchId: 3, position: { ...atTheDoor, accuracy: 900 }, settings }, LOCATION_NOTES.POOR_ACCURACY],
  ];
  for (const [name, input, note] of cases) {
    const verdict = evaluateLocation(input);
    assert.equal(verdict.verified, false, name);
    assert.equal(verdict.note, note, name);
  }

  // A vague fix still records how far away it was, because "1.2km away, ±800m" is worth keeping.
  const vague = evaluateLocation({ office, branchId: 3, position: { latitude: 11.0268, longitude: 76.9558, accuracy: 900 }, settings });
  assert.ok(vague.distanceMeters > 1000);
});

test("only a measured, enforced, outside capture is refused", () => {
  const enforced = { ...settings, enforceGeofence: true };
  const outside = evaluateLocation({ office, branchId: 3, position: { latitude: 11.0268, longitude: 76.9558, accuracy: 10 }, settings: enforced });
  assert.equal(refusesCapture(outside, enforced), true);

  // Off by default, so the day this ships nobody is locked out of marking their attendance.
  assert.equal(refusesCapture(outside, settings), false);

  // Being inside is never a refusal.
  assert.equal(refusesCapture(evaluateLocation({ office, branchId: 3, position: atTheDoor, settings: enforced }), enforced), false);

  // The studio's own gaps are not the employee's fault: a branch with no office, and a phone that
  // could not get a fix, are recorded unverified rather than refused.
  for (const gap of [
    evaluateLocation({ office: null, branchId: 3, position: atTheDoor, settings: enforced }),
    evaluateLocation({ office, branchId: 3, position: {}, settings: enforced }),
    evaluateLocation({ office, branchId: 3, position: { ...atTheDoor, accuracy: 900 }, settings: enforced }),
  ]) {
    assert.equal(refusesCapture(gap, enforced), false, gap.note);
  }
});
