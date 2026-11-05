import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { credentialSections } from "../src/constants/employeeCredentialConfig.js";
import { draftFrom } from "../src/components/employees/credentialDraft.js";

const read = (...parts) => fs.readFileSync(path.join(import.meta.dirname, "..", "src", ...parts), "utf8");
const FORM = read("components", "employees", "useCredentialForm.js");

test("Employee Preference has an Exclude section, right after WhatsApp, holding Exclude From Attendance", () => {
  const ids = credentialSections.map((section) => section.id);
  assert.equal(ids[ids.indexOf("whatsapp") + 1], "exclude");
  const exclude = credentialSections.find((section) => section.id === "exclude");
  assert.equal(exclude.title, "Exclude");
  assert.deepEqual(exclude.fields.map((field) => [field.name, field.type]), [["excludeFromAttendance", "custom"]]);
  // The same tick box as Allow WhatsApp.
  assert.match(FORM, /excludeFromAttendance: \(\) => <label className="flex items-start gap-3 rounded-lg border border-slate-200 bg-white px-3 py-3">/);
  assert.match(FORM, />Exclude From Attendance<\/span>/);
});

test("it is read back, saved on create and update, and kept in a draft", () => {
  assert.match(FORM, /excludeFromAttendance: found\.excludeFromAttendance === true,/);
  assert.equal((FORM.match(/excludeFromAttendance: shown\.excludeFromAttendance === true,/g) || []).length, 2, "both the create and the update send it");
  assert.equal(draftFrom({ excludeFromAttendance: true }).excludeFromAttendance, true);
  assert.equal(draftFrom({}).excludeFromAttendance, false);
});

test("the Attendance Dashboard's employee filter asks only for the people attendance shows", () => {
  assert.match(read("components", "hrm", "AdminAttendanceDashboard.js"), /getEmployeeDirectory\(\{ forAttendance: true \}\)/);
  assert.match(read("services", "hrm", "employees.service.js"), /\/api\/hrm\/employees\/directory\$\{forAttendance \? "\?for=attendance" : ""\}/);
});
