require("dotenv").config();

const bcrypt = require("bcryptjs");
const { PrismaClient } = require("@prisma/client");
const { seedAssetCategories } = require("./asset-categories.seed");
const { seedInterviewSources } = require("./seeds/interview-sources.seed");
const { seedInterviewPositions } = require("./seeds/interview-positions.seed");
/*
 * No. of Count is a **typed answer** now, not a Yes/No.
 *
 * `photo_count_enabled` was a boolean and is `VARCHAR(191)` since `20260918090000`, so a studio can
 * write what it actually does - "50 photos", "2 sets". It still decides something, by the rule in
 * `deliverableAnswers.js`: an answer starting with "no" is No, anything else typed is Yes, and
 * **blank is unanswered, which reads as off**.
 *
 * That last clause is why this is converted rather than dropped. `remarksEnabled` beside it became a
 * pure note deciding nothing, so the seed stopped writing it and NULL is the right answer there;
 * leaving this one out would instead turn the photo count *off* for Print only, Album Designing,
 * Album Printing and both Frames deliverables - the five that answered Yes. The migration wrote
 * TRUE as 'Yes' and FALSE as 'No' for every row it converted, and writing the same words here is
 * what keeps a freshly seeded database identical to a migrated one.
 *
 * Through the module that owns the rule rather than a `? "Yes" : "No"` here, so the seed cannot
 * come to disagree with the readers about what a boolean meant.
 */
const { deliverableAnswerText } = require("../src/services/deliverableAnswers");

const prisma = new PrismaClient();

// IAM Seed functions
const seedPermissions = require("./seeds/iam-roles-permissions").seedPermissions ||
  (async () => {
    console.log("ℹ️  IAM permissions will be seeded via separate script");
  });

const companyBranches = [
  ["ERODE_TN", "Erode TN"],
  ["TIRUPPUR_TN", "Tiruppur TN"],
  ["COIMBATORE_TN", "Coimbatore TN"],
  ["BANGALORE_KA", "Bangalore KA"],
  ["HYDERABAD_TL", "Hyderabad TL"],
  ["VISAKHAPATNAM_AP", "Visakhapatnam AP"],
];

async function seedCompanyBranches() {
  await prisma.branch.updateMany({
    where: { code: { in: ["CORP", "DUM_DUM", "QUA_QUA"] } },
    data: { isActive: false },
  });
  for (const [code, name] of companyBranches) {
    await prisma.branch.upsert({
      where: { code },
      update: { name, description: "Company branch", isActive: true },
      create: { code, name, description: "Company branch", isActive: true },
    });
  }
}

