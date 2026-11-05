const prisma = require("../../../config/db");
const { VERTICAL_SQL, BOARD_KEY } = require("../../sales/crm-leads/leadQueryService");

/**
 * The contact directory: every phone number the application holds, from every module that holds
 * one, folded to one row per person.
 *
 * Its own module rather than a branch of the CRM, because it is not the CRM's: an employee, a
 * vendor and a lead are contacts of the studio in exactly the same sense, and a directory that
 * could only see one module's would be a second lead list with fewer columns.
 *
 * Nothing here is stored. A contact is not a record anybody creates - it is what a phone number's
 * records add up to - so this reads the modules' own tables live. A contacts table of its own
 * would be a copy that goes stale the first time an employee changes their number.
 *
 * ── How a row is built ────────────────────────────────────────────────────────────────────────
 *
 * Each source below produces the same six columns, so they can be UNIONed into one list, and **each
 * record is a row of its own**.
 *
 * It used to be one row per *person*: the union was grouped on the phone key, and a client who
 * enquired for a wedding, enquired again for a shoot and became a project read as one contact
 * carrying three ids in one cell. That is a defensible reading of a directory and it is not the one
 * the studio wanted, for a plain reason - the ids were the useful half and they arrived stuck
 * together. `DBS-EID-DD-ERD-000012, DBS-EID-QQ-HYD-000007` in a single cell cannot be filtered to
 * one of the two, cannot be sorted by either, exports as one string, and gives the row a single
 * name and a single vertical when the two enquiries have their own. Worse, a double click had to
 * pick one of them to open, so the second enquiry was reachable from nowhere on this screen.
 *
 * So a person with three records is three rows, each under its own id, with its own name, its own
 * vertical and its own module - and each opening its own record. What they still have in common is
 * the number, which is what the Contact column shows and what a reader filters by to bring somebody's
 * rows together; `contactKey` is carried on every row so that grouping is still one sort away.
 */

/**
 * Which rows are the same person, in SQL.
 *
 * Mirrors `phoneMatchKey` in the CRM's crmLeadService.js, which is what the duplicate check on a
 * lead already uses: the last ten digits, so "+91 98765 43210" and "9876543210" are one contact,
 * and a number too short to be one is taken whole rather than padded into a false match.
 *
 * It no longer decides what a row *is* - a row is a record - but it is still what says which rows
 * are one person, so it is carried on each of them: it orders the list, so somebody's records sit
 * together, and it is the key the client groups by when it needs to.
 *
 * A record with no usable number keys on its own id, so numberless records stay separate people
 * rather than being read as one. Every source already filters those out, so this is the guard
 * rather than the common case.
 */
const CONTACT_KEY_SQL = `CASE
    WHEN CHAR_LENGTH(REGEXP_REPLACE(r.\`contact\`, '[^0-9]', '')) >= 10 THEN RIGHT(REGEXP_REPLACE(r.\`contact\`, '[^0-9]', ''), 10)
    WHEN CHAR_LENGTH(REGEXP_REPLACE(r.\`contact\`, '[^0-9]', '')) >= 5 THEN REGEXP_REPLACE(r.\`contact\`, '[^0-9]', '')
    ELSE CONCAT('#', r.\`source\`, ':', r.\`id\`)
  END`;

/** A number worth listing: the column is set, and to something. */
const hasNumber = (sql) => `TRIM(COALESCE(${sql}, '')) <> ''`;

/**
 * The verticals, spelled the one way.
 *
 * A sales project files the same three verticals as `WED` / `QQ` / `CORP` while the CRM files them
 * as Dum Dum / Qua Qua / Corp - the two halves of one studio naming one thing twice, which
 * `whatsappGroupNameUtils.js` already has to translate between on the client. Translated here as
 * well, so the Verticals column never shows the same vertical under two names.
 */
const PROJECT_VERTICAL_SQL = `CASE UPPER(TRIM(COALESCE(p.\`vertical\`, '')))
    WHEN 'WED' THEN 'Dum Dum'
    WHEN 'QQ' THEN 'Qua Qua'
    WHEN 'CORP' THEN 'Corp'
    ELSE ''
  END`;

/**
 * Where the application keeps a phone number, and who may read it.
 *
 * `module` / `feature` is the permission the module's own API enforces on these rows, and it is
 * checked again here: holding the Contacts screen is not the same as being allowed to read HR's
 * records, so a source the viewer cannot open elsewhere is left out of the UNION entirely rather
 * than filtered out afterwards. Someone with only the CRM sees the CRM's contacts.
 *
 * `label` is what the Module column reads. It is the sidebar's own wording, so a row says where
 * to go and find the record it came from.
 *
 * Every `sql` must select exactly `source, id, name, contact, vertical, recordedAt, linkKind`, in
 * that order - they are UNIONed, so MySQL takes the column names from the first one and matches the
 * rest by position.
 *
 * `linkKind` is what the directory can open. A contact row is a person rather than a record, so a
 * double click on one has to land somewhere real: `'lead'` opens the CRM's own lead popup, and
 * `'project'` opens the project record. `''` is the honest answer for a source with no screen that
 * opens one of its rows on its own, and those rows fall back to the contact's own details.
 */
