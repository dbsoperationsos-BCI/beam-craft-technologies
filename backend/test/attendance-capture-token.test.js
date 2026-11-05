const test = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-for-capture-tokens";

const { CAPTURE_TOKEN_TTL_SECONDS, issueCaptureToken, verifyCaptureToken } = require("../src/modules/hrm/attendance/captureToken");

/**
 * The capture token is what makes a check-in's selfie and position evidence of *now*: each rule
 * below is a way an old or borrowed capture would otherwise have been recorded as live.
 */

const refusedAsExpired = (fn) => assert.throws(fn, (error) => error.code === "CAPTURE_EXPIRED" && error.status === 400);

test("a token comes back for the login and the kind of capture it was issued for", () => {
  const { token } = issueCaptureToken(7, "CHECK_IN");
  assert.equal(verifyCaptureToken(token, 7, "CHECK_IN").uid, 7);
});

test("another login cannot use somebody else's token", () => {
  const { token } = issueCaptureToken(7, "CHECK_IN");
  refusedAsExpired(() => verifyCaptureToken(token, 8, "CHECK_IN"));
});

test("a check-in token does not close the day", () => {
  const { token } = issueCaptureToken(7, "CHECK_IN");
  refusedAsExpired(() => verifyCaptureToken(token, 7, "CHECK_OUT"));
});

test("a capture brought back after the window is refused", (t) => {
  const { token } = issueCaptureToken(7, "CHECK_OUT");
  const later = Date.now() + (CAPTURE_TOKEN_TTL_SECONDS + 5) * 1000;
  t.mock.method(Date, "now", () => later);
  refusedAsExpired(() => verifyCaptureToken(token, 7, "CHECK_OUT"));
});

test("a missing or made-up token is refused", () => {
  refusedAsExpired(() => verifyCaptureToken(undefined, 7, "CHECK_IN"));
  refusedAsExpired(() => verifyCaptureToken("not-a-token", 7, "CHECK_IN"));
});

/* ---------------------------------------------------- the handlers refuse before touching anything */

const controller = require("../src/modules/hrm/attendance/controller");

const call = (handler, body, user = { id: 7 }) => new Promise((resolve) => {
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(payload) { resolve({ status: this.statusCode, body: payload }); } };
  handler({ user, body, params: {}, query: {}, headers: {} }, res);
});
const live = { workMode: "office", selfie: "data:image/jpeg;base64,AAAA", latitude: 11.34, longitude: 77.71, accuracy: 12 };

test("a check-in with no token, or another capture's token, is refused before anything is stored", async () => {
  assert.equal((await call(controller.markLogin, live)).status, 400);
  const { token } = issueCaptureToken(7, "CHECK_OUT");
  const refused = await call(controller.markLogin, { ...live, captureToken: token });
  assert.equal(refused.status, 400);
  assert.equal(refused.body.code, "CAPTURE_EXPIRED");
});

test("a missing position is refused rather than read as (0, 0)", async () => {
  const { token } = issueCaptureToken(7, "CHECK_IN");
  const response = await call(controller.markLogin, { ...live, latitude: null, longitude: null, captureToken: token });
  assert.equal(response.status, 400);
});

test("a check-out needs its own selfie and a position with its accuracy", async () => {
  const { token } = issueCaptureToken(7, "CHECK_OUT");
  assert.equal((await call(controller.markLogout, { captureToken: token })).status, 400);
  assert.equal((await call(controller.markLogout, { ...live, accuracy: null, captureToken: token })).status, 400);
});

test("a capture can only be started as a check-in or a check-out", async () => {
  assert.equal((await call(controller.startCapture, { type: "FOO" })).status, 400);
});

test("the sign-in secret cannot mint a capture token, and a capture token is not a sign-in", () => {
  const forged = jwt.sign({ scope: "attendance-capture", uid: 7, type: "CHECK_IN" }, process.env.JWT_SECRET, { expiresIn: 60 });
  refusedAsExpired(() => verifyCaptureToken(forged, 7, "CHECK_IN"));

  const { token } = issueCaptureToken(7, "CHECK_IN");
  assert.throws(() => jwt.verify(token, process.env.JWT_SECRET));
});
