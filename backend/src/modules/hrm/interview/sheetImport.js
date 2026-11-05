const { normalizeText, normalizePhone, normalizeHeaderForMatching } = require("../../sales/crm-leads/googleSheetsService");
const { normalizeDateText, splitDayAndTime, toIsoDay, toClockTime } = require("../../sales/crm-leads/leadDates");
const { CANDIDATE_CODE_PATTERN, SHEET_SOURCE, DEFAULT_CANDIDATE_STATUS, normalizeCandidateStatus, normalizeEmploymentType } = require("./candidates");

/**
 * How one row of a linked sheet becomes an interview candidate.
 *
 * The pure half of the Interview module's sheet import - the mapping of headings to fields, the
 * reading of a row, its validation and its classification against what is already in the register.
 * No database and no Google here, so `test/hrm-interview-sheet-import.test.js` can hand it a row and
 * argue with the answer; the reading and writing around it is `sheetSyncService.js`.
 *
 * It is the CRM's `googleSheetsService` importer written for a candidate rather than a lead, and it
 * keeps that importer's decisions on purpose, since the same studio links the same kind of sheet to
 * both: headings match past case, spacing and punctuation; a field claims the first column matching
 * one of its aliases, in declaration order, and a column is used once; the sheet's own Status column
 * is believed; and the assignment rules fill a blank interviewer and never overrule a name somebody
 * typed or a manager's reassignment on the screen.
 */

/*
 * Which sheet headings each field answers to, folded the way `normalizeHeaderForMatching` folds
 * them. Order matters twice over: fields claim columns in this order, and a column can only be
 * claimed once - so `phone` is listed before `whatsappNumber`, and `city` takes "Current Location"
 * before `branch` can read a bare "Location" as the branch applied for.
 */
const CANDIDATE_FIELD_ALIASES = {
  candidateId: ["candidateid", "candidatecode", "id"],
  name: ["name", "candidatename", "fullname", "applicantname", "nameofthecandidate"],
  phone: ["phone", "phonenumber", "mobile", "mobilenumber", "contactnumber", "contact", "mobileno", "phoneno"],
  whatsappNumber: ["whatsappnumber", "whatsapp", "whatsappno"],
  email: ["email", "emailid", "emailaddress", "mailid", "mail"],
  position: ["position", "positionappliedfor", "appliedfor", "role", "designation", "jobtitle", "post", "jobrole", "applyingfor"],
  department: ["department", "team", "function"],
  employmentType: ["employmenttype", "jobtype", "engagementtype", "typeofemployment", "applyingas", "worktype"],
  experience: ["experience", "totalexperience", "yearsofexperience", "exp", "experienceinyears", "workexperience"],
  currentCompany: ["currentcompany", "company", "currentemployer", "employer", "organisation", "organization", "presentcompany"],
  currentDesignation: ["currentdesignation", "currentrole", "currentposition", "presentdesignation"],
  currentCtc: ["currentctc", "currentsalary", "ctc", "presentctc", "presentsalary"],
  expectedCtc: ["expectedctc", "expectedsalary", "salaryexpectation", "expectedpay"],
  noticePeriod: ["noticeperiod", "notice", "joiningtime"],
  availableFrom: ["availablefrom", "availability", "canjoinfrom", "joiningdate", "earliestjoiningdate", "whencanyoujoin", "whencanujoin", "joiningavailability"],
  highestQualification: ["highestqualification", "qualification", "education", "degree", "educationalqualification"],
  skills: ["skills", "skillset", "keyskills", "expertise"],
  languagesKnown: ["languagesknown", "languages", "language"],
  portfolioUrl: ["portfolio", "portfoliolink", "portfoliourl", "worksamples", "website", "instagram", "behance"],
  gender: ["gender", "sex"],
  dateOfBirth: ["dateofbirth", "dob", "birthdate"],
  address: ["address", "currentaddress", "residentialaddress"],
  /*
   * City keeps only the headings that mean a city. "currentlocation", "hometown" and "nativeplace"
   * used to fold onto it because there was nowhere else for them to go - so a sheet naming both a
   * hometown and a current location had one of them silently overwrite the other in one column.
   * They have columns of their own now, and each heading goes to the one it actually names.
   */
  city: ["city", "currentcity"],
  nativePlace: ["nativeplace", "native", "hometown", "homevillage", "hometownvillage", "placeofbirth"],
  currentLocation: ["currentlocation", "currentplace", "presentlocation", "livingin", "residingat"],
  state: ["state"],
  branch: ["branch", "preferredbranch", "preferredlocation", "location", "nearestbranch", "workingbranch", "appliedbranch"],
  source: ["source", "leadsource", "applicationsource", "channel", "platform", "sourcedfrom", "jobportal"],
  // What a Meta lead export calls the ad hierarchy, in its own spelling and in the underscored
  // spelling its CSV uses. "adname" is tried before "ad" so a sheet carrying both is read right.
  campaignName: ["campaignname", "campaign", "campaignid"],
  adsetName: ["adsetname", "adset", "adsetid", "adgroupname", "adgroup"],
  adName: ["adname", "ad", "adid", "creativename", "adcreative"],
  referredBy: ["referredby", "reference", "referral", "referrername"],
  resumeUrl: ["resume", "resumeurl", "resumelink", "cv", "cvlink", "profilelink"],
  status: ["status", "interviewstatus", "candidatestatus", "stage", "currentstatus", "hiringstatus"],
  interviewer: ["interviewer", "interviewedby", "assignedto", "hr", "recruiter", "owner", "assignedhr", "handledby"],
  interviewDate: ["interviewdate", "interviewon", "scheduledon", "dateofinterview", "scheduleddate"],
  interviewTime: ["interviewtime", "timeofinterview", "scheduledtime"],
  interviewMode: ["interviewmode", "mode", "interviewtype", "modeofinterview"],
  meetLink: ["meetlink", "meetinglink", "googlemeet", "googlemeetlink"],
  // "Timestamp" is what a Google Form writes for the moment the response arrived, and it carries
  // the clock time as well - `mapRowToCandidate` reads both halves off it.
  appliedDate: ["applieddate", "appliedon", "dateapplied", "applicationdate", "createddate", "date", "timestamp", "enquirydate"],
  addedTime: ["addedtime", "time", "appliedtime"],
  lastFollowUpDate: ["lastfollowupdate", "lastfollowup"],
  nextFollowUpDate: ["nextfollowupdate", "nextfollowup", "followupdate", "followup"],
  remarks: ["remarks", "notes", "comments", "feedback", "remark", "comment"],
};

