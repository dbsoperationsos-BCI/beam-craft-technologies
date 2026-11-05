const { google } = require("googleapis");
const prisma = require("../../../config/db");
const { advanceSequence, contextFromKey, formatIdentifier, parseIdentifier, sequenceKey } = require("../../../services/identifiers");
const { getGoogleSheetConnectionForUser } = require("../google-oauth/service");

// An enquiry id this application issued, whatever branch and vertical it names. A sheet may carry
// one in its own Enquiry ID column - a lead exported and re-imported - and it is kept rather than
// re-issued, which is what stops a round trip through a spreadsheet duplicating a lead.
const CRM_ID_PATTERN = /^DBS-EID-(DD|QQ|CORP)-[A-Z]+-\d{6}$/;
const DEFAULT_TIMEOUT_MS = 15000;
// How many "row 12 - Lead name is required" lines a sync keeps on the link. Enough to correct a
// handful in one go, few enough that a wholly invalid sheet cannot write a huge summary every
// two minutes. The counts beside them are not capped.
const ROW_PROBLEM_LIMIT = 5;
const GOOGLE_SHEET_HOST_RE = /(^|\.)docs\.google\.com$/i;
const SYNC_INTERVAL_MINUTES = Math.max(1, Number(process.env.GOOGLE_SHEETS_SYNC_INTERVAL_MINUTES || 5));
const SYNC_INTERVAL_MS = SYNC_INTERVAL_MINUTES * 60 * 1000;
const GOOGLE_SHEETS_API_RE = /(?:googleapis\.com\/v4\/spreadsheets|sheets\.googleapis\.com)/i;
const { DB_COLUMN } = require("./crmLeadColumns");
const { normalizeDateText, splitDayAndTime, toIsoDay, LEAD_DATE_COLUMNS } = require("./leadDates");
const { lookups: referenceLookups } = require("../../../services/referenceMatchers");
const { buildAssignmentMatcher } = require("./leadAssignmentRules");
const { listRulesForLink, recordAssignedCounts } = require("../google-sheet-links/rulesStore");
const { loadCoverContext, buildCoverResolver } = require("../../../services/leadCover");

/**
 * The database's name for one of the columns below.
 *
 * These names are the ones the rest of this module works in; the table speaks snake_case. Every
 * raw query here goes through this rather than interpolating the code name, which is what made
 * the sheet import fail with "Unknown column 'enquiryId'" after the conversion.
 */
function dbColumn(column) {
  const name = DB_COLUMN[column];
  if (!name) throw new Error(`No database column is mapped for "${column}".`);
  return name;
}

const CRM_LEAD_COLUMNS = [
  "enquiryId",
  "name",
  "phone",
  "whatsappNumber",
  "vertical",
  "status",
  "crm",
  "addedTime",
  "createdDate",
  "relationship",
  "referredFrom",
  "offerType",
  "campaignName",
  "adsetName",
  "adName",
  "preferredBudget",
  "estimatedValue",
  "city",
  "state",
  "source",
  "assignedBranch",
  "eventPlannedType",
  "eventPlannedDate",
  "groomName",
  "groomContact",
  "groomLocation",
  "brideName",
  "brideContact",
  "brideLocation",
  "referenceName",
  "referenceContact",
  "remarks",
  "contactRepeated",
  "shootType",
  "location",
  "ihOh",
  "lastFollowUpDate",
  "nextFollowUpDate",
  "lastConvertedDate",
  "shootId",
  "date",
  "babyOrMotherName",
  "dateOfBirthOrEdod",
  "companyName",
  "primaryDecisionMaker",
  "designation",
  "contactNumber",
  "alternateMobileNumber",
  "officialEmailId",
  "companyWebsite",
  "companyType",
  "companySize",
  "branches",
  "projectType",
  "shootCity",
  "expectedBudget",
  "competitions",
  "sourceEnquiryId",
  "sourceRowNumber",
  "spreadsheetId",
  "gid",
  "targetTab",
  "systemTableId",
  "lastSourceSyncAt",
];

const VERTICAL_CONFIG = {
  "Dum Dum": {
    systemTableId: "crm-table-dum-dum",
    vertical: "Dum Dum",
  },
  "Qua Qua": {
    systemTableId: "crm-table-qua-qua",
    vertical: "Qua Qua",
  },
  Corp: {
    systemTableId: "crm-table-corp",
    vertical: "Corp",
  },
};

const CRM_FIELD_ALIASES = {
  id: ["enquiryid", "leadid", "id", "crmleadid"],
  name: ["name", "leadname", "enquirname", "enquiryname", "clientname", "customername"],
  phone: ["phone", "phonenumber", "mobile", "mobilenumber", "contactnumber", "whatsappnumber"],
  // The vertical, and only columns that name one. "Nearest Branch" is a city - Erode, Hyderabad -
  // and belongs to `assignedBranch` below, but it was listed here too and fields claim columns in
  // declaration order, so this one took it first: every imported lead lost its Nearest Branch, and
  // a cell that happened to read "WED" was taken for the lead's vertical instead.
  vertical: ["verticals", "vertical", "vertical"],
  status: ["status", "leadstatus"],
  crm: ["crm"],
  addedTime: ["addedtime", "addedtimestamp", "createdtime", "createdtimestamp"],
  // "Enquiry Date" is the heading every CSV template writes for the day the enquiry came in,
  // and it is this column it belongs in - nothing else claims it, and the Enquiry Date the table
  // shows falls back to it. Without the alias the column imported into nothing at all.
  createdDate: ["createddate", "datecreated", "enquirydate"],
  relationship: ["relationship"],
  referredFrom: ["referredfrom", "referredform"],
  offerType: ["offertype"],
  campaignName: ["campaignname"],
  adsetName: ["adsetname"],
  adName: ["adname"],
  preferredBudget: ["preferredbudget", "budget"],
  // Only its own spelling: "budget" already belongs to Preferred Budget above, and fields claim
  // columns in declaration order, so sharing it would take that column off the field that had it.
  estimatedValue: ["estimatedvalue"],
  city: ["city"],
  state: ["state"],
  source: ["source", "leadsource", "enquirysource"],
  assignedBranch: ["assignedbranch", "nearestbranch"],
  // "shoottype" belongs to shootType. Listing it here too let eventPlannedType claim the
  // Shoot Type column first (fields are matched in declaration order and a column can
  // only be used once), leaving the Qua Qua table's Shoot Type column empty.
  eventPlannedType: ["eventplannedtype", "typeofeventplanned", "eventtype"],
  eventPlannedDate: ["eventplanneddate", "whenistheeventplanned", "shootdate", "functiondate"],
  groomName: ["groomname"],
  groomContact: ["groomcontact"],
  groomLocation: ["groomlocation"],
  brideName: ["bridename"],
  brideContact: ["bridecontact"],
  brideLocation: ["bridelocation"],
  referenceName: ["referencename", "referencedpersonname"],
  referenceContact: ["referencecontact", "referencedpersoncontact"],
  remarks: ["remarks", "notes", "comments"],
  contactRepeated: ["contactrepeated"],
  shootType: ["shoottype"],
  location: ["location"],
  ihOh: ["ihoh"],
  lastFollowUpDate: ["lastfollowupdate"],
  nextFollowUpDate: ["nextfollowupdate"],
  lastConvertedDate: ["lastconverteddate"],
  shootId: ["shootid"],
  date: ["date"],
  babyOrMotherName: ["babyormothername", "babyname", "mothername"],
  dateOfBirthOrEdod: ["dateofbirthoredod", "dob", "edod"],
  companyName: ["companyname", "clientorganisation", "clientorganization", "companynameorclientorganisation"],
  primaryDecisionMaker: ["primarydecisionmaker", "primarydecisionmakercontact"],
  designation: ["designation"],
  // Qua Qua's table heads this column "Contact" while the others write "Contact Number"; both
  // are the same field. `phone` is resolved first and takes "Phone Number", so the two never
  // compete for one column.
  contactNumber: ["contactnumber", "contact"],
  alternateMobileNumber: ["alternatemobilenumber"],
  officialEmailId: ["officialemailid", "email", "emailid", "emailaddress"],
  companyWebsite: ["companywebsite", "website"],
  companyType: ["companytype"],
  companySize: ["companysize"],
  branches: ["branches"],
  projectType: ["projecttype"],
  shootCity: ["shootcity"],
  expectedBudget: ["expectedbudget"],
  competitions: ["competitions"],
};

const CRM_FIELD_ORDER = Object.keys(CRM_FIELD_ALIASES);
const CRM_REQUIRED_FIELDS = [];

function normalizeText(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function normalizeHeaderForMatching(value) {
  return normalizeText(value).replace(/^(the|a|an)/, "");
}

function normalizePhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 11 && digits.startsWith("0")) return `91${digits.slice(1)}`;
  return digits.startsWith("91") && digits.length >= 12 ? digits : digits.replace(/^91(?=\d{10}$)/, "91");
}

function isLikelyCsv(text) {
  const sample = String(text || "").slice(0, 2000).toLowerCase();
  return sample.includes(",") && !sample.includes("<html");
}

function escapeSheetName(sheetName) {
  return `'${String(sheetName || "").replace(/'/g, "''")}'`;
}

function normalizeSheetRows(values = []) {
  const rows = Array.isArray(values) ? values : [];
  const headerRowIndex = rows.findIndex((row) => Array.isArray(row) && row.some((cell) => String(cell || "").trim() !== ""));
  if (headerRowIndex < 0) {
    return {
      headers: [],
      rows: [],
      totalRows: 0,
      headerRowNumber: null,
    };
  }

  const headers = rows[headerRowIndex].map((cell) => String(cell || "").trim());
  const normalizedRows = [];
  for (let index = headerRowIndex + 1; index < rows.length; index += 1) {
    const row = Array.isArray(rows[index]) ? rows[index] : [];
    if (!row.some((cell) => String(cell || "").trim() !== "")) continue;
    const normalizedValues = headers.map((_, headerIndex) => String(row[headerIndex] ?? "").trim());
    normalizedRows.push({
      rowNumber: index + 1,
      values: normalizedValues,
    });
  }

  return {
    headers,
    rows: normalizedRows,
    totalRows: normalizedRows.length,
    headerRowNumber: headerRowIndex + 1,
  };
}

function parseGoogleSheetUrl(input) {
  const raw = String(input || "").trim();
  if (!raw) {
    const error = new Error("Google Sheet URL is required.");
    error.status = 400;
    throw error;
  }

  let url;
  try {
    url = new URL(raw);
  } catch {
    const error = new Error("Google Sheet URL is malformed.");
    error.status = 400;
    throw error;
  }

  if (!GOOGLE_SHEET_HOST_RE.test(url.hostname)) {
    const error = new Error("Google Sheet URL must be a docs.google.com spreadsheet link.");
    error.status = 400;
    throw error;
  }

  const match = url.pathname.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/i);
  if (!match?.[1]) {
    const error = new Error("Google Sheet URL does not contain a spreadsheet ID.");
    error.status = 400;
    throw error;
  }

  const gid = url.searchParams.get("gid") || "";
  return { spreadsheetId: match[1], gid, url };
}

