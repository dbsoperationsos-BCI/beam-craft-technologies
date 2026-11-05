const { z } = require("zod");
const { randomUUID } = require("crypto");
const prisma = require("../../../config/db");
const { syncGoogleSheetLinkToCrm, prepareGoogleSheetCrmImport } = require("../crm-leads/googleSheetsService");
const { deleteCrmLeadsFromSheet } = require("../crm-leads/crmLeadService");
const { getConnectionForUser, getSpreadsheetTabsForUser } = require("../google-oauth/service");
const { ensureRulesTableExists, listRulesForLink, replaceRulesForLink, deleteRulesForLink, validateRules } = require("./rulesStore");
const { salesEmployees } = require("../../../services/employeeOptionLists");

const linkSchema = z.object({
  systemTableName: z.string().trim().min(1).max(191),
  systemTableId: z.string().trim().max(191).optional().default(""),
  vertical: z.string().trim().max(191).optional().default(""),
  sheetUrl: z.string().trim().url().max(1000).optional().default(""),
  spreadsheetId: z.string().trim().max(191).optional().default(""),
  spreadsheetName: z.string().trim().max(255).optional().default(""),
  targetedTab: z.string().trim().max(191).optional().default(""),
  sheetId: z.number().int().nullable().optional().default(null),
  /*
   * The link's lead-assignment rules - a column, the value to look for in it, and the people who
   * share its leads - saved with the link rather than through endpoints of their own. Deliberate: the rules are asked for in the same dialog that links the sheet, and the
   * link's own create runs the first import immediately - rules arriving in a second request
   * would land after that import had already assigned nothing. Nesting them also means no new
   * permission to seed, since they answer to the guard the router already mounts.
   */
  assignmentRules: z
    .array(
      z.object({
        columnHeader: z.string().trim().max(255),
        matchValue: z.string().trim().max(500),
        // The people sharing this rule's leads. `validateRules` is what holds the shares to 100
        // and refuses the same person twice; this only says what shape may arrive.
        targets: z
          .array(z.object({
            employeeId: z.coerce.number().int().positive(),
            percent: z.coerce.number().int().min(1).max(100),
          }))
          .min(1)
          .max(20),
      }),
    )
    .max(100)
    .optional(),
});

const CREATE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS \`sales_google_sheet_link\` (
  \`id\` VARCHAR(191) NOT NULL,
  \`google_account_connection_id\` VARCHAR(191) NULL,
  \`system_table_name\` VARCHAR(191) NOT NULL,
  \`system_table_id\` VARCHAR(191) NOT NULL DEFAULT '',
  \`vertical\` VARCHAR(191) NOT NULL DEFAULT '',
  \`sheet_url\` VARCHAR(1000) NOT NULL,
  \`spreadsheet_id\` VARCHAR(191) NULL,
  \`spreadsheet_name\` VARCHAR(255) NULL,
  \`targeted_tab\` VARCHAR(191) NOT NULL,
  \`status\` VARCHAR(30) NOT NULL DEFAULT 'ACTIVE',
  \`created_by_user_id\` INT NULL,
  \`deleted_at\` DATETIME(3) NULL,
  \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  \`updated_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (\`id\`),
  INDEX \`sales_google_sheet_link_googleAccountConnectionId_idx\` (\`google_account_connection_id\`),
  INDEX \`sales_google_sheet_link_systemTableName_idx\` (\`system_table_name\`),
  INDEX \`sales_google_sheet_link_systemTableId_idx\` (\`system_table_id\`),
  INDEX \`sales_google_sheet_link_vertical_idx\` (\`vertical\`),
  INDEX \`sales_google_sheet_link_deletedAt_idx\` (\`deleted_at\`),
  INDEX \`sales_google_sheet_link_createdAt_idx\` (\`created_at\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;

function extractSpreadsheetId(sheetUrl) {
  const match = String(sheetUrl || "").match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/i);
  return match?.[1] || null;
}

function buildSheetUrl(spreadsheetId) {
  const id = String(spreadsheetId || "").trim();
  return id ? `https://docs.google.com/spreadsheets/d/${id}` : "";
}

function cleanData(data) {
  return Object.fromEntries(
    Object.entries(data).map(([key, value]) => [key, typeof value === "string" ? value.trim() : value]),
  );
}

