/**
 * How hard a CRM is working their WhatsApp, and whether it looks like the pattern that gets a
 * number banned.
 *
 * The paired number is a real phone belonging to the studio, linked through an unofficial
 * client. WhatsApp does not publish what trips its automation detection, but the shape it
 * reacts to is well known and is not "many messages" on its own: it is many messages to many
 * different people in a short time, which is what a broadcast looks like from the outside. A
 * CRM deep in one conversation with one client is the opposite of that and must not be nagged
 * for it, so the reach of the messaging is counted separately from the volume.
 *
 * Nothing here blocks a send. A CRM mid-conversation with a client cannot be cut off in the
 * middle of it by a counter - the studio would rather answer the client and carry the risk for
 * a few more messages. So this reports, the CRM is asked to stop, and an administrator who
 * disagrees can end the session from User Settings.
 */

/*
 * ── Where a limit comes from ──────────────────────────────────────────────────────────────────
 *
 * Three answers, in order, and the first one that is a usable number wins:
 *
 *   1. What the studio saved in Settings → User Settings → WhatsApp. This is the one that is meant
 *      to be used: a studio whose CRMs genuinely work at 100 messages an hour should not have to
 *      redeploy, or ask a developer, to stop being told off for it hourly - and a warning people
 *      have learned to read past is the same as no warning at all.
 *   2. The environment, which is how this was configured before the screen existed. Kept working
 *      so a server already carrying the variables does not change behaviour on the deploy that
 *      adds the screen; a value saved on the screen overrules it from then on.
 *   3. These defaults, deliberately below anything that would be called bulk.
 *
 * Anything unusable at any level - blank, zero, negative, not a number - falls through to the next
 * answer rather than becoming the limit. A limit of zero would put every CRM permanently over.
 */
const DEFAULT_LIMITS = {
  // The one that matters most: how many different clients were written to in the hour.
  // Twenty conversations an hour is already fast for one person; forty is a list being
  // worked through, which is the pattern to catch before WhatsApp does.
  hourlyChats: 25,
  // One CRM, one hour. A busy hour of real conversation sits well inside this.
  hourlyMessages: 60,
  // Across the working day, which is what catches a steady drip that no single hour flags.
  dailyMessages: 300,
};

// In the order an administrator reads them on the settings screen: reach, then the hour, then
// the day. Exported so the screen and the validation are built from this list rather than from
// three hand-written copies of it that can drift apart.
const LIMIT_KEYS = ["hourlyChats", "hourlyMessages", "dailyMessages"];

const ENV_KEYS = {
  hourlyChats: "WHATSAPP_HOURLY_CHAT_LIMIT",
  hourlyMessages: "WHATSAPP_HOURLY_MESSAGE_LIMIT",
  dailyMessages: "WHATSAPP_DAILY_MESSAGE_LIMIT",
};

/*
 * The range a saved limit may sit in.
 *
 * The ceiling is not an opinion about how much WhatsApp will tolerate - nobody knows that. It is
 * there so a slipped keypress cannot silently retire the warning: 5000 messages an hour is a
 * message every three quarters of a second for an hour, which no person types, so a number above
 * it is a typo rather than a decision. A studio that really wants the warning gone can set the
 * ceiling and be told, in the field, that this is what they have done.
 */
const LIMIT_BOUNDS = { min: 1, max: 5000 };

/** A limit, or null if this is not one - which is what sends the lookup to the next answer. */
function positiveInt(value) {
  if (value === null || value === undefined || value === "") return null;
  const raw = Number(value);
  return Number.isFinite(raw) && raw >= LIMIT_BOUNDS.min ? Math.floor(raw) : null;
}

/**
 * The limits in force, given whatever the studio has saved.
 *
 * `stored` is the row from the settings table, with a null per limit nobody has set. Called with
 * nothing it answers the environment-or-defaults pair, which is what the tests and any caller
 * without a database handy want.
 */
function limits(stored = null) {
  const active = {};
  for (const key of LIMIT_KEYS) {
    active[key] = positiveInt(stored?.[key])
      ?? positiveInt(process.env[ENV_KEYS[key]])
      ?? DEFAULT_LIMITS[key];
  }
  return active;
}