const email = "admin@dontblinkstudio.com";
const password = "Admin@cxzdsa1";
const username = "admin";
const serviceDefinitions = [
  "Indoor Photo Only",
  "Traditional Photo",
  "Traditional Video",
  "Candid Photo",
  "Candid Video",
  "Drone",
  "Complementary Drone",
  "LED Wall",
  "TV",
  "Mixing Unit",
  "Crane",
  "Al Feature",
  "Semi Candid Photo",
  "Semi Candid Video",
  "Spot Editing",
  "Spot Printing",
  "Spot Framing",
  "360 Camera Booth",
  "360 Video Booth",
  "Indoor Photo Shoot + Reels",
  "Outdoor Photo + Reels",
  "Outdoor Photo Only",
  "Pre/ Post Wedding Photography",
  "Pre/ Post Wedding Videography",
  "Pre/ Post Wedding Candid Photography",
  "Pre/ Post Wedding Candid Videography",
  "360 Video Camera",
  "Youtube Live",
  "Corporate Video",
  "Corporate Photo",
  "Headshots",
  "Product Photography",
  "Product Videography",
  "Product Photo & Video",
  "Makeup",
  "Makeup & Hairdo",
  "Semi Candid Photo + reel",
  "Candid Photo + Reels",
  "Only Post Production",
  "AI Memorial Video",
];
const optionSets = {
  SERVICE_FULL_HALF_SESSION: {
    name: "Service Session Timing",
    values: [
      { code: "FULL_SESSION", value: "FULL_SESSION", label: "Full Session", description: "Upto 12 Hours" },
      { code: "HALF_SESSION", value: "HALF_SESSION", label: "Half Session", description: "Upto 5 Hours" },
    ],
  },
  SERVICE_LED_WALL_SIZE: {
    name: "LED Wall Sizes",
    values: [
      { code: "12X8_FEET", value: "12x8 Feet", label: "12x8 Feet" },
      { code: "6X8_FEET", value: "6x8 Feet", label: "6x8 Feet" },
    ],
  },
  SERVICE_TV_SIZE: {
    name: "TV Sizes",
    values: [
      { code: "55_INCHES", value: "55 Inches", label: "55 Inches" },
      { code: "65_INCHES", value: "65 Inches", label: "65 Inches" },
    ],
  },
  DELIVERABLE_PRINT_SIZE: {
    name: "Deliverable Print Sizes",
    values: [
      { code: "2B_2X3", value: "2B (2x3)", label: "2B (2x3)" },
      { code: "WALLET_2_5X3_5", value: "Wallet (2.5x3.5)", label: "Wallet (2.5x3.5)" },
      { code: "3_5X5", value: "3.5x5", label: "3.5x5" },
      { code: "4R", value: "4R / Maxi (4x6)", label: "4R / Maxi (4x6)" },
      { code: "5X7", value: "5x7", label: "5x7" },
      { code: "6X8_INCHES", value: "6x8", label: "6x8" },
      { code: "8X10", value: "8x10", label: "8x10" },
      { code: "8X12_INCHES", value: "8x12", label: "8x12" },
      { code: "A4_8_27X11_69", value: "A4 (8.27x11.69)", label: "A4 (8.27x11.69)" },
      { code: "9X12", value: "9x12", label: "9x12" },
      { code: "10X12", value: "10x12", label: "10x12" },
      { code: "10X15", value: "10x15", label: "10x15" },
      { code: "11X14", value: "11x14", label: "11x14" },
      { code: "12X16", value: "12x16", label: "12x16" },
      { code: "12X18_INCHES", value: "12x18", label: "12x18" },
      { code: "13X19_A3_PLUS", value: "13x19 / A3+ (13x19)", label: "13x19 / A3+ (13x19)" },
      { code: "A3_11_69X16_54", value: "A3 (11.69x16.54)", label: "A3 (11.69x16.54)" },
      { code: "16X20", value: "16x20", label: "16x20" },
      { code: "16X24", value: "16x24", label: "16x24" },
      { code: "18X24", value: "18x24", label: "18x24" },
      { code: "20X24", value: "20x24", label: "20x24" },
      { code: "20X30", value: "20x30", label: "20x30" },
      { code: "24X36", value: "24x36", label: "24x36" },
      { code: "30X40", value: "30x40", label: "30x40" },
      { code: "30X45", value: "30x45", label: "30x45" },
      { code: "36X48", value: "36x48", label: "36x48" },
      { code: "40X60", value: "40x60", label: "40x60" },
    ],
  },
  DELIVERABLE_ALBUM_SIZE: {
    name: "Deliverable Album Sizes",
    inactiveCodes: ["12X18_INCHES", "12X24_INCHES"],
    values: [
      { code: "SQUARE_12X6", value: "Square - 12x6", label: "Square - 12x6" },
      { code: "SQUARE_16X8", value: "Square - 16x8", label: "Square - 16x8" },
      { code: "SQUARE_20X10", value: "Square - 20x10", label: "Square - 20x10" },
      { code: "SQUARE_24X12", value: "Square - 24x12", label: "Square - 24x12" },
      { code: "SQUARE_28X14", value: "Square - 28x14", label: "Square - 28x14" },
      { code: "SQUARE_32X16", value: "Square - 32x16", label: "Square - 32x16" },
      { code: "SQUARE_36X18", value: "Square - 36x18", label: "Square - 36x18" },
      { code: "PORTRAIT_16X10", value: "Portrait - 16x10", label: "Portrait - 16x10" },
      { code: "PORTRAIT_20X12", value: "Portrait - 20x12", label: "Portrait - 20x12" },
      { code: "PORTRAIT_20X14", value: "Portrait - 20x14", label: "Portrait - 20x14" },
      { code: "PORTRAIT_20X15", value: "Portrait - 20x15", label: "Portrait - 20x15" },
      { code: "PORTRAIT_24X15", value: "Portrait - 24x15", label: "Portrait - 24x15" },
      { code: "PORTRAIT_24X18", value: "Portrait - 24x18", label: "Portrait - 24x18" },
      { code: "PORTRAIT_28X18", value: "Portrait - 28x18", label: "Portrait - 28x18" },
      { code: "PORTRAIT_30X20", value: "Portrait - 30x20", label: "Portrait - 30x20" },
      { code: "PORTRAIT_32X20", value: "Portrait - 32x20", label: "Portrait - 32x20" },
      { code: "PORTRAIT_36X24", value: "Portrait - 36x24", label: "Portrait - 36x24" },
      { code: "PORTRAIT_40X30", value: "Portrait - 40x30", label: "Portrait - 40x30" },
      { code: "LANDSCAPE_16X12", value: "Landscape - 16x12", label: "Landscape - 16x12" },
      { code: "LANDSCAPE_20X15", value: "Landscape - 20x15", label: "Landscape - 20x15" },
      { code: "LANDSCAPE_20X20", value: "Landscape - 20x20", label: "Landscape - 20x20" },
      { code: "LANDSCAPE_24X18", value: "Landscape - 24x18", label: "Landscape - 24x18" },
      { code: "LANDSCAPE_24X24", value: "Landscape - 24x24", label: "Landscape - 24x24" },
      { code: "LANDSCAPE_24X30", value: "Landscape - 24x30", label: "Landscape - 24x30" },
      { code: "LANDSCAPE_24X36", value: "Landscape - 24x36", label: "Landscape - 24x36" },
      { code: "LANDSCAPE_30X24", value: "Landscape - 30x24", label: "Landscape - 30x24" },
      { code: "LANDSCAPE_30X30", value: "Landscape - 30x30", label: "Landscape - 30x30" },
      { code: "LANDSCAPE_34X24", value: "Landscape - 34x24", label: "Landscape - 34x24" },
      { code: "LANDSCAPE_40X30", value: "Landscape - 40x30", label: "Landscape - 40x30" },
    ],
  },
  DELIVERABLE_FRAME_SIZE: {
    name: "Deliverable Frame Sizes",
    values: [
      { code: "12X18_INCHES", value: "12x18 Inches", label: "12x18 Inches" },
      { code: "16X20_INCHES", value: "16x20 Inches", label: "16x20 Inches" },
      { code: "20X30_INCHES", value: "20x30 Inches", label: "20x30 Inches" },
    ],
  },
};
const serviceConfigByName = Object.fromEntries(serviceDefinitions.map((name) => [name, {
  quantityMode: "NONE",
  timingMode: "HALF_SESSION", timingModes: ["HALF_SESSION", "FULL_SESSION"],
  timingOptionSetCode: "SERVICE_FULL_HALF_SESSION",
  sizeOptionSetCode: null,
}]));
[
  "Complementary Drone",
  "Al Feature",
].forEach((name) => {
  serviceConfigByName[name] = { quantityMode: "NONE", timingMode: "NONE", timingOptionSetCode: null, sizeOptionSetCode: null };
});
[
  "Spot Editing",
  "Spot Printing",
  "Spot Framing",
].forEach((name) => {
  serviceConfigByName[name] = { quantityMode: "INTEGER", timingMode: "NONE", timingOptionSetCode: null, sizeOptionSetCode: null };
});
[
  "360 Camera Booth",
  "360 Video Booth",
].forEach((name) => {
  serviceConfigByName[name] = { quantityMode: "INTEGER", timingMode: "HALF_SESSION", timingModes: ["HALF_SESSION", "FULL_SESSION"], timingOptionSetCode: "SERVICE_FULL_HALF_SESSION", sizeOptionSetCode: null };
});
[
  "Indoor Photo Only",
  "Indoor Photo Shoot + Reels",
  "Outdoor Photo + Reels",
  "Outdoor Photo Only",
].forEach((name) => {
  serviceConfigByName[name] = { quantityMode: "NONE", timingMode: "HOURS_MINUTES", timingOptionSetCode: null, sizeOptionSetCode: null };
});
serviceConfigByName["Only Post Production"] = { quantityMode: "NONE", timingMode: "NONE", timingOptionSetCode: null, sizeOptionSetCode: null };
serviceConfigByName["AI Memorial Video"] = { quantityMode: "INTEGER", timingMode: "HOURS_MINUTES", timingOptionSetCode: null, sizeOptionSetCode: null };
serviceConfigByName["LED Wall"] = { quantityMode: "NONE", timingMode: "HALF_SESSION", timingModes: ["HALF_SESSION", "FULL_SESSION"], timingOptionSetCode: "SERVICE_FULL_HALF_SESSION", sizeOptionSetCode: "SERVICE_LED_WALL_SIZE" };
serviceConfigByName.TV = { quantityMode: "NONE", timingMode: "HALF_SESSION", timingModes: ["HALF_SESSION", "FULL_SESSION"], timingOptionSetCode: "SERVICE_FULL_HALF_SESSION", sizeOptionSetCode: "SERVICE_TV_SIZE" };
const workflowConfigByServiceName = {
  "Indoor Photo Only": { photoSelection: true, outputs: ["Retouches", "Signature Album (Soft copy)"] },
  "Indoor Photo Shoot + Reels": { photoSelection: true, outputs: ["Retouches", "Reels", "Signature Album (Soft copy)"] },
  "Outdoor Photo + Reels": { photoSelection: true, outputs: ["Retouches", "Signature Album (Soft copy)"] },
  "Outdoor Photo Only": { photoSelection: true, outputs: ["Retouches", "Reels", "Signature Album (Soft copy)"] },
  "Traditional Photo": { photoSelection: true, outputs: ["Bulk Edited Images"] },
  "Traditional Video": { photoSelection: null, outputs: ["Traditional Full Length", "Traditional Highlights"] },
  "Candid Photo": { photoSelection: true, outputs: ["Bulk Edited Images", "Retouches"] },
  "Candid Video": { photoSelection: null, outputs: ["Reels", "Cinematic Teaser", "Cinematic Highlights", "Cinematic Full Length"] },
  Drone: { photoSelection: null, outputs: [] },
  "Al Feature": { photoSelection: true, outputs: [] },
  "Semi Candid Photo": { photoSelection: true, outputs: ["Bulk Edited Images", "Retouches"] },
  "Semi Candid Video": { photoSelection: null, outputs: ["Reels", "Cinematic Teaser", "Cinematic Highlights", "Cinematic Full Length"] },
  "Pre/ Post Wedding Photography": { photoSelection: true, outputs: ["Retouches"] },
  "Pre/ Post Wedding Videography": { photoSelection: null, outputs: ["Reels", "Cinematic Highlights"] },
  "Pre/ Post Wedding Candid Photography": { photoSelection: true, outputs: ["Retouches"] },
  "Pre/ Post Wedding Candid Videography": { photoSelection: null, outputs: ["Reels", "Cinematic Highlights"] },
  "360 Video Camera": { photoSelection: null, outputs: ["Full length"] },
  "Corporate Video": { photoSelection: null, outputs: [] },
  "Corporate Photo": { photoSelection: true, outputs: [] },
  Headshots: { photoSelection: true, outputs: ["Retouches"] },
  "Product Photography": { photoSelection: true, outputs: ["Retouches"] },
  "Product Videography": { photoSelection: null, outputs: [] },
  "Semi Candid Photo + reel": { photoSelection: true, outputs: ["Retouches", "Reels", "Signature Album (Soft copy)"] },
  "Candid Photo + Reels": { photoSelection: true, outputs: ["Retouches", "Reels", "Signature Album (Soft copy)"] },
  "Comp Drone": { photoSelection: null, outputs: [] },
  "Only Post Production": { photoSelection: null, outputs: [] },
};
const deliverableDefinitions = [
  "Print only",
  "Unlimited Soft Copies",
  "Reels / Shots",
  "Reels",
  "Save The Date",
  "Signature Album (Soft copy)",
  "Slide show",
  "Traditional Full Length",
  "Traditional Highlights",
  "Wedding Documentary",
  "Retouches",
  "Acrylic Printing",
  "AI Feature",
  "AI Retouch",
  "Album Selection",
  "Album Designing",
  "Album Printing",
  "Bloopers",
  "Calender Designing",
  "Cinematic Full Length",
  "Cinematic Highlights",
  "Cinematic Teaser",
  "Photo Selection",
  "Count Down Poster",
  "Culling Highlights Editing",
  "Custom Gifts",
  "Documentary",
  "E-Invitation",
  "Raw - File IN",
  "File IN",
  "QR Genration",
  "QR Publishing",
  "Full length",
  "Final Files Out",
  "Frames Printing",
  "Frames Retouching/ Designing",
  "Photo Culling",
  "Bulk Edited Images",
];
const deliverableConfigByName = Object.fromEntries(deliverableDefinitions.map((name) => [name, {
  photoCountEnabled: true,
  sizeOptionSetCode: null,
}]));
[
  "Reels / Shots",
  "Unlimited Soft Copies",
  "Raw - File IN",
  "Reels",
  "QR Genration",
  "QR Publishing",
  "Full length",
  "Save The Date",
  "Traditional Full Length",
  "Traditional Highlights",
  "Wedding Documentary",
  "AI Feature",
  "Bloopers",
  "Cinematic Full Length",
  "Cinematic Highlights",
  "Cinematic Teaser",
  "Documentary",
  "File IN",
  "Final Files Out",
].forEach((name) => {
  deliverableConfigByName[name] = { photoCountEnabled: false, sizeOptionSetCode: null };
});
deliverableConfigByName["Print only"] = { photoCountEnabled: true, sizeOptionSetCode: "DELIVERABLE_PRINT_SIZE" };
deliverableConfigByName["Album Designing"] = { photoCountEnabled: true, sizeOptionSetCode: "DELIVERABLE_ALBUM_SIZE" };
deliverableConfigByName["Album Printing"] = { photoCountEnabled: true, sizeOptionSetCode: "DELIVERABLE_ALBUM_SIZE" };
deliverableConfigByName["Frames Printing"] = { photoCountEnabled: true, sizeOptionSetCode: "DELIVERABLE_FRAME_SIZE" };
deliverableConfigByName["Frames Retouching/ Designing"] = { photoCountEnabled: true, sizeOptionSetCode: "DELIVERABLE_FRAME_SIZE" };

