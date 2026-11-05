import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const PAGE = readFileSync(new URL("../src/components/hrm/EmployeeAttendancePage.js", import.meta.url), "utf8");
const FORM = readFileSync(new URL("../src/components/employees/useCredentialForm.js", import.meta.url), "utf8");
const CONFIG = readFileSync(new URL("../src/constants/employeeCredentialConfig.js", import.meta.url), "utf8");
const DRAFT = readFileSync(new URL("../src/components/employees/credentialDraft.js", import.meta.url), "utf8");

const dialog = PAGE.slice(PAGE.indexOf("function AttendanceCaptureDialog("), PAGE.indexOf("function NeedsAttentionNotice("));

test("Flexible Shift is a full-width button under the work modes, for those allowed it only", () => {
  assert.match(PAGE, /const flexibleWorkMode = \{ id: "flexible", title: "Flexible Shift" \};/);
  assert.match(dialog, /\{flexibleShiftAllowed && !dayWorkMode && <Button\s+type="button"\s+className="col-span-2"/);
  assert.match(dialog, /aria-pressed=\{workMode === flexibleWorkMode\.id\}/);
  assert.match(dialog, /onClick=\{\(\) => setWorkMode\(flexibleWorkMode\.id\)\}/);
  assert.match(PAGE, /flexibleShiftAllowed=\{Boolean\(today\?\.flexibleShiftAllowed\)\}/);
});

test("choosing it says what it means before the login is taken, and the button is described by it", () => {
  assert.match(dialog, /\{workMode === flexibleWorkMode\.id && !dayWorkMode && <p id="flexible-shift-note"/);
  assert.match(dialog, />Log in at any time\.</);
  assert.match(dialog, /Your day counts from this login until you log out, by the Half day and Full day hours\. It is never marked Late or Early exit\./);
  assert.match(dialog, /aria-describedby=\{workMode === flexibleWorkMode\.id \? "flexible-shift-note" : undefined\}/);
});

test("a login again after a logout says the day's kept mode instead of offering the modes", () => {
  assert.match(dialog, /\{dayWorkMode \? <p [^>]*>\s*\{workModeLabel\(dayWorkMode\) \|\| "Office"\}, kept from your first login today\./);
  assert.match(dialog, /\{flexibleShiftAllowed && !dayWorkMode && <Button/);
  assert.match(PAGE, /dayWorkMode=\{capture === "CHECK_IN" && today\?\.session\?\.logoutAt \? today\.session\.workMode \|\| "office" : null\}/);
});

test("a flexible day's work mode is named in the day list", () => {
  assert.match(PAGE, /const workModeLabel = \(value\) => \[\.\.\.workModes, flexibleWorkMode\]\.find/);
});

test("HR ticks Allow Flexible Shift on the login credentials, in a section of its own", () => {
  assert.match(CONFIG, /id: "flexibleShift",\s+title: "Flexible Shift",\s+columns: 1,\s+fields: \[\{ name: "allowFlexibleShift", label: "Flexible Shift", type: "custom" \}\],/);
  assert.match(FORM, /allowFlexibleShift: \(\) => <label [^>]*>\s*<Checkbox/);
  assert.match(FORM, /onChange=\{\(checked\) => change\("allowFlexibleShift", checked\)\}/);
  assert.match(FORM, />Allow Flexible Shift</);
  // Read, saved on create and on update, and carried by the draft.
  assert.match(FORM, /allowFlexibleShift: found\.allowFlexibleShift === true,/);
  assert.equal((FORM.match(/allowFlexibleShift: shown\.allowFlexibleShift === true,/g) || []).length, 2);
  assert.match(DRAFT, /allowFlexibleShift: values\.allowFlexibleShift === true,/);
});

test("Exclude From Attendance disables Flexible Shift, and ticking it clears Flexible Shift", () => {
  assert.match(FORM, /if \(event\.target\.checked\) change\("allowFlexibleShift", false\);/);
  assert.match(FORM, /checked=\{shown\.allowFlexibleShift === true && shown\.excludeFromAttendance !== true\}/);
  assert.match(FORM, /disabled=\{saving \|\| shown\.excludeFromAttendance === true\}/);
});
