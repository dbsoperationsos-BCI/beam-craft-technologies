/*
 * Preview-only recovery: puts back a thumbnail or preview that has gone from the bucket.
 *
 * The processing pipeline (`service.processUpload`) is what a photo goes through once: read the
 * original, render both derivatives, upload them, write the row READY and hand it to the face
 * scan. Recovery is deliberately NOT that pipeline run again. The row is already READY and keeps
 * every column it has - the keys, `originalPath`, the folder, the client's selections - and only
 * the object(s) missing behind its keys are rendered again and written under those same keys, so
 * nothing in the database has to change and nothing downstream (faces, People, album versions,
 * progress events) is told anything. This module therefore requires none of that: no hook, no
 * queue, no Prisma - everything it uses is handed in by `createRecovery`, and the test pins that.
 *
 * Only an original THIS server can read is rebuilt from: an absolute `originalPath` inside the
 * studio's Original Storage Path, or a browser upload whose bytes are still under the upload
 * root. A photo the desktop registered against a storage root, or one the browser drop zone
 * uploaded after cutting its own derivatives, has no original here; it is counted and named, and
 * comes back by re-registering or re-uploading it.
 *
 * Before anything is written, the bucket's lifecycle rules are read: an enabled expiry rule over
 * the photo-selection root is what made the objects disappear in the first place, and rebuilding
 * under it is work the next sweep undoes. A rule that is there, or rules this token cannot read,
 * block an apply unless `force` is passed by somebody who has checked the dashboard themselves.
 */
const { KEY_ROOT } = require("../storage/keys");
const { STATUS, SOURCE, classifyRow, sourcePath } = require("./derivativeAudit");

const CONTENT_TYPE = { thumbnail: "image/webp", preview: "image/jpeg" };
const PREFIX = `${KEY_ROOT}/`;

/**
 * The enabled rules that would expire objects under `prefix`: a rule with an Expiration whose
 * own prefix (`Filter.Prefix`, or the older top-level `Prefix`; none means the whole bucket)
 * either covers the root or sits somewhere inside it.
 */
function expiringRules(rules, prefix) {
  return (rules || []).filter((rule) => {
    if (!rule || rule.Status !== "Enabled" || !rule.Expiration) return false;
    const scope = rule.Filter?.Prefix ?? rule.Filter?.And?.Prefix ?? rule.Prefix ?? "";
    return prefix.startsWith(scope) || scope.startsWith(prefix);
  });
}

function createRecovery({ r2, repository, render, files, settings, uploadRoot, isInsideRoot, verify, log = console.log }) {
  async function lifecycleBlock() {
    const result = await r2.lifecycleRules();
    if (result.error) return `the bucket's lifecycle rules could not be read (${result.error}); check them in the Cloudflare dashboard and pass --force once no expiry rule covers ${PREFIX}`;
    const active = expiringRules(result.rules, PREFIX);
    if (active.length) return `an enabled expiry rule still covers ${PREFIX}: ${active.map((rule) => rule.ID || "(unnamed)").join(", ")}; remove it before rebuilding, or pass --force`;
    return null;
  }

  async function rebuild(row, missing) {
    const source = await files.readFile(row.sourcePath);
    const rendered = await render(source, row);
    for (const variant of missing) await r2.putObject(row[`${variant}Key`], rendered[variant].data, CONTENT_TYPE[variant]);
    for (const variant of missing) {
      const url = r2.publicUrl(row[`${variant}Key`]);
      const answer = await verify(url);
      if (answer.status !== 200 || !String(answer.contentType || "").startsWith("image/")) throw new Error(`${variant} came back ${answer.status} ${answer.contentType || ""} from ${url}`);
    }
  }

  async function run({ projectId = null, all = false, apply = false, force = false } = {}) {
    if (!projectId && !all) throw new Error("Pass --project <id> or --all.");
    // Always read, so a dry run can already say what an apply would run into; only an unforced
    // apply is actually held back by it.
    const guard = await lifecycleBlock();
    const blocked = apply && !force ? guard : null;
    const keys = await r2.listKeys(PREFIX);
    const { originalStoragePath: originalRoot } = await settings.read();
    const context = { originalRoot, uploadRoot, exists: files.exists, isInsideRoot };
    const rows = await repository.listReadyWithKeys({ projectId: all ? null : projectId });

    const counts = { photos: rows.length, missing: 0, rebuildable: 0, rebuilt: 0, skippedUnavailable: 0, failed: 0 };
    const items = [];
    for (const row of rows) {
      const verdict = classifyRow(row, (key) => keys.has(key), context);
      if (verdict.status !== STATUS.MISSING && verdict.status !== STATUS.PARTIAL) continue;
      counts.missing += 1;
      const missing = ["thumbnail", "preview"].filter((variant) => row[`${variant}Key`] && !keys.has(row[`${variant}Key`]));
      if (verdict.source !== SOURCE.REDERIVABLE) {
        counts.skippedUnavailable += 1;
        items.push({ id: row.id, fileName: row.fileName, outcome: "skipped-unavailable", reason: verdict.source, missing });
        continue;
      }
      counts.rebuildable += 1;
      if (!apply || blocked) { items.push({ id: row.id, fileName: row.fileName, outcome: "rebuildable", reason: null, missing }); continue; }
      try {
        await rebuild({ ...row, sourcePath: sourcePath(row, context) }, missing);
        counts.rebuilt += 1;
        items.push({ id: row.id, fileName: row.fileName, outcome: "rebuilt", reason: null, missing });
      } catch (error) {
        counts.failed += 1;
        items.push({ id: row.id, fileName: row.fileName, outcome: "failed", reason: error.message, missing });
        log(`[image-selection recovery] ${row.id} ${row.fileName}: ${error.message}`);
      }
    }
    return { counts, items, blocked, guard, apply: Boolean(apply && !blocked), prefix: PREFIX, objects: keys.size };
  }

  return { run, lifecycleBlock };
}

const USAGE = "Usage: --project <id> | --all  [--apply] [--force] [--list]";

/** The CLI's flags, refused loudly when they do not say exactly one scope or carry a stray value. */
function parseArgs(argv) {
  const out = { projectId: null, all: false, apply: false, force: false, list: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--project") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`--project needs an id. ${USAGE}`);
      out.projectId = value;
      index += 1;
    } else if (arg === "--all") out.all = true;
    else if (arg === "--apply") out.apply = true;
    else if (arg === "--force") out.force = true;
    else if (arg === "--list") out.list = true;
    else throw new Error(`unknown flag ${arg}. ${USAGE}`);
  }
  if (out.projectId && out.all) throw new Error(`Pass either --project <id> or --all, not both. ${USAGE}`);
  if (!out.projectId && !out.all) throw new Error(`Pass --project <id> or --all. ${USAGE}`);
  return out;
}

module.exports = { createRecovery, expiringRules, parseArgs, PREFIX, CONTENT_TYPE };
