const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const prisma = require("../src/config/db");
const service = require("../src/modules/sales/quotation-brands/service");
const { shootsForBrand } = require("../src/modules/sales/quotation-brands/defaults");

/*
 * The shoots a brand quotes for, now that the studio maintains them.
 *
 * They were the constant `BRAND_SHOOTS` - fourteen for Dum Dum, thirteen for Qua Qua, two for Corp -
 * read in one place: the picture sets in Quotation Settings. A studio that started doing a new kind
 * of shoot under a brand had no way to say so.
 *
 * They are a table now, edited in Settings → Field Settings → Quotation → Shoot Type, and read in
 * three places: that screen, the picture sets, and the Quotation Generator's Add Shoot - which is
 * what makes a Dum Dum quotation offer Dum Dum's shoots rather than the studio's whole vocabulary.
 * Each brand's list is its own; the studio names what it quotes for under each.
 */

const BRANDS = ["DUM_DUM", "QUA_QUA", "CORP"];

test("every brand answers with the shoots it quotes for", async () => {
  for (const code of BRANDS) {
    const configuration = await service.brandConfiguration(code);
    assert.ok(configuration, `${code} has no configuration`);
    assert.ok(Array.isArray(configuration.shoots) && configuration.shoots.length,
      `${code} offers no shoots, so nothing could be quoted under it`);
  }
});

test("the brands do not share one list", async () => {
  // The whole reason this is per brand: Dum Dum photographs a Sangeeth and Qua Qua photographs a
  // Naming ceremony, and neither is offered the other's.
  const [dumDum, quaQua] = await Promise.all([
    service.brandConfiguration("DUM_DUM"),
    service.brandConfiguration("QUA_QUA"),
  ]);
  const shared = dumDum.shoots.filter((name) => quaQua.shoots.includes(name));
  assert.deepEqual(shared, [], "Dum Dum and Qua Qua offer the same shoot, which they never did");
});

test("the seeded lists are what the constant held", async () => {
  /*
   * The migration seeds each brand with exactly what `BRAND_SHOOTS` held, so no picture set loses
   * the shoots it was built from and no quotation raised before this stops matching.
   */
  for (const code of BRANDS) {
    const { shoots } = await service.brandConfiguration(code);
    assert.deepEqual([...shoots].sort(), [...shootsForBrand(code)].sort(), `${code} no longer offers what it did`);
  }
});

test("a brand with no rows of its own falls back to what the code said", () => {
  // An unseeded database is the case this protects: answering "this brand quotes for nothing" would
  // leave the generator unable to add a shoot at all.
  assert.ok(shootsForBrand("DUM_DUM").length, "the fallback is empty, so an unseeded brand offers nothing");
  assert.deepEqual(shootsForBrand("NOT_A_BRAND"), [], "an unknown brand invents shoots");
});

test("the editable rows carry an id, and the offered names do not", async () => {
  /*
   * Two shapes for two readers. A quotation stores the name of a shoot and nothing else, so that is
   * what the generator and the picture sets are given; renaming or removing one needs the row it
   * came from, so Field Settings reads `shootRows`.
   */
  const configuration = await service.brandConfiguration("CORP", { includeInactive: true });
  assert.ok(configuration.shootRows.every((row) => row.id && row.name), "a shoot row has no id or name");
  assert.deepEqual(configuration.shootRows.map((row) => row.name).sort(), [...configuration.shoots].sort());
  assert.ok(configuration.shoots.every((name) => typeof name === "string"), "the offered shoots are not plain names");
});

test("a shoot cannot be listed twice under one brand", async () => {
  // Two rows with one name is the picture sets being unable to say which set the shoot belongs to.
  const existing = await prisma.salesQuotationBrandShoot.findFirst({ where: { brandCode: "CORP" } });
  if (!existing) return;
  await assert.rejects(
    () => service.createShoot("CORP", { name: existing.name }),
    (error) => error.status === 409,
    "the same shoot was accepted twice under one brand",
  );
});

/* ────────────────────────── the readers, off the source ────────────────────────── */

const read = (...parts) => fs.readFileSync(path.join(process.cwd(), ...parts), "utf8");

test("the generator offers a quotation only its brand's shoots", () => {
  const panel = read("..", "frontend", "src", "components", "sales", "QuotationGeneratorPanel.js");
  assert.match(panel, /shootChoices=\{brandConfig\?\.shoots \|\| null\}/,
    "the generator's Add Shoot no longer narrows to the brand's shoots");

  const dialog = read("..", "frontend", "src", "components", "project-management", "AddShootDialog.js");
  assert.match(dialog, /shootChoices = null/, "the dialog no longer takes a narrowed list");
  /*
   * Falling back to the studio's whole vocabulary matters as much as the narrowing: Project
   * Management passes nothing and must still offer everything, and a brand whose shoots have not
   * been set up must not leave somebody unable to add one.
   */
  assert.match(dialog, /shootChoices\.length \? shootChoices : shootOptions/,
    "an empty brand list no longer falls back to the studio's own");
});

test("Field Settings offers Shoot Type under Quotations and draws the per-brand editor", () => {
  /*
   * Settings -> Fields asks module, then screen, then field, and the first two are the sidebar's
   * own - so Shoot Type is reached under Sales & CRM -> Quotations, which is the screen it is
   * actually asked on.
   */
  const lists = read("..", "frontend", "src", "constants", "moduleFieldLists.js");
  assert.match(lists, /value: "shoot-types"[\s\S]{0,200}screens: \["quotations"\][\s\S]{0,80}editor: "quotation-shoot-types"/,
    "Shoot Type is not offered under Quotations, or no longer names the editor that draws it per brand");

  const nav = read("..", "frontend", "src", "constants", "navigation.mjs");
  assert.match(nav, /id: "quotations", label: "Quotations"/, "Quotations is not a screen the sidebar has");
});
