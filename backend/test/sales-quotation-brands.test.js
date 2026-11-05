const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  BRAND_CODES,
  DEFAULT_TERMS,
  DEFAULT_PDF_CONTENT,
  brandCodeFor,
  verticalNameFor,
  mergePdfContent,
  mergePdfAssets,
  pdfContentOverrides,
  shootsForBrand,
  resolveCoverSet,
} = require("../src/modules/sales/quotation-brands/defaults");
const { brandCodeOfPayload, gstPercentFor } = require("../src/modules/sales/quotation-brands/service");
const { quotationPayloadSchema } = require("../src/modules/sales/projects/controller");

/*
 * One quotation engine, three brands.
 *
 * The brand is the vertical the generator has always stored, under a code the register can filter
 * on; what it changes is the content a version is raised with, and what it must never change is a
 * version already raised. The rules below are the ones that keep those two apart.
 */

test("every spelling the application has held for a vertical resolves to its brand", () => {
  assert.equal(brandCodeFor("Dum Dum"), "DUM_DUM");
  assert.equal(brandCodeFor("DUM_DUM"), "DUM_DUM");
  assert.equal(brandCodeFor("WED"), "DUM_DUM");
  assert.equal(brandCodeFor("dumdum"), "DUM_DUM");
  assert.equal(brandCodeFor("Qua Qua"), "QUA_QUA");
  assert.equal(brandCodeFor("QQ"), "QUA_QUA");
  assert.equal(brandCodeFor("QuaQua"), "QUA_QUA");
  assert.equal(brandCodeFor("Corp"), "CORP");
  assert.equal(brandCodeFor("corporate"), "CORP");
  // Unknown and blank name nothing, so the caller decides the default rather than this guessing.
  assert.equal(brandCodeFor("Team 33"), null);
  assert.equal(brandCodeFor(""), null);
  assert.equal(brandCodeFor(null), null);
});

test("a payload names its brand by column first, by vertical second, and is Dum Dum otherwise", () => {
  // The same rule the migration's backfill applies in SQL: every existing row was raised for a
  // vertical, and the rows that named none were always read as Dum Dum.
  assert.equal(brandCodeOfPayload({ quotationBrand: "CORP", vertical: "Dum Dum" }), "CORP");
  assert.equal(brandCodeOfPayload({ vertical: "Qua Qua" }), "QUA_QUA");
  assert.equal(brandCodeOfPayload({ vertical: "Corp" }), "CORP");
  assert.equal(brandCodeOfPayload({}), "DUM_DUM");
  assert.equal(brandCodeOfPayload(null), "DUM_DUM");
  assert.equal(brandCodeOfPayload({ quotationBrand: "NOT_A_BRAND" }), "DUM_DUM");
});

test("the brand code and the vertical name are one fact in two spellings", () => {
  for (const code of BRAND_CODES) assert.equal(brandCodeFor(verticalNameFor(code)), code);
});

test("the GST a version is raised under is what it was priced with, then the brand's, then the studio's", () => {
  assert.equal(gstPercentFor({ rates: { gstPercent: 12 } }, { gstPercent: 5 }, { gstPercent: 18 }), 12);
  assert.equal(gstPercentFor({}, { gstPercent: 5 }, { gstPercent: 18 }), 5);
  assert.equal(gstPercentFor({}, { gstPercent: null }, { gstPercent: 18 }), 18);
  assert.equal(gstPercentFor({}, null, null), 18);
  // Zero is a rate, not an absence: a brand that charges no GST says so.
  assert.equal(gstPercentFor({}, { gstPercent: 0 }, { gstPercent: 18 }), 0);
});

/*
 * ── Defaults ──────────────────────────────────────────────────────────────────────────────────
 *
 * A brand that has configured nothing prints exactly what every quotation printed before brands
 * existed. The defaults live on the server, because the snapshot is built there; the page keeps
 * a copy for versions raised before snapshots. The two must not drift.
 */

test("pdf overrides lay over the defaults key by key, and a blank goes back to the default", () => {
  const merged = mergePdfContent({ eventSectionTitle: "Project Itinerary", closingQuote: "   ", unknownKey: "ignored" });
  assert.equal(merged.eventSectionTitle, "Project Itinerary");
  assert.equal(merged.eventSectionLabel, DEFAULT_PDF_CONTENT.eventSectionLabel);
  assert.equal(merged.closingQuote, DEFAULT_PDF_CONTENT.closingQuote);
  assert.equal("unknownKey" in merged, false);
  assert.deepEqual(mergePdfContent(null), DEFAULT_PDF_CONTENT);
});

