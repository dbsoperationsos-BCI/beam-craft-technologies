const prisma = require("../../../config/db");
const { LEAD_SOURCES } = require("./leadSources");
const { CRM_LEAD_SQL_COLUMNS, flattenLeadColumns, ensureCrmLeadColumns, phoneMatchKey } = require("./crmLeadService");
const { lookups: referenceLookups } = require("../../../services/referenceMatchers");
const { resolveColumnMapping, mapRowToCrmCandidate, createLeadIdAllocator } = require("./googleSheetsService");
const { discardRanges, isCancelled, recordRange, touchBatch } = require("./importBatchRegistry");
const { branchCode, formatIdentifier, sequenceKey } = require("../../../services/identifiers");
const { verticalFromValue } = require("./callRouting");

/**
 * The numbers each vertical already holds, as one `<digits>::<vertical>` set.
 *
 * One query per chunk rather than one per row: a file of 14,000 rows asking `findVerticalDuplicate`
 * each time is 14,000 round trips, and this import exists because the row-at-a-time version was too
 * slow. Both number columns are read, the way `listLeadsSharingPhone` reads them, so a lead whose
 * number lives in Contact Number is found as surely as one in Phone.
 */
async function loadVerticalPhoneKeys() {
  const rows = await prisma.$queryRawUnsafe(
    "SELECT `phone`, `contact_number` AS `contactNumber`, `vertical` FROM `sales_crm_lead` WHERE `deleted_at` IS NULL",
  );
  const keys = new Set();
  for (const row of Array.isArray(rows) ? rows : []) {
    const vertical = verticalFromValue(row?.vertical || "");
    if (!vertical) continue;
    for (const value of [row?.phone, row?.contactNumber]) {
      const digits = phoneMatchKey(value);
      if (digits) keys.add(`${digits}::${vertical}`);
    }
  }
  return keys;
}

// One multi-row statement per slice. Kept well under MySQL's max_allowed_packet while
// still turning a 500-row request into a couple of round-trips instead of 3,000.
const SQL_BATCH_SIZE = 1000;
/*
 * ── Claiming enquiry ids ──────────────────────────────────────────────────────────────────────
 *
 * An enquiry id is `DBS-EID-QQ-ERD-000001`: counted per vertical and per branch, from the shared
 * counter in `services/identifiers.js`. Every producer - this importer, the Add Lead form, the
 * sheet sync, the Callyzer webhook - has to draw from that one counter, or two of them hand out the
 * same id.
 *
 * This file claims them in *blocks* rather than one at a time, which is the only thing it does
 * differently. A 10,000-row CSV would otherwise be 10,000 round trips to a counter, and several
 * chunks of the same import are deliberately in flight at once; one atomic increment per chunk is
 * what lets that be true and still never hand out an id twice.
 */
function leadIdPrefix(context) {
  // Everything before the number, which is what a reserved range is addressed by - the registry
  // deletes a cancelled import's rows by prefix and number, and Erode's 1-50 is not Coimbatore's.
  const first = formatIdentifier("CRM_LEAD", context, 1);
  return first.slice(0, first.lastIndexOf("-") + 1);
}

/**
 * Claims `count` consecutive ids for one vertical and branch, in one atomic step.
 *
 * The increment and the read are the same statement, so two chunks racing take two blocks rather
 * than the same one.
 */
async function reserveLeadIdRange(count, context) {
  const key = sequenceKey("CRM_LEAD", context);
  const row = await prisma.appSequence.upsert({
    where: { key },
    create: { key, currentValue: count },
    update: { currentValue: { increment: count } },
  });
  return { prefix: leadIdPrefix(context), from: row.currentValue - count + 1, to: row.currentValue };
}

/**
 * One fresh enquiry id for a lead of this vertical and branch.
 *
 * What the Add Lead form and the Callyzer webhook take. The webhook creates leads one call at a
 * time and a call arrives naming no branch at all, which is why `branchCode` answers the head
 * branch rather than refusing - see `services/identifiers.js`.
 */
async function nextLeadId(context = {}) {
  const range = await reserveLeadIdRange(1, context);
  return formatIdentifier("CRM_LEAD", context, range.from);
}

