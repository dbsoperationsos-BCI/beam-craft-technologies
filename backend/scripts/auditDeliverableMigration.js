/**
 * Whether the deliverable brand/variant migration landed whole, and whether every seeded service
 * and deliverable is still in the database as an ordinary, user-managed row.
 *
 * Read-only, and safe to run against production: it issues `SELECT` and nothing else. Run it as
 * often as you like - it changes nothing, so running it twice says the same thing twice.
 *
 *   node scripts/auditDeliverableMigration.js
 *
 * It exists because migration `20260918090000` did two things that are silent when they go wrong:
 *
 *   1. It turned `photo_count_enabled`, `image_selection_enabled` and `remarks_enabled` from
 *      booleans into text. A naive `ALTER` would have written MySQL's own '1' and '0' rather than
 *      the words, and '0' does not start with "no" - so every deliverable answered **No** would
 *      have been admitted to Image Selection, with nothing to say so. Check 4 is that.
 *   2. It backfilled each deliverable's single brand/size/frame/length/price into the
 *      `Deliverable -> Brand -> Variant` tables. A deliverable whose data failed to carry over
 *      would simply open on an empty form, and the first save would write the emptiness back.
 *      Check 5 is that.
 *
 * And because `seed.js` cannot be run on the VPS, the names it seeds reach production only through
 * a database that already holds them. Checks 1 and 2 are that: every name the seed knows about is
 * present, so nothing that was seeded has been missed. Once present they are ordinary rows - the
 * same tables, API, screens, validation and delete flow as anything a studio adds itself - and
 * nothing reads the seed at runtime.
 *
 * Exits 0 when everything holds, 1 when anything does not, so it can gate a deploy.
 */

const fs = require("node:fs");
const path = require("node:path");
const prisma = require("../src/config/db");
const { deliverableAnswerText } = require("../src/services/deliverableAnswers");

/**
 * The names `seed.js` knows about, read out of its source rather than by requiring it - requiring
 * the seed would *run* the seed, which is the one thing an audit must never do.
 */
