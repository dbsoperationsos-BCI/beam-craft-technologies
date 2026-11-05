import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { activityLogInfoSections } from "../src/constants/infoPanelConfig.js";

/*
 * "What changed" has to appear in all three places a reader meets a log line, or it looks like the
 * feature is not working: the table column, the side panel, and the payload behind both. It was in
 * the column and in the API and **not** in the panel, because the panel draws a fixed list of fields
 * and nothing adds itself to it.
 */

const root = path.join(import.meta.dirname, "..", "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const PAGE = read("frontend/src/components/admin/UserActivityLogsPage.js");
const SERVICE = read("backend/src/modules/admin/activity-logs/service.js");

test("the panel has a section for it, of its own", () => {
  const section = activityLogInfoSections.find((part) => part.title === "What changed");
  assert.ok(section, "the panel draws a fixed list of fields - one that is not on it is not shown");
  assert.deepEqual(section.fields, [["changes", "Changes", "changes"]]);
  // Its own section rather than a line under Request: it is the answer the panel is opened for, and
  // several sentences rather than one value.
  const titles = activityLogInfoSections.map((part) => part.title);
  assert.ok(titles.indexOf("What changed") < titles.indexOf("Response"));
});

test("the panel breaks the changes back into one line each", () => {
  /*
   * They are stored as one string joined by " · " because a column holds one value. In the panel -
   * the one place somebody reads them carefully - that is a paragraph of field names.
   */
  assert.match(PAGE, /changes: \(value\) => \{/);
  assert.match(PAGE, /String\(value \|\| ""\)\.split\(" · "\)/);
  // Formatters are keyed by the field's **type**, which is why the type is named `changes` too.
  assert.match(PAGE, /logTime: \(value\) => formatLogTime\(value\)/);
  // A line with none says why rather than showing a bare dash.
  assert.match(PAGE, /Nothing on a tracked record, or the save was refused\./);
});

test("the column is there as well, and unsortable", () => {
  assert.match(PAGE, /id: "changes",\n\s*label: "What changed"/);
  assert.match(PAGE, /sortable: false,/);
});

test("both payloads carry it - the list behind the column and the detail behind the panel", () => {
  // The list, or the column is empty whatever the panel shows.
  assert.match(SERVICE, /changes: true \};/);
  // The detail, or the panel is empty whatever the column shows. Two shapers, both needed.
  const detail = SERVICE.slice(SERVICE.indexOf("const toRow = (row) => ({"));
  assert.match(detail.slice(0, detail.indexOf("});")), /changes: row\.changes \|\| null,/);
});
