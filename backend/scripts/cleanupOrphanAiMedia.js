#!/usr/bin/env node
/**
 * Retire the AI Feature media rows that a folder deletion left behind.
 *
 * Until folder deletion took a folder's photos with it, deleting a folder set every photo's
 * `folder_id` to null and left the rows live, so they stayed in All Photos with no folder to be
 * in. Those rows are orphans: live (`deleted_at IS NULL`), staff-uploaded (`uploaded_by_user_id`
 * IS NOT NULL - a guest's upload names no folder by design and is not an orphan, and a guest's
 * photo whose guest was since removed has no uploader at all, so it is never touched), and in no
 * folder.
 * All Photos no longer lists them; this script removes them the way a delete does, through the
 * media service's own discard (faces, people recounted, storage keys, the row), so nothing of
 * them is left in People, matches or the bucket.
 *
 *   node scripts/cleanupOrphanAiMedia.js              # dry run: counts per event, changes nothing
 *   node scripts/cleanupOrphanAiMedia.js --apply      # retires them
 *   node scripts/cleanupOrphanAiMedia.js --apply --event <eventId>   # one event only
 *
 * Runnable on its own with nothing else mounted on it; safe on production (it reads the live
 * schema through the same Prisma client the server uses and touches only the rows it lists).
 */
const path = require("node:path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const prisma = require("../src/config/db");
const service = require("../src/modules/ai-feature/media/service");

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const eventArg = args.indexOf("--event");
const onlyEvent = eventArg >= 0 ? args[eventArg + 1] : null;

/** Live, provably staff-uploaded, in no folder: what an old folder deletion left behind. */
const ORPHAN = { deletedAt: null, folderId: null, uploadedByUserId: { not: null } };
/**
 * Marked deleted but still here: a delete (single, or a folder's) whose discard failed part way -
 * a bucket hiccup, a process that died mid-loop. A fully discarded row no longer exists, so any
 * row with `deletedAt` set is one with cleanup to finish. Listed nowhere meanwhile.
 */
const LEFTOVER = { deletedAt: { not: null } };
const FACES = { faces: { select: { id: true, personId: true, thumbnailKey: true } } };

async function count(where, label) {
  const perEvent = await prisma.aiEventMedia.groupBy({ by: ["eventId"], where: { ...where, ...(onlyEvent ? { eventId: onlyEvent } : {}) }, _count: { _all: true } });
  const total = perEvent.reduce((sum, row) => sum + row._count._all, 0);
  if (total) {
    const names = await prisma.aiEvent.findMany({ where: { id: { in: perEvent.map((row) => row.eventId) } }, select: { id: true, name: true } });
    const nameOf = new Map(names.map((row) => [row.id, row.name]));
    console.log(`${total} ${label} row${total === 1 ? "" : "s"}:`);
    for (const row of perEvent) console.log(`  ${row._count._all.toString().padStart(6)}  ${nameOf.get(row.eventId) || "?"}  (${row.eventId})`);
  }
  return perEvent;
}

/** Discards each row of each event, one at a time; a failure is reported and the row stays marked for the next run. */
async function retire(perEvent, where, { mark }) {
  let done = 0; let failed = 0;
  for (const group of perEvent) {
    const rows = await prisma.aiEventMedia.findMany({ where: { ...where, eventId: group.eventId }, select: { id: true } });
    for (const { id } of rows) {
      // Marked first (only a live row; a leftover already is), then discarded exactly as a delete is.
      if (mark) await prisma.aiEventMedia.updateMany({ where: { id, deletedAt: null }, data: { deletedAt: new Date() } });
      const row = await prisma.aiEventMedia.findUnique({ where: { id }, include: FACES });
      if (!row) continue;
      try { await service.discardMedia(group.eventId, row); done += 1; }
      catch (error) { failed += 1; console.error(`  media ${id}: cleanup failed (row stays marked deleted): ${error.message}`); }
    }
  }
  return { done, failed };
}

async function main() {
  const orphans = await count(ORPHAN, "orphan media (live, staff-uploaded, in no folder)");
  const leftovers = await count(LEFTOVER, "leftover media (marked deleted, cleanup unfinished)");
  if (!orphans.length && !leftovers.length) { console.log("Nothing to retire: every live staff photo is in a folder and every deleted photo is fully cleaned up."); return; }
  if (!apply) { console.log("\nDry run. Re-run with --apply to retire them through the media service's discard."); return; }
  const a = await retire(orphans, ORPHAN, { mark: true });
  const b = await retire(leftovers, LEFTOVER, { mark: false });
  const failed = a.failed + b.failed;
  console.log(`\nRetired ${a.done} orphan and ${b.done} leftover media row${a.done + b.done === 1 ? "" : "s"}${failed ? `; ${failed} still marked deleted with cleanup to finish - run again once storage is reachable` : ""}.`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
