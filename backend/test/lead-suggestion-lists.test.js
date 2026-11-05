const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const prisma = require("../src/config/db");
const { definitions } = require("../src/modules/hrm/master-data/definitions");
const { countUsage, renameUsage } = require("../src/modules/hrm/master-data/usage");

/*
 * Relationship and Referred From: the two suggestion lists behind a lead's details, maintained in
 * Settings → Field Settings → Quotation.
 *
 * Both are typed-with-suggestions fields on SALES → CRM → Add Lead, on the lead popup and on the
 * Quotation Generator's Client Details, and both lists were written out twice - in `CRMPage.js` and
 * in `quotationVerticalConfig.js` - where no studio could add a source of its own. What is asserted
 * here is what makes them safe to edit: a delete is checked against the leads still holding the
 * value, a rename carries those leads with it, and every screen falls back to exactly what the
 * arrays used to say.
 */

const readSource = (...parts) => fs.readFileSync(path.join(__dirname, "..", ...parts), "utf8");
const readFrontend = (...parts) => fs.readFileSync(path.join(__dirname, "..", "..", "frontend", "src", ...parts), "utf8");

const MIGRATION = readSource("prisma", "migrations", "20260910180000_lead_relationship_and_referral_source_lists", "migration.sql");
const CONFIG = readFrontend("components", "sales", "quotationVerticalConfig.js");

/** The names one INSERT seeds, read out of the migration. */
function seededNames(table) {
  const insert = MIGRATION.split(`INSERT INTO \`${table}\``)[1];
  assert.ok(insert, `the migration seeds no ${table}`);
  return [...insert.split("WHERE NOT EXISTS")[0].matchAll(/'[A-Z_]+'(?: AS `code`)?,\s*'([^']+)'/g)].map((match) => match[1]);
}

/** A `export const NAME = [ ... ];` array of strings in a frontend file. */
function frontendArray(source, name) {
  const start = source.indexOf(`export const ${name} = [`);
  assert.ok(start >= 0, `${name} is no longer exported`);
  return [...source.slice(start, source.indexOf("];", start)).matchAll(/"([^"]+)"/g)].map((match) => match[1]);
}

test("both lists are master-data resources that know the lead columns holding their values", () => {
  for (const [key, field] of [["lead-relationships", "relationship"], ["referral-sources", "referredFrom"]]) {
    const definition = definitions[key];
    assert.ok(definition, `${key} is not a master-data resource, so Field Settings cannot edit it`);
    assert.equal(definition.usedBy.length, 1);
    const [use] = definition.usedBy;
    assert.equal(use.model, "salesCrmLead");
    assert.equal(use.field, field);
    assert.equal(use.match, "exact");
    // A lead in the trash no longer holds the board's answer: without this, a source used only by a
    // deleted lead could never be removed from the list.
    assert.deepEqual(use.where, { deletedAt: null }, `${key} counts leads in the trash as still using the value`);
  }
});

test("the seeded rows are exactly what the two screens always suggested", () => {
  assert.deepEqual(seededNames("lead_relationship"), frontendArray(CONFIG, "relationshipOptions"));
  assert.deepEqual(seededNames("referral_source"), frontendArray(CONFIG, "referredFromOptions"));
  const guards = MIGRATION.match(/WHERE NOT EXISTS \(SELECT 1 FROM `(lead_relationship|referral_source)` `existing`\);/g) || [];
  assert.equal(guards.length, 2, "both seeds must be guarded against a table that already has rows");
});

test("a value held only by a lead in the trash reads as unused, and a rename reaches the board", async () => {
  /*
   * Against the database, because the `where` a use declares is only worth anything if `usage.js`
   * actually applies it. A lead is filed with a relationship nothing else uses, counted, moved to
   * the trash, counted again, and then cleaned up whatever happened in between.
   */
  const enquiryId = `TEST-LEAD-LIST-${Date.now()}`;
  const value = `Zz Test Relationship ${Date.now()}`;
  const definition = definitions["lead-relationships"];
  try {
    await prisma.salesCrmLead.create({ data: { enquiryId, name: "List check", relationship: value } });
    assert.equal((await countUsage(definition, value)).total, 1, "a live lead holding the value must count");

    const renamed = await prisma.$transaction((tx) => renameUsage(tx, definition, value, `${value} renamed`));
    assert.equal(renamed, 1, "renaming must carry the lead with it");
    const row = await prisma.salesCrmLead.findUnique({ where: { enquiryId }, select: { relationship: true } });
    assert.equal(row.relationship, `${value} renamed`);

    await prisma.salesCrmLead.update({ where: { enquiryId }, data: { deletedAt: new Date() } });
    assert.equal((await countUsage(definition, `${value} renamed`)).total, 0, "a lead in the trash must not hold the value");
  } finally {
    await prisma.salesCrmLead.deleteMany({ where: { enquiryId } });
  }
});

test("both lists are offered under the two screens that ask for them, beside Shoot Type", () => {
  /*
   * Add Lead and the quotation's Client Details both ask, so both offer the list - it is the same
   * rows and the same endpoint from either screen. Shoot Type is Quotations' alone.
   */
  const lists = readFrontend("constants", "moduleFieldLists.js");
  // Matched on the resource and the screens it is offered under, which is what this is about. The
  // label is not pinned here: every list on that screen is named by its plural, so what a list is
  // called is a wording decision made across all eighteen of them at once and not this test's.
  assert.match(lists, /value: "lead-relationships"[\s\S]{0,160}screens: \["leads-followups", "quotations"\]/);
  assert.match(lists, /value: "referral-sources"[\s\S]{0,160}screens: \["leads-followups", "quotations"\]/);
  assert.match(lists, /value: "shoot-types"[\s\S]{0,160}screens: \["quotations"\]/, "Shoot Type must still be there, under Quotations");
});
