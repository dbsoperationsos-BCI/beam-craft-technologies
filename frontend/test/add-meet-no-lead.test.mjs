import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/*
 * Calendar → Add Meet asks for no lead: it books a meeting that belongs to no lead, at
 * /api/sales/crm-meetings, and such a meeting is cancelled there - only by whoever booked it.
 */

const read = (...parts) => fs.readFileSync(path.join(import.meta.dirname, "..", "src", ...parts), "utf8");
const dialog = read("components", "sales", "ScheduleMeetDialog.js");
const page = read("components", "sales", "MeetingsPage.js");

test("no Lead field, and the meeting goes to the meetings endpoint rather than a lead's", () => {
  assert.doesNotMatch(dialog, /label="Lead"|crm-meetings\/leads|ComboBoxField|knownLeadsRef/);
  assert.match(dialog, /apiRequest\("\/api\/sales\/crm-meetings", \{/);
  assert.doesNotMatch(dialog, /\/api\/sales\/crm-leads\//);
});

test("a meeting with no lead is cancelled on its own endpoint, and offered only to whoever booked it", () => {
  assert.match(page, /meeting\.enquiryId\s*\?\s*`\/api\/sales\/crm-leads\/\$\{encodeURIComponent\(meeting\.enquiryId\)\}\/meetings\/\$\{encodeURIComponent\(meeting\.id\)\}`\s*:\s*`\/api\/sales\/crm-meetings\/\$\{encodeURIComponent\(meeting\.id\)\}`/);
  assert.match(page, /if \(canWrite && !isCancelled\(meeting\) && \(meeting\.enquiryId \|\| meeting\.mine\)\)/);
});