async function ensureTableExists() {
  await prisma.$executeRawUnsafe(CREATE_TABLE_SQL);
  // The rules table alongside it, for the same reason this bootstrap exists at all: an environment
  // that has not run the migration must still be able to link a sheet and write rules for it.
  await ensureRulesTableExists();
  const columnRows = await prisma.$queryRawUnsafe(`
    SELECT column_name AS columnName
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'sales_google_sheet_link'
      AND column_name IN ('google_account_connection_id', 'system_table_id', 'vertical', 'spreadsheet_name', 'last_synced_at', 'last_sync_status', 'last_sync_summary')
  `);
  const existingColumns = new Set((Array.isArray(columnRows) ? columnRows : []).map((row) => String(row.columnName || row.COLUMN_NAME || "").trim()));
  if (!existingColumns.has("google_account_connection_id")) {
    await prisma.$executeRawUnsafe("ALTER TABLE `sales_google_sheet_link` ADD COLUMN `google_account_connection_id` VARCHAR(191) NULL");
  }
  if (!existingColumns.has("system_table_id")) {
    await prisma.$executeRawUnsafe("ALTER TABLE `sales_google_sheet_link` ADD COLUMN `system_table_id` VARCHAR(191) NOT NULL DEFAULT ''");
  }
  if (!existingColumns.has("vertical")) {
    await prisma.$executeRawUnsafe("ALTER TABLE `sales_google_sheet_link` ADD COLUMN `vertical` VARCHAR(191) NOT NULL DEFAULT ''");
  }
  if (!existingColumns.has("spreadsheet_name")) {
    await prisma.$executeRawUnsafe("ALTER TABLE `sales_google_sheet_link` ADD COLUMN `spreadsheet_name` VARCHAR(255) NULL");
  }
  if (!existingColumns.has("last_synced_at")) {
    await prisma.$executeRawUnsafe("ALTER TABLE `sales_google_sheet_link` ADD COLUMN `last_synced_at` DATETIME(3) NULL");
  }
  if (!existingColumns.has("last_sync_status")) {
    await prisma.$executeRawUnsafe("ALTER TABLE `sales_google_sheet_link` ADD COLUMN `last_sync_status` VARCHAR(30) NULL");
  }
  if (!existingColumns.has("last_sync_summary")) {
    await prisma.$executeRawUnsafe("ALTER TABLE `sales_google_sheet_link` ADD COLUMN `last_sync_summary` TEXT NULL");
  }
}

