const test = require("node:test");
const assert = require("node:assert");
const { askLine, maxTokens, stripLanguageLabel, stripEchoedQuestion, trimRepetition } = require("../src/services/ai/language");
const { greetingReply, leaksPrompt, dropDuplicatedWording, SYSTEM, studioScopeReply } = require("../src/services/ai/crmAssistant");
const { isOutOfScope, outOfScopeReply, greetingReply: moduleGreetingReply } = require("../src/services/ai/scope");
const { renderCrmContext } = require("../src/services/ai/crmContext");

/**
 * Tidying up what the model produces, and keeping it inside the studio's work.
 *
 * This file used to be about which language Nebula answered in. Tanglish is gone and the studio
 * works in English, so what is left is the part that was never about language: a small model signs
 * its answers, echoes the question, repeats itself, and will happily answer questions that have
 * nothing to do with the CRM. Every test here comes from an answer somebody actually saw.
 */

test("the question is the last thing the model reads", () => {
  const line = askLine("What should I do next?", "english");
  // The question must end the line: a trailing instruction is what the model started signing
  // its answers with ("English.", "Tamil").
  assert.ok(line.endsWith("What should I do next?"), line);
});

/*
 * What is asked for versus what can be delivered.
 *
 * Detection is always right; the model is the part that may not be able to hold up its end. These
 * two must stay separable, because the flag is the only thing that changes on the day a capable
 * model is configured.
 */

test("a question repeated on top of its own answer is removed", () => {
  const question = "enna timela client call panalam";
  const echoed = `${question}\nEvening 6 mani ku call pannunga.`;
  assert.strictEqual(stripEchoedQuestion(echoed, question), "Evening 6 mani ku call pannunga.");
});

test("an answer that merely starts with similar words is left alone", () => {
  // Only a first line that is the question and nothing else may be dropped - never a real sentence.
  const question = "What time should I call this client?";
  const answer = "What time you call matters less than calling today.";
  assert.strictEqual(stripEchoedQuestion(answer, question), answer);
  // Nor may a one-line answer be emptied.
  assert.strictEqual(stripEchoedQuestion(question, question), question);
});

test("a greeting is answered without a model", () => {
  for (const asked of ["hi", "hii", "hello", "hey", "ok", "okay", "thanks", "Hello!"]) {
    assert.ok(greetingReply(asked, "english"), asked);
  }
});

test("a real question is never treated as a greeting", () => {
  for (const asked of [
    "What should I do next with this lead?",
    "hi, what should I say to this client?",
    "okay so what is the budget",
    "indha lead ku enna panalam?",
  ]) {
    assert.strictEqual(greetingReply(asked, "english"), null, asked);
  }
});

test("an answer that is mostly the prompt read back is caught", () => {

  // The screenshot: the instructions returned verbatim as the answer.
  assert.ok(leaksPrompt(SYSTEM, [SYSTEM]));
  // And the first few paragraphs of them, which is what actually appeared in the panel.
  assert.ok(leaksPrompt(SYSTEM.split("\n").slice(0, 12).join("\n"), [SYSTEM]));
});

test("a real answer is never mistaken for a leak", () => {
  /*
   * The regression this guard caused. Asked "she said she is not interested, how do I convince
   * her", the panel replied "I could not answer that one - try asking it a different way" - the
   * threshold was ten words at half the answer, and a good answer repeats the studio's own
   * vocabulary often enough to trip it.
   */
  for (const answer of [
    "You can follow up with a personalized message highlighting her previous positive experience. "
      + "Offer a competitive package with a discounted rate or a special incentive. Emphasize the "
      + "value of her time and the quality of your work.",
    "She is a Dum Dum lead, so keep it to wedding day coverage, engagement and reception shoots, "
      + "candid and traditional photography. Send a sample album and ask for a date.",
    "Call her between 4 and 6, when she is likely to be free, and lead with the album rather than "
      + "the price.",
  ]) {
    assert.ok(!leaksPrompt(answer, [SYSTEM]), answer.slice(0, 60));
  }
});

test("an answer that quotes one detail is left alone", () => {
  /*
   * The false positive that would matter: a good answer often repeats a date or a status from the
   * record, and rewriting those would be worse than the bug.
   */
  const prompt = "## Lead\nName: Priya\nStatus: Interested\nNext follow-up: 2023-09-15\nVertical: Dum Dum";
  const answer = "Her next follow-up is set for 2023-09-15, which is long past - call her today and "
    + "agree a new date before anything else.";
  assert.ok(!leaksPrompt(answer, [prompt]));

  // Too short to judge, so never judged.
  assert.ok(!leaksPrompt("Interested", [prompt]));
});


