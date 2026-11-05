/**
 * The brand a quotation is raised under, and the arithmetic that depends on it.
 *
 * Three brands - Dum Dum, Qua Qua, Corp - and one Quotation Generator, one register, one PDF. The
 * brand decides *what is offered* (services, deliverables, packages, terms, event types, PDF
 * wording); nothing else changes shape. These helpers are the rules the generator and the register
 * lean on, kept free of React so `node --test` can hold them.
 *
 * The vertical and the brand are one fact under two names. `payload.vertical` ("Dum Dum") is what
 * every quotation has always stored and what the identifier counter and the quotation name read;
 * `quotationBrand` ("DUM_DUM") is the column the register filters on. `brandCodeForVertical` and
 * `verticalForBrand` go between them, so no screen has to know both spellings.
 */

import { deliverableAnswerOn } from "./deliverableAnswers.mjs";

export const QUOTATION_BRANDS = [
  { code: "DUM_DUM", label: "Dum Dum", vertical: "Dum Dum", badge: "DUM DUM" },
  { code: "QUA_QUA", label: "Qua Qua", vertical: "Qua Qua", badge: "QUA QUA" },
  { code: "CORP", label: "Corp", vertical: "Corp", badge: "CORP" },
];

export const DEFAULT_QUOTATION_BRAND = "DUM_DUM";

