const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

/*
 * The calls on a candidate's number, for the popup's Call Logs tab.
 *
 * The studio's call log is one table fed by the handset integration and keyed by the **number** - it is
 * not the CRM's private property, it just happened to be read only from there. A recruiter ringing a
 * candidate produces a row in it exactly as a salesperson ringing a client does, and "has anybody
 * actually called this person, and when" is the question the Follow Up stage exists to answer.
 *
 * Two things this must not become: a second copy of that query, and a way to read the CRM's own notes
 * about a client who happens to share the number.
 */

const read = (...parts) => fs.readFileSync(path.join(__dirname, "..", ...parts), "utf8");
const SERVICE = read("src", "modules", "sales", "crm-leads", "callLogService.js");
const CONTROLLER = read("src", "modules", "hrm", "interview", "controller.js");
const ROUTES = read("src", "modules", "hrm", "interview", "routes.js");

test("the query lives with the call log, not a second copy of it in Interview", () => {
  /*
   * `listCallLogsForNumber` sits beside `listLeadCallLogs` and shares its column list, its ordering and
   * its `ensureCallLogTable` guard. A copy in the Interview module would be the one that stopped being
   * updated the next time a column was added.
   */
  assert.match(SERVICE, /async function listCallLogsForNumber\(/);
  assert.match(SERVICE, /listCallLogsForNumber,/);
  assert.equal(/sales_crm_call_log/.test(CONTROLLER), false, "Interview must not query that table itself");
});

test("the number is matched as ten digits, through a placeholder", () => {
  // The same `numberKey` reading the webhook matches on, so a number stored as +91… and one stored as
  // 0… are the same candidate. Interpolating it would be an injection in a raw query.
  const body = /async function listCallLogsForNumber\(([\s\S]*?)\n}/.exec(SERVICE)?.[1] || "";
  assert.ok(body, "listCallLogsForNumber could not be read");
  assert.match(body, /numberKey\(/);
  // The backticks are escaped in the source, being inside a template literal.
  assert.match(body, /RIGHT\(REGEXP_REPLACE\(COALESCE\(\\`client_number\\`, ''\), '\[\^0-9\]', ''\), 10\) = \?/);
  assert.equal(/\$\{(?!size)/.test(body.replace(/\$\{size\}/g, "")), false, "values go through ? in raw SQL");
});

test("a number that cannot be read is an empty tab, not a query for everything", () => {
  /*
   * The one way this could leak the whole studio's call history: a blank key matching every row, or a
   * `WHERE` that falls away. A candidate with no number has no calls, and that is the honest answer.
   */
  const body = /async function listCallLogsForNumber\(([\s\S]*?)\n}/.exec(SERVICE)?.[1] || "";
  assert.match(body, /if \(!key\) return \[\];/);
});

test("the tab carries the call in full, and still not the CRM's filing of the client", () => {
  /*
   * ── The line, and who moved it ────────────────────────────────────────────────────────────────
   *
   * This used to strip the note, the status and the recording too, on the reading that
   * `HRM / Interview` is not a grant of `SALES / CRM Leads`. The studio's decision is the other
   * one: each module answers for its own permission, so a recruiter who may open a candidate may
   * read the calls on that candidate's number in full - including what was said and the recording.
   *
   * What that admits is real and deliberate: the log is one studio-wide table keyed by the number
   * dialled, so somebody who may edit a candidate can point a record at any number. Narrowing it
   * again is a permission decision, not a code one.
   *
   * ── What is still withheld, and why that is not the same question ─────────────────────────────
   *
   * `clientName` and `enquiryId` are the CRM's own *filing* of a person - the name it chose and the
   * enquiry it opened - which says nothing about the call and belongs to the board. `raw` is the
   * integration's untouched webhook payload, which no screen should render. None of the three was
   * asked for, and each would widen this further for nothing.
   */
  const body = /async function candidateCallLogs\(([\s\S]*?)\n}/.exec(CONTROLLER)?.[1] || "";
  assert.ok(body, "candidateCallLogs could not be read");

  // The call itself, in full.
  for (const field of ["calledAt", "durationSeconds", "employeeName", "note", "crmStatus", "recordingUrl"]) {
    assert.ok(body.includes(field), `${field} is what the tab was opened to read`);
  }
  // And not the CRM's filing of them, nor the raw payload.
  for (const field of ["clientName", "enquiryId", "raw"]) {
    assert.equal(body.includes(field), false, `${field} is the board's, and was not asked for`);
  }
});

test("a candidate's transcripts are reached through their own calls", () => {
  /*
   * A transcript hangs off a call, not off a lead, which is the only reason this is reachable at
   * all: a candidate has never had an enquiry id. The calls are found by the number on the record
   * the id names, and the transcripts by those call ids.
   */
  const body = /async function candidateTranscripts\(([\s\S]*?)\n}/.exec(CONTROLLER)?.[1] || "";
  assert.ok(body, "candidateTranscripts could not be read");
  assert.match(body, /await service\.getCandidate\(req\.params\.id\)/);
  assert.match(body, /listCallLogsForNumber\(candidate\.whatsappNumber \|\| candidate\.phone/);
  assert.match(body, /transcripts\.listForCallLogs\(calls\.map\(\(call\) => call\.id\)\)/);
  assert.equal(/req\.body|req\.query\.phone/.test(body), false, "the number is the record's");
});

test("one transcript is reached through the candidate, never by its id alone", () => {
  /*
   * A bare transcript id would be a way to read any call in the studio from a screen that answers
   * for the Interview register. So the id is checked against the transcripts this candidate's own
   * calls produced, and anything else is simply not found.
   */
  const body = /async function candidateTranscriptDetail\(([\s\S]*?)\n}/.exec(CONTROLLER)?.[1] || "";
  assert.ok(body, "candidateTranscriptDetail could not be read");
  assert.match(body, /allowed\.some\(\(row\) => row\.id === wanted\)/);
  assert.match(body, /return res\.status\(404\)/);
  // The lookup happens after the check, so an id that is not this candidate's is never even read.
  assert.ok(body.indexOf("allowed.some") < body.indexOf("transcripts.findById"),
    "the transcript is fetched before it is checked to be this candidate's");
});

test("an empty set of calls asks for nothing, rather than every transcript there is", () => {
  // `in: []` would be a query nobody asked for. A candidate with no calls has no transcripts.
  const repo = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "sales", "call-transcripts", "repository.js"), "utf8");
  const body = /function listForCallLogs\(([\s\S]*?)\n}/.exec(repo)?.[1] || "";
  assert.ok(body, "listForCallLogs could not be read");
  assert.match(body, /if \(!ids\.length\) return Promise\.resolve\(\[\]\);/);
  assert.match(body, /callLogId: \{ in: ids \}/);
});

test("the number comes off the candidate the id names", () => {
  // Never from the request. A caller who could name the number could read the call history of anybody
  // the studio has ever rung.
  const body = /async function candidateCallLogs\(([\s\S]*?)\n}/.exec(CONTROLLER)?.[1] || "";
  assert.match(body, /await service\.getCandidate\(req\.params\.id\)/);
  assert.equal(/req\.body|req\.query\.phone/.test(body), false, "the number is the record's");
});

test("the route is guarded by the screen's own permission", () => {
  // A GET on the interview router, so `requireModule` asks for READ - the same thing looking at the
  // register asks for.
  assert.match(ROUTES, /router\.get\("\/candidates\/:id\/call-logs", controller\.candidateCallLogs\);/);
});