function sheetExportUrl({ spreadsheetId, gid = "", sheetName = "" }) {
  if (sheetName) {
    const encodedSheet = encodeURIComponent(sheetName);
    return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:csv&sheet=${encodedSheet}`;
  }
  if (gid) {
    return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv&gid=${encodeURIComponent(gid)}`;
  }
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv`;
}

function parseCsv(text) {
  const input = String(text || "").replace(/^\uFEFF/, "");
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (character === '"') {
      if (quoted && input[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (character === "," && !quoted) {
      row.push(value);
      value = "";
      continue;
    }
    if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && input[index + 1] === "\n") index += 1;
      row.push(value);
      if (row.some((cell) => String(cell || "").trim() !== "")) rows.push(row.map((cell) => String(cell || "").trim()));
      row = [];
      value = "";
      continue;
    }
    value += character;
  }

  if (quoted) {
    const error = new Error("Google Sheet CSV has an unterminated quoted field.");
    error.status = 400;
    throw error;
  }

  row.push(value);
  if (row.some((cell) => String(cell || "").trim() !== "")) rows.push(row.map((cell) => String(cell || "").trim()));
  return rows;
}

function buildHeaderMap(row) {
  return new Map(row.map((header, index) => [normalizeText(header), index]));
}

function resolveColumnMapping(headers = [], branchHint = "") {
  const headerEntries = Array.isArray(headers)
    ? headers.map((header, index) => ({
        columnIndex: index,
        sourceHeader: String(header || ""),
        normalizedHeader: normalizeHeaderForMatching(header),
      }))
    : [];
  const mapping = {};
  const usedColumns = new Set();

  const takeFirstMatch = (fieldName, candidates) => {
    for (const candidate of candidates) {
      const found = headerEntries.find((entry) => !usedColumns.has(entry.columnIndex) && entry.normalizedHeader === normalizeHeaderForMatching(candidate));
      if (found) {
        mapping[fieldName] = {
          columnIndex: found.columnIndex,
          sourceHeader: found.sourceHeader,
        };
        usedColumns.add(found.columnIndex);
        return true;
      }
    }
    return false;
  };

  for (const fieldName of CRM_FIELD_ORDER) {
    const aliases = CRM_FIELD_ALIASES[fieldName] || [];
    const exactAlias = aliases.find((alias) => alias === fieldName.toLowerCase());
    if (exactAlias) {
      const exactMatch = headerEntries.find((entry) => !usedColumns.has(entry.columnIndex) && entry.normalizedHeader === normalizeHeaderForMatching(fieldName));
      if (exactMatch) {
        mapping[fieldName] = {
          columnIndex: exactMatch.columnIndex,
          sourceHeader: exactMatch.sourceHeader,
        };
        usedColumns.add(exactMatch.columnIndex);
        continue;
      }
    }
    takeFirstMatch(fieldName, [fieldName, ...aliases]);
  }

  const unmappedHeaders = headerEntries.filter((entry) => !usedColumns.has(entry.columnIndex)).map((entry) => entry.sourceHeader);
  const missingRequiredFields = CRM_REQUIRED_FIELDS.filter((field) => !mapping[field]);
  return {
    fields: mapping,
    headers: headerEntries.map((entry) => entry.sourceHeader),
    unmappedHeaders,
    missingRequiredFields,
    branchHint: String(branchHint || "").trim(),
  };
}

/*
 * The clock time inside an Enquiry Date cell, where the sheet states the enquiry as one stamp -
 * `10-Sep-26 10:57 am` - instead of a date column and an Added Time column beside it.
 *
 * Only where the cell really is a date: a remark that happens to mention an hour ("call back at
 * 10:57") is a note somebody left in the wrong column, and reading a time off it would put an
 * Added Time on the lead that nobody stated. The day has to parse for the time to count.
 */
function enquiryStampTime(value) {
  const { day, clock } = splitDayAndTime(value);
  return clock && toIsoDay(day) ? clock : "";
}

function getMappedRowValue(row, mapping, fieldName) {
  const entry = mapping?.fields?.[fieldName];
  if (!entry || entry.columnIndex === undefined) return "";
  return String(row[entry.columnIndex] ?? "").trim();
}

function mapRowToCrmCandidate(row = [], mapping = {}, link = {}, rowNumber = 0, leadIds = createLeadIdAllocator(), existingById = new Map(), existingByPhone = new Map()) {
  const candidateHeaders = Array.isArray(mapping?.headers) ? mapping.headers : [];
  const detectedVertical = mapping?.detectedVertical || detectVerticalFromHeaders(new Map(candidateHeaders.map((header, index) => [normalizeText(header), index])));
  // The row's own vertical column decides where the lead lands, so one spreadsheet can
  // feed several CRM verticals. Falls back to the link's vertical, then to inferring the
  // vertical from the sheet's column shape when the row says nothing usable.
  const rowVertical =
    normalizeVerticalValue(getMappedRowValue(row, mapping, "vertical")) ||
    normalizeVerticalValue(getMappedRowValue(row, mapping, "assignedBranch"));
  const vertical = rowVertical || getExplicitLinkVertical(link) || detectedVertical;
  const lead = {};

  for (const fieldName of CRM_FIELD_ORDER) {
    const value = getMappedRowValue(row, mapping, fieldName);
    if (value !== "") lead[fieldName] = value;
  }

  const sourceEnquiryId = getMappedRowValue(row, mapping, "id");
  const phone = getMappedRowValue(row, mapping, "phone");
  const normalizedPhone = normalizePhone(phone);
  const sheetIdentity = getSheetIdentity(link);
  const fallbackSourceId = `${sheetIdentity}:row:${rowNumber}`;
  const effectiveSourceId = sourceEnquiryId || fallbackSourceId;
  const existing = (sourceEnquiryId && existingById.get(sourceEnquiryId)) || (effectiveSourceId && existingById.get(effectiveSourceId)) || (normalizedPhone && existingByPhone.get(normalizedPhone)) || null;
  const recordId = existing?.lead?.id || (sourceEnquiryId && CRM_ID_PATTERN.test(sourceEnquiryId) ? sourceEnquiryId : leadIds.next(leadIdContext(link, lead)));
  const status = getMappedRowValue(row, mapping, "status") || existing?.lead?.status || "";
  /*
   * The row's own Added Time column first, then the time inside its Enquiry Date - a sheet that
   * states the enquiry as a single stamp has said when it came in just as plainly as one with two
   * columns, and the two are stored apart here. Ahead of `existing` because both are what *this*
   * row says, and only then what the lead already held.
   */
  const addedTime = getMappedRowValue(row, mapping, "addedTime") || enquiryStampTime(getMappedRowValue(row, mapping, "createdDate")) || existing?.lead?.addedTime || "";
  const rowHasMeaningfulData = Array.isArray(row) && row.some((cell) => String(cell || "").trim() !== "");
  /*
   * Whose lead this is, where the studio has written a rule that says so.
   *
   * Asked of every row on every pass rather than only at import, so a row the two-minute poller
   * picks up an hour from now is assigned by the same rules the first import used - one code path,
   * and it cannot drift.
   *
   * **Only asked where there is actually a blank to fill.** The rules never overrule an owner, so
   * for a row that has one the answer was always going to be discarded - but asking anyway spent a
   * turn of the split: `assign` advances the balance as it picks, and a sheet of a thousand owned
   * leads re-read every two minutes churned it a thousand times a pass. The handful of genuinely
   * new rows in that pass then went to whoever the churn happened to leave lowest, rather than to
   * whoever was actually furthest below their share.
   */
  const alreadyOwned = String(lead.crm || existing?.lead?.crm || "").trim();
  const matched = !alreadyOwned && link?.assignmentMatcher ? link.assignmentMatcher.assign(row) : null;
  /*
   * The rule says who; this says whether they can take it today.
   *
   * `null` back from the resolver means the named employee and their whole chain of alternatives
   * are away - so the rule is treated as having matched nobody and the lead arrives unassigned,
   * which is the honest outcome and the one somebody can see and act on.
   */
  const cover = matched && link?.coverResolver ? link.coverResolver(matched.rule.targetEmployeeId) : null;
  const assignment = !matched
    ? null
    : !link?.coverResolver
      ? matched
      : cover
        ? { ...matched, crm: cover.name || matched.crm, cover: cover.covering ? cover : null }
        : null;

  const record = {
    lead: {
      ...(existing?.lead || {}),
      ...lead,
      id: recordId,
      phone: phone || existing?.lead?.phone || "",
      vertical,
      // The day the lead arrived, which is what the New tab and the Yet to connect / Inactive
      // statuses are read from. A file that states it - a Created Date or an Enquiry Date column -
      // is believed, so importing a year of old enquiries no longer stamps every one of them with
      // today and counts them all as new. Today is the fallback for a source that says nothing,
      // which is what every sheet without such a column still gets.
      createdDate: existing?.lead?.createdDate || lead.createdDate || importDateKey(),
      addedTime: addedTime || lead.addedTime || existing?.lead?.addedTime || "",
      /*
       * ── Whose lead this is, in the order the answers are trusted ─────────────────────────────
       *
       *   1. The sheet's own CRM column. Somebody typed a name into the spreadsheet; that is the
       *      most deliberate statement anybody has made about this row.
       *   2. The owner the lead already has. A manager who reassigns a lead in the board must not
       *      have it taken back off them - the sync re-reads every row every two minutes, so a
       *      rule allowed to overrule this would undo the reassignment within the minute.
       *   3. The link's assignment rules, which is what makes an unassigned row somebody's.
       *
       * The first two are `alreadyOwned` above, which is also what decides whether the rules are
       * asked at all. The order is the whole feature: rules fill blanks, they do not overrule
       * people - so **editing a rule never moves a lead that already has an owner**, and the rules
       * reach an imported lead again only while it is still unassigned.
       */
      crm: alreadyOwned || assignment?.crm || "",
      source: lead.source || existing?.lead?.source || "Google sheet integration",
      status,
    },
    details: {
      ...(existing?.details || {}),
      groupType: "google-sheets",
      groupName: "Google sheet integration",
      groupId: existing?.details?.groupId || sheetIdentity,
      importedFrom: String(link.sheetUrl || ""),
      spreadsheetId: String(link.spreadsheetId || ""),
      gid: String(link.gid || ""),
      targetTab: String(link.targetedTab || ""),
      targetedTab: String(link.targetedTab || ""),
      systemTableId: String(link.systemTableId || ""),
      vertical,
      sourceEnquiryId: sourceEnquiryId || existing?.details?.sourceEnquiryId || effectiveSourceId,
      sourceRowNumber: rowNumber,
      lastSourceSyncAt: new Date().toISOString(),
      rowHasMeaningfulData,
    },
  };

  return {
    record,
    // Which rule fired, for the preview to show. Null when no rule matched, which is the case a
    // preview most needs to make visible: a row nothing claims arrives unassigned.
    assignment: assignment ? { crm: assignment.crm, rule: assignment.rule, cover: assignment.cover || null } : null,
    candidate: {
      ...record,
      leadName: record.lead.name || "",
      phone: record.lead.phone || "",
      email: record.lead.officialEmailId || "",
    },
    mapping: {
      fields: mapping?.fields || {},
      headers: mapping?.headers || [],
      unmappedHeaders: mapping?.unmappedHeaders || [],
      missingRequiredFields: mapping?.missingRequiredFields || [],
    },
  };
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeLeadStatus(value) {
  const status = String(value || "").trim().toLowerCase();
  if (!status) return "";
  if (status === "follow-up") return "Followup";
  if (status === "followup") return "Followup";
  if (status === "in review" || status === "cna") return "CNA";
  if (status === "invalid") return "Invalid";
  if (status === "rejected") return "Rejected";
  if (status === "converted") return "Converted";
  // The label was renamed from "Followup & Converted". Sheets still hold the old spelling,
  // so both orders fold onto the current label rather than arriving as two statuses.
  if (["followup & converted", "followup and converted", "followup-converted", "converted & followup", "converted and followup", "converted-followup"].includes(status)) return "Converted & Followup";
  if (status === "interested") return "Interested";
  return String(value).trim();
}

function normalizeDateForValidation(value) {
  const raw = String(value || "").trim();
  if (!raw) return { valid: true, normalized: "" };
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return { valid: true, normalized: raw };
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(raw)) {
    const [a, b, c] = raw.split("/").map(Number);
    if (a > 12 && b <= 12) return { valid: true, normalized: `${c.toString().padStart(4, "0")}-${String(b).padStart(2, "0")}-${String(a).padStart(2, "0")}` };
    if (b > 12 && a <= 12) return { valid: true, normalized: `${c.toString().padStart(4, "0")}-${String(a).padStart(2, "0")}-${String(b).padStart(2, "0")}` };
    return { valid: false, reason: "Ambiguous date format. Use YYYY-MM-DD or an unambiguous day/month date." };
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return { valid: false, reason: "Invalid date value." };
  }
  return { valid: true, normalized: parsed.toISOString().slice(0, 10) };
}

function validateCandidateRecord(record, mapping = {}) {
  const issues = [];
  const lead = record?.lead || {};
  const details = record?.details || {};

  if (!String(lead.name || "").trim()) {
    issues.push({ field: "name", reason: "Lead name is required." });
  }

  const email = normalizeEmail(lead.officialEmailId);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    issues.push({ field: "officialEmailId", reason: "Invalid email format." });
  }

  const status = normalizeLeadStatus(details.leadStatus || lead.status);
  if (status && !["CNA", "Invalid", "Rejected", "Interested", "Followup", "Converted", "Converted & Followup"].includes(status)) {
    issues.push({ field: "status", reason: "Unsupported lead status." });
  }

  /*
   * `addedTime` is deliberately not among them. It is a clock time - "10:57 am" - and not a date:
   * `added_time` is free text, Add Lead writes it with `toLocaleTimeString`, and the CRM board
   * filters it through `TIME_FILTER_COLUMNS` and renders it with `formatAddedTime`. Validating it
   * here as a date made `new Date("10:57 am")` NaN, so every row of a sheet carrying an **Added
   * Time** column failed on its one good column and the whole import reported "0 created, 0
   * updated, 32 skipped". The same mistake was already corrected once on the board's filters.
   */
  const dateFields = ["createdDate", "eventPlannedDate", "lastFollowUpDate", "nextFollowUpDate", "lastConvertedDate", "date", "dateOfBirthOrEdod"];
  for (const field of dateFields) {
    const result = normalizeDateForValidation(lead[field] || details[field]);
    if (!result.valid) {
      issues.push({ field, reason: result.reason });
    }
  }

  const phoneFields = ["phone", "groomContact", "brideContact", "referenceContact", "contactNumber", "alternateMobileNumber"];
  for (const field of phoneFields) {
    const value = String(lead[field] || "").trim();
    if (!value) continue;
    if (!/^\+?\d[\d\s()-]{7,}\d$/.test(value)) {
      issues.push({ field, reason: "Invalid phone/contact value." });
    }
  }

  return {
    valid: issues.length === 0,
    issues,
    normalized: {
      status,
      email,
    },
  };
}

// Spreadsheet + tab + row position. Stable across every sourceEnquiryId format this
// importer has used, so a re-sync re-matches rows that carry no phone or email. The
// tab must be part of the key: without it, row 2 of one tab would match row 2 of every
// other tab in the same spreadsheet and overwrite it.
function sheetPositionKey(spreadsheetId, tab, rowNumber) {
  const sheet = String(spreadsheetId || "").trim();
  const row = String(rowNumber ?? "").trim();
  if (!sheet || !row) return "";
  return `${sheet}:${String(tab || "").trim()}:row:${row}`;
}

/*
 * ── Which sheet rows this application has already imported ────────────────────────────────────
 *
 * The classifier below decides what a row is by looking for its lead. That answers two of the three
 * cases and silently gets the third wrong: a row whose lead has been *deleted* looks exactly like a
 * row nobody has ever imported, so it was imported again on the next pass - two minutes later, under
 * a fresh id, on the board the studio had just cleared. Deleting a synced lead was not an act a
 * person could complete.
 *
 * `sales_google_sheet_row` is the memory that survives the lead. With it the three cases separate:
 *
 *   the lead is there            -> an edit, and the row is updated exactly as before
 *   no lead, but the row is known -> the studio deleted it, and it stays deleted
 *   no lead, and the row is new   -> import it
 *
 * A studio that wants a deleted row back removes it from the sheet and adds it again - which is a
 * new row - or deletes the link, which takes the ledger with it and re-imports the sheet whole.
 */

/** Every row key this link has already imported. One query per sync, not one per row. */
async function loadImportedRowKeys(linkId) {
  const id = String(linkId || "").trim();
  if (!id) return new Set();
  try {
    const rows = await prisma.$queryRawUnsafe(
      "SELECT `row_key` FROM `sales_google_sheet_row` WHERE `link_id` = ?",
      id,
    );
    return new Set(rows.map((row) => String(row.row_key || "")).filter(Boolean));
  } catch (error) {
    /*
     * A ledger that cannot be read must not turn into a sync that imports everything again. The
     * safe answer to "have I seen this row?" when the memory is unavailable is *yes* - it holds the
     * board still instead of refilling it - so the empty set is never the fallback here.
     */
    console.warn("Unable to read the imported sheet rows for", id, error?.message || error);
    return null;
  }
}

/** Notes a row as imported. Never allowed to fail the sync: the lead is written either way. */
async function recordImportedRow(linkId, rowKey, enquiryId) {
  const id = String(linkId || "").trim();
  const key = String(rowKey || "").trim();
  if (!id || !key) return;
  try {
    await prisma.$executeRawUnsafe(
      "INSERT INTO `sales_google_sheet_row` (`id`, `link_id`, `row_key`, `enquiry_id`) VALUES (?, ?, ?, ?)"
      // Re-importing a row the ledger already knows keeps the first sighting: when it was first
      // seen is the useful fact, and the id it made then is the one that answers "what happened".
      + " ON DUPLICATE KEY UPDATE `enquiry_id` = COALESCE(`sales_google_sheet_row`.`enquiry_id`, VALUES(`enquiry_id`))",
      `${id}:${Buffer.from(key).toString("base64url").slice(0, 150)}`,
      id,
      key.slice(0, 255),
      String(enquiryId || "").slice(0, 100) || null,
    );
  } catch (error) {
    console.warn("Unable to record an imported sheet row for", id, error?.message || error);
  }
}

/** The row's own identity, as the importer already computes it for `sourceEnquiryId`. */
function importedRowKey(record) {
  return String(record?.details?.sourceEnquiryId || "").trim();
}

function buildExistingIndexes(existingRows = []) {
  const rows = Array.isArray(existingRows) ? existingRows.map((row) => mapCrmRow(row)) : [];
  const byId = new Map();
  const byPhone = new Map();
  const byEmail = new Map();
  const byShootId = new Map();
  const bySheetPosition = new Map();
  for (const item of rows) {
    const keyId = String(item.lead?.id || "").trim();
    if (keyId) byId.set(keyId, item);
    /*
     * Both number columns, so a lead typed in by hand is recognised whichever of the two it went
     * into. `listLeadsSharingPhone` - the rule the Add Lead form enforces - has always read `phone`
     * and `contact_number` together; this index read only `phone`, so a lead whose number lives in
     * Contact Number was invisible here and the sheet imported a second copy of somebody the CRM
     * already held. That is the "it was added manually already" case, and it has to be one answer.
     */
    for (const value of [item.lead?.phone, item.lead?.contactNumber]) {
      const number = normalizePhone(value);
      if (number && !byPhone.has(number)) byPhone.set(number, item);
    }
    const email = normalizeEmail(item.lead?.officialEmailId);
    if (email) byEmail.set(email, item);
    const shootId = String(item.lead?.shootId || "").trim();
    if (shootId) byShootId.set(shootId, item);
    const sourceId = String(item.details?.sourceEnquiryId || "").trim();
    if (sourceId) byId.set(sourceId, item);
    const position = sheetPositionKey(
      item.details?.spreadsheetId,
      item.details?.gid || item.details?.targetTab,
      item.details?.sourceRowNumber,
    );
    if (position && !bySheetPosition.has(position)) bySheetPosition.set(position, item);
  }
  return { rows, byId, byPhone, byEmail, byShootId, bySheetPosition };
}

function classifyAgainstExisting(candidate, indexes, seenInBatch = new Map()) {
  const lead = candidate?.lead || {};
  const details = candidate?.details || {};
  const sourceId = String(details.sourceEnquiryId || "").trim();
  const phone = normalizePhone(lead.phone);
  // The row's other number as well, matched against the same index: a sheet's Contact Number and
  // the CRM's are the same fact about the same person, and a row that carries only the second must
  // not read as somebody new.
  const contactNumber = normalizePhone(lead.contactNumber);
  const phoneMatch = (phone && indexes.byPhone.get(phone)) || (contactNumber && indexes.byPhone.get(contactNumber)) || null;
  const email = normalizeEmail(lead.officialEmailId);
  const shootId = String(lead.shootId || "").trim();
  const position = sheetPositionKey(details.spreadsheetId, details.gid || details.targetTab, details.sourceRowNumber);

  const duplicateKey = sourceId || phone || contactNumber || email || shootId;
  if (duplicateKey && seenInBatch.has(duplicateKey)) {
    return {
      classification: "DUPLICATE_IN_SHEET",
      matchedRecord: seenInBatch.get(duplicateKey),
      matchBy: sourceId ? "sourceEnquiryId" : phone || contactNumber ? "phone" : email ? "email" : "shootId",
    };
  }

  const existing =
    (sourceId && indexes.byId.get(sourceId)) ||
    (position && indexes.bySheetPosition?.get(position)) ||
    phoneMatch ||
    (email && indexes.byEmail.get(email)) ||
    (shootId && indexes.byShootId.get(shootId)) ||
    null;

  if (duplicateKey) {
    seenInBatch.set(duplicateKey, candidate);
  }

  if (existing) {
    return {
      classification: "EXISTING",
      matchedRecord: existing,
      matchBy: sourceId && indexes.byId.get(sourceId)
        ? "sourceEnquiryId"
        : position && indexes.bySheetPosition?.get(position)
          ? "sheetPosition"
          : phoneMatch
            ? "phone"
            : email && indexes.byEmail.get(email)
              ? "email"
              : "shootId",
    };
  }

  return {
    classification: "NEW",
    matchedRecord: null,
    matchBy: null,
  };
}

async function prepareGoogleSheetCrmImport(link) {
  const sheet = await readLinkedGoogleSheet(link);
  // Both read paths must produce the same sheet identity, otherwise every row gets a
  // fresh sourceEnquiryId on the next sync and re-imports as a new lead.
  const resolvedLink = {
    ...link,
    spreadsheetId: sheet.spreadsheetId || link.spreadsheetId || "",
    gid: String(sheet.gid ?? sheet.sheetId ?? link.gid ?? ""),
    targetedTab: sheet.targetedTab || link.targetedTab || "",
  };
  const headers = Array.isArray(sheet.headers) ? sheet.headers : [];
  const mapping = resolveColumnMapping(headers, String(link?.vertical || ""));
  /*
   * The link's assignment rules, compiled against this sheet's headers once for the whole pass.
   *
   * Loaded here rather than handed in by the caller, and that is the point: three places build a
   * link object out of hand-written SQL - the poller's `listActiveLinks`, the controller's `sync`
   * and its `LINK_SELECT_SQL` - and a rule set carried on the link would have to be added to all
   * three, with the one that was missed failing silently as leads quietly arriving unassigned.
   * Reading them from the link's id means every caller gets them without knowing they exist.
   */
  const assignmentRules = await listRulesForLink(link?.id);
  const assignmentMatcher = buildAssignmentMatcher(headers, assignmentRules);
  /*
   * Who actually gets the lead when the person a rule names is not here.
   *
   * A rule names one employee; that employee goes on leave, and every lead it matches lands in an
   * inbox nobody opens for a week - worse than arriving unassigned, because unassigned is visible.
   * Their alternatives take the work instead, shared between them rather than piled on the first
   * one, and if the whole chain is away the lead stays unassigned rather than being given to
   * somebody the studio never nominated.
   *
   * Loaded once per pass, not per row: "who is away today" is one answer for the whole sheet, and
   * asking it 14,000 times would cost more than the import.
   */
  const coverResolver = assignmentRules.length ? buildCoverResolver(await loadCoverContext()) : null;
  const existingRows = await getCrmLeadRows();
  const indexes = buildExistingIndexes(existingRows);
  /*
   * The rows this link has imported before, whether or not their leads are still here.
   *
   * `null` means the ledger could not be read. That is deliberately not the same as "nothing has
   * been imported": treating it as empty would re-import the whole sheet on a transient database
   * error, which is the exact fault this table exists to prevent. Read the check below.
   */
  const importedRowKeys = await loadImportedRowKeys(link?.id);
  // The other half of the same guarantee - see `loadDeletedLeadKeys`. The ledger remembers the row;
  // this remembers the lead, and so still recognises it after the spreadsheet has moved the row.
  const deletedKeys = await loadDeletedLeadKeys();
  const seenInBatch = new Map();

  /*
   * Built once and carried across the whole sheet. Rebuilding these per row would
   * hand every new row the same generated enquiryId, collapsing an entire batch of
   * new leads onto a single record.
   *
   * The allocator hands out the enquiry ids - see the note on `createLeadIdAllocator`. It is only
   * *committed* by `runGoogleSheetLinkSync`, once the rows it numbered have actually been written:
   * this function also backs the dry-run preview, and lifting the shared counter there would burn
   * a block of ids on a sheet nobody went on to import.
   */
  const leadIds = await loadLeadIdAllocator(existingRows.map((row) => row.enquiryId));
  const knownById = new Map(
    indexes.rows.map((item) => [item.details?.sourceEnquiryId || item.lead?.id, item]).filter(([key]) => key),
  );
  const knownByPhone = new Map(
    indexes.rows
      .filter((item) => normalizePhone(item.lead?.phone))
      .map((item) => [normalizePhone(item.lead.phone), item]),
  );

  // Attached to the link the rows are mapped against, so the matcher reaches
  // `mapRowToCrmCandidate` without another positional argument on a function that already takes
  // seven of them.
  resolvedLink.assignmentMatcher = assignmentMatcher;
  resolvedLink.coverResolver = coverResolver;

  const rows = [];
  let validCount = 0;
  let invalidCount = 0;
  let duplicateCount = 0;
  let existingCount = 0;
  let newCount = 0;
  // Rows this link imported once and the studio has since deleted. Reported, not silently dropped.
  let deletedCount = 0;
  /*
   * How the assignment rules did, reported alongside the row counts.
   *
   * `unassignedRows` is the number that matters and the one nobody would otherwise see: a rule
   * written against a column that has since been renamed goes on being stored, matches nothing,
   * and every lead arrives with no owner - which looks exactly like having written no rules at
   * all. Counted only where there are rules to fail, so a link with none reports nothing.
   */
  let assignedByRuleCount = 0;
  let unassignedRows = 0;

  for (const sheetRow of Array.isArray(sheet.rows) ? sheet.rows : []) {
    const candidatePayload = mapRowToCrmCandidate(
      sheetRow.values || [],
      { ...mapping, headers },
      resolvedLink,
      sheetRow.rowNumber,
      leadIds,
      knownById,
      knownByPhone,
    );
    const validation = validateCandidateRecord(candidatePayload.record, mapping);
    const classification = classifyAgainstExisting(candidatePayload.record, indexes, seenInBatch);
    const rowIssues = [...validation.issues];
    /*
     * A row the ledger has seen, whose lead is no longer here, was deleted on purpose - so it is
     * left deleted rather than imported again. Only asked of rows the classifier calls NEW: a lead
     * that still exists is an edit and goes on being updated, which is the behaviour the sheet is
     * linked for.
     *
     * `importedRowKeys === null` is the unreadable ledger, and it withholds every new row rather
     * than risking a re-import of the whole sheet. A sync that adds nothing is recoverable on the
     * next pass; one that refills a board the studio has just cleared is not.
     */
    const rowKey = importedRowKey(candidatePayload.record);
    const alreadyImported = classification.classification === "NEW"
      && (importedRowKeys === null
        || deletedKeys === null
        || (rowKey && importedRowKeys.has(rowKey))
        || matchesDeletedRecord(candidatePayload.record, deletedKeys));

    if (classification.classification === "DUPLICATE_IN_SHEET") {
      rowIssues.push({ field: "duplicate", reason: "Duplicate row within the same spreadsheet import batch." });
      duplicateCount += 1;
    } else if (classification.classification === "EXISTING") {
      existingCount += 1;
    } else if (alreadyImported) {
      deletedCount += 1;
    } else {
      newCount += 1;
    }
    if (!validation.valid) invalidCount += 1;
    else validCount += 1;
    if (candidatePayload.assignment) assignedByRuleCount += 1;
    else if (!String(candidatePayload.record?.lead?.crm || "").trim()) unassignedRows += 1;
    rows.push({
      rowNumber: sheetRow.rowNumber,
      candidate: candidatePayload.candidate,
      record: candidatePayload.record,
      mapping: candidatePayload.mapping,
      assignment: candidatePayload.assignment,
      classification: !validation.valid ? "INVALID" : alreadyImported ? "ALREADY_IMPORTED" : classification.classification,
      rowKey,
      matchedRecord: classification.matchedRecord ? classification.matchedRecord.record || classification.matchedRecord : null,
      matchedBy: classification.matchBy,
      valid: validation.valid,
      issues: rowIssues,
    });
  }

  return {
    source: sheet.source,
    // Handed back so a run that writes can commit the counter; the preview route drops it.
    leadIds,
    spreadsheetId: sheet.spreadsheetId,
    spreadsheetName: sheet.spreadsheetName,
    targetedTab: sheet.targetedTab,
    headers,
    mapping,
    assignment: {
      ruleCount: assignmentRules.length,
      activeRules: assignmentMatcher.activeRules,
      // Rules naming a column this sheet no longer has. Silence here is the failure that cannot be
      // seen: a renamed column turns a working rule into leads arriving unassigned for good.
      missingColumns: assignmentMatcher.missingColumns,
    },
    summary: {
      totalRows: rows.length,
      validRows: validCount,
      invalidRows: invalidCount,
      duplicateRows: duplicateCount,
      existingRows: existingCount,
      newRows: newCount,
      alreadyImportedRows: deletedCount,
      assignedByRule: assignedByRuleCount,
      unassignedRows,
    },
    rows,
  };
}

async function runGoogleSheetLinkSync(link) {
  const preview = await prepareGoogleSheetCrmImport(link);
  const actions = [];
  let created = 0;
  let skippedExisting = 0;
  /*
   * Of the rows already here, the ones recognised by their *number or email* rather than by which
   * row of the sheet they came from.
   *
   * Worth counting apart because it is the answer to a question the studio actually asks: "the
   * sheet has this person, why is there no lead?". A row matched on its sheet position is routine
   * housekeeping; a row matched on its phone is a person the CRM already holds under another
   * enquiry - possibly one typed in by hand - and that is the case somebody wants to see named.
   */
  let skippedSameContact = 0;
  let skippedDuplicate = 0;
  let skippedInvalid = 0;
  // Rows held back because their lead was deleted here. See the ALREADY_IMPORTED branch below.
  let skippedDeleted = 0;
  let failed = 0;
  /*
   * The first few rows that did not import, and why - by row number, so the spreadsheet can be
   * opened at the line to correct.
   *
   * The counts alone say "6 skipped (6 invalid)", which tells the studio there is something to fix
   * and nothing about what: the reasons lived only in this run's `actions`, which is thrown away,
   * and in the import preview, which is a second full read of the sheet to find out. Kept on the
   * link so the panel can name them where the failure is already reported.
   *
   * Capped, because this is stored as JSON on the link rather than as a row per problem: a sheet
   * where every one of 14,000 rows is invalid must not write a megabyte of identical reasons on
   * every pass. The totals beside it are not capped, so "5 shown of 812" stays honest.
   */
  const rowProblems = [];
  const noteProblem = (rowNumber, reason) => {
    if (rowProblems.length >= ROW_PROBLEM_LIMIT) return;
    const text = String(reason || "").trim();
    if (!text) return;
    rowProblems.push({ rowNumber, reason: text.slice(0, 160) });
  };

  for (const row of Array.isArray(preview.rows) ? preview.rows : []) {
    const classification = String(row.classification || "").trim();
    const record = row?.record || null;
    if (!record) {
      failed += 1;
      noteProblem(row.rowNumber, "Missing mapped record.");
      actions.push({ rowNumber: row.rowNumber, action: "FAILED", reason: "Missing mapped record." });
      continue;
    }

    if (classification === "DUPLICATE_IN_SHEET") {
      skippedDuplicate += 1;
      actions.push({ rowNumber: row.rowNumber, action: "SKIPPED_DUPLICATE" });
      continue;
    }
    if (classification === "INVALID") {
      skippedInvalid += 1;
      // The first issue only. A row with a blank name and three bad dates is corrected by opening
      // it, and four reasons on one line push the other rows off the panel.
      noteProblem(row.rowNumber, (row.issues || [])[0]?.reason);
      actions.push({ rowNumber: row.rowNumber, action: "SKIPPED_INVALID", issues: row.issues || [] });
      continue;
    }
    /*
     * Imported once already, and its lead is gone: the studio deleted it, and the sheet is not
     * entitled to overrule that every two minutes. Counted and named in the summary rather than
     * dropped quietly, so "nothing happened" is distinguishable from "nine rows were held back".
     */
    if (classification === "ALREADY_IMPORTED") {
      skippedDeleted += 1;
      actions.push({ rowNumber: row.rowNumber, action: "SKIPPED_DELETED", rowKey: row.rowKey || "" });
      continue;
    }
    /*
     * A row whose lead is already in the CRM is left exactly as it stands.
     *
     * The sheet is where a lead arrives, not where it lives afterwards: once it is in the CRM it is
     * worked on there, and a cell corrected in the spreadsheet must not overwrite the status, owner
     * or remark the studio has since put on the lead - which a refresh every two minutes otherwise
     * does. Counted and named rather than dropped quietly, so a pass that wrote nothing can still
     * say why. A rejected or failed row is never recorded as imported, so those - and genuinely new
     * rows - are the only things a later pass picks up.
     */
    if (classification === "EXISTING") {
      skippedExisting += 1;
      if (row.matchedBy === "phone" || row.matchedBy === "email") skippedSameContact += 1;
      actions.push({
        rowNumber: row.rowNumber,
        action: "SKIPPED_EXISTING",
        crmLeadId: row.matchedRecord?.lead?.id || "",
        matchedBy: row.matchedBy || null,
      });
      continue;
    }
    try {
      await upsertRecord(record);
      created += 1;
      // Noted only once the lead is actually written, so a failed insert does not leave the row
      // marked as imported and therefore skipped for good.
      await recordImportedRow(link?.id, row.rowKey || importedRowKey(record), record.lead?.id || "");
      actions.push({ rowNumber: row.rowNumber, action: "CREATED", crmLeadId: record.lead?.id || "" });
    } catch (error) {
      failed += 1;
      const reason = error?.message || "Unable to create CRM lead.";
      noteProblem(row.rowNumber, reason);
      actions.push({ rowNumber: row.rowNumber, action: "FAILED", reason });
    }
  }

  // The counter carries on from wherever this run reached, so the next Add Lead save cannot be
  // handed an id a sheet row has just taken. After the writes, not before: an id belongs to the
  // counter once a row is actually holding it.
  if (created) await preview.leadIds?.commit();

  /*
   * The split counters, for the rows that were actually created.
   *
   * Counted from `actions` rather than as the allocator picks, and that is the point: the allocator
   * runs during `prepareGoogleSheetCrmImport`, which also backs the dry-run import preview. Writing
   * as it picked would let a preview spend somebody's share without a single lead being imported,
   * and would count rows that then failed to write.
   */
  const splitCounts = new Map();
  // Written, not merely picked. `CREATED` is now the only written row: a sync no longer touches a
  // lead already in the CRM, so it can no longer back-fill an owner onto an unassigned one either,
  // and a new lead is the whole of what can spend somebody's share.
  const written = new Set(
    actions.filter((action) => action.action === "CREATED").map((action) => action.rowNumber),
  );
  for (const row of Array.isArray(preview.rows) ? preview.rows : []) {
    // `assignment` is only ever set where the rules actually supplied the owner - a row that came
    // in already owned never reaches the matcher - so its presence is the whole test.
    const rule = written.has(row.rowNumber) ? row.assignment?.rule : null;
    if (!rule?.id || !rule?.targetEmployeeId) continue;
    const key = `${rule.id}::${rule.targetEmployeeId}`;
    splitCounts.set(key, (splitCounts.get(key) || 0) + 1);
  }
  await recordAssignedCounts(splitCounts);

  const summary = {
    created,
    // `skippedExisting` and `skippedDeleted` count here too: they are rows this pass declined to
    // write, which is what every other number in this total means. Left out, a sheet whose rows are
    // all already in the CRM would report a sync that touched nothing and explain none of it.
    skipped: skippedExisting + skippedDuplicate + skippedInvalid + skippedDeleted,
    skippedExisting,
    skippedSameContact,
    skippedDuplicate,
    skippedInvalid,
    skippedDeleted,
    failed,
    totalRows: Array.isArray(preview.rows) ? preview.rows.length : 0,
    // How the link's assignment rules did on this pass. Carried through to the status line the
    // Settings panel prints, so a rule that has stopped matching is visible where the sync is
    // watched rather than only inside the import preview.
    assignedByRule: preview.summary?.assignedByRule || 0,
    unassignedRows: preview.summary?.unassignedRows || 0,
    assignmentRules: preview.assignment?.ruleCount || 0,
    // Named, not counted. This is the one sync problem the studio can fix without opening the
    // spreadsheet - the column was renamed, so the rule has to be pointed at its new heading -
    // and it cannot be acted on from a number.
    assignmentMissingColumns: (preview.assignment?.missingColumns || []).map((entry) => entry.columnHeader).filter(Boolean),
    // Named rows, capped; `skippedInvalid` + `failed` beside them is the true total.
    rowProblems,
  };
  await recordLinkSync(link?.id, failed ? "PARTIAL" : "OK", summary);

  return { link: preview.link, summary, actions };
}

// Wraps the run so a failure is recorded too - otherwise a link whose sync keeps throwing
// would still show whatever the last successful attempt reported.
async function syncGoogleSheetLinkToCrm(link) {
  try {
    return await runGoogleSheetLinkSync(link);
  } catch (error) {
    await recordLinkSync(link?.id, "FAILED", { error: String(error?.message || error).slice(0, 300) });
    throw error;
  }
}

/**
 * Notes the outcome of a sync on the link itself. Kept as three columns updated in place
 * rather than a row per run, because the background poller syncs every active link every
 * 30 seconds - a history table would gain thousands of rows a day per sheet.
 *
 * Never allowed to fail a sync: this is reporting, not the work.
 */
async function recordLinkSync(linkId, status, summary) {
  if (!linkId) return;
  try {
    await prisma.$executeRawUnsafe(
      "UPDATE `sales_google_sheet_link` SET `last_synced_at` = CURRENT_TIMESTAMP(3), `last_sync_status` = ?, `last_sync_summary` = ? WHERE `id` = ?",
      String(status || "OK").slice(0, 30),
      JSON.stringify(summary || {}),
      linkId,
    );
  } catch (error) {
    console.warn("Unable to record the sync outcome for", linkId, error?.message || error);
  }
}

function valueForHeader(row, headerMap, ...headers) {
  for (const header of headers) {
    const index = headerMap.get(normalizeText(header));
    if (index !== undefined) return String(row[index] || "").trim();
  }
  return "";
}

function importDateKey() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/*
 * ── Handing out enquiry ids while a sheet is read ─────────────────────────────────────────────
 *
 * An enquiry id is `DBS-EID-QQ-ERD-000001`, counted per vertical and per branch from the shared
 * counter in `services/identifiers.js`. A sheet read cannot take them one at a time from that
 * counter: the row mapper is synchronous and runs thousands of times, and awaiting a round trip
 * per row would turn a sync into a queue of them.
 *
 * So the caller builds one of these first - which *is* async - and it hands ids out in memory.
 * It is seeded from two places on purpose:
 *
 *   * the counter, so an id promised to a CSV import or the Add Lead form is never re-issued here;
 *   * the ids already in the table, so a counter left behind by a restore cannot re-issue one that
 *     is on a lead.
 *
 * `commit` then lifts the counter to whatever this run reached, so the next form save carries on
 * from here rather than colliding with it.
 */
function createLeadIdAllocator(seededCounters = new Map()) {
  const counters = new Map(seededCounters);
  return {
    counters,
    next(context) {
      const key = sequenceKey("CRM_LEAD", context);
      const value = (counters.get(key) || 0) + 1;
      counters.set(key, value);
      return formatIdentifier("CRM_LEAD", context, value);
    },
    async commit(client = prisma) {
      for (const [key, value] of counters) {
        await advanceSequence("CRM_LEAD", contextFromKey("CRM_LEAD", key), value, client);
      }
    },
  };
}

/** An allocator seeded from the counter and from the ids already on leads. */
async function loadLeadIdAllocator(existingIds = [], client = prisma) {
  const counters = new Map();
  const rows = await client.appSequence.findMany({ where: { key: { startsWith: "CRM_LEAD:" } } });
  for (const row of rows) counters.set(row.key, row.currentValue);
  for (const id of existingIds) {
    // An id in one of the shapes this application used to hand out simply does not parse, and is
    // not counted - the new sequences start from one and the old ids are not in their run.
    const parsed = parseIdentifier("CRM_LEAD", id);
    if (!parsed) continue;
    // Keyed the way the counter is - by vertical, not by branch - so all of Qua Qua's ids raise the
    // one sequence they were drawn from.
    const key = sequenceKey("CRM_LEAD", parsed);
    if (parsed.value > (counters.get(key) || 0)) counters.set(key, parsed.value);
  }
  return createLeadIdAllocator(counters);
}

/**
 * Which vertical and branch a sheet row's enquiry id is counted under.
 *
 * The vertical is the *link's* - a sheet belongs to one system table, and that table is the
 * vertical - rather than anything a row says, so one badly typed cell cannot file a Qua Qua enquiry
 * under Dum Dum. The vertical is the row's own Nearest Branch, which is the only place a physical
 * branch is recorded on a lead.
 */
function leadIdContext(link = {}, lead = {}) {
  return { vertical: link.vertical || lead.vertical, branch: lead.assignedBranch };
}

function resolveVerticalConfig(link = {}) {
  const systemTableId = String(link.systemTableId || "").trim();
  const vertical = String(link.vertical || "").trim();
  const matched = Object.values(VERTICAL_CONFIG).find((item) => item.systemTableId === systemTableId || item.vertical === vertical);
  return matched || VERTICAL_CONFIG["Dum Dum"];
}

function getLinkVertical(link) {
  return resolveVerticalConfig(link).vertical;
}

// Spellings seen in the source spreadsheets' own vertical columns, including the
// "Crop" typo for Corp and the WED/QQ/CORP generator codes.
const VERTICAL_VALUE_ALIASES = {
  dumdum: "Dum Dum",
  wed: "Dum Dum",
  wedding: "Dum Dum",
  weddings: "Dum Dum",
  quaqua: "Qua Qua",
  qq: "Qua Qua",
  corp: "Corp",
  crop: "Corp",
  corporate: "Corp",
  corporates: "Corp",
};

// Resolves whatever the sheet wrote in its vertical column onto a real CRM vertical.
// Returns "" when the value is blank or is a place name rather than a vertical.
function normalizeVerticalValue(value) {
  const key = normalizeText(value);
  return key ? VERTICAL_VALUE_ALIASES[key] || "" : "";
}

// Returns the vertical the link was explicitly created for, or "" when the link
// carries no vertical/system table. Unlike getLinkVertical this never falls back to
// Dum Dum, so callers can tell "no choice made" apart from "chose Dum Dum".
function getExplicitLinkVertical(link = {}) {
  const systemTableId = String(link.systemTableId || "").trim();
  const vertical = String(link.vertical || "").trim();
  if (!systemTableId && !vertical) return "";
  const matched = Object.values(VERTICAL_CONFIG).find((item) => item.systemTableId === systemTableId || item.vertical === vertical);
  return matched ? matched.vertical : "";
}

function getSheetIdentity(link = {}) {
  const spreadsheetId = String(link.spreadsheetId || "").trim();
  const gid = String(link.gid || "").trim();
  const targetTab = String(link.targetedTab || "").trim();
  return `${spreadsheetId}:${gid || targetTab || "default"}`;
}

function getSheetSyncKey(link = {}) {
  return `${String(link.spreadsheetId || "").trim()}:${String(link.gid || "").trim() || String(link.targetedTab || "").trim() || "default"}`;
}

function mapCrmRow(row = {}) {
  const lead = {
    id: row.enquiryId || "",
    name: row.name || "",
    phone: row.phone || "",
    whatsappNumber: row.whatsappNumber || "",
    vertical: row.vertical || "",
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
  };
  const details = {
    groupType: "google-sheets",
    groupName: row.targetTab || "Google sheet integration",
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
    lastFollowUpDate: row.lastFollowUpDate || "",
    nextFollowUpDate: row.nextFollowUpDate || "",
    lastConvertedDate: row.lastConvertedDate || "",
  };
  return { lead, details };
}

/*
 * ── Recognising a lead the studio has deleted ────────────────────────────────────────────────
 *
 * The row ledger already holds a deleted row down, but only under the key that row had when it was
 * imported - and where the sheet carries no enquiry id of its own, that key is its *row number*.
 * Insert a row near the top of the spreadsheet and every row beneath it shifts down one, arrives
 * under a key the ledger has never seen, and a lead the studio deleted walks straight back in.
 *
 * So the deleted leads are asked directly as well, on the same identities the classifier matches
 * live leads by, and a row carrying one of them is that lead wherever it has since moved to.
 */
function deletedRecordKeys({ sourceEnquiryId, phone, email } = {}) {
  const keys = [];
  const id = String(sourceEnquiryId || "").trim();
  if (id) keys.push(`id:${id}`);
  const tel = normalizePhone(phone);
  if (tel) keys.push(`tel:${tel}`);
  const mail = normalizeEmail(email);
  if (mail) keys.push(`mail:${mail}`);
  return keys;
}

/**
 * Every identity held by a deleted lead, flattened into one set to test arrivals against. `null`
 * where it could not be read, which withholds new rows for the same reason the ledger does:
 * adding nothing is recoverable next pass, refilling a board the studio has just cleared is not.
 */
async function loadDeletedLeadKeys() {
  try {
    const rows = await prisma.$queryRawUnsafe(
      "SELECT `phone`, `official_email_id` AS `email`, `source_enquiry_id` AS `sourceEnquiryId` FROM `sales_crm_lead` WHERE `deleted_at` IS NOT NULL",
    );
    const set = new Set();
    for (const row of Array.isArray(rows) ? rows : []) {
      for (const key of deletedRecordKeys(row)) set.add(key);
    }
    return set;
  } catch (error) {
    console.warn("Unable to read the deleted CRM leads:", error?.message || error);
    return null;
  }
}

/** Whether an arriving row is a lead already deleted here, on any one of its identities. */
function matchesDeletedRecord(record, deletedKeys) {
  if (!deletedKeys || !deletedKeys.size) return false;
  return deletedRecordKeys({
    sourceEnquiryId: record?.details?.sourceEnquiryId,
    phone: record?.lead?.phone,
    email: record?.lead?.officialEmailId,
  }).some((key) => deletedKeys.has(key));
}

async function getCrmLeadRows() {
  const columns = CRM_LEAD_COLUMNS.map((column) => `\`${dbColumn(column)}\` AS \`${column}\``).join(", ");
  return prisma.$queryRawUnsafe(`SELECT ${columns} FROM \`sales_crm_lead\` WHERE \`deleted_at\` IS NULL ORDER BY \`enquiry_id\` ASC`);
}

