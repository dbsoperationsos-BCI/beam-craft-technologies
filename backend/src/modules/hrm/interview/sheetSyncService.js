const prisma = require("../../../config/db");
const { readLinkedGoogleSheet } = require("../../sales/crm-leads/googleSheetsService");
const { buildAssignmentMatcher } = require("../../sales/crm-leads/leadAssignmentRules");
const { lookups: referenceLookups } = require("../../../services/referenceMatchers");
const { loadCoverContext, buildCoverResolver } = require("../../../services/leadCover");
const { listRulesForLink, recordAssignedCounts } = require("./sheetRulesStore");
const { CANDIDATE_SEQUENCE_KEY, formatCandidateCode, parseCandidateCode } = require("./candidates");
const {
  resolveColumnMapping,
  buildExistingIndexes,
  mapRowToCandidate,
  validateCandidateRecord,
  classifyAgainstExisting,
  importedRowKey,
  buildDeletedKeySet,
  matchesDeletedRecord,
} = require("./sheetImport");

/**
 * Reading a linked Interview sheet and writing what it says into the candidate register.
 *
 * The CRM's `googleSheetsService` for candidates rather than leads, reading the sheet through the
 * same Google connection (`readLinkedGoogleSheet` is reused as it stands) and keeping the same
 * three-way answer for every row - one already in the register and therefore left alone, a row the
 * studio deleted and must stay deleted, or a genuinely new one - through a ledger of its own
 * (`hrm_interview_google_sheet_row`).
 *
 * A sync only ever *adds*. The sheet is where a candidate arrives; the register is where they are
 * then worked on, so a cell corrected in the spreadsheet afterwards never overwrites what the
 * studio has since put on the record.
 *
 * `prepareInterviewSheetImport` is the dry run the preview shows and the plan the sync executes;
 * `syncInterviewSheetLink` runs it and records the outcome on the link. The row-level decisions are
 * in `sheetImport.js`, which has no database in it and is what the tests argue with.
 */

// How many "row 12 - Candidate name is required" lines a sync keeps on the link. Enough to correct
// a handful in one go, few enough that a wholly invalid sheet cannot write a huge summary each pass.
const ROW_PROBLEM_LIMIT = 5;

/*
 * ── Handing out candidate codes while a sheet is read ────────────────────────────────────────
 *
 * The row mapper is synchronous and runs once per row, so the codes are handed out in memory from
 * a counter seeded from two places: the shared sequence table, so a code the form has already been
 * given is never re-issued, and the codes already in the register, so a counter left behind by a
 * restore cannot re-issue one on a row. `commit` lifts the sequence to what this run reached, and
 * only once the rows holding those codes have actually been written - the preview never commits.
 */
async function loadCandidateCodeAllocator(existingCodes = [], client = prisma) {
  const row = await client.appSequence.findUnique({ where: { key: CANDIDATE_SEQUENCE_KEY } });
  let value = Number(row?.currentValue || 0);
  for (const code of existingCodes) {
    const parsed = parseCandidateCode(code);
    if (parsed > value) value = parsed;
  }
  const start = value;
  return {
    next() {
      value += 1;
      return formatCandidateCode(value);
    },
    async commit(writer = client) {
      if (value === start) return;
      await writer.appSequence.upsert({
        where: { key: CANDIDATE_SEQUENCE_KEY },
        create: { key: CANDIDATE_SEQUENCE_KEY, currentValue: value },
        update: {},
      });
      // Never lowered: a form save in the meantime may have taken the counter past this run.
      await writer.$executeRaw`UPDATE \`app_sequence\` SET \`current_value\` = GREATEST(\`current_value\`, ${value}) WHERE \`key\` = ${CANDIDATE_SEQUENCE_KEY}`;
    },
  };
}

/** Every row key this link has already imported, or null where the ledger could not be read. */
async function loadImportedRowKeys(linkId) {
  const id = String(linkId || "").trim();
  if (!id) return new Set();
  try {
    const rows = await prisma.hrmInterviewGoogleSheetRow.findMany({ where: { linkId: id }, select: { rowKey: true } });
    return new Set(rows.map((row) => String(row.rowKey || "")).filter(Boolean));
  } catch (error) {
    // The safe answer to "have I seen this row?" when the memory is unavailable is *yes* - it
    // holds the register still instead of refilling it - so the empty set is never the fallback.
    console.warn("Unable to read the imported interview sheet rows for", id, error?.message || error);
    return null;
  }
}

