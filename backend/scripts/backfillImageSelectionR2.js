// Uploads existing image derivatives from local disk to Cloudflare R2 and records the
// object keys, so images processed before the move to object storage are served from the
// bucket like everything since.
//
//   node scripts/backfillImageSelectionR2.js --dry-run     see what would happen
//   node scripts/backfillImageSelectionR2.js               do it
//   node scripts/backfillImageSelectionR2.js --limit 20    do a small batch first
//
// Safe to re-run: rows that already have both keys are skipped, and keys are derived
// deterministically, so a repeat upload overwrites the same object rather than
// duplicating it. Local files are never deleted; clean those up once you are satisfied.
require("dotenv").config();
const fs = require("fs/promises");
const path = require("path");
const prisma = require("../src/config/db");
const r2 = require("../src/modules/image-selection/storage/r2");
const { buildDerivativeKey } = require("../src/modules/image-selection/storage/keys");

const uploadRoot = path.resolve(process.env.IMAGE_SELECTION_UPLOAD_ROOT || path.join(__dirname, "../uploads/image-selection"));
const thumbnailRoot = path.join(uploadRoot, "thumbnails");
const previewRoot = path.join(uploadRoot, "processed");

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const limitFlag = args.indexOf("--limit");
const limit = limitFlag >= 0 ? Number.parseInt(args[limitFlag + 1], 10) : 0;
const BATCH = 100;

const folderCache = new Map();
async function folderChain(folderId) {
  if (!folderId) return [];
  if (folderCache.has(folderId)) return folderCache.get(folderId);
  const chain = [];
  let currentId = folderId;
  for (let depth = 0; currentId && depth < 20; depth += 1) {
    const folder = await prisma.imageSelectionFolder.findUnique({ where: { id: currentId }, select: { id: true, name: true, parentId: true } });
    if (!folder) break;
    chain.unshift({ id: folder.id, name: folder.name });
    currentId = folder.parentId;
  }
  folderCache.set(folderId, chain);
  return chain;
}

async function readIfPresent(file) {
  try { return await fs.readFile(file); } catch { return null; }
}

async function main() {
  if (!r2.isConfigured()) {
    console.error(`R2 is not configured. Missing: ${r2.missingConfig().join(", ")}`);
    process.exit(1);
  }
  const where = { status: "READY", OR: [{ thumbnailKey: null }, { previewKey: null }] };
  const total = await prisma.imageSelectionUpload.count({ where });
  const target = limit > 0 ? Math.min(limit, total) : total;
  console.log(`${total} READY images still without R2 keys; processing ${target}${dryRun ? " (dry run)" : ""}\n`);

  const stats = { uploaded: 0, skippedNoFile: 0, failed: 0 };
  let cursor = null;
  let handled = 0;

  while (handled < target) {
    const take = Math.min(BATCH, target - handled);
    const rows = await prisma.imageSelectionUpload.findMany({
      where, take, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}), orderBy: { id: "asc" },
      select: { id: true, storageName: true, fileName: true, folderId: true, projectId: true, thumbnailName: true, processedName: true, thumbnailKey: true, previewKey: true, project: { select: { projectName: true } } },
    });
    if (!rows.length) break;
    cursor = rows[rows.length - 1].id;

    for (const row of rows) {
      handled += 1;
      try {
        const folders = await folderChain(row.folderId);
        const identity = { projectName: row.project?.projectName, projectId: row.projectId, folders, fileName: row.fileName, storageName: row.storageName };
        const thumbnailKey = buildDerivativeKey({ ...identity, variant: "thumbnail" });
        const previewKey = buildDerivativeKey({ ...identity, variant: "preview" });

        const thumbnailBody = await readIfPresent(path.join(thumbnailRoot, row.thumbnailName || `${row.storageName}.webp`));
        const previewBody = await readIfPresent(path.join(previewRoot, row.processedName || `${row.storageName}.preview.jpg`));
        if (!thumbnailBody || !previewBody) {
          stats.skippedNoFile += 1;
          console.warn(`  skip ${row.id}: ${!thumbnailBody ? "thumbnail" : "preview"} missing on disk`);
          continue;
        }
        if (dryRun) {
          stats.uploaded += 1;
          if (stats.uploaded <= 5) console.log(`  would upload -> ${previewKey}`);
          continue;
        }
        await r2.putObject(thumbnailKey, thumbnailBody, "image/webp");
        await r2.putObject(previewKey, previewBody, "image/jpeg");
        await prisma.imageSelectionUpload.update({ where: { id: row.id }, data: { thumbnailKey, previewKey } });
        stats.uploaded += 1;
        if (stats.uploaded % 25 === 0) console.log(`  ${stats.uploaded}/${target} uploaded`);
      } catch (error) {
        stats.failed += 1;
        console.error(`  FAILED ${row.id}: ${error.message}`);
      }
    }
  }

  console.log(`\nuploaded: ${stats.uploaded}   skipped (no local file): ${stats.skippedNoFile}   failed: ${stats.failed}`);
  if (dryRun) console.log("dry run - nothing was written to R2 or the database");
  else if (stats.uploaded) console.log("local files were left in place; remove them once the gallery looks right");
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
