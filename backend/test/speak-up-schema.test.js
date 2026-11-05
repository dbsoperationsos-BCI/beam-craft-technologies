const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const schema = fs.readFileSync(path.join(__dirname, "..", "prisma", "schema.prisma"), "utf8");
const nameCopies = fs.readFileSync(path.join(__dirname, "..", "src", "services", "nameCopies.js"), "utf8");
const resolvedNames = fs.readFileSync(path.join(__dirname, "..", "src", "services", "resolvedNames.js"), "utf8");

test("SpeakUp carries an id and a name copy of the employee who wrote it, per Rule 5", () => {
  assert.match(schema, /model SpeakUp \{/);
  assert.match(schema, /employeeId\s+Int\?\s+@map\("employee_id"\)/);
  assert.match(schema, /employeeName String\s+@map\("employee_name"\)/);
  assert.match(schema, /employee Employee\? @relation\("SpeakUpEmployee", fields: \[employeeId\], references: \[id\], onDelete: SetNull\)/);
  assert.match(schema, /speakUps\s+SpeakUp\[\]\s+@relation\("SpeakUpEmployee"\)/);
});

test("SpeakUp is not branch-scoped - deliberately no branchId column", () => {
  const block = schema.slice(schema.indexOf("model SpeakUp {"), schema.indexOf("@@map(\"speak_up\")"));
  assert.doesNotMatch(block, /branchId/);
});

test("the name copy is registered both ways", () => {
  assert.match(nameCopies, /exact\("speakUp", "employeeName", "speak-up", \{ idField: "employeeId" \}\)/);
  assert.match(resolvedNames, /SpeakUp: \{\s*employeeName: \["employee", "employeeName"\],\s*\}/);
});