async function upsertCrmLeadRow(record) {
  const payload = mapCrmRow({
    ...record.lead,
    ...record.details,
    enquiryId: record.lead?.id,
    sourceEnquiryId: record.details?.sourceEnquiryId,
  });
  const data = { ...payload.lead, ...payload.details };
  /*
   * Dates folded to `YYYY-MM-DD` on the way in, exactly as `flattenLeadColumns` folds them for
   * every other writer in this module.
   *
   * This upsert builds its own payload and writes raw SQL, so it was the one path that never
   * reached that function - `crmLeadService`'s own note already claimed the sheet sync went through
   * it. `created_day`, `follow_up_day` and `dob_edod_day` are **stored generated columns** whose
   * expression understands ISO and `DD/MM/YYYY` and nothing else, so a sheet writing Excel's
   * `10-Sep-26` left `follow_up_day` and `dob_edod_day` NULL - in no Today or Yesterday Pending tab,
   * in neither Newborns nor Birthdays - while `created_day` fell through its COALESCE to the row's
   * insert timestamp and filed every row of the import under the day the sync ran.
   */
  for (const column of LEAD_DATE_COLUMNS) {
    if (column in data) data[column] = normalizeDateText(data[column]);
  }
  // The references beside the text, resolved the way the backfill resolved them, so a lead that
  // arrives from a sheet is narrowed like one typed into the app. Cached, so a sync costs nothing per row.
  const refs = await referenceLookups();
  // The branch's own spelling, for the same reason the CSV import writes it: a sheet's Nearest
  // Branch column is typed by hand too, and Assigned Branch is a picker over the branch table.
  // Matched once and used for both halves, so the name and the id can never disagree.
  data.assignedBranch = refs.branchName(data.assignedBranch);
  const references = { branchId: refs.branchId(data.assignedBranch), verticalId: refs.verticalId(data.vertical), ownerEmployeeId: refs.employeeId(data.crm) };
  const keys = [...CRM_LEAD_COLUMNS.filter((column) => column !== "enquiryId" && column !== "deletedAt" && column !== "createdAt" && column !== "updatedAt"), ...Object.keys(references)];
  const values = keys.map((key) => (key in references ? references[key] : data[key] ?? null));
  // lastSourceSyncAt is a fresh timestamp on every pass, so including it in the UPDATE
  // would rewrite every row each sync, bump updatedAt, and make it impossible to tell a
  // real edit from a routine poll. It is recorded on insert only.
  const updateKeys = keys.filter((key) => key !== "lastSourceSyncAt");
  const affected = await prisma.$executeRawUnsafe(
    `INSERT INTO \`sales_crm_lead\` (\`enquiry_id\`, ${keys.map((key) => `\`${dbColumn(key)}\``).join(", ")}, \`deleted_at\`)
     VALUES (?, ${keys.map(() => "?").join(", ")}, NULL)
     ON DUPLICATE KEY UPDATE ${updateKeys.map((key) => `\`${dbColumn(key)}\` = VALUES(\`${dbColumn(key)}\`)`).join(", ")}, \`deleted_at\` = NULL`,
    record.lead.id,
    ...values,
  );
  // The driver runs with CLIENT_FOUND_ROWS, so 1 means either "inserted" or "matched
  // but identical" and only 2 means values actually changed. The caller knows whether
  // the row was new, which is what disambiguates the 1.
  return affected === 2;
}

