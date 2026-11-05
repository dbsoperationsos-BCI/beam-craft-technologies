#!/usr/bin/env node
/* eslint-disable no-console */
const prisma = require("../src/config/db");
const { ensureProjectClientStorage } = require("../src/modules/assets/client-storage.service");

/*
 * ── The storage records for the projects that started before there were any ────────────────────
 *
 * A project answering "Storage Needed = Yes" gets one `client_storage` record, and the only thing
 * that raises it is saving the project: `ensureProjectClientStorage` is called from Start Project
 * and from adding a shoot, and from nowhere else. There is no read-time creation and there was no
 * backfill - so every project that had already started when the feature shipped has no record and
 * never gets one, however many discs are actually sitting on a shelf for it. Client Storage
 * Management then reads as an empty table on a studio with plenty of projects, which is what it was
 * reported as.
 *
 * This writes those missing records, once, through the same function the live path uses - so a
 * backfilled record is indistinguishable from one raised by a save: the same `DBS-STOMGMT-` run of
 * numbers, and the same earliest-shoot attachment.
 *
 *   node scripts/backfillClientStorage.js            # report what is missing, write nothing
 *   node scripts/backfillClientStorage.js --apply    # do it
 *   node scripts/backfillClientStorage.js --apply --user=12   # and stamp it as raised by that login
 *
 * Safe to run twice. `ensureProjectClientStorage` returns a project's existing record untouched,
 * and that includes one an employee has since removed with a reason - a deliberate removal is never
 * undone by this.
 *
 * The dry run also says *why* a project is not eligible, because an empty table has two causes and
 * only one of them is this: a project still "Yet to Start" or answering Storage Needed = No is
 * correctly absent, and no backfill should change that.
 */

const APPLY = process.argv.includes("--apply");
const USER = Number((process.argv.find((arg) => arg.startsWith("--user=")) || "").split("=")[1]) || null;

// The two answers `ensureProjectClientStorage` gates on, asked here so the report can name the
// projects it is skipping rather than leaving a bare count.
const RAISES_STORAGE = { deletedAt: null, storageNeeded: "Yes", projectStatus: { not: "Yet to Start" } };

async function main() {
  console.log(APPLY ? "Raising the missing client storage records.\n" : "Dry run - nothing will be written. Pass --apply to do it.\n");

  const [total, wantsStorage, notStarted, eligible] = await Promise.all([
    prisma.salesProject.count({ where: { deletedAt: null } }),
    prisma.salesProject.count({ where: { deletedAt: null, storageNeeded: "Yes" } }),
    prisma.salesProject.count({ where: { deletedAt: null, storageNeeded: "Yes", projectStatus: "Yet to Start" } }),
    prisma.salesProject.findMany({
      where: RAISES_STORAGE,
      select: { id: true, eventId: true, projectStatus: true, clientStorageRecords: { select: { id: true }, take: 1 } },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  console.log(`${total} live project(s); ${wantsStorage} answer Storage Needed = Yes.`);
  if (notStarted) console.log(`  ${notStarted} of those are still "Yet to Start", which raise nothing until they are started.`);

  const missing = eligible.filter((project) => !project.clientStorageRecords.length);
  console.log(`  ${eligible.length} are started and want storage; ${eligible.length - missing.length} already have a record.\n`);

  if (!missing.length) {
    console.log("Every project that should have a client storage record has one.");
    if (!wantsStorage) console.log("Note: no project answers Storage Needed = Yes, so an empty Client Storage table is correct.");
    return;
  }

  console.log(`${missing.length} project(s) missing a record:`);
  for (const project of missing.slice(0, 20)) console.log(`    ${project.eventId || project.id}  (${project.projectStatus})`);
  if (missing.length > 20) console.log(`    ... and ${missing.length - 20} more`);

  if (!APPLY) {
    console.log("\nNothing written. Run again with --apply to raise them.");
    return;
  }

  /*
   * One at a time rather than in a transaction over all of them. Each record takes the next
   * identifier, so a single long transaction would hold that counter for the length of the run;
   * and a backfill that fails halfway should keep what it has written, since running it again
   * simply resumes.
   */
  let written = 0;
  for (const project of missing) {
    try {
      const record = await ensureProjectClientStorage(prisma, project.id, { userId: USER });
      if (record) written += 1;
    } catch (error) {
      console.error(`  ${project.eventId || project.id}: ${error?.message || error}`);
    }
  }
  console.log(`\nRaised ${written} record(s).`);
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
