const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");

/*
 * The assistant answers, rather than throwing on the way out.
 *
 * ── Why this test exists ──
 *
 * `crmAssistant.js` used to detect the question's language, answer in it, and report which one it
 * had used. That layer was removed - it cost a 3.3GB second model for a language nobody asked it to
 * use - but four references to a `language` variable were left behind in the two functions that
 * return an answer. Nothing declared it any more, so every reply that got as far as its own `return`
 * threw `ReferenceError: language is not defined`, and the panel showed that in red where the
 * answer should have been.
 *
 * Nothing caught it. The other AI tests read source or exercise pure helpers; these two functions
 * were only ever run against a real database and a real model, which is to say only by a person
 * clicking. So this calls them for real, with the database and the model stubbed, which is enough:
 * an undeclared identifier throws when the line runs, whatever the line was going to return.
 *
 * The greeting path is what makes that cheap. "hii" is answered from a scripted reply and never
 * reaches the model - so this needs no Ollama, no MySQL, and still executes both functions end to
 * end including the `return` that was broken.
 */

const AI = path.join(__dirname, "..", "src", "services", "ai");

/**
 * Loads `crmAssistant` with its two round-trips stubbed.
 *
 * Through the module cache rather than a mocking library: the assistant reaches for the lead's
 * context and the meeting extractor at the top of both functions, and both of those talk to MySQL.
 * Seeding the cache before it is required is the whole of what is needed and leaves the assistant
 * itself completely untouched - which is the point, since it is the thing under test.
 */
function loadAssistant({ context = {}, meeting = null } = {}) {
  /*
   * Whatever was in the cache before, so it can be put back exactly.
   *
   * `delete` is not enough and the difference matters: these files run in one process alongside
   * every other test, and a module this one had *already* loaded must be handed back the same
   * object afterwards, not a fresh copy of it. Deleting the entry leaves the next `require` to
   * build a second instance, which is how a stub here turned into a failure two files away.
   */
  const previous = new Map();
  const stub = (relative, exports) => {
    const filename = require.resolve(path.join(AI, relative));
    previous.set(filename, require.cache[filename]);
    const stubbed = new Module(filename);
    stubbed.filename = filename;
    stubbed.loaded = true;
    stubbed.exports = exports;
    require.cache[filename] = stubbed;
  };

  const real = require.resolve(path.join(AI, "crmAssistant.js"));
  previous.set(real, require.cache[real]);
  delete require.cache[real];

  stub("leadContext.js", {
    buildLeadContext: async () => ({ counts: { calls: 0, remarks: 0 }, lead: { name: "Test Lead" }, ...context }),
    // The prompt builder renders the context into the prompt; a greeting never reaches the model,
    // but the prompt is still assembled before the scripted reply is chosen.
    renderLeadContext: () => "Lead: Test Lead",
  });
  stub("meetingIntent.js", { proposeMeeting: async () => meeting });

  try {
    return require(real);
  } finally {
    for (const [filename, entry] of previous) {
      if (entry) require.cache[filename] = entry;
      else delete require.cache[filename];
    }
  }
}

test("a greeting is answered rather than thrown on", async () => {
  /*
   * The exact failure this test was written for. `askAboutLead` reached its scripted return, which
   * named a variable that no longer existed, and threw - so the panel showed "language is not
   * defined" in red instead of "Hello."
   */
  const { askAboutLead } = loadAssistant();
  const reply = await askAboutLead({ enquiryId: "DBS-EID-DD-ERD-000001", question: "hii" });
  assert.equal(typeof reply.answer, "string");
  assert.ok(reply.answer.trim().length, "a greeting must be answered with something");
  assert.equal(reply.corrected, false);
});

test("the streamed path answers, and hands the panel the same text it streamed", async () => {
  const { streamAboutLead } = loadAssistant();
  const streamed = [];
  const reply = await streamAboutLead(
    { enquiryId: "DBS-EID-DD-ERD-000001", question: "hii" },
    (piece) => streamed.push(piece),
  );
  assert.equal(reply.answer, streamed.join(""), "what was streamed and what is returned must agree");
  assert.equal(reply.corrected, false);
});

test("a reply carries what the answer was based on, so the panel can say so", async () => {
  const { askAboutLead } = loadAssistant({ context: { counts: { calls: 3, remarks: 2 } } });
  const reply = await askAboutLead({ enquiryId: "DBS-EID-DD-ERD-000001", question: "hii" });
  assert.deepEqual(reply.basedOn, { calls: 3, remarks: 2 });
});

test("a meeting the question asked for is passed back for confirmation", async () => {
  // The assistant never books anything - a calendar invite emails a real client and cannot be
  // recalled - so a proposed meeting travels back with the reply for a person to confirm.
  const proposed = { title: "Call with Test Lead", startAt: "2026-09-10T10:00:00.000Z" };
  const { askAboutLead } = loadAssistant({ meeting: proposed });
  const reply = await askAboutLead({ enquiryId: "DBS-EID-DD-ERD-000001", question: "hii" });
  assert.deepEqual(reply.meeting, proposed);
});

test("an empty question is refused before anything is loaded", async () => {
  const { askAboutLead, streamAboutLead } = loadAssistant();
  await assert.rejects(() => askAboutLead({ enquiryId: "DBS-EID-DD-ERD-000001", question: "   " }), /Ask a question first/);
  await assert.rejects(() => streamAboutLead({ enquiryId: "DBS-EID-DD-ERD-000001", question: "" }), /Ask a question first/);
});

test("no reply reports a language, because the assistant no longer has one", () => {
  /*
   * The layer was removed on purpose: it cost a second 3.3GB model for a language nobody asked it
   * to use. What is checked here is that the *shape* went with it - a `language` key on the reply
   * is the thing whose four dangling references caused the fault, and the stream handler reporting
   * one is what kept them looking deliberate.
   */
  const fs = require("node:fs");
  const assistant = fs.readFileSync(path.join(AI, "crmAssistant.js"), "utf8");
  const controller = fs.readFileSync(
    path.join(__dirname, "..", "src", "modules", "sales", "crm-ai", "controller.js"),
    "utf8",
  );
  for (const [label, source] of [["crmAssistant.js", assistant], ["the AI controller", controller]]) {
    // The word still appears in prose - the prompt tells the model to write English - so this looks
    // for it being read or returned as a value, which is what threw.
    assert.doesNotMatch(source, /[{,]\s*language\s*[,}]/, `${label} still passes a language through a reply`);
  }
});