/**
 * The identities of any candidate still sitting behind a `deleted_at`, as one set of keys.
 *
 * Deleting a candidate removes the row now, so nothing new ever lands here - but a register that
 * ran the old soft delete still holds those rows, and they must go on being recognised until they
 * are cleared out. Empty is therefore the ordinary answer and costs one indexed query a pass.
 *
 * `null` where it could not be read, which withholds every new row: adding nothing is recoverable
 * on the next pass, refilling a register the studio has just cleared is not.
 */
async function loadDeletedCandidateKeys() {
  try {
    const rows = await prisma.hrmInterviewCandidate.findMany({
      where: { deletedAt: { not: null } },
      select: { phone: true, email: true, sourceRowId: true },
    });
    return buildDeletedKeySet(rows);
  } catch (error) {
    console.warn("Unable to read the deleted interview candidates:", error?.message || error);
    return null;
  }
}

/** Notes a row as imported. Never allowed to fail the sync: the candidate is written either way. */
async function recordImportedRow(linkId, rowKey, candidateCode) {
  const id = String(linkId || "").trim();
  const key = String(rowKey || "").trim().slice(0, 255);
  if (!id || !key) return;
  try {
    await prisma.hrmInterviewGoogleSheetRow.upsert({
      where: { linkId_rowKey: { linkId: id, rowKey: key } },
      create: { linkId: id, rowKey: key, candidateCode: String(candidateCode || "").slice(0, 30) || null },
      // Re-importing a row the ledger already knows keeps the first sighting.
      update: {},
    });
  } catch (error) {
    console.warn("Unable to record an imported interview sheet row for", id, error?.message || error);
  }
}

/**
 * Notes the outcome of a sync on the link itself - three columns updated in place rather than a
 * row per run, because the poller runs every two minutes. Never allowed to fail a sync.
 */
async function recordLinkSync(linkId, status, summary) {
  if (!linkId) return;
  try {
    await prisma.hrmInterviewGoogleSheetLink.update({
      where: { id: String(linkId) },
      data: { lastSyncedAt: new Date(), lastSyncStatus: String(status || "OK").slice(0, 30), lastSyncSummary: JSON.stringify(summary || {}) },
    });
  } catch (error) {
    console.warn("Unable to record the interview sync outcome for", linkId, error?.message || error);
  }
}

/** The columns a sheet row fills when the candidate is first created. Never rewritten afterwards. */
const SHEET_WRITTEN_FIELDS = [
  "name", "phone", "whatsappNumber", "email", "position", "department", "employmentType", "experience", "currentCompany",
  "currentDesignation", "currentCtc", "expectedCtc", "noticePeriod", "availableFrom", "highestQualification", "skills",
  "languagesKnown", "portfolioUrl", "gender", "dateOfBirth", "address", "city", "nativePlace", "currentLocation", "state", "branch", "source",
  // The ad hierarchy a Meta lead export carries. Written on every pass like the rest of the sheet's
  // own columns: a studio that renames a campaign mid-flight expects the register to say the new
  // name, and these are columns only a sheet ever fills.
  "campaignName", "adsetName", "adName", "referredBy",
  "resumeUrl", "status", "interviewer", "interviewDate", "interviewTime", "interviewMode", "meetLink", "appliedDate",
  "addedTime", "lastFollowUpDate", "nextFollowUpDate", "remarks",
];

/**
 * One new row, written.
 *
 * Only rows classified `NEW` reach this, so it is a create in all but one case: a code collision,
 * where the allocator has handed out a code some candidate already holds. That is an integrity
 * fault rather than a sheet edit, and writing over it is better than throwing the row back to be
 * retried forever, so the update branch stays. It is not the path a changed spreadsheet cell takes
 * - such a row is classified `EXISTING` and never gets here.
 */