test("only typed overrides are stored, and none at all stores null", () => {
  assert.deepEqual(pdfContentOverrides({ eventSectionTitle: " Project Itinerary ", closingQuote: "", other: "x" }), { eventSectionTitle: "Project Itinerary" });
  assert.equal(pdfContentOverrides({ closingQuote: "" }), null);
  assert.equal(pdfContentOverrides(null), null);
});

test("the server's defaults are the words the public page prints for a version without a snapshot", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "../../frontend/src/components/sales/quotationTemplateContent.js"), "utf8");
  for (const term of DEFAULT_TERMS) {
    assert.ok(source.includes(term.title), `frontend template is missing the term "${term.title}"`);
    assert.ok(source.includes(term.body), `frontend template's "${term.title}" clause differs from the server default`);
  }
  for (const [key, value] of Object.entries(DEFAULT_PDF_CONTENT)) {
    if (!value) continue;
    assert.ok(source.includes(value), `frontend template does not carry the default for ${key}: ${value}`);
  }
  // And every key the server merges is one the page's own default list knows.
  for (const key of Object.keys(DEFAULT_PDF_CONTENT)) {
    assert.ok(source.includes(`${key}:`) || source.includes(`  ${key},`), `frontend defaultPdfContent has no "${key}"`);
  }
});

/*
 * ── The payload ───────────────────────────────────────────────────────────────────────────────
 */

test("a line's quantity and price are checked, and an older payload's blanks still pass", () => {
  const base = { enquiryId: "DBS-EID-DD-ERD-000001", shoots: [], deliverables: [] };
  assert.equal(quotationPayloadSchema.safeParse({ ...base, services: [{ quantity: 2, unitPrice: 30000 }] }).success, true);
  assert.equal(quotationPayloadSchema.safeParse({ ...base, services: [{ quantity: "", unitPrice: null }] }).success, true);
  assert.equal(quotationPayloadSchema.safeParse({ ...base, services: [{ serviceName: "Drone" }] }).success, true);
  assert.equal(quotationPayloadSchema.safeParse({ ...base, services: [{ quantity: 0 }] }).success, false);
  assert.equal(quotationPayloadSchema.safeParse({ ...base, services: [{ unitPrice: -1 }] }).success, false);
  assert.equal(quotationPayloadSchema.safeParse({ ...base, services: [{ unitPrice: "abc" }] }).success, false);
});

test("the brand, the vertical and the GST rate ride on the payload and the rest passes through", () => {
  const parsed = quotationPayloadSchema.safeParse({ quotationBrand: "CORP", vertical: "Corp", gstPercent: 18, packages: [{ packageId: "p1" }], companyName: "Acme" });
  assert.equal(parsed.success, true);
  assert.equal(parsed.data.quotationBrand, "CORP");
  assert.equal(parsed.data.vertical, "Corp");
  assert.equal(parsed.data.gstPercent, 18);
  assert.equal(parsed.data.companyName, "Acme");
  assert.deepEqual(parsed.data.packages, [{ packageId: "p1" }]);
  assert.equal(quotationPayloadSchema.safeParse({ gstPercent: 101 }).success, false);
});

/*
 * ── The write path, held to its rules by reading it ───────────────────────────────────────────
 *
 * As the versions test does: the failure mode is silence - a version raised without its snapshot
 * prints today's terms and nobody notices until the terms change - so the lines are asserted on.
 */
const CONTROLLER = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "sales", "projects", "controller.js"), "utf8");

test("every version is raised with the brand snapshot stamped onto it", () => {
  assert.match(CONTROLLER, /async function insertQuotationVersion[\s\S]*?quotationBrands\.snapshotForQuotation\(parsed, \{ globalLogoUrl: branding\.logoUrl \}\)/);
  assert.match(CONTROLLER, /columns\.quotationBrand = brand\.quotationBrand/);
  // The Global Logo is the only mark: the row's logoUrl is the studio's, snapshotted as ever, and
  // the brand carries none of its own.
  assert.doesNotMatch(CONTROLLER, /branding\.logoUrl = brand\.logoUrl/);
  const service = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "sales", "quotation-brands", "service.js"), "utf8");
  assert.match(service, /const logoUrl = globalLogoUrl \|\| live\.presentation\.globalLogoUrl \|\| null/);
});

