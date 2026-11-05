const test = require("node:test");
const assert = require("node:assert/strict");

/*
 * A capture - login, logout, Break In, Break Off - refused for what it carried says why, in words the
 * person can act on, rather than a bare "Validation failed".
 */

const controller = require("../src/modules/hrm/attendance/controller");
const call = (handler, body) => new Promise((resolve) => handler({ body, user: { id: 1 } }, {
  status(code) { this.code = code; return this; },
  json(payload) { resolve({ status: this.code, body: payload }); },
}));
const evidence = { selfie: "data:image/jpeg;base64,AAAA", captureToken: "token", latitude: 11.34, longitude: 77.72, accuracy: 25 };

test("a location reported more than 100 km out is refused as too rough, with what to do", async () => {
  // Logout, and Break In and Break Off, which share the rule.
  for (const handler of [controller.markLogout, controller.startBreak, controller.endBreak]) {
    const refused = await call(handler, { ...evidence, accuracy: 150000 });
    assert.match(refused.body.message, /^Your location is too rough to record \(more than 100 km out\)\. Turn on precise location/);
  }
  // Every field's reasons still go back with a logout, for anything that wants them.
  const logout = await call(controller.markLogout, { ...evidence, accuracy: 150000 });
  assert.equal(logout.status, 400);
  assert.ok(logout.body.errors?.fieldErrors?.accuracy?.length);
});

test("each other gap says what it is: no location, a position that is not a place, no selfie", async () => {
  const { latitude, ...noLatitude } = evidence;
  assert.equal((await call(controller.markLogout, noLatitude)).body.message, "Capture a live location");
  assert.match((await call(controller.markLogout, { ...evidence, latitude: 120 })).body.message, /not a real place/);
  assert.equal((await call(controller.markLogout, { ...evidence, selfie: "" })).body.message, "Capture a logout selfie");
  assert.doesNotMatch((await call(controller.markLogout, { ...evidence, accuracy: -1 })).body.message, /^Validation failed$/);
});