function codeFor(prefix, name) {
  return `${prefix}_${name.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "")}`;
}

async function seedDeliverableDefinitions(optionSetByCode) {
  for (const [index, name] of deliverableDefinitions.entries()) {
    const code = codeFor("DELIVERABLE", name);
    const config = deliverableConfigByName[name] || { photoCountEnabled: true, sizeOptionSetCode: null };
    const sizeOptionSetId = config.sizeOptionSetCode ? optionSetByCode[config.sizeOptionSetCode]?.id || null : null;
    const existing = await prisma.projectDeliverableDefinition.findUnique({ where: { code } });
    if (!existing) {
      await prisma.projectDeliverableDefinition.create({
        data: {
          code,
          name,
          photoCountEnabled: deliverableAnswerText(config.photoCountEnabled),
          sizeOptionSetId,
          sortOrder: index + 1,
        },
      });
      continue;
    }
    const update = {};
    if (existing.photoCountEnabled == null) update.photoCountEnabled = deliverableAnswerText(config.photoCountEnabled);
    if (existing.sizeOptionSetId == null && sizeOptionSetId) update.sizeOptionSetId = sizeOptionSetId;
    if (Object.keys(update).length) await prisma.projectDeliverableDefinition.update({ where: { id: existing.id }, data: update });
  }
}