test("a Language: label is never left on the end of an answer", () => {
  /*
   * What reached the panel: an answer, a blank line, then "Language: English". The first version of
   * this stripper only caught a bare trailing word, so the labelled form went straight through.
   */

  assert.strictEqual(
    stripLanguageLabel("You should call him within 48 hours.\n\nLanguage: English"),
    "You should call him within 48 hours.",
  );
  assert.strictEqual(
    stripLanguageLabel("Send her the wedding package.\n\nLanguage: English"),
    "Send her the wedding package.",
  );
  // Signed twice, which a model will do.
  assert.strictEqual(
    stripLanguageLabel("Call him today.\n\nLanguage: English\nEnglish"),
    "Call him today.",
  );
});

test("the language's own name is never left signed at the end", () => {
  /*
   * Answers kept coming back ending in a bare "Tanglish" or "English." - the model acknowledging
   * the order it was given. Rewording the instruction fixed it once and it returned the moment the
   * instruction grew, so it is removed rather than negotiated with.
   */

  assert.strictEqual(stripLanguageLabel("Send her the wedding package. English"), "Send her the wedding package.");
  assert.strictEqual(stripLanguageLabel("Call her at four. English."), "Call her at four.");

  // A closing quote must survive: answers often end with a wording to send.
  assert.strictEqual(
    stripLanguageLabel('"Hi, could you send the package?" English'),
    '"Hi, could you send the package?"',
  );

  // And a real answer is untouched, including one that happens to mention a language.
  assert.strictEqual(stripLanguageLabel("Send it in English so she reads it easily"),
    "Send it in English so she reads it easily");
  assert.strictEqual(stripLanguageLabel("Call her at four"), "Call her at four");
});

test("no quotable sample answer survives in the system prompt", () => {
  /*
   * Three separate times a helpful example became the answer: a Tanglish sample recited at five
   * different questions, "call her between 4 and 6" returned twice verbatim, and "wait three days"
   * opening four answers out of five. The rule is that this prompt shows no phrase worth copying.
   */
  for (const sample of [/wait three days/i, /between 4 and 6/i, /call her between/i]) {
    assert.ok(!sample.test(SYSTEM), `a copyable sample is back in the prompt: ${sample}`);
  }
});

test("advice repeated back as a quote is dropped, a real wording is kept", () => {
  /*
   * Answers arrived as a paragraph of advice followed by "You can say:" and the same paragraph
   * again in quotation marks - one reached the panel with 260 characters said twice. Telling the
   * prompt to give a wording instead of describing one reduced it and did not stop it.
   */

  const duplicate = "You should reach out to the lead with a personalized message about their "
    + "wedding day coverage. Offer to discuss their specific needs.\n\nYou can say: \"Next, I "
    + "recommend reaching out to the lead with a personalized message about their wedding day "
    + "coverage. Offer to discuss their specific needs.\"";
  assert.ok(!/you can say/i.test(dropDuplicatedWording(duplicate)), "the echo should go");
  assert.match(dropDuplicatedWording(duplicate), /Offer to discuss their specific needs\.$/);

  // A real line for the client says something the advice did not, and must survive.
  const useful = "Call her this evening, she has not replied in six days.\n\nYou can say: "
    + "\"Hi Priya, is the November date still on? Happy to send a sample album.\"";
  assert.strictEqual(dropDuplicatedWording(useful), useful);

  // Nothing to do is not an error.
  assert.strictEqual(dropDuplicatedWording("Call her at four."), "Call her at four.");
  assert.strictEqual(dropDuplicatedWording(""), "");
});

test("an answer that starts repeating itself is cut where it starts", () => {
  /*
   * What reached the panel: one line of reasoning, then "The language used is English." thirty
   * times over. The prompt that provoked that particular loop is gone, but looping is what a small
   * model does when it runs out of things to say, and it will find another subject to circle.
   */

  const looped = "I am doing this because the lead belongs to Dum Dum. "
    + "The language used is English. ".repeat(30);
  const trimmed = trimRepetition(looped);
  assert.ok(trimmed.length < 120, `still ${trimmed.length} chars`);
  assert.strictEqual((trimmed.match(/The language used is English/g) || []).length, 1);

  // A real answer never repeats a sentence word for word, so it is untouched.
  const good = "Call her this evening. She has not replied in six days. Send a sample album first.";
  assert.strictEqual(trimRepetition(good), good);

  // Short fragments repeat innocently and must not truncate an answer.
  const shortRepeats = "Yes. Call her today. Yes. That is the next step to take right now.";
  assert.strictEqual(trimRepetition(shortRepeats), shortRepeats);

  assert.strictEqual(trimRepetition(""), "");
});

test("the prompt states English only, and names no other language", () => {
  /*
   * This once asserted the opposite - that the prompt mentioned no language at all - because two
   * lines telling the model never to name the language had produced thirty repetitions of "The
   * language used is English."
   *
   * It has to say something now, and the reason is a worse failure. The prompt described the studio
   * as being in Tamil Nadu, and asked "what languages do you know" the model read that as a
   * statement about itself and replied "I know Tamil and English". The state name is gone and the
   * rule is stated positively - what it *does* speak, rather than a list of what it does not.
   */
  assert.match(SYSTEM, /English only/i, "the prompt should say it works in English only");
  assert.ok(!/Tamil Nadu/i.test(SYSTEM), "naming the state made it claim to speak Tamil");
});

