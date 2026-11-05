/*
 * Fills the Deliverables table with demonstration deliverables, each sold by brands and each brand
 * in variants, so Settings → Project → Deliverables can be looked at with something in it.
 *
 * The studio's own deliverables are retired (migration `20260918110000`) and its new ones are typed
 * by hand, which leaves the screen empty - and an empty screen is the one state in which none of
 * the three levels, the chevrons, the price ranges or the type-specific columns can be judged at
 * all.
 *
 *   node scripts/seedDemoDeliverables.js            # write them
 *   node scripts/seedDemoDeliverables.js --remove   # take every one of them back out
 *
 * ── This is demonstration data, and it is removed by code prefix ──────────────────────────────
 *
 * Every deliverable it writes is named "Demo …", so `codeFor` gives it a code beginning
 * `DELIVERABLE_DEMO_`. `--remove` deletes exactly that prefix. The prefix is the point: a removal
 * that matched on names, or on a range of ids, is a removal that eventually matches something
 * somebody typed - which is the lesson `seedLeadsForPerf.js` records at length, having once written
 * a `--remove` that would have deleted three real leads. `codeFor` is imported from the controller
 * rather than copied here, so the codes this writes and the codes the application writes cannot
 * drift apart.
 *
 * The rows are written the way a save from the dialog writes them, through the controller's own
 * `deliverableBrandsForSave`: the same tables, the same normalisation, the same legacy columns
 * mirrored from the first brand's first variant that the CRM Quotation Calculator reads. So what
 * appears on screen is what the application itself would have produced, not a shape only this
 * script can make.
 *
 * Writing is idempotent - each deliverable is matched by its code and updated, its brands replaced
 * whole - so running it twice leaves the same eight deliverables rather than sixteen.
 *
 * The eight deliberately include the awkward cases, because those are the ones that find layout
 * bugs: a deliverable sold by three brands, one sold by a brand with no name, a variant nobody has
 * priced, a video sold in several durations, a deliverable with no brands at all (which therefore
 * has no chevron), and one whose type has never been answered.
 *
 * Never run this against production. It refuses to, unless it is told twice.
 */
require("dotenv").config();

const prisma = require("../src/config/db");
const { codeFor, deliverableBrandsForSave } = require("../src/modules/sales/projects/controller");

const CODE_PREFIX = "DELIVERABLE_DEMO_";

/*
 * What each deliverable is asked, in the words the columns hold. `photoCount` and `imageSelection`
 * are the Yes or No the dropdowns write; `remarks` is the note, and is left off where there is none.
 */
const DEMO = [
  {
    name: "Demo Album Printing",
    mediaType: "IMAGE",
    photoCount: "Yes",
    imageSelection: "Yes",
    remarks: "Sent flat, never rolled.",
    brands: [
      { name: "Canvera", variants: [
        { size: "12x18", frameInches: "1.5 inch", price: 2000 },
        { size: "16x24", frameInches: "2 inch", price: 3500 },
        { size: "8x10", frameInches: "1 inch", price: 1200 },
      ] },
      { name: "Pictoo", variants: [
        { size: "12x18", frameInches: "1 inch", price: 1800 },
        { size: "16x24", frameInches: "1.5 inch", price: 3200 },
      ] },
      // Unnamed on purpose: a studio printing its own albums has nobody to name, and the row still
      // has to read as a brand rather than as one that lost its name.
      { name: "", variants: [{ size: "20x30", frameInches: "2 inch", price: 4500 }] },
    ],
  },
  {
    name: "Demo Acrylic Printing",
    mediaType: "IMAGE",
    photoCount: "Yes",
    imageSelection: "No",
    brands: [
      { name: "Canvera", variants: [
        { size: "12x18", frameInches: "1 inch", price: 2200 },
        // Not priced yet, which is a real state and not the same as free.
        { size: "24x36", frameInches: "2 inch", price: null },
      ] },
    ],
  },
  {
    name: "Demo Frames Printing",
    mediaType: "IMAGE",
    photoCount: "No",
    // Left unanswered, which keeps it out of Image Selection exactly as it always did.
    imageSelection: "",
    brands: [
      { name: "Studio Frames", variants: [{ size: "8x12", frameInches: "1 inch", price: 900 }] },
      { name: "Classic Frames", variants: [
        { size: "8x12", frameInches: "1.5 inch", price: 1100 },
        { size: "12x18", frameInches: "1.5 inch", price: 1600 },
      ] },
    ],
  },
  {
    name: "Demo Calendar Designing",
    mediaType: "IMAGE",
    photoCount: "Yes",
    imageSelection: "No",
    remarks: "Twelve spreads, one per month.",
    brands: [{ name: "Pictoo", variants: [{ size: "A3", frameInches: "", price: 2600 }] }],
  },
  {
    name: "Demo Cinematic Highlights",
    mediaType: "VIDEO",
    photoCount: "No",
    imageSelection: "No",
    brands: [
      { name: "In-House Edit", variants: [
        { videoLength: "3 minutes", price: 15000 },
        { videoLength: "5 minutes", price: 22000 },
        { videoLength: "8 minutes", price: 30000 },
      ] },
    ],
  },
  {
    name: "Demo Cinematic Full Length",
    mediaType: "VIDEO",
    photoCount: "No",
    imageSelection: "No",
    remarks: "Delivered on a drive, not a link.",
    brands: [
      { name: "In-House Edit", variants: [{ videoLength: "45 minutes", price: 38000 }] },
      { name: "Partner Studio", variants: [
        { videoLength: "45 minutes", price: 42000 },
        { videoLength: "90 minutes", price: 65000 },
      ] },
    ],
  },
  {
    name: "Demo Reels",
    mediaType: "VIDEO",
    photoCount: "No",
    imageSelection: "No",
    brands: [{ name: "In-House Edit", variants: [{ videoLength: "30 seconds", price: null }] }],
  },
  {
    // No type, no brands: the row that has nothing to open, and so draws no chevron at all.
    name: "Demo Photo Selection",
    mediaType: null,
    photoCount: "Yes",
    imageSelection: "Yes",
    remarks: "Client picks from the gallery.",
    brands: [],
  },
];

