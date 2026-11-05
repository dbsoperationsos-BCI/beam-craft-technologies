const test = require("node:test");
const assert = require("node:assert/strict");
const { validateLeadAnalysis, validateCallAnalysis, nullable, list, oneOf } = require("../src/services/ai/schemas");

/*
 * What the CRM is protected from.
 *
 * A local model constrained to a schema still returns a string where a list belongs, a sentiment it
 * invented, and the word "unknown" where it was told to use null. The panel renders every one of
 * these fields, so a wrong type here is a crash in the browser rather than a rough answer.
 */

const GOOD = {
  summary: "Client wants a December wedding shoot.",
  leadIntent: "high", sentiment: "positive",
  issues: ["No follow-up recorded since 12 Aug"],
  suggestions: ["Send the wedding package"],
  nextAction: "Send the quote", followUpRequired: true,
  followUpSuggestion: "Call back Friday",
  budget: "1.5 lakhs", requirements: ["Candid photography"], actionItems: ["Share album samples"],
};

test("a well-formed analysis passes through unchanged", () => {
  assert.deepEqual(validateLeadAnalysis(GOOD), GOOD);
});

test("an invented sentiment or intent falls back rather than reaching the UI", () => {
  // The panel colours these; a value outside the set would render as nothing at all.
  const out = validateLeadAnalysis({ ...GOOD, sentiment: "very happy", leadIntent: "extremely high" });
  assert.equal(out.sentiment, "neutral");
  assert.equal(out.leadIntent, "medium");
});

test("case and spacing from the model do not matter", () => {
  const out = validateLeadAnalysis({ ...GOOD, sentiment: " POSITIVE ", leadIntent: "High" });
  assert.equal(out.sentiment, "positive");
  assert.equal(out.leadIntent, "high");
});

test("the model's evasions become null, not the word 'unknown'", () => {
  for (const evasion of ["unknown", "N/A", "none", "not mentioned", "  ", "null"]) {
    assert.equal(nullable(evasion), null, `${evasion} should be null`);
  }
  assert.equal(nullable("1.5 lakhs"), "1.5 lakhs");
});

test("a list answered as a sentence becomes a one-item list", () => {
  assert.deepEqual(list("Send the quote"), ["Send the quote"]);
  assert.deepEqual(list(null), []);
  assert.deepEqual(list(["a", "", "  ", "b"]), ["a", "b"]);
});

test("a runaway list is capped", () => {
  // A model that repeats itself must not put two hundred rows into a card.
  assert.equal(list(Array.from({ length: 50 }, (_, i) => `item ${i}`)).length, 12);
});

test("followUpRequired survives the model answering 'yes'", () => {
  assert.equal(validateLeadAnalysis({ ...GOOD, followUpRequired: "yes" }).followUpRequired, true);
  assert.equal(validateLeadAnalysis({ ...GOOD, followUpRequired: "no" }).followUpRequired, false);
});

test("missing optional fields are filled, not left undefined", () => {
  const out = validateLeadAnalysis({ summary: "Short call.", nextAction: "", followUpRequired: false });
  // Every field the panel reads must exist, or the render throws.
  for (const key of ["issues", "suggestions", "requirements", "actionItems"]) assert.ok(Array.isArray(out[key]));
  assert.equal(out.budget, null);
  assert.equal(typeof out.nextAction, "string");
});

test("an answer with no summary is a failure, not an empty card", () => {
  assert.throws(() => validateLeadAnalysis({ leadIntent: "high" }), /no summary/);
  assert.throws(() => validateLeadAnalysis(null), /no analysis/);
  assert.throws(() => validateLeadAnalysis("I cannot help with that."), /no analysis/);
});

test("call analysis applies the same rules", () => {
  const out = validateCallAnalysis({
    summary: "Asked about pricing.", sentiment: "bizarre", confidence: "very sure",
    budget: "not mentioned", actionItems: "Send pricing",
  });
  assert.equal(out.sentiment, "neutral");
  // An unrecognised confidence must fall to low, never to high - the cautious direction.
  assert.equal(out.confidence, "low");
  assert.equal(out.budget, null);
  assert.deepEqual(out.actionItems, ["Send pricing"]);
});

test("oneOf never returns something outside its list", () => {
  assert.equal(oneOf("nonsense", ["a", "b"], "a"), "a");
  assert.equal(oneOf(undefined, ["a", "b"], "b"), "b");
});
