const test = require("node:test");
const assert = require("node:assert");
const { candidateNames, NEVER_A_NAME, MAX_CANDIDATES } = require("../src/services/ai/mentions");

/**
 * Which words in a question might be somebody's name.
 *
 * The point of this file is what it does *not* do: there is no list of clients here, no rule about
 * capitalisation, and nothing to maintain as people come and go. It offers candidates and the
 * database decides. So these tests are about the two ways that can go wrong - dropping a real name,
 * which puts the assistant back to inventing facts about clients, and offering so many candidates
 * that a question turns into a scan.
 */

test("a name in an ordinary question is offered", () => {
  assert.deepStrictEqual(candidateNames("I need details about client shivani"), ["shivani"]);
  assert.deepStrictEqual(candidateNames("what city is shivani in"), ["shivani"]);
  assert.deepStrictEqual(candidateNames("is shivani interested"), ["shivani"]);
});

test("a question with no name offers nothing", () => {
  /*
   * This is what keeps the lookup cheap. "How many leads do we have" must cost no query at all -
   * every word in it is ordinary, and searching for "leads" would match nothing while still
   * costing a round trip.
   */
  for (const question of [
    "how many leads do we have",
    "hi",
    "what is the pipeline status",
    "how many follow ups are overdue today",
  ]) {
    assert.deepStrictEqual(candidateNames(question), [], question);
  }
});

test("the business's own vocabulary is never a name", () => {
  for (const word of ["lead", "client", "remark", "vertical", "wedding", "city", "budget", "status"]) {
    assert.ok(NEVER_A_NAME.has(word), `${word} should not be treated as a name`);
  }
});

test("candidates are bounded", () => {
  // A sentence full of unusual words must not become one query per word.
  const wordy = "Arjun Priya Kavya Nithya Deepak Ramesh Sundar Meena";
  assert.ok(candidateNames(wordy).length <= MAX_CANDIDATES);
});

test("punctuation and short tokens are dropped", () => {
  assert.deepStrictEqual(candidateNames("details about shivani?"), ["shivani"]);
  // Two letters is an initial or a typo, not worth a query.
  assert.deepStrictEqual(candidateNames("who is A B"), []);
  assert.deepStrictEqual(candidateNames("what about 12345"), []);
});

test("a name is offered once however often it is repeated", () => {
  assert.deepStrictEqual(candidateNames("shivani shivani Shivani"), ["shivani"]);
});

test("a misspelling is still offered, because the database decides", () => {
  /*
   * `mentions.js` deliberately does not judge whether a word is a plausible name - the CRM's own
   * `contains` search does, and it behaves the way the screens do. A typo that the search would
   * still match must reach it.
   */
  assert.deepStrictEqual(candidateNames("details about shivan"), ["shivan"]);
});

test("names in other scripts are offered", () => {
  // The word split is unicode-aware; a Tamil name must not be silently dropped.
  assert.deepStrictEqual(candidateNames("details about ஷிவானி"), ["ஷிவானி"]);
});
