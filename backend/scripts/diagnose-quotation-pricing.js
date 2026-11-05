/**
 * READ-ONLY. Explains why the Quotation Generator says a service is "Not priced in Settings".
 *
 *   node scripts/diagnose-quotation-pricing.js                 every active service + the latest 10 quotations
 *   node scripts/diagnose-quotation-pricing.js DBS-QO-...-01   that quotation's lines only
 *
 * For every active service it prints its pricing rows and its Session Timing list, then runs the
 * Generator's own lookup (`frontend/src/lib/servicePricing.mjs`) for each Studio / Outdoor × Half /
 * Full shoot. For every service line of the quotations read it says, field by field, what the
 * lookup saw: the shoot's type and sessions, the line's Session Timing and the code it resolves to,
 * the size, and the result. Nothing is written - only SELECTs are run.
 */
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const prisma = require("../src/config/db");

const db = prisma.prisma || prisma;
const STUDIO = "Studio / In-House";
const OUTDOOR = "Outdoor / On-Location";

async function main() {
  const quotationId = process.argv[2] || null;
  const lib = await import(pathToFileURL(path.join(__dirname, "../../frontend/src/lib/servicePricing.mjs")).href).catch((error) => {
    console.log(`(The frontend pricing library could not be loaded: ${error.message}. Only the raw data is printed.)`);
    return null;
  });

  const services = await db.projectServiceDefinition.findMany({
    where: { isActive: true },
    include: { timingOptionSet: { include: { values: true } } },
    orderBy: { name: "asc" },
  });
  console.log(`\n=== ${services.length} active services ===`);
  for (const service of services) {
    const pricing = Array.isArray(service.pricing) ? service.pricing : service.pricing;
    console.log(`\n# ${service.name}  (id ${service.id})`);
    console.log(`  sizeEnabled=${service.sizeEnabled}  flat price=${service.price ?? "none"}  shootTypes=${JSON.stringify(service.shootTypes)}  timingModes=${JSON.stringify(service.timingModes)}`);
    console.log(`  pricing is ${Array.isArray(service.pricing) ? `an array of ${service.pricing.length}` : `NOT an array (${typeof service.pricing}): ${JSON.stringify(service.pricing)?.slice(0, 200)}`}`);
    for (const row of Array.isArray(pricing) ? pricing : []) console.log(`    row: shootType=${JSON.stringify(row?.shootType)} timingMode=${JSON.stringify(row?.timingMode)} hours=${JSON.stringify(row?.hours)} size=${JSON.stringify(row?.size)} price=${JSON.stringify(row?.price)}`);
    const set = service.timingOptionSet;
    console.log(`  Session Timing list: ${set ? `${set.code} "${set.name}"` : "NONE (timingOptionSetId " + JSON.stringify(service.timingOptionSetId) + ")"}`);
    for (const value of set?.values || []) console.log(`    value: id=${value.id} code=${JSON.stringify(value.code)} label=${JSON.stringify(value.label)} active=${value.isActive}`);
    if (!lib) continue;
    for (const type of [STUDIO, OUTDOOR]) {
      for (const session of ["Half Session", "Full Session"]) {
        const shoot = { shootTypes: [type], sessionTimings: [session], sessionDurationHours: session === "Full Session" ? 12 : 5, sessionDurationMinutes: 0 };
        const byShoot = lib.servicePriceForShoot(service, shoot, {});
        const option = (set?.values || []).find((value) => value.label === session || value.code === lib.TIMING_MODE_BY_LABEL[session]);
        const line = lib.servicePricingRowForLine(service, shoot, { sessionOptionId: option?.id || "" });
        console.log(`  lookup ${type} · ${session}: by shoot=${byShoot ?? "NOT FOUND"}  by line session (${option ? `${option.code}` : "no matching option"})=${line?.price ?? "NOT FOUND"}`);
      }
    }
  }

  const quotations = await db.salesQuotation.findMany({
    where: quotationId ? { quotationId } : {},
    orderBy: { createdAt: "desc" },
    take: quotationId ? 1 : 10,
    select: { quotationId: true, createdAt: true, payload: true },
  });
  console.log(`\n=== ${quotations.length} quotation(s) ===`);
  const byId = new Map(services.map((service) => [service.id, service]));
  for (const quotation of quotations) {
    const payload = quotation.payload || {};
    const shoots = new Map((payload.shoots || []).map((shoot) => [shoot.id, shoot]));
    console.log(`\n# ${quotation.quotationId}  ${quotation.createdAt.toISOString()}`);
    for (const row of payload.services || []) {
      const shoot = shoots.get(row.shootId);
      const live = byId.get(row.serviceDefinitionId);
      const frozen = row.serviceDefinition || null;
      console.log(`  line "${row.serviceName}" unitPrice=${JSON.stringify(row.unitPrice)} packageId=${row.packageId || "-"}`);
      console.log(`    shoot ${shoot?.shootId || row.shootId}: shootTypes=${JSON.stringify(shoot?.shootTypes)} shootType=${JSON.stringify(shoot?.shootType)} sessionTimings=${JSON.stringify(shoot?.sessionTimings)} sessionTiming=${JSON.stringify(shoot?.sessionTiming)} hours=${shoot?.sessionDurationHours}:${shoot?.sessionDurationMinutes}`);
      console.log(`    line sessionOptionId=${JSON.stringify(row.sessionOptionId)} size=${JSON.stringify(row.size)} sizeOptionValueId=${JSON.stringify(row.sizeOptionValueId)}`);
      console.log(`    definition carried on the line: ${frozen ? `pricing ${Array.isArray(frozen.pricing) ? frozen.pricing.length + " rows" : "NOT an array"}, timingOptionSet ${frozen.timingOptionSet ? frozen.timingOptionSet.values?.length + " values" : "NONE"}` : "NONE"}; live definition: ${live ? "found" : "NOT FOUND (inactive or deleted)"}`);
      if (lib && shoot) {
        for (const [label, definition] of [["carried", frozen], ["live", live]]) {
          if (!definition) continue;
          const mode = lib.lineSessionTimingMode(definition, row);
          console.log(`    ${label}: line session resolves to ${JSON.stringify(mode)}; by line=${lib.servicePricingRowForLine(definition, shoot, row)?.price ?? "NOT FOUND"}; by shoot=${lib.servicePriceForShoot(definition, shoot, row) ?? "NOT FOUND"}`);
        }
      }
    }
  }
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => db.$disconnect());