async function upsertCandidateRecord(record, link) {
  const candidate = record.candidate || {};
  const details = record.details || {};
  const refs = await referenceLookups();
  const branch = refs.branchName(candidate.branch || "") || candidate.branch || null;
  const data = {};
  for (const field of SHEET_WRITTEN_FIELDS) {
    const value = candidate[field];
    data[field] = value === undefined || value === null || value === "" ? null : String(value);
  }
  data.branch = branch;
  data.branchId = refs.branchId(branch || "");
  data.interviewerEmployeeId = refs.employeeId(candidate.interviewer || "");
  data.sourceRowId = String(details.sourceRowId || "").slice(0, 255) || null;
  data.sourceRowNumber = Number.isInteger(details.sourceRowNumber) ? details.sourceRowNumber : null;
  data.spreadsheetId = details.spreadsheetId || null;
  data.gid = details.gid || null;
  data.targetTab = details.targetTab || null;
  data.systemTableId = details.systemTableId || null;

  const code = String(candidate.candidateCode || "").trim();
  const existing = await prisma.hrmInterviewCandidate.findUnique({ where: { candidateCode: code } });
  if (!existing) {
    await prisma.hrmInterviewCandidate.create({
      data: {
        ...data,
        candidateCode: code,
        status: data.status || "Yet to Connect",
        name: data.name || "",
        lastSourceSyncAt: new Date(),
        createdByUserId: link?.createdByUserId ?? null,
      },
    });
    return { created: true, changed: true };
  }

  const changed = Object.keys(data).some((key) => (existing[key] ?? null) !== (data[key] ?? null)) || Boolean(existing.deletedAt);
  if (!changed) return { created: false, changed: false };
  await prisma.hrmInterviewCandidate.update({
    where: { candidateCode: code },
    data: { ...data, status: data.status || existing.status, name: data.name || existing.name, deletedAt: null },
  });
  return { created: false, changed: true };
}

/**
 * The plan for one link: every row read, mapped, checked and classified, with nothing written.
 *
 * Backs both the preview and the sync, so what the preview shows is exactly what the sync will do.
 * The assignment rules and the cover resolver are loaded here rather than handed in, for the reason
 * the CRM importer gives: every caller builds the link object its own way, and a rule set carried on
 * it would be missed by one of them and fail silently as candidates arriving unassigned.
 */
async function prepareInterviewSheetImport(link) {
  const sheet = await readLinkedGoogleSheet(link);
  const resolvedLink = {
    ...link,
    spreadsheetId: sheet.spreadsheetId || link.spreadsheetId || "",
    gid: String(sheet.gid ?? sheet.sheetId ?? link.gid ?? ""),
    targetedTab: sheet.targetedTab || link.targetedTab || "",
  };
  const headers = Array.isArray(sheet.headers) ? sheet.headers : [];
  const mapping = resolveColumnMapping(headers);
  const assignmentRules = await listRulesForLink(link?.id);
  const assignmentMatcher = buildAssignmentMatcher(headers, assignmentRules);
  const coverResolver = assignmentRules.length ? buildCoverResolver(await loadCoverContext()) : null;
  const existingRows = await prisma.hrmInterviewCandidate.findMany({ where: { deletedAt: null } });
  const indexes = buildExistingIndexes(existingRows);
  const importedRowKeys = await loadImportedRowKeys(link?.id);
  const deletedKeys = await loadDeletedCandidateKeys();
  const codes = await loadCandidateCodeAllocator(existingRows.map((row) => row.candidateCode));
  const seenInBatch = new Map();

  resolvedLink.assignmentMatcher = assignmentMatcher;
  resolvedLink.coverResolver = coverResolver;

  const rows = [];
  const counts = { valid: 0, invalid: 0, duplicate: 0, existing: 0, new: 0, deleted: 0, assignedByRule: 0, unassigned: 0 };

  for (const sheetRow of Array.isArray(sheet.rows) ? sheet.rows : []) {
    const mapped = mapRowToCandidate(sheetRow.values || [], { ...mapping, headers }, resolvedLink, sheetRow.rowNumber, codes, indexes);
    const validation = validateCandidateRecord(mapped.record);
    const classification = classifyAgainstExisting(mapped.record, indexes, seenInBatch);
    const rowIssues = [...validation.issues];
    const rowKey = importedRowKey(mapped.record);
    /*
     * A row whose candidate was deleted on purpose stays deleted, and is recognised two ways: by
     * the ledger, which remembers that this link imported that row, and by the deleted candidates
     * themselves, which catches the row after the spreadsheet has shifted it onto a new row number.
     * Either is enough. An unreadable ledger or tombstone set withholds every new row rather than
     * risk re-importing the sheet over a register the studio has just cleared.
     */
    const alreadyImported = classification.classification === "NEW"
      && (importedRowKeys === null
        || deletedKeys === null
        || (rowKey && importedRowKeys.has(rowKey))
        || matchesDeletedRecord(mapped.record, deletedKeys));

    if (classification.classification === "DUPLICATE_IN_SHEET") {
      rowIssues.push({ field: "duplicate", reason: "Duplicate row within the same spreadsheet import batch." });
      counts.duplicate += 1;
    } else if (classification.classification === "EXISTING") {
      counts.existing += 1;
    } else if (alreadyImported) {
      counts.deleted += 1;
    } else {
      counts.new += 1;
    }
    if (validation.valid) counts.valid += 1;
    else counts.invalid += 1;
    if (mapped.assignment) counts.assignedByRule += 1;
    else if (!String(mapped.record?.candidate?.interviewer || "").trim()) counts.unassigned += 1;

    rows.push({
      rowNumber: sheetRow.rowNumber,
      candidate: mapped.candidate,
      record: mapped.record,
      mapping: mapped.mapping,
      assignment: mapped.assignment,
      classification: !validation.valid ? "INVALID" : alreadyImported ? "ALREADY_IMPORTED" : classification.classification,
      rowKey,
      matchedRecord: classification.matchedRecord || null,
      matchedBy: classification.matchBy,
      valid: validation.valid,
      issues: rowIssues,
    });
  }

  return {
    source: sheet.source,
    codes,
    spreadsheetId: sheet.spreadsheetId,
    spreadsheetName: sheet.spreadsheetName,
    targetedTab: sheet.targetedTab,
    headers,
    mapping,
    assignment: {
      ruleCount: assignmentRules.length,
      activeRules: assignmentMatcher.activeRules,
      missingColumns: assignmentMatcher.missingColumns,
    },
    summary: {
      totalRows: rows.length,
      validRows: counts.valid,
      invalidRows: counts.invalid,
      duplicateRows: counts.duplicate,
      existingRows: counts.existing,
      newRows: counts.new,
      alreadyImportedRows: counts.deleted,
      assignedByRule: counts.assignedByRule,
      unassignedRows: counts.unassigned,
    },
    rows,
  };
}

