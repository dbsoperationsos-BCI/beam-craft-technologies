const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { clientDownloadAllowed } = require("../src/modules/sales/quotation-brands/defaults");

/*
 * Allow Client Download: whether the client holding a quotation's link may save it as a file.
 *
 * One answer per brand - Settings → Quotation Settings → <brand> → PDF Content - because it is the
 * brand's posture towards its clients rather than a fact of the page. The rules worth holding here
 * are the three that decide whether it is a *setting* or only a hidden button: No is the answer to
 * silence, the file itself is refused and not just the control, and the studio's own download is a
 * different route that this cannot reach.
 */

test("only a stored Yes is Yes - silence, a missing brand and a missing column all read as No", () => {
  assert.equal(clientDownloadAllowed({ allowClientDownload: true }), true);
  assert.equal(clientDownloadAllowed({ allowClientDownload: false }), false);
  // A brand row from before the column, and a brand the table has no row for at all.
  assert.equal(clientDownloadAllowed({}), false);
  assert.equal(clientDownloadAllowed(null), false);
  assert.equal(clientDownloadAllowed(undefined), false);
  // Nothing truthy-but-not-true may open it: a "0" or a "No" off a form is not consent.
  assert.equal(clientDownloadAllowed({ allowClientDownload: "No" }), false);
  assert.equal(clientDownloadAllowed({ allowClientDownload: 1 }), false);
});

const read = (...parts) => fs.readFileSync(path.join(__dirname, "..", ...parts), "utf8");
const BRAND_SERVICE = read("src", "modules", "sales", "quotation-brands", "service.js");
const CONTROLLER = read("src", "modules", "sales", "projects", "controller.js");
const ROUTES = read("src", "modules", "sales", "projects", "routes.js");
const SCHEMA = read("prisma", "schema.prisma");

test("the brand carries its own column, defaulting to No", () => {
  assert.match(SCHEMA, /allowClientDownload\s+Boolean\s+@default\(false\)\s+@map\("allow_client_download"\)/);
  const migrations = path.join(__dirname, "..", "prisma", "migrations");
  const folder = fs.readdirSync(migrations).find((name) => name.endsWith("_quotation_brand_allow_client_download"));
  assert.ok(folder, "the column needs a migration - the seed cannot be run on the VPS");
  const sql = fs.readFileSync(path.join(migrations, folder, "migration.sql"), "utf8");
  assert.match(sql, /ALTER TABLE `sales_quotation_brand`/);
  assert.match(sql, /ADD COLUMN `allow_client_download` BOOLEAN NOT NULL DEFAULT false/);
});

test("the answer is read live off the brand, never off the version's snapshot", () => {
  /*
   * The whole point of the separation. Everything else the public page prints is frozen onto the
   * version as it was raised, and if this were frozen with it, switching the setting off would
   * leave every link already sent still handing out files.
   */
  assert.match(BRAND_SERVICE, /async function allowsClientDownload[\s\S]*?readBrand\(code\)[\s\S]*?clientDownloadAllowed\(brand\)/);
  assert.doesNotMatch(
    BRAND_SERVICE,
    /brandSnapshot: \{[\s\S]*?allowClientDownload[\s\S]*?snapshotAt/,
    "allowClientDownload must not be snapshotted onto a version",
  );
});

test("the client's PDF route refuses the file itself, not only the button", () => {
  const handler = CONTROLLER.match(/async function publicQuotationPdf\(req, res\) \{[\s\S]*?\n\}/)[0];
  assert.match(handler, /allowsClientDownload\(quotation\)/);
  assert.match(handler, /refuse\(403, \{ message:/, "a fetch is refused with 403; a page load goes back to the quotation");
  // And the page is told, so it can hide a control that would only lead to that refusal.
  const page = CONTROLLER.match(/async function publicQuotation\(req, res\) \{[\s\S]*?\n\}/)[0];
  assert.match(page, /allowClientDownload/);
});

test("the studio's own download is a signed-in route of its own, ungoverned by the brand's answer", () => {
  assert.match(ROUTES, /router\.get\("\/quotations\/:id\/pdf", quotations, quotationPdf\)/);
  const handler = CONTROLLER.match(/async function quotationPdf\(req, res\) \{[\s\S]*?\n\}/)[0];
  // Scoped like every other read of a quotation, and never asked whether the client may download.
  assert.match(handler, /scopedQuotation\(req, req\.params\.id\)/);
  assert.doesNotMatch(handler, /allowsClientDownload/);
});