function cancelledResult(received, skipped = 0) {
  return { received, imported: 0, skipped, overwritten: 0, verticals: {}, cancelled: true };
}

function normalizeHeaderKey(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/**
 * The column headings each system table's CSV template carries.
 *
 * These mirror `branchTableColumns` in frontend/src/components/sales/CRMPage.js, which is
 * what the Download CSV Template button writes. Keep the two in step: a column added there
 * has to be added here, or files built from the new template stop importing. That is not a
 * theoretical risk - "Verticals" was required here and written by no template, so every file
 * the button produced was refused for a column that could not be supplied. The test in
 * test/crm-csv-import-headers.test.js reads the frontend list and fails on any difference.
 *
 * The vertical itself is deliberately not among them. It is the table chosen in the Import
 * dialog, which is a choice the file cannot contradict - a Qua Qua file is already refused
 * when Dum Dum is selected - so asking a CSV to repeat it only gave it a way to be wrong. A
 * file that still carries a "Verticals" column is imported all the same: extra columns are
 * ignored, and a recognised value in one is still what the row's vertical is read from.
 */
const VERTICAL_TEMPLATE_HEADERS = {
  "Dum Dum": ["Enquiry ID", "Enquiry Date", "Enquiry Name", "Relationship", "Added Time", "Phone Number", "Status", "Last Followup Date", "Next followup Date", "CRM", "Nearest Branch", "Referred From", "Offer Type", "Campaign Name", "Adset Name", "Ad Name", "Preferred Budget", "City", "State", "Type of Event Planned", "When is the Event Planned", "Groom Name", "Groom Contact", "Groom Location", "Bride Name", "Bride Contact", "Bride Location", "Referenced Person Name", "Referenced Person Contact", "Remarks", "Source"],
  "Qua Qua": ["Enquiry ID", "Enquiry Date", "Enquiry Name", "Added Timestamp", "Phone Number", "Status", "CRM", "Nearest Branch", "Offer Type", "Campaign Name", "Adset Name", "Ad Name", "Referred From", "Preferred Budget", "City", "State", "Type of Event Planned", "When is the Event Planned", "Contact Repeated", "Shoot Type", "Location", "IH/OH", "Last Followup Date", "Next followup Date", "Last Converted Date", "Shoot ID", "Baby (or) Mother Name", "Date of Birth (or) EDOD", "Remarks", "Source"],
  Corp: ["Enquiry ID", "Enquiry Date", "Enquiry Name", "Added Timestamp", "Phone Number", "Status", "CRM", "Nearest Branch", "Referred From", "Offer Type", "Campaign Name", "Adset Name", "Ad Name", "Preferred Budget", "City", "State", "Company Name (or) Client organisation", "Primary decision-maker - Contact", "Designation", "Contact Number", "Alternate Mobile Number", "Official Email ID", "Company Website", "Company Type", "Company Size", "Branches", "Project Type", "Location", "Shoot City", "Expected Budget", "Competitions", "Remarks", "Source"],
};
const VERTICAL_NAMES = Object.keys(VERTICAL_TEMPLATE_HEADERS);

// Columns belonging to exactly one table, derived from the templates so there is no second
// list to maintain. Used only to name the table a rejected file actually came from.
const VERTICAL_SIGNATURES = Object.fromEntries(
  VERTICAL_NAMES.map((name) => {
    const elsewhere = new Set(
      VERTICAL_NAMES.filter((other) => other !== name).flatMap((other) =>
        VERTICAL_TEMPLATE_HEADERS[other].map(normalizeHeaderKey),
      ),
    );
    return [name, VERTICAL_TEMPLATE_HEADERS[name].map(normalizeHeaderKey).filter((key) => !elsewhere.has(key))];
  }),
);

function refuse(message) {
  const error = new Error(message);
  error.status = 400;
  throw error;
}

/*
 * The columns a lead cannot be made without. Everything else a table lists may be absent from the
 * file and is imported empty - a column nobody filled in and a column nobody included are the same
 * lead either way, and refusing the file over the second helps nobody.
 *
 * All three tables share both of these, so this is not a per-table list.
 */
const REQUIRED_HEADERS = ["Enquiry Name", "Phone Number"];

/**
 * A CSV may only be imported into the table chosen in the dialog.
 *
 * It used to have to carry that table's **full** set of columns, which was too strong a rule for
 * what it was protecting against. Adding a column to a table - Dum Dum gained Last Followup Date and
 * Next followup Date - invalidated every template anybody had already downloaded, and a file built
 * by hand with the fifteen columns a studio actually keeps was refused outright. A column that is
 * missing from the file now imports empty, exactly as a column left blank in it does.
 *
 * What the rule is really for is the **wrong table**: the three share sixteen columns, so a Qua Qua
 * export picked as Dum Dum once "succeeded" - sixteen columns of real data landing in the wrong
 * vertical under Dum Dum's headings, and the ten that make a Dum Dum lead a Dum Dum lead blank. That
 * is still refused, and named, because the fix is to change the dropdown rather than the file.
 *
 * So two things are refused and nothing else:
 *
 *   * a file with no **Enquiry Name** or no **Phone Number** - there is no lead in a row without
 *     them, and a file missing either is not this table's file however it was built;
 *   * a file carrying another table's own columns and none of this table's - which is that table's
 *     export, whatever the dropdown says.
 *
 * Extra columns are ignored, and headings are matched with case and punctuation removed, so a
 * genuine template still imports however it was re-saved.
 *
 * The browser runs the same rule when the file is attached, to disable Import and say why. This is
 * the copy that decides, and it trusts nothing from the client - an unknown or missing table name is
 * refused rather than waved through.
 */
function assertHeadersMatchVertical(headers, vertical) {
  const expected = VERTICAL_TEMPLATE_HEADERS[vertical];
  if (!expected) {
    refuse(`"${vertical || "No table"}" is not a CRM system table. Choose one of ${VERTICAL_NAMES.join(", ")} and import again.`);
  }

  const present = new Set((headers || []).map(normalizeHeaderKey).filter(Boolean));
  if (!present.size) refuse("This file has no column headings to read.");

  /*
   * "and none of this table's" is the half that keeps this from firing on a good file. A studio
   * that keeps one spreadsheet for everything, or an export widened by hand, can carry another
   * table's columns alongside this table's own - and that file does belong here. Only a file with
   * another table's columns and none of this one's is positively somebody else's export.
   */
  const ownSignature = VERTICAL_SIGNATURES[vertical].some((key) => present.has(key));
  const looksLike = ownSignature
    ? null
    : VERTICAL_NAMES.find((name) => name !== vertical && VERTICAL_SIGNATURES[name].some((key) => present.has(key)));
  if (looksLike) {
    refuse(`This file looks like a ${looksLike} export but ${vertical} is selected. Pick ${looksLike} as the system table, or attach a ${vertical} file.`);
  }

  const missingRequired = REQUIRED_HEADERS.filter((header) => !present.has(normalizeHeaderKey(header)));
  if (missingRequired.length) {
    refuse(`This file has no ${missingRequired.join(" and no ")} column, so there is no lead in a row to import. Download the ${vertical} template and use its headings.`);
  }
}

// Prisma's native bulk insert. Every id is freshly allocated above the current MAX, so
// there is nothing to update on conflict; createMany emits a single multi-row INSERT and
// avoids the parameter-binding cost of hand-built raw SQL (~10x faster here).
// skipDuplicates is a safety net only - the returned count is compared against the batch
// size so a collision can never silently swallow a lead.
async function bulkInsert(records) {
  if (!records.length) return { inserted: 0, collided: 0 };
  const refs = await referenceLookups();
  const data = records.map((record) => {
    // The flattened record is keyed the way raw SQL names the columns. Prisma calls the vertical's
    // text column `verticalName`, so that one key is moved over.
    // The references beside the text are resolved the way the backfill resolved them.
    const { vertical, ...columns } = flattenLeadColumns(record);
    return {
      enquiryId: record.lead.id, ...columns, verticalName: vertical, deletedAt: null,
      /*
       * The branch the file named, written the way the studio writes it - after the spread, so it
       * replaces the column rather than being replaced by it.
       *
       * A CSV's Nearest Branch column is typed by whoever exported it, usually as the place without
       * the state the register ends the name with: "Erode" for "Erode TN", "Visakhapatnam" for
       * "Visakhapatnam AP". Storing that verbatim left the lead's Assigned Branch
       * matching nothing in the picker the popup and Add Lead are built from, so a row that was
       * filed under the right `branch_id` looked unassigned on the screen somebody opens to check
       * it. Both halves now come from the same match against the branch table: the id and the name
       * cannot disagree, and neither is a list written down in this file.
       */
      assignedBranch: refs.branchName(columns.assignedBranch),
      branchId: refs.branchId(columns.assignedBranch), verticalId: refs.verticalId(vertical), ownerEmployeeId: refs.employeeId(columns.crm),
    };
  });
  const result = await prisma.salesCrmLead.createMany({ data, skipDuplicates: true });
  const inserted = Number(result?.count || 0);
  return { inserted, collided: Math.max(0, records.length - inserted) };
}

/**
 * Maps raw CSV rows with exactly the same column and vertical resolution the Google
 * Sheet importer uses, so a file lands in the vertical its columns describe and every
 * mapped field is kept - not just the handful the old client-side parser knew about.
 */
async function importCsvRows({ headers = [], rows = [], startRow = 2, systemTableId = "", vertical = "", batchId = "", fileName = "" }) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return { received: 0, imported: 0, skipped: 0, verticals: {} };
  }

  // Refuse the file outright if its columns belong to a different table. Checked before the
  // batch is registered so a rejected import leaves no state behind.
  assertHeadersMatchVertical(headers, vertical);

  // A chunk that arrives after the user pressed Cancel must not add anything back.
  touchBatch(batchId);
  if (isCancelled(batchId)) return cancelledResult(rows.length);

  await ensureCrmLeadColumns();
  const mapping = { ...resolveColumnMapping(headers, vertical), headers };
  const fallbackLink = { systemTableId, vertical, spreadsheetId: "", targetedTab: "", sheetUrl: "" };

  let prepared = [];
  const verticals = {};
  let skipped = 0;

  for (let index = 0; index < rows.length; index += 1) {
    const row = Array.isArray(rows[index]) ? rows[index] : [];
    if (!row.some((cell) => String(cell ?? "").trim() !== "")) {
      skipped += 1;
      continue;
    }

    const rowNumber = startRow + index;
    const { record } = mapRowToCrmCandidate(row, mapping, fallbackLink, rowNumber, createLeadIdAllocator(), new Map(), new Map());

    // Every imported row becomes its own lead. Reusing an id from the file would make
    // two rows collapse into one - or overwrite an unrelated existing lead - so ids are
    // always allocated here and the file's own id is kept as sourceEnquiryId instead.
    const idColumn = mapping?.fields?.id?.columnIndex;
    const suppliedId = idColumn === undefined ? "" : String(row[idColumn] ?? "").trim();

    /*
     * The table picked in the Import dialog is the vertical, for every row in the file.
     *
     * It used to be the last word rather than the first: a row's own vertical cell won, then the
     * shape of the file's columns, and only then the choice made in the dialog. One Qua Qua
     * import therefore scattered rows into Dum Dum wherever a cell happened to read "WED" or
     * "Wedding" - a Qua Qua lead sitting in the Dum Dum table, under Dum Dum's columns, which
     * do not describe it.
     *
     * Nothing is lost by ignoring the file here. Its columns are checked against the chosen
     * table before a single row is read, so a file that belongs to another vertical is refused
     * outright and named; what is left cannot be anything but this one.
     */
    record.lead.vertical = vertical;
    record.details.vertical = vertical;
    verticals[vertical] = (verticals[vertical] || 0) + 1;

    record.details = {
      ...record.details,
      groupType: "csv",
      groupName: fileName || "Imported CSV leads",
      groupId: batchId || record.details.groupId,
      importedFrom: fileName || "csv",
      csvImportKey: `${batchId || "csv"}:${rowNumber}`,
      sourceEnquiryId: suppliedId || `${batchId || "csv"}:${rowNumber}`,
      spreadsheetId: "",
      gid: "",
      targetTab: "",
      targetedTab: "",
      sourceRowNumber: rowNumber,
    };
    // How it arrived, which is a CSV import - never the file's own Source cell (Instagram, a
    // campaign name), the same rule the sheet sync follows. See `leadSources.js`.
    record.lead.source = LEAD_SOURCES.CSV;
    prepared.push(record);
  }

  /*
   * One number, one enquiry within a vertical - the rule the Add Lead form enforces, applied here
   * too. This path never asked, so importing a file was the simplest way to put a second lead on a
   * number the CRM already held, including one a linked sheet had just brought in.
   *
   * Skipped rather than refusing the file. A CSV is hundreds of rows somebody exported from
   * somewhere else and a handful of them already being here is ordinary; throwing the whole import
   * away over that would mean editing the file by hand to import anything at all. Counted on their
   * own so the result says *why* - "blank rows skipped" and "already on this number" are two
   * different pieces of news, and one of them means somebody should go and look.
   *
   * Rows of the same file are checked against each other as well, since neither is in the database
   * yet and a file that repeats a number would otherwise write it twice.
   */
  const heldNumbers = await loadVerticalPhoneKeys();
  const kept = [];
  let duplicates = 0;
  for (const record of prepared) {
    const digits = phoneMatchKey(record?.lead?.phone);
    const verticalName = verticalFromValue(record?.lead?.vertical || "");
    if (!digits || !verticalName) { kept.push(record); continue; }
    const key = `${digits}::${verticalName}`;
    if (heldNumbers.has(key)) { duplicates += 1; continue; }
    heldNumbers.add(key);
    kept.push(record);
  }
  prepared = kept;

  if (!prepared.length) return { received: rows.length, imported: 0, skipped, duplicates, overwritten: 0, verticals };

  /*
   * Ids are claimed a block at a time now that the row count is known, rather than one round trip
   * per row - but a block belongs to one vertical and one branch, and this file holds rows for
   * several verticals at once.
   *
   * The vertical is the import's own: it is the system table chosen in the dialog, which the file's
   * columns were already checked against, so every row in this chunk shares it. The branch is the
   * row's own Nearest Branch, which is why the rows are grouped by it and each group takes its own
   * block. A row that names no branch is grouped under the head branch, the same answer
   * `branchCode` gives everywhere else.
   */
  const byBranch = new Map();
  for (const record of prepared) {
    const key = branchCode(record.lead.assignedBranch);
    if (!byBranch.has(key)) byBranch.set(key, []);
    byBranch.get(key).push(record);
  }

  const reserved = [];
  for (const [code, group] of byBranch) {
    const context = { vertical, branch: code };
    const range = await reserveLeadIdRange(group.length, context);
    group.forEach((record, offset) => {
      record.lead.id = formatIdentifier("CRM_LEAD", context, range.from + offset);
    });
    // Recorded before the insert so a cancel that lands mid-insert still knows to sweep it.
    recordRange(batchId, range.prefix, range.from, range.to);
    reserved.push(range);
  }

  if (isCancelled(batchId)) {
    await discardRanges(reserved);
    return cancelledResult(rows.length, skipped);
  }

  let imported = 0;
  let overwritten = 0;
  for (let offset = 0; offset < prepared.length; offset += SQL_BATCH_SIZE) {
    const slice = prepared.slice(offset, offset + SQL_BATCH_SIZE);
    const { inserted, collided } = await bulkInsert(slice);
    imported += inserted;
    overwritten += collided;
  }

  // The cancel may have run its sweep while this insert was in flight, in which case its
  // delete missed these rows and this chunk has to take them back out itself.
  if (isCancelled(batchId)) {
    await discardRanges(reserved);
    return cancelledResult(rows.length, skipped);
  }

  return { received: rows.length, imported, skipped, duplicates, overwritten, verticals };
}

module.exports = { importCsvRows, nextLeadId, VERTICAL_TEMPLATE_HEADERS, assertHeadersMatchVertical };
