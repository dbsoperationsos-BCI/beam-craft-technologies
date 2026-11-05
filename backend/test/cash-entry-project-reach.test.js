const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const CONTROLLER = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "accounts", "cash-entries", "controller.js"), "utf8");
const body = (name) => {
  const start = CONTROLLER.indexOf(`async function ${name}(`);
  assert.ok(start >= 0, `${name} is missing`);
  return CONTROLLER.slice(start, CONTROLLER.indexOf("\n}\n", start));
};

test("an entry on a project the caller sees on their board is theirs to work, whoever recorded it", () => {
  const scoped = body("scopedEntry");
  assert.match(scoped, /\{ throughProject = false \} = \{\}/);
  assert.match(scoped, /if \(scope\.allows\(entry\)\) return entry;/);
  assert.match(scoped, /return throughProject && \(await onVisibleProject\(req, entry\.projectId\)\) \? entry : null;/);
  // The project is read through the register's own rule - the one the Payments tab lists by.
  assert.match(body("onVisibleProject"), /readableProject\(\{ userId: Number\(req\.user\.id\), projectId \}\)/);
});

test("view, receipt, edit and share reach through the project; delete does not", () => {
  for (const name of ["getEntry", "downloadReceipt", "updateEntry", "shareInvoice", "receiptProject"]) {
    assert.match(body(name), /throughProject: true/, `${name} should reach through the project`);
  }
  for (const name of ["deleteEntry", "deleteEntryRecord"]) {
    assert.doesNotMatch(body(name), /throughProject/, `${name} must keep to the cash scope`);
  }
});

test("an edit keeping the payment on that project is not refused for its branch", () => {
  const update = body("updateEntry");
  // Only on the same project, in the same branch, and never a transfer - a changed branch is still checked.
  assert.match(update, /const keptOnVisibleProject = existing\.entryType !== "Transfer"\s*&& data\.projectId && data\.projectId === existing\.projectId\s*&& data\.branch === existing\.branch\s*&& \(await onVisibleProject\(req, data\.projectId\)\);/);
  assert.match(CONTROLLER, /scopedEntry\(req, id, \{ id: true, entryType: true, branch: true, amount: true, paymentScheduleId: true, paymentProof: true \}, \{ throughProject: true \}\)/);
  assert.match(update, /if \(!keptOnVisibleProject && !\(await canUseEntryBranches\(actorId, data\)\)\)/);
});