async function ensureSyncHistoryTable() {
  await prisma.$executeRawUnsafe(`
CREATE TABLE IF NOT EXISTS \`sales_google_sheet_sync_run\` (
  \`id\` VARCHAR(191) NOT NULL,
  \`google_sheet_link_id\` VARCHAR(191) NOT NULL,
  \`sync_source\` VARCHAR(30) NOT NULL,
  \`status\` VARCHAR(30) NOT NULL,
  \`summary_json\` JSON NULL,
  \`error_message\` TEXT NULL,
  \`started_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  \`finished_at\` DATETIME(3) NULL,
  PRIMARY KEY (\`id\`),
  INDEX \`sales_google_sheet_sync_run_link_idx\` (\`google_sheet_link_id\`),
  INDEX \`sales_google_sheet_sync_run_status_idx\` (\`status\`),
  INDEX \`sales_google_sheet_sync_run_startedAt_idx\` (\`started_at\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`);
}

function mapHeaderToLeadKey(vertical, header) {
  const normalized = normalizeText(header);
  const common = {
    enquiryid: "id",
    enquiryname: "name",
    name: "name",
    addedtime: "addedTime",
    addedtimestamp: "addedTimestamp",
    phonenumber: "phone",
    phone: "phone",
    contact: "contact",
    status: "status",
    verticals: "vertical",
    vertical: "vertical",
    // A city, not a vertical - it belongs to assignedBranch, as the aliases above already say.
    nearestbranch: "assignedBranch",
    assignedbranch: "assignedBranch",
    crm: "crm",
    referredfrom: "referredFrom",
    referredform: "referredFrom",
    offertype: "offerType",
    campaignname: "campaignName",
    adsetname: "adsetName",
    adname: "adName",
    preferredbudget: "preferredBudget",
    // In `common`, not in one vertical's map: every vertical asks for it.
    estimatedvalue: "estimatedValue",
    city: "city",
    state: "state",
    source: "source",
    /*
     * The two follow-up dates, here rather than in one vertical's map because two tables now carry
     * them - Qua Qua always has, and Dum Dum's table was given them alongside its pending tabs.
     * `CRM_FIELD_ALIASES`, which the CSV import matches on, has never been per-vertical and already
     * reads both; this is the sheet sync catching up, so a Dum Dum sheet with those headings fills
     * the same two columns its CSV template does.
     */
    lastfollowupdate: "lastFollowUpDate",
    nextfollowupdate: "nextFollowUpDate",
    // Here for the same reason: all three tables carry a Remarks column, and while this
    // sat in the Dum Dum and Corp maps alone a Qua Qua sheet headed "Remarks" read into
    // nothing. `CRM_FIELD_ALIASES`, which the CSV path matches on, has never been
    // per-vertical and already read it.
    remarks: "remarks",
  };
  const dumDum = {
    // `createdDate`, not `enquiryDate` - the latter is what the *board* calls the cell, not a column
    // any table has, so a sheet headed "Enquiry Date" was read into a key nothing stores and the
    // date was dropped on the floor. `HEADER_ALIASES` above resolves the same heading to the same
    // column for the CSV path.
    enquirydate: "createdDate",
    relationship: "relationship",
    groomname: "groomName",
    groomcontact: "groomContact",
    groomlocation: "groomLocation",
    bridename: "brideName",
    bridecontact: "brideContact",
    bridelocation: "brideLocation",
    referencename: "referenceName",
    referencedpersonname: "referenceName",
    referencecontact: "referenceContact",
    referencedpersoncontact: "referenceContact",
  };
  const quaQua = {
    contactrepeated: "contactRepeated",
    shoottype: "shootType",
    location: "location",
    ihoh: "ihOh",
    lastconverteddate: "lastConvertedDate",
    shootid: "shootId",
    date: "date",
    babyormothername: "babyOrMotherName",
    dateofbirthoredod: "dateOfBirthOrEdod",
  };
  const corp = {
    companyname: "companyName",
    companynameorclientorganisation: "companyName",
    primarydecisionmaker: "primaryDecisionMaker",
    primarydecisionmakercontact: "primaryDecisionMaker",
    designation: "designation",
    contactnumber: "contactNumber",
    alternatemobilenumber: "alternateMobileNumber",
    officialemailid: "officialEmailId",
    companywebsite: "companyWebsite",
    companytype: "companyType",
    companysize: "companySize",
    branches: "branches",
    projecttype: "projectType",
    location: "location",
    shootcity: "shootCity",
    expectedbudget: "expectedBudget",
    competitions: "competitions",
  };
  return { ...common, ...(vertical === "Dum Dum" ? dumDum : vertical === "Qua Qua" ? quaQua : corp) }[normalized] || "";
}