const SOURCES = [
  {
    key: "employee",
    module: "HRM",
    feature: "Employee Management",
    // Every employee, including those who have left: a former colleague's number is still a
    // number the studio holds, and the directory is where somebody goes to find it.
    sql: `SELECT 'Human Resource Management' AS \`source\`, \`employee_id\` AS \`id\`,
        \`employee_name\` AS \`name\`, \`contact_number\` AS \`contact\`,
        TRIM(COALESCE(\`vertical\`, '')) AS \`vertical\`, \`created_at\` AS \`recordedAt\`,
        '' AS \`linkKind\`
      FROM \`employee\` WHERE ${hasNumber("`contact_number`")}`,
  },
  {
    /*
     * The CRM's leads - and only its leads.
     *
     * ── Why a call is not a contact ──
     *
     * Callyzer delivers every call the studio's handsets make and take, and for a while each one
     * reached this directory: first through this source, because the webhook minted a lead per call,
     * and then through a `crmCall` source of its own reading `sales_crm_call_log` directly. Both are
     * gone, and the studio's reason is the right one - a number that rang the studio once is not a
     * contact of it. A misdial, a wrong number, a courier and a client's second phone all arrive
     * identically, under a Call ID rather than a name, and there were nine thousand of them: the
     * directory was a call log with the useful rows buried in it.
     *
     * A caller becomes a contact by being triaged. Somebody reads the call on the Calls board, adds
     * the caller to a vertical, and that mints a real enquiry - which this source lists, with the
     * name and the vertical a person actually filled in. Until then the call is on the Calls board,
     * where it belongs, and the number is still reachable there and on the lead's Call Logs tab.
     *
     * So untriaged calls are excluded here too, not just in the source that read the log. The old
     * webhook's leads are still in this table - `board_key` puts them on Calls, which is how the CRM
     * itself keeps them off the three vertical boards - and without this clause they would go on
     * arriving as "Unknown" against a bare mobile number.
     */
    key: "crmLead",
    module: "SALES",
    feature: "CRM Leads",
    // The Qua Qua sheets fill `contact_number` and the other two verticals fill `phone`, so this
    // reads whichever is set - the same fallback the lead grid's own Contact column applies.
    sql: `SELECT 'Sales & CRM' AS \`source\`, \`enquiry_id\` AS \`id\`,
        TRIM(COALESCE(\`name\`, '')) AS \`name\`,
        COALESCE(NULLIF(TRIM(\`contact_number\`), ''), \`phone\`) AS \`contact\`,
        ${VERTICAL_SQL} AS \`vertical\`, \`created_at\` AS \`recordedAt\`,
        'lead' AS \`linkKind\`
      FROM \`sales_crm_lead\`
      WHERE \`deleted_at\` IS NULL
        AND COALESCE(\`board_key\`, '') <> '${BOARD_KEY.Calls}'
        AND ${hasNumber("COALESCE(NULLIF(TRIM(`contact_number`), ''), `phone`)")}`,
  },
  {
    key: "salesProject",
    // The project register is read by the people who sold the job and by the people who run it,
    // and the two hold different permissions - so either one is enough to see its clients here,
    // exactly as either one is enough to open the register itself.
    anyOf: [
      { module: "SALES", feature: "Sales Manager" },
      { module: "PROJECT", feature: "Projects" },
    ],
    // A project's client name lives on the reserved WhatsApp group name rather than on the
    // project, which is why `projectClientNames` exists; the same fallback is applied here.
    sql: `SELECT 'Project Management' AS \`source\`, p.\`event_id\` AS \`id\`,
        COALESCE(NULLIF(TRIM(g.\`client_name\`), ''), p.\`whatsapp_group_name\`) AS \`name\`,
        p.\`client_main_number\` AS \`contact\`, ${PROJECT_VERTICAL_SQL} AS \`vertical\`,
        p.\`created_at\` AS \`recordedAt\`,
        'project' AS \`linkKind\`
      FROM \`sales_project\` p
      LEFT JOIN \`sales_whatsapp_group_name\` g ON g.\`id\` = p.\`whatsapp_group_name_id\`
      WHERE p.\`deleted_at\` IS NULL AND ${hasNumber("p.`client_main_number`")}`,
  },
  {
    key: "quotation",
    module: "SALES",
    feature: "Quotation Management",
    // A quotation records no vertical of its own, but it names the enquiry it was raised for, so
    // the lead's vertical is read through that rather than left blank.
    sql: `SELECT 'Sales & CRM' AS \`source\`, q.\`quotation_id\` AS \`id\`,
        TRIM(COALESCE(q.\`client_name\`, '')) AS \`name\`, q.\`client_main_number\` AS \`contact\`,
        COALESCE(l.\`vertical\`, '') AS \`vertical\`, q.\`created_at\` AS \`recordedAt\`,
        '' AS \`linkKind\`
      FROM \`sales_quotation\` q
      LEFT JOIN (SELECT \`enquiry_id\`, ${VERTICAL_SQL} AS \`vertical\` FROM \`sales_crm_lead\` WHERE \`deleted_at\` IS NULL) l
        ON l.\`enquiry_id\` = q.\`enquiry_id\`
      WHERE q.\`deleted_at\` IS NULL AND ${hasNumber("q.`client_main_number`")}`,
  },
  {
    key: "imageSelection",
    module: "IMAGE_SELECTION",
    feature: "Project Management",
    /*
     * Only the projects that hold a client of their own.
     *
     * A project created from a sale reads its client from the linked SalesProject and stores
     * nothing, so those rows arrive through Project Management above and would be a duplicate
     * here. A manual or duplicated project is the one that has nowhere else to keep the client,
     * and it is named rather than coded - the project name is how that module identifies it, so
     * the project name is what the ID column can honestly show.
     */
    sql: `SELECT 'Visual Curation' AS \`source\`, \`project_name\` AS \`id\`,
        COALESCE(NULLIF(TRIM(\`client_name\`), ''), \`project_name\`) AS \`name\`,
        \`client_main_number\` AS \`contact\`, '' AS \`vertical\`, \`created_at\` AS \`recordedAt\`,
        '' AS \`linkKind\`
      FROM \`image_selection_project\`
      WHERE \`deleted_at\` IS NULL AND ${hasNumber("`client_main_number`")}`,
  },
  {
    key: "paymentRequest",
    module: "ACCOUNTS",
    feature: "Payment Request Approval",
    // Vendor payments only. The other kinds of request are raised by an employee about
    // themselves, and that person is already in the directory through HR.
    sql: `SELECT 'Accounts' AS \`source\`, \`request_code\` AS \`id\`,
        TRIM(COALESCE(\`vendor_name\`, '')) AS \`name\`, \`vendor_phone\` AS \`contact\`,
        '' AS \`vertical\`, \`created_at\` AS \`recordedAt\`,
        '' AS \`linkKind\`
      FROM \`payment_request\`
      WHERE \`deleted_at\` IS NULL AND ${hasNumber("`vendor_phone`")}`,
  },
  {
    key: "vendor",
    module: "ASSET",
    feature: "Vendor Management",
    // The person answering, where the record names one - a mobile number belongs to somebody
    // rather than to a company - falling back to the business's own name.
    sql: `SELECT 'Resource Management' AS \`source\`, \`vendor_id\` AS \`id\`,
        COALESCE(NULLIF(TRIM(\`contact_person\`), ''), \`vendor_name\`) AS \`name\`,
        COALESCE(NULLIF(TRIM(\`mobile_number\`), ''), NULLIF(TRIM(\`whatsapp_number\`), ''), \`alternate_number\`) AS \`contact\`,
        '' AS \`vertical\`, \`created_at\` AS \`recordedAt\`,
        '' AS \`linkKind\`
      FROM \`vendor\`
      WHERE \`is_deleted\` = 0 AND ${hasNumber("COALESCE(NULLIF(TRIM(`mobile_number`), ''), NULLIF(TRIM(`whatsapp_number`), ''), `alternate_number`)")}`,
  },
  {
    key: "clientStorage",
    module: "ASSET",
    feature: "Client Storage",
    // Whoever a disc was sold to: an outside contact the studio has no other record of. The sent
    // and received names on the same row are the studio's own staff, who are already here.
    sql: `SELECT 'Resource Management' AS \`source\`, \`storage_id\` AS \`id\`,
        TRIM(COALESCE(\`sold_to_name\`, '')) AS \`name\`, \`sold_to_contact\` AS \`contact\`,
        '' AS \`vertical\`, \`created_at\` AS \`recordedAt\`,
        '' AS \`linkKind\`
      FROM \`client_storage\`
      WHERE \`deleted_at\` IS NULL AND ${hasNumber("`sold_to_contact`")}`,
  },
];

