/**
 * What the CRM Quotation Calculator hands the Quotation Generator: its choices, as the generator's
 * own rows.
 *
 * The generator is shoot-based - a shoot holds services and deliverables - and prices a line at
 * the `unitPrice` stamped on it when it was added. The calculator has one Event / Shoot Date and
 * no shoots, so its choices become **one** shoot, dated from the calculator, whose shoot types and
 * session timings are the ones its service lines are priced under; every service becomes the row
 * `serviceRowFor` would have made had that service been picked on that shoot, and every
 * deliverable the row `deliverableRowFor` makes for its variant. The rows carry the same ids, the
 * same definitions, the same stamped prices and the same `autoFromService` records the generator
 * writes itself, so once it opens nothing tells them apart from rows picked by hand - and the
 * generator goes on pricing, syncing and saving them exactly as it does its own.
 *
 * Nothing here is a second pricing engine. A service line's price is the Settings pricing row the
 * calculator quoted it at; a variant's is the variant's; a flat deliverable's is the deliverable's
 * own flat figure, and one Settings has not priced is left unstamped so the generator applies its
 * own rule for an unpriced row. Kept free of React so `node --test` can hold the mapping.
 */

import { deliverableVariantLabel } from "./deliverableBrands.mjs";
import { SHOOT_TYPE_CODE_BY_LABEL, TIMING_MODE_BY_LABEL } from "./servicePricing.mjs";
import { brandCodeForVertical, verticalForBrand } from "./quotationBrand.mjs";
import { VARIANT_KEY_SEPARATOR, serviceLineFor, serviceIdOfLine, toAmount } from "./quotationCalculator.mjs";

const invert = (map) => Object.fromEntries(Object.entries(map).map(([label, code]) => [code, label]));
/** The words a shoot stores for the codes a pricing row stores - `AddShootDialog`'s own options. */
export const SHOOT_TYPE_LABEL_BY_CODE = invert(SHOOT_TYPE_CODE_BY_LABEL);
export const SESSION_TIMING_LABEL_BY_CODE = invert(TIMING_MODE_BY_LABEL);

const finite = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

/**
 * The Settings pricing row a calculator line was quoted from. The catalogue numbers a service's
 * lines by their position among the rows that carry a price - `serviceLines` in
 * `quotation-calculator/controller.js` - so the same filter finds the row on the full definition.
 */
export function pricingRowForLine(definition, lineId) {
  const suffix = String(lineId || "").slice(String(lineId || "").lastIndexOf(":") + 1);
  if (suffix === "flat") return null;
  const priced = (Array.isArray(definition?.pricing) ? definition.pricing : []).filter((row) => row && finite(row.price) !== null);
  return priced[Number(suffix)] || null;
}

const rupees = (value) => `₹${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(value)}`;

/**
 * The generator's draft, and what could not be carried.
 *
 * `serviceDefinitions` and `deliverableDefinitions` are the project catalogue as the generator
 * reads it (`/api/sales/service-definitions`, `/api/sales/deliverable-definitions`), because a
 * generator row carries its whole definition. `durationFor` is `durationForSessionTiming` from
 * `AddShootDialog`, so the shoot's length is the studio's own scale and not a copy of it. `lead`
 * is the CRM lead the calculator was opened for, where there was one.
 */
