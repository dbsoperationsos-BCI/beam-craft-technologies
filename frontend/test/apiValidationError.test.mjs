import test from "node:test";
import assert from "node:assert/strict";

import { describeValidationError } from "../src/lib/apiValidationError.mjs";

test("names the fields a Validation failed response actually flagged", () => {
  const error = {
    message: "Validation failed",
    data: {
      errors: {
        fieldErrors: {
          contactNumber: ["Enter a valid phone number with its country code"],
          panNumber: ["Enter a valid PAN"],
        },
      },
    },
  };
  const described = describeValidationError(error, "Unable to save.");
  assert.match(described, /Contact Number: Enter a valid phone number with its country code/);
  assert.match(described, /Pan Number: Enter a valid PAN/);
});

test("uses a caller's own label over the humanized field name", () => {
  const error = {
    message: "Validation failed",
    data: { errors: { fieldErrors: { contactNumber: ["Enter a valid phone number with its country code"] } } },
  };
  assert.equal(
    describeValidationError(error, "Unable to save.", { contactNumber: "Mobile Number" }),
    "Mobile Number: Enter a valid phone number with its country code",
  );
});

test("passes through any other error untouched", () => {
  assert.equal(describeValidationError({ message: "Employee not found." }, "Unable to save."), "Employee not found.");
  assert.equal(describeValidationError({}, "Unable to save."), "Unable to save.");
});

test("falls back to the fallback when Validation failed carries no field detail", () => {
  assert.equal(describeValidationError({ message: "Validation failed" }, "Unable to save."), "Unable to save.");
  assert.equal(
    describeValidationError({ message: "Validation failed", data: { errors: { fieldErrors: {} } } }, "Unable to save."),
    "Unable to save.",
  );
});