async function seedProjectOptionSets() {
  const result = {};
  for (const [code, optionSet] of Object.entries(optionSets)) {
    const savedSet = await prisma.projectOptionSet.upsert({
      where: { code },
      update: { name: optionSet.name, isActive: true },
      create: { code, name: optionSet.name },
    });
    result[code] = savedSet;
    for (const [index, value] of optionSet.values.entries()) {
      await prisma.projectOptionSetValue.upsert({
        where: { optionSetId_code: { optionSetId: savedSet.id, code: value.code } },
        update: { value: value.value, label: value.label, description: value.description || null, isActive: true, sortOrder: index + 1 },
        create: { optionSetId: savedSet.id, code: value.code, value: value.value, label: value.label, description: value.description || null, sortOrder: index + 1 },
      });
    }
    if (optionSet.inactiveCodes?.length) {
      await prisma.projectOptionSetValue.updateMany({
        where: { optionSetId: savedSet.id, code: { in: optionSet.inactiveCodes } },
        data: { isActive: false },
      });
    }
  }
  return result;
}

/*
 * ── Why neither of these writes `remarksEnabled` ──────────────────────────────────────────────
 *
 * It used to be a Yes/No switch deciding whether a project's service or deliverable line carried a
 * remarks box at all, and the seed set it to `true` on every row. It is a **note** now - free text
 * the studio types about the definition - and it decides nothing: the line always has a box. See
 * the column's own comment in `schema.prisma` and migrations `20260918100000` / `20260918130000`.
 *
 * So there is nothing for a seed to put there. A seed inventing note text would be writing the
 * studio's words for it, and `true` is not a note - which is exactly what the pipeline said:
 * *"Argument `remarksEnabled`: Invalid value provided. Expected String or Null, provided Boolean."*
 * The column is nullable, so leaving it out writes NULL, which is "no note yet" and correct.
 *
 * The backfill that went with it is gone for the same reason: `if (existing.remarksEnabled == null)`
 * used to mean "this row predates the switch, give it the default", and now means "this row has no
 * note" - on which the right action is to leave it alone rather than to write one.
 */