export function generatorDraftFromCalculator({
  catalogue,
  serviceRows = [],
  deliverableQuantities = {},
  deliverableCounts = {},
  autoDeliverables = {},
  eventDate = "",
  basePackagePrice = "",
  extras = "",
  discountPercent = "0",
  serviceDefinitions = [],
  deliverableDefinitions = [],
  lead = null,
  leadId = "",
  durationFor,
  now = Date.now(),
}) {
  const services = catalogue?.services || [];
  const skipped = [];
  const shootRowId = `quote-shoot-${now}-0`;
  const shootTypes = [];
  const sessionTimings = [];
  let hourlyHours = 0;
  const pushUnique = (list, value) => { if (value && !list.includes(value)) list.push(value); };

  /* ── Services ─────────────────────────────────────────────────────────────────────────────── */
  const serviceLines = [];
  for (const row of serviceRows) {
    const found = row.lineId ? serviceLineFor(services, row.lineId) : null;
    const service = found?.service || services.find((candidate) => candidate.id === row.serviceId);
    const name = service?.name || row.serviceId;
    if (!row.lineId || !found) { skipped.push(`${name}: choose its option before applying.`); continue; }
    const definition = serviceDefinitions.find((candidate) => candidate.id === serviceIdOfLine(row.lineId));
    if (!definition) { skipped.push(`${name}: no longer offered under Settings → Project → Services.`); continue; }
    const pricing = pricingRowForLine(definition, row.lineId);
    const shootType = pricing ? SHOOT_TYPE_LABEL_BY_CODE[pricing.shootType] : "";
    const timing = pricing ? SESSION_TIMING_LABEL_BY_CODE[pricing.timingMode] : "";
    pushUnique(shootTypes, shootType);
    pushUnique(sessionTimings, timing);
    if (pricing?.timingMode === "HOURS_MINUTES") hourlyHours = Math.max(hourlyHours, Number(pricing.hours) || 0);
    // The line's own Session Timing, as the generator's row holds it: the timing set's entry whose
    // code is the pricing row's mode - which is what lets `servicePricingRowForLine` find the same
    // booking again, and its mapped deliverables with it.
    const sessionOption = pricing && pricing.timingMode !== "HOURS_MINUTES"
      ? (definition.timingOptionSet?.values || []).find((value) => value.code === pricing.timingMode) || null
      : null;
    const sizeOptionValue = pricing?.sizeOptionValueId
      ? (definition.pricedSizeOptions || definition.sizeOptionSet?.values || []).find((value) => value.id === pricing.sizeOptionValueId) || null
      : null;
    const price = finite(found.line.price);
    serviceLines.push({
      calculatorLineId: row.lineId,
      row: {
        id: `quote-service-${shootRowId}-${definition.id}`,
        shootId: shootRowId,
        serviceDefinitionId: definition.id,
        serviceDefinition: definition,
        serviceName: definition.name,
        complimentaryAllowed: definition.complimentary === true,
        complimentary: false,
        quantity: Math.max(1, Math.floor(Number(row.quantity) || 1)),
        quantitySessionTiming: "",
        sessionOptionId: sessionOption?.id || "",
        sessionOption,
        durationHours: pricing?.timingMode === "HOURS_MINUTES" ? Number(pricing.hours) || "" : "",
        durationMinutes: pricing?.timingMode === "HOURS_MINUTES" ? 0 : "",
        workDays: "",
        timingMinutes: "",
        sizeOptionValueId: pricing?.sizeOptionValueId || "",
        sizeOptionValue,
        remarks: "",
        ...(price !== null ? { unitPrice: price } : {}),
      },
    });
  }

  /* ── The one shoot ────────────────────────────────────────────────────────────────────────── */
  const types = shootTypes.length ? shootTypes : ["Studio / In-House"];
  const timings = sessionTimings.length ? sessionTimings : ["Hourly"];
  const duration = durationFor ? durationFor(timings, hourlyHours || "", 0) : { sessionDurationHours: hourlyHours || "", sessionDurationMinutes: 0 };
  const shoot = {
    id: shootRowId,
    shootId: "Q-SID-0001",
    // The calculator does not ask what the event is; the generator's shoot card is where it is named.
    shoot: "",
    dateCreated: /^\d{4}-\d{2}-\d{2}$/.test(String(eventDate || "")) ? eventDate : null,
    shootPlace: "",
    district: "",
    state: "",
    shootTypes: types,
    shootType: types[0],
    sessionTimings: timings,
    sessionTiming: timings[0],
    sessionDurationHours: Number(duration.sessionDurationHours || 0),
    sessionDurationMinutes: Number(duration.sessionDurationMinutes || 0),
    isMainEvent: true,
    foodTakenCareBy: "Studio",
    accommodation: "Studio",
    travel: "Studio",
    preference: "Both",
    eventStartTime: null,
    eventEndTime: null,
  };

  /* ── Deliverables ─────────────────────────────────────────────────────────────────────────── */
  const deliverables = [];
  for (const key of Object.keys(deliverableQuantities || {})) {
    const quantity = Math.max(0, Math.floor(Number(deliverableQuantities[key]) || 0));
    if (!quantity) continue;
    const [definitionId, brandId, variantId] = String(key).split(VARIANT_KEY_SEPARATOR);
    const definition = deliverableDefinitions.find((candidate) => candidate.id === definitionId);
    const catalogueName = (catalogue?.deliverables || []).find((candidate) => candidate.id === definitionId)?.name || definitionId;
    if (!definition) { skipped.push(`${catalogueName}: no longer offered under Settings → Project → Deliverables.`); continue; }
    const brand = brandId ? (definition.brands || []).find((candidate) => candidate.id === brandId) : null;
    const variant = brand ? (brand.variants || []).find((candidate) => candidate.id === variantId) : null;
    if (brandId && (!brand || !variant)) { skipped.push(`${definition.name}: that variant is no longer offered.`); continue; }
    // A variant is the price - one nobody has priced is quoted at zero, the generator's own rule.
    // A flat row carries the deliverable's own figure, and none where Settings has not priced it.
    const price = variant ? (finite(variant.price) ?? 0) : finite(definition.price);
    const count = Math.max(0, Math.floor(Number(deliverableCounts?.[key]) || 0));
    const from = autoDeliverables?.[key] ? serviceLines.find((line) => line.calculatorLineId === autoDeliverables[key]) : null;
    deliverables.push({
      id: `quote-deliverable-${shootRowId}-${definition.id}${variant ? `-${variant.id}` : ""}`,
      shootId: shootRowId,
      deliverableDefinitionId: definition.id,
      deliverableDefinition: definition,
      deliverableName: definition.name,
      complimentaryAllowed: definition.complimentary === true,
      complimentary: false,
      quantity,
      numberOfPhotos: count || "",
      sizeOptionValueId: "",
      sizeOptionValue: null,
      size: variant?.size || "",
      remarks: "",
      ...(variant ? {
        deliverableOptionId: `${definition.id}::${brand.id}::${variant.id}`,
        deliverableVariantLabel: deliverableVariantLabel(definition, brand, variant, { withRemarks: true }),
        deliverableBrandId: brand.id,
        deliverableBrandName: brand.name || "",
        deliverableVariantId: variant.id,
        frameInches: variant.frameInches || "",
        videoLength: variant.videoLength || "",
      } : {}),
      ...(price !== null ? { unitPrice: price } : {}),
      ...(from ? { autoFromService: from.row.id, autoSourceType: "SERVICE_PRICING", autoServiceDefinitionId: from.row.serviceDefinitionId } : {}),
    });
  }

  /* ── The rest ─────────────────────────────────────────────────────────────────────────────── */
  const base = toAmount(basePackagePrice);
  const extra = toAmount(extras);
  const notes = [];
  if (base) notes.push(`Base package price: ${rupees(base)}.`);
  if (extra) notes.push(`Extras: ${rupees(extra)}.`);
  const brand = brandCodeForVertical(lead?.vertical);
  return {
    draft: {
      vertical: brand ? verticalForBrand(brand) : "",
      enquiryId: lead?.enquiryId || leadId || "",
      additionalNotes: notes.join(" "),
      shoots: [shoot],
      services: serviceLines.map((line) => line.row),
      deliverables,
      discount: Math.min(100, Math.max(0, toAmount(discountPercent))),
      // Where it came from, for the reader of a saved payload; the generator itself reads none of it.
      calculator: { leadId: leadId || "", eventDate: shoot.dateCreated, basePackagePrice: base, extras: extra },
    },
    // What the generator prices with that the calculator only wrote down: said to the person
    // before they leave, so nothing is discarded in silence.
    carriedAsNote: notes,
    skipped,
  };
}
