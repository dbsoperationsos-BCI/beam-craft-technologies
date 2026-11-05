import test from "node:test";
import assert from "node:assert/strict";
import { hasErrors, markedFieldsMessage, onlyErrors, serverFieldErrors } from "../src/lib/formErrors.mjs";

// One convention for every form: a red message under each wrong box, and one short line above them.

test("a problems object counts only the fields that have a message", () => {
  assert.equal(hasErrors({ email: "", phone: "" }), false);
  assert.equal(hasErrors({ email: "Enter the email.", phone: "" }), true);
  assert.deepEqual(onlyErrors({ email: "Enter the email.", phone: "", name: undefined }), { email: "Enter the email." });
});

test("the line above the form says how many, not which", () => {
  assert.equal(markedFieldsMessage(0), "");
  assert.equal(markedFieldsMessage(1), "Check the field marked in red.");
  assert.equal(markedFieldsMessage(3), "Check the 3 fields marked in red.");
});

test("the server's field problems land on the form's own boxes", () => {
  const refused = { message: "Validation failed", data: { errors: { fieldErrors: { contactNumber: ["Enter a valid phone number", "second"], email: [] } } } };
  assert.deepEqual(serverFieldErrors(refused), { contactNumber: "Enter a valid phone number" });
  assert.deepEqual(serverFieldErrors(refused, { contactNumber: "phone" }), { phone: "Enter a valid phone number" });
  // Anything that is not field-shaped names no box.
  assert.deepEqual(serverFieldErrors({ message: "Not allowed", status: 403 }), {});
  assert.deepEqual(serverFieldErrors(null), {});
});

test("email and phone boxes say whether they are blank or malformed", async () => {
  const { emailProblem, phoneProblem } = await import("../src/lib/formErrors.mjs");
  assert.equal(emailProblem("", "Enter the email."), "Enter the email.");
  assert.equal(emailProblem("  ", ""), "");
  assert.match(emailProblem("ravi@", "x"), /valid email/);
  assert.equal(emailProblem("ravi@studio.com", "x"), "");
  assert.equal(phoneProblem("+91 ", "Enter the phone."), "Enter the phone.");
  assert.equal(phoneProblem("", "Enter the phone."), "Enter the phone.");
  assert.equal(phoneProblem("+91 98765", "x"), "Enter the full phone number.");
  assert.equal(phoneProblem("+91 9876543210", "x"), "");
});