async function seedServiceDefinitions(optionSetByCode) {
  for (const [index, name] of serviceDefinitions.entries()) {
    const code = codeFor("SERVICE", name);
    const config = serviceConfigByName[name] || { quantityMode: "NONE", timingMode: "NONE", timingOptionSetCode: null, sizeOptionSetCode: null };
    const timingOptionSetId = config.timingOptionSetCode ? optionSetByCode[config.timingOptionSetCode]?.id || null : null;
    const sizeOptionSetId = config.sizeOptionSetCode ? optionSetByCode[config.sizeOptionSetCode]?.id || null : null;
    const existing = await prisma.projectServiceDefinition.findUnique({ where: { code } });
    if (!existing) {
      await prisma.projectServiceDefinition.create({
        data: {
          code,
          name,
          quantityMode: config.quantityMode,
          timingMode: config.timingMode,
          // Every timing this service may be booked with. Null for the services offered one way,
          // which is what "whatever `timingMode` says" already means to the readers.
          timingModes: config.timingModes || null,
          timingOptionSetId,
          sizeOptionSetId,
          sortOrder: index + 1,
        },
      });
      continue;
    }
    const update = {};
    if (existing.quantityMode == null) update.quantityMode = config.quantityMode;
    if (existing.timingMode == null) update.timingMode = config.timingMode;
    if (existing.timingModes == null && config.timingModes) update.timingModes = config.timingModes;
    if (existing.timingOptionSetId == null && timingOptionSetId) update.timingOptionSetId = timingOptionSetId;
    if (existing.sizeOptionSetId == null && sizeOptionSetId) update.sizeOptionSetId = sizeOptionSetId;
    if (Object.keys(update).length) await prisma.projectServiceDefinition.update({ where: { id: existing.id }, data: update });
  }
}