test("a new quotation is checked against what the brand offers, and a version keeps its lines", () => {
  assert.match(CONTROLLER, /async function createQuotation[\s\S]*?assertNewSelectionsOffered\(parsed, null\)/);
  assert.match(CONTROLLER, /async function createQuotationVersion[\s\S]*?assertNewSelectionsOffered\(withBrand, source\.payload\)/);
  // And the brand of a version is the chain's, never the request's.
  assert.match(CONTROLLER, /quotationBrand: source\.quotationBrand \|\| quotationBrands\.brandCodeOfPayload\(source\.payload\)/);
});

test("the register serialises the brand from the column, falling back to the payload", () => {
  assert.match(CONTROLLER, /quotationBrand: row\.quotationBrand \|\| quotationBrands\.brandCodeOfPayload\(row\.payload\)/);
  assert.match(CONTROLLER, /brandSnapshot: row\.payload\?\.brandSnapshot \|\| null/);
});

test("the brand routes guard reads on either permission and writes on Quotation Settings", () => {
  const routes = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "sales", "quotation-brands", "routes.js"), "utf8");
  assert.match(routes, /router\.use\(protect\)/);
  assert.match(routes, /checkAnyPermission\(\[\s*\{ module: "SALES", feature: "Quotation Management", level: "READ" \},\s*\{ module: "SETTINGS", feature: "Quotation Settings", level: "READ" \},\s*\]\)/);
  assert.match(routes, /admin\.use\(requireModule\("SETTINGS", "Quotation Settings"\)\)/);
  // No route escapes: every admin route is under the admin router, and no controller checks a role.
  const controller = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "sales", "quotation-brands", "controller.js"), "utf8");
  assert.equal(controller.includes("req.user.role"), false);
});