// Returns Corp/Qua Qua only when the columns clearly say so, and "" when they carry no
// signal - unlike detectVerticalFromHeaders, which always falls back to Dum Dum.
function detectBranchSignal(headerMap) {
  const headers = new Set(Array.from(headerMap.keys()));
  const hasCorpSignals = ["companyname", "primarydecisionmaker", "designation", "officialemailid", "companywebsite", "companytype", "companysize"].some((key) => headers.has(key));
  if (hasCorpSignals) return "Corp";
  const hasQuaSignals = ["contactrepeated", "shoottype", "lastfollowupdate", "nextfollowupdate", "lastconverteddate", "shootid", "babyormothername", "dateofbirthoredod"].some((key) => headers.has(key));
  return hasQuaSignals ? "Qua Qua" : "";
}

// Branch for one imported row: what the row itself says, then what its columns imply,
// then the table chosen for the import. Shared by the CSV and Google Sheet paths so the
// two can never disagree.
function resolveRowVertical(row, mapping, link) {
  const rowVertical =
    normalizeVerticalValue(getMappedRowValue(row, mapping, "vertical")) ||
    normalizeVerticalValue(getMappedRowValue(row, mapping, "assignedBranch"));
  if (rowVertical) return rowVertical;
  const headers = Array.isArray(mapping?.headers) ? mapping.headers : [];
  const signal = detectBranchSignal(new Map(headers.map((header, index) => [normalizeText(header), index])));
  if (signal) return signal;
  return getExplicitLinkVertical(link) || "Dum Dum";
}

