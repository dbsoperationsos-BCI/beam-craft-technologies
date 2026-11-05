const prisma = require("../../../config/db");
const { syncGoogleSheetLinkToCrm } = require("./googleSheetsService");

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

  try {
    const links = await listActiveLinks();
    for (const link of links) {
      try {
        const result = await syncGoogleSheetLinkToCrm(link);
        created += result?.summary?.created || 0;
        skippedExisting += result?.summary?.skippedExisting || 0;
      } catch (error) {
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
    return { links: links.length, created, skippedExisting, failedLinks };
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

module.exports = { startCrmAutoSync, stopCrmAutoSync, runAutoSyncOnce, autoSyncIntervalMs };