const CANDIDATE_FIELD_ORDER = Object.keys(CANDIDATE_FIELD_ALIASES);
/** The date fields, folded to `YYYY-MM-DD` where they parse and checked where they do not. */
const CANDIDATE_DATE_FIELDS = ["appliedDate", "interviewDate", "lastFollowUpDate", "nextFollowUpDate", "dateOfBirth", "availableFrom"];
const CANDIDATE_PHONE_FIELDS = ["phone", "whatsappNumber"];

const normalizeEmail = (value) => String(value || "").trim().toLowerCase();

/**
 * Which column each field reads, from the sheet's headings.
 *
 * The same algorithm the CRM importer uses (`resolveColumnMapping` there): a field's own name is
 * tried first as an exact heading, then its aliases in order, and a column is claimed once. What is
 * left over is `unmappedHeaders`, which is exactly the set an assignment rule is most often written
 * against - "Page Name", "Form Name" - and what the preview lists so a heading nothing reads is
 * visible rather than silently dropped.
 */
function resolveColumnMapping(headers = []) {
  const entries = (Array.isArray(headers) ? headers : []).map((header, index) => ({
    columnIndex: index,
    sourceHeader: String(header || ""),
    normalizedHeader: normalizeHeaderForMatching(header),
  }));
  const fields = {};
  const used = new Set();

  const claim = (fieldName, candidate) => {
    const wanted = normalizeHeaderForMatching(candidate);
    if (!wanted) return false;
    const found = entries.find((entry) => !used.has(entry.columnIndex) && entry.normalizedHeader === wanted);
    if (!found) return false;
    fields[fieldName] = { columnIndex: found.columnIndex, sourceHeader: found.sourceHeader };
    used.add(found.columnIndex);
    return true;
  };

  for (const fieldName of CANDIDATE_FIELD_ORDER) {
    if (claim(fieldName, fieldName)) continue;
    for (const alias of CANDIDATE_FIELD_ALIASES[fieldName]) {
      if (claim(fieldName, alias)) break;
    }
  }

  return {
    fields,
    headers: entries.map((entry) => entry.sourceHeader),
    unmappedHeaders: entries.filter((entry) => !used.has(entry.columnIndex)).map((entry) => entry.sourceHeader),
    missingRequiredFields: fields.name ? [] : ["name"],
  };
}