function detectVerticalFromHeaders(headerMap) {
  const headers = new Set(Array.from(headerMap.keys()));
  const hasCorpSignals = ["companyname", "primarydecisionmaker", "designation", "officialemailid", "companywebsite", "companytype", "companysize"].some((key) => headers.has(key));
  if (hasCorpSignals) return "Corp";
  const hasQuaSignals = ["contactrepeated", "shoottype", "lastfollowupdate", "nextfollowupdate", "lastconverteddate", "shootid", "babyormothername", "dateofbirthoredod"].some((key) => headers.has(key));
  if (hasQuaSignals) return "Qua Qua";
  return "Dum Dum";
}

function buildRecordFromRow(row, headerMap, link, rowNumber, leadIds, existingById, existingByPhone) {
  const detectedVertical = detectVerticalFromHeaders(headerMap);
  const rowVertical = normalizeVerticalValue(valueForHeader(row, headerMap, "Verticals", "Vertical", "Nearest Branch", "Assigned Branch", "Branch"));
  const vertical = rowVertical || getExplicitLinkVertical(link) || detectedVertical;
  const lead = {};
  for (const header of headerMap.keys()) {
    const key = mapHeaderToLeadKey(vertical, header);
    if (key) lead[key] = valueForHeader(row, headerMap, header);
  }

  const sourceEnquiryId = valueForHeader(row, headerMap, "Enquiry ID", "Lead ID", "ID");
  const phone = valueForHeader(row, headerMap, "Phone Number", "Phone", "Contact");
  const normalizedPhone = normalizePhone(phone);
  const sheetIdentity = getSheetIdentity(link);
  const fallbackSourceId = `${sheetIdentity}:row:${rowNumber}`;
  const effectiveSourceId = sourceEnquiryId || fallbackSourceId;

  const existing = (sourceEnquiryId && existingById.get(sourceEnquiryId)) || (effectiveSourceId && existingById.get(effectiveSourceId)) || (normalizedPhone && existingByPhone.get(normalizedPhone)) || null;
  const recordId = existing?.lead?.id || (sourceEnquiryId && CRM_ID_PATTERN.test(sourceEnquiryId) ? sourceEnquiryId : leadIds.next(leadIdContext(link, lead)));
  const status = valueForHeader(row, headerMap, "Status") || existing?.lead?.status || "";
  // The same two sources as `mapRowToCrmCandidate`, in the same order - see the note there.
  const addedTime = valueForHeader(row, headerMap, "Added Time", "Added Timestamp") || enquiryStampTime(lead.createdDate) || existing?.lead?.addedTime || "";
  const rowHasMeaningfulData = row.some((cell) => String(cell || "").trim() !== "");

  return {
    lead: {
      ...(existing?.lead || {}),
      ...lead,
      id: recordId,
      phone: phone || existing?.lead?.phone || "",
      vertical,
      /*
       * The day the lead arrived, which every tab on the board is now read from.
       *
       * `lead.createdDate` is the sheet's own Created Date / Enquiry Date column, and it was missing
       * from this line while its twin `mapRowToCrmCandidate` - the CSV path - had it. So the same
       * spreadsheet imported as a file kept its dates and synced as a link had every row stamped
       * with the day the sync ran: a year of old enquiries all landed on today, which put the whole
       * file into Today New Leads and Yet to connect at once. Today stays the fallback for a source
       * that states no date, which is the only thing left to date such a row by.
       */
      createdDate: existing?.lead?.createdDate || lead.createdDate || importDateKey(),
      addedTime: addedTime || lead.addedTime || lead.addedTimestamp || existing?.lead?.addedTime || "",
      crm: lead.crm || existing?.lead?.crm || "",
      source: lead.source || existing?.lead?.source || "Google sheet integration",
      status,
    },
    details: {
      ...(existing?.details || {}),
      groupType: "google-sheets",
      groupName: "Google sheet integration",
      groupId: existing?.details?.groupId || sheetIdentity,
      importedFrom: String(link.sheetUrl || ""),
      spreadsheetId: String(link.spreadsheetId || ""),
      gid: String(link.gid || ""),
      targetTab: String(link.targetedTab || ""),
      targetedTab: String(link.targetedTab || ""),
      systemTableId: String(link.systemTableId || ""),
      vertical,
      sourceEnquiryId: sourceEnquiryId || existing?.details?.sourceEnquiryId || effectiveSourceId,
      sourceRowNumber: rowNumber,
      lastSourceSyncAt: new Date().toISOString(),
      rowHasMeaningfulData,
    },
  };
}

