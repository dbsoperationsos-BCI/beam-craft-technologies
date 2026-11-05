const prisma = require("../../../config/db");
const { studioClockTime, studioDateKey } = require("../../../services/studioTime");
const { normalizeDateText } = require("./leadDates");
const { verticalFromValue } = require("./callRouting");
const sheets = require("./googleSheetsService");
const { diffLeadColumns, recordLeadActivity, recordBulkActivity } = require("./activityService");
const { notifyLeadAssigned, notifyLeadsAssigned } = require("./leadNotifications");
let sheetsUnavailable = false;
const crmLeadListOrder = { enquiryId: "asc" };
const { CRM_LEAD_COLUMN_PAIRS, REFERENCE_COLUMNS, DB_COLUMN } = require("./crmLeadColumns");
const { lookups: referenceLookups } = require("../../../services/referenceMatchers");
const { nextIdentifier } = require("../../../services/identifiers");
const {
  occasionContextFor,
  occasionFieldsFor,
  occasionFieldsFromRow,
  occasionsBeingWorked,
  OCCASIONS,
  writeOccurrence,
  writeOccurrences,
} = require("./occasionLeadService");

const CRM_LEAD_SQL_COLUMNS = CRM_LEAD_COLUMN_PAIRS.map(([codeName]) => codeName);
const CRM_LEAD_SELECT_COLUMNS = ["enquiryId", ...CRM_LEAD_SQL_COLUMNS, "deletedAt", "createdAt", "updatedAt"];
// Every SELECT aliases the database column back to the name the code reads, so `toRecord` and
// everything downstream keep working on camelCase keys.
/*
 * The three names a lead carries as text beside a reference are read through the reference, with
 * the text as the fallback - the same rule `services/resolvedNames.js` applies to every Prisma read,
 * written here in SQL because these queries are raw. Correlated on the primary key of a six-row and
 * a twenty-row table, so it costs nothing a board page would notice; and every query using this
 * list reads `FROM \`sales_crm_lead\`` unaliased, which is what the qualified columns rely on.
 */
const RESOLVED_LEAD_SQL = {
  assignedBranch: "COALESCE((SELECT `b`.`name` FROM `branch` AS `b` WHERE `b`.`id` = `sales_crm_lead`.`branch_id`), `assigned_branch`)",
  crm: "COALESCE((SELECT `e`.`employee_name` FROM `employee` AS `e` WHERE `e`.`id` = `sales_crm_lead`.`owner_employee_id`), `crm`)",
  vertical: "COALESCE((SELECT `v`.`name` FROM `vertical` AS `v` WHERE `v`.`id` = `sales_crm_lead`.`vertical_id`), `vertical`)",
};
const leadColumnSql = (column) => `${RESOLVED_LEAD_SQL[column] || `\`${DB_COLUMN[column]}\``} AS \`${column}\``;
const CRM_LEAD_SELECT_LIST = [...CRM_LEAD_SELECT_COLUMNS, ...REFERENCE_COLUMNS].map(leadColumnSql).join(", ");

function crmWebhookUrl() {
  return process.env.CRM_WEBHOOK_URL || process.env.CRM_LEADS_WEBHOOK_URL || "";
}

function isSheetsAuthError(error) {
  const message = String(error?.message || "").toLowerCase();
  return message.includes("invalid_grant") || message.includes("account not found") || message.includes("unauthorized_client") || message.includes("invalid client") || message.includes("invalid credentials");
}

function normalizeColumnValue(value) {
  return value === undefined || value === null ? null : String(value);
}

/**
 * Whether every project raised against this lead is in Resource Management → Recycling Bin - at least
 * one, and none live. Such a lead **reads** "Project deleted" (`PROJECT_DELETED_STATUS`) on the board,
 * in its tabs, counts and filters, while its stored status is left exactly as it was: Restore brings
 * the project back and the lead reads its own status again with nothing rewritten. Not a status anybody
 * can choose. Written against the unaliased `sales_crm_lead`, as every lead query here is.
 */
const PROJECT_DELETED_STATUS = "Project deleted";
const PROJECT_DELETED_SQL = "(EXISTS (SELECT 1 FROM `sales_project` AS `bin_project` WHERE `bin_project`.`enquiry_id` = `sales_crm_lead`.`enquiry_id` AND `bin_project`.`deleted_at` IS NOT NULL)"
  + " AND NOT EXISTS (SELECT 1 FROM `sales_project` AS `live_project` WHERE `live_project`.`enquiry_id` = `sales_crm_lead`.`enquiry_id` AND `live_project`.`deleted_at` IS NULL))";

function extractLeadFromRow(row = {}) {
  return {
    id: String(row.enquiryId || ""),
    // See `PROJECT_DELETED_SQL`; read only where the query selected it.
    ...(row.projectDeleted !== undefined ? { projectDeleted: Boolean(Number(row.projectDeleted)) } : {}),
    name: row.name || "",
    phone: row.phone || "",
    whatsappNumber: row.whatsappNumber || "",
    vertical: row.vertical || "",
    // The references the scope narrows by, read with the lead so one record can be checked against
    // the same columns the list is filtered on. Null until the text beside them names something.
    branchId: row.branchId ?? null,
    verticalId: row.verticalId ?? null,
    ownerEmployeeId: row.ownerEmployeeId ?? null,
    status: row.status || "",
    crm: row.crm || "",
    addedTime: row.addedTime || "",
    createdDate: row.createdDate || "",
    relationship: row.relationship || "",
    referredFrom: row.referredFrom || "",
    offerType: row.offerType || "",
    campaignName: row.campaignName || "",
    adsetName: row.adsetName || "",
    adName: row.adName || "",
    preferredBudget: row.preferredBudget || "",
    estimatedValue: row.estimatedValue || "",
    city: row.city || "",
    state: row.state || "",
    source: row.source || "",
    assignedBranch: row.assignedBranch || "",
    eventPlannedType: row.eventPlannedType || "",
    eventPlannedDate: row.eventPlannedDate || "",
    groomName: row.groomName || "",
    groomContact: row.groomContact || "",
    groomLocation: row.groomLocation || "",
    brideName: row.brideName || "",
    brideContact: row.brideContact || "",
    brideLocation: row.brideLocation || "",
    referenceName: row.referenceName || "",
    referenceContact: row.referenceContact || "",
    remarks: row.remarks || "",
    attachments: parseJsonArray(row.attachments),
    contactRepeated: row.contactRepeated || "",
    shootType: row.shootType || "",
    location: row.location || "",
    ihOh: row.ihOh || "",
    lastFollowUpDate: row.lastFollowUpDate || "",
    nextFollowUpDate: row.nextFollowUpDate || "",
    lastConvertedDate: row.lastConvertedDate || "",
    shootId: row.shootId || "",
    date: row.date || "",
    babyOrMotherName: row.babyOrMotherName || "",
    dateOfBirthOrEdod: row.dateOfBirthOrEdod || "",
    companyName: row.companyName || "",
    primaryDecisionMaker: row.primaryDecisionMaker || "",
    designation: row.designation || "",
    contactNumber: row.contactNumber || "",
    alternateMobileNumber: row.alternateMobileNumber || "",
    officialEmailId: row.officialEmailId || "",
    companyWebsite: row.companyWebsite || "",
    companyType: row.companyType || "",
    companySize: row.companySize || "",
    branches: row.branches || "",
    projectType: row.projectType || "",
    shootCity: row.shootCity || "",
    expectedBudget: row.expectedBudget || "",
    competitions: row.competitions || "",
    // The row's own insert timestamp - the only record of when a lead actually arrived. The
    // free-text `addedTime` column holds whatever its source wrote there, which for most
    // rows is a date or nothing at all.
    createdAt: row.createdAt || "",
  };
}

function extractDetailsFromRow(row = {}) {
  return {
    // Where the row came from, as far as the stored columns can say. This used to answer
    // "google-sheets" for every lead whatever it was - harmless only while nothing read it, and
    // wrong the moment something did: a hand-entered lead read back as a sheet import. The
    // spreadsheet columns are the only evidence that survives a save, so they are what answers.
    groupType: row.spreadsheetId ? "google-sheets" : "",
    groupName: row.targetTab || (row.spreadsheetId ? "Google sheet integration" : ""),
    groupId: row.gid || "",
    importedFrom: row.spreadsheetId ? `https://docs.google.com/spreadsheets/d/${row.spreadsheetId}` : "",
    spreadsheetId: row.spreadsheetId || "",
    gid: row.gid || "",
    targetTab: row.targetTab || "",
    targetedTab: row.targetTab || "",
    systemTableId: row.systemTableId || "",
    vertical: row.vertical || "",
    sourceEnquiryId: row.sourceEnquiryId || row.enquiryId || "",
    sourceRowNumber: row.sourceRowNumber || "",
    lastSourceSyncAt: row.lastSourceSyncAt || "",
    leadStatus: row.status || "",
    remarks: row.remarks || "",
    attachments: parseJsonArray(row.attachments),
    lastFollowUpDate: row.lastFollowUpDate || "",
    nextFollowUpDate: row.nextFollowUpDate || "",
    nextFollowUpTime: row.nextFollowUpTime || "",
    lastConvertedDate: row.lastConvertedDate || "",
    // Held as text like every other column on this table, but read back as the number it is
    // so the CRM can add one to it without string-concatenating "5" + 1 into "51".
    cnaSequence: Number(row.cnaSequence) > 0 ? Number(row.cnaSequence) : 0,
    shoots: parseJsonArray(row.shoots),
    remarkEntries: parseJsonArray(row.remarkEntries),
    /*
     * The occasion this Qua Qua lead is currently being worked for: a newborn shoot around the
     * estimated delivery date, or the child's next birthday.
     *
     * Beside the lead's own status rather than folded over it, and that is the whole point: the
     * lead's `status` is the record of the last shoot and must survive an occasion being worked, so
     * a screen that reads a lead and saves it back can never write this call's status into it. The
     * board and the panel prefer these when `occasionWindow` is set - see `resolveLeadStatus` in
     * CRMPage.js - and the write path sends a status back to the same occurrence it came from.
     *
     * Absent on a row the board query did not select them for, which is every board but Qua Qua;
     * `occasionFieldsFromRow` answers the "no occasion" shape for those rather than nothing, so the
     * keys are always there to be merged over.
     */
    ...occasionFieldsFromRow(row),
    // Spread as well as named: the table cell and info panel look a custom value up by its
    // own key alongside the built-in fields, and the keys are kebab-case so they cannot
    // collide with the camelCase names above.
    ...parseJsonObject(row.customFields),
    customFields: parseJsonObject(row.customFields),
  };
}

function toRecord(row) {
  return { lead: extractLeadFromRow(row), details: extractDetailsFromRow(row) };
}

/**
 * A date column, written as `YYYY-MM-DD` whatever shape it arrived in.
 *
 * Every insert and update in this module goes through `flattenLeadColumns`, so folding the dates
 * here is what makes the stored value canonical for **all** of them at once - Add Lead, Import
 * Leads, the CSV import, the Google Sheet sync, and the API.
 *
 * That matters more than a tidy column, because three of these are read by **stored generated
 * columns** - `created_day`, `follow_up_day` and `dob_edod_day` - whose expression lives in the
 * schema and understands ISO and `DD/MM/YYYY` and nothing else. A CSV exported from Excel writes
 * `09-Sep-26`, so all three came out NULL: the lead was in no Today or Yesterday Pending tab, in
 * neither Newborns nor Birthdays, and its Enquiry Date cell fell through to the row's insert
 * timestamp and printed today. Normalising on the way in means the schema's own rule never sees a
 * shape it cannot read, without a migration that would rebuild the table to widen it.
 *
 * Anything that is not a date is written through untouched. A cell holding a note, a dash or a
 * half-typed date is kept exactly as its author left it - this canonicalises dates, it does not
 * discard what it fails to understand.
 */
/*
 * The statuses that end the conversation, and therefore carry no next call.
 *
 * A lead turned down or written off is not being chased, so a Next Followup Date on it is a call
 * nobody is going to make - and the Pending Followups tabs read that date, so the lead turns up on
 * somebody's worklist under a status that says the conversation is over.
 *
 * Enforced here rather than trusted to the screen. The form clears both fields when one of these is
 * chosen and has done for a while, but it is one of several ways a status is written - the bulk
 * dialog, the record panel, the sheet import and the CSV import all reach the same columns - and a
 * rule kept in the form is a rule each of those has to remember separately. This is the single
 * object every INSERT and UPDATE takes its values from, so stating it here covers all of them.
 *
 * **Converted ends it too, on Dum Dum and Corp only.** A wedding or corporate client who has booked
 * is done being chased. A Qua Qua client is not - the same family comes back for the newborn, the
 * birthday, the next shoot - so a Converted Qua Qua lead keeps whatever next follow-up it was given
 * (none is demanded) and is counted on the pending tabs like any other. "Converted & Followup" is
 * not on the list anywhere. A lead moved to Converted gets the day as its Last Followup Date on
 * every vertical - see `CONVERTED_STATUS` below.
 *
 * Qua Qua is recognised the way `board_key` recognises it (`leadQueryService.js`), so this rule and
 * the board the lead sits on cannot disagree. Mirrored in `dropsNextFollowUp` in
 * frontend/src/components/sales/CRMPage.js, which takes the fields off the form. That one is what
 * the user sees; this one is what is true.
 */
