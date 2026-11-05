const test = require("node:test");
const assert = require("node:assert");
const { VERTICALS, verticalFor, verticalDirective } = require("../src/services/ai/verticals");

/**
 * Which business a lead belongs to.
 *
 * The studio runs three under one CRM and they do not overlap. Nebula used to answer every lead as
 * though it were a wedding, because that is what most of a photography model's training data is -
 * so a Qua Qua mother asking about a newborn shoot was advised on her reception coverage.
 *
 * The vertical is a fact on the row, so it is looked up rather than inferred, and these lock down
 * the boundaries.
 */

test("each branch maps to the business it actually shoots", () => {
  assert.strictEqual(verticalFor("Dum Dum").shoots, "weddings and engagements");
  assert.strictEqual(verticalFor("Qua Qua").shoots, "newborn, baby and maternity");
  assert.strictEqual(verticalFor("Corp").shoots, "corporate work");
});

test("the branch name is matched however it is cased or spaced", () => {
  // It arrives from a text column that has held anything over the years.
  for (const written of ["qua qua", "QUA QUA", "  Qua Qua  ", "Qua qua"]) {
    assert.strictEqual(verticalFor(written)?.name, "Qua Qua", written);
  }
});

test("an unknown branch invents nothing", () => {
  /*
   * The important half. A blank or unrecognised branch must produce no directive at all - guessing
   * a vertical would have the model confidently advising on the wrong business, which is worse
   * than it saying nothing about the business at all.
   */
  for (const written of ["", "   ", null, undefined, "Team 33", "Nonsense"]) {
    assert.strictEqual(verticalFor(written), null, JSON.stringify(written));
    assert.strictEqual(verticalDirective(written), "");
  }
});

test("the directive names what is out of bounds, not just what is in", () => {
  /*
   * Saying "this is a Qua Qua lead" leaves the model free to talk about weddings anyway. Naming
   * the other businesses as wrong is what stops it.
   */
  const quaQua = verticalDirective("Qua Qua");
  assert.match(quaQua, /newborn, baby and maternity ONLY/);
  assert.match(quaQua, /Never mention weddings, engagements, receptions or corporate work/);

  const dumDum = verticalDirective("Dum Dum");
  assert.match(dumDum, /weddings and engagements ONLY/);
  assert.match(dumDum, /Never mention newborn, baby, maternity or corporate work/);

  const corp = verticalDirective("Corp");
  assert.match(corp, /corporate work ONLY/);
  assert.match(corp, /Never mention weddings, engagements, newborn or baby work/);
});

test("no vertical excludes the work it is supposed to do", () => {
  // A boundary that forbids its own business would be worse than none at all.
  for (const vertical of Object.values(VERTICALS)) {
    for (const word of vertical.shoots.split(/,| and /).map((part) => part.trim()).filter(Boolean)) {
      assert.ok(
        !new RegExp(`\\b${word}\\b`, "i").test(vertical.never),
        `${vertical.name} forbids its own work: ${word}`,
      );
    }
  }
});


/*
 * Which of the studio's three businesses a CRM session covers.
 *
 * The CRM board shows one vertical at a time and they have nothing to do with each other. An
 * assistant opened on Qua Qua reporting thirty-one thousand leads, most of them somebody else's
 * work, is worse than one that says it cannot see them.
 */
const { otherVerticalNamed, otherVerticalReply } = require("../src/services/ai/verticals");

test("a question naming another board is recognised", () => {
  assert.strictEqual(otherVerticalNamed("how many qua qua leads do we have?", "Dum Dum"), "Qua Qua");
  assert.strictEqual(otherVerticalNamed("show me the dum dum pipeline", "Qua Qua"), "Dum Dum");
  assert.strictEqual(otherVerticalNamed("what about corp?", "Dum Dum"), "Corp");
  // However it is spelled.
  assert.strictEqual(otherVerticalNamed("QUAQUA numbers please", "Corp"), "Qua Qua");
});

test("a question about this board's own work is not deflected", () => {
  /*
   * The distinction that matters. A question about weddings on a Qua Qua board is a question about
   * the work, which the prompt handles; a question naming another board is about data this session
   * cannot see.
   */
  for (const [question, vertical] of [
    ["how many leads do I have?", "Dum Dum"],
    ["what should I offer for their wedding?", "Qua Qua"],
    ["send a corporate album quote", "Corp"],
    ["which leads are overdue?", "Qua Qua"],
  ]) {
    assert.strictEqual(otherVerticalNamed(question, vertical), null, `${vertical}: ${question}`);
  }
});

test("a vertical is not found inside a longer word", () => {
  // "corp" must not match inside "corporate" or "incorporated" when Corp is not the subject.
  assert.strictEqual(otherVerticalNamed("incorporated clients", "Dum Dum"), null);
  assert.strictEqual(otherVerticalNamed("corporate style album", "Dum Dum"), null);
});

test("nothing is deflected when the session has no vertical", () => {
  // A global or unscoped session sees everything it is allowed to; there is no other board.
  assert.strictEqual(otherVerticalNamed("how many qua qua leads?", null), null);
  assert.strictEqual(otherVerticalNamed("how many qua qua leads?", "nonsense"), null);
});

test("the reply says what it has and where to go", () => {
  /*
   * Not a bare refusal, and never a number. Answering "Qua Qua leads: 0" from a Dum-Dum-filtered
   * summary is what this replaced - no data leaked, and a zero still reads as an emptiness rather
   * than as no access.
   */
  const reply = otherVerticalReply("Dum Dum", "Qua Qua");
  assert.match(reply, /only have Dum Dum details/);
  assert.match(reply, /weddings and engagements/);
  assert.match(reply, /Switch the CRM to Qua Qua/);
  assert.ok(!/\d/.test(reply), "a deflection must not carry a figure");
});