async function fetchCsvForLink(link) {
  const parsed = parseGoogleSheetUrl(link.sheetUrl);
  const sheetName = String(link.targetedTab || "").trim();
  const gid = String(link.gid || parsed.gid || "").trim();
  const exportUrl = sheetExportUrl({ spreadsheetId: parsed.spreadsheetId, gid: sheetName ? "" : gid, sheetName });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error("timeout")), DEFAULT_TIMEOUT_MS);
  try {
    const response = await fetch(exportUrl, {
      redirect: "follow",
      signal: controller.signal,
      headers: { accept: "text/csv,text/plain,*/*" },
    });
    const text = await response.text();
    if (!response.ok) {
      const error = new Error("Google Sheet cannot be accessed. Change sharing to Anyone with the link → Viewer.");
      error.status = 403;
      throw error;
    }
    if (/login|sign in|accounts\.google/i.test(text) || /<html[\s>]/i.test(text) || !isLikelyCsv(text)) {
      const error = new Error("Google Sheet cannot be accessed. Change sharing to Anyone with the link → Viewer.");
      error.status = 403;
      throw error;
    }
    return { csv: text, spreadsheetId: parsed.spreadsheetId, gid: sheetName ? "" : gid, targetTab: sheetName };
  } catch (error) {
    if (error.name === "AbortError" || String(error.message).includes("timeout")) {
      const timeoutError = new Error("Google Sheet fetch timed out.");
      timeoutError.status = 504;
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

// Pulls the reason Google actually returned out of the nested error body.
function describeGoogleApiError(error) {
  const data = error?.response?.data;
  const parts = [
    data?.error?.message,
    typeof data?.error === "string" ? data.error : null,
    data?.error_description,
    error?.message,
  ].filter((part) => part && String(part).trim());
  return parts.length ? [...new Set(parts.map(String))].join(" | ") : "";
}

function normalizeGoogleApiError(error) {
  // Errors raised by this module already carry an accurate message; only responses
  // coming back from Google need translating.
  if (error?.status && !error?.response) return error;

  const status = error?.response?.status || error?.status || 500;
  const reason = describeGoogleApiError(error);

  let message;
  let mappedStatus;
  if (status === 401) {
    message = "Google authorization has expired. Please reconnect your Google account.";
    mappedStatus = 401;
  } else if (status === 403) {
    // 403 is a permission or API-enablement problem, never an expired token.
    // Reconnecting the same account will not fix it, so do not ask the user to.
    message = reason && /api .*(disabled|not been used)/i.test(reason)
      ? `Google Sheets API access is blocked for this project: ${reason}`
      : "The connected Google account does not have access to this spreadsheet. Share the sheet with that account, or reconnect using an account that can open it.";
    mappedStatus = 403;
  } else if (status === 404) {
    message = "Linked spreadsheet or tab could not be found.";
    mappedStatus = 404;
  } else if (status === 429) {
    message = "Google API rate limit reached. Please try again.";
    mappedStatus = 429;
  } else {
    message = "Unable to read the linked Google Sheet.";
    mappedStatus = 500;
  }

  const mapped = new Error(message);
  mapped.status = mappedStatus;
  mapped.reason = reason;
  mapped.cause = error;
  if (mappedStatus === 401) mapped.code = "GOOGLE_RECONNECT_REQUIRED";
  if (mappedStatus === 403) mapped.code = "GOOGLE_SHEET_ACCESS_DENIED";
  return mapped;
}

async function readLegacyLinkedGoogleSheet(link) {
  const { csv, spreadsheetId, gid, targetTab } = await fetchCsvForLink(link);
  const rows = parseCsv(csv);
  const normalized = normalizeSheetRows(rows);
  return {
    source: "legacy-csv",
    spreadsheetId,
    spreadsheetName: String(link.spreadsheetName || "").trim(),
    targetedTab: String(targetTab || link.targetedTab || ""),
    gid,
    headers: normalized.headers,
    rows: normalized.rows,
    totalRows: normalized.totalRows,
    headerRowNumber: normalized.headerRowNumber,
  };
}

async function readAuthenticatedLinkedGoogleSheet(link) {
  const spreadsheetId = String(link.spreadsheetId || "").trim();
  const targetedTab = String(link.targetedTab || "").trim();
  if (!spreadsheetId) {
    const error = new Error("Linked spreadsheet is missing a spreadsheet ID.");
    error.status = 400;
    throw error;
  }
  if (!targetedTab) {
    const error = new Error("Linked spreadsheet is missing a targeted tab.");
    error.status = 400;
    throw error;
  }

  const { oauth2Client } = await getGoogleSheetConnectionForUser(link.createdByUserId);
  const sheets = google.sheets({ version: "v4", auth: oauth2Client });

  try {
    const spreadsheetResponse = await sheets.spreadsheets.get({
      spreadsheetId,
      fields: "spreadsheetId,properties.title,sheets.properties(sheetId,title,index)",
    });
    const spreadsheetData = spreadsheetResponse?.data || {};
    const sheetMeta = Array.isArray(spreadsheetData.sheets)
      ? spreadsheetData.sheets.map((item) => item?.properties || {}).find((item) => String(item.title || "").trim() === targetedTab)
      : null;
    if (!sheetMeta) {
      const error = new Error("The selected tab is no longer available.");
      error.status = 404;
      throw error;
    }

    const range = `${escapeSheetName(targetedTab)}!A:ZZ`;
    const valuesResponse = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range,
      majorDimension: "ROWS",
      valueRenderOption: "UNFORMATTED_VALUE",
      dateTimeRenderOption: "FORMATTED_STRING",
    });
    const values = Array.isArray(valuesResponse?.data?.values) ? valuesResponse.data.values : [];
    const normalized = normalizeSheetRows(values);
    return {
      source: "authenticated-google-sheets",
      spreadsheetId: String(spreadsheetData.spreadsheetId || spreadsheetId),
      spreadsheetName: String(spreadsheetData.properties?.title || link.spreadsheetName || ""),
      targetedTab,
      sheetId: Number.isInteger(sheetMeta.sheetId) ? sheetMeta.sheetId : null,
      headers: normalized.headers,
      rows: normalized.rows,
      totalRows: normalized.totalRows,
      headerRowNumber: normalized.headerRowNumber,
    };
  } catch (error) {
    throw normalizeGoogleApiError(error);
  }
}