const STATUSES_WITHOUT_FOLLOW_UP = ["Invalid", "Rejected"];

const sameStatus = (a, b) => String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
const isQuaQuaVertical = (vertical) => String(vertical || "").trim().replace(/ /g, "").toLowerCase() === "quaqua";

const endsTheConversation = (status, vertical) => STATUSES_WITHOUT_FOLLOW_UP.some((ended) => sameStatus(ended, status))
  || (sameStatus(status, "Converted") && !isQuaQuaVertical(vertical));

function normalizeDateColumn(value) {
  return normalizeColumnValue(normalizeDateText(value));
}

function flattenLeadColumns(record) {
  const lead = record?.lead || {};
  const details = record?.details || {};
  return {
    name: normalizeColumnValue(lead.name),
    phone: normalizeColumnValue(lead.phone),
    /*
     * Written as well as read.
     *
     * `whatsappNumber` has been a column and a field on the form since it was added, and
     * `extractLeadFromRow` reads it back - but it was never listed here, and this is the object the
     * INSERT and UPDATE take their values from. So every WhatsApp Number anybody typed was bound as
     * `undefined` and lost on save, silently, while the field itself looked like it worked.
     */
    whatsappNumber: normalizeColumnValue(lead.whatsappNumber),
    vertical: normalizeColumnValue(lead.vertical),
    status: normalizeColumnValue(details.leadStatus || lead.status),
    crm: normalizeColumnValue(lead.crm),
    addedTime: normalizeColumnValue(lead.addedTime),
    createdDate: normalizeDateColumn(lead.createdDate),
    relationship: normalizeColumnValue(lead.relationship),
    referredFrom: normalizeColumnValue(lead.referredFrom),
    offerType: normalizeColumnValue(lead.offerType),
    campaignName: normalizeColumnValue(lead.campaignName),
    adsetName: normalizeColumnValue(lead.adsetName),
    adName: normalizeColumnValue(lead.adName),
    preferredBudget: normalizeColumnValue(lead.preferredBudget),
    estimatedValue: normalizeColumnValue(lead.estimatedValue),
    city: normalizeColumnValue(lead.city),
    state: normalizeColumnValue(lead.state),
    source: normalizeColumnValue(lead.source),
    assignedBranch: normalizeColumnValue(lead.assignedBranch),
    eventPlannedType: normalizeColumnValue(lead.eventPlannedType),
    eventPlannedDate: normalizeDateColumn(lead.eventPlannedDate),
    groomName: normalizeColumnValue(lead.groomName),
    groomContact: normalizeColumnValue(lead.groomContact),
    groomLocation: normalizeColumnValue(lead.groomLocation),
    brideName: normalizeColumnValue(lead.brideName),
    brideContact: normalizeColumnValue(lead.brideContact),
    brideLocation: normalizeColumnValue(lead.brideLocation),
    referenceName: normalizeColumnValue(lead.referenceName),
    referenceContact: normalizeColumnValue(lead.referenceContact),
    attachments: normalizeColumnValue(JSON.stringify(details.attachments || lead.attachments || [])),
    contactRepeated: normalizeColumnValue(lead.contactRepeated),
    shootType: normalizeColumnValue(lead.shootType),
    location: normalizeColumnValue(lead.location),
    ihOh: normalizeColumnValue(lead.ihOh),
    lastFollowUpDate: normalizeDateColumn(details.lastFollowUpDate || lead.lastFollowUpDate),
    /*
     * NULL on a lead nobody is chasing, whatever the form sent.
     *
     * `null` and not `""`: the column is a date and the tabs read `follow_up_day`, the generated
     * fold of it, so an empty string is a date that could not be parsed rather than a date that was
     * never set. The pending tabs list every lead whose follow-up date falls on their day,
     * whatever its status, so a lead nobody is chasing has to have no date at all.
     */
    nextFollowUpDate: endsTheConversation(details.leadStatus || lead.status, lead.vertical)
      ? null
      : normalizeDateColumn(details.nextFollowUpDate || lead.nextFollowUpDate),
    lastConvertedDate: normalizeDateColumn(details.lastConvertedDate || lead.lastConvertedDate),
    // `??` rather than `||`, so a count of 0 is written as 0 instead of falling through to
    // the lead's copy and back to null.
    cnaSequence: normalizeColumnValue(details.cnaSequence ?? lead.cnaSequence),
    // The time goes with the date: half a booking is not a booking.
    nextFollowUpTime: endsTheConversation(details.leadStatus || lead.status, lead.vertical)
      ? null
      : normalizeColumnValue(details.nextFollowUpTime || lead.nextFollowUpTime),
    shoots: serializeJsonArray(details.shoots),
    remarkEntries: serializeJsonArray(details.remarkEntries),
    customFields: JSON.stringify(collectCustomFieldValues(record)),
    shootId: normalizeColumnValue(lead.shootId),
    date: normalizeDateColumn(lead.date),
    babyOrMotherName: normalizeColumnValue(lead.babyOrMotherName),
    dateOfBirthOrEdod: normalizeDateColumn(lead.dateOfBirthOrEdod),
    companyName: normalizeColumnValue(lead.companyName),
    primaryDecisionMaker: normalizeColumnValue(lead.primaryDecisionMaker),
    designation: normalizeColumnValue(lead.designation),
    contactNumber: normalizeColumnValue(lead.contactNumber),
    alternateMobileNumber: normalizeColumnValue(lead.alternateMobileNumber),
    officialEmailId: normalizeColumnValue(lead.officialEmailId),
    companyWebsite: normalizeColumnValue(lead.companyWebsite),
    companyType: normalizeColumnValue(lead.companyType),
    companySize: normalizeColumnValue(lead.companySize),
    branches: normalizeColumnValue(lead.branches),
    projectType: normalizeColumnValue(lead.projectType),
    shootCity: normalizeColumnValue(lead.shootCity),
    expectedBudget: normalizeColumnValue(lead.expectedBudget),
    competitions: normalizeColumnValue(lead.competitions),
    remarks: normalizeColumnValue(details.remarks || lead.remarks),
    sourceEnquiryId: normalizeColumnValue(details.sourceEnquiryId),
    sourceRowNumber: normalizeColumnValue(details.sourceRowNumber),
    spreadsheetId: normalizeColumnValue(details.spreadsheetId),
    gid: normalizeColumnValue(details.gid),
    targetTab: normalizeColumnValue(details.targetTab || details.targetedTab),
    systemTableId: normalizeColumnValue(details.systemTableId),
    lastSourceSyncAt: normalizeColumnValue(details.lastSourceSyncAt),
  };
}

let crmLeadColumnsReady = null;

// Reads information_schema and may issue DDL, so it is far too expensive to repeat for
// every request - a CSV import alone would run it once per chunk. The table cannot change
// shape under a running process, so the first successful check is reused. A failed check
// is not cached, so a transient database error is retried on the next call.
async function ensureCrmLeadColumns() {
  if (!crmLeadColumnsReady) {
    crmLeadColumnsReady = ensureCrmLeadColumnsNow().catch((error) => {
      crmLeadColumnsReady = null;
      throw error;
    });
  }
  return crmLeadColumnsReady;
}

async function ensureCrmLeadColumnsNow() {
  const existingColumns = await prisma.$queryRawUnsafe(`
    SELECT column_name AS columnName
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'sales_crm_lead'
  `);
  const existing = new Set((Array.isArray(existingColumns) ? existingColumns : []).map((row) => String(row.columnName || row.COLUMN_NAME || "").trim()));
  for (const column of CRM_LEAD_SQL_COLUMNS) {
    if (existing.has(DB_COLUMN[column])) continue;
    await prisma.$executeRawUnsafe(`ALTER TABLE \`sales_crm_lead\` ADD COLUMN \`${DB_COLUMN[column]}\` TEXT NULL`);
  }
  if (existing.has("created_at")) {
    await prisma.$executeRawUnsafe("ALTER TABLE `sales_crm_lead` MODIFY COLUMN `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)");
  }
  if (existing.has("updated_at")) {
    await prisma.$executeRawUnsafe("ALTER TABLE `sales_crm_lead` MODIFY COLUMN `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)");
  }
}

