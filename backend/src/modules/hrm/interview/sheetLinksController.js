const { z } = require("zod");
const prisma = require("../../../config/db");
const { getConnectionForUser } = require("../../sales/google-oauth/service");
const { prepareInterviewSheetImport, syncInterviewSheetLink, deleteCandidatesFromSheet } = require("./sheetSyncService");
const { listRulesForLink, replaceRulesForLink, deleteRulesForLink, validateRules } = require("./sheetRulesStore");
const { interviewers } = require("./service");

/**
 * The Interview module's linked Google Sheets: list, link, edit, sync, preview, restore, delete.
 *
 * The CRM's `google-sheet-links/controller.js` for the Interview register, answering the same
 * routes in the same shapes so the one Settings panel serves both. Written with Prisma rather than
 * raw SQL because these tables were born under a migration and need no bootstrap; the CRM's keep
 * theirs for the environments that predate it.
 *
 * Two rules are kept from the CRM's version because both have already been learnt the hard way:
 * a link is read through the account of the login that created it, so editing, syncing and
 * previewing are refused to anybody else; and a sheet the connected account cannot read is rolled
 * back rather than stored as a link that imports nothing forever.
 */

const linkSchema = z.object({
  systemTableName: z.string().trim().min(1).max(191),
  systemTableId: z.string().trim().max(191).optional().default(""),
  sheetUrl: z.string().trim().url().max(1000).optional().default(""),
  spreadsheetId: z.string().trim().max(191).optional().default(""),
  spreadsheetName: z.string().trim().max(255).optional().default(""),
  targetedTab: z.string().trim().max(191).optional().default(""),
  sheetId: z.number().int().nullable().optional().default(null),
  // Saved with the link rather than through endpoints of their own, for the reason the CRM's are:
  // creating a link runs the first import immediately, and rules arriving afterwards would miss it.
  assignmentRules: z
    .array(z.object({
      columnHeader: z.string().trim().max(255),
      matchValue: z.string().trim().max(500),
      targets: z.array(z.object({
        employeeId: z.coerce.number().int().positive(),
        percent: z.coerce.number().int().min(1).max(100),
      })).min(1).max(20),
    }))
    .max(100)
    .optional(),
});

function extractSpreadsheetId(sheetUrl) {
  const match = String(sheetUrl || "").match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/i);
  return match?.[1] || null;
}