async function readLinkedGoogleSheet(link) {
  if (!link) {
    const error = new Error("Google Sheet link not found.");
    error.status = 404;
    throw error;
  }
  if (String(link.deletedAt || "").trim()) {
    const error = new Error("Google Sheet link is inactive.");
    error.status = 400;
    throw error;
  }
  if (String(link.googleAccountConnectionId || "").trim()) {
    return readAuthenticatedLinkedGoogleSheet(link);
  }
  return readLegacyLinkedGoogleSheet(link);
}

async function listRecordsWithRows() {
  const rows = await getCrmLeadRows();
  return rows.map((row, index) => ({
    rowNumber: index + 2,
    record: mapCrmRow(row),
  }));
}

async function upsertRecord(record) {
  const changed = await upsertCrmLeadRow(record);
  return { ...record, changed };
}

async function createCrmLead(record) {
  return upsertRecord(record);
}

async function createCrmLeads(records) {
  const saved = [];
  for (const record of records) {
    saved.push(await upsertRecord(record));
  }
  return saved;
}

async function updateCrmLead(id, record) {
  const nextRecord = { lead: { ...(record.lead || {}), id }, details: record.details || {} };
  return upsertRecord(nextRecord);
}

async function deleteCrmLead(id) {
  await prisma.$executeRawUnsafe("UPDATE `sales_crm_lead` SET `deleted_at` = ? WHERE `enquiry_id` = ?", new Date(), id);
  return true;
}

async function renameCrmLeadGroup(groupId, groupName) {
  const rows = await getCrmLeadRows();
  const updated = [];
  for (const row of rows) {
    const current = mapCrmRow(row);
    if (current.details.groupId !== groupId) continue;
    const next = { lead: current.lead, details: { ...current.details, groupName } };
    await upsertRecord(next);
    updated.push(next);
  }
  return updated;
}

/**
 * The older whole-sheet refresh, still reached two ways.
 *
 * `POST /api/sales/crm-leads/refresh`, and - the one that matters - `listCrmLeads()`, which falls
 * back to this when the lead table comes back **empty** or when Sheets was last seen unavailable.
 * That is exactly the board-just-cleared case: delete every lead, open CRM Leads, and this ran and
 * upserted the whole spreadsheet back, `deleted_at` and all.
 *
 * It predates the link sync and does none of its work - no classification, no ledger, no summary -
 * so the add-only rule has to be stated again here rather than inherited. Same promise, though: a
 * lead already in the CRM is left exactly as it is, and one that was deleted stays deleted.
 */
async function refreshCrmLeadsFromSheets() {
  const activeLinks = await prisma.$queryRawUnsafe(`
    SELECT
      id,
      system_table_name AS systemTableName,
      system_table_id AS systemTableId,
      vertical AS vertical,
      sheet_url AS sheetUrl,
      spreadsheet_id AS spreadsheetId,
      targeted_tab AS targetedTab,
      status,
      created_by_user_id AS createdByUserId,
      deleted_at AS deletedAt,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM \`sales_google_sheet_link\`
    WHERE deleted_at IS NULL
      AND status = 'ACTIVE'
    ORDER BY created_at ASC
  `);
  if (!activeLinks.length) return [];

  const existingRows = await getCrmLeadRows();
  const leadIds = await loadLeadIdAllocator(existingRows.map((row) => row.enquiryId));
  const existingById = new Map(existingRows.map((row) => [row.enquiryId, mapCrmRow(row)]));
  const existingByPhone = new Map(
    existingRows.map((row) => mapCrmRow(row)).filter((item) => normalizePhone(item.lead?.phone)).map((item) => [normalizePhone(item.lead.phone), item]),
  );
  // The deleted leads, so this path cannot resurrect one either. `null` is the unreadable case and
  // withholds every row, the same answer the link sync gives: this runs when the table is empty,
  // which is when getting it wrong refills a board somebody has just cleared.
  const deletedKeys = await loadDeletedLeadKeys();

  const imported = [];
  for (const link of activeLinks) {
    const { csv, spreadsheetId, gid, targetTab } = await fetchCsvForLink(link);
    const rows = parseCsv(csv);
    if (rows.length < 2) {
      const error = new Error("Google Sheet contains no data rows.");
      error.status = 400;
      throw error;
    }
    const headerRowIndex = rows.findIndex((row) => row.some((cell) => String(cell || "").trim()));
    const headerRow = headerRowIndex >= 0 ? rows[headerRowIndex] : [];
    const headerMap = buildHeaderMap(headerRow);
    const dataRows = headerRowIndex >= 0 ? rows.slice(headerRowIndex + 1) : [];
    for (let index = 0; index < dataRows.length; index += 1) {
      const row = dataRows[index];
      if (!row.some((cell) => String(cell || "").trim())) continue;
      const record = buildRecordFromRow(row, headerMap, { ...link, spreadsheetId, gid, targetedTab: targetTab }, headerRowIndex + index + 2, leadIds, existingById, existingByPhone);
      if (!record) continue;
      /*
       * Add-only, exactly as `runGoogleSheetLinkSync` is. A row whose lead is already here is left
       * alone rather than refreshed - the spreadsheet does not overrule what the studio has since
       * put on the lead - and a row matching a deleted lead is not written at all, or this path
       * would undo the delete the moment somebody opened an empty CRM Leads page.
       */
      const phoneKey = normalizePhone(record.lead?.phone);
      const alreadyHere = existingById.has(record.lead?.id) || (phoneKey && existingByPhone.has(phoneKey));
      if (alreadyHere || deletedKeys === null || matchesDeletedRecord(record, deletedKeys)) continue;
      await upsertRecord(record);
      if (record.lead.phone) existingByPhone.set(normalizePhone(record.lead.phone), record);
      existingById.set(record.lead.id, record);
      imported.push({ rowNumber: index + 2, record });
    }
  }

  // The counter carries on from wherever this run reached, so the next Add Lead save cannot be
  // handed an id a sheet row has just taken.
  await leadIds.commit();
  return imported;
}

async function syncCrmLeadLink(integrationId) {
  const [link] = await prisma.$queryRawUnsafe(
    `
    SELECT
      id,
      system_table_name AS systemTableName,
      system_table_id AS systemTableId,
      vertical AS vertical,
      sheet_url AS sheetUrl,
      spreadsheet_id AS spreadsheetId,
      targeted_tab AS targetedTab,
      status,
      created_by_user_id AS createdByUserId,
      deleted_at AS deletedAt,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM \`sales_google_sheet_link\`
    WHERE id = ? AND deleted_at IS NULL
    LIMIT 1
  `,
    String(integrationId || "").trim(),
  );
  if (!link) {
    const error = new Error("Google Sheet link not found.");
    error.status = 404;
    throw error;
  }

  const { csv, spreadsheetId, gid, targetTab } = await fetchCsvForLink(link);
  const rows = parseCsv(csv);
  if (rows.length < 2) {
    const error = new Error("Google Sheet contains no data rows.");
    error.status = 400;
    throw error;
  }

  const headerRowIndex = rows.findIndex((row) => row.some((cell) => String(cell || "").trim()));
  if (headerRowIndex < 0) {
    const error = new Error("Google Sheet contains no header row.");
    error.status = 400;
    throw error;
  }
  const headerMap = buildHeaderMap(rows[headerRowIndex]);
  const dataRows = rows.slice(headerRowIndex + 1);

  const existingRows = await getCrmLeadRows();
  const leadIds = await loadLeadIdAllocator(existingRows.map((row) => row.enquiryId));
  const existingById = new Map(
    existingRows
      .map((row) => [String(row.sourceEnquiryId || ""), mapCrmRow(row)])
      .filter(([sourceId]) => sourceId),
  );
  const existingByPhone = new Map(
    existingRows.map((row) => mapCrmRow(row)).filter((item) => normalizePhone(item.lead?.phone)).map((item) => [normalizePhone(item.lead.phone), item]),
  );

  let created = 0;
  let updated = 0;
  let skipped = 0;
  const records = [];
  const linkIdentity = { ...link, spreadsheetId, gid, targetedTab: targetTab };

  for (let index = 0; index < dataRows.length; index += 1) {
    const row = dataRows[index];
    if (!row.some((cell) => String(cell || "").trim())) {
      skipped += 1;
      continue;
    }
    const rowNumber = headerRowIndex + index + 2;
    const sourceEnquiryId = valueForHeader(row, headerMap, "Enquiry ID", "Lead ID", "ID");
    const phone = valueForHeader(row, headerMap, "Phone Number", "Phone", "Contact");
    const existing = (sourceEnquiryId && existingById.get(sourceEnquiryId)) || (phone && existingByPhone.get(normalizePhone(phone))) || null;
    const nextRecord = buildRecordFromRow(row, headerMap, linkIdentity, rowNumber, leadIds, existingById, existingByPhone);
    if (!nextRecord) {
      skipped += 1;
      continue;
    }
    const changed = JSON.stringify(nextRecord.lead) !== JSON.stringify(existing?.lead || {}) || JSON.stringify(nextRecord.details) !== JSON.stringify(existing?.details || {});
    await upsertRecord(nextRecord);
    records.push(nextRecord);
    if (existing) {
      updated += changed ? 1 : 0;
    } else {
      created += 1;
    }
    if (nextRecord.lead.phone) existingByPhone.set(normalizePhone(nextRecord.lead.phone), nextRecord);
    if (nextRecord.details?.sourceEnquiryId) existingById.set(nextRecord.details.sourceEnquiryId, nextRecord);
  }

  // The counter carries on from wherever this run reached - see the note on `createLeadIdAllocator`.
  await leadIds.commit();

  return {
    link: {
      id: link.id,
      systemTableName: link.systemTableName,
      systemTableId: link.systemTableId,
      vertical: link.vertical,
      spreadsheetId: String(spreadsheetId || link.spreadsheetId || ""),
      gid: String(gid || link.gid || ""),
      targetTab: String(targetTab || link.targetedTab || ""),
    },
    summary: {
      created,
      updated,
      skipped,
      totalRows: dataRows.length,
    },
    records,
  };
}

function resetSheetsCache() {}

module.exports = {
  createLeadIdAllocator,
  loadLeadIdAllocator,
  leadIdContext,
  resolveRowVertical,
  parseGoogleSheetUrl,
  sheetExportUrl,
  parseCsv,
  resolveColumnMapping,
  mapRowToCrmCandidate,
  // The header and value folding every sheet importer compares with. Exported for the Interview
  // module's own importer, so a heading matches there exactly as it matches here.
  normalizeText,
  normalizePhone,
  normalizeHeaderForMatching,
  prepareGoogleSheetCrmImport,
  syncGoogleSheetLinkToCrm,
  listRecordsWithRows,
  createCrmLead,
  createCrmLeads,
  updateCrmLead,
  deleteCrmLead,
  renameCrmLeadGroup,
  readLinkedGoogleSheet,
  refreshCrmLeadsFromSheets,
  syncCrmLeadLink,
  resetSheetsCache,
};
