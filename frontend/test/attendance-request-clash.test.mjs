import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const FORM = readFileSync(new URL("../src/components/hrm/AttendanceRequestFormPanel.js", import.meta.url), "utf8");

test("a day already holding a leave or permission is asked about in a pop-up that offers to delete it first", () => {
  // The server's refusal names the request in the way (`REQUEST_CLASH`); the form keeps what it sent.
  assert.match(FORM, /if \(requestError\?\.data\?\.code === "REQUEST_CLASH" && requestError\.data\.clash\) \{\n\s+setClash\(\{ \.\.\.requestError\.data\.clash, message: requestError\.data\.message, payload \}\);/);
  // Over the form, naming it; Keep it is the safe default, deleting the other is the deliberate choice.
  assert.match(FORM, /\{clash && <ConfirmDialog\n\s+layer="dialogOverPanel"\n\s+title="That day already has a request"/);
  assert.match(FORM, /confirmLabel="Delete it and raise this one"/);
  assert.match(FORM, /cancelLabel="Keep it"\n\s+primaryAction="cancel"/);
  // Deleting it, then raising this one as it was sent.
  assert.match(FORM, /await deleteAttendanceRequest\(clash\.id\);\n\s+const \{ payload \} = clash;\n\s+setClash\(null\);\n\s+await send\(payload\);/);
});