/**
 * What the settings screen is allowed to save.
 *
 * Returns the limits to store and, separately, whatever was wrong - so the caller can refuse the
 * whole write and name the field rather than quietly storing two of three. A key left out, or sent
 * empty, is "use the default for this one" and is stored as null; that is how a studio undoes a
 * limit it set, which is otherwise impossible on a screen made of number boxes.
 */
function sanitizeLimits(input = {}) {
  const values = {};
  const problems = [];
  for (const key of LIMIT_KEYS) {
    const raw = input?.[key];
    if (raw === undefined || raw === null || raw === "") {
      values[key] = null;
      continue;
    }
    const number = Number(raw);
    if (!Number.isFinite(number) || !Number.isInteger(number) || number < LIMIT_BOUNDS.min || number > LIMIT_BOUNDS.max) {
      problems.push(key);
      continue;
    }
    values[key] = number;
  }
  return { values, problems };
}

// Warned at four fifths rather than at the limit, so there is room to finish a conversation
// and stop deliberately instead of being told off after the fact.
const WARNING_FRACTION = 0.8;

/**
 * Turns three counts into something the panel and User Settings can both show.
 *
 * `level` is the whole answer: "ok" says nothing, "warning" says slow down, "over" asks the CRM
 * to disconnect. `reasons` names each limit that was passed, in the CRM's own words, because
 * "you have sent too much" without saying which measure is useless for deciding what to change.
 *
 * `stored` is what the studio saved, passed in by the caller that read it. Passed rather than
 * read here so this stays a function of its arguments: it is called once per CRM when the users
 * list is drawn, and a database round trip per row to fetch the same one row would be absurd.
 */
function evaluateUsage(counts = {}, stored = null) {
  const hourlyMessages = Number(counts.hourlyMessages) || 0;
  const dailyMessages = Number(counts.dailyMessages) || 0;
  const hourlyChats = Number(counts.hourlyChats) || 0;
  const active = limits(stored);

  const measures = [
    {
      key: "hourlyChats",
      used: hourlyChats,
      limit: active.hourlyChats,
      over: `You have messaged ${hourlyChats} different clients in the last hour, past the ${active.hourlyChats} this studio allows.`,
      warning: `You have messaged ${hourlyChats} different clients in the last hour, close to the limit of ${active.hourlyChats}.`,
    },
    {
      key: "hourlyMessages",
      used: hourlyMessages,
      limit: active.hourlyMessages,
      over: `You have sent ${hourlyMessages} messages in the last hour, past the ${active.hourlyMessages} this studio allows.`,
      warning: `You have sent ${hourlyMessages} messages in the last hour, close to the limit of ${active.hourlyMessages}.`,
    },
    {
      key: "dailyMessages",
      used: dailyMessages,
      limit: active.dailyMessages,
      over: `You have sent ${dailyMessages} messages today, past the ${active.dailyMessages} this studio allows.`,
      warning: `You have sent ${dailyMessages} messages today, close to the limit of ${active.dailyMessages}.`,
    },
  ];

  const breached = measures.filter((measure) => measure.used >= measure.limit);
  const nearing = measures.filter((measure) => measure.used < measure.limit && measure.used >= Math.ceil(measure.limit * WARNING_FRACTION));

  // Reach first, then volume: a CRM over both is told about the clients before the messages,
  // because that is the number that decides whether this looks like a broadcast.
  const level = breached.length ? "over" : nearing.length ? "warning" : "ok";
  const reasons = breached.length
    ? breached.map((measure) => measure.over)
    : nearing.map((measure) => measure.warning);

  return {
    level,
    reasons,
    counts: { hourlyMessages, dailyMessages, hourlyChats },
    limits: active,
    // The measure that is furthest along, which is what a one-line summary in a table shows.
    worst: measures.reduce((highest, measure) => (
      measure.used / measure.limit > highest.used / highest.limit ? measure : highest
    ), measures[0]),
  };
}

module.exports = {
  evaluateUsage,
  limits,
  sanitizeLimits,
  DEFAULT_LIMITS,
  LIMIT_KEYS,
  LIMIT_BOUNDS,
  WARNING_FRACTION,
};