function extractGidFromUrl(sheetUrl) {
  const match = String(sheetUrl || "").match(/[?&#]gid=(\d+)/i);
  return match ? Number(match[1]) : null;
}

// Links created before Google OAuth existed have no googleAccountConnectionId and
// often no targetedTab, which made sync and preview permanently unusable. Adopt the
// caller's current connection and resolve the tab from the sheet URL's gid instead
// of rejecting the link outright.
async function adoptConnectionForLegacyLink(link, userId) {
  if (String(link.googleAccountConnectionId || "").trim() && String(link.targetedTab || "").trim()) return link;

  const connection = await getConnectionForUser(userId);
  if (!connection || connection.status !== "CONNECTED") {
    const error = new Error("Connect your Google account to sync this spreadsheet.");
    error.status = 400;
    throw error;
  }

  const spreadsheetId = String(link.spreadsheetId || extractSpreadsheetId(link.sheetUrl) || "").trim();
  if (!spreadsheetId) {
    const error = new Error("This link is missing a spreadsheet. Remove it and link the spreadsheet again.");
    error.status = 400;
    throw error;
  }

  let targetedTab = String(link.targetedTab || "").trim();
  let spreadsheetName = String(link.spreadsheetName || "").trim();
  if (!targetedTab || !spreadsheetName) {
    const details = await getSpreadsheetTabsForUser(userId, spreadsheetId);
    spreadsheetName = spreadsheetName || String(details.spreadsheetName || "");
    if (!targetedTab) {
      const gid = extractGidFromUrl(link.sheetUrl);
      const matched = gid !== null ? details.tabs.find((tab) => Number(tab.sheetId) === gid) : null;
      targetedTab = String((matched || details.tabs[0])?.title || "").trim();
    }
  }
  if (!targetedTab) {
    const error = new Error("The linked spreadsheet has no readable tab. Remove the link and add it again.");
    error.status = 400;
    throw error;
  }

  await prisma.$executeRawUnsafe(
    "UPDATE `sales_google_sheet_link` SET google_account_connection_id = ?, targeted_tab = ?, spreadsheet_id = ?, spreadsheet_name = ? WHERE id = ?",
    connection.id,
    targetedTab,
    spreadsheetId,
    spreadsheetName || spreadsheetId,
    link.id,
  );

  return {
    ...link,
    googleAccountConnectionId: connection.id,
    targetedTab,
    spreadsheetId,
    spreadsheetName: spreadsheetName || spreadsheetId,
    googleEmail: link.googleEmail || connection.googleEmail,
    googleDisplayName: link.googleDisplayName || connection.googleDisplayName || "",
    createdByUserId: link.createdByUserId ?? userId,
  };
}

// lastSyncSummary is stored as JSON text; a malformed value must not break the preview.
function parseSyncSummary(value) {
  if (!value) return null;
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function mapRow(row) {
  if (!row) return null;
  return {
    ...row,
    createdAt: row.createdAt ? new Date(row.createdAt) : null,
    updatedAt: row.updatedAt ? new Date(row.updatedAt) : null,
    deletedAt: row.deletedAt ? new Date(row.deletedAt) : null,
    lastSyncedAt: row.lastSyncedAt ? new Date(row.lastSyncedAt).toISOString() : null,
    lastSyncStatus: row.lastSyncStatus || null,
    lastSyncSummary: parseSyncSummary(row.lastSyncSummary),
  };
}

/**
 * Each link with its assignment rules attached.
 *
 * Read here rather than left to a call per link from the panel: the rules are part of what a link
 * *is* now - the Settings row shows how many there are, and Edit opens them - and a list of five
 * links would otherwise be six requests to draw one panel.
 */
async function withRules(links) {
  return Promise.all(
    links.map(async (link) => ({ ...link, assignmentRules: await listRulesForLink(link.id) })),
  );
}

async function list(req, res) {
  try {
    await ensureTableExists();
    const data = await prisma.$queryRawUnsafe(`
      SELECT
        id,
        google_account_connection_id AS googleAccountConnectionId,
        (SELECT google_email FROM sales_google_account_connection WHERE id = sales_google_sheet_link.google_account_connection_id LIMIT 1) AS googleEmail,
        (SELECT google_display_name FROM sales_google_account_connection WHERE id = sales_google_sheet_link.google_account_connection_id LIMIT 1) AS googleDisplayName,
        system_table_name AS systemTableName,
        system_table_id AS systemTableId,
        vertical,
        sheet_url AS sheetUrl,
        spreadsheet_id AS spreadsheetId,
        spreadsheet_name AS spreadsheetName,
        targeted_tab AS targetedTab,
        status,
        last_synced_at AS lastSyncedAt,
        last_sync_status AS lastSyncStatus,
        last_sync_summary AS lastSyncSummary,
        created_by_user_id AS createdByUserId,
        deleted_at AS deletedAt,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM \`sales_google_sheet_link\`
      WHERE deleted_at IS NULL
      ORDER BY created_at DESC
    `);
    return res.json({ data: await withRules(data.map(mapRow)) });
  } catch (error) {
    if (error?.code === "P2021") {
      try {
        await ensureTableExists();
        const data = await prisma.$queryRawUnsafe(`
          SELECT
            id,
            google_account_connection_id AS googleAccountConnectionId,
            (SELECT google_email FROM sales_google_account_connection WHERE id = sales_google_sheet_link.google_account_connection_id LIMIT 1) AS googleEmail,
            (SELECT google_display_name FROM sales_google_account_connection WHERE id = sales_google_sheet_link.google_account_connection_id LIMIT 1) AS googleDisplayName,
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
          ORDER BY created_at DESC
        `);
        return res.json({ data: await withRules(data.map(mapRow)) });
      } catch (retryError) {
        console.error("Unable to load Google Sheet links after table bootstrap:", retryError);
      }
    }
    console.error("Unable to load Google Sheet links:", error);
    return res.json({ data: [] });
  }
}

async function create(req, res) {
  const parsed = linkSchema.safeParse(cleanData(req.body));
  if (!parsed.success) return res.status(400).json({ message: "Validation failed", errors: parsed.error.flatten() });

  try {
    await ensureTableExists();
    const payload = parsed.data;
    const spreadsheetId = String(payload.spreadsheetId || extractSpreadsheetId(payload.sheetUrl) || "").trim();
    const spreadsheetName = String(payload.spreadsheetName || "").trim();
    let targetedTab = String(payload.targetedTab || "").trim();
    if (!spreadsheetId) {
      return res.status(400).json({ message: "Spreadsheet selection is required." });
    }

    const connection = await getConnectionForUser(req.user.id);
    if (!connection || connection.status !== "CONNECTED") {
      return res.status(400).json({ message: "Google connection expired. Please reconnect your Google account." });
    }

    if (!targetedTab) {
      return res.status(400).json({ message: "Targeted tab is required." });
    }

    // Refused before anything is written, so a bad rule cannot leave a linked sheet behind.
    const rules = validateRules(payload.assignmentRules || []);
    if (!rules.valid) {
      return res.status(400).json({ message: rules.issues[0], errors: { assignmentRules: rules.issues } });
    }

    const duplicate = await prisma.$queryRawUnsafe(
      `
      SELECT id
      FROM \`sales_google_sheet_link\`
      WHERE deleted_at IS NULL
        AND system_table_name = ?
        AND spreadsheet_id = ?
        AND targeted_tab = ?
      LIMIT 1
    `,
      payload.systemTableName,
      spreadsheetId,
      targetedTab,
    );
    if (duplicate?.length) {
      return res.status(409).json({
        code: "GOOGLE_SHEET_LINK_ALREADY_EXISTS",
        message: "This Google Sheet tab is already linked to CRM.",
      });
    }

    const id = randomUUID();
    const sheetUrl = payload.sheetUrl || buildSheetUrl(spreadsheetId);
    await prisma.$executeRawUnsafe(
      `
      INSERT INTO \`sales_google_sheet_link\`
        (\`id\`, \`google_account_connection_id\`, \`system_table_name\`, \`system_table_id\`, \`vertical\`, \`sheet_url\`, \`spreadsheet_id\`, \`spreadsheet_name\`, \`targeted_tab\`, \`status\`, \`created_by_user_id\`, \`deleted_at\`, \`created_at\`, \`updated_at\`)
      VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, NULL, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))
    `,
      id,
      connection.id,
      payload.systemTableName,
      payload.systemTableId || "",
      payload.vertical || "",
      sheetUrl,
      spreadsheetId,
      spreadsheetName || spreadsheetId,
      targetedTab,
      req.user?.id ?? null,
    );
    const created = await prisma.$queryRawUnsafe(
      `
      SELECT
        id,
        google_account_connection_id AS googleAccountConnectionId,
        (SELECT google_email FROM sales_google_account_connection WHERE id = sales_google_sheet_link.google_account_connection_id LIMIT 1) AS googleEmail,
        (SELECT google_display_name FROM sales_google_account_connection WHERE id = sales_google_sheet_link.google_account_connection_id LIMIT 1) AS googleDisplayName,
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
      WHERE id = ?
      LIMIT 1
      `,
      id,
      );
    const createdLink = mapRow(created?.[0]);
    /*
     * Saved before the first import, not after.
     *
     * Creating a link runs a full import immediately (below). Rules written afterwards would miss
     * every row of it - the studio would link a sheet, answer "who gets these", and watch the
     * whole first batch arrive unassigned anyway.
     */
    createdLink.assignmentRules = await replaceRulesForLink(id, rules.rules);
    let syncResult = null;
    let syncWarning = null;
    try {
      syncResult = await syncGoogleSheetLinkToCrm(createdLink);
    } catch (syncError) {
      // A sheet the connected account cannot read would be stored as a link that
      // silently imports nothing forever. Roll it back and report why instead.
      const status = syncError?.status || 0;
      if (status === 401 || status === 403 || status === 404) {
        await prisma.$executeRawUnsafe("DELETE FROM `sales_google_sheet_link` WHERE id = ?", id);
        await deleteRulesForLink(id);
        return res.status(status).json({
          code: syncError.code || undefined,
          message: syncError.message || "The linked spreadsheet could not be read.",
          reason: process.env.NODE_ENV === "production" ? undefined : syncError.reason,
        });
      }
      syncWarning = syncError?.message || "Initial import failed.";
      console.warn("Initial Google Sheet import skipped after link creation:", syncWarning);
    }
    return res.status(201).json({ data: createdLink, sync: syncResult ? syncResult.summary : null, warning: syncWarning });
  } catch (error) {
    console.error("Unable to save Google Sheet link:", error);
    if (error?.code === "GOOGLE_RECONNECT_REQUIRED") {
      return res.status(401).json({
        code: "GOOGLE_RECONNECT_REQUIRED",
        message: "Google authorization has expired. Please reconnect your Google account.",
      });
    }
    if (error?.status === 409) {
      return res.status(409).json({
        code: "GOOGLE_SHEET_LINK_ALREADY_EXISTS",
        message: "This Google Sheet tab is already linked to CRM.",
      });
    }
    return res.status(error?.status || 500).json({ message: error?.message || "Unable to save Google Sheet link." });
  }
}

const LINK_SELECT_SQL = `
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
    updated_at AS updatedAt,
    (SELECT google_email FROM sales_google_account_connection WHERE id = sales_google_sheet_link.google_account_connection_id LIMIT 1) AS googleEmail,
    (SELECT google_display_name FROM sales_google_account_connection WHERE id = sales_google_sheet_link.google_account_connection_id LIMIT 1) AS googleDisplayName
  FROM \`sales_google_sheet_link\`
  WHERE id = ? AND deleted_at IS NULL
  LIMIT 1
`;

// Same projection as LINK_SELECT_SQL, but for a row that is still soft-deleted - restore
// has to read it back before its deletedAt is cleared.
const DELETED_LINK_SELECT_SQL = LINK_SELECT_SQL.replace("deleted_at IS NULL", "deleted_at IS NOT NULL");

/**
 * Undoes a delete. Removing a link only stamps deletedAt, so putting one back is a matter
 * of clearing that stamp - the sheet, its tab and its target table are all still on the
 * row, and syncing resumes exactly where it left off.
 */
async function restore(req, res) {
  const id = String(req.params.id || "").trim();
  if (!id) return res.status(400).json({ message: "A Google Sheet link id is required." });

  try {
    await ensureTableExists();
    const deleted = await prisma.$queryRawUnsafe(DELETED_LINK_SELECT_SQL, id);
    if (!deleted?.length) {
      return res.status(404).json({ message: "That Google Sheet link is not available to restore." });
    }
    await prisma.$executeRawUnsafe("UPDATE `sales_google_sheet_link` SET deleted_at = NULL WHERE id = ?", id);
    const restored = await prisma.$queryRawUnsafe(LINK_SELECT_SQL, id);
    return res.json({ message: "Google Sheet link restored.", data: mapRow(restored?.[0]) });
  } catch (error) {
    console.error("Unable to restore Google Sheet link:", error);
    return res.status(500).json({ message: "Unable to restore the Google Sheet link." });
  }
}

async function update(req, res) {
  const parsed = linkSchema.partial().safeParse(cleanData(req.body));
  if (!parsed.success) return res.status(400).json({ message: "Validation failed", errors: parsed.error.flatten() });

  const id = String(req.params.id || "").trim();
  // Set once the rules have been replaced; see the note beside `previousRules` below.
  let restoreRules = null;
  try {
    await ensureTableExists();
    const [existing] = await prisma.$queryRawUnsafe(LINK_SELECT_SQL, id);
    if (!existing) return res.status(404).json({ message: "Google Sheet link not found." });
    if (String(existing.createdByUserId || "") && Number(existing.createdByUserId) !== Number(req.user.id)) {
      return res.status(403).json({ message: "You do not have access to this Google Sheet link." });
    }

    const payload = parsed.data;
    const sheetUrl = payload.sheetUrl !== undefined && payload.sheetUrl !== "" ? payload.sheetUrl : existing.sheetUrl;
    const spreadsheetId = String(payload.spreadsheetId || extractSpreadsheetId(sheetUrl) || existing.spreadsheetId || "").trim();
    const targetedTab = String(payload.targetedTab ?? existing.targetedTab ?? "").trim();
    if (!spreadsheetId) return res.status(400).json({ message: "Spreadsheet selection is required." });
    if (!targetedTab) return res.status(400).json({ message: "Targeted tab is required." });

    const duplicate = await prisma.$queryRawUnsafe(
      `
      SELECT id
      FROM \`sales_google_sheet_link\`
      WHERE deleted_at IS NULL
        AND id <> ?
        AND system_table_name = ?
        AND spreadsheet_id = ?
        AND targeted_tab = ?
      LIMIT 1
    `,
      id,
      payload.systemTableName || existing.systemTableName,
      spreadsheetId,
      targetedTab,
    );
    if (duplicate?.length) {
      return res.status(409).json({
        code: "GOOGLE_SHEET_LINK_ALREADY_EXISTS",
        message: "Another link already points at this Google Sheet tab.",
      });
    }

    // Refused before anything is written, the way create does it.
    const rules = payload.assignmentRules === undefined ? null : validateRules(payload.assignmentRules);
    if (rules && !rules.valid) {
      return res.status(400).json({ message: rules.issues[0], errors: { assignmentRules: rules.issues } });
    }
    /*
     * Written before the sync below, which is the whole reason the rules travel on the link's own
     * payload: `syncGoogleSheetLinkToCrm` reads them back out of the database, so an edit that
     * saved them afterwards would run one pass under the old rules. Rules left out of the payload
     * (`undefined`) are left alone - a partial update must not silently clear them.
     */
    /*
     * Kept, so a failed edit can be put back exactly as it was. Everything below this point can
     * throw - an unreadable tab, a revoked token - and the existing code deliberately reads the new
     * target *before* persisting so that a bad edit changes nothing. Rules written and left behind
     * would break that promise: the link would still point at the old sheet while assigning by the
     * new rules, which is a state nobody asked for and nothing reports.
     */
    const previousRules = rules ? await listRulesForLink(id) : null;
    if (rules) {
      await replaceRulesForLink(id, rules.rules);
      restoreRules = () => replaceRulesForLink(id, previousRules.map((rule) => ({
        columnHeader: rule.columnHeader,
        matchValue: rule.matchValue,
        targets: (rule.targets || []).map((target) => ({ employeeId: target.employeeId, percent: target.percent })),
      })));
    }

    // Read the new target before persisting, so a bad edit leaves the existing link
    // untouched rather than pointing it at a sheet that cannot be read.
    const candidate = await adoptConnectionForLegacyLink(
      {
        ...existing,
        sheetUrl: sheetUrl || buildSheetUrl(spreadsheetId),
        spreadsheetId,
        spreadsheetName: String(payload.spreadsheetName || existing.spreadsheetName || "").trim() || spreadsheetId,
        targetedTab,
        systemTableId: payload.systemTableId ?? existing.systemTableId ?? "",
        vertical: payload.vertical ?? existing.vertical ?? "",
      },
      req.user.id,
    );
    const syncResult = await syncGoogleSheetLinkToCrm(candidate);

    await prisma.$executeRawUnsafe(
      "UPDATE `sales_google_sheet_link` SET sheet_url = ?, spreadsheet_id = ?, spreadsheet_name = ?, targeted_tab = ?, system_table_id = ?, vertical = ?, google_account_connection_id = ? WHERE id = ?",
      candidate.sheetUrl,
      candidate.spreadsheetId,
      candidate.spreadsheetName,
      candidate.targetedTab,
      candidate.systemTableId || "",
      candidate.vertical || "",
      candidate.googleAccountConnectionId || null,
      id,
    );

    const [updated] = await prisma.$queryRawUnsafe(LINK_SELECT_SQL, id);
    return res.json({
      data: { ...mapRow(updated), assignmentRules: await listRulesForLink(id) },
      sync: syncResult ? syncResult.summary : null,
    });
  } catch (error) {
    console.error("Unable to update Google Sheet link:", error);
    // Put the rules back, so a refused edit leaves the link exactly as it was found.
    if (restoreRules) await restoreRules().catch((restoreError) => {
      console.error("Google Sheet link edit failed and its assignment rules could not be restored:", restoreError);
    });
    const status = error?.status || 500;
    if (error?.code === "GOOGLE_RECONNECT_REQUIRED" || status === 401) {
      return res.status(401).json({
        code: "GOOGLE_RECONNECT_REQUIRED",
        message: "Google authorization has expired. Please reconnect your Google account.",
        reason: process.env.NODE_ENV === "production" ? undefined : error.reason,
      });
    }
    return res.status(status).json({
      code: error?.code || undefined,
      message: error?.message || "Unable to update Google Sheet link.",
      reason: process.env.NODE_ENV === "production" ? undefined : error.reason,
    });
  }
}

/**
 * The leads a deleted link had imported, removed with it.
 *
 * Deleting a source deletes what it produced - a link left behind leads that nothing owned, and
 * re-linking the same sheet imported every one of them a second time. The spreadsheet itself is
 * never touched: this clears the CRM's copy only, so the same sheet can be linked again and
 * re-imported.
 *
 * Failing here must not leave the link half-deleted. The link is already gone by this point, so a
 * failure is reported as a count of zero and logged rather than thrown - the sync has stopped
 * either way, which is the part the user asked for first.
 */
async function removeLeadsForLink(link) {
  try {
    return await deleteCrmLeadsFromSheet({
      spreadsheetId: link?.spreadsheetId || extractSpreadsheetId(link?.sheetUrl) || "",
      gid: extractGidFromUrl(link?.sheetUrl) ?? "",
      targetTab: link?.targetedTab || "",
    });
  } catch (error) {
    console.error("Google Sheet link deleted, but its CRM leads could not be removed:", error.message);
    return 0;
  }
}

async function remove(req, res) {
  const { id } = req.params;
  try {
    await ensureTableExists();
    const existing = await prisma.$queryRawUnsafe(
      `
      SELECT id
      FROM \`sales_google_sheet_link\`
      WHERE id = ? AND deleted_at IS NULL
      LIMIT 1
    `,
      id,
    );
    if (!existing?.length) return res.status(404).json({ message: "Google Sheet link not found." });
    await prisma.$executeRawUnsafe(
      `
      UPDATE \`sales_google_sheet_link\`
      SET deleted_at = CURRENT_TIMESTAMP(3)
      WHERE id = ?
    `,
      id,
    );
    const deletedLeads = await removeLeadsForLink(existing[0]);
    const updated = await prisma.$queryRawUnsafe(
      `
      SELECT
        id,
        google_account_connection_id AS googleAccountConnectionId,
        (SELECT google_email FROM sales_google_account_connection WHERE id = sales_google_sheet_link.google_account_connection_id LIMIT 1) AS googleEmail,
        (SELECT google_display_name FROM sales_google_account_connection WHERE id = sales_google_sheet_link.google_account_connection_id LIMIT 1) AS googleDisplayName,
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
      WHERE id = ?
      LIMIT 1
    `,
      id,
    );
    return res.json({ data: mapRow(updated?.[0]), deletedLeads });
  } catch (error) {
    if (error?.code === "P2021") {
      try {
        await ensureTableExists();
        const existing = await prisma.$queryRawUnsafe(
          `
          SELECT id
          FROM \`sales_google_sheet_link\`
          WHERE id = ? AND deleted_at IS NULL
          LIMIT 1
        `,
          id,
        );
        if (!existing?.length) return res.status(404).json({ message: "Google Sheet link not found." });
        await prisma.$executeRawUnsafe(
          `
          UPDATE \`sales_google_sheet_link\`
          SET deleted_at = CURRENT_TIMESTAMP(3)
          WHERE id = ?
        `,
          id,
        );
        const deletedLeads = await removeLeadsForLink(existing[0]);
        const updated = await prisma.$queryRawUnsafe(
          `
          SELECT
            id,
            google_account_connection_id AS googleAccountConnectionId,
            (SELECT google_email FROM sales_google_account_connection WHERE id = sales_google_sheet_link.google_account_connection_id LIMIT 1) AS googleEmail,
            (SELECT google_display_name FROM sales_google_account_connection WHERE id = sales_google_sheet_link.google_account_connection_id LIMIT 1) AS googleDisplayName,
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
          WHERE id = ?
          LIMIT 1
        `,
          id,
        );
        return res.json({ data: mapRow(updated?.[0]), deletedLeads });
      } catch (retryError) {
        console.error("Unable to remove Google Sheet link after table bootstrap:", retryError);
      }
    }
    console.error("Unable to remove Google Sheet link:", error);
    return res.status(500).json({ message: "Unable to remove Google Sheet link." });
  }
}

async function sync(req, res) {
  try {
    await ensureTableExists();
    const [link] = await prisma.$queryRawUnsafe(
      `
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
        last_synced_at AS lastSyncedAt,
        last_sync_status AS lastSyncStatus,
        last_sync_summary AS lastSyncSummary,
        created_by_user_id AS createdByUserId,
        deleted_at AS deletedAt,
        created_at AS createdAt,
        updated_at AS updatedAt,
        (SELECT google_email FROM sales_google_account_connection WHERE id = sales_google_sheet_link.google_account_connection_id LIMIT 1) AS googleEmail,
        (SELECT google_display_name FROM sales_google_account_connection WHERE id = sales_google_sheet_link.google_account_connection_id LIMIT 1) AS googleDisplayName
      FROM \`sales_google_sheet_link\`
      WHERE id = ? AND deleted_at IS NULL
      LIMIT 1
    `,
      String(req.params.id || "").trim(),
    );
    if (!link) {
      return res.status(404).json({ message: "Google Sheet link not found." });
    }
    if (String(link.createdByUserId || "") && Number(link.createdByUserId) !== Number(req.user.id)) {
      return res.status(403).json({ message: "You do not have access to this Google Sheet link." });
    }
    const syncableLink = await adoptConnectionForLegacyLink(link, req.user.id);
    const result = await syncGoogleSheetLinkToCrm(syncableLink);
    return res.json({ data: result });
  } catch (error) {
    console.error("Unable to sync Google Sheet link:", error);
    const status = error.status || 500;
    const message = error.message || "Unable to sync Google Sheet link.";
    if (error.code === "GOOGLE_RECONNECT_REQUIRED" || status === 401) {
      return res.status(401).json({
        code: "GOOGLE_RECONNECT_REQUIRED",
        message: "Google authorization has expired. Please reconnect your Google account.",
        reason: process.env.NODE_ENV === "production" ? undefined : error.reason,
      });
    }
    return res.status(status).json({
      code: error.code || undefined,
      message,
      reason: process.env.NODE_ENV === "production" ? undefined : error.reason,
    });
  }
}

async function preview(req, res) {
  try {
    await ensureTableExists();
    const [link] = await prisma.$queryRawUnsafe(
      `
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
        last_synced_at AS lastSyncedAt,
        last_sync_status AS lastSyncStatus,
        last_sync_summary AS lastSyncSummary,
        created_by_user_id AS createdByUserId,
        deleted_at AS deletedAt,
        created_at AS createdAt,
        updated_at AS updatedAt,
        (SELECT google_email FROM sales_google_account_connection WHERE id = sales_google_sheet_link.google_account_connection_id LIMIT 1) AS googleEmail,
        (SELECT google_display_name FROM sales_google_account_connection WHERE id = sales_google_sheet_link.google_account_connection_id LIMIT 1) AS googleDisplayName
      FROM \`sales_google_sheet_link\`
      WHERE id = ? AND deleted_at IS NULL
      LIMIT 1
    `,
      String(req.params.id || "").trim(),
    );
    if (!link) {
      return res.status(404).json({ message: "Google Sheet link not found." });
    }
    if (String(link.createdByUserId || "") && Number(link.createdByUserId) !== Number(req.user.id)) {
      return res.status(403).json({ message: "You do not have access to this Google Sheet link." });
    }
    const previewableLink = await adoptConnectionForLegacyLink(link, req.user.id);
    const previewData = await prepareGoogleSheetCrmImport(previewableLink);
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
          // When this sheet was last read, and how that run went.
          lastSyncedAt: link.lastSyncedAt ? new Date(link.lastSyncedAt).toISOString() : null,
          lastSyncStatus: link.lastSyncStatus || null,
          lastSyncSummary: parseSyncSummary(link.lastSyncSummary),
        },
        mapping: previewData.mapping,
        // The sheet's own column headings, so the assignment-rule editor can offer what the sheet
        // actually has. A rule typed against a heading that does not exist never fires, and a rule
        // that never fires looks exactly like no rule at all.
        headers: previewData.headers,
        summary: previewData.summary,
        // What the assignment rules would do to this sheet, before a single lead is written. The
        // per-row `assignment` on each row below says which rule fired; this says whether any of
        // them can fire at all - a rule naming a column the sheet no longer has is listed here.
        assignment: previewData.assignment,
        assignmentRules: await listRulesForLink(link.id),
        rows,
        previewTruncated: rows.length < (previewData.rows || []).length,
      },
    });
  } catch (error) {
    console.error("Unable to prepare Google Sheet import preview:", error);
    return res.status(error.status || 500).json({ message: error.message || "Unable to prepare Google Sheet import preview." });
  }
}

/**
 * Who a rule may assign leads to: the Sales department's active employees.
 *
 * The same roster the CRM board's own Assign To offers, served from here rather than reused from
 * `GET /api/sales/crm-employees` - that one answers to `REGISTER_READERS`, which `SALES / CRM
 * Leads` is not one of. A person who may link a sheet would have been shown an employee picker
 * that 403s, which is the trap IAM.md names: a screen must not depend on an endpoint its viewer
 * cannot reach.
 *
 * Names, because that is what the rule writes: the lead's `crm` column holds an employee's name
 * and the board's picker is built from names (`crmOptionsFrom`).
 */
async function assignableEmployees(req, res) {
  try {
    const data = await salesEmployees({ select: { id: true, employeeId: true, employeeName: true, designation: true } });
    return res.json({ data });
  } catch (error) {
    console.error("Unable to load the employees a sheet rule may assign to:", error);
    return res.status(500).json({ message: "Unable to load the employee list." });
  }
}

module.exports = { list, create, update, remove, restore, sync, preview, assignableEmployees };
