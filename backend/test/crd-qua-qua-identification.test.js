const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { IDENTIFICATION_REQUIRED, documentSchema, emptyDocument, missingRequired } = require("../src/modules/sales/crd-documents/documentQQ");

/*
 * The Qua Qua document's Identification page: what the studio states and what it asks.
 *
 * The WhatsApp Group Name is the studio's name for the booking. It used to ask the client to type
 * the exact name of their group, which made the project's name depend on a stranger spelling it the
 * way Sales had - and the project already carries it. It is read back now, the same as on the Dum
 * Dum document.
 *
 * That change has a rule attached, and it is the one worth a test: a field the form will not let
 * anybody type in cannot be a field that blocks submission. Get that pair out of step and a
 * document raised by hand - which has no project to take a name from - is stranded, required to
 * hold a value with no screen anywhere able to give it one.
 */

const FORM = fs.readFileSync(
  path.join(__dirname, "..", "..", "frontend", "src", "components", "sales", "PublicCrdDocumentFormQuaQua.js"),
  "utf8",
);

/** The form's own copy of a `const NAME = ["a", "b"]` list. */
function listInForm(name) {
  const match = FORM.match(new RegExp(`const ${name} = \\[([^\\]]*)\\]`));
  assert.ok(match, `the Qua Qua form no longer declares ${name}`);
  return match[1].split(",").map((entry) => entry.trim().replace(/^"|"$/g, "")).filter(Boolean);
}

test("the WhatsApp Group Name is read back, not asked", () => {
  const control = FORM.match(/<Field[^>]*label="WhatsApp Group Name"[\s\S]*?\/>/);
  assert.ok(control, "the Qua Qua form no longer draws a WhatsApp Group Name");
  assert.match(control[0], /\breadOnly\b/, "it is the studio's name for the booking, not the client's to type");
  assert.doesNotMatch(control[0], /\brequired\b/, "a field the client cannot type in must not be marked required");
});

test("and so it is not required, on either side", () => {
  // The server decides; the browser's copy moves the progress bar and decides whether Submit is
  // even attempted. A browser requiring less lets somebody press Submit and be refused; one
  // requiring more refuses a document the server would have taken.
  assert.equal(IDENTIFICATION_REQUIRED.includes("whatsappGroupName"), false);
  assert.deepEqual(listInForm("IDENTIFICATION_REQUIRED"), IDENTIFICATION_REQUIRED);
});

test("a document with no group name is still submittable", () => {
  /*
   * The case that made this matter: a Qua Qua document raised by hand has no project behind it, so
   * nothing prefills the name. Required-and-unfillable, that client could never finish their form.
   */
  const answered = { ...emptyDocument(), whatsappGroupName: "" };
  for (const field of IDENTIFICATION_REQUIRED) answered[field] = field === "phoneNumber" ? "+91 9876543210" : "Baby Shoot";
  answered.branch = "Erode, TN";
  answered.shootType = "Baby Shoot";
  answered.babyName = "Baby";
  answered.babyDateOfBirth = "2026-01-01";
  answered.motherName = "Mother";
  answered.termsAccepted = true;
  assert.equal(missingRequired(answered).includes("whatsappGroupName"), false);
});

test("the field is still stored, so what the studio put there is what comes back", () => {
  // Read-only is about who answers it, not about whether it is kept: the name travels with the
  // document and the studio reads it back off the submission.
  const parsed = documentSchema.parse({ whatsappGroupName: "QQ Erode Baby Shoot | SM" });
  assert.equal(parsed.whatsappGroupName, "QQ Erode Baby Shoot | SM");
});
