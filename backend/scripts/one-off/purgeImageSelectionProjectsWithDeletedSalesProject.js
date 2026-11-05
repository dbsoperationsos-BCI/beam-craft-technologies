/*
 * One-time cleanup: Image Selection projects whose Sales Manager project is already deleted.
 *
 * Deleting a booking only began taking its Image Selection project with it on 9 September 2026.
 * Every booking deleted before that left its project fully live - photos, folders, selections,
 * gallery row and R2 objects all standing, and the list showing it, because the list had no
 * reason to look at the parent. Those rows are what this clears.
 *
 * It is not a second delete implementation. It finds the rows and hands each one to the Image
 * Selection module's own purge, the same call the cascade makes, so R2 ordering, the
 * originals-are-never-touched rule and the child-first row deletion all come from one place.
 *
 *   node scripts/one-off/purgeImageSelectionProjectsWithDeletedSalesProject.js            # dry run
 *   node scripts/one-off/purgeImageSelectionProjectsWithDeletedSalesProject.js --execute  # delete
 *
 * The dry run writes nothing and deletes nothing, in the database or in the bucket. It prints one
 * line per project with what would go, and the totals under them.
 *
 * Album Proofing projects are left alone. Their proof pages carry upload ids that no foreign key
 * protects, so emptying the photos out from under them would leave the proofs standing and broken.
 */
require("dotenv").config();
const prisma = require("../../src/config/db");
const { purgeData } = require("../../src/modules/image-selection/projects/service");

const execute = process.argv.includes("--execute");
const gb = (bytes) => (Number(bytes || 0) / 1024 ** 3).toFixed(2);

// Live on this page, linked to a booking, and that booking already deleted. `sourceType` is not
// the test: a project's link is what it is filed under, and a row mislabelled once would be missed.
async function findOrphans() {
  return prisma.imageSelectionProject.findMany({
    where: { deletedAt: null, albumProofing: false, salesProject: { is: { deletedAt: { not: null } } } },
    select: {
      id: true, projectCode: true, projectName: true, salesProjectId: true, totalPhotoSize: true, createdAt: true,
      salesProject: { select: { eventId: true, whatsappGroupName: true, deletedAt: true } },
    },
    orderBy: { createdAt: "asc" },
  });
}

async function countsFor(projectId) {
  const [folders, photos, selections, publications] = await Promise.all([
    prisma.imageSelectionFolder.count({ where: { projectId } }),
    prisma.imageSelectionUpload.count({ where: { projectId } }),
    prisma.imageSelectionPhotoSelection.count({ where: { image: { projectId } } }),
    prisma.imageSelectionGalleryPublication.count({ where: { projectId } }),
  ]);
  // What the purge will actually ask R2 to remove - the keys stored on the rows, nothing rebuilt.
  const objects = await prisma.imageSelectionUpload.count({ where: { projectId, OR: [{ thumbnailKey: { not: null } }, { previewKey: { not: null } }] } });
  return { folders, photos, selections, publications, objects };
}

async function main() {
  const orphans = await findOrphans();
  console.log(execute ? "EXECUTING - this will delete data.\n" : "DRY RUN - nothing is deleted. Re-run with --execute to delete.\n");
  if (!orphans.length) return console.log("No Image Selection projects with a deleted Sales Manager project. Nothing to do.");

  const totals = { folders: 0, photos: 0, selections: 0, publications: 0, objects: 0, bytes: 0n };
  const failures = [];
  for (const project of orphans) {
    const counts = await countsFor(project.id);
    for (const key of Object.keys(counts)) totals[key] += counts[key];
    totals.bytes += BigInt(project.totalPhotoSize || 0);
    console.log([
      `${project.projectCode || project.id}  ${project.projectName}`,
      `  image selection id : ${project.id}`,
      `  sales project      : ${project.salesProjectId} (${project.salesProject?.eventId || "-"} / ${project.salesProject?.whatsappGroupName || "-"})`,
      `  parent deleted     : ${project.salesProject?.deletedAt?.toISOString() || "-"}`,
      `  folders/photos/sel : ${counts.folders} / ${counts.photos} / ${counts.selections}`,
      `  client links       : ${counts.publications}`,
      `  r2 objects         : ${counts.objects}`,
      `  size               : ${gb(project.totalPhotoSize)} GB`,
      `  action             : DELETE`,
    ].join("\n"));

    if (!execute) continue;
    try {
      await purgeData(project.id);
      console.log("  result             : deleted\n");
    } catch (error) {
      // R2 refuses before any row is touched, so a failure here leaves this project exactly as it
      // was and the next run retries it. One project failing must not stop the rest.
      failures.push({ id: project.id, message: error?.message || String(error) });
      console.error(`  result             : FAILED - ${error?.message || error}\n`);
    }
  }

  console.log(`\n${orphans.length} project(s): ${totals.folders} folders, ${totals.photos} photos, ${totals.selections} selections, ${totals.publications} client link(s), ${totals.objects} R2 object(s), ${gb(totals.bytes)} GB.`);
  if (!execute) return console.log("Nothing was deleted. Re-run with --execute to delete.");
  if (failures.length) {
    console.error(`\n${failures.length} project(s) failed and were left untouched - re-run to retry:`);
    for (const failure of failures) console.error(`  ${failure.id}: ${failure.message}`);
    process.exitCode = 1;
  }
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
