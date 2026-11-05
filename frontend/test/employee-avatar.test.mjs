import test from "node:test";
import assert from "node:assert/strict";
import { avatarOf, personOption } from "../src/lib/employeeAvatar.mjs";

test("avatarOf reads an employee row", () => {
  assert.deepEqual(avatarOf({ id: 7, employeeName: "Asha Rao", profilePhotoUrl: "https://cdn/x.jpg" }), { name: "Asha Rao", photoUrl: "https://cdn/x.jpg", seed: 7 });
});

test("avatarOf reads a user row and falls back to initials without a photo", () => {
  assert.deepEqual(avatarOf({ id: 3, name: "Ravi" }), { name: "Ravi", photoUrl: null, seed: 3 });
});

test("avatarOf of nothing is nothing, so the option renders without a face", () => {
  assert.equal(avatarOf(null), undefined);
});

test("personOption keeps the label and value the caller chose", () => {
  assert.deepEqual(personOption({ id: 1, employeeName: "A" }, "A - Editor", "1"), { label: "A - Editor", value: "1", avatar: { name: "A", photoUrl: null, seed: 1 } });
});
