// One-off backfill: gives every gallery publication that predates the short-code column its
// public code, so links like gallery.dontblinkstudioz.com/<code> resolve for existing galleries
// without waiting for the studio to open each project once.
//
// Safe to run any number of times — a row that already has a code is never touched, so no URL a
// client was sent can change. Nothing else on the row is written. Run it on the VPS after
// `prisma migrate deploy`:
//
//   node scripts/backfillGalleryShortCodes.js
require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const { generateShortCode } = require("../src/modules/image-selection/publication/service");

const prisma = new PrismaClient();

// Mirrors ensureShortCode in the publication service: roll a code, let the UNIQUE constraint
// referee the race, roll again on a collision.
async function assignCode(projectId, attempts = 5) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try { return (await prisma.imageSelectionGalleryPublication.update({ where: { projectId }, data: { shortCode: generateShortCode() } })).shortCode; }
    catch (error) { if (error?.code !== "P2002") throw error; }
  }
  throw new Error(`Unable to allocate a short code for project ${projectId} after ${attempts} attempts.`);
}

async function main() {
  const pending = await prisma.imageSelectionGalleryPublication.findMany({ where: { shortCode: null }, select: { projectId: true } });
  if (!pending.length) { console.log("Every gallery publication already has a short code."); return; }
  for (const { projectId } of pending) console.log(`  ${projectId} → ${await assignCode(projectId)}`);
  console.log(`Assigned short codes to ${pending.length} gallery publication(s).`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