// Arrays are persisted as JSON text. Null rather than "[]" for empty, so an untouched
// lead is not rewritten on every sync.
function serializeJsonArray(value) {
  if (!Array.isArray(value) || value.length === 0) return null;
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

function parseJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// A lead's answers to the Table Settings fields, as a plain object. Anything else stored in
// the column - an array, a bare string, malformed JSON - reads as "no answers" rather than
// throwing, since one bad row must not take out the whole lead list.
function parseJsonObject(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value !== "string" || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * The custom field answers to write for a lead.
 *
 * Two shapes reach here. Add Lead and the table settings-aware editors send the whole object
 * as `details.customFields`. An editor that changes one field in place - the info panel does
 * this - sets it at the top level of `details` under the field's own key instead, so a key
 * already known to the lead takes the newer top-level value when one is present.
 */
function collectCustomFieldValues(record) {
  const details = record?.details || {};
  const stored = parseJsonObject(details.customFields ?? record?.lead?.customFields);
  const merged = { ...stored };
  for (const key of Object.keys(stored)) {
    if (Object.prototype.hasOwnProperty.call(details, key)) merged[key] = details[key];
  }
  return merged;
}

async function ensureCrmLeadLegacyColumnsRemoved() {
  const columns = await prisma.$queryRawUnsafe(`
    SELECT column_name AS columnName
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'sales_crm_lead'
  `);
  const existing = new Set((Array.isArray(columns) ? columns : []).map((row) => String(row.columnName || row.COLUMN_NAME || "").trim()));
  if (existing.has("leadJson")) {
    await prisma.$executeRawUnsafe("ALTER TABLE `sales_crm_lead` DROP COLUMN `leadJson`");
  }
  if (existing.has("detailsJson")) {
    await prisma.$executeRawUnsafe("ALTER TABLE `sales_crm_lead` DROP COLUMN `detailsJson`");
  }
}

async function backfillCrmLeadFlatColumnsFromLegacyJson() {
  const columns = await prisma.$queryRawUnsafe(`
    SELECT column_name AS columnName
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'sales_crm_lead'
  `);
  const existing = new Set((Array.isArray(columns) ? columns : []).map((row) => String(row.columnName || row.COLUMN_NAME || "").trim()));
  if (!existing.has("leadJson") || !existing.has("detailsJson")) {
    return false;
  }
  const rows = await prisma.$queryRawUnsafe(`
    SELECT \`enquiry_id\`, \`leadJson\`, \`detailsJson\`
    FROM \`sales_crm_lead\`
  `);
  if (!Array.isArray(rows) || !rows.length) return;
  for (const row of rows) {
    const lead = typeof row.leadJson === "string" ? JSON.parse(row.leadJson || "{}") : (row.leadJson || {});
    const details = typeof row.detailsJson === "string" ? JSON.parse(row.detailsJson || "{}") : (row.detailsJson || {});
    const record = { lead: { ...(lead || {}), id: row.enquiryId }, details: details || {} };
    const flattened = flattenLeadColumns(record);
    const detailValues = {
      ...flattened,
      sourceEnquiryId: normalizeColumnValue(details.sourceEnquiryId || lead.id || row.enquiryId),
      sourceRowNumber: normalizeColumnValue(details.sourceRowNumber),
      spreadsheetId: normalizeColumnValue(details.spreadsheetId),
      gid: normalizeColumnValue(details.gid),
      targetTab: normalizeColumnValue(details.targetTab || details.targetedTab),
      systemTableId: normalizeColumnValue(details.systemTableId),
      lastSourceSyncAt: normalizeColumnValue(details.lastSourceSyncAt),
    };
    const entries = Object.entries(detailValues);
    const setClause = entries.map(([key]) => `\`${DB_COLUMN[key]}\` = ?`).join(", ");
    const values = entries.map(([, value]) => value);
    await prisma.$executeRawUnsafe(`UPDATE \`sales_crm_lead\` SET ${setClause} WHERE \`enquiry_id\` = ?`, ...values, row.enquiryId);
  }
  return true;
}

async function migrateCrmLeadLegacyColumns() {
  await ensureCrmLeadColumns();
  const backfilled = await backfillCrmLeadFlatColumnsFromLegacyJson();
  if (backfilled) {
    await ensureCrmLeadLegacyColumnsRemoved();
  }
}

async function syncCrmLeadColumns(record, { only = null } = {}) {
  const columns = flattenLeadColumns(record);
  /*
   * The branch, written the way the branch table writes it, before anything is stored.
   *
   * The pickers in Add Lead and the lead popup are built from that table, so a lead holding
   * anything else - "Erode" for "Erode TN" - shows an Assigned Branch that matches no option on the
   * screen it is read from. Every other way a lead is written does this too (the CSV import, the
   * sheet sync), and doing it here means one match decides both the text and the `branch_id`
   * `referenceEntries` derives from it below. Text naming no branch is left exactly as it arrived:
   * an unrecognised value is something to look at, not something to blank.
   */
  if (columns.assignedBranch) {
    columns.assignedBranch = (await referenceLookups()).branchName(columns.assignedBranch);
  }
  /*
   * The same restriction the upsert takes, or this undoes it one line later.
   *
   * This runs straight after `upsertMysqlRecord` and sets every column again. Limiting the upsert
   * to the fields a caller named therefore changed nothing at all: the full-row write still landed
   * here, and two people editing one lead at the same moment still overwrote each other.
   */
  const entries = Object.entries(columns).filter(([key]) => !only || only.has(key));
  // A reference follows the text it is derived from, and only that text: writing all three from a
  // partial record would carry a stale owner over somebody else's concurrent reassignment, which is
  // the overwrite `only` exists to prevent.
  entries.push(...(await referenceEntries(columns, only)));
  if (!entries.length) return;
  const setClause = entries.map(([key]) => `\`${DB_COLUMN[key]}\` = ?`).join(", ");
  const values = entries.map(([, value]) => value);
  await prisma.$executeRawUnsafe(
    `UPDATE \`sales_crm_lead\` SET ${setClause} WHERE \`enquiry_id\` = ?`,
    ...values,
    record.lead.id,
  );
}

/**
 * The reference columns a write keeps in step with its text, as [column, id] entries.
 *
 * The same rule the backfill ran (`referenceMatchers.js`): a value that names nothing stores NULL.
 * `only` limits it to the references whose text is being written, for the reason in
 * `syncCrmLeadColumns`; without it all three are recomputed from the record.
 */
const REFERENCE_SOURCES = { branchId: "assignedBranch", verticalId: "vertical", ownerEmployeeId: "crm" };
async function referenceEntries(columns, only = null) {
  const wanted = Object.entries(REFERENCE_SOURCES).filter(([, source]) => !only || only.has(source));
  if (!wanted.length) return [];
  const refs = await referenceLookups();
  const idFor = { branchId: refs.branchId, verticalId: refs.verticalId, ownerEmployeeId: refs.employeeId };
  return wanted.map(([column, source]) => [column, idFor[column](columns[source])]);
}

async function getCrmLeadRows() {
  return prisma.$queryRawUnsafe(`
    SELECT ${CRM_LEAD_SELECT_LIST}
    FROM \`sales_crm_lead\`
    WHERE \`deleted_at\` IS NULL
    ORDER BY \`enquiry_id\` ASC
  `);
}

/**
 * The other leads carrying the same phone number.
 *
 * The same person enquiring again arrives as a new lead - from a sheet, a CSV or the Callyzer
 * webhook - so "have we spoken to this number before" can only be answered by looking across
 * the whole table, not the page on screen.
 *
 * Numbers are compared on their last ten digits after every non-digit is stripped, because
 * the same number is stored as "9876543210", "+91 9876543210" and "98765-43210" depending on
 * which source wrote it. Corp leads keep theirs in `contactNumber` rather than `phone`, so
 * both columns are considered - either one matching is enough. They used to be coalesced, with
 * the contact number taking precedence, so a lead carrying both was findable only by that one:
 * the same client enquiring on the other number read as somebody the CRM had never spoken to.
 */
/**
 * The key two numbers are the same client by.
 *
 * The last ten digits, which is what makes "+91 98765 43210" and "9876543210" one client here and
 * everywhere else in this module. A number shorter than that is matched on the digits it has: a
 * partially recorded number is still a number, and refusing to match it is what let the same
 * client be created over and over.
 *
 * Below five digits there is not enough left to be anyone in particular, so nothing matches - that
 * is a blank field or a typo, not a client.
 */
function phoneMatchKey(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.length >= 10) return digits.slice(-10);
  return digits.length >= 5 ? digits : "";
}

async function listLeadsSharingPhone(phone) {
  const digits = phoneMatchKey(phone);
  if (!digits) return [];
  // Every lead on the number, the one being viewed included. Excluding it here would make
  // the total depend on whether a caller happened to pass an id to exclude.
  return prisma.$queryRawUnsafe(
    `SELECT \`enquiry_id\` AS \`enquiryId\`, \`name\`, \`vertical\`, \`status\`,
            \`created_date\` AS \`createdDate\`, \`added_time\` AS \`addedTime\`,
            \`next_follow_up_date\` AS \`nextFollowUpDate\`, \`last_follow_up_date\` AS \`lastFollowUpDate\`,
            ${leadColumnSql("crm")}
     FROM \`sales_crm_lead\`
     WHERE \`deleted_at\` IS NULL
       AND (RIGHT(REGEXP_REPLACE(COALESCE(\`contact_number\`, ''), '[^0-9]', ''), 10) = ?
         OR RIGHT(REGEXP_REPLACE(COALESCE(\`phone\`, ''), '[^0-9]', ''), 10) = ?)
     ORDER BY \`created_date\` DESC, \`enquiry_id\` DESC
     LIMIT 50`,
    digits, digits,
  );
}

/**
 * The live enquiry that already holds this number **in this vertical**, or null.
 *
 * ── One number, one enquiry — per vertical ────────────────────────────────────────────────────
 *
 * The CRM's idea of "the same client" is the last ten digits of their number: it is what the
 * Callyzer webhook matches a call on, what the Call Logs tab gathers a history by, and what
 * "Enquired : 2 times" counts. Two leads on one number inside one vertical are therefore the same
 * person written down twice, with their calls, remarks and follow-ups split across two records that
 * neither knows about - and that is refused rather than warned about, because there is no reading
 * of it that is anything but a mistake.
 *
 * Across verticals it is not a mistake at all, and this is the whole reason the rule is scoped.
 * A wedding client who later books a corporate shoot is one number and two enquiries *on purpose* -
 * different work, different pipeline, different team - and a rule written as "one number, one
 * enquiry" full stop would make the second one unwritable. So the vertical is part of the key.
 *
 * Compared on the *normalised* vertical, not the stored string. `vertical` is written by hand in
 * places - a sheet import, a CSV, the older spellings - so "corp", "Corporate" and "Crop" are all
 * Corp, and comparing raw text would let a second Corp lead through on a typo.
 *
 * `excludeId` is the lead doing the asking: a lead saving its own record must not find itself.
 */
async function findVerticalDuplicate({ phone, vertical, excludeId = "" } = {}) {
  const wanted = verticalFromValue(vertical);
  // With no vertical to compare against there is no rule to apply. Answering "no clash" is right:
  // this guards a pair, and half a pair is not one.
  if (!wanted) return null;

  const rows = await listLeadsSharingPhone(phone);
  const skip = String(excludeId || "").trim();
  return rows.find((row) => row.enquiryId !== skip && verticalFromValue(row.vertical) === wanted) || null;
}

// One lead, as the record shape the CRM and Sales Manager both read. Used when converting a
// lead into a project, where only that lead is needed and loading the whole table to find it
// would be absurd.
async function getCrmLeadById(id) {
  const [row] = await prisma.$queryRawUnsafe(
    `SELECT ${CRM_LEAD_SELECT_LIST}, ${PROJECT_DELETED_SQL} AS \`projectDeleted\`
     FROM \`sales_crm_lead\` WHERE \`enquiry_id\` = ? AND \`deleted_at\` IS NULL LIMIT 1`,
    String(id || "").trim(),
  );
  if (!row) return null;
  const record = toRecord(row);
  /*
   * The occasion this lead is being worked for, if any.
   *
   * Read here rather than selected in the query above, because this is the one-lead path - opening
   * a lead, converting one, an AI tool reading one - where a second lookup costs nothing. The board
   * selects the same values as part of its page query instead: one extra lookup per row per page is
   * a different proposition entirely.
   */
  record.details = { ...record.details, ...(await occasionFieldsFor(record.lead, record.details)) };
  return record;
}

async function upsertCrmLeadRow(record) {
  await prisma.$executeRawUnsafe(
    `INSERT INTO \`sales_crm_lead\` (${CRM_LEAD_SELECT_COLUMNS.filter((column) => column !== "deletedAt" && column !== "createdAt" && column !== "updatedAt").map((column) => `\`${DB_COLUMN[column]}\``).join(", ")}, \`deleted_at\`, \`created_at\`, \`updated_at\`)
     VALUES (${CRM_LEAD_SELECT_COLUMNS.filter((column) => column !== "deletedAt" && column !== "createdAt" && column !== "updatedAt").map(() => "?").join(", ")}, NULL, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))
     ON DUPLICATE KEY UPDATE ${CRM_LEAD_SQL_COLUMNS.map((column) => `\`${DB_COLUMN[column]}\` = VALUES(\`${DB_COLUMN[column]}\`)`).join(", ")}, \`deleted_at\` = NULL, \`updated_at\` = CURRENT_TIMESTAMP(3)`,
    record.lead.id,
    ...CRM_LEAD_SQL_COLUMNS.map((column) => flattenLeadColumns(record)[column]),
  );
}

// Long enough for a healthy receiver, short enough that an unhealthy one cannot hold a save
// open. Without a deadline a hung endpoint is not an error the catch below can see - the
// request simply waits, and behind a proxy the browser is told the API is unreachable long
// before anything here gives up. CRM_WEBHOOK_URL is set on the server and usually not
// locally, which is why only the server ever waited.
const CRM_WEBHOOK_TIMEOUT_MS = 5000;

async function sendCrmWebhook(event, payload) {
  const url = crmWebhookUrl();
  if (!url) return;

  try {
    await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        event,
        source: "crm",
        timestamp: new Date().toISOString(),
        payload,
      }),
      signal: AbortSignal.timeout(CRM_WEBHOOK_TIMEOUT_MS),
    });
  } catch (error) {
    // Notifying a listener is not the edit. The lead is already saved, so a slow or missing
    // receiver is logged and stepped over rather than reported to whoever made the change.
    console.warn(`CRM webhook skipped for ${event}:`, error.message);
  }
}

function toMysqlData(record) {
  return {
    enquiryId: record.lead.id,
    ...flattenLeadColumns(record),
    deletedAt: null,
  };
}

/**
 * Which columns a record actually names.
 *
 * `flattenLeadColumns` answers for every column there is, because a create writes the whole row.
 * An update must not: two people editing one lead at the same moment each read the same row, merge
 * their own field into it and write all fifty columns back, so whichever finishes last restores the
 * other's field to what it was before they touched it. Both requests succeed and one person's work
 * is silently gone - which is exactly what happens when a studio has several people on one board.
 *
 * Restricting the write to the fields the caller named makes the two statements disjoint: they set
 * different columns, so both land and neither overwrites the other.
 *
 * `status` is the one field carried under two names, so naming either counts as naming it.
 */
function namedColumns(record) {
  const lead = record?.lead || {};
  const details = record?.details || {};
  const named = new Set(Object.keys(lead).filter((key) => key !== "id"));
  for (const key of Object.keys(details)) named.add(key);
  if (details.leadStatus !== undefined) named.add("status");
  return named;
}

async function upsertMysqlRecord(record, { only = null } = {}) {
  await migrateCrmLeadLegacyColumns();
  const payload = flattenLeadColumns(record);
  /*
   * `only` is the set of columns an update touched. A create passes none, and writes them all -
   * a new row has no other writer to race with, and every column has to be set for the INSERT.
   */
  const columnNames = Object.keys(payload).filter((column) => !only || only.has(column));
  // A record that named nothing writable still has to touch the row, or the INSERT below has no
  // columns at all; the id and the timestamps are enough.
  if (!columnNames.length) {
    await prisma.$executeRawUnsafe(
      "UPDATE `sales_crm_lead` SET `updated_at` = CURRENT_TIMESTAMP(3) WHERE `enquiry_id` = ?",
      record.lead.id,
    );
    await syncCrmLeadColumns(record, { only });
    return record;
  }
  const values = columnNames.map((key) => payload[key]);
  await prisma.$executeRawUnsafe(
    `INSERT INTO \`sales_crm_lead\` (\`enquiry_id\`, ${columnNames.map((column) => `\`${DB_COLUMN[column]}\``).join(", ")}, \`deleted_at\`, \`created_at\`, \`updated_at\`)
     VALUES (?, ${columnNames.map(() => "?").join(", ")}, NULL, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))
     ON DUPLICATE KEY UPDATE ${columnNames.map((column) => `\`${DB_COLUMN[column]}\` = VALUES(\`${DB_COLUMN[column]}\`)`).join(", ")}, \`deleted_at\` = NULL, \`updated_at\` = CURRENT_TIMESTAMP(3)`,
    record.lead.id,
    ...values,
  );
  await syncCrmLeadColumns(record, { only });
  return record;
}

