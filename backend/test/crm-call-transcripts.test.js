const test = require("node:test");
const assert = require("node:assert/strict");
const { assignSpeakers, opensWith } = require("../src/modules/sales/call-transcripts/speakers");
const { applicableSuggestions, toFullText } = require("../src/modules/sales/call-transcripts/service");
const { APPLICABLE_FIELDS, LEAD_STATUS_VALUES } = require("../src/modules/sales/call-transcripts/constants");

/*
 * The parts of transcription that are decisions rather than plumbing.
 *
 * Downloading, converting and running Whisper are exercised by using the feature; what is worth
 * pinning down here is who gets named as the speaker, and - far more important - exactly which
 * suggestions a person pressing Apply is allowed to write onto a lead.
 */

const SEGMENTS = [
  { startMs: 0, endMs: 3000, text: "Hello, DBS Studios." },
  { startMs: 4500, endMs: 7000, text: "Hi, asking about wedding packages." },
  { startMs: 7100, endMs: 9000, text: "Still the client talking." },
  { startMs: 14000, endMs: 16000, text: "Certainly, for December?" },
];

test("an outgoing call opens with the employee, an incoming one with the client", () => {
  assert.equal(opensWith("Outgoing"), "EMPLOYEE");
  assert.equal(opensWith("Incoming"), "CLIENT");
  assert.equal(assignSpeakers(SEGMENTS, { callType: "Outgoing" })[0].speaker, "EMPLOYEE");
  assert.equal(assignSpeakers(SEGMENTS, { callType: "Incoming" })[0].speaker, "CLIENT");
});

test("a gap between turns changes the speaker, continuous speech does not", () => {
  const rows = assignSpeakers(SEGMENTS, { callType: "Outgoing" });
  assert.equal(rows[0].speaker, "EMPLOYEE");
  assert.equal(rows[1].speaker, "CLIENT", "a 1.5s gap is a change of speaker");
  assert.equal(rows[2].speaker, "CLIENT", "a 0.1s gap is the same person still talking");
  assert.equal(rows[3].speaker, "EMPLOYEE", "a 5s gap changes back");
});

test("an unknown direction names nobody rather than guessing", () => {
  // Alternating from an unknown start would put the wrong name on half the lines, which reads as
  // fact. "Speaker" reads as what it is.
  for (const row of assignSpeakers(SEGMENTS, { callType: "Missed" })) assert.equal(row.speaker, "UNKNOWN");
  for (const row of assignSpeakers(SEGMENTS, {})) assert.equal(row.speaker, "UNKNOWN");
});

test("segments keep their order", () => {
  const rows = assignSpeakers(SEGMENTS, { callType: "Incoming" });
  assert.deepEqual(rows.map((row) => row.sequence), [0, 1, 2, 3]);
});

test("the full text is the segments, readably joined", () => {
  assert.equal(toFullText([{ text: "Hello  there." }, { text: "  Hi." }]), "Hello there. Hi.");
  assert.equal(toFullText([]), "");
});

test("only allowlisted fields can be applied", () => {
  const suggestions = {
    suggestedStatus: "Interested",
    budget: "1.5 lakhs",
    eventType: "Wedding",
    // Not in the allowlist. A model that returns it, or a caller that asks for it, must not be
    // able to write it.
    phone: "9999999999",
    status: "Converted",
  };
  const applied = applicableSuggestions(suggestions);
  assert.deepEqual(Object.keys(applied).sort(), ["eventPlannedType", "leadStatus", "preferredBudget"]);
  assert.equal(applied.phone, undefined);
  for (const field of Object.keys(applied)) assert.ok(APPLICABLE_FIELDS[field], `${field} is not allowlisted`);
});

test("a suggested status the CRM does not have is dropped", () => {
  // The model is given the list, but a wrong answer must not become a status no button can undo.
  assert.equal(applicableSuggestions({ suggestedStatus: "Very Interested" }).leadStatus, undefined);
  assert.equal(applicableSuggestions({ suggestedStatus: "Interested" }).leadStatus, "Interested");
  for (const status of LEAD_STATUS_VALUES) {
    assert.equal(applicableSuggestions({ suggestedStatus: status }).leadStatus, status);
  }
});

test("an empty suggestion never blanks a field that is already filled", () => {
  // Applying must only ever write something. A null budget means the call did not mention one,
  // not that the lead's budget should be cleared.
  const applied = applicableSuggestions({ budget: null, eventType: "", location: "   ", suggestedStatus: "Followup" });
  assert.deepEqual(applied, { leadStatus: "Followup" });
});

test("suggestions arrive as JSON from the database and as an object in memory", () => {
  const asJson = applicableSuggestions(JSON.stringify({ eventType: "Baby shoot" }));
  assert.deepEqual(asJson, { eventPlannedType: "Baby shoot" });
  assert.deepEqual(applicableSuggestions({ eventType: "Baby shoot" }), asJson);
});

test("nothing at all yields nothing to apply", () => {
  assert.deepEqual(applicableSuggestions(null), {});
  assert.deepEqual(applicableSuggestions("{}"), {});
  assert.deepEqual(applicableSuggestions(undefined), {});
});

test("a long call outcome is stored, not thrown away with the transcript", async () => {
  /*
   * The bug this comes from: `call_outcome` was VarChar(191) and the model wrote a two-sentence
   * outcome, so the whole update was rejected -
   *
   *   The provided value for the column is too long for the column's type. Column: call_outcome
   *
   * - and a transcript that had already cost a download, a conversion and a minute of CPU was lost
   * over a field nobody would have missed if it had simply been shorter.
   */
  const prisma = require("../src/config/db");
  const columns = await prisma.$queryRawUnsafe("SHOW COLUMNS FROM sales_call_transcript");
  const byName = Object.fromEntries(columns.map((column) => [column.Field, String(column.Type).toLowerCase()]));

  // Prose columns hold prose. A length on any of these is a length a model will one day exceed.
  for (const column of ["summary", "call_outcome", "next_action", "full_text"]) {
    assert.ok(byName[column], `${column} should exist`);
    assert.match(byName[column], /text/, `${column} holds prose and must not be a VARCHAR`);
  }
});

test("every bounded column on the transcript table is clamped before it is written", () => {
  /*
   * `markFailed` always clamped its two columns and `markCompleted` clamped none, which is how the
   * outcome column got through. The limits live in one table now, so the two cannot disagree.
   */
  const source = require("node:fs").readFileSync(
    require("node:path").join(__dirname, "..", "src", "modules", "sales", "call-transcripts", "repository.js"),
    "utf8",
  );
  for (const column of ["language", "provider", "sentiment", "errorCode", "errorMessage"]) {
    assert.match(source, new RegExp(`fit\\("${column}"`), `${column} should be written through fit()`);
  }
});