/*
 * The rest of the thirty-eight, written compactly because they are variations on the eight above
 * rather than new shapes: a name, its type, and the brands and variants it is sold in. The eight
 * hold the awkward cases; these hold the volume, so the table, its filters and its column widths
 * are seen at the size the studio actually works at.
 *
 *   IMAGE  [size, frameInches, price]
 *   VIDEO  [videoLength, price]
 */
const IMAGE_BRANDS = ["Canvera", "Pictoo", "Studio Press"];
const VIDEO_BRANDS = ["In-House Edit", "Partner Studio"];

const MORE = [
  ["Demo Bulk Edited Images", "IMAGE", [["Standard", "", 3500]]],
  ["Demo Retouches", "IMAGE", [["Per photo", "", 120], ["Per 50 photos", "", 5000]]],
  ["Demo AI Retouch", "IMAGE", [["Per photo", "", 80]]],
  ["Demo Unlimited Soft Copies", "IMAGE", [["Drive", "", 1500]]],
  ["Demo Compressed Images", "IMAGE", [["Drive", "", 900]]],
  ["Demo Raw File In", "IMAGE", [["Drive", "", 2000]]],
  ["Demo Final Files Out", "IMAGE", [["Drive", "", 2500]]],
  ["Demo Photo Culling", "IMAGE", [["Per 1000 photos", "", 3000]]],
  ["Demo Album Selection", "IMAGE", [["Per album", "", 1800]]],
  ["Demo Album Designing", "IMAGE", [["12x36", "", 6500], ["16x24", "", 8500]]],
  ["Demo Signature Album Soft Copy", "IMAGE", [["12x36", "1 inch", 7500]]],
  ["Demo Print Only", "IMAGE", [["8x12", "", 250], ["12x18", "", 450], ["16x24", "", 900]]],
  ["Demo Frames Retouching", "IMAGE", [["8x12", "1 inch", 600]]],
  ["Demo Countdown Poster", "IMAGE", [["A3", "", 800]]],
  ["Demo Save The Date", "IMAGE", [["A4", "", 1200]]],
  ["Demo QR Generation", "IMAGE", [["Standard", "", 500]]],
  ["Demo QR Publishing", "IMAGE", [["Standard", "", 750]]],
  ["Demo Photo Book", "IMAGE", [["8x8", "", 3200], ["10x10", "", 4800]]],
  ["Demo Canvas Print", "IMAGE", [["16x24", "2 inch", 3800], ["24x36", "2 inch", 6200]]],
  ["Demo Mini Album", "IMAGE", [["6x8", "", 2200]]],
  ["Demo Cinematic Teaser", "VIDEO", [["60 seconds", 9000], ["90 seconds", 12000]]],
  ["Demo Traditional Full Length", "VIDEO", [["60 minutes", 26000]]],
  ["Demo Traditional Highlights", "VIDEO", [["10 minutes", 14000]]],
  ["Demo Wedding Documentary", "VIDEO", [["30 minutes", 32000]]],
  ["Demo Bloopers", "VIDEO", [["2 minutes", 6000]]],
  ["Demo Slide Show", "VIDEO", [["4 minutes", 7000]]],
  ["Demo Full Length 360", "VIDEO", [["20 minutes", 18000]]],
  ["Demo Reels Pack", "VIDEO", [["3 reels", 11000], ["5 reels", 17000]]],
  ["Demo Candid Highlights", "VIDEO", [["6 minutes", 21000]]],
  ["Demo Anniversary Edit", "VIDEO", [["5 minutes", 15000]]],
];