async function mirrorLegacyLeadsTable(record) {
  const lead = record.lead || {};
  const details = record.details || {};
  const payload = JSON.stringify({ lead, details });
  const sourceRef = details.sourceEnquiryId || details.csvImportKey || details.groupId || "";
  const offerType = lead.offerType || details.offerType || details.shootType || "";
  const contactRepeated = lead.contactRepeated || details.contactRepeated || details.referenceContact || "";

  try {
    await prisma.$executeRawUnsafe(
      `INSERT INTO \`leads\`
        (\`external_id\`, \`name\`, \`email\`, \`phone\`, \`company\`, \`status\`, \`source\`, \`source_ref\`, \`offer_type\`, \`contact_repeated\`, \`lead_json\`)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
        \`name\` = VALUES(\`name\`),
        \`email\` = VALUES(\`email\`),
        \`phone\` = VALUES(\`phone\`),
        \`company\` = VALUES(\`company\`),
        \`status\` = VALUES(\`status\`),
        \`source\` = VALUES(\`source\`),
        \`source_ref\` = VALUES(\`source_ref\`),
        \`offer_type\` = VALUES(\`offer_type\`),
        \`contact_repeated\` = VALUES(\`contact_repeated\`),
        \`lead_json\` = VALUES(\`lead_json\`)`,
      lead.id,
      lead.name || "",
      lead.email || "",
      lead.phone || "",
      lead.crm || "",
      details.leadStatus || "new",
      details.importedFrom ? "google_sheets" : "crm",
      sourceRef,
      offerType,
      contactRepeated,
      payload,
    );
  } catch (error) {
    console.warn("Legacy leads table mirror skipped:", error.message);
  }
}

async function syncMysqlRecords(records) {
  if (!records.length) return [];
  await migrateCrmLeadLegacyColumns();
  for (const record of records) {
    await upsertMysqlRecord(record);
  }
  await Promise.all(records.map((record) => syncCrmLeadColumns(record)));
  await Promise.all(records.map((record) => mirrorLegacyLeadsTable(record)));
  return records;
}

async function refreshCrmLeadsFromSheets() {
  if (typeof sheets.resetSheetsCache === "function") {
    sheets.resetSheetsCache();
  }
  sheetsUnavailable = false;
  const imported = await sheets.refreshCrmLeadsFromSheets();
  const records = (Array.isArray(imported) ? imported : []).map((item) => item.record).filter((record) => record?.lead?.id);
  if (!records.length) {
    return getCrmLeadRows().then((rows) => rows.map(toRecord));
  }
  return records;
}

// Cheap change signal for clients that poll for live updates. Because no-op syncs no
// longer rewrite rows, this only moves when lead data actually changed.
/*
 * How long one reading of the version stands for.
 *
 * The board polls this every four seconds, per open tab, and the answer is the same for all of
 * them - so without this a room of ten people asked the same question of the database ten times
 * every four seconds. Held for two seconds it is at most one query in that window however many
 * people are signed in, and nobody waits longer for a change than they already did: the poll's own
 * interval is twice this.
 *
 * Per process, so a clustered deployment holds one of these each. That is correct rather than a
 * compromise - each answers from the same table, and the staleness is bounded the same way.
 */
const VERSION_CACHE_MS = 2000;
let versionCache = { at: 0, value: null };

async function getCrmLeadVersion() {
  const now = Date.now();
  if (versionCache.value && now - versionCache.at < VERSION_CACHE_MS) return versionCache.value;
  /*
   * `deleted_at` and `updated_at` together, which is what `sales_crm_lead_version_idx` covers - so
   * this reads an index rather than the table. It was 3,450 ms at 500,000 leads before that index
   * existed, and this is the most frequently run query in the entire application.
   */
  const [row] = await prisma.$queryRawUnsafe(
    "SELECT COUNT(*) AS total, MAX(`updated_at`) AS updatedAt FROM `sales_crm_lead` WHERE `deleted_at` IS NULL",
  );
  const updatedAt = row?.updatedAt ? new Date(row.updatedAt).toISOString() : "";
  const total = Number(row?.total || 0);
  const value = { total, updatedAt, version: `${total}:${updatedAt}` };
  versionCache = { at: now, value };
  return value;
}

/**
 * The projects this lead's client became, newest last.
 *
 * Converting a lead opens Sales Manager to create the project, and saving that project is what
 * marks the lead Converted. Until now the project was the end of the trail as far as the CRM
 * was concerned - its Converted History could say who changed the status and when, but not what
 * the lead actually turned into, so the answer to "what did we sell them" lived only in another
 * module.
 *
 * ── The link is the contact number, not the enquiry id ────────────────────────────────────────
 *
 * It used to be `enquiry_id`, and that was the narrower question: not "what has this client
 * bought" but "what was booked through this particular enquiry row". Those come apart constantly,
 * and always in the direction of showing nothing:
 *
 *   - a booking created against a different enquiry for the same client - a second enquiry that
 *     came in on another vertical, or one raised before the current record existed;
 *   - a project whose `enquiry_id` was typed, imported or corrected to something else;
 *   - a lead whose enquiry id was reissued after a deletion, leaving its own bookings behind.
 *
 * In every one of those the client plainly has a booking and the tab said "No project has been
 * created from this lead yet", which reads as a fact about the client rather than about a join.
 *
 * So the number is the link, and matched the way the whole CRM matches a client: the last ten
 * digits, which is what the Callyzer webhook routes a call on, what the Contacts directory folds a
 * person by, and what the duplicate check compares. The last ten digits and not the string, because
 * the same client is stored as "+91 4786958704" here and "47869-58704" there.
 *
 * More than one is possible and correct - a client who comes back for a second shoot - so this
 * returns a list rather than one project.
 *
 * Read only: nothing here writes to a project, and a project deleted in Sales Manager drops out of
 * the history with it.
 */
