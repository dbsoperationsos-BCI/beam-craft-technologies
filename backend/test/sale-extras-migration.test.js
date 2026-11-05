const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const prisma = require("../src/config/db");

/*
 * Sale Extras' migration: the three plan tables gain a baseline snapshot, filled for every row that
 * already exists (their scope as it stands today becomes the baseline) and empty on rows written
 * later; the change lines and the immutable revisions get tables of their own. Nothing else is written.
 */

const MIGRATION = fs.readFileSync(path.join(__dirname, "..", "prisma", "migrations", "20261101160000_sale_extras", "migration.sql"), "utf8");

after(() => prisma.$disconnect());

test("the migration only adds: the snapshot column, its backfill, and two new tables", () => {
  for (const table of ["project_shoot", "project_post_production_allocation", "project_shoot_deliverable"]) {
    assert.match(MIGRATION, new RegExp(`ALTER TABLE \`${table}\` ADD COLUMN \`sale_baseline\` JSON NULL`));
    assert.match(MIGRATION, new RegExp(`UPDATE \`${table}\` SET \`sale_baseline\` = `));
  }
  assert.match(MIGRATION, /CREATE TABLE `project_sale_extra`/);
  assert.match(MIGRATION, /CREATE TABLE `project_sale_extra_revision`/);
  // The backfill writes the snapshot and nothing else.
  for (const statement of MIGRATION.split(";").filter((part) => /UPDATE `/.test(part))) {
    assert.match(statement, /SET `sale_baseline` = /);
    assert.doesNotMatch(statement.replace(/SET `sale_baseline` = [\s\S]*?(WHERE|$)/, ""), /SET/);
  }
  assert.doesNotMatch(MIGRATION, /DELETE FROM|DROP (TABLE|COLUMN|INDEX|FOREIGN)/);
});

test("the models exist, and a row written now is not baseline", async () => {
  assert.equal(typeof await prisma.projectSaleExtra.count(), "number");
  assert.equal(typeof await prisma.projectSaleExtraRevision.count(), "number");
  for (const model of ["projectShoot", "projectPostProductionAllocation", "projectShootDeliverable"]) {
    assert.ok(prisma[model].fields.saleBaseline, model);
  }
  // A shoot already deleted before the migration has its baseline cleared again by
  // 20261101180000_sale_extras_deleted_rows, so only the live ones are asked about.
  const unbaselined = await prisma.$queryRawUnsafe("SELECT COUNT(*) AS c FROM `project_shoot` WHERE `sale_baseline` IS NULL AND `created_at` < (SELECT `finished_at` FROM `_prisma_migrations` WHERE `migration_name` = '20261101160000_sale_extras') AND (`deleted_at` IS NULL OR `deleted_at` >= (SELECT `finished_at` FROM `_prisma_migrations` WHERE `migration_name` = '20261101160000_sale_extras'))");
  assert.equal(Number(unbaselined[0].c), 0, "every shoot live when the migration ran is baseline");
});

test("a row already deleted before Sale Extras was installed is not baseline, so its removal is not an extra", async () => {
  const rows = await prisma.$queryRawUnsafe(`
    SELECT COUNT(*) AS c FROM (
      SELECT deleted_at, sale_baseline FROM project_shoot
      UNION ALL SELECT deleted_at, sale_baseline FROM project_post_production_allocation
      UNION ALL SELECT deleted_at, sale_baseline FROM project_shoot_deliverable
    ) AS plan
    WHERE plan.sale_baseline IS NOT NULL
      AND plan.deleted_at < (SELECT finished_at FROM _prisma_migrations WHERE migration_name = '20261101160000_sale_extras')`);
  assert.equal(Number(rows[0].c), 0);
});