function getMappedRowValue(row, mapping, fieldName) {
  const entry = mapping?.fields?.[fieldName];
  if (!entry || entry.columnIndex === undefined) return "";
  return String(row?.[entry.columnIndex] ?? "").trim();
}

/** The sheet and tab a link reads, as one string - the same identity the CRM importer builds. */
function sheetIdentity(link = {}) {
  const spreadsheetId = String(link.spreadsheetId || "").trim();
  const gid = String(link.gid || "").trim();
  const tab = String(link.targetedTab || "").trim();
  return `${spreadsheetId}:${gid || tab || "default"}`;
}

/**
 * Spreadsheet + tab + row position: stable across every source id shape, so a re-sync re-matches a
 * row that carries no phone and no email. The tab is part of it, or row 2 of one tab would match
 * row 2 of every other tab in the same spreadsheet.
 */
function sheetPositionKey(spreadsheetId, tab, rowNumber) {
  const sheet = String(spreadsheetId || "").trim();
  const row = String(rowNumber ?? "").trim();
  if (!sheet || !row) return "";
  return `${sheet}:${String(tab || "").trim()}:row:${row}`;
}

/** The candidate rows already in the register, indexed every way a sheet row can be matched to one. */
function buildExistingIndexes(existingRows = []) {
  const records = (Array.isArray(existingRows) ? existingRows : []).map((row) => ({
    candidate: { ...row },
    details: {
      sourceRowId: row.sourceRowId || "",
      sourceRowNumber: row.sourceRowNumber || null,
      spreadsheetId: row.spreadsheetId || "",
      gid: row.gid || "",
      targetTab: row.targetTab || "",
    },
  }));
  const byId = new Map();
  const byPhone = new Map();
  const byEmail = new Map();
  const bySheetPosition = new Map();
  for (const item of records) {
    const code = String(item.candidate.candidateCode || "").trim();
    if (code) byId.set(code, item);
    const sourceId = String(item.details.sourceRowId || "").trim();
    if (sourceId && !byId.has(sourceId)) byId.set(sourceId, item);
    const phone = normalizePhone(item.candidate.phone);
    if (phone && !byPhone.has(phone)) byPhone.set(phone, item);
    const email = normalizeEmail(item.candidate.email);
    if (email && !byEmail.has(email)) byEmail.set(email, item);
    const position = sheetPositionKey(item.details.spreadsheetId, item.details.gid || item.details.targetTab, item.details.sourceRowNumber);
    if (position && !bySheetPosition.has(position)) bySheetPosition.set(position, item);
  }
  return { records, byId, byPhone, byEmail, bySheetPosition };
}

/**
 * One sheet row as the candidate it describes.
 *
 * `codes` hands out candidate codes in memory - see `loadCandidateCodeAllocator` in the sync
 * service - and `indexes` is what `buildExistingIndexes` returns, so a row the register already
 * holds keeps its code and its screen-only fields. `link.assignmentMatcher` and `link.coverResolver`
 * are attached by the sync service once per pass; without them a row is simply not assigned.
 */
