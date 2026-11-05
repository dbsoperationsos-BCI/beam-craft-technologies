/**
 * Where an application came from: the list Settings → Fields → Interview → Sources maintains.
 *
 * These were an array in `hrm/interview/candidates.js` and a second copy of the same array in
 * `frontend/src/constants/interviewConfig.js`, which is two faults rather than one: a studio that
 * started advertising somewhere new could not say so, and the two copies could disagree about what
 * the picker offered. They are rows now, and this is where their starting values live.
 *
 * ── The order is the answer ──
 *
 * `sortOrder` rather than alphabetical: the boards and ad platforms the studio actually spends on
 * come first, the ways somebody arrives without being advertised to follow, and **Other** belongs
 * last wherever the list ends up. Sorting the words would put Campus above LinkedIn and Other in
 * the middle.
 *
 * ── Two sources are not in this list, deliberately ──
 *
 * "Application Form" and "Google sheet integration" are what the public form and the sheet importer
 * *stamp* on a candidate, and what the code compares against. They stay named in `candidates.js`:
 * a studio renaming a row here must not change what an importer writes, and nobody taking down an
 * application by hand would reach for either.
 *
 * ── Seeded twice, on purpose ──
 *
 * `prisma/seed.js` runs this on a developer's machine, and
 * `migrations/20260918160000_interview_source_list` writes the same rows for every database -
 * because the seed **cannot be run on the VPS** (CLAUDE.md). Keep the two in step; the migration
 * names this file as the one to follow.
 *
 * Each row is upserted by its code, so re-running renames nothing the studio has edited into a
 * different spelling and adds only what is missing.
 */

/** `[code, name, sortOrder]`. The code is the machine key; nobody maintaining the list sees it. */
const interviewSources = [
  ["NAUKRI", "Naukri", 10],
  ["LINKEDIN", "LinkedIn", 20],
  ["INDEED", "Indeed", 30],
  // The studio advertises here, which is what this list was missing and the reason it stopped being
  // an array. Beside Google Ads' own spelling in `referral_source`, so the two read alike.
  ["META_ADS", "Meta Ads", 40],
  ["GOOGLE_ADS", "Google Ads", 50],
  ["SOCIAL_MEDIA", "Social Media", 60],
  ["WEBSITE", "Website", 70],
  ["CAMPUS", "Campus", 80],
  ["REFERRAL", "Referral", 90],
  ["WALK_IN", "Walk-in", 100],
  ["OTHER", "Other", 110],
];

async function seedInterviewSources(prisma) {
  for (const [code, name, sortOrder] of interviewSources) {
    await prisma.interviewSource.upsert({
      where: { code },
      // `isActive` is restored but the name is left alone: a studio that renamed a row has said what
      // it calls that source, and a reseed must not talk it back.
      update: { sortOrder, isActive: true },
      create: { code, name, sortOrder },
    });
  }
}

module.exports = { interviewSources, seedInterviewSources };
