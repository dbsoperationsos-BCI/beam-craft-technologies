/**
 * The CRM Quotation Calculator's arithmetic, kept free of React so `node --test` can hold it.
 *
 * The calculator quotes the studio's services and deliverables at the price Settings → Project gave
 * each one, from the catalogue `quotation-calculator/controller.js` shapes. What is on the quote is
 * chosen the way the Quotation Generator chooses it - a service by the booking it is priced as
 * (one of its pricing lines), a deliverable by the brand and variant it is sold as - and the
 * quantities are keyed by that choice: a service line's id, and for a deliverable either the
 * deliverable's own id (quoted at its flat price, as every draft saved before variants was) or
 * `deliverable::brand::variant` for a chosen variant. The total is the base package and extras typed
 * on the calculator, plus every quantity times its price, less the discount.
 *
 * The rules the Quotation Generator already has are read from where it keeps them rather than
 * written again: the variant labels and options from `deliverableBrands.mjs`, quantity × No. of
 * Count from `quotationBrand.mjs`, and what a service brings with it from
 * `serviceDeliverableRules.js` plus the mapping Settings puts on each pricing line.
 */

import { deliverableVariantOptions } from "./deliverableBrands.mjs";
import { deliverableUnits } from "./quotationBrand.mjs";
import { autoDeliverableNamesForServices, blockedDeliverableNamesForServices, findDeliverableDefinitionByName } from "../components/project-management/serviceDeliverableRules.js";

