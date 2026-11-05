const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { projectShootSchema, projectShootData } = require("../src/modules/sales/projects/controller");

/*
 * District and State are both optional on a shoot.
 *
 * Where a shoot happens is often settled long after it is booked - a quotation is raised with a city
 * in mind at most - so the dialog asks for them and neither holds the save. District was already
 * optional for the Quotation Generator's sake; State joined it when every screen stopped demanding
 * either. Blank is stored as nothing, never as "" (Rule 5), and what was given is kept. Every other
 * required field is required exactly as before.
 */
const shoot = {
  shoot: "Wedding",
  shootPlace: "Kalyana Mandapam",
  shootTypes: ["Outdoor / On-Location"],
  sessionTimings: ["Full Session"],
  foodTakenCareBy: "Studio",
  accommodation: "Client",
  travel: "Studio",
  preference: "Both",
};

test("a shoot with neither district nor state passes, and stores neither", () => {
  for (const blank of [undefined, null, "", "   "]) {
    const parsed = projectShootSchema.safeParse({ ...shoot, district: blank, state: blank });
    assert.equal(parsed.success, true, `${JSON.stringify(blank)} passes`);
    const stored = projectShootData(parsed.data);
    assert.equal(stored.district, null, "never stored as an empty string");
    assert.equal(stored.state, null, "nor the state");
  }
});

test("one given without the other is kept as given", () => {
  assert.equal(projectShootData(projectShootSchema.parse({ ...shoot, district: "  Erode " })).district, "Erode");
  assert.equal(projectShootData(projectShootSchema.parse({ ...shoot, state: " Tamil Nadu " })).state, "Tamil Nadu");
  // A district with no state is a real answer: the dialog fills the state in, and nothing demands it.
  assert.equal(projectShootData(projectShootSchema.parse({ ...shoot, district: "Erode" })).state, null);
  for (const field of ["district", "state"]) {
    assert.equal(projectShootSchema.safeParse({ ...shoot, [field]: "x".repeat(192) }).success, false, `${field} is still capped`);
  }
});

test("every other required field is still required", () => {
  for (const field of ["shoot", "shootPlace"]) {
    assert.equal(projectShootSchema.safeParse({ ...shoot, [field]: "" }).success, false, `${field} is still required`);
  }
});

test("both schemas a shoot is written through say the same thing", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "sales", "projects", "controller.js"), "utf8");
  for (const field of ["district", "state"]) {
    assert.equal((source.match(new RegExp(`${field}: z\\.string\\(\\)\\.trim\\(\\)\\.max\\(191\\)\\.nullable\\(\\)\\.optional\\(\\),`, "g")) || []).length, 2, field);
    assert.doesNotMatch(source, new RegExp(`${field}: requiredText`));
  }
});
