/*
 * Fills the Services table with demonstration services, each priced per booking, so Settings →
 * Project → Services can be looked at with something in it.
 *
 * The studio's own services are retired (migration `20260918110000`) and its new ones are typed by
 * hand, which leaves the screen reading "No services configured." - and an empty screen is the one
 * state in which none of the columns, the chevron, the folded pricing lines or the price range can
 * be judged at all.
 *
 *   node scripts/seedDemoServices.js            # write them
 *   node scripts/seedDemoServices.js --remove   # take every one of them back out
 *
 * ── This is demonstration data, and it is removed by code prefix ──────────────────────────────
 *
 * Every service it writes is named "Demo …", so `codeFor` gives it a code beginning
 * `SERVICE_DEMO_`, and `--remove` deletes exactly that prefix. The prefix is the point: a removal
 * matching on names, or on a range of ids, eventually matches something somebody typed - the lesson
 * `seedLeadsForPerf.js` records at length. `codeFor` is imported rather than copied, so the codes
 * this writes and the codes the application writes cannot drift apart.
 *
 * Each service carries the pricing lines the table folds under its chevron: a shoot type, a timing
 * and what that booking costs. The head row reads its shoot types off them and prices itself as the
 * range they cover, which is the arrangement that cannot be seen at all without several lines on
 * one service. Sessions point at the studio's own Service Session Timing set, the way a service
 * saved through the dialog does, so a shoot booked against one is offered Half and Full.
 *
 * Writing is idempotent - each service is matched by its code and updated - so running it twice
 * leaves forty services rather than eighty.
 *
 * Never run this against production. It refuses to, unless it is told twice.
 */
require("dotenv").config();

const prisma = require("../src/config/db");
const { codeFor } = require("../src/modules/sales/projects/controller");

const CODE_PREFIX = "SERVICE_DEMO_";
const TIMING_SET_CODE = "SERVICE_FULL_HALF_SESSION";

/*
 * The forty, and how each is sold. `sessions` prices a service by the studio's half and full
 * session; `hours` prices it by the length of the booking; `flat` is the one figure a service that
 * is neither is sold at. `outdoor` adds the same lines again for an outdoor shoot, at its own
 * figure, which is what gives a head row two shoot types to read.
 */
const DEMO = [
  { name: "Demo Indoor Photo Only", sessions: [4000, 7000], outdoor: 1.15 },
  { name: "Demo Outdoor Photo Only", sessions: [4500, 8000] },
  { name: "Demo Traditional Photo", sessions: [5000, 9000], outdoor: 1.2 },
  { name: "Demo Traditional Video", sessions: [6000, 11000], outdoor: 1.2 },
  { name: "Demo Candid Photo", sessions: [9000, 16000], outdoor: 1.25 },
  { name: "Demo Candid Video", sessions: [10000, 18000], outdoor: 1.25 },
  { name: "Demo Candid Photo + Reels", sessions: [12000, 21000] },
  { name: "Demo Semi Candid Photo", sessions: [7000, 12500] },
  { name: "Demo Semi Candid Video", sessions: [7500, 13500] },
  { name: "Demo Semi Candid Photo + Reel", sessions: [8500, 15000] },
  { name: "Demo Drone", hours: [[2, 6000], [4, 10000], [8, 17000]] },
  { name: "Demo Comp Drone", flat: 0, remarks: false },
  { name: "Demo Assistant", hours: [[4, 1500], [8, 2500]] },
  { name: "Demo Crane", hours: [[4, 9000], [8, 15000]] },
  { name: "Demo Mixing Unit", flat: 4500 },
  { name: "Demo LED Wall", sized: ["8x6", "12x8", "16x10"], prices: [12000, 18000, 26000] },
  { name: "Demo TV", sized: ["43 inch", "55 inch", "65 inch"], prices: [3000, 4500, 6500] },
  { name: "Demo 360 Camera Booth", sessions: [7000, 12000] },
  { name: "Demo 360 Video Booth", sessions: [7500, 13000] },
  { name: "Demo 360 Video Camera", sessions: [8000, 14000] },
  { name: "Demo Indoor Photo Shoot + Reels", sessions: [6500, 11500] },
  { name: "Demo Outdoor Photo + Reels", sessions: [7000, 12500] },
  { name: "Demo Pre Wedding Photography", sessions: [14000, 24000], outdoor: 1.1 },
  { name: "Demo Pre Wedding Videography", sessions: [15000, 26000], outdoor: 1.1 },
  { name: "Demo Post Wedding Photography", sessions: [13000, 22000] },
  { name: "Demo Post Wedding Videography", sessions: [14000, 24000] },
  { name: "Demo Corporate Photo", sessions: [11000, 19000] },
  { name: "Demo Corporate Video", sessions: [13000, 23000] },
  { name: "Demo Headshots", hours: [[2, 4500], [4, 7500]] },
  { name: "Demo Product Photography", hours: [[4, 8000], [8, 14000]] },
  { name: "Demo Product Videography", hours: [[4, 9500], [8, 16500]] },
  { name: "Demo Product Photo & Video", hours: [[8, 24000]] },
  { name: "Demo Youtube Live", hours: [[4, 12000], [8, 20000]] },
  { name: "Demo Spot Editing", flat: 5500 },
  { name: "Demo Spot Printing", sized: ["4x6", "6x8"], prices: [40, 90] },
  { name: "Demo Spot Framing", sized: ["8x12", "12x18"], prices: [700, 1400] },
  { name: "Demo Makeup", flat: 8000 },
  { name: "Demo Makeup & Hairdo", flat: 12000 },
  { name: "Demo AI Memorial Video", flat: 18000 },
  // Priced nowhere: a real state, and the one that shows a head row with no range to draw.
  { name: "Demo Only Post Production", remarks: true },
];