function seededNames(variable) {
  const source = fs.readFileSync(path.join(__dirname, "..", "prisma", "seed.js"), "utf8");
  const start = source.indexOf(`const ${variable} = [`);
  if (start < 0) throw new Error(`seed.js no longer declares ${variable}`);
  const open = source.indexOf("[", start);
  const close = source.indexOf("\n];", open);
  if (close < 0) throw new Error(`Unable to read the end of ${variable} in seed.js`);
  const names = [...source.slice(open, close).matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((match) => JSON.parse(`"${match[1]}"`));
  if (!names.length) throw new Error(`${variable} in seed.js reads as empty, which it is not`);
  return names;
}

// The comparison the application itself makes: case, spacing and punctuation are not a difference.
const fold = (value) => String(value || "").trim().replace(/\s+/g, " ").toLowerCase();

const failures = [];
const notes = [];
function check(ok, label, detail = "") {
  console.log(`${ok ? "  ok  " : " FAIL "} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(label);
}

async function main() {
  console.log("\nDeliverable migration audit\n");

  const [services, deliverables, brands, variants] = await Promise.all([
    prisma.projectServiceDefinition.findMany({ select: { id: true, name: true, isActive: true } }),
    prisma.projectDeliverableDefinition.findMany({
      select: {
        id: true, name: true, isActive: true, mediaType: true, price: true,
        brandName: true, imageSize: true, videoLength: true, frameInches: true,
        photoCountEnabled: true, imageSelectionEnabled: true, remarksEnabled: true,
        brands: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], include: { variants: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] } } },
      },
    }),
    prisma.projectDeliverableBrand.findMany({ select: { id: true, definitionId: true, name: true } }),
    prisma.projectDeliverableVariant.findMany({ select: { id: true, brandId: true } }),
  ]);

  console.log(`Services ${services.length}  ·  Deliverables ${deliverables.length}  ·  Brands ${brands.length}  ·  Variants ${variants.length}\n`);

  // 1 & 2. Nothing the seed knows about has gone missing.
  for (const [variable, rows, label] of [["serviceDefinitions", services, "service"], ["deliverableDefinitions", deliverables, "deliverable"]]) {
    const seeded = seededNames(variable);
    const held = new Set(rows.map((row) => fold(row.name)));
    const missing = seeded.filter((name) => !held.has(fold(name)));
    check(missing.length === 0, `every seeded ${label} name is in the database (${seeded.length} seeded)`, missing.length ? `missing: ${missing.join(", ")}` : "");
    // Anything beyond the seed was added by a studio, which is the point - reported, never faulted.
    const extra = rows.length - seeded.filter((name) => held.has(fold(name))).length;
    if (extra > 0) notes.push(`${extra} ${label}${extra === 1 ? "" : "s"} beyond the seed — added in the application, which is expected.`);
  }

  // 3. Nothing is orphaned or doubled.
  const definitionIds = new Set(deliverables.map((row) => row.id));
  const brandIds = new Set(brands.map((row) => row.id));
  check(brands.every((brand) => definitionIds.has(brand.definitionId)), "every brand belongs to a deliverable that exists");
  check(variants.every((variant) => brandIds.has(variant.brandId)), "every variant belongs to a brand that exists");
  const brandKeys = brands.map((brand) => `${brand.definitionId}::${fold(brand.name)}`);
  const duplicates = brandKeys.filter((key, index) => brandKeys.indexOf(key) !== index);
  check(duplicates.length === 0, "no deliverable holds the same brand twice", duplicates.length ? `${duplicates.length} duplicate(s)` : "");

  // 4. The two answers are words, not MySQL's 1 and 0. `remarksEnabled` is not among them: it is a
  //    note the studio writes now, so whatever is in it is its own business.
  const numeric = [];
  for (const row of deliverables) {
    for (const field of ["photoCountEnabled", "imageSelectionEnabled"]) {
      if (["0", "1"].includes(deliverableAnswerText(row[field]))) numeric.push(`${row.name}.${field}`);
    }
  }
  check(numeric.length === 0, "every Yes/No answer survived as a word, not as 1 or 0", numeric.length ? numeric.join(", ") : "");

  // 4b. And the note is nobody's switch: nothing should still be holding the Yes the dropdown wrote.
  const leftoverAnswers = deliverables.filter((row) => ["yes", "no"].includes(deliverableAnswerText(row.remarksEnabled).toLowerCase()));
  check(leftoverAnswers.length === 0, "Remarks holds notes rather than the Yes/No it used to be", leftoverAnswers.length ? `${leftoverAnswers.length} still answered — run migration 20260918100000` : "");

  // 5. Every deliverable that described itself still does, through a brand and a variant.
  const described = (row) => [row.brandName, row.imageSize, row.videoLength, row.frameInches].some((value) => String(value || "").trim()) || row.price != null;
  const notCarried = deliverables.filter((row) => described(row) && !row.brands.some((brand) => brand.variants.length));
  check(notCarried.length === 0, "every deliverable holding a brand, size, frame, length or price has a variant carrying it", notCarried.map((row) => row.name).join(", "));

  // 6. The five columns the CRM Quotation Calculator still reads agree with the first variant they
  //    are written from, so the calculator quotes what the dialog shows.
  const drifted = [];
  for (const row of deliverables) {
    const [first] = row.brands;
    const variant = first?.variants?.[0];
    if (!variant) continue;
    const same = (a, b) => String(a ?? "").trim() === String(b ?? "").trim();
    const priceSame = row.price == null ? variant.price == null : variant.price != null && Number(row.price) === Number(variant.price);
    if (!same(row.brandName, first.name) || !same(row.imageSize, variant.size) || !same(row.frameInches, variant.frameInches) || !same(row.videoLength, variant.videoLength) || !priceSame) drifted.push(row.name);
  }
  check(drifted.length === 0, "the columns the Quotation Calculator reads match the first variant", drifted.join(", "));

  // 7. Nothing a project already booked has lost the definition behind it.
  const [danglingDeliverables, danglingServices] = await Promise.all([
    prisma.projectShootDeliverable.count({ where: { deletedAt: null, deliverableDefinitionId: { not: null, notIn: [...definitionIds] } } }),
    prisma.projectPostProductionAllocation.count({ where: { deletedAt: null, serviceDefinitionId: { not: null, notIn: services.map((row) => row.id) } } }),
  ]);
  check(danglingDeliverables === 0, "every allocated deliverable still points at a definition that exists");
  check(danglingServices === 0, "every allocated service still points at a definition that exists");

  if (notes.length) console.log(`\n${notes.map((note) => `  note  ${note}`).join("\n")}`);
  console.log(failures.length ? `\n${failures.length} check(s) failed.\n` : "\nAll checks passed.\n");
  return failures.length ? 1 : 0;
}

main()
  .then((code) => prisma.$disconnect().then(() => process.exit(code)))
  .catch(async (error) => {
    console.error("Audit could not run:", error);
    await prisma.$disconnect();
    process.exit(1);
  });
