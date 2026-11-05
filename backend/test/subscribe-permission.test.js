const test = require("node:test");
const assert = require("node:assert/strict");
const catalogue = require("../prisma/seeds/permission-catalogue");

// SUBSCRIBE -> Media Studio Operations / Account Manager are guarded by this one row; without it in
// the catalogue the IAM seed never creates it and nobody, Super Admin included, can be granted it.
test("the catalogue carries SUBSCRIBE / Client Onboarding", () => {
  const rows = catalogue.PERMISSIONS;
  assert.ok(rows.some((row) => row.module === "SUBSCRIBE" && row.feature === "Client Onboarding"));
});