/** One compact entry, opened out into the shape the eight above are written in. */
function entryFromSpec([name, mediaType, variants], index) {
  const names = mediaType === "VIDEO" ? VIDEO_BRANDS : IMAGE_BRANDS;
  // One brand, or two where there is more than one variant to spread across them - so the list
  // holds both single-brand deliverables and multi-brand ones without either being contrived.
  const brandNames = variants.length > 1 ? names.slice(index % 2, (index % 2) + 2) : [names[index % names.length]];
  return {
    name,
    mediaType,
    photoCount: mediaType === "IMAGE" ? "Yes" : "No",
    imageSelection: index % 3 === 0 ? "Yes" : "No",
    ...(index % 4 === 0 ? { remarks: "Quoted per event." } : {}),
    brands: brandNames.map((brandName, brandIndex) => ({
      name: brandName,
      variants: variants.map((variant) => (mediaType === "VIDEO"
        ? { videoLength: variant[0], price: Math.round(variant[1] * (1 + brandIndex * 0.1)) }
        : { size: variant[0], frameInches: variant[1], price: Math.round(variant[2] * (1 + brandIndex * 0.1)) })),
    })),
  };
}

DEMO.push(...MORE.map(entryFromSpec));

const text = (value) => (String(value ?? "").trim() || null);

/** What the dialog would have sent, and what the controller would have stored from it. */
function definitionDataFor(entry, sortOrder) {
  const brands = deliverableBrandsForSave(entry.brands, entry.mediaType);
  const [first] = brands;
  const variant = first?.variants?.[0] || null;
  return {
    brands,
    data: {
      code: codeFor("DELIVERABLE", entry.name),
      name: entry.name,
      mediaType: entry.mediaType || null,
      photoCountEnabled: text(entry.photoCount),
      imageSelectionEnabled: text(entry.imageSelection),
      remarksEnabled: text(entry.remarks),
      // The five columns the CRM Quotation Calculator reads, mirrored from the first brand's first
      // variant - the same rule `updateDeliverableDefinition` follows on every save.
      brandName: first?.name || null,
      imageSize: variant?.size || null,
      frameInches: variant?.frameInches || null,
      videoLength: variant?.videoLength || null,
      price: variant?.price ?? null,
      // Kind pricing belongs to the shape the dialog replaced; a demo row carries none.
      pricing: null,
      isActive: true,
      sortOrder,
    },
  };
}

async function write() {
  let written = 0;
  let brandCount = 0;
  let variantCount = 0;

  for (const [index, entry] of DEMO.entries()) {
    const { data, brands } = definitionDataFor(entry, index + 1);
    await prisma.$transaction(async (transaction) => {
      const existing = await transaction.projectDeliverableDefinition.findUnique({ where: { code: data.code }, select: { id: true } });
      const row = existing
        ? await transaction.projectDeliverableDefinition.update({ where: { id: existing.id }, data })
        : await transaction.projectDeliverableDefinition.create({ data });
      // Replaced whole, as a save from the dialog replaces them; the variants cascade with them.
      await transaction.projectDeliverableBrand.deleteMany({ where: { definitionId: row.id } });
      for (const [brandIndex, brand] of brands.entries()) {
        await transaction.projectDeliverableBrand.create({
          data: {
            definitionId: row.id,
            name: brand.name,
            sortOrder: brandIndex,
            variants: { create: brand.variants.map((variant, inner) => ({ ...variant, sortOrder: inner })) },
          },
        });
      }
    });
    const variants = brands.reduce((sum, brand) => sum + brand.variants.length, 0);
    written += 1;
    brandCount += brands.length;
    variantCount += variants;
    console.log(`  · ${entry.name} — ${brands.length} brand${brands.length === 1 ? "" : "s"}, ${variants} variant${variants === 1 ? "" : "s"}`);
  }

  console.log(`\n${written} demo deliverables, ${brandCount} brands, ${variantCount} variants.`);
  console.log("Take them out again with:  node scripts/seedDemoDeliverables.js --remove\n");
}

async function remove() {
  const rows = await prisma.projectDeliverableDefinition.findMany({
    where: { code: { startsWith: CODE_PREFIX } },
    select: { id: true, name: true },
  });
  if (!rows.length) {
    console.log("\nNothing to remove — no deliverable carries the demo code prefix.\n");
    return;
  }
  rows.forEach((row) => console.log(`  · ${row.name}`));
  // Their brands and variants go with them: `project_deliverable_brand` cascades from the
  // definition, and `project_deliverable_variant` from the brand.
  const { count } = await prisma.projectDeliverableDefinition.deleteMany({ where: { code: { startsWith: CODE_PREFIX } } });
  console.log(`\n${count} demo deliverable(s) removed, with their brands and variants.\n`);
}

async function main() {
  const removing = process.argv.includes("--remove");
  /*
   * Demonstration data has no business on a production database, and the two operations are both
   * writes. `--force` exists so somebody who genuinely means it can still say so, out loud.
   */
  if (process.env.NODE_ENV === "production" && !process.argv.includes("--force")) {
    console.error("\nRefusing to run against NODE_ENV=production. Pass --force if you really mean it.\n");
    return 1;
  }
  console.log(removing ? "\nRemoving demo deliverables\n" : "\nWriting demo deliverables\n");
  await (removing ? remove() : write());
  return 0;
}

main()
  .then((code) => prisma.$disconnect().then(() => process.exit(code)))
  .catch(async (error) => {
    console.error("Demo deliverables could not be written:", error);
    await prisma.$disconnect();
    process.exit(1);
  });
