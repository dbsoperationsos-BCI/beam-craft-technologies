const prisma = require("../../../config/db");

/**
 * How long somebody has actually been using the application, measured rather than guessed.
 *
 * The usage reports used to infer time on task from the gaps between recorded lead actions: a
 * person who saved a lead, spent twelve minutes in their email and saved another was credited with
 * thirteen minutes of work here. That is a reasonable estimate of "time between two things they
 * did"; it is not an answer to "how long were they using this", which is what the studio asks.
 *
 * So the browser reports instead. It beats while the tab is **visible** and the person has
 * **interacted recently** - a pointer that moved, a key, a click, a scroll - and stops beating the
 * moment either stops being true. Nothing is recorded while the application sits behind another
 * window, and nothing is recorded by a tab left open on an empty desk.
 *
 * ── Why stretches rather than beats ───────────────────────────────────────────────────────────
 *
 * A row per beat would be a row every half minute per person, for nothing: the question is only
 * ever "how long", and beats are indistinguishable once counted. Each beat extends the stretch it
 * belongs to instead, so a morning's work is one row that grows. A beat arriving after too long a
 * silence cannot be a continuation of anything, so it opens a new stretch - which is also what
 * makes the count honest across a closed laptop, a crashed tab or a lost connection: whatever was
 * open simply stops being extended and ends where the last beat left it.
 */

/*
 * How often the browser beats, and how long a stretch may be extended by one beat.
 *
 * The tolerance is deliberately more than one beat: a slow request, a moment of paused JavaScript
 * or a garbage-collection pause must not chop one sitting into two. Less than two beats and every
 * hiccup starts a new stretch; much more and a genuine break is absorbed into the stretch before it,
 * which is the very thing this replaces.
 */
const HEARTBEAT_SECONDS = 30;
const CONTINUES_WITHIN_SECONDS = HEARTBEAT_SECONDS * 3;

// What the beat may say it is about. A closed set, because it is written into a column the reports
// group by - an unknown context would quietly create a category nothing reads.
const CONTEXTS = ["app", "whatsapp"];

const isContext = (value) => CONTEXTS.includes(String(value || ""));

/**
 * Records one beat.
 *
 * Returns the stretch it landed in, which is what lets a caller see whether it extended one or
 * began another.
 *
 * `at` is the server's own clock, never the browser's. A client that can name the time can name any
 * time, and a usage figure anybody can inflate from the console is not a measurement.
 */
async function recordHeartbeat({ userId, context = "app", at = new Date() } = {}) {
  if (!Number.isInteger(userId) || userId <= 0) throw Object.assign(new Error("A signed-in user is required."), { status: 400 });
  const kind = isContext(context) ? context : "app";

  const openSince = new Date(at.getTime() - CONTINUES_WITHIN_SECONDS * 1000);
  const open = await prisma.appUsageSession.findFirst({
    where: { userId, context: kind, endedAt: { gte: openSince } },
    orderBy: { endedAt: "desc" },
  });

  if (open) {
    /*
     * Extended, not replaced.
     *
     * `endedAt` only ever moves forward: two tabs of the same application beat against the same
     * stretch, and the later beat is the one that says how long it has been going. Taking the
     * maximum rather than the incoming value means a beat that arrives out of order - a retried
     * request, a queued beacon - cannot shorten a stretch that has already run past it.
     */
    if (open.endedAt >= at) return open;
    return prisma.appUsageSession.update({ where: { id: open.id }, data: { endedAt: at } });
  }

  /*
   * A new stretch, starting one beat before the beat that opened it.
   *
   * Otherwise the first beat of every sitting is worth nothing: a stretch would run from its first
   * beat to its last, so somebody who used the application for twenty seconds and left would read
   * as zero. The beat is evidence of the interval behind it, not of an instant.
   */
  const startedAt = new Date(at.getTime() - HEARTBEAT_SECONDS * 1000);
  return prisma.appUsageSession.create({ data: { userId, context: kind, startedAt, endedAt: at } });
}

module.exports = { recordHeartbeat, HEARTBEAT_SECONDS, CONTINUES_WITHIN_SECONDS, CONTEXTS, isContext };
