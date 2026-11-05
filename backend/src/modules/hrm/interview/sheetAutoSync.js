const prisma = require("../../../config/db");
const { autoSyncIntervalMs } = require("../../sales/crm-leads/autoSync");
const { syncInterviewSheetLink } = require("./sheetSyncService");

/**
 * The background pass over every linked Interview sheet.
 *
 * The CRM's poller for the Interview module's own links, on the same interval and the same
 * `GOOGLE_SHEETS_AUTO_SYNC` switch, since "how fresh is a linked sheet" is one answer for the
 * whole application. A link that fails - revoked access, a renamed tab - must not stop the others,
 * so failures are logged per link and the run continues.
 */

let timer = null;
let running = false;

const enabled = () => String(process.env.GOOGLE_SHEETS_AUTO_SYNC ?? "true").toLowerCase() !== "false";

async function listActiveLinks() {
  return prisma.hrmInterviewGoogleSheetLink.findMany({
    where: { deletedAt: null, status: "ACTIVE", googleAccountConnectionId: { not: null }, targetedTab: { not: "" } },
    orderBy: { createdAt: "asc" },
  });
}

async function runInterviewAutoSyncOnce() {
  if (running) return { skipped: true };
  running = true;
  const started = Date.now();
  let created = 0;
  // Rows a pass declined to write because the candidate is already in the register. Logged beside
  // the creates so a run that adds nothing still says the sheet held nothing new.
  let skippedExisting = 0;
  let failedLinks = 0;
  try {
    const links = await listActiveLinks();
    for (const link of links) {
      try {
        const result = await syncInterviewSheetLink(link);
        created += result?.summary?.created || 0;
        skippedExisting += result?.summary?.skippedExisting || 0;
      } catch (error) {
        failedLinks += 1;
        console.warn(`[interview-auto-sync] ${link.spreadsheetId}/${link.targetedTab}: ${error?.message || "sync failed"}`);
      }
    }
    if (created || failedLinks) {
      console.log(`[interview-auto-sync] ${links.length} link(s) in ${Date.now() - started}ms — ${created} created, ${skippedExisting} already in the register, ${failedLinks} failed`);
    }
    return { links: links.length, created, skippedExisting, failedLinks };
  } catch (error) {
    console.error("[interview-auto-sync] run failed:", error?.message || error);
    return { error: error?.message || "run failed" };
  } finally {
    running = false;
  }
}

function startInterviewSheetAutoSync() {
  if (timer || !enabled()) {
    if (!enabled()) console.log("[interview-auto-sync] disabled via GOOGLE_SHEETS_AUTO_SYNC=false");
    return null;
  }
  const intervalMs = autoSyncIntervalMs();
  timer = setInterval(() => { void runInterviewAutoSyncOnce(); }, intervalMs);
  // Do not hold the event loop open purely for the poller.
  if (typeof timer.unref === "function") timer.unref();
  console.log(`[interview-auto-sync] every ${Math.round(intervalMs / 1000)}s`);
  return timer;
}

function stopInterviewSheetAutoSync() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

module.exports = { startInterviewSheetAutoSync, stopInterviewSheetAutoSync, runInterviewAutoSyncOnce };