/**
 * The sources this viewer may read, as one UNION.
 *
 * `can` is an async predicate over `{ module, feature }` - the caller's permission check, passed in
 * rather than imported so this stays a query builder and the controller stays the thing that knows
 * about a request.
 */
async function permittedSources(can) {
  const permitted = [];
  for (const source of SOURCES) {
    const required = source.anyOf || [{ module: source.module, feature: source.feature }];
    // `anyOf` is a disjunction: the project register answers to either of two permissions.
    const checks = await Promise.all(required.map((permission) => can(permission)));
    if (checks.some(Boolean)) permitted.push(source);
  }
  return permitted;
}

// How many contacts one request will build. The screen loads the directory in full and filters it
// in the browser, so this is a ceiling rather than a page size; a truncated answer says so, and
// the footer says it on screen rather than passing a partial list off as the whole of one.
const DEFAULT_LIMIT = 10000;
const MAX_LIMIT = 20000;

/**
 * The directory, one row per record.
 *
 * Returns `{ rows, total, sources }` - `sources` being the keys actually read, so a caller can
 * tell "this studio has no vendors" from "you may not see vendors".
 */
async function listContacts({ can, limit = DEFAULT_LIMIT } = {}) {
  const sources = await permittedSources(can);
  if (sources.length === 0) return { rows: [], total: 0, sources: [] };

  const records = sources.map((source) => source.sql).join("\n    UNION ALL\n    ");

  /*
   * Each record, with the key that says whose it is.
   *
   * Nothing is aggregated any more: the row is the record, so its id, name, vertical and module are
   * its own. `contactKey` rides along as the answer to "which of these are one person" - it orders
   * the list below, and the client groups by it where it needs to.
   */
  const listed = `SELECT r.*, ${CONTACT_KEY_SQL} AS \`contactKey\` FROM (${records}) r`;

  const size = Math.min(Math.max(Number(limit) || DEFAULT_LIMIT, 1), MAX_LIMIT);
  /*
   * Most recently recorded first, and one person's records kept together.
   *
   * The first key is the person's latest record, not the record's own date, so the two enquiries of
   * somebody who rang last week sit side by side near the top rather than a fortnight apart on
   * either side of everybody else's. Within a person it is newest first, which is the order their
   * records were made in.
   *
   * A directory read top-down still opens on whoever the studio heard from most recently, which is
   * what the single `recordedAt` sort gave before - this only adds that a person is not split up.
   */
  const ordered = `SELECT c.*,
      MAX(c.\`recordedAt\`) OVER (PARTITION BY c.\`contactKey\`) AS \`personRecordedAt\`
    FROM (${listed}) c`;

  const rows = await prisma.$queryRawUnsafe(
    `SELECT * FROM (${ordered}) o
      ORDER BY \`personRecordedAt\` DESC, \`contactKey\` ASC, \`recordedAt\` DESC, \`id\` ASC
      LIMIT ${size}`,
  );
  const [{ total }] = await prisma.$queryRawUnsafe(`SELECT COUNT(*) AS total FROM (${listed}) c`);

  return {
    rows: rows.map((row) => ({
      /*
       * The row's own key, and it is not the id.
       *
       * An id is unique within the module that issued it and this list crosses eight of them: an
       * Image Selection project is listed under its *name*, a call that has not been given a code
       * yet falls back to its numeric row id, and either could collide with something from another
       * module. A duplicate key silently loses a row in the table, which on a directory is a
       * contact nobody can find and nothing to say so. Source plus id cannot collide, because a
       * source's own ids do not.
       */
      key: `${row.source}:${row.id}`,
      id: String(row.id || ""),
      name: String(row.name || ""),
      contact: String(row.contact || ""),
      // This record's own vertical, singular now - it is one record, so there is one answer or
      // none. The column is still headed Verticals, because that is what a reader scanning the
      // column is reading, and one row's answer to it is one vertical.
      verticals: String(row.vertical || ""),
      module: String(row.source || ""),
      // Which of this person's rows are the same person, for grouping on the client.
      contactKey: String(row.contactKey || ""),
      /*
       * What a double click on this row opens - this record, rather than whichever of the person's
       * records happened to win an aggregate. That is most of the point of the split: a client with
       * two enquiries had one of them reachable from this screen and the other from nowhere.
       */
      leadId: row.linkKind === "lead" ? String(row.id || "") : "",
      projectId: row.linkKind === "project" ? String(row.id || "") : "",
    })),
    total: Number(total || 0),
    sources: sources.map((source) => source.key),
  };
}

module.exports = { listContacts, SOURCES, CONTACT_KEY_SQL, DEFAULT_LIMIT, MAX_LIMIT };
