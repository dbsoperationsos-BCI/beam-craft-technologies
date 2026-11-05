const test = require("node:test");
const assert = require("node:assert/strict");
const { buildQuotationName } = require("../src/services/quotationName");

/*
 * What the studio calls a quotation: `Quotation - Vertical - Branch - Client Name - Venue`.
 *
 * Stored on the row when the version is raised, so this is the rule that decides what a client's
 * copy is filed under for good - and the same rule the backfill names older rows with. A change
 * here renames nothing already stored, which is the point of storing it.
 */

const quotation = (over = {}) => ({
  sourceBranch: "Erode TN",
  eventVenue: "Kongu Mahal",
  payload: { vertical: "Dum Dum", name: "Shanmugam & Parimala" },
  ...over,
});

test("the name is the five parts in order, joined by dashes", () => {
  assert.equal(buildQuotationName(quotation()), "Quotation - Dum Dum - Erode TN - Shanmugam & Parimala - Kongu Mahal");
});

test("a part the quotation does not have is dropped, never left as an empty segment", () => {
  // A quotation raised before the venue was agreed reads as far as the client and stops, rather
  // than trailing a bare separator.
  assert.equal(buildQuotationName(quotation({ eventVenue: null, payload: { vertical: "Dum Dum", name: "Shanmugam & Parimala" } })), "Quotation - Dum Dum - Erode TN - Shanmugam & Parimala");
  assert.equal(buildQuotationName(quotation({ sourceBranch: "" })), "Quotation - Dum Dum - Shanmugam & Parimala - Kongu Mahal");
});

test("the word Quotation always leads, so no row is nameless", () => {
  assert.equal(buildQuotationName({}), "Quotation");
  assert.equal(buildQuotationName({ payload: {} }), "Quotation");
  assert.equal(buildQuotationName(), "Quotation");
});

/*
 * ── The client, which each vertical answers with a different field ────────────────────────────
 *
 * A wedding has a groom and a bride, a Qua Qua shoot has a baby or its mother, a Corp job has a
 * company - and every vertical also has the shared **Enquire Name**, which is who rang up. Naming
 * all three off that one box put the enquirer where the studio reads the subject.
 */

const named = (payload) => buildQuotationName({ sourceBranch: "Erode TN", payload });

test("a wedding is named by the couple", () => {
  assert.equal(named({ vertical: "Dum Dum", name: "harish", groomName: "Shanmugam", brideName: "Parimala" }), "Quotation - Dum Dum - Erode TN - Shanmugam & Parimala");
});

test("half a couple is not a couple, and falls back to who enquired", () => {
  // "Shanmugam &" reads as a mistake; the enquirer's name reads as a fact.
  assert.equal(named({ vertical: "Dum Dum", name: "harish", groomName: "Shanmugam" }), "Quotation - Dum Dum - Erode TN - harish");
  assert.equal(named({ vertical: "Dum Dum", name: "harish", brideName: "Parimala" }), "Quotation - Dum Dum - Erode TN - harish");
});

test("Qua Qua is named by the baby or the mother, and Corp by the company", () => {
  assert.equal(named({ vertical: "Qua Qua", name: "harish", babyOrMotherName: "Baby Aarav" }), "Quotation - Qua Qua - Erode TN - Baby Aarav");
  assert.equal(named({ vertical: "Corp", name: "harish", companyName: "Acme Pvt Ltd" }), "Quotation - Corp - Erode TN - Acme Pvt Ltd");
});

test("a vertical whose own field was left empty still names its client", () => {
  // `name` is required on all three forms, which is what makes it a safe fallback.
  for (const vertical of ["Dum Dum", "Qua Qua", "Corp"]) {
    assert.equal(named({ vertical, name: "harish" }), `Quotation - ${vertical} - Erode TN - harish`);
  }
});

test("a quotation raised before the vertical forms falls back to its stored client name", () => {
  assert.match(buildQuotationName(quotation({ clientName: "harish", payload: { vertical: "Corp" } })), /harish/);
});

test("stray whitespace does not reach the name", () => {
  // Typed fields arrive with whatever spacing somebody used; the name is read out and quoted.
  assert.equal(
    buildQuotationName({ sourceBranch: "  Coimbatore  ", payload: { vertical: "Qua Qua", name: " Ravi   Kumar ", eventVenue: "Hall  A" } }),
    "Quotation - Qua Qua - Coimbatore - Ravi Kumar - Hall A",
  );
});

test("the branch and venue fall back to the payload where the columns are empty", () => {
  // A quotation stored before those became columns of their own still names itself in full.
  assert.equal(
    buildQuotationName({ payload: { vertical: "Qua Qua", nearestBranch: "Vizag", name: "Ravi", eventVenue: "Beach Resort" } }),
    "Quotation - Qua Qua - Vizag - Ravi - Beach Resort",
  );
});
