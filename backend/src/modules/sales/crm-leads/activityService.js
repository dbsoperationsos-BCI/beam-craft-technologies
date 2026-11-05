const prisma = require("../../../config/db");

/**
 * A per-lead history of what changed, who changed it and when.
 *
 * One row per field, not per save: a single edit that touches three fields reads as three
 * lines, which is what makes the log answerable ("who set this to Converted?") rather than
 * a wall of JSON blobs.
 */

const CREATE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS \`sales_crm_lead_activity\` (
  \`id\` VARCHAR(191) NOT NULL,
  \`enquiry_id\` VARCHAR(100) NOT NULL,
  \`action\` VARCHAR(30) NOT NULL,
  \`field\` VARCHAR(100) NULL,
  \`field_label\` VARCHAR(150) NULL,
  \`from_value\` TEXT NULL,
  \`to_value\` TEXT NULL,
  \`source\` VARCHAR(30) NOT NULL DEFAULT 'app',
  \`actor_user_id\` INT NULL,
  \`actor_name\` VARCHAR(191) NULL,
  \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (\`id\`),
  INDEX \`sales_crm_lead_activity_lead_idx\` (\`enquiry_id\`, \`created_at\`),
  INDEX \`sales_crm_lead_activity_created_at_idx\` (\`created_at\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;

let tableReady = null;
async function ensureActivityTable() {
  if (!tableReady) {
    tableReady = prisma.$executeRawUnsafe(CREATE_TABLE_SQL).catch((error) => {
      tableReady = null;
      throw error;
    });
  }
  return tableReady;
}

// Column name -> the label the CRM shows for it, so the log reads the way the table does.
const FIELD_LABELS = {
  name: "Enquiry Name",
  phone: "Phone Number",
  // Only reaches the log now that the field actually saves - before that there was never a
  // difference to record, so it had never shown up as a raw key.
  whatsappNumber: "WhatsApp Number",
  contactNumber: "Contact Number",
  alternateMobileNumber: "Alternate Mobile Number",
  vertical: "Verticals",
  assignedBranch: "Nearest Branch",
  status: "Status",
  crm: "CRM",
  addedTime: "Added Time",
  createdDate: "Created Date",
  relationship: "Relationship",
  referredFrom: "Referred From",
  offerType: "Offer Type",
  campaignName: "Campaign Name",
  adsetName: "Adset Name",
  adName: "Ad Name",
  preferredBudget: "Preferred Budget",
  estimatedValue: "Estimated Value",
  expectedBudget: "Expected Budget",
  city: "City",
  state: "State",
  source: "Source",
  eventPlannedType: "Type of Event Planned",
  eventPlannedDate: "When is the Event Planned",
  groomName: "Groom Name",
  groomContact: "Groom Contact",
  groomLocation: "Groom Location",
  brideName: "Bride Name",
  brideContact: "Bride Contact",
  brideLocation: "Bride Location",
  referenceName: "Referenced Person Name",
  referenceContact: "Referenced Person Contact",
  remarks: "Remarks",
  contactRepeated: "Contact Repeated",
  shootType: "Shoot Type",
  location: "Location",
  ihOh: "IH/OH",
  lastFollowUpDate: "Last Follow-up Date",
  nextFollowUpDate: "Next Follow-up Date",
  nextFollowUpTime: "Next Follow-up Time",
  lastConvertedDate: "Last Converted Date",
  shootId: "Shoot ID",
  date: "Date",
  babyOrMotherName: "Baby (or) Mother Name",
  dateOfBirthOrEdod: "Date of Birth (or) EDOD",
  companyName: "Company Name",
  primaryDecisionMaker: "Primary Decision-maker",
  designation: "Designation",
  officialEmailId: "Official Email ID",
  companyWebsite: "Company Website",
  companyType: "Company Type",
  companySize: "Company Size",
  branches: "Branches",
  projectType: "Project Type",
  shootCity: "Shoot City",
  competitions: "Competitions",
  shoots: "Shoot Details",
  remarkEntries: "Remarks",
  attachments: "Attachments",
};

// Bookkeeping the user never edits. Logging these would bury the changes that matter.
const IGNORED_FIELDS = new Set([
  "lastSourceSyncAt",
  "sourceRowNumber",
  "sourceEnquiryId",
  "spreadsheetId",
  "gid",
  "targetTab",
  "systemTableId",
]);

const MAX_VALUE_LENGTH = 500;

// Fields worth naming as an event in their own right rather than "X changed".
const FIELD_ACTIONS = {
  status: "STATUS_CHANGED",
  nextFollowUpDate: "FOLLOWUP_CHANGED",
  nextFollowUpTime: "FOLLOWUP_CHANGED",
  lastFollowUpDate: "FOLLOWUP_CHANGED",
  lastConvertedDate: "FOLLOWUP_CHANGED",
  attachments: "ATTACHMENTS_CHANGED",
  shoots: "SHOOTS_CHANGED",
};

// `remarks` holds a flattened summary of `remarkEntries`; logging both would double every
// note. The entries are the record, so they are the ones that get logged.
const DERIVED_FIELDS = new Set(["remarks"]);

function parseEntries(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function remarkAttachmentSummary(entry) {
  const files = Array.isArray(entry?.attachments) ? entry.attachments : [];
  const names = files.map((file) => String(file?.name || "").trim()).filter(Boolean);
  return names.length ? `Attached ${names.join(", ")}` : "";
}

// Remarks are append-mostly, so the useful event is "this note was added", not a diff of
// the whole JSON array.
function remarkChanges(before, after) {
  const seen = new Set(parseEntries(before).map((entry) => String(entry?.id || entry?.text || "")));
  return parseEntries(after)
    .filter((entry) => !seen.has(String(entry?.id || entry?.text || "")))
    .map((entry) => ({
      action: "REMARK_ADDED",
      field: "remarkEntries",
      fieldLabel: "Remarks",
      fromValue: null,
      // A remark can be a file with no words - "here is the reference they sent" - so the
      // log falls back to what was clipped to it rather than recording an empty change.
      toValue: truncate(entry?.text || remarkAttachmentSummary(entry)),
      createdAt: entry?.createdAt || null,
    }));
}

function normalize(value) {
  if (value === null || value === undefined) return "";
  return String(value);
}

function truncate(value) {
  const text = normalize(value);
  return text.length > MAX_VALUE_LENGTH ? `${text.slice(0, MAX_VALUE_LENGTH - 1)}…` : text;
}

/**
 * The fields that actually differ between two flattened lead rows.
 *
 * JSON-backed columns (remarks, shoots, attachments) are compared as text, so an edit that
 * re-serialises the same content does not register as a change.
 */
function diffLeadColumns(before = {}, after = {}) {
  const changes = [];
  for (const field of Object.keys(after)) {
    if (IGNORED_FIELDS.has(field) || DERIVED_FIELDS.has(field)) continue;
    const from = normalize(before?.[field]);
    const to = normalize(after?.[field]);
    if (from === to) continue;
    if (field === "remarkEntries") {
      changes.push(...remarkChanges(before?.[field], after?.[field]));
      continue;
    }
    changes.push({
      action: FIELD_ACTIONS[field] || "UPDATED",
      field,
      fieldLabel: FIELD_LABELS[field] || field,
      fromValue: truncate(from),
      toValue: truncate(to),
    });
  }
  return changes;
}

// MySQL's CURRENT_TIMESTAMP(3) writes the server's wall clock (IST here) into a DATETIME,
// which the driver then reads back tagged as UTC - so the value is 5h30 adrift the moment
// it is formatted. Remarks arriving from the browser carry a genuine UTC instant, so the
// two sources disagreed. Everything is written as UTC wall clock instead, which makes the
// stored value a real instant that any timezone can be rendered from.
function toUtcDatetime(value) {
  const when = value ? new Date(value) : new Date();
  const safe = Number.isNaN(when.getTime()) ? new Date() : when;
  return safe.toISOString().slice(0, 23).replace("T", " ");
}

function randomId() {
  return `act-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Writes activity rows. Never allowed to fail the operation it is describing: a lead edit
 * that saved correctly must not be reported as failed because its history could not be
 * written.
 */
