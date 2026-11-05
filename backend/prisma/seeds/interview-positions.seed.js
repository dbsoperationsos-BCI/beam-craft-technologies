/**
 * Positions the Interview register offers beyond the studio's designation list.
 *
 * **Position Applied For reads the designations first**, and should: most applications are for a
 * role the studio actually has, and that list is already maintained in Settings. What it could not
 * offer was a position nobody is ever *employed* as - "General", which is what an application off a
 * hiring ad that names no role is for. Putting "General" in `designation` would have put it in
 * every employee's designation picker as well, and no employee's designation is General.
 *
 * So the module has a short list of its own, appended after the designations and merged by the
 * options endpoint. A studio that wants more - "Any Role", "Internship", a season's intake - adds
 * rows in Settings → Fields → Interview → Positions rather than waiting for a release, which is the
 * same reason Sources stopped being an array.
 *
 * ── Seeded twice, on purpose ──
 *
 * `prisma/seed.js` runs this on a developer's machine, and
 * `migrations/20260918180000_interview_position_list` writes the same rows for every database,
 * because the seed **cannot be run on the VPS** (CLAUDE.md). Keep the two in step.
 *
 * Each row is upserted by its code, so re-running adds only what is missing and renames nothing the
 * studio has edited.
 */

/** `[code, name, sortOrder]`. The code is the machine key; nobody maintaining the list sees it. */
const interviewPositions = [
  // Sorted after every designation the studio has, because it is the answer when none of them fit.
  ["GENERAL", "General", 10],
];

async function seedInterviewPositions(prisma) {
  for (const [code, name, sortOrder] of interviewPositions) {
    await prisma.interviewPosition.upsert({
      where: { code },
      // `isActive` is restored but the name is left alone: a studio that renamed a row has said what
      // it calls that position, and a reseed must not talk it back.
      update: { sortOrder, isActive: true },
      create: { code, name, sortOrder },
    });
  }
}

module.exports = { interviewPositions, seedInterviewPositions };