export const toAmount = (value) => {
  const parsed = Number(String(value ?? "").replace(/[^\d.]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
};

/** The words a service line reads as on the calculator, from the parts the catalogue sends. */
export function serviceLineLabel(line) {
  return [line?.shootType, line?.timing, line?.duration, line?.size].filter(Boolean).join(" · ");
}

/**
 * How a chosen service identifies itself on the calculator, in one line and in this order:
 * Service Name - Shoot Type - Session Timing - Duration - and the size where the service is sold
 * by size. Every part is the pricing line's own, from Settings; a part the line does not carry is
 * left out rather than drawn as a gap, so a flat-priced service reads as its name alone.
 */
export function serviceDisplayLabel(serviceName, line) {
  return [serviceName, line?.shootType, line?.timing, line?.duration, line?.size].filter(Boolean).join(" - ");
}

/**
 * What a deliverable reads as under its name: whose it is, how big or how long, and the frame.
 * An image carries a size and a frame, a video a length - whichever it was given.
 */
export function deliverableDetailLabel(deliverable) {
  return [deliverable?.brandName, deliverable?.imageSize || deliverable?.videoLength, deliverable?.frameInches].filter(Boolean).join(" · ");
}

const quantityOf = (quantities, id) => Math.max(0, Math.floor(Number(quantities?.[id]) || 0));
const priceOf = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

/** The key a chosen variant is held under - the same three ids the Quotation Generator's option carries. */
export const VARIANT_KEY_SEPARATOR = "::";
export const deliverableOptionId = (deliverableId, brandId, variantId) => [deliverableId, brandId, variantId].join(VARIANT_KEY_SEPARATOR);

/**
 * What the Add Deliverable picker offers: one entry per brand and variant, or one per deliverable
 * sold by nobody - the Quotation Generator's own list, built by the same function and worded the
 * same way, the Settings note included.
 */
export function deliverableOptions(deliverables = []) {
  return deliverableVariantOptions(deliverables, { withRemarks: true });
}

/** The service a line id belongs to - everything before the last colon of `${serviceId}:${index}`. */
export function serviceIdOfLine(lineId) {
  const at = String(lineId || "").lastIndexOf(":");
  return at === -1 ? "" : String(lineId).slice(0, at);
}

/**
 * The service rows on the quote, as the screen holds them: one per chosen service, with the pricing
 * line chosen for it - blank until it is, for a service priced under more than one booking, the way
 * the Quotation Generator's row waits for its Session Timing - and the quantity. What is priced,
 * synced and saved is the quantities by line these rows resolve to, so a draft saved before rows
 * existed is read back as rows and reads exactly as it did.
 */
export function serviceRowsFromQuantities(serviceQuantities = {}) {
  return Object.keys(serviceQuantities || {})
    .filter((lineId) => quantityOf(serviceQuantities, lineId) && serviceIdOfLine(lineId))
    .map((lineId) => ({ serviceId: serviceIdOfLine(lineId), lineId, quantity: quantityOf(serviceQuantities, lineId) }));
}

/** The quantities by line the rows resolve to. A row still waiting for its option prices nothing. */
export function serviceQuantitiesFromRows(rows = []) {
  const quantities = {};
  for (const row of rows || []) {
    const quantity = Math.max(0, Math.floor(Number(row?.quantity) || 0));
    if (row?.lineId && quantity) quantities[row.lineId] = quantity;
  }
  return quantities;
}

/** The one service line a quantity key names, with the service it belongs to, or null. */
export function serviceLineFor(services = [], lineId) {
  for (const service of services || []) {
    const line = (service?.lines || []).find((candidate) => candidate.id === lineId);
    if (line) return { service, line };
  }
  return null;
}

/**
 * The service lines on the quote, in the order they were added: each the service's name, the
 * booking it is priced as, its price and its quantity. A key naming a line the catalogue no longer
 * holds, or a quantity of nothing, is not a row.
 */
export function serviceLineRows({ services = [], serviceQuantities = {} }) {
  const rows = [];
  for (const lineId of Object.keys(serviceQuantities || {})) {
    const quantity = quantityOf(serviceQuantities, lineId);
    if (!quantity) continue;
    const found = serviceLineFor(services, lineId);
    if (!found) continue;
    rows.push({
      id: lineId,
      serviceId: found.service.id,
      name: found.service.name,
      detail: serviceLineLabel(found.line) || "Flat price",
      price: priceOf(found.line.price),
      quantity,
      deliverables: Array.isArray(found.line.deliverables) ? found.line.deliverables : [],
    });
  }
  return rows;
}

/**
 * The deliverable a quantity key names, as one row: its name, the words under it, its price and
 * whether it is counted. Null for a key naming nothing the catalogue holds.
 *
 * A variant key resolves to that exact variant, at the variant's own price - and a variant nobody
 * has priced is quoted at zero rather than at the deliverable's flat figure, the Quotation
 * Generator's rule: a variant is the price, so an empty one is an answer about this variant. A key
 * that is the deliverable's id alone reads the flat fields, as every draft saved before variants
 * does, and prices at the deliverable's flat price.
 */
export function deliverableRowFor(deliverables = [], key) {
  const parts = String(key || "").split(VARIANT_KEY_SEPARATOR);
  const definition = (deliverables || []).find((candidate) => candidate.id === parts[0]);
  if (!definition) return null;
  const base = { id: key, definitionId: definition.id, name: definition.name, photoCountEnabled: definition.photoCountEnabled ?? null };
  if (parts.length === 1) return { ...base, detail: deliverableDetailLabel(definition), price: priceOf(definition.price) };
  const brand = (definition.brands || []).find((candidate) => candidate.id === parts[1]);
  const variant = (brand?.variants || []).find((candidate) => candidate.id === parts[2]);
  if (!brand || !variant) return null;
  return {
    ...base,
    detail: deliverableDetailLabel({ brandName: brand.name, imageSize: variant.size, videoLength: variant.videoLength, frameInches: variant.frameInches }),
    price: priceOf(variant.price) ?? 0,
  };
}

/** The deliverables on the quote, in the order they were added, each with its quantity and count. */
export function deliverableRows({ deliverables = [], deliverableQuantities = {}, deliverableCounts = {} }) {
  const rows = [];
  for (const key of Object.keys(deliverableQuantities || {})) {
    const quantity = quantityOf(deliverableQuantities, key);
    if (!quantity) continue;
    const row = deliverableRowFor(deliverables, key);
    if (!row) continue;
    const count = Math.max(0, Math.floor(Number(deliverableCounts?.[key]) || 0));
    rows.push({ ...row, quantity, count });
  }
  return rows;
}

/**
 * How many units a deliverable row is for - quantity × No. of Count where the deliverable is
 * counted and a count has been typed, quantity alone otherwise. The Quotation Generator's own
 * rule, asked the same question in the shape it asks it.
 */
export function deliverableRowUnits(row) {
  return deliverableUnits({ quantity: row?.quantity, numberOfPhotos: row?.count, deliverableDefinition: { photoCountEnabled: row?.photoCountEnabled } });
}

/** Every quantity times its price, over the service lines and the deliverables. Unpriced rows count nothing. */
export function linesCost({ services = [], deliverables = [], serviceQuantities = {}, deliverableQuantities = {}, deliverableCounts = {} }) {
  const serviceTotal = serviceLineRows({ services, serviceQuantities })
    .reduce((sum, row) => sum + (row.price === null ? 0 : row.quantity * row.price), 0);
  const deliverableTotal = deliverableRows({ deliverables, deliverableQuantities, deliverableCounts })
    .reduce((sum, row) => sum + (row.price === null ? 0 : deliverableRowUnits(row) * row.price), 0);
  return serviceTotal + deliverableTotal;
}

/**
 * The calculator's figures: the lines, the cost before discount (base package + extras + lines),
 * the discount held to 0..100, and the total.
 */
export function calculatorTotals({ services, deliverables, serviceQuantities, deliverableQuantities, deliverableCounts, basePackagePrice, extras, discountPercent }) {
  const lines = linesCost({ services, deliverables, serviceQuantities, deliverableQuantities, deliverableCounts });
  const serviceCost = toAmount(basePackagePrice) + toAmount(extras) + lines;
  const discount = Math.min(100, Math.max(0, toAmount(discountPercent)));
  const totalCost = Math.round((serviceCost - (serviceCost * discount) / 100) * 100) / 100;
  return { lines, serviceCost, discount, totalCost };
}

/**
 * The variant keys one service line brings with it - only those the catalogue still holds. A
 * mapping whose deliverable, brand or variant has since been removed in Settings quietly brings
 * nothing, as it does on the Quotation Generator.
 */
export function serviceLineDeliverableKeys(deliverables = [], line) {
  return (Array.isArray(line?.deliverables) ? line.deliverables : [])
    .map((entry) => deliverableOptionId(entry.deliverableId, entry.brandId, entry.variantId))
    .filter((key) => deliverableRowFor(deliverables, key) !== null);
}

/**
 * The deliverables the chosen services bring with them, worked out again from the services as they
 * now stand - the Quotation Generator's `addAutoDeliverables`, for a quote with no shoots.
 *
 * Two sources, both the generator's. A service answered **Deliverable Added** in Settings maps
 * variants onto each pricing line, and choosing that line brings those variants in, each recorded
 * in `autoDeliverables` against the line - so removing the line takes its own rows with it and
 * leaves everything added by hand alone. And the names `serviceDeliverableRules.js` pairs with a
 * service follow it in by the deliverable's id, at its flat price, where the catalogue offers the
 * name; the pairs it blocks for a combination of services are taken off. A row already on the
 * quote - by hand, or from another service - is already quoted and is not added twice.
 *
 * Returns the next quantities, counts and auto records; the arguments are left as they are.
 */
export function syncAutoDeliverables({ services = [], deliverables = [], serviceQuantities = {}, deliverableQuantities = {}, deliverableCounts = {}, autoDeliverables = {} }) {
  const chosen = serviceLineRows({ services, serviceQuantities });
  const mapped = new Map();
  for (const row of chosen) {
    const found = serviceLineFor(services, row.id);
    for (const key of serviceLineDeliverableKeys(deliverables, found?.line)) {
      if (!mapped.has(key)) mapped.set(key, row.id);
    }
  }
  const serviceNames = chosen.map((row) => row.name);
  const blockedNames = blockedDeliverableNamesForServices(serviceNames);
  const blockedIds = new Set((deliverables || []).filter((definition) => blockedNames.has(definition.name)).map((definition) => definition.id));

  const nextQuantities = {};
  const nextCounts = {};
  const nextAuto = {};
  for (const key of Object.keys(deliverableQuantities || {})) {
    const row = deliverableRowFor(deliverables, key);
    // A row the catalogue no longer holds is carried as it was: not this sync's to drop.
    if (row && blockedIds.has(row.definitionId)) continue;
    if (autoDeliverables?.[key] && !mapped.has(key)) continue;
    nextQuantities[key] = deliverableQuantities[key];
    if (deliverableCounts?.[key] !== undefined) nextCounts[key] = deliverableCounts[key];
    if (autoDeliverables?.[key]) nextAuto[key] = mapped.get(key) || autoDeliverables[key];
  }
  for (const [key, lineId] of mapped) {
    if (quantityOf(nextQuantities, key)) continue;
    nextQuantities[key] = 1;
    nextAuto[key] = lineId;
  }
  const heldDefinitionIds = new Set(Object.keys(nextQuantities).filter((key) => quantityOf(nextQuantities, key)).map((key) => deliverableRowFor(deliverables, key)?.definitionId).filter(Boolean));
  for (const name of autoDeliverableNamesForServices(serviceNames)) {
    if (blockedNames.has(name)) continue;
    const definition = findDeliverableDefinitionByName(deliverables, name);
    if (!definition || heldDefinitionIds.has(definition.id)) continue;
    nextQuantities[definition.id] = 1;
    heldDefinitionIds.add(definition.id);
  }
  return { deliverableQuantities: nextQuantities, deliverableCounts: nextCounts, autoDeliverables: nextAuto };
}

/**
 * The priced lines the total is built from, written out in full for the lead: what was chosen,
 * how many, at what price, and what each came to. The screen no longer prints a unit price, so
 * this is where the figure behind the total is kept.
 */
export function quotedLines({ services = [], deliverables = [], serviceQuantities = {}, deliverableQuantities = {}, deliverableCounts = {} }) {
  return [
    ...serviceLineRows({ services, serviceQuantities }).map((row) => ({
      kind: "SERVICE",
      id: row.id,
      name: row.name,
      detail: row.detail,
      quantity: row.quantity,
      count: null,
      unitPrice: row.price,
      total: row.price === null ? 0 : row.quantity * row.price,
    })),
    ...deliverableRows({ deliverables, deliverableQuantities, deliverableCounts }).map((row) => ({
      kind: "DELIVERABLE",
      id: row.id,
      name: row.name,
      detail: row.detail,
      quantity: row.quantity,
      count: row.count || null,
      unitPrice: row.price,
      total: row.price === null ? 0 : deliverableRowUnits(row) * row.price,
    })),
  ];
}
