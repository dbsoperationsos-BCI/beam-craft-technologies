const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildReportBody, validateRange, validateDurations, validatePaging, CallyzerRequestError,
} = require("../src/modules/sales/callyzer-api/validation");
const { authFor } = require("../src/modules/sales/callyzer-api/client");

/*
 * Callyzer's documented rules, checked before a request leaves this server.
 *
 * Each of these mirrors a row in their "Rules" tables. Catching them here turns two round trips
 * into one and, more to the point, means the CRM can say which field was wrong instead of relaying
 * a sentence about a parameter nobody chose.
 */

const DAY = 24 * 60 * 60;
const BASE = { call_from: 1_700_000_000, call_to: 1_700_000_000 + DAY, call_method: "PhoneCall", call_mode: "Voice" };

test("one of the two date ranges is required", () => {
  assert.throws(() => validateRange({}), CallyzerRequestError);
  assert.deepEqual(validateRange({ call_from: 100, call_to: 200 }), { call_from: 100, call_to: 200 });
  assert.deepEqual(validateRange({ synced_from: 100, synced_to: 200 }), { synced_from: 100, synced_to: 200 });
});

test("a half-given range is an error, not an ignored filter", () => {
  // Without this, a request carrying only `call_from` would report on every call ever made.
  assert.throws(() => validateRange({ call_from: 100 }), /call_from.*call_to.*mandatory/);
  assert.throws(() => validateRange({ synced_to: 200 }), /synced_from.*synced_to.*mandatory/);
});

test("timestamps must be positive whole seconds", () => {
  for (const bad of [0, -1, 1.5, "1700000000", null]) {
    assert.throws(() => validateRange({ call_from: bad, call_to: 1_700_000_000 }), /UNIX format/);
  }
});

test("from must precede to, and the range must be under 180 days", () => {
  assert.throws(() => validateRange({ call_from: 200, call_to: 100 }), /From.*less than.*To/);
  assert.throws(() => validateRange({ call_from: 100, call_to: 100 }), /From.*less than.*To/);
  const from = 1_700_000_000;
  assert.throws(() => validateRange({ call_from: from, call_to: from + 181 * DAY }), /180 days/);
  assert.ok(validateRange({ call_from: from, call_to: from + 179 * DAY }));
});

test("call_method and call_mode are mandatory on every report", () => {
  // Their configuration change. Defaulting them would quietly report on phone calls when somebody
  // meant WhatsApp calls, which is a wrong answer rather than a missing one.
  assert.throws(() => buildReportBody({ ...BASE, call_method: undefined }), /Valid call methods/);
  assert.throws(() => buildReportBody({ ...BASE, call_mode: undefined }), /Valid call modes/);
  assert.throws(() => buildReportBody({ ...BASE, call_method: "Telepathy" }), /Valid call methods/);
  assert.throws(() => buildReportBody({ ...BASE, call_mode: "Hologram" }), /Valid call modes/);
});

test("call_types must come from their list, and blanks are ignored", () => {
  assert.equal(buildReportBody({ ...BASE, call_types: [] }).call_types, undefined);
  assert.equal(buildReportBody({ ...BASE, call_types: ["", "  "] }).call_types, undefined);
  assert.deepEqual(buildReportBody({ ...BASE, call_types: ["Incoming", "Missed"] }).call_types, ["Incoming", "Missed"]);
  assert.throws(() => buildReportBody({ ...BASE, call_types: ["Answered"] }), /Valid call types/);
});

test("the duration pair describes a window, so less_than must exceed grt_than", () => {
  // Reads backwards until you see it as "more than X and less than Y".
  assert.throws(() => validateDurations({ duration_les_than: 10, duration_grt_than: 20 }), /should be greater than/);
  assert.throws(() => validateDurations({ duration_les_than: 10, duration_grt_than: 10 }), /should be greater than/);
  assert.deepEqual(validateDurations({ duration_les_than: 30, duration_grt_than: 10 }), { duration_les_than: 30, duration_grt_than: 10 });
  assert.throws(() => validateDurations({ duration_les_than: -1 }), /out of range/);
});

test("paging is bounded, and unique-clients is bounded differently", () => {
  assert.throws(() => validatePaging({ page_no: 0 }), /greater than zero/);
  assert.throws(() => validatePaging({ page_size: 101 }), /between 1 to 100/);
  assert.deepEqual(validatePaging({ page_size: 100 }), { page_size: 100 });
  // Their one exception: "Value must be less than 10,000".
  assert.deepEqual(validatePaging({ page_size: 5000 }, { maxPageSize: 10_000 }), { page_size: 5000 });
  assert.throws(() => validatePaging({ page_size: 10_001 }, { maxPageSize: 10_000 }), /between 1 to 10000/);
});

test("blank and null optional values are left out of the body", () => {
  const body = buildReportBody({ ...BASE, emp_numbers: ["", null, " 91-9999999999 "], emp_tags: [] });
  assert.deepEqual(body.emp_numbers, ["91-9999999999"]);
  assert.equal(body.emp_tags, undefined);
  assert.equal(body.is_exclude_numbers, undefined, "only a real boolean is sent");
  assert.equal(buildReportBody({ ...BASE, is_exclude_numbers: false }).is_exclude_numbers, false);
});

test("the auth envelope is configuration, not a guess in the code", () => {
  // Their published section does not say how the AccessKey travels, so all three shapes are
  // supported and chosen by env. This is what stops another round of deploy-and-see.
  const settings = { key: "AK", secret: "SK", keyHeader: "x-access-key", secretHeader: "x-secret-key" };
  assert.deepEqual(authFor({ ...settings, style: "bearer" }).headers, { authorization: "Bearer AK", "x-secret-key": "SK" });
  assert.deepEqual(authFor({ ...settings, style: "header" }).headers, { "x-access-key": "AK", "x-secret-key": "SK" });
  assert.deepEqual(authFor({ ...settings, style: "body" }).fields, { access_key: "AK", secret_key: "SK" });
  // A secret is optional; an account with only a key must not send an empty header.
  assert.deepEqual(authFor({ ...settings, secret: "", style: "bearer" }).headers, { authorization: "Bearer AK" });
});
