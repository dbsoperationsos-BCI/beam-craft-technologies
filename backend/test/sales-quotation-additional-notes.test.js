const test = require("node:test");
const assert = require("node:assert/strict");
const { quotationPayloadSchema, quotationData } = require("../src/modules/sales/projects/controller");

/*
 * The free text a quotation carries beyond its services, deliverables and price.
 *
 * It is the one client-facing field the studio types as prose, and it reaches the client's copy
 * through two doors: the column the register reads, and the saved payload the generator reloads
 * when a version is opened for editing. What is worth holding is that both are written from the
 * same submission, that an empty note stores nothing rather than an empty string - the client's
 * page prints the section only when there is something in it - and that duplicating a quotation
 * onto another enquiry carries the note across, since that copy is put back through this schema.
 */

const submission = { enquiryId: "ENQ-001", additionalNotes: "Drone covered on day two.\nTravel within 5km." };

test("a note is stored on the quotation and kept in its payload", () => {
  const parsed = quotationPayloadSchema.parse(submission);
  const data = quotationData(parsed);
  assert.equal(data.additionalNotes, "Drone covered on day two.\nTravel within 5km.");
  // The payload is what the generator reloads when the version is opened to be edited, so the note
  // has to survive there too or editing a quotation would silently drop it from the next version.
  assert.equal(data.payload.additionalNotes, "Drone covered on day two.\nTravel within 5km.");
});

test("nothing typed stores null rather than an empty note", () => {
  for (const value of [undefined, "", "   ", null]) {
    const data = quotationData(quotationPayloadSchema.parse({ ...submission, additionalNotes: value }));
    assert.equal(data.additionalNotes, null);
  }
});

test("a note is trimmed but keeps the lines it was typed with", () => {
  const parsed = quotationPayloadSchema.parse({ ...submission, additionalNotes: "  One.\n\nTwo.  " });
  assert.equal(parsed.additionalNotes, "One.\n\nTwo.");
});

test("a note longer than the field allows is refused rather than truncated", () => {
  // The generator's own field stops at 2000 characters, so anything longer did not come from
  // somebody typing. Truncating would send the client half a sentence.
  const parsed = quotationPayloadSchema.safeParse({ ...submission, additionalNotes: "x".repeat(2001) });
  assert.equal(parsed.success, false);
});

test("duplicating a quotation onto another enquiry carries the note across", () => {
  // Duplicate re-parses the saved payload with only the enquiry swapped, which is what this covers:
  // the same package quoted for a second client keeps what was written about the package.
  const saved = quotationData(quotationPayloadSchema.parse(submission)).payload;
  const parsed = quotationPayloadSchema.parse({ ...saved, enquiryId: "ENQ-002" });
  assert.equal(quotationData(parsed).additionalNotes, "Drone covered on day two.\nTravel within 5km.");
});
