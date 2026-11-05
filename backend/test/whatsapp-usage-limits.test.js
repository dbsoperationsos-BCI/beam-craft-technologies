const test = require("node:test");
const assert = require("node:assert/strict");

/*
 * The limits that keep the studio's WhatsApp number off WhatsApp's radar.
 *
 * The number is a real phone linked through an unofficial client, and the pattern that gets one
 * banned is not volume on its own - it is reach: many different people written to in a short
 * time, which from the outside is indistinguishable from a broadcast. So the reach limit has to
 * fire on a CRM working through a list even when their message count is unremarkable, and it
 * must stay quiet for a CRM deep in one conversation however much they type.
 *
 * A limit has three possible sources, and they are tried in this order: what the studio saved on
 * Settings -> User Settings -> WhatsApp, then the environment, then the code's own defaults. The
 * saved values are passed in by the caller that read them, so most of these tests hand them in
 * directly; the environment ones are read at call time, so each test states the ones it means.
 */

const ENV_KEYS = ["WHATSAPP_HOURLY_MESSAGE_LIMIT", "WHATSAPP_DAILY_MESSAGE_LIMIT", "WHATSAPP_HOURLY_CHAT_LIMIT"];

function withLimits(values, run) {
  const saved = ENV_KEYS.map((key) => [key, process.env[key]]);
  Object.assign(process.env, values);
  try {
    return run();
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

// Required after the helper so the module is loaded once; it reads env per call, not on import.
const { evaluateUsage, limits, sanitizeLimits, DEFAULT_LIMITS, LIMIT_BOUNDS } = require("../src/modules/sales/whatsapp-chat/usage");

test("a quiet CRM is told nothing", () => {
  withLimits({ WHATSAPP_HOURLY_MESSAGE_LIMIT: "60", WHATSAPP_DAILY_MESSAGE_LIMIT: "300", WHATSAPP_HOURLY_CHAT_LIMIT: "25" }, () => {
    const usage = evaluateUsage({ hourlyMessages: 12, dailyMessages: 40, hourlyChats: 5 });
    assert.equal(usage.level, "ok");
    assert.deepEqual(usage.reasons, []);
  });
});

test("one long conversation never trips the reach limit", () => {
  // The case the reach limit must not punish: a great many messages, all to one client.
  withLimits({ WHATSAPP_HOURLY_MESSAGE_LIMIT: "60", WHATSAPP_DAILY_MESSAGE_LIMIT: "300", WHATSAPP_HOURLY_CHAT_LIMIT: "25" }, () => {
    const usage = evaluateUsage({ hourlyMessages: 40, dailyMessages: 90, hourlyChats: 1 });
    assert.equal(usage.level, "ok");
  });
});

test("working through a list trips the reach limit on its own", () => {
  // Few messages each, but to many people - the shape that reads as a broadcast. The message
  // counts here are well inside their limits, so only reach can be what fires.
  withLimits({ WHATSAPP_HOURLY_MESSAGE_LIMIT: "60", WHATSAPP_DAILY_MESSAGE_LIMIT: "300", WHATSAPP_HOURLY_CHAT_LIMIT: "25" }, () => {
    const usage = evaluateUsage({ hourlyMessages: 30, dailyMessages: 100, hourlyChats: 30 });
    assert.equal(usage.level, "over");
    assert.match(usage.reasons[0], /30 different clients/);
  });
});

test("the warning comes before the limit, not after it", () => {
  withLimits({ WHATSAPP_HOURLY_MESSAGE_LIMIT: "60", WHATSAPP_DAILY_MESSAGE_LIMIT: "300", WHATSAPP_HOURLY_CHAT_LIMIT: "25" }, () => {
    // 20 of 25 is the four-fifths mark: warned, with room left to finish and stop deliberately.
    const nearing = evaluateUsage({ hourlyMessages: 10, dailyMessages: 50, hourlyChats: 20 });
    assert.equal(nearing.level, "warning");
    assert.match(nearing.reasons[0], /close to the limit/);

    const justBelow = evaluateUsage({ hourlyMessages: 10, dailyMessages: 50, hourlyChats: 19 });
    assert.equal(justBelow.level, "ok");
  });
});

test("the limit itself counts as over, not as still within", () => {
  withLimits({ WHATSAPP_HOURLY_MESSAGE_LIMIT: "60", WHATSAPP_DAILY_MESSAGE_LIMIT: "300", WHATSAPP_HOURLY_CHAT_LIMIT: "25" }, () => {
    assert.equal(evaluateUsage({ hourlyChats: 25 }).level, "over");
    assert.equal(evaluateUsage({ hourlyMessages: 60 }).level, "over");
    assert.equal(evaluateUsage({ dailyMessages: 300 }).level, "over");
  });
});

test("reach is named first when more than one limit is passed", () => {
  // An administrator reading one line needs the measure that decides whether this looks like a
  // broadcast, not whichever happened to be checked first.
  withLimits({ WHATSAPP_HOURLY_MESSAGE_LIMIT: "60", WHATSAPP_DAILY_MESSAGE_LIMIT: "300", WHATSAPP_HOURLY_CHAT_LIMIT: "25" }, () => {
    const usage = evaluateUsage({ hourlyMessages: 200, dailyMessages: 400, hourlyChats: 50 });
    assert.equal(usage.level, "over");
    assert.match(usage.reasons[0], /different clients/);
    assert.equal(usage.reasons.length, 3);
  });
});

test("a studio can set its own limits, and nonsense falls back to the defaults", () => {
  withLimits({ WHATSAPP_HOURLY_CHAT_LIMIT: "5" }, () => {
    assert.equal(limits().hourlyChats, 5);
    assert.equal(evaluateUsage({ hourlyChats: 6 }).level, "over");
  });
  for (const bad of ["0", "-4", "abc", ""]) {
    withLimits({ WHATSAPP_HOURLY_CHAT_LIMIT: bad }, () => {
      assert.equal(limits().hourlyChats, 25, `${bad || "an empty value"} must not become the limit`);
    });
  }
});

/*
 * ── What the studio saved, on the settings screen ─────────────────────────────────────────────
 *
 * The reason the screen exists: a studio whose CRMs genuinely work at a hundred messages an hour
 * should not have to redeploy, or ask a developer, to stop being told off for it - and a banner
 * people have learned to read past is the same as no banner when the pattern is finally real.
 */
test("a saved limit beats the environment, which beats the default", () => {
  withLimits({ WHATSAPP_HOURLY_MESSAGE_LIMIT: "90" }, () => {
    // Nothing saved: the environment answers.
    assert.equal(limits({ hourlyMessages: null }).hourlyMessages, 90);
    // Saved: the screen answers, and the environment is left where it is.
    assert.equal(limits({ hourlyMessages: 150 }).hourlyMessages, 150);
    // Saved for one measure only - the other two are still the environment's or the default's.
    const mixed = limits({ hourlyMessages: 150 });
    assert.equal(mixed.hourlyChats, DEFAULT_LIMITS.hourlyChats);
    assert.equal(mixed.dailyMessages, DEFAULT_LIMITS.dailyMessages);
  });
});

test("the warning is judged against what the studio saved", () => {
  const saved = { hourlyMessages: 150, dailyMessages: 600, hourlyChats: null };
  // 114 is what tripped the old limit of 60, and is inside a saved 150.
  assert.equal(evaluateUsage({ hourlyMessages: 114, dailyMessages: 200, hourlyChats: 8 }, saved).level, "ok");
  assert.equal(evaluateUsage({ hourlyMessages: 150, dailyMessages: 200, hourlyChats: 8 }, saved).level, "over");
  // Raising the message counts does not quietly raise the one that gets numbers banned.
  assert.equal(evaluateUsage({ hourlyMessages: 30, dailyMessages: 50, hourlyChats: 25 }, saved).level, "over");
});

/*
 * A null is "nobody has set this one", which is how a studio undoes a limit it chose. A column
 * defaulted to a number would look identical to a deliberate choice and there would be no way back.
 */
test("an empty box is stored as nothing, not as zero", () => {
  const { values, problems } = sanitizeLimits({ hourlyChats: "", hourlyMessages: 150, dailyMessages: undefined });
  assert.deepEqual(problems, []);
  assert.deepEqual(values, { hourlyChats: null, hourlyMessages: 150, dailyMessages: null });
  // And a limit handed back that way falls through to the app's own number.
  assert.equal(limits(values).hourlyChats, DEFAULT_LIMITS.hourlyChats);
});

test("a limit that is not a whole number in range is refused, and named", () => {
  for (const bad of [0, -1, 1.5, "abc", LIMIT_BOUNDS.max + 1]) {
    const { problems } = sanitizeLimits({ hourlyMessages: bad });
    assert.deepEqual(problems, ["hourlyMessages"], `${bad} must be refused`);
  }
  // The ceiling itself is allowed: it is the deliberate way to retire the warning, and somebody
  // who types it has said so in a field that told them what it was for.
  assert.deepEqual(sanitizeLimits({ hourlyMessages: LIMIT_BOUNDS.max }).problems, []);
  assert.deepEqual(sanitizeLimits({ hourlyMessages: LIMIT_BOUNDS.min }).problems, []);
  // Every bad field is named, so a form of three boxes does not become a hunt.
  assert.deepEqual(sanitizeLimits({ hourlyChats: 0, hourlyMessages: 150, dailyMessages: -2 }).problems, ["hourlyChats", "dailyMessages"]);
});

test("a CRM with nothing recorded reads as ok rather than as broken", () => {
  // What the users list hands in for somebody who has never sent a message.
  assert.equal(evaluateUsage(undefined).level, "ok");
  assert.equal(evaluateUsage({}).level, "ok");
  assert.deepEqual(evaluateUsage({}).counts, { hourlyMessages: 0, dailyMessages: 0, hourlyChats: 0 });
});
