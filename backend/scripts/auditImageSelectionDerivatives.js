/*
 * Which Image Selection photos still have their thumbnail and preview in R2, and which do not.
 *
 * The gallery API never checks the bucket: it composes each photo's URL from the key on its row,
 * so a row whose object is gone serializes a perfectly well-formed URL that answers 404 and the
 * browser shows a broken image where the card and the filename still load. This prints, per
 * project, how many photos are whole, how many have lost an object, and - for the ones that have -
 * whether this server could rebuild them from an original it can reach, or whether the photo has
 * to come back through the desktop app or the browser, because the server never had the original.
 *
 * It also prints the oldest object still under the photo-selection root. A date that keeps moving
 * forward from one run to the next means something bucket-side - an object lifecycle rule - is
 * expiring derivatives, and rebuilding them before that is removed is wasted work.
 *
 *   node scripts/auditImageSelectionDerivatives.js                   every project (npm run audit:derivatives)
 *   node scripts/auditImageSelectionDerivatives.js --project <id>    one project
 *   node scripts/auditImageSelectionDerivatives.js --list            every affected photo, one per line
 *
 * Read-only: one bucket listing, database reads, and an existence check on originals. It writes
 * nothing, deletes nothing and queues nothing. Do not re-queue rows by hand from its output: the
 * processing worker reads `originalPath` as given, so a desktop-registered or browser-uploaded
 * photo it is handed fails rather than rebuilds, and a rebuilt photo is scanned for faces again.
 */
require("dotenv").config({ quiet: true });
const fs = require("fs");
const path = require("path");
const prisma = require("../src/config/db");
const r2 = require("../src/modules/image-selection/storage/r2");
const { KEY_ROOT } = require("../src/modules/image-selection/storage/keys");
const { isInsideRoot } = require("../src/modules/image-selection/originals/paths");
const { createSettingsService } = require("../src/modules/image-selection/settings/service");
const { listReadyWithKeys } = require("../src/modules/image-selection/processing/repository");
const { STATUS, classifyRow, summarize } = require("../src/modules/image-selection/processing/derivativeAudit");

const uploadRoot = path.resolve(process.env.IMAGE_SELECTION_UPLOAD_ROOT || path.join(__dirname, "../uploads/image-selection"));

const args = process.argv.slice(2);
const listAll = args.includes("--list");
const projectFlag = args.indexOf("--project");
const projectId = projectFlag >= 0 ? args[projectFlag + 1] : null;

function exists(file) {
  try { fs.accessSync(file, fs.constants.R_OK); return true; } catch { return false; }
}

async function main() {
  if (!r2.isConfigured()) {
    console.error(`R2 is not configured. Missing: ${r2.missingConfig().join(", ")}`);
    process.exit(1);
  }
  const prefix = `${KEY_ROOT}/`;
  const keys = await r2.listKeys(prefix);
  let oldest = null;
  for (const written of keys.values()) if (written && (!oldest || written < oldest)) oldest = written;

  const { originalStoragePath: originalRoot } = await createSettingsService().read();
  const rows = await listReadyWithKeys({ projectId });
  const context = { originalRoot, uploadRoot, exists, isInsideRoot };
  const verdicts = rows.map((row) => classifyRow(row, (key) => keys.has(key), context));

  console.log(`Bucket ${r2.bucket}, ${keys.size} object(s) under ${prefix}; oldest still there: ${oldest ? oldest.toISOString() : "none"}`);
  console.log(`Original Storage Path: ${originalRoot || "(not set)"}; upload root: ${uploadRoot}`);
  console.log(`${rows.length} READY photo(s)${projectId ? ` in project ${projectId}` : ""}\n`);

  const lines = summarize(rows, verdicts);
  if (lines.length) console.table(lines);
  const totals = {};
  for (const { status } of verdicts) totals[status] = (totals[status] || 0) + 1;
  console.log(`\nTotals: ${Object.values(STATUS).map((name) => `${name} ${totals[name] || 0}`).join(", ")}`);
  console.log("  rebuildable = this server can read the original; desktop/browser = the server never had it; legacy = served from local disk, not checked here.");

  if (listAll) {
    console.log("\nAffected photos:");
    rows.forEach((row, index) => {
      const { status, source } = verdicts[index];
      if (status === STATUS.MISSING || status === STATUS.PARTIAL) console.log(`${row.id}\t${status}\t${source}\t${row.fileName}\t${row.previewKey}`);
    });
  }
}

main()
  .catch((error) => { console.error(`${error.name || "Error"}: ${error.message}`); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); process.exit(); });
