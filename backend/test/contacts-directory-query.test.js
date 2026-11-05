const test = require("node:test");
const assert = require("node:assert/strict");
const prisma = require("../src/config/db");
const { SOURCES, listContacts } = require("../src/modules/contacts/directory/service");

/*
 * The directory's SQL, run against a real schema.
 *
 * contacts-directory.test.js reads the source and holds the eight sources to the shape they have to
 * share; it deliberately touches no database, so it says nothing about whether the columns those
 * queries name exist. That is the half that broke: `VERTICAL_SQL` still read `sales_crm_lead`.`branch`
 * after 20260906180000 renamed it to `vertical`, so the whole UNION failed with *Unknown column* on
 * every correctly migrated database - which is production - while a developer machine carrying a
 * leftover `branch` column answered happily. A screen that works everywhere it is written and fails
 * where it is used is the worst shape this bug takes, and only a database can catch it.
 *
 * raw-sql-table-names.test.js is the same guard one level up: it checks the *tables* raw SQL names
 * against the schema, from the file, and cannot see columns. This is the column half, and it is
 * done by execution rather than by parsing because working out which table an identifier belongs to
 * in an arbitrary UNION is guesswork, while MySQL already knows.
 *
 * Needs MySQL, like test/iam.test.js: CI applies every migration to a throwaway database before
 * running the suite, so a source that names a column no migration creates fails here.
 */

test.after(() => prisma.$disconnect());

test("every contact source's SQL runs against the migrated schema", async () => {
  const broken = [];

  for (const source of SOURCES) {
    try {
      /*
       * `LIMIT 0` - the question is whether MySQL accepts the query, not what is in the tables. A
       * fresh CI database is empty, so a test that asserted on rows would assert on nothing; a
       * plan that resolves every column name is the whole answer here, and it is free.
       */
      await prisma.$queryRawUnsafe(`SELECT * FROM (${source.sql}) \`probe\` LIMIT 0`);
    } catch (error) {
      broken.push(`${source.key}: ${error?.message?.split("\n").pop()?.trim() || error}`);
    }
  }

  assert.deepEqual(
    broken,
    [],
    "A contact source names something the schema does not have. Usually a rename a hand-written "
      + `query was left out of:\n  ${broken.join("\n  ")}`,
  );
});

test("the directory answers with every source permitted", async () => {
  /*
   * The assembled query, not the eight pieces: the UNION, the contact key over it and the window
   * function that keeps a person's records together are all built in `listContacts` and appear in
   * no source's own SQL. A super admin reads all eight, which is the widest the query ever gets and
   * the one production runs.
   */
  const result = await listContacts({ can: async () => true, limit: 5 });

  assert.ok(Array.isArray(result.rows), "the directory answered with no rows array");
  assert.equal(typeof result.total, "number");
  assert.deepEqual(result.sources, SOURCES.map((source) => source.key), "a source was silently dropped");
  assert.ok(result.rows.length <= 5, "the limit was not applied");

  for (const row of result.rows) {
    // Every column the screen reads is a string, whatever the module it came from stores.
    for (const field of ["key", "id", "name", "contact", "verticals", "module", "contactKey"]) {
      assert.equal(typeof row[field], "string", `row.${field} is not a string`);
    }
  }
});

test("a lead's vertical comes from the column that holds it", async () => {
  /*
   * `VERTICAL_SQL` read `branch` for three days after the column became `vertical`. On a database
   * that still had both - a developer's - it did not throw; it answered "Dum Dum" for every lead,
   * because the leftover column was empty. So a query that runs is not enough: the value has to
   * come from the live column.
   */
  const lead = await prisma.salesCrmLead.findFirst({
    where: { deletedAt: null, verticalName: { in: ["Qua Qua", "Corp"] } },
    select: { enquiryId: true, verticalName: true },
  });
  if (!lead) return; // An empty database, or a studio with only Dum Dum leads: nothing to compare.

  const [row] = await prisma.$queryRawUnsafe(
    `SELECT ${require("../src/modules/sales/crm-leads/leadQueryService").VERTICAL_SQL} AS \`vertical\``
      + " FROM `sales_crm_lead` WHERE `enquiry_id` = ?",
    lead.enquiryId,
  );
  assert.equal(row.vertical, lead.verticalName, "the directory reads a lead's vertical from the wrong column");
});