function mapRowToCandidate(row = [], mapping = {}, link = {}, rowNumber = 0, codes = null, indexes = buildExistingIndexes([])) {
  const values = {};
  for (const fieldName of CANDIDATE_FIELD_ORDER) {
    const value = getMappedRowValue(row, mapping, fieldName);
    if (value !== "") values[fieldName] = value;
  }

  const sheetCandidateId = getMappedRowValue(row, mapping, "candidateId");
  const phone = getMappedRowValue(row, mapping, "phone");
  const normalizedPhone = normalizePhone(phone);
  const email = normalizeEmail(values.email);
  const identity = sheetIdentity(link);
  const fallbackSourceId = `${identity}:row:${rowNumber}`;
  const effectiveSourceId = sheetCandidateId || fallbackSourceId;
  const position = sheetPositionKey(link.spreadsheetId, link.gid || link.targetedTab, rowNumber);

  const existing =
    (sheetCandidateId && indexes.byId.get(sheetCandidateId)) ||
    indexes.byId.get(effectiveSourceId) ||
    (position && indexes.bySheetPosition.get(position)) ||
    (normalizedPhone && indexes.byPhone.get(normalizedPhone)) ||
    (email && indexes.byEmail.get(email)) ||
    null;
  const existingCandidate = existing?.candidate || {};

  const candidateCode =
    existingCandidate.candidateCode ||
    (CANDIDATE_CODE_PATTERN.test(sheetCandidateId) ? sheetCandidateId : codes ? codes.next() : "");

  /*
   * The day the application arrived, and the clock time beside it. A Google Form's Timestamp
   * states both in one cell; a sheet with an Applied Date and a Time column states them apart.
   * The row's own answer first, then what the candidate already holds, then today - a sheet that
   * says nothing about when is still filed under the day it was read.
   */
  const stamp = splitDayAndTime(values.appliedDate || "");
  const appliedDate = normalizeDateText(stamp.day) || existingCandidate.appliedDate || importDateKey();
  const addedTime = values.addedTime || stamp.clock || existingCandidate.addedTime || "";

  const status = normalizeCandidateStatus(values.status) || existingCandidate.status || DEFAULT_CANDIDATE_STATUS;
  const employmentType = normalizeEmploymentType(values.employmentType) || existingCandidate.employmentType || "";

  /*
   * Whose candidate this is, in the order the answers are trusted: the sheet's own Interviewer
   * column, then whoever already has them on the screen, then the link's assignment rules. The
   * rules fill blanks and never overrule people - the poller re-reads every row every two minutes,
   * and a rule allowed to win would undo a reassignment within the minute.
   */
  const alreadyOwned = String(values.interviewer || existingCandidate.interviewer || "").trim();
  const matched = !alreadyOwned && link.assignmentMatcher ? link.assignmentMatcher.assign(row) : null;
  const cover = matched && link.coverResolver ? link.coverResolver(matched.rule.targetEmployeeId) : null;
  const assignment = !matched
    ? null
    : !link.coverResolver
      ? matched
      : cover
        ? { ...matched, crm: cover.name || matched.crm, cover: cover.covering ? cover : null }
        : null;

  const candidate = {
    ...existingCandidate,
    ...values,
    candidateCode,
    phone: phone || existingCandidate.phone || "",
    email: values.email || existingCandidate.email || "",
    status,
    employmentType,
    appliedDate,
    addedTime,
    interviewer: alreadyOwned || assignment?.crm || "",
    source: values.source || existingCandidate.source || SHEET_SOURCE,
  };
  for (const field of CANDIDATE_DATE_FIELDS) {
    if (candidate[field]) candidate[field] = normalizeDateText(candidate[field]);
  }
  if (candidate.interviewTime) candidate.interviewTime = toClockTime(candidate.interviewTime) || candidate.interviewTime;
  delete candidate.candidateId;

  const record = {
    candidate,
    details: {
      sourceRowId: sheetCandidateId || existing?.details?.sourceRowId || effectiveSourceId,
      sourceRowNumber: rowNumber,
      spreadsheetId: String(link.spreadsheetId || ""),
      gid: String(link.gid || ""),
      targetTab: String(link.targetedTab || ""),
      systemTableId: String(link.systemTableId || ""),
      importedFrom: String(link.sheetUrl || ""),
    },
  };

  return {
    record,
    assignment: assignment ? { crm: assignment.crm, rule: assignment.rule, cover: assignment.cover || null } : null,
    // What the preview prints per row: the handful of answers that say who this is.
    candidate: {
      name: candidate.name || "",
      phone: candidate.phone || "",
      email: candidate.email || "",
      status: candidate.status || "",
      interviewer: candidate.interviewer || "",
      position: candidate.position || "",
    },
    mapping: {
      fields: mapping?.fields || {},
      headers: mapping?.headers || [],
      unmappedHeaders: mapping?.unmappedHeaders || [],
      missingRequiredFields: mapping?.missingRequiredFields || [],
    },
  };
}

/** What has to be true of a row before it is written. */
function validateCandidateRecord(record) {
  const issues = [];
  const candidate = record?.candidate || {};

  if (!String(candidate.name || "").trim()) issues.push({ field: "name", reason: "Candidate name is required." });

  const email = normalizeEmail(candidate.email);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) issues.push({ field: "email", reason: "Invalid email format." });

  for (const field of CANDIDATE_PHONE_FIELDS) {
    const value = String(candidate[field] || "").trim();
    if (value && !/^\+?\d[\d\s()-]{7,}\d$/.test(value)) issues.push({ field, reason: "Invalid phone/contact value." });
  }

  // A cell that is not a day is refused rather than stored as one: "next week" in Interview Date
  // is a note in the wrong column, and filing it as a date would put the candidate in no tab.
  for (const field of CANDIDATE_DATE_FIELDS) {
    const value = String(candidate[field] || "").trim();
    if (value && !toIsoDay(value)) issues.push({ field, reason: "Invalid date value." });
  }

  return { valid: issues.length === 0, issues };
}