async function runInterviewSheetSync(link) {
  const preview = await prepareInterviewSheetImport(link);
  const actions = [];
  // `skippedSameContact` is the subset of `skippedExisting` recognised by phone or email rather
  // than by which row of the sheet they came from - a candidate the register already holds under
  // another record, which is the case worth naming rather than folding into housekeeping.
  const totals = { created: 0, skippedExisting: 0, skippedSameContact: 0, skippedDuplicate: 0, skippedInvalid: 0, skippedDeleted: 0, failed: 0 };
  const rowProblems = [];
  const noteProblem = (rowNumber, reason) => {
    if (rowProblems.length >= ROW_PROBLEM_LIMIT) return;
    const text = String(reason || "").trim();
    if (text) rowProblems.push({ rowNumber, reason: text.slice(0, 160) });
  };

  for (const row of preview.rows) {
    const classification = String(row.classification || "");
    if (classification === "DUPLICATE_IN_SHEET") {
      totals.skippedDuplicate += 1;
      actions.push({ rowNumber: row.rowNumber, action: "SKIPPED_DUPLICATE" });
      continue;
    }
    if (classification === "INVALID") {
      totals.skippedInvalid += 1;
      noteProblem(row.rowNumber, (row.issues || [])[0]?.reason);
      actions.push({ rowNumber: row.rowNumber, action: "SKIPPED_INVALID", issues: row.issues || [] });
      continue;
    }
    if (classification === "ALREADY_IMPORTED") {
      totals.skippedDeleted += 1;
      actions.push({ rowNumber: row.rowNumber, action: "SKIPPED_DELETED", rowKey: row.rowKey || "" });
      continue;
    }
    /*
     * Already in the register, and left exactly as it stands.
     *
     * The sheet is not entitled to overrule the register every two minutes: once a candidate is
     * here they are worked on here, and a cell corrected in the spreadsheet afterwards must not
     * overwrite a status, an interviewer or a remark the studio has since put on the record.
     * Counted and named rather than dropped quietly, so a pass that wrote nothing can still say
     * why. Rows that were rejected or failed to write are never recorded as imported, so those -
     * and only those, besides genuinely new rows - are what a later pass picks up again.
     */
    if (classification === "EXISTING") {
      totals.skippedExisting += 1;
      if (row.matchedBy === "phone" || row.matchedBy === "email") totals.skippedSameContact += 1;
      actions.push({
        rowNumber: row.rowNumber,
        action: "SKIPPED_EXISTING",
        candidateCode: row.matchedRecord?.candidate?.candidateCode || "",
        matchedBy: row.matchedBy || null,
      });
      continue;
    }
    const code = row.record?.candidate?.candidateCode || "";
    try {
      await upsertCandidateRecord(row.record, link);
      totals.created += 1;
      // Noted only once the candidate is written, so a failed insert is retried next pass.
      await recordImportedRow(link?.id, row.rowKey || importedRowKey(row.record), code);
      actions.push({ rowNumber: row.rowNumber, action: "CREATED", candidateCode: code });
    } catch (error) {
      totals.failed += 1;
      const reason = error?.message || "Unable to create the candidate.";
      noteProblem(row.rowNumber, reason);
      actions.push({ rowNumber: row.rowNumber, action: "FAILED", reason });
    }
  }

  if (totals.created) await preview.codes.commit();

  // The split counters, for the rows actually written - never for a preview, never for a failure.
  // `CREATED` is now the only written row: a sync no longer gives an owner to a candidate already
  // in the register, so that is the whole of what can spend somebody's share.
  const written = new Set(actions.filter((action) => action.action === "CREATED").map((action) => action.rowNumber));
  const splitCounts = new Map();
  for (const row of preview.rows) {
    const rule = written.has(row.rowNumber) ? row.assignment?.rule : null;
    if (!rule?.id || !rule?.targetEmployeeId) continue;
    const key = `${rule.id}::${rule.targetEmployeeId}`;
    splitCounts.set(key, (splitCounts.get(key) || 0) + 1);
  }
  await recordAssignedCounts(splitCounts);

  const summary = {
    created: totals.created,
    skipped: totals.skippedExisting + totals.skippedDuplicate + totals.skippedInvalid + totals.skippedDeleted,
    skippedExisting: totals.skippedExisting,
    skippedSameContact: totals.skippedSameContact,
    skippedDuplicate: totals.skippedDuplicate,
    skippedInvalid: totals.skippedInvalid,
    skippedDeleted: totals.skippedDeleted,
    failed: totals.failed,
    totalRows: preview.rows.length,
    assignedByRule: preview.summary.assignedByRule || 0,
    unassignedRows: preview.summary.unassignedRows || 0,
    assignmentRules: preview.assignment.ruleCount || 0,
    assignmentMissingColumns: (preview.assignment.missingColumns || []).map((entry) => entry.columnHeader).filter(Boolean),
    rowProblems,
  };
  await recordLinkSync(link?.id, totals.failed ? "PARTIAL" : "OK", summary);
  return { summary, actions };
}