test("the prompt confines Nebula to the CRM and the studio's work", () => {
  assert.match(SYSTEM, /outside the CRM/);
  assert.match(SYSTEM, /general knowledge/);
});

/*
 * What Nebula will not answer.
 *
 * Asked what Salem is famous for it produced a paragraph of tourism; asked who the Prime Minister
 * is it named him. The system prompt was told to refuse both and refused neither - it held only for
 * a coding request. So the decision is made in code, generously: refusing a real question is worse
 * than answering a stray one, so only a question that mentions neither the studio's work nor a
 * person the CRM knows about is turned away.
 */

test("questions with nothing to do with the CRM are refused", () => {
  for (const asked of [
    "salem is famous for what",
    "who is the prime minister of india",
    "write me a python function to sort a list",
    "what is the capital of france",
    "tell me a joke",
  ]) {
    assert.ok(isOutOfScope(asked), asked);
  }
});

test("the studio's own questions are never refused", () => {
  for (const asked of [
    "what should I do next with this lead?",
    "how long does a wedding shoot usually take?",
    "when should I call her?",
    "she said no, how do I convince her",
    "draft a follow-up message",
    "how many projects are today?",
    "how many meetings are today?",
    "indha lead ku enna panalam?",
    "client budget sollala enna pannalam",
    // No domain word at all, but plainly about the client.
    "what did they decide in the end",
  ]) {
    assert.ok(!isOutOfScope(asked), asked);
  }
});

test("studio-wide project and meeting counts are handed off instead of being invented", () => {
  assert.match(studioScopeReply("How many projects are today?"), /calendar or the CRM summary/i);
  assert.match(studioScopeReply("How many meetings are today?"), /calendar or the CRM summary/i);
  assert.strictEqual(studioScopeReply("what should I say to her"), null);
});

test("CRM context labels today's calendar counts explicitly", () => {
  const rendered = renderCrmContext({
    today: "2026-09-04",
    scopedTo: ["Dum Dum"],
    leads: { total: 0, deleted: 0 },
    intake: { today: 0, last7Days: 0, last30Days: 0 },
    statuses: { known: [], notSet: 0, unrecognised: { leads: 0, distinctValues: 0 } },
    byVertical: [], bySource: [], byOwner: [], byEvent: [],
    followUps: { total: 0, overdue: 0, dueToday: 0, byOwner: [], oldest: [] },
    conversions: { projects: 0, last30Days: 0, formatted: {} },
    engagement: { callLogs: null, transcripts: null, whatsappThreads: null },
    schedule: { meetings: 0, projects: 0 },
  });
  assert.match(rendered, /Meetings today: 0/);
  assert.match(rendered, /Projects today: 0/);
});

test("a refusal says what it can help with instead", () => {
  // A bare "no" reads as a fault in the app rather than a boundary.
  assert.match(outOfScopeReply("english"), /outside the CRM/i);
  assert.match(outOfScopeReply("english"), /Ask me about/i);
});

test("a greeting or a very short message is not judged for scope", () => {
  // Handled by the greeting rule, and too short to read either way.
  for (const asked of ["hi", "ok", "thanks", ""]) assert.ok(!isOutOfScope(asked), JSON.stringify(asked));
});

test("module greetings are fast and use the correct subject", () => {
  assert.match(moduleGreetingReply("hello", "HRM"), /employees|team/i);
  assert.match(moduleGreetingReply("hi", "ASSET"), /equipment/i);
  assert.strictEqual(moduleGreetingReply("hello, how many assets do we have?", "ASSET"), null);
});

test("a question in a script Nebula does not read is refused in English", () => {
  const { isUnreadableScript, unreadableScriptReply } = require("../src/services/ai/scope");
  /*
   * Nebula works in English. Asked in Tamil script it did not fail cleanly - it answered "The lead
   * for today is 12", a figure it had invented, because it had not understood the question and
   * produced something anyway. A wrong number stated plainly is worse than a refusal.
   */
  for (const asked of ["எத்தனை leads இருக்கு", "आज कितने लीड", "今日のリード数"]) {
    assert.ok(isUnreadableScript(asked), asked);
  }
  assert.match(unreadableScriptReply(), /English/);
});

test("English, and Tamil written in English letters, are not refused", () => {
  const { isUnreadableScript } = require("../src/services/ai/scope");
  /*
   * The honest limit of the script check. Romanised Tamil cannot be told from English without a
   * language detector, and this system deliberately no longer carries one - so it reaches the model
   * and gets an English answer, which is what was asked for.
   */
  for (const asked of ["how many leads do we have", "enna panalam indha lead ku", "details about shivani"]) {
    assert.ok(!isUnreadableScript(asked), asked);
  }
});