/**
 * Who the entry is attributed to: the CRM the lead is assigned to.
 *
 * Not the signed-in account. The log is read by the sales team, for whom "which CRM owns
 * this lead" is the useful name; an unassigned lead reads as "User" rather than showing a
 * login address. Cached per lead for the life of a write batch only.
 */
const UNASSIGNED_ACTOR = "User";

async function resolveActorName(context = {}, enquiryId = "") {
  if (context.actorName) return String(context.actorName).slice(0, 191);
  try {
    const [lead] = await prisma.$queryRawUnsafe(
      "SELECT `crm` FROM `sales_crm_lead` WHERE `enquiry_id` = ? LIMIT 1",
      String(enquiryId),
    );
    const crm = String(lead?.crm || "").trim();
    return crm ? crm.slice(0, 191) : UNASSIGNED_ACTOR;
  } catch (error) {
    console.warn("Unable to resolve the activity actor name:", error?.message || error);
    return UNASSIGNED_ACTOR;
  }
}

async function recordLeadActivity(enquiryId, entries, context = {}) {
  const rows = (Array.isArray(entries) ? entries : [entries]).filter(Boolean);
  if (!enquiryId || !rows.length) return 0;

  try {
    await ensureActivityTable();
    const actorName = await resolveActorName(context, enquiryId);
    const values = [];
    const placeholders = [];
    for (const row of rows) {
      placeholders.push("(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
      values.push(
        randomId(),
        String(enquiryId),
        String(row.action || "UPDATED").slice(0, 30),
        row.field ? String(row.field).slice(0, 100) : null,
        row.fieldLabel ? String(row.fieldLabel).slice(0, 150) : null,
        row.fromValue ?? null,
        row.toValue ?? null,
        String(context.source || "app").slice(0, 30),
        Number.isFinite(Number(context.actorUserId)) ? Number(context.actorUserId) : null,
        actorName,
        toUtcDatetime(row.createdAt),
      );
    }
    await prisma.$executeRawUnsafe(
      `INSERT INTO \`sales_crm_lead_activity\`
       (\`id\`, \`enquiry_id\`, \`action\`, \`field\`, \`field_label\`, \`from_value\`, \`to_value\`, \`source\`, \`actor_user_id\`, \`actor_name\`, \`created_at\`)
       VALUES ${placeholders.join(", ")}`,
      ...values,
    );
    return rows.length;
  } catch (error) {
    console.warn("Unable to record CRM lead activity for", enquiryId, error?.message || error);
    return 0;
  }
}

/**
 * The log for one lead, newest first.
 *
 * Remarks written before this log existed are folded in from the lead's own stored entries,
 * which carry their own timestamps - so a lead that already had notes shows its history
 * rather than starting empty. Anything already logged is not repeated.
 */
/**
 * The same as recordLeadActivity but across many leads at once, for bulk actions.
 * `rows` are { enquiryId, action, field, fieldLabel, fromValue, toValue }.
 *
 * Written in slices rather than one insert per lead: assigning a whole branch is tens of
 * thousands of rows, and a statement each would take minutes.
 */
const ACTIVITY_INSERT_SLICE = 500;

async function recordBulkActivity(rows, context = {}) {
  const entries = (Array.isArray(rows) ? rows : []).filter((row) => row && row.enquiryId);
  if (!entries.length) return 0;

  try {
    await ensureActivityTable();
    let written = 0;
    for (let offset = 0; offset < entries.length; offset += ACTIVITY_INSERT_SLICE) {
      const slice = entries.slice(offset, offset + ACTIVITY_INSERT_SLICE);
      const values = [];
      const placeholders = [];
      for (const row of slice) {
        placeholders.push("(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
        values.push(
          randomId(),
          String(row.enquiryId),
          String(row.action || "UPDATED").slice(0, 30),
          row.field ? String(row.field).slice(0, 100) : null,
          row.fieldLabel ? String(row.fieldLabel).slice(0, 150) : null,
          row.fromValue ?? null,
          row.toValue ?? null,
          String(context.source || "app").slice(0, 30),
          Number.isFinite(Number(context.actorUserId)) ? Number(context.actorUserId) : null,
          // The log names the CRM the lead is assigned to, which for an assignment is the
          // CRM it has just been given.
          row.actorName ? String(row.actorName).slice(0, 191) : UNASSIGNED_ACTOR,
          toUtcDatetime(row.createdAt),
        );
      }
      await prisma.$executeRawUnsafe(
        `INSERT INTO \`sales_crm_lead_activity\`
         (\`id\`, \`enquiry_id\`, \`action\`, \`field\`, \`field_label\`, \`from_value\`, \`to_value\`, \`source\`, \`actor_user_id\`, \`actor_name\`, \`created_at\`)
         VALUES ${placeholders.join(", ")}`,
        ...values,
      );
      written += slice.length;
    }
    return written;
  } catch (error) {
    console.warn("Unable to record bulk CRM lead activity:", error?.message || error);
    return 0;
  }
}

async function listLeadActivity(enquiryId, limit = 200) {
  await ensureActivityTable();
  const size = Math.min(Math.max(Number(limit) || 200, 1), 500);
  const rows = await prisma.$queryRawUnsafe(
    `SELECT id, enquiry_id AS enquiryId, action, field, field_label AS fieldLabel,
            from_value AS fromValue, to_value AS toValue, source,
            actor_user_id AS actorUserId, actor_name AS actorName, created_at AS createdAt
     FROM \`sales_crm_lead_activity\`
     WHERE enquiry_id = ?
     ORDER BY created_at DESC, id DESC
     LIMIT ${size}`,
    String(enquiryId),
  );

  const logged = rows.map((row) => ({
    ...row,
    createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : null,
  }));
  // The driver reads a DATETIME back as a Date whose UTC parts are exactly the characters
  // stored, and those characters are UTC - so the ISO string above is already correct.

  const alreadyLogged = new Set(
    logged.filter((row) => row.action === "REMARK_ADDED").map((row) => String(row.toValue || "").trim()),
  );

  let historic = [];
  try {
    const [lead] = await prisma.$queryRawUnsafe(
      "SELECT `remark_entries` AS `remarkEntries` FROM `sales_crm_lead` WHERE `enquiry_id` = ? LIMIT 1",
      String(enquiryId),
    );
    historic = parseEntries(lead?.remarkEntries)
      .filter((entry) => {
        const text = String(entry?.text || "").trim();
        return text && !alreadyLogged.has(text);
      })
      .map((entry) => ({
        id: `remark-${entry.id || entry.createdAt || Math.random().toString(36).slice(2)}`,
        enquiryId: String(enquiryId),
        action: "REMARK_ADDED",
        field: "remarkEntries",
        fieldLabel: "Remarks",
        fromValue: null,
        toValue: truncate(entry.text),
        source: "app",
        actorUserId: null,
        actorName: entry.actorName || null,
        createdAt: entry.createdAt ? new Date(entry.createdAt).toISOString() : null,
      }));
  } catch (error) {
    console.warn("Unable to fold stored remarks into the activity log:", error?.message || error);
  }

  return [...logged, ...historic]
    .sort((left, right) => new Date(right.createdAt || 0) - new Date(left.createdAt || 0))
    .slice(0, size);
}

module.exports = {
  FIELD_LABELS,
  diffLeadColumns,
  ensureActivityTable,
  listLeadActivity,
  recordLeadActivity,
  recordBulkActivity,
};
