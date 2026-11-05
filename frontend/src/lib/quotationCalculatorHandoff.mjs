/**
 * What the CRM Quotation Calculator hands the Quotation Generator: its choices, as the generator's
 * own rows.
 *
 * The generator is shoot-based - a shoot holds services and deliverables - and prices a line at
 * the `unitPrice` stamped on it when it was added. The calculator has one Event / Shoot Date and no
 * shoots of its own, but every service line it quotes is a Settings pricing row, which names a Shoot
 * Type and a Session Timing. So its choices become **one shoot per Shoot Type and Session Timing
 * they were quoted under** - a Studio Half Session line and an Outdoor Full Session line are two
 * shoots, each holding the lines quoted under it and each priced by its own type and session -
 * dated from the calculator, the first the Main Event. Lines quoted under one type and session are
 * one shoot, exactly as before. Every service becomes the row `serviceRowFor` would have made had it
 * been picked on its shoot, and every deliverable the row `deliverableRowFor` makes for its variant:
 * one a service brought in goes on that service's shoot, and one picked by hand on the first. The rows carry the same ids, the
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
import { settingsNoteOf } from "./deliverableAnswers.mjs";
import { SHOOT_TYPE_CODE_BY_LABEL, TIMING_MODE_BY_LABEL } from "./servicePricing.mjs";
import { brandCodeForVertical, verticalForBrand } from "./quotationBrand.mjs";
import { VARIANT_KEY_SEPARATOR, serviceLineFor, serviceIdOfLine, toAmount } from "./quotationCalculator.mjs";
import { MAX_DISCOUNT_PERCENT } from "./quotationDiscount.mjs";

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
  /*
   * The shoots, one per Shoot Type and Session Timing the lines were quoted under - an hourly line by
   * its length as well, since a shoot runs for one length - in the order the lines name them.
   */
  const groups = [];
  const groupFor = (key, shootType, timing, hours) => {
    let group = groups.find((candidate) => candidate.key === key);
    if (!group) {
      group = { key, shootRowId: `quote-shoot-${now}-${groups.length}`, shootType, timing, hours, lines: [] };
      groups.push(group);
    }
    return group;
  };

  /* ── Services ─────────────────────────────────────────────────────────────────────────────── */
  const serviceLines = [];
  const unplaced = [];
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
    const hours = pricing?.timingMode === "HOURS_MINUTES" ? Number(pricing.hours) || 0 : 0;
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
    const line = {
      calculatorLineId: row.lineId,
      definition,
      row: {
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
        // The service's Settings note, as the generator starts a picked line with it.
        remarks: settingsNoteOf(definition.remarksEnabled),
        ...(price !== null ? { unitPrice: price } : {}),
      },
    };
    serviceLines.push(line);
    // A line quoted under a type and session belongs to the shoot of that type and session; a flat
    // line names neither, and joins the first shoot once the others are known.
    if (shootType || timing) groupFor(`${shootType}|${timing}|${hours}`, shootType, timing, hours).lines.push(line);
    else unplaced.push(line);
  }
  if (!groups.length) groupFor("||0", "", "", 0);
  groups[0].lines.push(...unplaced);
  // Each line takes its shoot's id, and the row id `serviceRowFor` would give it on that shoot.
  for (const group of groups) {
    for (const line of group.lines) {
      line.shootRowId = group.shootRowId;
      line.row = { id: `quote-service-${group.shootRowId}-${line.definition.id}`, shootId: group.shootRowId, ...line.row };
    }
  }

  /* ── The shoots ───────────────────────────────────────────────────────────────────────────── */
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(eventDate || "")) ? eventDate : null;
  const shoots = groups.map((group, index) => {
    const types = group.shootType ? [group.shootType] : ["Studio / In-House"];
    const timings = group.timing ? [group.timing] : ["Hourly"];
    const duration = durationFor ? durationFor(timings, group.hours || "", 0) : { sessionDurationHours: group.hours || "", sessionDurationMinutes: 0 };
    return {
      id: group.shootRowId,
      shootId: `Q-SID-${String(index + 1).padStart(4, "0")}`,
      // The calculator does not ask what the event is; the generator's shoot card is where it is named.
      shoot: "",
      dateCreated: date,
      shootPlace: "",
      district: "",
      state: "",
      shootTypes: types,
      shootType: types[0],
      sessionTimings: timings,
      sessionTiming: timings[0],
      sessionDurationHours: Number(duration.sessionDurationHours || 0),
      sessionDurationMinutes: Number(duration.sessionDurationMinutes || 0),
      // One Main Event, the first shoot.
      isMainEvent: index === 0,
      foodTakenCareBy: "Studio",
      accommodation: "Studio",
      travel: "Studio",
      preference: "Both",
      eventStartTime: null,
      eventEndTime: null,
    };
  });
  const firstShootRowId = shoots[0].id;

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
    // On the shoot of the service that brought it; a deliverable picked by hand on the first.
    const deliverableShootId = from?.shootRowId || firstShootRowId;
    deliverables.push({
      id: `quote-deliverable-${deliverableShootId}-${definition.id}${variant ? `-${variant.id}` : ""}`,
      shootId: deliverableShootId,
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
      remarks: settingsNoteOf(definition.remarksEnabled),
      ...(variant ? {
        deliverableOptionId: `${definition.id}::${brand.id}::${variant.id}`,
        // Named without the Settings note, which arrives as the line's Remarks instead.
        deliverableVariantLabel: deliverableVariantLabel(definition, brand, variant),
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
      shoots,
      services: serviceLines.map((line) => line.row),
      deliverables,
      // Never more than the generator will save: the quotation's own cap.
      discount: Math.min(MAX_DISCOUNT_PERCENT, Math.max(0, toAmount(discountPercent))),
      // Where it came from, for the reader of a saved payload; the generator itself reads none of it.
      calculator: { leadId: leadId || "", eventDate: date, basePackagePrice: base, extras: extra },
    },
    // What the generator prices with that the calculator only wrote down: said to the person
    // before they leave, so nothing is discarded in silence.
    carriedAsNote: notes,
    skipped,
  };
}