async function seedPostProductionWorkflowDefinitions() {
  for (const [name, config] of Object.entries(workflowConfigByServiceName)) {
    const service = await prisma.projectServiceDefinition.findUnique({ where: { code: codeFor("SERVICE", name) }, select: { id: true } });
    if (!service) continue;
    const uniqueOutputs = [];
    for (const output of config.outputs || []) {
      if (output && !uniqueOutputs.includes(output)) uniqueOutputs.push(output);
    }
    await prisma.projectPostProductionWorkflowDefinition.upsert({
      where: { serviceDefinitionId: service.id },
      update: {
        rawFileIn: config.rawFileIn !== false,
        photoSelection: config.photoSelection,
        output01: uniqueOutputs[0] || null,
        output02: uniqueOutputs[1] || null,
        output03: uniqueOutputs[2] || null,
        output04: uniqueOutputs[3] || null,
        finalFilesOut: config.finalFilesOut !== false,
        isActive: true,
      },
      create: {
        serviceDefinitionId: service.id,
        rawFileIn: config.rawFileIn !== false,
        photoSelection: config.photoSelection,
        output01: uniqueOutputs[0] || null,
        output02: uniqueOutputs[1] || null,
        output03: uniqueOutputs[2] || null,
        output04: uniqueOutputs[3] || null,
        finalFilesOut: config.finalFilesOut !== false,
      },
    });
  }
}

