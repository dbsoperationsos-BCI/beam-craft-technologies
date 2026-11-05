/**
 * Who is going to a shoot, as every screen that lists them reads it.
 *
 * The Shoot Board's cards and the calendar's shoot window both say the same thing - the Production
 * Coordinator, the Production Team, and each service with its person and assistants - so the shape
 * is written once here rather than built twice and left to drift. A vendor reads as "EXT-name (business, city)"; a
 * leaver's name is the text written on the row, since there is nobody linked to read it from.
 *
 * `handedFrom` is the handover note each screen adds where somebody's work has been passed on
 * (`services/handoverNames.js`); a caller with none passes nothing.
 */

const { VENDOR_LABEL_SELECT, vendorLabel } = require("./vendorLabel");

/** What the shoot's production record must select for this to be read. */
const PRODUCTION_TEAM_SELECT = (nameOnly) => ({
  productionCoordinatorEmployee: nameOnly,
  productionCoordinatorName: true,
  teamMembers: { select: { employeeName: true, employee: nameOnly, vendor: { select: VENDOR_LABEL_SELECT } }, orderBy: { createdAt: "asc" } },
  serviceCrew: {
    select: { id: true, serviceDefinitionId: true, role: true, serviceDefinition: { select: { name: true } }, employee: nameOnly, vendor: { select: VENDOR_LABEL_SELECT } },
    orderBy: [{ serviceDefinitionId: "asc" }, { role: "asc" }],
  },
});

/** One person's name: the linked employee, a vendor as `vendorLabel` names one, or the text left on the row. */
const personName = (row) => row?.employee?.employeeName || vendorLabel(row?.vendor) || row?.employeeName || null;

/** `[{ service, person, assistants }]`, one per service, in the order the crew was saved. */
function crewOf(rows = [], handedFrom = null, decorate = (name) => name) {
  const byService = new Map();
  for (const row of rows) {
    const name = decorate(personName(row), handedFrom?.get(row.id));
    if (!name) continue;
    const key = row.serviceDefinitionId;
    if (!byService.has(key)) byService.set(key, { service: row.serviceDefinition?.name || "Service", person: null, assistants: [] });
    const entry = byService.get(key);
    if (row.role === "LEAD") entry.person = name;
    else entry.assistants.push(name);
  }
  return [...byService.values()];
}

/** The three lines a shoot's team reads as: `{ coordinator, team, crew }`. */
const productionTeam = (production, handed = null, decorate = (name) => name) => ({
  coordinator: decorate(production?.productionCoordinatorEmployee?.employeeName || production?.productionCoordinatorName || null, handed?.coordinator),
  team: (production?.teamMembers || []).map((row) => personName(row)).filter(Boolean),
  crew: crewOf(production?.serviceCrew || [], handed?.crew, decorate),
});

module.exports = { PRODUCTION_TEAM_SELECT, personName, crewOf, productionTeam };
