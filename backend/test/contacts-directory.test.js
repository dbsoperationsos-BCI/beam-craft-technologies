const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { SOURCES, CONTACT_KEY_SQL } = require("../src/modules/contacts/directory/service");
const { phoneMatchKey } = require("../src/modules/sales/crm-leads/crmLeadService");
const { BOARD_SQL, BOARD_SQL_SOURCE, BOARD_KEY } = require("../src/modules/sales/crm-leads/leadQueryService");

/*
 * The Contacts directory reads a phone number out of eight tables belonging to six modules, folds
 * them into one list, and must never show somebody a module they are refused elsewhere.
 *
 * Four things can go wrong there, and none of them announce themselves:
 *
 *   * a source added without a permission, which turns the directory into a way around the guard
 *     on the module the number is kept in;
 *   * a source whose SELECT does not line up with the others, which UNIONs a name into the number
 *     column rather than failing;
 *   * a grouping rule that drifts from `phoneMatchKey`, which would merge people the lead form
 *     calls distinct - or split a person it calls one;
 *   * a source that lets Callyzer's calls back in, which buries the directory under every number
 *     that has ever rung the studio.
 *
 * These read the source rather than a database, the way `raw-sql-table-names.test.js` does, so
 * they run anywhere with no MySQL.
 */

const SERVICE = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "contacts", "directory", "service.js"), "utf8");

/* --------------------------------------------------------- nobody sees what they may not read */

test("every source names the permission its own module enforces", () => {
  assert.ok(SOURCES.length >= 6, "the directory is meant to read across the application, not one module");
  for (const source of SOURCES) {
    const required = source.anyOf || [{ module: source.module, feature: source.feature }];
    assert.ok(required.length > 0, `source "${source.key}" declares no permission, so its rows would be read for anybody`);
    for (const permission of required) {
      assert.equal(typeof permission.module, "string");
      assert.ok(permission.module.length > 0, `source "${source.key}" has an empty module`);
      assert.equal(typeof permission.feature, "string");
      assert.ok(permission.feature.length > 0, `source "${source.key}" has an empty feature`);
    }
  }
});

test("the permissions are ones the catalogue can actually grant", () => {
  // A pair the seed does not define cannot be given to any role, so the source would be visible to
  // super admins and to nobody else - which reads as the directory being half broken.
  // Read rather than scraped. This matched `module:` and `feature:` on consecutive lines in the
  // seed, which stopped finding anything the moment the catalogue moved into a module of its own -
  // and a catalogue that reads as empty makes every assertion below vacuously true.
  const { PERMISSIONS } = require("../prisma/seeds/permission-catalogue");
  const catalogue = new Set(PERMISSIONS.map((permission) => `${permission.module}:${permission.feature}`));
  assert.ok(catalogue.size > 5, "the permission catalogue could not be read");

  for (const source of SOURCES) {
    const required = source.anyOf || [{ module: source.module, feature: source.feature }];
    for (const permission of required) {
      assert.ok(
        catalogue.has(`${permission.module}:${permission.feature}`),
        `source "${source.key}" answers for ${permission.module}:${permission.feature}, which is not in iam-roles-permissions.js`,
      );
    }
  }
});

test("the sources cover the modules the directory claims to read", () => {
  const modules = new Set(SOURCES.flatMap((source) => (source.anyOf || [{ module: source.module }]).map((permission) => permission.module)));
  for (const expected of ["HRM", "SALES", "PROJECT", "IMAGE_SELECTION", "ACCOUNTS", "ASSET"]) {
    assert.ok(modules.has(expected), `no source reads ${expected}, so that module's contacts are missing from the directory`);
  }
});

/* ------------------------------------------------------------- the union lines up column-wise */

test("every source selects the same seven columns in the same order", () => {
  /*
   * MySQL takes a UNION's column names from its first branch and matches the rest by position, so
   * a source that selects five columns fails loudly but one that selects six in the wrong order
   * does not - it quietly files a name as a number. The order is the contract.
   */
  const expected = ["source", "id", "name", "contact", "vertical", "recordedAt", "linkKind"];
  for (const source of SOURCES) {
    const aliases = [...source.sql.matchAll(/AS\s+`(\w+)`/g)].map((match) => match[1]);
    // A source may alias again inside a sub-select of its own further down (the quotation's
    // vertical lookup sits in its FROM clause), so the contract is the seven the outer SELECT opens
    // with.
    assert.deepEqual(aliases.slice(0, 7), expected, `source "${source.key}" does not select the seven union columns in order`);
  }
});

