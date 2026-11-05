const test = require("node:test");
const assert = require("node:assert");
const { classify, classifyAlone, INTENT } = require("../src/services/ai/intent");

/**
 * What a question needs, decided before any of it is done.
 *
 * Three kinds: DATA needs a tool, KNOWLEDGE needs the studio's documents, GENERAL needs neither.
 * Getting it wrong is not a small cost - a data question routed to GENERAL comes back "I am unable
 * to provide real-time data" while the figure sits one tool call away.
 */

const GREETING = [{ role: "user", content: "Hello" }, { role: "assistant", content: "I am Nebula." }];

test("a question that classifies on its own is never overridden by what came before it", () => {
  /*
   * The bug this exists to prevent, and it reached a user.
   *
   * Inheritance used to be checked first, for anything under seven words. "how many leads are
   * pending today" is exactly six, so after a preceding "Hello" it inherited GENERAL, ran no tool
   * and answered "I am unable to provide real-time data" - with the figure one call away.
   */
  for (const question of [
    "how many leads are pending today",
    "how many leads do we have",
    "anything overdue?",
    "show me the overdue leads",
  ]) {
    assert.strictEqual(classify(question, GREETING).intent, INTENT.DATA, question);
    assert.strictEqual(classify(question, []).intent, INTENT.DATA, `${question} (alone)`);
  }
});

test("a bare follow-up borrows the previous question's intent", () => {
  const after = [{ role: "user", content: "how many leads are overdue" }, { role: "assistant", content: "Eleven." }];
  const result = classify("which one first?", after);
  assert.strictEqual(result.intent, INTENT.DATA);
  assert.match(result.reason, /follow-up/);
});

test("two vague turns in a row do not compound into confidence", () => {
  // Inheriting from a question that itself decided nothing would be borrowing a guess.
  const vague = [{ role: "user", content: "Hello" }, { role: "assistant", content: "Hi." }];
  const result = classify("and then?", vague);
  assert.strictEqual(result.intent, INTENT.GENERAL);
  assert.ok(!/follow-up/.test(result.reason), "it should not claim to have inherited anything");
});

test("advice is answered as advice, even when it names records", () => {
  for (const question of [
    "how do I win back a client",
    "how can I reduce overdue leads",
    "give me ideas to improve wedding photography sales",
    "what is the best way to follow up",
  ]) {
    assert.strictEqual(classify(question, []).intent, INTENT.GENERAL, question);
  }
});

test("a written process is a knowledge question", () => {
  for (const question of ["what is our leave policy", "how do we handle a refund", "what is our SOP for shoots"]) {
    assert.strictEqual(classify(question, []).intent, INTENT.KNOWLEDGE, question);
  }
});

test("a standing request for the state of things needs the figures", () => {
  /*
   * "What needs my attention today?" names no record and asks no quantity, and routed as general it
   * produced advice true of any studio on any day. It is a question about the business right now.
   */
  for (const question of [
    "what needs my attention today",
    "what should I focus on first",
    "how are we doing",
    "where do we stand",
  ]) {
    assert.strictEqual(classify(question, []).intent, INTENT.DATA, question);
  }
});

test("classifyAlone says whether a rule actually matched", () => {
  // The flag is what makes inheritance safe - without it every question looks decided.
  assert.strictEqual(classifyAlone("how many leads do we have").decided, true);
  assert.strictEqual(classifyAlone("Hello").decided, false);
  assert.strictEqual(classifyAlone("thanks").decided, false);
});

test("an empty question is not a data question", () => {
  for (const empty of ["", "   ", null, undefined]) {
    assert.strictEqual(classify(empty, GREETING).intent, INTENT.GENERAL);
    assert.strictEqual(classify(empty, GREETING).needsTools, false);
  }
});

test("a long question that matched nothing does not inherit", () => {
  const after = [{ role: "user", content: "how many leads are overdue" }];
  const wandering = "I was thinking about the studio and what makes a good photograph in general terms";
  const result = classify(wandering, after);
  assert.strictEqual(result.intent, INTENT.GENERAL);
  assert.ok(!/follow-up/.test(result.reason));
});