const SESSION_LABEL = { HALF_SESSION: "4-5 Hours (Half)", FULL_SESSION: "10-12 Hours (Full)" };

/** The pricing lines one service is sold as - the rows the table folds under its chevron. */
function pricingFor(entry) {
  const lines = [];
  const money = (value, factor) => Math.round(value * (factor || 1));
  if (entry.sessions) {
    const [half, full] = entry.sessions;
    for (const [shootType, factor] of [["STUDIO", 1], ...(entry.outdoor ? [["OUTDOOR", entry.outdoor]] : [])]) {
      lines.push({ shootType, timingMode: "HALF_SESSION", duration: SESSION_LABEL.HALF_SESSION, price: money(half, factor) });
      lines.push({ shootType, timingMode: "FULL_SESSION", duration: SESSION_LABEL.FULL_SESSION, price: money(full, factor) });
    }
  }
  for (const [hours, price] of entry.hours || []) {
    lines.push({ shootType: "STUDIO", timingMode: "HOURS_MINUTES", hours, price });
  }
  (entry.sized || []).forEach((size, index) => {
    lines.push({ shootType: "STUDIO", timingMode: "FULL_SESSION", duration: SESSION_LABEL.FULL_SESSION, size, price: entry.prices[index] });
  });
  if (entry.flat !== undefined) {
    lines.push({ shootType: "STUDIO", timingMode: "FULL_SESSION", duration: SESSION_LABEL.FULL_SESSION, price: entry.flat });
  }
  return lines;
}

/** What the dialog would have sent, and what the controller would have stored from it. */
function definitionDataFor(entry, sortOrder, timingOptionSetId) {
  const pricing = pricingFor(entry);
  const timingModes = [...new Set(pricing.map((line) => line.timingMode))];
  const shootTypes = [...new Set(pricing.map((line) => line.shootType))];
  const prices = pricing.map((line) => line.price).filter((value) => Number.isFinite(value));
  const sessioned = timingModes.some((mode) => mode === "HALF_SESSION" || mode === "FULL_SESSION");
  return {
    code: codeFor("SERVICE", entry.name),
    name: entry.name,
    quantityMode: "INTEGER",
    defaultQuantity: 1,
    // The flat figure a line falls back to, as the dialog's own Price box would have set it.
    price: prices.length ? Math.min(...prices) : null,
    pricing: pricing.length ? pricing : null,
    timingModes: timingModes.length ? timingModes : ["NONE"],
    timingMode: timingModes[0] || "NONE",
    shootTypes: shootTypes.length ? shootTypes : null,
    // A service booked by the session is booked from the studio's own set, as one saved through
    // the dialog is; one sold only by the hour or as a single figure names none.
    timingOptionSetId: sessioned ? timingOptionSetId : null,
    sizeEnabled: Boolean(entry.sized),
    remarksEnabled: entry.remarks !== false,
    isActive: true,
    sortOrder,
  };
}

async function write() {
  const timingSet = await prisma.projectOptionSet.findFirst({ where: { code: TIMING_SET_CODE }, select: { id: true } });
  if (!timingSet) console.log(`  (no "${TIMING_SET_CODE}" option set — session services will name none)\n`);
  let lines = 0;
  for (const [index, entry] of DEMO.entries()) {
    const data = definitionDataFor(entry, index + 1, timingSet?.id || null);
    const existing = await prisma.projectServiceDefinition.findUnique({ where: { code: data.code }, select: { id: true } });
    if (existing) await prisma.projectServiceDefinition.update({ where: { id: existing.id }, data });
    else await prisma.projectServiceDefinition.create({ data });
    const count = (data.pricing || []).length;
    lines += count;
    console.log(`  · ${entry.name} — ${count} pricing line${count === 1 ? "" : "s"}`);
  }
  console.log(`\n${DEMO.length} demo services, ${lines} pricing lines.`);
  console.log("Take them out again with:  node scripts/seedDemoServices.js --remove\n");
}

async function remove() {
  const rows = await prisma.projectServiceDefinition.findMany({ where: { code: { startsWith: CODE_PREFIX } }, select: { id: true, name: true } });
  if (!rows.length) {
    console.log("\nNothing to remove — no service carries the demo code prefix.\n");
    return;
  }
  rows.forEach((row) => console.log(`  · ${row.name}`));
  // Their post-production workflow definitions cascade with them, as they do for any service.
  const { count } = await prisma.projectServiceDefinition.deleteMany({ where: { code: { startsWith: CODE_PREFIX } } });
  console.log(`\n${count} demo service(s) removed.\n`);
}

async function main() {
  const removing = process.argv.includes("--remove");
  if (process.env.NODE_ENV === "production" && !process.argv.includes("--force")) {
    console.error("\nRefusing to run against NODE_ENV=production. Pass --force if you really mean it.\n");
    return 1;
  }
  console.log(removing ? "\nRemoving demo services\n" : "\nWriting demo services\n");
  await (removing ? remove() : write());
  return 0;
}

main()
  .then((code) => prisma.$disconnect().then(() => process.exit(code)))
  .catch(async (error) => {
    console.error("Demo services could not be written:", error);
    await prisma.$disconnect();
    process.exit(1);
  });