function extractGidFromUrl(sheetUrl) {
  const match = String(sheetUrl || "").match(/[?&#]gid=(\d+)/i);
  return match ? Number(match[1]) : null;
}

const buildSheetUrl = (spreadsheetId) => (spreadsheetId ? `https://docs.google.com/spreadsheets/d/${spreadsheetId}` : "");

function cleanData(data) {
  return Object.fromEntries(Object.entries(data || {}).map(([key, value]) => [key, typeof value === "string" ? value.trim() : value]));
}

function parseSyncSummary(value) {
  if (!value) return null;
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

/** The Google account each link reads through, for the row's "Account:" line. */
async function connectionsFor(links) {
  const ids = [...new Set(links.map((link) => link.googleAccountConnectionId).filter(Boolean))];
  if (!ids.length) return new Map();
  const rows = await prisma.salesGoogleAccountConnection.findMany({
    where: { id: { in: ids } },
    select: { id: true, googleEmail: true, googleDisplayName: true },
  });
  return new Map(rows.map((row) => [row.id, row]));
}

function mapRow(row, connections = new Map()) {
  if (!row) return null;
  const connection = connections.get(row.googleAccountConnectionId) || null;
  return {
    ...row,
    googleEmail: connection?.googleEmail || "",
    googleDisplayName: connection?.googleDisplayName || "",
    lastSyncedAt: row.lastSyncedAt ? new Date(row.lastSyncedAt).toISOString() : null,
    lastSyncStatus: row.lastSyncStatus || null,
    lastSyncSummary: parseSyncSummary(row.lastSyncSummary),
  };
}

async function withRules(links) {
  return Promise.all(links.map(async (link) => ({ ...link, assignmentRules: await listRulesForLink(link.id) })));
}

async function readLink(id, { deleted = false } = {}) {
  const row = await prisma.hrmInterviewGoogleSheetLink.findFirst({
    where: { id: String(id || "").trim(), deletedAt: deleted ? { not: null } : null },
  });
  if (!row) return null;
  return mapRow(row, await connectionsFor([row]));
}

const notOwner = (link, req) => String(link.createdByUserId || "") && Number(link.createdByUserId) !== Number(req.user.id);

function reconnectRequired(res, error) {
  return res.status(401).json({
    code: "GOOGLE_RECONNECT_REQUIRED",
    message: "Google authorization has expired. Please reconnect your Google account.",
    reason: process.env.NODE_ENV === "production" ? undefined : error?.reason,
  });
}

async function list(req, res) {
  try {
    const rows = await prisma.hrmInterviewGoogleSheetLink.findMany({ where: { deletedAt: null }, orderBy: { createdAt: "desc" } });
    const connections = await connectionsFor(rows);
    return res.json({ data: await withRules(rows.map((row) => mapRow(row, connections))) });
  } catch (error) {
    console.error("Unable to load the Interview Google Sheet links:", error);
    return res.json({ data: [] });
  }
}

async function create(req, res) {
  const parsed = linkSchema.safeParse(cleanData(req.body));
  if (!parsed.success) return res.status(400).json({ message: "Validation failed", errors: parsed.error.flatten() });

  let id = "";
  try {
    const payload = parsed.data;
    const spreadsheetId = String(payload.spreadsheetId || extractSpreadsheetId(payload.sheetUrl) || "").trim();
    const spreadsheetName = String(payload.spreadsheetName || "").trim();
    const targetedTab = String(payload.targetedTab || "").trim();
    if (!spreadsheetId) return res.status(400).json({ message: "Spreadsheet selection is required." });

    const connection = await getConnectionForUser(req.user.id);
    if (!connection || connection.status !== "CONNECTED") {
      return res.status(400).json({ message: "Google connection expired. Please reconnect your Google account." });
    }
    if (!targetedTab) return res.status(400).json({ message: "Targeted tab is required." });

    // Refused before anything is written, so a bad rule cannot leave a linked sheet behind.
    const rules = validateRules(payload.assignmentRules || []);
    if (!rules.valid) return res.status(400).json({ message: rules.issues[0], errors: { assignmentRules: rules.issues } });

    const duplicate = await prisma.hrmInterviewGoogleSheetLink.findFirst({
      where: { deletedAt: null, systemTableName: payload.systemTableName, spreadsheetId, targetedTab },
      select: { id: true },
    });
    if (duplicate) {
      return res.status(409).json({ code: "GOOGLE_SHEET_LINK_ALREADY_EXISTS", message: "This Google Sheet tab is already linked to Interview." });
    }

    const created = await prisma.hrmInterviewGoogleSheetLink.create({
      data: {
        googleAccountConnectionId: connection.id,
        systemTableName: payload.systemTableName,
        systemTableId: payload.systemTableId || "",
        sheetUrl: payload.sheetUrl || buildSheetUrl(spreadsheetId),
        spreadsheetId,
        spreadsheetName: spreadsheetName || spreadsheetId,
        targetedTab,
        status: "ACTIVE",
        createdByUserId: req.user?.id ?? null,
      },
    });
    id = created.id;
    const createdLink = mapRow(created, await connectionsFor([created]));
    // Saved before the first import, not after, or the whole first batch would arrive unassigned.
    createdLink.assignmentRules = await replaceRulesForLink(id, rules.rules);

    let syncResult = null;
    let syncWarning = null;
    try {
      syncResult = await syncInterviewSheetLink(createdLink);
    } catch (syncError) {
      const status = syncError?.status || 0;
      if (status === 401 || status === 403 || status === 404) {
        // A sheet the connected account cannot read is not stored as a link that imports nothing.
        await deleteRulesForLink(id);
        await prisma.hrmInterviewGoogleSheetLink.delete({ where: { id } });
        return res.status(status).json({
          code: syncError.code || undefined,
          message: syncError.message || "The linked spreadsheet could not be read.",
          reason: process.env.NODE_ENV === "production" ? undefined : syncError.reason,
        });
      }
      syncWarning = syncError?.message || "Initial import failed.";
      console.warn("Initial Interview sheet import skipped after link creation:", syncWarning);
    }
    return res.status(201).json({ data: createdLink, sync: syncResult ? syncResult.summary : null, warning: syncWarning });
  } catch (error) {
    console.error("Unable to save the Interview Google Sheet link:", error);
    if (error?.code === "GOOGLE_RECONNECT_REQUIRED") return reconnectRequired(res, error);
    return res.status(error?.status || 500).json({ message: error?.message || "Unable to save Google Sheet link." });
  }
}

async function update(req, res) {
  const parsed = linkSchema.partial().safeParse(cleanData(req.body));
  if (!parsed.success) return res.status(400).json({ message: "Validation failed", errors: parsed.error.flatten() });

  const id = String(req.params.id || "").trim();
  let restoreRules = null;
  try {
    const existing = await readLink(id);
    if (!existing) return res.status(404).json({ message: "Google Sheet link not found." });
    if (notOwner(existing, req)) return res.status(403).json({ message: "You do not have access to this Google Sheet link." });

    const payload = parsed.data;
    const sheetUrl = payload.sheetUrl !== undefined && payload.sheetUrl !== "" ? payload.sheetUrl : existing.sheetUrl;
    const spreadsheetId = String(payload.spreadsheetId || extractSpreadsheetId(sheetUrl) || existing.spreadsheetId || "").trim();
    const targetedTab = String(payload.targetedTab ?? existing.targetedTab ?? "").trim();
    if (!spreadsheetId) return res.status(400).json({ message: "Spreadsheet selection is required." });
    if (!targetedTab) return res.status(400).json({ message: "Targeted tab is required." });

    const duplicate = await prisma.hrmInterviewGoogleSheetLink.findFirst({
      where: { deletedAt: null, id: { not: id }, systemTableName: payload.systemTableName || existing.systemTableName, spreadsheetId, targetedTab },
      select: { id: true },
    });
    if (duplicate) {
      return res.status(409).json({ code: "GOOGLE_SHEET_LINK_ALREADY_EXISTS", message: "Another link already points at this Google Sheet tab." });
    }

    const rules = payload.assignmentRules === undefined ? null : validateRules(payload.assignmentRules);
    if (rules && !rules.valid) return res.status(400).json({ message: rules.issues[0], errors: { assignmentRules: rules.issues } });
    // Written before the sync, which reads them back from the database; kept, so a failed edit can
    // put them back exactly as they were.
    const previousRules = rules ? await listRulesForLink(id) : null;
    if (rules) {
      await replaceRulesForLink(id, rules.rules);
      restoreRules = () => replaceRulesForLink(id, previousRules.map((rule) => ({
        columnHeader: rule.columnHeader,
        matchValue: rule.matchValue,
        targets: (rule.targets || []).map((target) => ({ employeeId: target.employeeId, percent: target.percent })),
      })));
    }

    // Read the new target before persisting, so a bad edit leaves the existing link untouched.
    const candidate = {
      ...existing,
      sheetUrl: sheetUrl || buildSheetUrl(spreadsheetId),
      spreadsheetId,
      spreadsheetName: String(payload.spreadsheetName || existing.spreadsheetName || "").trim() || spreadsheetId,
      targetedTab,
      systemTableId: payload.systemTableId ?? existing.systemTableId ?? "",
    };
    const syncResult = await syncInterviewSheetLink(candidate);

    await prisma.hrmInterviewGoogleSheetLink.update({
      where: { id },
      data: {
        sheetUrl: candidate.sheetUrl,
        spreadsheetId: candidate.spreadsheetId,
        spreadsheetName: candidate.spreadsheetName,
        targetedTab: candidate.targetedTab,
        systemTableId: candidate.systemTableId || "",
      },
    });
    const updated = await readLink(id);
    return res.json({ data: { ...updated, assignmentRules: await listRulesForLink(id) }, sync: syncResult ? syncResult.summary : null });
  } catch (error) {
    console.error("Unable to update the Interview Google Sheet link:", error);
    if (restoreRules) await restoreRules().catch((restoreError) => {
      console.error("Interview sheet link edit failed and its assignment rules could not be restored:", restoreError);
    });
    const status = error?.status || 500;
    if (error?.code === "GOOGLE_RECONNECT_REQUIRED" || status === 401) return reconnectRequired(res, error);
    return res.status(status).json({
      code: error?.code || undefined,
      message: error?.message || "Unable to update Google Sheet link.",
      reason: process.env.NODE_ENV === "production" ? undefined : error.reason,
    });
  }
}

async function remove(req, res) {
  const id = String(req.params.id || "").trim();
  try {
    const existing = await readLink(id);
    if (!existing) return res.status(404).json({ message: "Google Sheet link not found." });
    await prisma.hrmInterviewGoogleSheetLink.update({ where: { id }, data: { deletedAt: new Date() } });
    // Deleting a source deletes what it produced; the spreadsheet itself is never touched.
    let deletedCandidates = 0;
    try {
      deletedCandidates = await deleteCandidatesFromSheet({
        spreadsheetId: existing.spreadsheetId || extractSpreadsheetId(existing.sheetUrl) || "",
        gid: extractGidFromUrl(existing.sheetUrl) ?? "",
        targetTab: existing.targetedTab || "",
      });
    } catch (error) {
      console.error("Interview sheet link deleted, but its candidates could not be removed:", error.message);
    }
    return res.json({ data: await readLink(id, { deleted: true }), deletedCandidates });
  } catch (error) {
    console.error("Unable to remove the Interview Google Sheet link:", error);
    return res.status(500).json({ message: "Unable to remove Google Sheet link." });
  }
}

/** Undoes a delete: the stamp is cleared and syncing resumes where it left off. */
async function restore(req, res) {
  const id = String(req.params.id || "").trim();
  if (!id) return res.status(400).json({ message: "A Google Sheet link id is required." });
  try {
    const deleted = await readLink(id, { deleted: true });
    if (!deleted) return res.status(404).json({ message: "That Google Sheet link is not available to restore." });
    await prisma.hrmInterviewGoogleSheetLink.update({ where: { id }, data: { deletedAt: null } });
    return res.json({ message: "Google Sheet link restored.", data: await readLink(id) });
  } catch (error) {
    console.error("Unable to restore the Interview Google Sheet link:", error);
    return res.status(500).json({ message: "Unable to restore the Google Sheet link." });
  }
}

async function sync(req, res) {
  try {
    const link = await readLink(req.params.id);
    if (!link) return res.status(404).json({ message: "Google Sheet link not found." });
    if (notOwner(link, req)) return res.status(403).json({ message: "You do not have access to this Google Sheet link." });
    const result = await syncInterviewSheetLink(link);
    return res.json({ data: result });
  } catch (error) {
    console.error("Unable to sync the Interview Google Sheet link:", error);
    const status = error.status || 500;
    if (error.code === "GOOGLE_RECONNECT_REQUIRED" || status === 401) return reconnectRequired(res, error);
    return res.status(status).json({
      code: error.code || undefined,
      message: error.message || "Unable to sync Google Sheet link.",
      reason: process.env.NODE_ENV === "production" ? undefined : error.reason,
    });
  }
}

async function preview(req, res) {
  try {
    const link = await readLink(req.params.id);
    if (!link) return res.status(404).json({ message: "Google Sheet link not found." });
    if (notOwner(link, req)) return res.status(403).json({ message: "You do not have access to this Google Sheet link." });
    const previewData = await prepareInterviewSheetImport(link);
    const rows = Array.isArray(previewData.rows) ? previewData.rows.slice(0, 50) : [];
    return res.json({
      data: {
        link: {
          id: link.id,
          systemTableName: link.systemTableName,
          spreadsheetId: previewData.spreadsheetId,
          spreadsheetName: previewData.spreadsheetName,
          targetedTab: previewData.targetedTab,
          googleEmail: link.googleEmail || "",
          googleDisplayName: link.googleDisplayName || "",
          lastSyncedAt: link.lastSyncedAt,
          lastSyncStatus: link.lastSyncStatus,
          lastSyncSummary: link.lastSyncSummary,
        },
        mapping: previewData.mapping,
        headers: previewData.headers,
        summary: previewData.summary,
        assignment: previewData.assignment,
        assignmentRules: await listRulesForLink(link.id),
        rows,
        previewTruncated: rows.length < (previewData.rows || []).length,
      },
    });
  } catch (error) {
    console.error("Unable to prepare the Interview Google Sheet import preview:", error);
    return res.status(error.status || 500).json({ message: error.message || "Unable to prepare Google Sheet import preview." });
  }
}

/**
 * Who a rule may assign candidates to: every working employee, since anybody may interview. Served
 * here so linking a sheet never depends on the HR roster endpoint and the permission behind it.
 */
async function assignableEmployees(req, res) {
  try {
    return res.json({ data: await interviewers() });
  } catch (error) {
    console.error("Unable to load the employees an interview sheet rule may assign to:", error);
    return res.status(500).json({ message: "Unable to load the employee list." });
  }
}

module.exports = { list, create, update, remove, restore, sync, preview, assignableEmployees };