const fold = (value) => String(value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

const ALIASES = {
  DUM_DUM: ["dumdum", "dd", "wed", "wedding"],
  QUA_QUA: ["quaqua", "qq", "ququa"],
  CORP: ["corp", "corporate", "corporation"],
};

/** The brand code for a brand code, a vertical name or any spelling the CRM has held; null for none. */
export function brandCodeForVertical(value) {
  const key = fold(value);
  if (!key) return null;
  const found = QUOTATION_BRANDS.find((brand) => fold(brand.code) === key || fold(brand.label) === key || ALIASES[brand.code].includes(key));
  return found ? found.code : null;
}

/** The vertical spelling the payload stores for a brand code, or "" for an unknown code. */
export function verticalForBrand(code) {
  return QUOTATION_BRANDS.find((brand) => brand.code === code)?.vertical || "";
}

/** "DUM DUM", the way the register's badge prints it. Unknown codes print as themselves. */
export function brandBadgeLabel(code) {
  const resolved = brandCodeForVertical(code);
  return QUOTATION_BRANDS.find((brand) => brand.code === resolved)?.badge || String(code || "").replace(/_/g, " ").toUpperCase();
}

export function brandLabel(code) {
  const resolved = brandCodeForVertical(code);
  return QUOTATION_BRANDS.find((brand) => brand.code === resolved)?.label || String(code || "");
}

/** The brand of a register row: its column, or its payload's vertical for a row from before the column. */
export function brandOfQuotation(quotation) {
  return brandCodeForVertical(quotation?.quotationBrand) || brandCodeForVertical(quotation?.payload?.vertical) || brandCodeForVertical(quotation?.vertical) || DEFAULT_QUOTATION_BRAND;
}

/*
 * ── Pricing ─────────────────────────────────────────────────────────────────────────────────────
 *
 * A line is priced at the `unitPrice` stamped on it when it was added - the brand's default for
 * that service at that moment - and, for a row from before brands existed or one added off the
 * project catalogue, at the rates the quotation was raised with: the per-definition price where
 * the studio set one, the flat service or deliverable rate otherwise. The order matters: a stamped
 * price is a fact about this line, and re-reading the rates would reprice it against today.
 */
const finite = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

export function serviceUnitPrice(row, rates = {}) {
  const stamped = finite(row?.unitPrice);
  if (stamped !== null) return stamped;
  const custom = rates.servicePricing && row?.serviceDefinitionId in rates.servicePricing ? finite(rates.servicePricing[row.serviceDefinitionId]) : null;
  if (custom !== null) return custom;
  return finite(rates.serviceRate) ?? 0;
}

export function deliverableUnitPrice(row, rates = {}) {
  const stamped = finite(row?.unitPrice);
  if (stamped !== null) return stamped;
  const custom = rates.deliverablePricing && row?.deliverableDefinitionId in rates.deliverablePricing ? finite(rates.deliverablePricing[row.deliverableDefinitionId]) : null;
  if (custom !== null) return custom;
  return finite(rates.deliverableRate) ?? 0;
}

const quantityOf = (row) => Math.max(1, Number(row?.quantity) || 1);

/**
 * How many units of a deliverable a line is actually for.
 *
 * Its quantity, and - where the deliverable is counted - its count as well. "Album Printing" priced
 * at ₹2,200 with a count of 10 is ten albums, so two of that line is twenty: quantity × count ×
 * price. A deliverable that is not counted, or one whose count has not been typed yet, is quantity
 * × price exactly as it always was.
 *
 * An empty count is *not* a count of nothing. Reading it as zero would price the line at nothing
 * the moment it was added and go on doing so until somebody typed a figure, which is a quotation
 * quietly worth less than it should be rather than an obvious blank. So anything that is not a
 * positive number - empty, null, text, zero, a negative - leaves the line on its quantity alone.
 *
 * The deliverable's own No. of Count answer has to say so too. A row may still be carrying a count
 * typed before that answer was changed to No: the cell no longer shows it, and a multiplier nobody
 * can see is the worst kind.
 */
export function deliverableUnits(row) {
  const quantity = quantityOf(row);
  if (!deliverableAnswerOn(row?.deliverableDefinition?.photoCountEnabled)) return quantity;
  const count = Number(row?.numberOfPhotos);
  if (!Number.isFinite(count) || count <= 0) return quantity;
  return quantity * count;
}

/**
 * The quotation's figures: what the services and deliverables come to, the discount taken off,
 * the total the client is quoted, and the GST stated on top of it. GST is stated rather than
 * added - the page has always printed "+ 18% GST APPLICABLE" under the total - so `amount` is the
 * pre-tax figure the register lists, and `gstAmount` and `grandTotal` are there for the snapshot.
 */
export function quotationTotals({ services = [], deliverables = [], rates = {}, discountPercent = 0, gstPercent }) {
  /*
   * A line given rather than charged for comes to nothing, whatever its quantity, its count or its
   * unit price. The line keeps all three - what is being given away is worth seeing on the screen -
   * and simply stops reaching the subtotal.
   *
   * `=== true` and nothing looser, so every line raised before the question was asked, and every
   * one carrying no answer at all, is charged exactly as it always was.
   */
  const given = (row) => row?.complimentary === true;
  const serviceCost = services.reduce((total, row) => total + (given(row) ? 0 : quantityOf(row) * serviceUnitPrice(row, rates)), 0);
  // Quantity × count × price where the deliverable is counted, quantity × price where it is not.
  const deliverableCost = deliverables.reduce((total, row) => total + (given(row) ? 0 : deliverableUnits(row) * deliverableUnitPrice(row, rates)), 0);
  const subtotal = serviceCost + deliverableCost;
  const discount = Math.min(100, Math.max(0, Number(discountPercent) || 0));
  const discountAmount = Math.round(subtotal * (discount / 100));
  const amount = subtotal - discountAmount;
  const gst = finite(gstPercent) ?? finite(rates.gstPercent) ?? 18;
  const gstAmount = Math.round(amount * (gst / 100));
  return { serviceCost, deliverableCost, subtotal, discountPercent: discount, discountAmount, amount, gstPercent: gst, gstAmount, grandTotal: amount + gstAmount };
}

/*
 * ── Switching brand ─────────────────────────────────────────────────────────────────────────────
 *
 * A line chosen off one brand's own list is that brand's: a Qua Qua service has no place on a
 * Corp quotation. Switching brand therefore removes those lines - after asking - and keeps
 * everything else: lines off the shared project catalogue, which every brand may use, and the
 * shoots themselves. `offeredIds` is the *new* brand's master ids, so a master both brands list
 * survives the switch.
 */
export function selectionsLostOnBrandSwitch(rows = [], offeredIds = new Set(), key = "brandServiceId") {
  const offered = offeredIds instanceof Set ? offeredIds : new Set(offeredIds || []);
  return (rows || []).filter((row) => row?.[key] && !offered.has(row[key]));
}

/**
 * The service or deliverable rows that survive a brand switch, and the ones that go, as
 * `{ kept, lost }`. One call for services and one for deliverables, with the matching key.
 */
export function splitRowsForBrandSwitch(rows = [], offeredIds = new Set(), key = "brandServiceId") {
  const lost = new Set(selectionsLostOnBrandSwitch(rows, offeredIds, key).map((row) => row.id));
  return { kept: (rows || []).filter((row) => !lost.has(row.id)), lost: (rows || []).filter((row) => lost.has(row.id)) };
}

/**
 * The brand's masters as the service table's "definitions".
 *
 * The table draws every row off a project definition - timing modes, size options, whether
 * remarks are allowed - so a brand service that points at one is that definition, carrying the
 * brand's own name and price beside it. One that points at nothing is a plain priced line: named,
 * counted, remarked on, with none of the project columns. `brandServiceId` on the definition is
 * what the row inherits, and what says which brand it came from.
 *
 * A brand that has configured nothing is answered with the project catalogue whole, exactly as
 * every brand was offered before brands existed - `usingCatalogue` says so.
 */
export function brandServiceDefinitions(brandServices = [], catalogue = []) {
  const configured = (brandServices || []).filter((row) => row?.isActive !== false);
  if (!configured.length) return { definitions: catalogue || [], usingCatalogue: true };
  const byId = new Map((catalogue || []).map((definition) => [definition.id, definition]));
  return {
    usingCatalogue: false,
    definitions: configured.map((row) => {
      const definition = row.definition || byId.get(row.serviceDefinitionId) || null;
      return {
        ...(definition || { id: `brand-service:${row.id}`, quantityMode: "INTEGER", defaultQuantity: 1, remarksEnabled: true }),
        name: row.name || definition?.name || "",
        brandServiceId: row.id,
        brandDefaultPrice: finite(row.defaultPrice),
      };
    }),
  };
}

export function brandDeliverableDefinitions(brandDeliverables = [], catalogue = []) {
  const configured = (brandDeliverables || []).filter((row) => row?.isActive !== false);
  if (!configured.length) return { definitions: catalogue || [], usingCatalogue: true };
  const byId = new Map((catalogue || []).map((definition) => [definition.id, definition]));
  return {
    usingCatalogue: false,
    definitions: configured.map((row) => {
      const definition = row.definition || byId.get(row.deliverableDefinitionId) || null;
      return {
        ...(definition || { id: `brand-deliverable:${row.id}`, remarksEnabled: true }),
        name: row.name || definition?.name || "",
        brandDeliverableId: row.id,
        brandDefaultPrice: finite(row.defaultPrice),
      };
    }),
  };
}

/**
 * What a line inherits from the definition it was picked from: the brand master it names and the
 * price it was added at. A catalogue definition names no master and stamps no price, so the row
 * prices off the rates - the reading every quotation had before brands.
 */
export function brandFieldsForServiceRow(definition) {
  const fields = {};
  if (definition?.brandServiceId) fields.brandServiceId = definition.brandServiceId;
  if (finite(definition?.brandDefaultPrice) !== null) fields.unitPrice = finite(definition.brandDefaultPrice);
  // A brand-only line has no project definition behind it, and must not claim one.
  if (String(definition?.id || "").startsWith("brand-service:")) fields.serviceDefinitionId = "";
  return fields;
}

export function brandFieldsForDeliverableRow(definition) {
  const fields = {};
  if (definition?.brandDeliverableId) fields.brandDeliverableId = definition.brandDeliverableId;
  if (finite(definition?.brandDefaultPrice) !== null) fields.unitPrice = finite(definition.brandDefaultPrice);
  if (String(definition?.id || "").startsWith("brand-deliverable:")) fields.deliverableDefinitionId = "";
  return fields;
}

/**
 * The lines a package adds to a shoot, skipping what the shoot already holds.
 *
 * A package is a shortcut for picking its items one by one, so its items become ordinary rows:
 * the master's definition, the package's quantity, and the package's price where it names one -
 * the master's default otherwise. An item whose master the brand no longer offers is skipped
 * rather than added blind, and reported so the generator can say so.
 */
export function packageRowsForShoot({ pkg, shoot, serviceDefinitions = [], deliverableDefinitions = [], existingServices = [], existingDeliverables = [] }) {
  const servicesByMaster = new Map((serviceDefinitions || []).filter((definition) => definition.brandServiceId).map((definition) => [definition.brandServiceId, definition]));
  const deliverablesByMaster = new Map((deliverableDefinitions || []).filter((definition) => definition.brandDeliverableId).map((definition) => [definition.brandDeliverableId, definition]));
  const heldServices = new Set((existingServices || []).map((row) => row.brandServiceId || row.serviceDefinitionId).filter(Boolean));
  const heldDeliverables = new Set((existingDeliverables || []).map((row) => row.brandDeliverableId || row.deliverableDefinitionId).filter(Boolean));
  const services = [];
  const deliverables = [];
  const skipped = [];
  for (const item of pkg?.items || []) {
    const price = finite(item.defaultPrice);
    if (item.itemType === "SERVICE") {
      const definition = servicesByMaster.get(item.masterId);
      if (!definition) { skipped.push(item); continue; }
      if (heldServices.has(definition.brandServiceId) || (definition.id && heldServices.has(definition.id))) continue;
      services.push({ definition, quantity: Math.max(1, Number(item.quantity) || 1), unitPrice: price ?? finite(definition.brandDefaultPrice), packageId: pkg.id, packageName: pkg.name });
      heldServices.add(definition.brandServiceId);
    } else if (item.itemType === "DELIVERABLE") {
      const definition = deliverablesByMaster.get(item.masterId);
      if (!definition) { skipped.push(item); continue; }
      if (heldDeliverables.has(definition.brandDeliverableId) || (definition.id && heldDeliverables.has(definition.id))) continue;
      deliverables.push({ definition, quantity: Math.max(1, Number(item.quantity) || 1), unitPrice: price ?? finite(definition.brandDefaultPrice), packageId: pkg.id, packageName: pkg.name });
      heldDeliverables.add(definition.brandDeliverableId);
    }
  }
  return { shootId: shoot?.id, services, deliverables, skipped };
}