async function listCrmLeadProjects(enquiryId) {
  const id = String(enquiryId || "").trim();
  if (!id) return [];

  /*
   * The lead's own number, which is the only thing this reads its enquiry id for.
   *
   * Both columns, because a lead's number lives in `contact_number` or in `phone` depending on how
   * it was written - the same pair `listLeadsSharingPhone` matches on, and the same reason: they
   * have both been the CRM's number column at different times.
   */
  const [lead] = await prisma.$queryRawUnsafe(
    "SELECT `contact_number` AS `contactNumber`, `phone` FROM `sales_crm_lead`"
    + " WHERE `enquiry_id` = ? AND `deleted_at` IS NULL LIMIT 1",
    id,
  );
  const digits = phoneMatchKey(lead?.contactNumber) || phoneMatchKey(lead?.phone);
  // A lead with no number can have no history under this rule. Honest rather than falling back to
  // the enquiry id: a fallback would make the tab answer a different question on some rows than on
  // others, with nothing on screen saying which.
  if (!digits) return [];

  /*
   * Which projects, decided in SQL, and then read through Prisma.
   *
   * The match cannot be expressed as a Prisma filter - it needs `REGEXP_REPLACE` to strip the
   * separators before taking the last ten digits, and `endsWith` on the raw column would miss the
   * client stored as "+91 47869-58704" while matching the one stored as "+91 4786958704". So the
   * ids are found in SQL and the row is selected the ordinary way, which keeps the typed `select`
   * below and Prisma's own handling of the `Decimal` and `Json` columns in it.
   */
  const matches = await prisma.$queryRawUnsafe(
    "SELECT `id` FROM `sales_project`"
    + " WHERE `deleted_at` IS NULL"
    + "   AND RIGHT(REGEXP_REPLACE(COALESCE(`client_main_number`, ''), '[^0-9]', ''), 10) = ?"
    // A client with a hundred bookings is not a thing, and this stops one malformed number - an
    // empty column matching an empty key - from reading the whole table into a lead popup.
    + " LIMIT 100",
    digits,
  );
  // A `cuid`, so kept as the string it is - coercing it to a number would discard every id and the
  // tab would read empty for a client who plainly has bookings.
  const ids = matches.map((row) => String(row.id)).filter(Boolean);
  if (!ids.length) return [];

  const projects = await prisma.salesProject.findMany({
    where: { id: { in: ids } },
    orderBy: { createdAt: "asc" },
    /*
     * Enough for the row *and* for the record behind it.
     *
     * The table in Converted History is a summary - nine columns - but opening one of those rows now
     * shows the project as a record, the same reading Sales Manager gives it. Those extra fields are
     * selected here rather than fetched on the click, because a lead has one or two projects and the
     * rows are already in hand: a second request to read a record the page is holding would put a
     * spinner in front of an answer it already has.
     *
     * What is deliberately *not* here is the workflow - shoots, service allocations, post-production
     * deliverables. That is Project Management's reading of a project, it is a nested read several
     * levels deep, and this endpoint answers the CRM's permission rather than Projects'. Somebody
     * who holds Project Management opens the fuller record on their own board.
     */
    select: {
      id: true,
      eventId: true,
      // The lead this came back to. Shown at the top of the record, where it is the line that says
      // which enquiry the project belongs to.
      enquiryId: true,
      whatsappGroupName: true,
      // The number the project was created against. Worth showing beside the project it
      // belongs to: a lead can convert more than once, and the number is what says which
      // client each of those projects is actually for.
      clientMainNumber: true,
      vertical: true,
      sourceBranch: true,
      deliverables: true,
      deliverablesDetails: true,
      // The group name as it was generated, which the record view unpacks into the branch, offer,
      // client, place and the rest of the WhatsApp Group Details section.
      groupNameGeneratorJson: true,
      salesPreProductionRemarks: true,
      salesProductionRemarks: true,
      salesPostProductionRemarks: true,
      mainEventDate: true,
      mainEventDateKnown: true,
      initialConvertedValue: true,
      crmName: true,
      projectStatus: true,
      projectManager: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return projects.map((project) => ({
    ...project,
    // Prisma hands back a Decimal, which does not survive JSON as a number. The CRM only
    // ever displays this, so a plain number is what it wants.
    initialConvertedValue: project.initialConvertedValue === null ? null : Number(project.initialConvertedValue),
  }));
}

async function listCrmLeads() {
  await migrateCrmLeadLegacyColumns();
  const mysqlRows = await getCrmLeadRows();

  if (sheetsUnavailable) {
    try {
      const refreshed = await refreshCrmLeadsFromSheets();
      if (refreshed.length) {
        const nextRows = await getCrmLeadRows();
        const merged = new Map(nextRows.map((row) => [row.enquiryId, toRecord(row)]));
        for (const item of refreshed) {
          if (item?.record?.lead?.id) merged.set(item.record.lead.id, item.record);
        }
        return [...merged.values()];
      }
      sheetsUnavailable = false;
    } catch (error) {
      if (isSheetsAuthError(error) || String(error?.message || "").includes("Google Sheets CRM is not configured.")) {
        sheetsUnavailable = true;
        return mysqlRows.map(toRecord);
      }
      throw error;
    }
  }

  if (mysqlRows.length) {
    const merged = new Map(mysqlRows.map((row) => [row.enquiryId, toRecord(row)]));
    try {
      const sheetRows = await sheets.listRecordsWithRows();
      for (const item of sheetRows) {
        if (item?.record?.lead?.id && !merged.has(item.record.lead.id)) {
          merged.set(item.record.lead.id, item.record);
        }
      }
    } catch (error) {
      if (isSheetsAuthError(error) || String(error?.message || "").includes("Google Sheets CRM is not configured.")) {
        sheetsUnavailable = true;
        return mysqlRows.map(toRecord);
      }
      console.warn("CRM sheet merge skipped:", error.message);
    }
    return [...merged.values()];
  }

  try {
    const refreshed = await refreshCrmLeadsFromSheets();
    if (refreshed.length) {
      const nextRows = await getCrmLeadRows();
      const merged = new Map(nextRows.map((row) => [row.enquiryId, toRecord(row)]));
      for (const item of refreshed) {
        if (item?.record?.lead?.id) merged.set(item.record.lead.id, item.record);
      }
      return [...merged.values()];
    }
  } catch (error) {
    if (!isSheetsAuthError(error)) throw error;
    sheetsUnavailable = true;
  }

  return mysqlRows.map(toRecord);
}

/**
 * The lead's Added Time and Enquiry Date, taken from the studio's clock where the record brings none.
 *
 * The Add Lead form stamps them in the browser, from the computer's own clock - a machine set to UTC
 * wrote every manual lead 5:30 behind, and a blank one fell back to the row's insert time, which is
 * written in whatever zone the database runs on. A time a sheet, a file or a call brought with it is
 * kept; only a missing one is filled, and always in India time. See `services/studioTime.js`.
 */
function stampStudioTime(record, when = new Date()) {
  if (!record?.lead) return record;
  if (!String(record.lead.addedTime || "").trim()) record.lead.addedTime = studioClockTime(when);
  if (!String(record.lead.createdDate || "").trim()) record.lead.createdDate = studioDateKey(when);
  return record;
}

async function createCrmLead(record) {
  stampStudioTime(record);
  let created;
  try {
    created = sheetsUnavailable ? null : await sheets.createCrmLead(record);
  } catch (error) {
    if (!isSheetsAuthError(error)) {
      console.warn("CRM sheet create failed, falling back to MySQL:", error.message);
    }
    sheetsUnavailable = true;
  }
  if (!created) created = record;
  await upsertMysqlRecord(created);
  try {
    await mirrorLegacyLeadsTable(created);
  } catch (error) {
    console.warn("Legacy leads table mirror skipped:", error.message);
  }
  await sendCrmWebhook("crm.lead.created", created);
  /*
   * A lead added while one of its windows is already open starts that occasion at the status it was
   * added with.
   *
   * Without this the row would go straight into Yet to connect on the strength of an empty
   * occurrence, however plainly the person adding it had just spoken to the client and marked them
   * Interested. The lead's own status is written as normal above - both are true, and they are the
   * same answer here because the call that created the lead *was* the occasion's call.
   */
  const occasion = occasionContextFor(created?.lead || {}, created?.details || {});
  const status = created?.details?.leadStatus || created?.lead?.status || "";
  if (occasion && String(status).trim()) {
    await writeOccurrence(created.lead.id, occasion.occasion, occasion.year, { status }, {});
  }
  return created;
}

async function createCrmLeads(records) {
  const now = new Date();
  for (const record of records || []) stampStudioTime(record, now);
  let createdRecords;
  try {
    createdRecords = sheetsUnavailable ? null : await sheets.createCrmLeads(records);
  } catch (error) {
    if (!isSheetsAuthError(error)) {
      console.warn("CRM bulk sheet create failed, falling back to MySQL:", error.message);
    }
    sheetsUnavailable = true;
  }
  if (!createdRecords) createdRecords = records;
  await syncMysqlRecords(createdRecords);
  for (const record of createdRecords) {
    try {
      await mirrorLegacyLeadsTable(record);
    } catch (error) {
      console.warn("Legacy leads table mirror skipped:", error.message);
    }
  }
  await sendCrmWebhook("crm.leads.bulk_created", { records: createdRecords, count: createdRecords.length });
  return createdRecords;
}

async function currentLeadColumns(id) {
  try {
    const [row] = await prisma.$queryRawUnsafe(
      `SELECT ${CRM_LEAD_SELECT_LIST} FROM \`sales_crm_lead\` WHERE \`enquiry_id\` = ? LIMIT 1`,
      id,
    );
    return row ? flattenLeadColumns(toRecord(row)) : null;
  } catch (error) {
    console.warn("Unable to read the current CRM lead for activity logging:", error?.message || error);
    return null;
  }
}

/*
 * ── The fields an occasion's call owns ─────────────────────────────────────────────────────────
 *
 * How the call went, how many times it went unanswered, and when to try again. Everything else on
 * the lead - its name, its number, the shoot it is for - belongs to the lead whatever it is being
 * worked for, and is written exactly as it always was.
 *
 * Each is listed under both names it travels under: the CRM keeps the status as `lead.status` and
 * as `details.leadStatus`, and the follow-up fields on the lead and the details alike.
 */
const OCCASION_OWNED_FIELDS = [
  { occurrence: "status", lead: "status", detail: "leadStatus", was: "occasionStatus", label: "Status", action: "STATUS_CHANGED" },
  { occurrence: "cnaSequence", lead: "cnaSequence", detail: "cnaSequence", was: "occasionCnaSequence", label: "CNA Attempts", action: "UPDATED" },
  { occurrence: "nextFollowUpDate", lead: "nextFollowUpDate", detail: "nextFollowUpDate", was: "occasionNextFollowUpDate", label: "Next Follow-up Date", action: "FOLLOWUP_CHANGED" },
  { occurrence: "nextFollowUpTime", lead: "nextFollowUpTime", detail: "nextFollowUpTime", was: "occasionNextFollowUpTime", label: "Next Follow-up Time", action: "FOLLOWUP_CHANGED" },
];

/**
 * Splits an update into the part that belongs to the occasion and the part that belongs to the
 * lead - and only when the lead really has one open.
 *
 * Sitting here, in the one function every write goes through, rather than in the route: the board's
 * status pills, Update Details, the transcript apply, the AI remark tool and the conversion a saved
 * project triggers would otherwise each have to remember, and the next caller would not know to.
 *
 * `stored` is what the lead holds now. The diverted fields are put back to it before the write
 * continues, which is what keeps an occasion's status out of the lead's own columns *and* out of the
 * Google Sheet - the sheet's Status column is the lead's status, and it is the one copy of it this
 * application does not own.
 */
function splitOccasionWrite(record, merged, stored) {
  const occasion = occasionContextFor(merged.lead, merged.details);
  if (!occasion) return null;

  const changes = {};
  const entries = [];
  const leadRecord = { lead: { ...(record?.lead || {}) }, details: { ...(record?.details || {}) } };
  const leadMerged = { lead: { ...merged.lead }, details: { ...merged.details } };

  for (const field of OCCASION_OWNED_FIELDS) {
    const named = record?.lead?.[field.lead] !== undefined || record?.details?.[field.detail] !== undefined;
    if (!named) continue;
    // The merge above already reconciled the two names against each other, so either side answers.
    changes[field.occurrence] = merged.details[field.detail] ?? merged.lead[field.lead];
    entries.push({
      action: field.action,
      field: field.lead,
      // Named so the log says which call this was about: "Status (birthday 2027)".
      fieldLabel: `${field.label} (${OCCASIONS[occasion.occasion].label.toLowerCase()} ${occasion.year})`,
      // What that occasion held before, not what the lead holds - the log has to read as the
      // history of this call, or it would say "Converted -> Interested" off last year's
      // shoot every time somebody starts working this year's.
      fromValue: stored?.details?.[field.was] ?? "",
      toValue: changes[field.occurrence],
    });
    // Both names off both halves. The client echoes a status onto whichever of them it holds, and a
    // single copy left behind would put `status` back into `namedColumns` and write it to the lead.
    for (const name of [field.lead, field.detail]) {
      delete leadRecord.lead[name];
      delete leadRecord.details[name];
    }
    // Back to what the lead holds, so neither MySQL nor the sheet sees the occasion's value.
    leadMerged.lead[field.lead] = stored?.lead?.[field.lead] ?? "";
    leadMerged.details[field.detail] = stored?.details?.[field.detail] ?? "";
  }

  if (!entries.length) return null;
  return { occasion, changes, entries, record: leadRecord, merged: leadMerged };
}

/*
 * ── Every column that quotes an enquiry id ─────────────────────────────────────────────────────
 *
 * An enquiry id is the lead's primary key *and* plain text on ten other tables - a project, a
 * quotation, a meeting, the activity log. Anything that renames one has to move all of them, or a
 * row is left pointing at an id that no longer exists.
 *
 * Exported because `scripts/renumberIdentifiers.js` sweeps the same columns, and two copies of this
 * list is one that gets a table added to it and one that does not. Taken from `information_schema`
 * rather than from memory.
 */
const ENQUIRY_ID_REFERENCES = [
  ["sales_call_transcript", "enquiry_id"],
  ["sales_crm_call_log", "enquiry_id"],
  ["sales_crm_lead_activity", "enquiry_id"],
  ["sales_crm_lead_occasion", "enquiry_id"],
  ["sales_crm_lead_watch", "enquiry_id"],
  ["sales_crm_meeting", "enquiry_id"],
  ["sales_project", "enquiry_id"],
  ["sales_project_crd_document", "enquiry_id"],
  ["sales_quotation", "enquiry_id"],
  ["sales_whatsapp_group_name", "enquiry_id"],
  /*
   * The lead's own record of where it came from. On a Callyzer lead this holds *Callyzer's* id for
   * the call, not one of ours, so the `WHERE` below simply does not match it - which is the intended
   * behaviour rather than an oversight.
   */
  ["sales_crm_lead", "source_enquiry_id"],
];

/**
 * A call still waiting to be given a vertical - the rows the Calls board holds.
 *
 * Mirrors `CALLS_SQL` in leadQueryService.js, which decides the board itself. Both must test the
 * same two fields and nothing else.
 */
function isUntriagedCall(lead = {}) {
  return !String(lead.vertical || "").trim() && String(lead.source || "").trim().toLowerCase() === "callyzer";
}

/**
 * Renames a lead, and everything that quotes it, in one transaction.
 *
 * The id is the primary key, so this is a real rename rather than a column edit - and it is all or
 * nothing, because a half-applied one leaves rows pointing at a lead that is not there.
 */
async function renameEnquiryId(from, to) {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("UPDATE `sales_crm_lead` SET `enquiry_id` = ? WHERE `enquiry_id` = ?", to, from);
    for (const [table, column] of ENQUIRY_ID_REFERENCES) {
      await tx.$executeRawUnsafe(`UPDATE \`${table}\` SET \`${column}\` = ? WHERE \`${column}\` = ?`, to, from);
    }
  });
}

/**
 * A call being placed into a vertical is re-issued its enquiry id.
 *
 * The Callyzer webhook creates a lead the moment a call arrives, and at that moment nothing names a
 * vertical - `verticalForCall` refuses to guess, which is the whole reason the Calls board exists.
 * So the id it is minted with reads `DBS-EID-DD-…`, the default. Somebody then reads the caller and
 * says which vertical it is, and without this the lead would sit on the Qua Qua board for the rest
 * of its life carrying Dum Dum's code - which is precisely the thing the identifier is there to say.
 *
 * Deliberately only this transition. A lead moved between verticals by hand later on keeps its id:
 * by then it has been quoted on a project, a quotation, a WhatsApp group name and very likely to
 * the client, and renaming it would be a worse lie than the one it tells. A call that has just
 * arrived has none of that - its only references are its own call log and activity - which is what
 * makes this the one safe moment to do it.
 *
 * Returns the id to carry on with: the new one where it was re-issued, the old one otherwise.
 */
async function reissueEnquiryIdOnPlacement(id, before, record) {
  const givenVertical = String(record?.lead?.vertical || "").trim();
  if (!before || !isUntriagedCall(before) || !givenVertical) return id;

  const reissued = await nextIdentifier("CRM_LEAD", {
    vertical: givenVertical,
    branch: record?.lead?.assignedBranch ?? before.assignedBranch,
  });
  await renameEnquiryId(id, reissued);
  // Said out loud in the lead's own history, because its identifier is what everything else refers
  // to it by and somebody holding the old one needs to be able to find out where it went.
  await recordLeadActivity(reissued, [{
    action: "UPDATED",
    field: "id",
    fieldLabel: "Enquiry ID",
    fromValue: id,
    toValue: reissued,
  }], {});
  return reissued;
}

/**
 * `actor` carries who is making the change, so the log can say so. It is optional: paths
 * without a signed-in user (the sheet poller, the Callyzer webhook) record their source
 * instead.
 */
async function updateCrmLead(id, record, actor = {}) {
  // Read first. sheets.updateCrmLead already writes the row - despite its name it upserts
  // into MySQL - so anything read after it would be the new state compared against itself.
  const before = await currentLeadColumns(id);

  /*
   * An update changes the fields it names and leaves the rest of the lead alone.
   *
   * This wrote whatever it was handed as the whole row. `upsertMysqlRecord` sets every column in
   * `flattenLeadColumns`, and a field absent from the record flattens to `null` - so a caller that
   * sent only the field it was changing silently blanked every other one. `PUT /:id` accepts a
   * partial lead by design (`updateRecordSchema` is `.partial()`), so this was reachable from
   * outside with one ordinary request.
   *
   * What it looked like: a Corp lead came back with an empty `vertical`, and a blank vertical is read
   * as Dum Dum by the tab rules - so the lead vanished from Corp without anybody deleting anything.
   * Its name, phone and status were wiped in the same write, which is why the row that was left
   * behind did not look like the lead either. Nothing appeared in the Activity Log as a deletion,
   * because nothing was deleted.
   *
   * Merged here rather than in the route, so every caller is covered - the transcript apply, the AI
   * remark tool and the Callyzer webhook all read-then-merge already, but nothing was making them,
   * and the next caller would not have known to.
   *
   * A key that IS present still writes, even when empty: that is how a field gets cleared on
   * purpose. Only an absent key falls back to what is stored.
   */
  /*
   * A call being given a vertical takes a new enquiry id for it - see above. Done before anything
   * else reads the lead, so the rest of this function works on the id the record will actually have.
   */
  id = await reissueEnquiryIdOnPlacement(id, before, record);

  const current = before ? await getCrmLeadById(id) : null;
  let merged = {
    lead: { ...(current?.lead || {}), ...(record?.lead || {}), id },
    details: { ...(current?.details || {}), ...(record?.details || {}) },
  };

  /*
   * The status is stored under two names, and the merge has to move them together.
   *
   * `flattenLeadColumns` writes `details.leadStatus || lead.status`, so the detail wins. Merging
   * each half against what is stored independently meant a caller changing `lead.status` alone had
   * its new status overruled by the old `details.leadStatus` underneath it - the write succeeded and
   * the status did not move. Whichever half this caller actually named is the one that decides, and
   * the other is brought with it.
   */
  const setsStatus = record?.lead?.status !== undefined;
  const setsLeadStatus = record?.details?.leadStatus !== undefined;
  if (setsStatus && !setsLeadStatus) merged.details.leadStatus = record.lead.status;
  else if (setsLeadStatus && !setsStatus) merged.lead.status = record.details.leadStatus;

  /*
   * A Qua Qua lead with an occasion open - a newborn shoot due, or a birthday coming up - is being
   * worked for that occasion, so the status, the attempt count and the follow-up date go to its
   * occurrence and the lead's own columns are left alone. See `splitOccasionWrite` above and
   * occasionLeadService.js for why.
   */
  const diverted = splitOccasionWrite(record, merged, current);
  if (diverted) {
    await writeOccurrence(id, diverted.occasion.occasion, diverted.occasion.year, diverted.changes, actor);
    await recordLeadActivity(id, diverted.entries, actor);
    record = diverted.record;
    merged = { lead: { ...diverted.merged.lead, id }, details: diverted.merged.details };
  }

  let nextRecord;
  try {
    nextRecord = sheetsUnavailable ? null : await sheets.updateCrmLead(id, merged);
  } catch (error) {
    if (!isSheetsAuthError(error)) throw error;
    sheetsUnavailable = true;
  }
  if (!nextRecord) nextRecord = { lead: { ...merged.lead, id }, details: merged.details };
  /*
   * Only what this caller named. The merge above filled the rest in so the sheet and the webhook see
   * a whole lead, but writing the rest back is what loses a colleague's simultaneous edit.
   */
  await upsertMysqlRecord(nextRecord, { only: namedColumns(record) });
  if (before) {
    // The diff already classifies each change (STATUS_CHANGED, REMARK_ADDED, ...); passing
    // them through unchanged is what keeps those names in the log.
    await recordLeadActivity(id, diffLeadColumns(before, flattenLeadColumns(nextRecord)), actor);
  }
  /*
   * If this edit is what put the lead in somebody's name, tell them.
   *
   * `before` is the row as it stood, read at the top of this function - so an edit that leaves the
   * CRM alone announces nothing, which is most edits. The lead's own name is taken from the record
   * being written rather than from `before`, because renaming a client and assigning them can be the
   * same save.
   */
  await notifyLeadAssigned(
    { enquiryId: id, name: nextRecord?.lead?.name || before?.name || "" },
    { crm: flattenLeadColumns(nextRecord)?.crm || "", previousCrm: before?.crm || "", actorId: actor?.actorUserId ?? null },
  );
  await sendCrmWebhook("crm.lead.updated", nextRecord);
  /*
   * The occasion fields, re-read, on the record that goes back to the browser.
   *
   * The board applies what it gets back over the row it is showing, so a status the user just set
   * on an occasion has to come back set - otherwise the pill lights up, the reply lands, and the
   * pill goes out again on a record that says nothing about occasions. Read rather than assumed, so
   * the record says what was actually stored.
   */
  nextRecord.details = { ...nextRecord.details, ...(await occasionFieldsFor(nextRecord.lead, nextRecord.details)) };
  return nextRecord;
}

/**
 * Statuses that already say this lead converted.
 *
 * Qua Qua runs conversion and follow-up together, so "Converted & Followup" is a status in its
 * own right. Overwriting it with a plain "Converted" would drop half of what it says, and a
 * client coming back for a second shoot converts against a lead that is already Converted - so
 * a lead that has one of these keeps the status it has.
 */
const CONVERTED_STATUS_KEYS = new Set([
  "converted",
  "converted & followup", "converted and followup", "converted-followup",
  "followup & converted", "followup and converted", "followup-converted",
]);

// Plain "Converted", the one converted status that ends the follow-ups (see `STATUSES_WITHOUT_FOLLOW_UP`).
const CONVERTED_STATUS = "converted";
const isConvertedStatus = (status) => String(status || "").trim().toLowerCase() === CONVERTED_STATUS;

/**
 * The studio's day, which is what every date in the CRM means. A project saved just after
 * midnight IST converted today, not yesterday as `toISOString` on a UTC server would have it.
 */
function studioToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

/**
 * Marks the lead a project was just created from as Converted.
 *
 * Conversion is finished by the project, not by the click that starts it. Create Project opens
 * in a second tab, and that tab can be closed without saving - which used to leave the lead
 * reading Converted, counted as converted and carrying a Converted row in its own history, for
 * a project that was never created. So the status is written from the project save instead,
 * the first moment there is anything to have converted into.
 *
 * It goes through `updateCrmLead` rather than a direct UPDATE so the sheet, the activity log
 * and the webhook all move with it - the Converted row the popup's Converted History shows is
 * that log entry.
 */
async function markCrmLeadConverted(enquiryId, actor = {}, requestedStatus = "") {
  const id = String(enquiryId || "").trim();
  if (!id) return null;
  const record = await getCrmLeadById(id);
  if (!record) return null;

  /*
   * Which converted status the lead ends up reading as.
   *
   * Three answers, in order:
   *
   *   1. **What was chosen when the conversion was started.** Qua Qua offers "Converted & Followup"
   *      beside "Converted", and the two mean different things - a client who bought and is still
   *      being worked, against one who bought and is done. Both open Create Project rather than
   *      being written down, so the choice has to travel with the conversion and be applied here,
   *      by the save that actually converts the lead. Without this, picking "Converted & Followup"
   *      ended with a lead reading plain "Converted" and the distinction lost.
   *   2. **A converted status the lead already holds**, which is the behaviour this had before: a
   *      lead converted a second time is not quietly demoted from "Converted & Followup".
   *   3. **"Converted"**, for a conversion that said nothing - New Project, an import, an older tab.
   *
   * The requested status is checked against the same list rather than trusted: it arrives from a
   * browser, and it decides what the lead reads as afterwards. Anything that is not a converted
   * status is ignored, so this can never be used to set a lead to something else entirely.
   */
  const asked = String(requestedStatus || "").trim();
  const requested = CONVERTED_STATUS_KEYS.has(asked.toLowerCase()) ? asked : "";
  const current = String(record.details?.leadStatus || record.lead?.status || "").trim();
  const status = requested || (CONVERTED_STATUS_KEYS.has(current.toLowerCase()) ? current : "Converted");
  return updateCrmLead(
    id,
    {
      lead: { ...record.lead, status, leadStatus: status },
      // Converting is the lead's last follow-up, so it is stamped with the day too. The next
      // follow-up date is cleared by `flattenLeadColumns` for a plain Converted lead.
      details: { ...record.details, leadStatus: status, lastConvertedDate: studioToday(), lastFollowUpDate: studioToday() },
    },
    actor,
  );
}

async function deleteCrmLead(id) {
  let removed = true;
  try {
    if (!sheetsUnavailable) removed = await sheets.deleteCrmLead(id);
  } catch (error) {
    if (!isSheetsAuthError(error)) throw error;
    sheetsUnavailable = true;
  }
  if (removed) {
    /*
     * The row goes, rather than being hidden. `purgeLeads` takes the lead's own children with it,
     * unlinks its calls, and refuses outright where a project, quotation or CRD names it - which is
     * the one case this reports back as an error rather than a silent no-op.
     */
    const { deleted, blocked } = await purgeLeads([id]);
    if (!deleted.length) {
      const reason = blocked.get(id);
      const error = new Error(reason
        ? `This lead cannot be deleted: ${reason} has been raised against it. Delete that first, or keep the lead.`
        : "This lead could not be deleted.");
      error.status = 409;
      throw error;
    }
    try {
      await prisma.$executeRawUnsafe("DELETE FROM `leads` WHERE `external_id` = ?", id);
    } catch (error) {
      console.warn("Legacy leads delete skipped:", error.message);
    }
    // No activity row: `purgeLeads` has just removed this lead's trail, and writing a "DELETED"
    // line afterwards would put back the one orphan the delete exists to avoid.
    await sendCrmWebhook("crm.lead.deleted", { id });
  }
  return removed;
}


/*
 * Soft-deletes a selection, in one pass over the rows.
 *
 * It used to take three passes, and two of them were not worth the wait:
 *
 *   * `sheets.deleteCrmLeads(ids)` was called first and its result used as the list to delete. That
 *     function no longer talks to Google Sheets at all - it is the *same* UPDATE this one runs, so
 *     every bulk delete wrote `deleted_at` over the same rows twice. On a whole board that is not a
 *     rounding error: the statement is ~5s at 17,500 leads and it was being paid twice, which is
 *     most of what somebody watching a "Deleting..." button was waiting for.
 *   * The legacy `leads` mirror was passed `IN (?)` with every id joined into **one** string, so it
 *     matched nothing whatever it was pointed at. It has real placeholders now - and it is
 *     abandoned after the first
 *     failure rather than retried per slice, because the usual reason it fails is that the table is
 *     not there at all, and thousands of failed statements is a slow way to find that out.
 *
 * The webhook is no longer awaited. Notifying a listener is not the edit - the comment on
 * `sendCrmWebhook` has always said so - and it is a POST carrying every deleted id, up to five
 * seconds of it, sitting in front of the reply to somebody already watching a spinner.
 */
async function deleteCrmLeads(ids) {
  const deletedIds = Array.isArray(ids) ? ids : [];
  if (!deletedIds.length) return { deletedIds: [], blocked: new Map() };

  /*
   * The rows go, and their children with them. See `purgeLeads`: it slices by `BULK_DELETE_SLICE`
   * itself, so the ceiling is applied there rather than here.
   *
   * The returned list is what was *actually* removed - a lead carrying a project, a quotation or a
   * CRD document is refused and left standing, and the caller reports it by name. Everything below
   * therefore works from `removedIds` and not from what was asked for.
   */
  const { deleted: removedIds, blocked } = await purgeLeads(deletedIds);
  if (!removedIds.length) return { deletedIds: [], blocked };

  for (let offset = 0; offset < removedIds.length; offset += STATUS_UPDATE_SLICE) {
    const slice = removedIds.slice(offset, offset + STATUS_UPDATE_SLICE);
    try {
      await prisma.$executeRawUnsafe(
        `DELETE FROM \`leads\` WHERE \`external_id\` IN (${slice.map(() => "?").join(", ")})`,
        ...slice,
      );
    } catch (error) {
      console.warn("Legacy leads bulk delete skipped:", error.message);
      break;
    }
  }

  void sendCrmWebhook("crm.leads.bulk_deleted", { ids: removedIds, count: removedIds.length });
  return { deletedIds: removedIds, blocked };
}

/*
 * ── Deleting a lead really deletes it ─────────────────────────────────────────────────────────
 *
 * Delete used to stamp `deleted_at` and leave the row where it was. Every screen honours that
 * column, so the lead vanished from the CRM and the studio reasonably read that as gone - while the
 * table kept growing. A dev database that had had a few imports cleared out of it was holding 92,452
 * hidden rows against 20,094 live ones, and the studio's own reading of "I deleted those" was simply
 * not true of the database.
 *
 * So a delete is a `DELETE`. What that has to take with it, and what it must not, is the whole of
 * the care here. Since 20260924150000 the database holds the same rules as keys - the owned tables
 * cascade, the commercial ones refuse - so nothing here can be forgotten; the lists below stay so the
 * order is explicit, the refusal is worded, and the one table with no key (the call log, created at
 * runtime) is still handled.
 *
 * ── What goes with the lead ──
 *
 * The tables that are *about* the lead and mean nothing without it: its activity trail, its
 * newborn/birthday occurrences, its place on the Watchers list, the meetings booked against it, the
 * WhatsApp group names generated for it, and the transcripts of the calls matched to it. Left
 * behind, these are rows pointing at an enquiry id nobody can open.
 *
 * ── What is unlinked instead ──
 *
 * The calls themselves. A call **happened** - it is a fact about the studio's phone, not a detail of
 * the lead - so deleting the caller must not delete the record of them ringing. The call is unlinked
 * and returns to the Calls board as a caller nobody has added, which is exactly what
 * `retireCallyzerCallLeads.js` does for the same reason. (Its transcript goes with the lead: it is
 * the studio's reading of that lead's conversation, and a later match makes a new one.)
 *
 * ── What refuses the delete ──
 *
 * A project, a quotation or a CRD document against the lead. Those are the studio's commercial
 * record: a booking with money attached, a document sent to a client. Deleting the lead under them
 * would leave each one naming an enquiry that no longer exists - the project would still open, and
 * its Converted History and its CRM link would answer with nothing. That is a worse fault than the
 * one this change fixes, so the lead stays and the caller is told which ones and why.
 */
const LEAD_OWNED_TABLES = ["sales_crm_lead_activity", "sales_crm_lead_occasion", "sales_crm_lead_watch", "sales_crm_meeting", "sales_whatsapp_group_name", "sales_call_transcript"];
const LEAD_UNLINKED_TABLES = ["sales_crm_call_log"];
/** Where a lead's id appearing means real work was done against it, and it may not be deleted. */
const LEAD_COMMERCIAL_TABLES = { sales_project: "a project", sales_quotation: "a quotation", sales_project_crd_document: "a CRD document" };

/**
 * The ids that cannot be deleted, each with the reason, keyed by enquiry id.
 *
 * Asked of all of them in one query per table rather than per lead, so clearing a board of 17,000
 * costs three queries and not fifty thousand.
 */
async function leadsWithCommercialRecords(ids) {
  const blocked = new Map();
  if (!ids.length) return blocked;
  for (const [table, label] of Object.entries(LEAD_COMMERCIAL_TABLES)) {
    for (let offset = 0; offset < ids.length; offset += BULK_DELETE_SLICE) {
      const slice = ids.slice(offset, offset + BULK_DELETE_SLICE);
      let rows = [];
      try {
        /*
         * A project in Resource Management → Recycling Bin still refuses the delete - Restore needs its
         * lead - but says where it is, since it is on no other screen: `live` is 0 when every project
         * of the enquiry is in the bin. Table names are this file's constants; values go through `?`.
         */
        rows = await prisma.$queryRawUnsafe(
          table === "sales_project"
            ? `SELECT \`enquiry_id\`, MAX(\`deleted_at\` IS NULL) AS \`live\` FROM \`sales_project\` WHERE \`enquiry_id\` IN (${slice.map(() => "?").join(", ")}) GROUP BY \`enquiry_id\``
            : `SELECT DISTINCT \`enquiry_id\` FROM \`${table}\` WHERE \`enquiry_id\` IN (${slice.map(() => "?").join(", ")})`,
          ...slice,
        );
      } catch (error) {
        // A table this deployment does not have is not a reason to refuse the delete, but it is
        // also not a reason to delete blind - so it is reported and the lead is left alone.
        console.warn(`Unable to check ${table} before deleting leads:`, error?.message || error);
        continue;
      }
      for (const row of rows) {
        const id = String(row.enquiry_id || "");
        if (id && !blocked.has(id)) blocked.set(id, table === "sales_project" && !Number(row.live) ? "a project now in the Project Vault" : label);
      }
    }
  }
  return blocked;
}

/**
 * Removes the leads and everything that belongs to them, and says which were refused.
 *
 * Returns `{ deleted, blocked }` - `blocked` being a Map of id to the reason, so a caller can name
 * them rather than reporting a count that does not add up.
 */
async function purgeLeads(ids) {
  const wanted = [...new Set((Array.isArray(ids) ? ids : []).filter(Boolean))];
  if (!wanted.length) return { deleted: [], blocked: new Map() };

  const blocked = await leadsWithCommercialRecords(wanted);
  const deletable = wanted.filter((id) => !blocked.has(id));
  if (!deletable.length) return { deleted: [], blocked };

  for (let offset = 0; offset < deletable.length; offset += BULK_DELETE_SLICE) {
    const slice = deletable.slice(offset, offset + BULK_DELETE_SLICE);
    const holes = slice.map(() => "?").join(", ");

    // The children first, so a failure part way through never leaves a row orphaned by a lead that
    // is already gone - the lead is the last thing removed.
    for (const table of LEAD_OWNED_TABLES) {
      try {
        await prisma.$executeRawUnsafe(`DELETE FROM \`${table}\` WHERE \`enquiry_id\` IN (${holes})`, ...slice);
      } catch (error) {
        console.warn(`Unable to clear ${table} for deleted leads:`, error?.message || error);
      }
    }
    for (const table of LEAD_UNLINKED_TABLES) {
      try {
        await prisma.$executeRawUnsafe(`UPDATE \`${table}\` SET \`enquiry_id\` = '' WHERE \`enquiry_id\` IN (${holes})`, ...slice);
      } catch (error) {
        console.warn(`Unable to unlink ${table} from deleted leads:`, error?.message || error);
      }
    }
    await prisma.$executeRawUnsafe(`DELETE FROM \`sales_crm_lead\` WHERE \`enquiry_id\` IN (${holes})`, ...slice);
  }
  return { deleted: deletable, blocked };
}

// Ids per statement, keeping each one well inside MySQL's placeholder and packet limits.
const STATUS_UPDATE_SLICE = 1000;

/*
 * The ceiling for the statements that are faster whole than sliced.
 *
 * The cost of removing a lead is the row rather than the statement, so splitting a selection into a
 * thousand at a time makes it slower - measured on the soft delete this replaced, ~5.4s in one
 * against ~7.5s in slices, for 17,573 leads. It matters more now: `purgeLeads` runs seven statements
 * per slice rather than one, so a small slice multiplies round trips as well as re-planning.
 *
 * This exists so a selection near the 200,000 the schema allows cannot build a statement MySQL
 * refuses - it is a ceiling, not a batch size.
 */
const BULK_DELETE_SLICE = 20000;

/**
 * Sets the status and follow-up date columns and nothing else.
 *
 * A bulk status change cannot go through updateCrmLead: that writes the whole record, so a
 * lead the browser has not loaded - which is most of them once "select all" covers a whole
 * branch - would be rewritten from an almost empty object and lose its name, phone and
 * every other field. Touching one column is also a single statement per slice rather than
 * one request per lead.
 *
 * The follow-up date travels with the status rather than in its own call because Update
 * Details offers the two together: sending them separately would double the statements and
 * leave a selection half-updated if the second one failed.
 */
/*
 * ── Moving leads to another vertical ──────────────────────────────────────────────────────────
 *
 * Bulk Update's Vertical: the selected leads leave the board they are on for another one.
 *
 * - **One number, one enquiry per vertical.** A lead whose number (either of its two) is already an
 *   enquiry in the target vertical - or is taken there by a lead moved earlier in the same batch -
 *   stays where it is and is reported, never moved into a duplicate. The rest move.
 * - **What only the old vertical asks is cleared**, as the studio chose: Dum Dum's wedding couple and
 *   reference, Qua Qua's baby / mother and the shoot it was booked for, Corp's company, and the old
 *   vertical's custom fields; leaving Qua Qua also drops its newborn and birthday occasions. What every
 *   vertical shares - name, numbers, status, owner, branch, source, budget, follow-ups, remarks - stays.
 * - **Qua Qua's "Converted & Followup" becomes "Converted"** anywhere else, the only status one
 *   vertical has and the others do not. And a Converted lead off Qua Qua carries no next follow-up
 *   (`endsTheConversation`), so it is cleared as every other write clears it.
 * - The Enquiry ID is kept: by now it is on quotations and messages, as `reissueEnquiryIdOnPlacement`
 *   explains for every vertical change but a call's first placement.
 * - `vertical` and its `vertical_id` move together; `board_key`, generated from the first, follows.
 */
const VERTICAL_ONLY_COLUMNS = {
  "Dum Dum": ["relationship", "groomName", "groomContact", "groomLocation", "brideName", "brideContact", "brideLocation", "referenceName", "referenceContact"],
  "Qua Qua": ["babyOrMotherName", "dateOfBirthOrEdod", "shootType", "ihOh", "shootId", "contactRepeated"],
  Corp: ["companyName", "primaryDecisionMaker", "designation", "contactNumber", "alternateMobileNumber", "officialEmailId", "companyWebsite", "companyType", "companySize", "branches", "projectType", "shootCity", "expectedBudget", "competitions"],
};
const MOVE_VERTICALS = ["Dum Dum", "Qua Qua", "Corp"];
// The board's reading of a lead's vertical: blank or unrecognised is Dum Dum (`board_key`).
const boardVertical = (value) => verticalFromValue(value) || "Dum Dum";

async function moveCrmLeadsToVertical(ids, vertical, actor = {}) {
  const target = verticalFromValue(vertical);
  if (!MOVE_VERTICALS.includes(target)) throw Object.assign(new Error("Choose Dum Dum, Qua Qua or Corp."), { status: 400 });
  const wanted = [...new Set((Array.isArray(ids) ? ids : []).map((id) => String(id || "").trim()).filter(Boolean))];
  if (!wanted.length) return { moved: 0, skipped: [], unchanged: 0 };

  const rows = [];
  for (let offset = 0; offset < wanted.length; offset += STATUS_UPDATE_SLICE) {
    const slice = wanted.slice(offset, offset + STATUS_UPDATE_SLICE);
    rows.push(...await prisma.$queryRawUnsafe(
      `SELECT \`enquiry_id\` AS \`enquiryId\`, \`phone\`, \`contact_number\` AS \`contactNumber\`, \`vertical\`, \`status\`
       FROM \`sales_crm_lead\` WHERE \`deleted_at\` IS NULL AND \`enquiry_id\` IN (${slice.map(() => "?").join(", ")})`,
      ...slice,
    ));
  }
  const moving = rows.filter((row) => boardVertical(row.vertical) !== target);
  const unchanged = rows.length - moving.length;
  if (!moving.length) return { moved: 0, skipped: [], unchanged };

  // The numbers the target vertical already holds, from leads not being moved now.
  const movingIds = new Set(moving.map((row) => row.enquiryId));
  const held = new Set();
  const there = await prisma.$queryRawUnsafe(
    "SELECT `enquiry_id` AS `enquiryId`, `phone`, `contact_number` AS `contactNumber`, `vertical` FROM `sales_crm_lead` WHERE `deleted_at` IS NULL",
  );
  for (const row of there) {
    if (movingIds.has(row.enquiryId) || boardVertical(row.vertical) !== target) continue;
    for (const value of [row.phone, row.contactNumber]) { const key = phoneMatchKey(value); if (key) held.add(key); }
  }
  const skipped = [];
  const accepted = [];
  for (const row of moving) {
    const keys = [row.phone, row.contactNumber].map(phoneMatchKey).filter(Boolean);
    const clash = keys.find((key) => held.has(key));
    if (clash) { skipped.push({ enquiryId: row.enquiryId, phone: row.phone || row.contactNumber || "" }); continue; }
    keys.forEach((key) => held.add(key));
    accepted.push(row);
  }
  if (!accepted.length) return { moved: 0, skipped, unchanged };

  const verticalId = (await referenceLookups()).verticalId(target) ?? null;
  // One statement per vertical the leads are leaving, since each clears its own columns.
  const bySource = new Map();
  for (const row of accepted) {
    const source = boardVertical(row.vertical);
    if (!bySource.has(source)) bySource.set(source, []);
    bySource.get(source).push(row);
  }
  let moved = 0;
  for (const [source, group] of bySource) {
    const cleared = (VERTICAL_ONLY_COLUMNS[source] || []).map((column) => `\`${DB_COLUMN[column]}\` = NULL`);
    const assignments = [
      "`vertical` = ?", "`vertical_id` = ?", "`custom_fields` = '{}'", ...cleared,
      // Converted & Followup is Qua Qua's alone; elsewhere it is Converted.
      ...(target !== "Qua Qua" ? ["`status` = CASE WHEN LOWER(REPLACE(REPLACE(TRIM(`status`), ' ', ''), '-', '')) IN ('converted&followup', 'convertedandfollowup', 'followup&converted') THEN 'Converted' ELSE `status` END"] : []),
      "`updated_at` = CURRENT_TIMESTAMP(3)",
    ];
    for (let offset = 0; offset < group.length; offset += STATUS_UPDATE_SLICE) {
      const slice = group.slice(offset, offset + STATUS_UPDATE_SLICE).map((row) => row.enquiryId);
      moved += Number(await prisma.$executeRawUnsafe(
        `UPDATE \`sales_crm_lead\` SET ${assignments.join(", ")} WHERE \`deleted_at\` IS NULL AND \`enquiry_id\` IN (${slice.map(() => "?").join(", ")})`,
        target, verticalId, ...slice,
      ) || 0);
      // A Converted lead off Qua Qua books no next call - the rule every other write keeps.
      if (target !== "Qua Qua") {
        await prisma.$executeRawUnsafe(
          `UPDATE \`sales_crm_lead\` SET \`next_follow_up_date\` = NULL, \`next_follow_up_time\` = NULL
           WHERE LOWER(TRIM(\`status\`)) = 'converted' AND \`enquiry_id\` IN (${slice.map(() => "?").join(", ")})`,
          ...slice,
        );
      }
      // Newborn and birthday occasions are Qua Qua's; a lead leaving it takes none along.
      if (source === "Qua Qua") {
        await prisma.$executeRawUnsafe(`DELETE FROM \`sales_crm_lead_occasion\` WHERE \`enquiry_id\` IN (${slice.map(() => "?").join(", ")})`, ...slice);
      }
    }
  }

  await recordBulkActivity(accepted.map((row) => ({
    enquiryId: row.enquiryId, action: "UPDATED", field: "vertical", fieldLabel: "Vertical",
    fromValue: boardVertical(row.vertical), toValue: target,
  })), actor);
  await sendCrmWebhook("crm.leads.vertical_changed", { ids: accepted.map((row) => row.enquiryId), vertical: target, count: moved });
  return { moved, skipped, unchanged };
}

async function setCrmLeadStatus(ids, changes = {}, actor = {}) {
  const status = changes.status ? String(changes.status).trim() : "";
  // Moving a lead to Converted is the last time it is followed up, so the day is stamped when the
  // dialog did not name one - the same as converting it from the popup or from a project.
  const lastFollowUpDate = changes.lastFollowUpDate
    ? String(changes.lastFollowUpDate).trim()
    : (isConvertedStatus(status) ? studioToday() : "");
  const nextFollowUpDate = changes.nextFollowUpDate ? String(changes.nextFollowUpDate).trim() : "";
  if (!status && !lastFollowUpDate && !nextFollowUpDate) return 0;

  /*
   * A selection can hold occasion leads and ordinary ones together, and a status means a different
   * thing to each: on a Qua Qua lead with a newborn or birthday window open it belongs to that
   * occasion, not to the lead. So the selection is split before anything is written - the occasions
   * get their occurrences, the rest get the UPDATE below, and neither half is touched twice.
   *
   * Next Follow-up Date is split the same way the status is, and for the same reason: on a lead
   * inside an occasion window it is when that occasion is being called back about, which is what
   * the follow-up tabs read off the occurrence. Last Follow-up Date is deliberately not split out.
   * It is the lead's own history of when it was last worked, which is true of the lead whatever
   * the call was about.
   */
  /*
   * A status that ends the conversation clears the next call rather than writing one.
   *
   * The bulk dialog can set a status without touching the date, so "leave this as it is" would have
   * left a Rejected lead carrying the call it was booked for - which is what the Pending Followups
   * tabs read, so it kept turning up on a worklist under a status saying it was over. The same rule
   * `flattenLeadColumns` states for every other write.
   *
   * Converted clears it only off Qua Qua, and a selection can span boards, so that one is decided
   * per row below (`board_key`) rather than here. Occasions are Qua Qua's alone, so Converted never
   * clears an occasion's date.
   */
  const clearsFollowUp = STATUSES_WITHOUT_FOLLOW_UP.some((ended) => sameStatus(ended, status));
  const clearsOffQuaQua = !clearsFollowUp && sameStatus(status, "Converted");

  const occasionChanges = {};
  if (status) occasionChanges.status = status;
  // Cleared on the occurrence too: an occasion lead's follow-up is read off the occasion, so
  // clearing only the lead's own pair would leave the date the dated tabs actually count.
  if (clearsFollowUp) occasionChanges.nextFollowUpDate = "";
  else if (nextFollowUpDate) occasionChanges.nextFollowUpDate = nextFollowUpDate;
  const workingOccasions = Object.keys(occasionChanges).length
    ? await occasionsBeingWorked(ids, changes.today)
    : new Map();
  if (workingOccasions.size) await writeOccurrences(workingOccasions, occasionChanges, actor);

  /*
   * Two writes rather than one, and only when the selection actually needs both.
   *
   * An occasion lead still takes Last Follow-up Date - it is the lead's own history - but must not
   * take the status or the next follow-up date, which have just been written against its occasion.
   * So the leads split into the ones getting everything and the ones getting that date alone, and a
   * selection with no occasions in it (every selection on every other board) is the single statement
   * it always was.
   *
   * Only the fields that were actually filled in are written either way. A blank one in the dialog
   * means "leave this as it is", so naming it would overwrite every selected lead with an empty
   * string instead.
   *
   * `sales_crm_lead.follow_up_day` - what the follow-up tabs actually compare - is a generated
   * column over `next_follow_up_date`, so writing the text column is the whole write here. The
   * occurrence's copy is not generated, which is why `writeOccurrences` sets it itself.
   */
  const statusAssignment = status ? { sql: "`status` = ?", value: status } : null;
  const dateAssignment = lastFollowUpDate ? { sql: "`last_follow_up_date` = ?", value: lastFollowUpDate } : null;
  /*
   * `value: null` rather than a `= NULL` with no placeholder: the values below are bound by
   * position from `set.map(entry => entry.value)`, so an assignment that binds nothing would shift
   * every parameter after it onto the wrong column.
   */
  const nextDateAssignment = clearsFollowUp
    ? { sql: "`next_follow_up_date` = ?", value: null }
    : clearsOffQuaQua
      // Qua Qua keeps its date, or takes the one the dialog gave; every other board is cleared.
      ? { sql: "`next_follow_up_date` = CASE WHEN `board_key` = 'quaqua' THEN COALESCE(?, `next_follow_up_date`) ELSE NULL END", value: nextFollowUpDate || null }
      : (nextFollowUpDate ? { sql: "`next_follow_up_date` = ?", value: nextFollowUpDate } : null);
  // The time goes with the date: half a booking is not a booking.
  const nextTimeAssignment = clearsFollowUp
    ? { sql: "`next_follow_up_time` = ?", value: null }
    : clearsOffQuaQua
      ? { sql: "`next_follow_up_time` = CASE WHEN `board_key` = 'quaqua' THEN `next_follow_up_time` ELSE ? END", value: null }
      : null;
  const passes = [];
  if (workingOccasions.size) {
    const plain = ids.filter((id) => !workingOccasions.has(String(id)));
    const onOccasion = ids.filter((id) => workingOccasions.has(String(id)));
    if (plain.length) passes.push({ ids: plain, set: [statusAssignment, dateAssignment, nextDateAssignment, nextTimeAssignment] });
    if (onOccasion.length && dateAssignment) passes.push({ ids: onOccasion, set: [dateAssignment] });
  } else {
    passes.push({ ids, set: [statusAssignment, dateAssignment, nextDateAssignment, nextTimeAssignment] });
  }

  // A status that landed entirely on occasions still changed something, which is what the count
  // has to say - otherwise the dialog reports that nothing happened.
  let updated = workingOccasions.size;
  for (const pass of passes) {
    const set = pass.set.filter(Boolean);
    if (!set.length) continue;
    const assignments = [...set.map((entry) => entry.sql), "`updated_at` = CURRENT_TIMESTAMP(3)"];
    const values = set.map((entry) => entry.value);
    for (let offset = 0; offset < pass.ids.length; offset += STATUS_UPDATE_SLICE) {
      const slice = pass.ids.slice(offset, offset + STATUS_UPDATE_SLICE);
      const affected = await prisma.$executeRawUnsafe(
        `UPDATE \`sales_crm_lead\` SET ${assignments.join(", ")}
         WHERE \`deleted_at\` IS NULL AND \`enquiry_id\` IN (${slice.map(() => "?").join(", ")})`,
        ...values,
        ...slice,
      );
      updated += Number(affected || 0);
    }
  }

  const entries = [];
  if (status) entries.push({ action: "UPDATED", field: "status", fieldLabel: "Status", toValue: status });
  if (lastFollowUpDate) entries.push({ action: "UPDATED", field: "lastFollowUpDate", fieldLabel: "Last Follow-up Date", toValue: lastFollowUpDate });
  if (nextFollowUpDate) entries.push({ action: "UPDATED", field: "nextFollowUpDate", fieldLabel: "Next Follow-up Date", toValue: nextFollowUpDate });

  // The log attributes each entry to the CRM owning the lead. Read for the whole selection in
  // slices rather than per lead: recordLeadActivity resolves that name with a SELECT each
  // time, which is the per-lead round trip this call exists to avoid. A lead with no CRM is
  // left without a name so the activity log falls back to its own default.
  const crmByLead = new Map();
  if (!actor.actorName) {
    for (let offset = 0; offset < ids.length; offset += STATUS_UPDATE_SLICE) {
      const slice = ids.slice(offset, offset + STATUS_UPDATE_SLICE);
      const rows = await prisma.$queryRawUnsafe(
        `SELECT \`enquiry_id\` AS \`enquiryId\`, \`crm\` FROM \`sales_crm_lead\`
         WHERE \`enquiry_id\` IN (${slice.map(() => "?").join(", ")})`,
        ...slice,
      );
      for (const row of rows) {
        const crm = String(row?.crm || "").trim();
        if (crm) crmByLead.set(String(row.enquiryId), crm);
      }
    }
  }

  await recordBulkActivity(
    ids.flatMap((id) => entries.map((entry) => ({ ...entry, enquiryId: id, actorName: actor.actorName || crmByLead.get(id) }))),
    actor,
  );

  await sendCrmWebhook("crm.leads.status_changed", { ids, status, lastFollowUpDate, nextFollowUpDate, count: updated });
  return updated;
}

/**
 * Shares leads out between CRMs, one at a time in turn.
 *
 * The first lead goes to the first CRM, the second to the second and so on, wrapping round -
 * so 10 leads across 3 CRMs land 4/3/3 rather than in blocks. Ordering follows the ids as
 * given, which is the order the table shows them in.
 *
 * One UPDATE per CRM rather than per lead: assigning a whole branch is a handful of
 * statements, not tens of thousands.
 */
async function assignCrmLeads(ids, crms, actor = {}) {
  const targets = (Array.isArray(crms) ? crms : []).map((name) => String(name || "").trim()).filter(Boolean);
  const leadIds = (Array.isArray(ids) ? ids : []).map((id) => String(id || "").trim()).filter(Boolean);
  if (!targets.length || !leadIds.length) return { assigned: 0, perCrm: {} };

  const buckets = new Map(targets.map((name) => [name, []]));
  leadIds.forEach((id, index) => {
    buckets.get(targets[index % targets.length]).push(id);
  });

  let assigned = 0;
  const perCrm = {};
  const activity = [];
  // The owner reference moves with the name: the same matcher the backfill used, once per call.
  const refs = await referenceLookups();
  for (const [crm, bucket] of buckets) {
    if (!bucket.length) continue;
    const ownerEmployeeId = refs.employeeId(crm);
    for (let offset = 0; offset < bucket.length; offset += STATUS_UPDATE_SLICE) {
      const slice = bucket.slice(offset, offset + STATUS_UPDATE_SLICE);
      const affected = await prisma.$executeRawUnsafe(
        `UPDATE \`sales_crm_lead\` SET \`crm\` = ?, \`owner_employee_id\` = ?, \`updated_at\` = CURRENT_TIMESTAMP(3)
         WHERE \`deleted_at\` IS NULL AND \`enquiry_id\` IN (${slice.map(() => "?").join(", ")})`,
        crm,
        ownerEmployeeId,
        ...slice,
      );
      assigned += Number(affected || 0);
    }
    perCrm[crm] = bucket.length;
    for (const id of bucket) {
      activity.push({ enquiryId: id, action: "UPDATED", field: "crm", fieldLabel: "CRM", toValue: crm, actorName: crm });
    }
  }

  await recordBulkActivity(activity, actor);
  /*
   * And the people themselves are told, one notice per lead they were given.
   *
   * `buckets` rather than `perCrm`: the latter is the count per CRM, which the webhook wants and a
   * notice cannot be built from - a bell saying "you were given 12" with nothing to open is a line
   * to dismiss rather than work to pick up. See leadNotifications.js.
   *
   * Awaited, so a failure is logged where it happened, and swallowed inside, so an assignment that
   * has already been written is never reported as a failure because the bell could not be rung.
   */
  await notifyLeadsAssigned(Object.fromEntries(buckets), { actorId: actor?.actorUserId ?? null });
  await sendCrmWebhook("crm.leads.assigned", { count: assigned, perCrm });
  return { assigned, perCrm };
}

/**
 * Records who created these leads, once.
 *
 * A separate statement rather than a column on the upsert: every write path here goes through the
 * same INSERT ... ON DUPLICATE KEY UPDATE, and a creator listed there would be rewritten by the
 * next edit - so the person who entered a lead would become whoever last touched it. `IS NULL`
 * makes it write once and never again, which is what a creator is.
 *
 * Silent where there is no actor: the Google Sheet poller and the Callyzer webhook create leads
 * with nobody signed in, and those genuinely have no creator to record.
 */
async function stampCrmLeadCreator(ids, userId) {
  const actor = Number(userId) || null;
  const list = (Array.isArray(ids) ? ids : [ids]).map((id) => String(id || "").trim()).filter(Boolean);
  if (!actor || !list.length) return 0;
  return prisma.$executeRawUnsafe(
    `UPDATE \`sales_crm_lead\` SET \`created_by_user_id\` = ?
      WHERE \`created_by_user_id\` IS NULL AND \`enquiry_id\` IN (${list.map(() => "?").join(", ")})`,
    actor,
    ...list,
  );
}

async function renameCrmLeadGroup(groupId, groupName) {
  const updatedRecords = await sheets.renameCrmLeadGroup(groupId, groupName);
  await syncMysqlRecords(updatedRecords);
  await sendCrmWebhook("crm.group.renamed", { groupId, groupName, records: updatedRecords });
  return updatedRecords;
}

module.exports = { PROJECT_DELETED_SQL, PROJECT_DELETED_STATUS,
  ENQUIRY_ID_REFERENCES,
  getCrmLeadById,
  listLeadsSharingPhone,
  CRM_LEAD_SQL_COLUMNS,
  // The code name -> database column pairs, so the query builder names columns the same way.
  DB_COLUMN,
  CRM_LEAD_SELECT_COLUMNS,
  // The ready-made SELECT list, so a query written outside this file cannot name the columns the
  // way they were spelled before the snake_case migration.
  CRM_LEAD_SELECT_LIST,
  stampStudioTime,
  RESOLVED_LEAD_SQL,
  leadColumnSql,
  // The one definition of "the same client's number", shared with the Callyzer webhook so a
  // delivery matches exactly the leads the CRM would call duplicates.
  phoneMatchKey,
  // Shared with the Callyzer webhook, so a call's outcome cannot turn a converted lead back into
  // an open one - the same rule `markCrmLeadConverted` applies here.
  CONVERTED_STATUS_KEYS,
  toRecord,
  flattenLeadColumns,
  referenceEntries,
  stampCrmLeadCreator,
  getCrmLeadVersion,
  listCrmLeads,
  listCrmLeadProjects,
  findVerticalDuplicate,
  createCrmLead,
  createCrmLeads,
  updateCrmLead,
  markCrmLeadConverted,
  deleteCrmLead,
  deleteCrmLeads,
  setCrmLeadStatus,
  moveCrmLeadsToVertical,
  VERTICAL_ONLY_COLUMNS,
  assignCrmLeads,
  renameCrmLeadGroup,
  ensureCrmLeadColumns,
  migrateCrmLeadLegacyColumns,
};
