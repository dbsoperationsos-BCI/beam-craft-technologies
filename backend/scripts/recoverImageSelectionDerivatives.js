/*
 * Puts back Image Selection thumbnails and previews that have gone from R2, one project at a time.
 *
 * A dry run by default: it says what it would do and writes nothing. `--apply` rebuilds, from an
 * original THIS server can read, only the object(s) missing behind a photo's keys, and writes them
 * under those same keys - so no row changes, no selection, link, folder or face is touched, and
 * nothing is queued. Every rebuilt object is then fetched back from the public URL and must answer
 * 200 with image bytes to count as rebuilt. Photos whose original is on a desktop or was only ever
 * in a browser are counted as skipped and named with `--list`; they come back by re-registering or
 * re-uploading them.
 *
 *   npm run recover:derivatives -- --project <id>              dry run for one project
 *   npm run recover:derivatives -- --project <id> --apply      rebuild that project
 *   npm run recover:derivatives -- --all --apply               rebuild every project
 *   add --list for every affected photo, one per line
 *
 * An apply first reads the bucket's lifecycle rules. An enabled expiry rule over the photo-
 * selection root - the usual reason the objects went - blocks it, and so do rules this token
 * cannot read; `--force` overrides both for somebody who has checked the Cloudflare dashboard.
 * Start with one small project, confirm the previews load, then widen.
 */
require("dotenv").config({ quiet: true });
const fs = require("fs");
const path = require("path");
const prisma = require("../src/config/db");
const r2 = require("../src/modules/image-selection/storage/r2");
const repository = require("../src/modules/image-selection/processing/repository");
const { renderDerivatives } = require("../src/modules/image-selection/processing/service");
const { createRecovery, parseArgs } = require("../src/modules/image-selection/processing/recovery");
const { isInsideRoot } = require("../src/modules/image-selection/originals/paths");
const { createSettingsService } = require("../src/modules/image-selection/settings/service");

const uploadRoot = path.resolve(process.env.IMAGE_SELECTION_UPLOAD_ROOT || path.join(__dirname, "../uploads/image-selection"));


function exists(file) {
  try { fs.accessSync(file, fs.constants.R_OK); return true; } catch { return false; }
}

// A rebuilt object is only believed once the public URL hands back image bytes, exactly as a
// browser would ask for them. HEAD first; a CDN that will not HEAD is asked for the first byte.
// Bounded, so one CDN that stops answering cannot hold the whole run.
async function verify(url) {
  let response = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(15000) });
  if (response.status === 405) response = await fetch(url, { headers: { Range: "bytes=0-0" }, signal: AbortSignal.timeout(15000) });
  return { status: response.status === 206 ? 200 : response.status, contentType: response.headers.get("content-type") || "" };
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  if (!r2.isConfigured()) {
    console.error(`R2 is not configured. Missing: ${r2.missingConfig().join(", ")}`);
    process.exitCode = 1;
    return;
  }
  const recovery = createRecovery({
    r2, repository, render: renderDerivatives,
    files: { exists, readFile: (file) => fs.promises.readFile(file) },
    settings: createSettingsService(), uploadRoot, isInsideRoot, verify,
    log: (line) => console.error(line),
  });
  const result = await recovery.run(flags);

  console.log(`${result.apply ? "APPLIED" : "DRY RUN"} - bucket ${r2.bucket}, ${result.objects} object(s) under ${result.prefix}${flags.projectId ? `, project ${flags.projectId}` : ", every project"}`);
  if (result.blocked) console.log(`NOT APPLIED: ${result.blocked}`);
  else if (result.guard && !flags.apply) console.log(`NOTE: an apply would be blocked - ${result.guard}`);
  else if (result.guard && flags.force) console.log(`FORCED past: ${result.guard}`);
  const { counts } = result;
  console.table([{ photos: counts.photos, missing: counts.missing, rebuildable: counts.rebuildable, rebuilt: counts.rebuilt, "skipped-unavailable": counts.skippedUnavailable, failed: counts.failed }]);
  if (flags.list) {
    for (const item of result.items) console.log(`${item.id}\t${item.outcome}\t${item.missing.join("+")}\t${item.fileName}\t${item.reason || ""}`);
  }
  if (result.blocked || counts.failed) process.exitCode = 1;
}

main()
  .catch((error) => { console.error(`${error.name || "Error"}: ${error.message}`); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); process.exit(); });