test("the migration backfills the brand from the payload's vertical and never drops anything", () => {
  const sql = fs.readFileSync(path.join(__dirname, "..", "prisma", "migrations", "20260909140000_quotation_brands", "migration.sql"), "utf8");
  assert.match(sql, /ADD COLUMN `quotation_brand` VARCHAR\(20\) NOT NULL DEFAULT 'DUM_DUM'/);
  assert.match(sql, /JSON_EXTRACT\(`payload`, '\$\.vertical'\)/);
  assert.match(sql, /THEN 'QUA_QUA'/);
  assert.match(sql, /THEN 'CORP'/);
  assert.match(sql, /ELSE 'DUM_DUM'/);
  assert.equal(/DROP (TABLE|COLUMN)/i.test(sql), false, "the brand migration must not drop anything");
  // Every index name fits MySQL's 64-character limit, which is what failed the first run.
  for (const [, name] of sql.matchAll(/INDEX `([^`]+)`/g)) assert.ok(name.length <= 64, `${name} is ${name.length} characters`);
});

/*
 * ── Cover and Thank You photographs, per group of shoots ────────────────────────────────────────
 *
 * A quotation opens on the photograph of what it is mainly for. The brand holds sets - a group of
 * shoots and the two pictures they print - and the version being raised freezes the pair it
 * resolved to, so re-pointing a set later cannot change a quotation already sent.
 */

test("a brand only offers the shoots it quotes for, spelled as Add Shoot spells them", () => {
  const dialog = fs.readFileSync(path.resolve(__dirname, "../../frontend/src/components/project-management/AddShootDialog.js"), "utf8");
  const declared = dialog.match(/export const shootOptions = \[(.*?)\];/s);
  assert.ok(declared, "AddShootDialog no longer exports shootOptions");
  const vocabulary = [...declared[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);

  assert.deepEqual(BRAND_CODES.map((code) => shootsForBrand(code).length), [14, 13, 2]);
  for (const code of BRAND_CODES) {
    for (const shoot of shootsForBrand(code)) {
      assert.ok(vocabulary.includes(shoot), `${code} names a shoot Add Shoot does not offer: "${shoot}"`);
    }
  }
  // No shoot belongs to two brands, so a picture set can never be built from another brand's work.
  const all = BRAND_CODES.flatMap((code) => shootsForBrand(code));
  assert.equal(new Set(all).size, all.length, "a shoot is offered by more than one brand");
  assert.deepEqual(shootsForBrand("NOT_A_BRAND"), []);
});

test("the main event decides which set prints, then set order, then the first set", () => {
  const sets = [
    { shoots: [], coverImageUrl: "fallback", thankYouImageUrl: "fallback-ty" },
    { shoots: ["Haldi", "Mehandi"], coverImageUrl: "haldi", thankYouImageUrl: "haldi-ty" },
    { shoots: ["Engagement", "Reception"], coverImageUrl: "engagement", thankYouImageUrl: "engagement-ty" },
  ];
  const cover = (shoots) => resolveCoverSet(sets, shoots)?.coverImageUrl ?? null;

  // The main event wins even where another shoot's set is listed first.
  assert.equal(cover([{ shoot: "Engagement", isMainEvent: true }, { shoot: "Haldi" }]), "engagement");
  assert.equal(cover([{ shoot: "Haldi", isMainEvent: true }, { shoot: "Engagement" }]), "haldi");
  // Nothing marked as the main event: the first shoot on the quotation is read as the main one,
  // exactly as the page's own heading does.
  assert.equal(cover([{ shoot: "Engagement" }, { shoot: "Haldi" }]), "engagement");
  // The main event is in no set, so any other shoot answers - taking the sets in studio order.
  assert.equal(cover([{ shoot: "Wedding", isMainEvent: true }, { shoot: "Reception" }, { shoot: "Haldi" }]), "haldi");
  // Nothing matches at all, and a quotation with no shoots yet: the first set is the fallback.
  assert.equal(cover([{ shoot: "Wedding" }]), "fallback");
  assert.equal(cover([]), "fallback");
  // Spelling is not the studio's problem: "Baby Shoot_CP" and "baby shoot cp" are one shoot.
  assert.equal(resolveCoverSet([{ shoots: ["Baby Shoot_CP"], coverImageUrl: "cp" }], [{ shoot: "baby shoot cp" }])?.coverImageUrl, "cp");
  // No sets at all - a brand that has configured none - leaves the plain photographs to answer.
  assert.equal(resolveCoverSet([], [{ shoot: "Haldi" }]), null);
});

test("a brand configured before picture sets existed reads back as one set holding what it had", () => {
  const legacy = mergePdfAssets({ coverImageUrl: " https://cdn/cover.webp ", thankYouImageUrl: "https://cdn/ty.webp" });
  assert.deepEqual(legacy.coverSets, [{ shoots: [], religion: "", coverImageUrl: "https://cdn/cover.webp", thankYouImageUrl: "https://cdn/ty.webp" }]);
  // With no shoots it matches nothing, so it is only ever the fallback - how one cover always read.
  assert.equal(resolveCoverSet(legacy.coverSets, [{ shoot: "Wedding", isMainEvent: true }])?.coverImageUrl, "https://cdn/cover.webp");

  // Once sets are configured they answer, and the flat pair is not put back alongside them.
  const configured = mergePdfAssets({ coverImageUrl: "https://cdn/old.webp", coverSets: [{ shoots: ["Wedding"], coverImageUrl: "https://cdn/w.webp" }] });
  assert.deepEqual(configured.coverSets, [{ shoots: ["Wedding"], religion: "", coverImageUrl: "https://cdn/w.webp", thankYouImageUrl: null }]);

  // A row somebody added and left empty is not a set.
  assert.deepEqual(mergePdfAssets({ coverSets: [{ shoots: [], coverImageUrl: "", thankYouImageUrl: "" }] }).coverSets, []);
  assert.deepEqual(mergePdfAssets(null).coverSets, []);
});

test("the sets are the brand's to hold and never travel onto the page or into a snapshot", () => {
  const service = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "sales", "quotation-brands", "service.js"), "utf8");
  /*
   * The pair is resolved once, on the server, from what the quotation actually holds — its shoots
   * and, for the brand that asks, its religion. Both travel, or a set named for a religion could
   * never be chosen and the picker would be a setting that does nothing.
   */
  assert.match(service, /resolveCoverSet\(combined\.coverSets, payload\.shoots, payload\.religion\)/);
  // What the page is handed is the two links, not the studio's whole configuration.
  assert.match(service, /delete assetsForPage\.coverSets/);
  // The page still knows nothing about shoots: it reads a cover, as it always has.
  const page = fs.readFileSync(path.resolve(__dirname, "../../frontend/src/components/sales/PublicQuotationPage.js"), "utf8");
  assert.equal(page.includes("coverSets"), false, "the client's copy must not branch on picture sets");
  assert.ok(page.includes("assets.coverImageUrl"), "the page still prints assets.coverImageUrl");
});
