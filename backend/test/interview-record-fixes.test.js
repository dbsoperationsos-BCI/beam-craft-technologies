const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

/*
 * Four small Interview register rules, each of which once failed quietly:
 *  - a reopened application link is prefilled from the parsed record, not the JSON text;
 *  - the schedule dialog can clear the interviewer, the follow-up date and the remarks;
 *  - a transcript refused for a reason with a status answers with that status;
 *  - a sheet link is removed or restored only by whoever owns it, as it is updated and synced.
 */

const DIR = path.join(__dirname, "..", "src", "modules", "hrm", "interview");
const read = (name) => fs.readFileSync(path.join(DIR, name), "utf8");
const INVITES = read("invites.js");
const CONTROLLER = read("controller.js");
const SHEET_LINKS = read("sheetLinksController.js");
const slice = (source, from, to) => source.slice(source.indexOf(from), to ? source.indexOf(to, source.indexOf(from)) : undefined);

test("a reopened link is prefilled with the links and attachments the record holds", () => {
  const prefill = slice(INVITES, "function prefillFrom(", "async function verifyPublicInvite(");
  assert.match(prefill, /const row = service\.toRow\(candidate\);/);
  // The raw row holds both as JSON text; read from it they were a string, not a list.
  assert.doesNotMatch(prefill, /candidate\.portfolioLinks/);
  assert.doesNotMatch(prefill, /candidate\.attachments/);
  assert.match(prefill, /portfolioLinks: row\.portfolioLinks\?\.length/);
  assert.match(prefill, /attachments: Array\.isArray\(row\.attachments\) \? row\.attachments : \[\]/);
});

test("toRow parses the two columns the prefill reads", () => {
  const { toRow } = require("../src/modules/hrm/interview/service");
  const row = toRow({ portfolioLinks: JSON.stringify(["https://a.example"]), attachments: JSON.stringify([{ name: "cv", url: "https://b.example" }]) });
  assert.deepEqual(row.portfolioLinks, ["https://a.example"]);
  assert.deepEqual(row.attachments, [{ name: "cv", url: "https://b.example" }]);
});

test("the schedule tells a cleared field from one left alone", () => {
  const schedule = slice(CONTROLLER, "async function schedule(");
  // `??` treats the dialog's null ("cleared") as "unchanged" and puts the old value back.
  for (const field of ["interviewerEmployeeId", "interviewer", "nextFollowUpDate", "remarks"]) {
    assert.doesNotMatch(schedule, new RegExp(`${field}: input\\.${field} \\?\\?`), `${field} cannot be cleared`);
  }
  assert.match(schedule, /const given = \(key\) => input\[key\] !== undefined;/);
  // An interviewer cleared takes the name derived from them along.
  assert.match(schedule, /input\.interviewerEmployeeId === null \? null :/);
});

test("the schedule dialog sends null for a box it empties", () => {
  const dialog = fs.readFileSync(path.join(__dirname, "..", "..", "frontend", "src", "components", "hrm", "InterviewScheduleDialog.js"), "utf8");
  assert.match(dialog, /interviewerEmployeeId: values\.interviewerEmployeeId \|\| null,/);
  assert.match(dialog, /nextFollowUpDate: values\.nextFollowUpDate \|\| null,/);
  assert.match(dialog, /remarks: values\.remarks \|\| null,/);
});

test("a transcript refused with a status answers with it, not with a 500", () => {
  const list = slice(CONTROLLER, "async function candidateTranscripts(", "async function candidateTranscriptDetail(");
  assert.match(list, /if \(error\?\.status\) return fail\(res, error,/);
  const detail = slice(CONTROLLER, "async function candidateTranscriptDetail(", "async function candidateCallLogs(");
  assert.match(detail, /return fail\(res, error, "Unable to load that transcript\."\);/);
  assert.doesNotMatch(detail, /res\.status\(500\)/);
});

test("a sheet link is removed and restored only by its owner, like update and sync", () => {
  for (const handler of ["update", "remove", "restore", "sync"]) {
    const body = slice(SHEET_LINKS, `async function ${handler}(`, "\nasync function ");
    assert.match(body, /if \(notOwner\((existing|deleted|link), req\)\) return res\.status\(403\)/, `${handler} skips the owner check`);
  }
  // And before anything is written: remove deletes the sheet's candidates too.
  const remove = slice(SHEET_LINKS, "async function remove(", "\nasync function ");
  assert.ok(remove.indexOf("notOwner(") < remove.indexOf("deletedAt: new Date()"));
  const restore = slice(SHEET_LINKS, "async function restore(", "\nasync function ");
  assert.ok(restore.indexOf("notOwner(") < restore.indexOf("deletedAt: null"));
});