/** The run, with a failure recorded on the link as well - otherwise it would go on reading "OK". */
async function syncInterviewSheetLink(link) {
  try {
    return await runInterviewSheetSync(link);
  } catch (error) {
    await recordLinkSync(link?.id, "FAILED", { error: String(error?.message || error).slice(0, 300) });
    throw error;
  }
}

/**
 * The candidates a deleted link had imported, removed with it - the register's copy only, so the
 * same sheet can be linked again and re-imported. Answers how many went.
 */
async function deleteCandidatesFromSheet({ spreadsheetId, gid = "", targetTab = "" } = {}) {
  const id = String(spreadsheetId || "").trim();
  if (!id) return 0;
  const where = { deletedAt: null, spreadsheetId: id };
  const tabGid = String(gid ?? "").trim();
  const tabName = String(targetTab || "").trim();
  if (tabGid) where.gid = tabGid;
  else if (tabName) where.targetTab = tabName;
  // Removed rather than hidden, the way a candidate deleted from the register is: a hidden row
  // still answers to a phone number, and the sheet would go on recognising people nobody can see.
  const doomed = await prisma.hrmInterviewCandidate.findMany({ where, select: { id: true } });
  if (!doomed.length) return 0;
  const ids = doomed.map((row) => row.id);
  const [, removed] = await prisma.$transaction([
    prisma.hrmInterviewApplicationInvite.deleteMany({ where: { candidateId: { in: ids } } }),
    prisma.hrmInterviewCandidate.deleteMany({ where: { id: { in: ids } } }),
  ]);
  return removed.count;
}

module.exports = {
  // Exported for the test that pins which columns a sheet owns; nothing else reads it.
  SHEET_WRITTEN_FIELDS,
  prepareInterviewSheetImport,
  syncInterviewSheetLink,
  deleteCandidatesFromSheet,
  loadCandidateCodeAllocator,
};