test("every source refuses rows with no number in them", () => {
  // A record with no phone number is not a contact. Without this each source would contribute
  // blank-numbered rows that group together on the fallback key and clutter the directory.
  for (const source of SOURCES) {
    assert.match(source.sql, /TRIM\(COALESCE\(.*\)\) <> ''/s, `source "${source.key}" would list records that have no phone number`);
  }
});

test("soft-deleted records stay out of the directory", () => {
  // Every source table that has a delete flag has to honour it, or a deleted vendor or a removed
  // lead reappears here after being removed everywhere else.
  const softDeleted = { crmLead: /deleted_at` IS NULL/, salesProject: /deleted_at` IS NULL/, quotation: /deleted_at` IS NULL/, imageSelection: /deleted_at` IS NULL/, paymentRequest: /deleted_at` IS NULL/, clientStorage: /deleted_at` IS NULL/, vendor: /is_deleted` = 0/ };
  for (const [key, pattern] of Object.entries(softDeleted)) {
    const source = SOURCES.find((entry) => entry.key === key);
    assert.ok(source, `source "${key}" is gone; update this test with it`);
    assert.match(source.sql, pattern, `source "${key}" does not exclude deleted records`);
  }
});

/* ------------------------------------------------------ who counts as the same person */

/**
 * CONTACT_KEY_SQL, in JavaScript.
 *
 * Ten digits or more keys on the last ten, so "+91 98765 43210" and "9876543210" are one contact.
 * Five to nine keys on what there is. Fewer than five is not a number anybody can be reached on,
 * so the record keys on itself and stays a contact of one rather than joining every other
 * numberless record into a single nonsense row.
 */
function contactKey({ contact, source = "Sales & CRM", id = "X" }) {
  const digits = String(contact || "").replace(/[^0-9]/g, "");
  if (digits.length >= 10) return digits.slice(-10);
  if (digits.length >= 5) return digits;
  return `#${source}:${id}`;
}

test("two spellings of one number are one contact, the way the duplicate check already says", () => {
  const numbers = ["+91 98765 43210", "98765 43210", "9876543210", "091-9876543210"];
  const keys = new Set(numbers.map((contact) => contactKey({ contact })));
  assert.equal(keys.size, 1, "the same number written four ways has to fold to one key");
  // And that key is the lead form's own, so Contacts cannot call two records one person while the
  // lead being edited says they are two.
  for (const contact of numbers) assert.equal(contactKey({ contact }), phoneMatchKey(contact));
});

test("one person in two modules is one contact", () => {
  // The whole point of the directory: an employee who also enquired is one row carrying both ids.
  assert.equal(
    contactKey({ contact: "+91 9488182003", source: "Human Resource Management", id: "DBS002" }),
    contactKey({ contact: "9488182003", source: "Sales & CRM", id: "DBS-DD-EID-4864" }),
  );
});

test("different people stay different contacts", () => {
  assert.notEqual(contactKey({ contact: "9876543210" }), contactKey({ contact: "9845011223" }));
});

test("records with no reachable number are one contact each, not one between them", () => {
  const first = contactKey({ contact: "", source: "Accounts", id: "VND-000001" });
  const second = contactKey({ contact: "-", source: "Accounts", id: "VND-000002" });
  assert.notEqual(first, second);
  // `phoneMatchKey` answers "" for these, which is the answer that would have merged them; keying
  // on the record is what stops the directory inventing a person with four hundred ids.
  assert.equal(phoneMatchKey(""), "");
  assert.equal(first, "#Accounts:VND-000001");
});

test("the SQL still folds on the last ten digits, which is what the mirror above assumes", () => {
  const sql = CONTACT_KEY_SQL.replace(/\\`/g, "`");
  assert.match(sql, />= 10 THEN RIGHT\(REGEXP_REPLACE\(r\.`contact`, '\[\^0-9\]', ''\), 10\)/);
  assert.match(sql, />= 5 THEN REGEXP_REPLACE/);
  assert.match(sql, /ELSE CONCAT\('#', r\.`source`, ':', r\.`id`\)/);
});

/* --------------------------------------------------------------- the verticals read one way */

/* ------------------------------------------------------- a call is not a contact of the studio */

test("no source reads the Callyzer call log", () => {
  /*
   * Every call the studio's handsets make and take used to arrive here, under a Call ID and usually
   * with no name - a misdial, a courier and a wrong number are indistinguishable from a client, and
   * there were nine thousand of them ahead of the rows anybody wanted. A number that rang once is
   * not a contact of the studio; a caller becomes one by being triaged on the Calls board, which
   * mints a real enquiry, which `crmLead` lists.
   *
   * Checked over every source rather than by the absence of one key, because the table is what must
   * not be read - a source added later under any name would reintroduce exactly this.
   */
  for (const source of SOURCES) {
    assert.doesNotMatch(source.sql, /sales_crm_call_log/, `source "${source.key}" reads the call log back into Contacts`);
  }
});

test("an untriaged call that is still a lead row stays out too", () => {
  /*
   * The old webhook wrote its calls into `sales_crm_lead`, so removing the call-log source is only
   * half of it: those rows are still in the lead table and would go on arriving as "Unknown" against
   * a bare number. `board_key` is what the CRM's own boards keep them off the verticals by, and it
   * is what this has to use - a second definition of "this is a call" is a second thing to drift.
   */
  const lead = SOURCES.find((source) => source.key === "crmLead");
  assert.ok(lead, 'source "crmLead" is gone; update this test with it');
  assert.ok(
    lead.sql.includes(`COALESCE(\`board_key\`, '') <> '${BOARD_KEY.Calls}'`),
    "the lead source no longer excludes the Calls board, so untriaged Callyzer calls are contacts again",
  );
  assert.equal(BOARD_KEY.Calls, "calls", "the Calls board key changed; the clause above has to move with it");
});

test("a project's WED / QQ / CORP is translated to the names the CRM uses", () => {
  /*
   * The same three verticals are filed as `WED` / `QQ` / `CORP` on a sales project and as Dum Dum /
   * Qua Qua / Corp on a lead - `whatsappGroupNameUtils.js` already has to translate between them.
   * Untranslated, one contact would show "Dum Dum, WED" and read as two verticals.
   */
  const sql = SERVICE.match(/const PROJECT_VERTICAL_SQL = `([\s\S]*?)`;/)[1];
  assert.match(sql, /WHEN 'WED' THEN 'Dum Dum'/);
  assert.match(sql, /WHEN 'QQ' THEN 'Qua Qua'/);
  assert.match(sql, /WHEN 'CORP' THEN 'Corp'/);
});

test("the CRM's vertical rule still agrees with the clause the board filters by", () => {
  /*
   * The lead rows take their vertical from `VERTICAL_SQL`, which restates `BOARD_SQL` inside out:
   * that one answers "is this lead on the board I asked for", this one answers "which vertical is
   * it". A spelling recognised by one and not the other would put a lead on the board under Corp
   * and in the directory under Dum Dum.
   *
   * The two are no longer a straight mirror - there are four boards and three verticals, because
   * an untriaged call sits on Calls and has no vertical yet - so what is checked here is the part
   * that still has to agree: the spellings, and the fallback.
   */
  const lead = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "sales", "crm-leads", "leadQueryService.js"), "utf8");
  // The Dum Dum clause is written as "not one of the others", so it lists them all in one place.
  const dumDum = BOARD_SQL_SOURCE["Dum Dum"];
  assert.ok(dumDum, "BOARD_SQL_SOURCE no longer has a Dum Dum clause to read the spellings from");
  const spellings = [...dumDum.matchAll(/'([a-z]+)'/g)].map((match) => match[1]).filter((word) => word !== "callyzer");
  assert.deepEqual(spellings, ["quaqua", "corp", "corporate", "corporation"]);

  const vertical = lead.match(/const VERTICAL_SQL = `([\s\S]*?)`;/)[1];
  for (const spelling of spellings) {
    assert.match(vertical, new RegExp(`WHEN '${spelling}' THEN`), `VERTICAL_SQL does not name '${spelling}'`);
  }
  // And the same fallback, or a lead with no vertical is on the board but in no contact's row.
  assert.match(vertical, /ELSE 'Dum Dum'/);
  assert.match(dumDum, /TRIM\(COALESCE\(`vertical`,''\)\) = ''/);
});

test("the four boards are a clean split - a lead is on exactly one of them", () => {
  /*
   * Calls was carved out of Dum Dum, which is the move that can go wrong quietly: leave the Dum
   * Dum clause alone and an untriaged call is counted twice - once on each board - and the tab
   * counts on both stop adding up to the number of leads there actually are.
   *
   * Read against `BOARD_SQL_SOURCE` rather than `BOARD_SQL`. The queries now name the indexed
   * `board_key` column instead of these expressions, but the expressions are still what the column
   * means - they are the definition the migration computes - so this is where the property lives.
   */
  assert.ok(BOARD_SQL_SOURCE.Calls, "there is no Calls board");
  // Calls is Callyzer's own, and only while nothing has named a vertical for it.
  assert.match(BOARD_SQL_SOURCE.Calls, /TRIM\(COALESCE\(`vertical`,''\)\) = ''/);
  assert.match(BOARD_SQL_SOURCE.Calls, /LOWER\(TRIM\(COALESCE\(`source`,''\)\)\) = 'callyzer'/);
  // And Dum Dum has to exclude exactly that clause, or the same call sits on two boards.
  assert.ok(
    BOARD_SQL_SOURCE["Dum Dum"].includes(`NOT ${BOARD_SQL_SOURCE.Calls}`),
    "the Dum Dum clause no longer excludes the Calls board, so an untriaged call is on both",
  );
  // The other two verticals are named outright, so a call with a vertical cannot reach Calls.
  for (const board of ["Qua Qua", "Corp"]) {
    assert.doesNotMatch(BOARD_SQL_SOURCE[board], /callyzer/, `${board} should not be reading the source column`);
  }
});

test("the board column the queries use means what the four clauses say", () => {
  /*
   * The queries no longer evaluate those clauses - they read `board_key`, a stored column MySQL
   * fills in - so the two can drift apart silently, and a lead on the wrong board looks exactly
   * like a lead on the right one. This is the join between them.
   *
   * Every board maps to a key, every query names that key, and the migration that defines the
   * column contains the same four decisions in the same order. Compared as normalised text: the
   * migration is SQL written for MySQL and this is SQL written for a template literal, so
   * whitespace and escaping differ while the words must not.
   */
  const squash = (sql) => String(sql).replace(/\\/g, "").replace(/\s+/g, " ").trim();

  assert.deepEqual(Object.keys(BOARD_SQL_SOURCE), Object.keys(BOARD_KEY));
  for (const [board, key] of Object.entries(BOARD_KEY)) {
    assert.equal(BOARD_SQL[board], `\`board_key\` = '${key}'`, `${board} does not read the board column`);
  }

  const migration = fs.readFileSync(
    // `board_key` was first added by 20260903120000 and re-declared, over the renamed `vertical`
    // column, by the migration below. That one holds the live definition.
    path.join(__dirname, "..", "prisma", "migrations", "20260906180000_rename_crm_lead_branch_to_vertical", "migration.sql"),
    "utf8",
  );
  const definition = squash(migration.slice(migration.indexOf("`board_key` VARCHAR(10)"), migration.indexOf(") STORED;")));

  // The Calls test, and the three vertical spellings, exactly as the clauses state them.
  assert.ok(definition.includes(squash(CALLS_PARTS.branchBlank)), "board_key does not test for a blank vertical");
  assert.ok(definition.includes(squash(CALLS_PARTS.callyzer)), "board_key does not test the Callyzer source");
  for (const key of Object.values(BOARD_KEY)) {
    assert.ok(definition.includes(`'${key}'`), `board_key never produces '${key}'`);
  }
  // A deleted lead is on no board - the whole reason the queries can drop `deleted_at IS NULL`.
  assert.match(definition, /WHEN `deleted_at` IS NOT NULL THEN NULL/);
});

// The two halves of the Calls test, named so the check above reads as the sentence it is making.
const CALLS_PARTS = {
  branchBlank: "TRIM(COALESCE(`vertical`,'')) = ''",
  callyzer: "LOWER(TRIM(COALESCE(`source`,''))) = 'callyzer'",
};

test("a row is a record, not a person, so its id and its vertical are its own", () => {
  /*
   * The directory used to group the union on the phone key and concatenate the ids, so a client who
   * enquired twice and became a project read as one row carrying three ids in one cell. That cell
   * could not be filtered to one of them, could not be sorted by either, and gave the row a single
   * name and vertical where each record has its own - and a double click had to pick one, so the
   * other enquiry was reachable from nowhere on this screen.
   *
   * Nothing is aggregated now. Pinned by the absence of the aggregate rather than by the shape of
   * what replaced it: `GROUP_CONCAT` coming back is exactly the regression this is here to catch.
   */
  assert.doesNotMatch(SERVICE, /GROUP_CONCAT/, "the directory groups its records onto one row again");
  assert.doesNotMatch(SERVICE, /GROUP BY/, "the directory groups its records onto one row again");
  // The person is still known - it is what orders the list so somebody's records arrive together,
  // and what the client can group by - it just no longer decides what a row is.
  assert.match(SERVICE, /\$\{CONTACT_KEY_SQL\} AS \\`contactKey\\`/);
  assert.match(SERVICE, /PARTITION BY c\.\\`contactKey\\`/);
});

test("a row carries a key that two modules cannot both mint", () => {
  /*
   * An id is unique within the module that issued it, and this list crosses nine of them: an Image
   * Selection project is listed under its *name*, and a call with no code yet falls back to its
   * numeric row id. Either could collide with something from another module, and a duplicate key
   * silently drops a row from the table - on a directory, a contact nobody can find with nothing to
   * say so. Source plus id cannot collide, because a source's own ids do not.
   */
  assert.match(SERVICE, /key: `\$\{row\.source\}:\$\{row\.id\}`/);
  const page = fs.readFileSync(path.join(__dirname, "..", "..", "frontend", "src", "components", "contacts", "ContactsPage.js"), "utf8");
  assert.match(page, /getRowId=\{\(row\) => row\.key\}/, "the table keys its rows by an id nine modules mint separately");
});

test("a double click opens the record on the row, not one of the person's other records", () => {
  // `leadId` and `projectId` are read off this row's own `linkKind`, so the enquiry a reader
  // double-clicked is the enquiry that opens. Aggregated, one of a person's two leads won a MAX and
  // the other could not be opened from this screen at all.
  assert.match(SERVICE, /leadId: row\.linkKind === "lead" \? String\(row\.id \|\| ""\) : ""/);
  assert.match(SERVICE, /projectId: row\.linkKind === "project" \? String\(row\.id \|\| ""\) : ""/);
});

/* ------------------------------------------------------------- what a double click can open */

test("only the sources with a screen of their own declare something to open", () => {
  /*
   * A contact row is a person, not a record, so double-clicking one has to land somewhere real.
   * `linkKind` is that answer, and it has to stay honest: claiming a kind for a source with no
   * screen would send somebody to a page that opens nothing, which is worse than the row simply
   * showing the contact's own details.
   */
  const kindOf = (key) => {
    const source = SOURCES.find((entry) => entry.key === key);
    assert.ok(source, `source "${key}" is gone; update this test with it`);
    const match = source.sql.match(/'([a-z]*)' AS `linkKind`/);
    assert.ok(match, `source "${key}" does not declare a linkKind`);
    return match[1];
  };

  // The two that open something: the CRM's lead popup, and a project's record.
  assert.equal(kindOf("crmLead"), "lead");
  assert.equal(kindOf("salesProject"), "project");
  // And the rest, which have none - said as "" rather than left off.
  for (const key of ["employee", "quotation", "imageSelection", "paymentRequest", "vendor", "clientStorage"]) {
    assert.equal(kindOf(key), "", `source "${key}" claims a screen it does not have`);
  }
});
