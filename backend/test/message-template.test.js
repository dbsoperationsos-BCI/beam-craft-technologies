const test = require("node:test");
const assert = require("node:assert/strict");
const { renderTemplate, placeholdersIn } = require("../src/services/messageTemplate");

/*
 * The wording the studio sends, filled in from a record.
 *
 * Everything here is about a message that goes to a client, so the failures are the kind somebody
 * else reads: a figure that did not arrive, a brace left mid-sentence, a name mangled because the
 * body was treated as a pattern rather than as prose.
 */

test("a placeholder is replaced by what the record answers", () => {
  assert.equal(
    renderTemplate("We received {payment amount} on {payment date}.", { "payment amount": "₹2,000.00", "payment date": "07 Sep 2026" }),
    "We received ₹2,000.00 on 07 Sep 2026.",
  );
});

test("a placeholder nothing answers is left exactly as typed", () => {
  /*
   * Blanking it would hand the studio a sentence with a hole in it and nothing to say what was
   * meant to be there. Left in, the mistake is visible in the one place it will be read - and the
   * dialog that shows the message says so out loud.
   */
  assert.equal(renderTemplate("Ref {invoice number} please.", { "payment id": "X" }), "Ref {invoice number} please.");
});

test("a name is matched however it was spaced or capitalised", () => {
  assert.equal(renderTemplate("{Payment Amount} / {  payment   amount  }", { "payment amount": "₹5" }), "₹5 / ₹5");
});

test("zero is an answer, and so is an empty string", () => {
  // A balance of nothing is the most important receipt the studio sends; it must not read as a
  // placeholder that failed.
  assert.equal(renderTemplate("Balance {outstanding balance}.", { "outstanding balance": "₹0.00" }), "Balance ₹0.00.");
  assert.equal(renderTemplate("Mode {payment mode}.", { "payment mode": "" }), "Mode .");
  assert.equal(renderTemplate("Count {n}.", { n: 0 }), "Count 0.");
});

test("the studio's own text is prose, never a pattern", () => {
  /*
   * The body is whatever somebody typed. Building a regular expression out of it would let a stray
   * `(` or `*` throw, and `$&` in a *value* would splice the match back into the message - which is
   * how a client's name could rewrite the sentence around it.
   */
  assert.equal(renderTemplate("Cost (₹) * {amount} [see *note*]", { amount: "₹5" }), "Cost (₹) * ₹5 [see *note*]");
  assert.equal(renderTemplate("Hi {client name}.", { "client name": "A & B $& Co" }), "Hi A & B $& Co.");
});

test("an empty or missing body renders as nothing rather than throwing", () => {
  for (const body of ["", null, undefined]) assert.equal(renderTemplate(body, { a: "b" }), "");
});

test("the placeholders a body uses are listed once each, in the order used", () => {
  // What the Settings screen shows back, and how it tells the studio a placeholder nothing fills
  // has crept into the wording.
  assert.deepEqual(placeholdersIn("{b} then {A} then {b} again"), ["b", "a"]);
  assert.deepEqual(placeholdersIn("nothing here"), []);
});