/**
 * Whether this row is new, an edit of a candidate already here, or a repeat within the same sheet.
 *
 * Matched in the order the CRM importer matches: the row's own source id, its position on the
 * sheet, then the phone, then the email. `seenInBatch` is the rows already read this pass, so the
 * same person twice in one sheet is reported as a duplicate rather than written twice.
 */
function classifyAgainstExisting(record, indexes, seenInBatch = new Map()) {
  const candidate = record?.candidate || {};
  const details = record?.details || {};
  const sourceId = String(details.sourceRowId || "").trim();
  const phone = normalizePhone(candidate.phone);
  const email = normalizeEmail(candidate.email);
  const position = sheetPositionKey(details.spreadsheetId, details.gid || details.targetTab, details.sourceRowNumber);

  const duplicateKey = phone || email || sourceId;
  if (duplicateKey && seenInBatch.has(duplicateKey)) {
    return { classification: "DUPLICATE_IN_SHEET", matchedRecord: seenInBatch.get(duplicateKey), matchBy: phone ? "phone" : email ? "email" : "sourceRowId" };
  }
  if (duplicateKey) seenInBatch.set(duplicateKey, record);

  const bySource = sourceId ? indexes.byId.get(sourceId) : null;
  const byPosition = position ? indexes.bySheetPosition.get(position) : null;
  const byPhone = phone ? indexes.byPhone.get(phone) : null;
  const byEmail = email ? indexes.byEmail.get(email) : null;
  const existing = bySource || byPosition || byPhone || byEmail || null;
  if (existing) {
    return {
      classification: "EXISTING",
      matchedRecord: existing,
      matchBy: bySource ? "sourceRowId" : byPosition ? "sheetPosition" : byPhone ? "phone" : "email",
    };
  }
  return { classification: "NEW", matchedRecord: null, matchBy: null };
}

/** Today in the studio's own zone, as the day a row with no date of its own is filed under. */
function importDateKey() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

/** The row's own identity, as the ledger of imported rows records it. */
const importedRowKey = (record) => String(record?.details?.sourceRowId || "").trim();

/*
 * ── Recognising somebody the studio has deleted ──────────────────────────────────────────────
 *
 * The row ledger already holds a deleted row down, but only under the key that row had when it was
 * imported - and where the sheet carries no id column of its own, that key is its *row number*.
 * Insert a row near the top of the spreadsheet and every row beneath it shifts down one, arrives
 * under a key the ledger has never seen, and a candidate the studio deleted walks straight back in.
 *
 * So the deleted candidates are asked directly as well, on the same three identities the classifier
 * matches live records by - source row id, phone, email - so that "already here" and "deleted from
 * here" can never disagree about who a row is. A row matching one of these is that person wherever
 * the row now sits in the sheet.
 */
function deletedRecordKeys({ sourceRowId, phone, email } = {}) {
  const keys = [];
  const id = String(sourceRowId || "").trim();
  if (id) keys.push(`id:${id}`);
  const tel = normalizePhone(phone);
  if (tel) keys.push(`tel:${tel}`);
  const mail = normalizeEmail(email);
  if (mail) keys.push(`mail:${mail}`);
  return keys;
}

/** Every identity held by a deleted candidate, flattened into one set to test arrivals against. */
function buildDeletedKeySet(rows = []) {
  const set = new Set();
  for (const row of Array.isArray(rows) ? rows : []) {
    for (const key of deletedRecordKeys(row)) set.add(key);
  }
  return set;
}

/** Whether an arriving row is somebody already deleted here, on any one of their identities. */
function matchesDeletedRecord(record, deletedKeys) {
  if (!deletedKeys || !deletedKeys.size) return false;
  return deletedRecordKeys({
    sourceRowId: record?.details?.sourceRowId,
    phone: record?.candidate?.phone,
    email: record?.candidate?.email,
  }).some((key) => deletedKeys.has(key));
}

module.exports = {
  CANDIDATE_FIELD_ALIASES,
  CANDIDATE_FIELD_ORDER,
  CANDIDATE_DATE_FIELDS,
  resolveColumnMapping,
  getMappedRowValue,
  sheetIdentity,
  sheetPositionKey,
  buildExistingIndexes,
  mapRowToCandidate,
  validateCandidateRecord,
  classifyAgainstExisting,
  importedRowKey,
  buildDeletedKeySet,
  matchesDeletedRecord,
  importDateKey,
  normalizeEmail,
  normalizeText,
  normalizePhone,
};
