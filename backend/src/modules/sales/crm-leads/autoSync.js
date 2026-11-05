const crypto = require("node:crypto");
const prisma = require("../../../config/db");
const { syncGoogleSheetLinkToCrm, readLinkedGoogleSheet } = require("./googleSheetsService");

const DEFAULT_INTERVAL_SECONDS = 120;

// Google has no push notification we can use here, so a sheet edit - a new row, or a change
// to an existing one - can only be noticed on the next poll. This interval is therefore the
// real "how fresh is the CRM" number. Two minutes keeps edits current without spending the
// Sheets quota: each link costs 2 API calls per pass, against 60 reads/min/user.
function autoSyncIntervalMs() {
  const seconds = Number(process.env.GOOGLE_SHEETS_SYNC_INTERVAL_SECONDS || 0);
  if (Number.isFinite(seconds) && seconds > 0) return Math.max(10, seconds) * 1000;
  const minutes = Number(process.env.GOOGLE_SHEETS_SYNC_INTERVAL_MINUTES || 0);
  if (Number.isFinite(minutes) && minutes > 0) return minutes * 60 * 1000;
  return DEFAULT_INTERVAL_SECONDS * 1000;
}

function autoSyncEnabled() {
  return String(process.env.GOOGLE_SHEETS_AUTO_SYNC ?? "true").toLowerCase() !== "false";
}

let timer = null;
let running = false;

/*
 * ── A sheet that has not changed is not imported again ─────────────────────────────────────────
 *
 * A full pass reads every live lead, every deleted lead and every enquiry id out of the database and
 * matches the sheet's rows against them in memory - work that grows with the CRM and runs on the
 * same thread that answers every screen. On most passes the sheet holds exactly what it held two
 * minutes earlier, so all of that finds nothing to do. The sheet is read anyway (it is how a change
 * is seen, and it is two cheap Google calls); when its contents hash the same as at the last pass
 * that *finished cleanly*, the import is skipped.
 *
 * - Only a clean pass is remembered: a pass with a failed row is run again in full next time, so a
 *   row that failed on a hiccup is retried rather than waiting for somebody to edit the sheet.
 * - Even an unchanged sheet gets a full pass every `FULL_PASS_EVERY_MS`, so anything the hash
 *   cannot see - a lead deleted here, a rule changed - is still caught within half an hour.
 * - Held in memory: a restart simply runs everything once, as before.
 */
const FULL_PASS_EVERY_MS = 30 * 60 * 1000;
const lastCleanPass = new Map();

const sheetFingerprint = (link, sheet) => crypto.createHash("sha1")
  .update(JSON.stringify([link.vertical, link.targetedTab, sheet?.headers || [], sheet?.rows || []]))
  .digest("hex");

/** Whether `link`'s sheet, just read, is what the last clean pass imported, recently enough to trust. */
function unchangedSince(link, fingerprint, now = Date.now()) {
  const last = lastCleanPass.get(link.id);
  return Boolean(last && last.fingerprint === fingerprint && now - last.at < FULL_PASS_EVERY_MS);
}

/** Only the time is noted for a skipped pass, so the panel's last result stays the last real one. */
async function touchLinkSync(linkId) {
  try {
    await prisma.$executeRawUnsafe("UPDATE `sales_google_sheet_link` SET `last_synced_at` = CURRENT_TIMESTAMP(3) WHERE `id` = ?", linkId);
  } catch {
    // Reporting, not the work.
  }
}

async function listActiveLinks() {
  return prisma.$queryRawUnsafe(`
    SELECT
      id,
      google_account_connection_id AS googleAccountConnectionId,
      system_table_name AS systemTableName,
      system_table_id AS systemTableId,
      vertical,
      sheet_url AS sheetUrl,
      spreadsheet_id AS spreadsheetId,
      spreadsheet_name AS spreadsheetName,
      targeted_tab AS targetedTab,
      status,
      created_by_user_id AS createdByUserId,
      deleted_at AS deletedAt,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM \`sales_google_sheet_link\`
    WHERE deleted_at IS NULL
      AND status = 'ACTIVE'
      AND google_account_connection_id IS NOT NULL
      AND targeted_tab <> ''
    ORDER BY created_at ASC
  `);
}

// One pass over every active link. A link that fails (revoked access, renamed tab)
// must not stop the others, so failures are logged per link and the run continues.
async function runAutoSyncOnce() {
  if (running) return { skipped: true };
  running = true;

  const started = Date.now();
  let created = 0;
  // Rows a pass declined to write because their lead is already in the CRM. Logged beside the
  // creates so a run that adds nothing still reads as "the sheet held nothing new", not as silence.
  let skippedExisting = 0;
  let failedLinks = 0;
  let unchanged = 0;

  try {
    const links = await listActiveLinks();
    for (const link of links) {
      try {
        const sheet = await readLinkedGoogleSheet(link);
        const fingerprint = sheetFingerprint(link, sheet);
        if (unchangedSince(link, fingerprint)) {
          unchanged += 1;
          await touchLinkSync(link.id);
          continue;
        }
        const result = await syncGoogleSheetLinkToCrm(link, { sheet });
        created += result?.summary?.created || 0;
        skippedExisting += result?.summary?.skippedExisting || 0;
        if (result?.summary?.failed) lastCleanPass.delete(link.id);
        else lastCleanPass.set(link.id, { fingerprint, at: Date.now() });
      } catch (error) {
        lastCleanPass.delete(link.id);
        failedLinks += 1;
        console.warn(
          `[crm-auto-sync] ${link.spreadsheetId}/${link.targetedTab}: ${error?.message || "sync failed"}`,
        );
      }
    }

    if (created || failedLinks) {
      console.log(
        `[crm-auto-sync] ${links.length} link(s) in ${Date.now() - started}ms — ${created} created, ${skippedExisting} already in the CRM, ${failedLinks} failed`,
      );
    }
    return { links: links.length, created, skippedExisting, failedLinks, unchanged };
  } catch (error) {
    console.error("[crm-auto-sync] run failed:", error?.message || error);
    return { error: error?.message || "run failed" };
  } finally {
    running = false;
  }
}

function startCrmAutoSync() {
  if (timer || !autoSyncEnabled()) {
    if (!autoSyncEnabled()) console.log("[crm-auto-sync] disabled via GOOGLE_SHEETS_AUTO_SYNC=false");
    return null;
  }

  const intervalMs = autoSyncIntervalMs();
  timer = setInterval(() => {
    void runAutoSyncOnce();
  }, intervalMs);
  // Do not hold the event loop open purely for the poller.
  if (typeof timer.unref === "function") timer.unref();

  console.log(`[crm-auto-sync] every ${Math.round(intervalMs / 1000)}s`);
  return timer;
}

function stopCrmAutoSync() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

module.exports = { startCrmAutoSync, stopCrmAutoSync, runAutoSyncOnce, autoSyncIntervalMs, sheetFingerprint, unchangedSince, lastCleanPass, FULL_PASS_EVERY_MS };