async function main() {
  const passwordHash = await bcrypt.hash(password, 10);
  // Kept, because the check below reads it back. Unassigned, the seed threw "user is not defined"
  // at that line - after the Super Admin and the asset categories, but before any of the project
  // master data, which is why a seeded database still had no services or deliverables.
  /*
   * ── The password is set when the account is created, and never again ────────────────────────
   *
   * `update` used to carry `password: passwordHash` alongside the rest, which meant every run of
   * this seed put the Super Admin back on the password written at the top of this file - a password
   * that is in the git repository and readable by everybody who has ever cloned it.
   *
   * That is not a local inconvenience. Reseeding is part of the documented workflow on the VPS:
   * adding a permission to `seeds/iam-roles-permissions.js` and reseeding is how a new module or
   * feature becomes grantable at all (see Rule 4 in CLAUDE.md). So the studio's own instructions
   * quietly reset the Super Admin's password to a published value, and nothing said so.
   *
   * The other columns stay in `update`, because those really are the seed's to assert: the account
   * must be a SUPER_ADMIN, it must be active, and it must not be pinned to a branch. What it must
   * *not* do is decide the credential after somebody has chosen their own.
   *
   * Changing it on a running installation is a database change - set the hash on the `user`
   * row - and this seed will leave it alone afterwards.
   */
  const user = await prisma.user.upsert({
    where: { email },
    update: {
      name: "admin",
      username,
      role: "SUPER_ADMIN",
      status: "ACTIVE",
      branchId: null // Super admin has no branch restriction
    },
    create: {
      name: "admin",
      email,
      username,
      password: passwordHash,
      role: "SUPER_ADMIN",
      status: "ACTIVE",
      mustChangePassword: false,
      branchId: null // Super admin has no branch restriction
    },
  });
  await seedCompanyBranches();
  await seedAssetCategories(prisma);
  // Where an application came from, for Settings → Fields → Interview → Sources. The migration
  // beside it writes the same rows, because this file cannot be run on the VPS.
  await seedInterviewSources(prisma);
  // The positions the register offers beyond the designation list - "General", for an application
  // off an ad that names no role. Same arrangement: a migration writes the same rows.
  await seedInterviewPositions(prisma);
  console.log("Super Admin, Asset Management categories and interview sources and positions are ready.");

  // Seed IAM system (permissions and roles)
  console.log("Seeding IAM system...");
  await require("./seeds/iam-roles-permissions.js");
  console.log("IAM system (permissions and roles) seeded.");

  /*
   * The stored credential is a hash, not a password sitting in a column.
   *
   * It used to assert that the hash matched the password at the top of this file, which stopped
   * being true the moment the seed stopped overwriting an existing one - a studio that had changed
   * its Super Admin password would have had the seed throw at them, and the natural way to make that
   * go away is to put the overwrite back. So the check asserts the property that actually matters
   * and is true either way: whatever is in that column, it is a bcrypt hash and it is not the plain
   * text. A freshly created account is checked against the seed's own password as well, because
   * there it is knowable.
   */
  const looksHashed = typeof user.password === "string" && /^\$2[aby]\$\d{2}\$/.test(user.password);
  if (!looksHashed) throw new Error("Seeded password verification failed: the stored credential is not a hash");
  if (user.createdAt.getTime() === user.updatedAt.getTime() && !await bcrypt.compare(password, user.password)) {
    throw new Error("Seeded password verification failed: a newly created Super Admin does not match the seeded password");
  }
  const optionSetByCode = await seedProjectOptionSets();
  await seedServiceDefinitions(optionSetByCode);
  await seedPostProductionWorkflowDefinitions();
  await seedDeliverableDefinitions(optionSetByCode);
  console.log(`Local Super Admin is ready for ${email} (username: ${username}).`);
  console.log("Project service and deliverable master data is ready.");
  console.log("\nAll seeds completed successfully!");
}

main()
  .catch((error) => { console.error("Seed failed:", error.message); process.exitCode = 1; })
  .finally(async () => prisma.$disconnect());
