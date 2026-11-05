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
import { DISCOUNT_SOURCES, calculateDiscount } from "./quotationDiscount.mjs";

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
 * A line is priced at the `unitPrice` stamped on it when it was added - what Settings configures
 * for it: its pricing line for the shoot's type and session, its size or variant, its flat price,
 * a package's price or the brand's default - and otherwise at the per-definition price the
 * quotation's rates name for it, where one was set. Nothing else: a line nothing configures a
 * price for is unpriced, and comes to ₹0. It is never given the studio's blanket service or
 * deliverable rate in its place - that invented a price (₹2,000, ₹1,000) for a line that had none.
 *
 * The order matters: a stamped price is a fact about this line, and re-reading the rates would
 * reprice it against today. A quotation saved before this rule had its unpriced lines charged at
 * those blanket rates; `withSavedUnitPrices` stamps them with what they were charged at when such a
 * quotation is opened, so it reads exactly as it was saved, and every line saved since carries its
 * own figure.
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
  return custom ?? 0;
}

export function deliverableUnitPrice(row, rates = {}) {
  const stamped = finite(row?.unitPrice);
  if (stamped !== null) return stamped;
  const custom = rates.deliverablePricing && row?.deliverableDefinitionId in rates.deliverablePricing ? finite(rates.deliverablePricing[row.deliverableDefinitionId]) : null;
  return custom ?? 0;
}

/**
 * A saved quotation's lines, each carrying the unit price it was charged at.
 *
 * A line saved without a stamped price was charged, before unpriced lines came to ₹0, at its rates'
 * per-definition price or else the blanket service or deliverable rate held in those same saved
 * rates. That figure is stamped onto the line here, once, as the quotation is opened, so its total
 * reads exactly as it was saved and saving a new version keeps it. A line already carrying a price
 * - every line saved since - is returned as it is.
 */
export function withSavedUnitPrices(rows, rates = {}, kind) {
  const service = kind === "service";
  const configured = (service ? rates?.servicePricing : rates?.deliverablePricing) || {};
  const blanket = finite(service ? rates?.serviceRate : rates?.deliverableRate);
  return (Array.isArray(rows) ? rows : []).map((row) => {
    if (finite(row?.unitPrice) !== null) return row;
    const id = service ? row?.serviceDefinitionId : row?.deliverableDefinitionId;
    const custom = id in configured ? finite(configured[id]) : null;
    return { ...row, unitPrice: custom ?? blanket ?? 0 };
  });
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
 * the total the client is quoted, and the GST stated on top of it.
 *
 * In this order: the Performance Cost - a rupee figure - is added to the subtotal (`grossCost`),
 * the discount comes off that (`discountAmount`, from `calculateDiscount` - a percentage of it, or
 * the rupees typed when `discountSource` is `AMOUNT`; a caller naming no source is giving
 * `discountPercent`, as every caller did before rupees could be typed), then the extra discounts -
 * up to three rupee figures, never percentages, given as `extraDiscounts` (or one `extraDiscountAmount`, as a
 * quotation raised before they were a list carries it) - come off what is left. Together they take
 * the total to nothing and no further: `extraDiscountAmount` is what was actually taken off, and
 * `extraDiscountLimit` the most it could have been, for the form to say so. Last, the Round Off
 * Discount - one rupee figure, never a percentage, to bring the total to a round number - comes off
 * whatever is left, no further than nothing (`roundOffDiscount` taken, `roundOffLimit` the most it
 * could be); it is folded into the total and listed nowhere the client reads. GST is stated rather than
 * added - the page prints "+ 18% GST APPLICABLE", at the configured rate, under the total - so `amount` is the
 * pre-tax figure the register lists, and `gstAmount` and `grandTotal` are there for the snapshot.
 */
export function quotationTotals({ services = [], deliverables = [], rates = {}, discountPercent = 0, discountSource, discountValue, performanceCost = 0, extraDiscounts = null, extraDiscountAmount = 0, roundOffDiscount = 0, gstPercent, discountCapPercent = null }) {
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
  const performance = Math.max(0, finite(performanceCost) ?? 0);
  const grossCost = subtotal + performance;
  const discount = calculateDiscount(discountSource ? { discountSource, discountValue, discountableSubtotal: grossCost } : { discountSource: DISCOUNT_SOURCES.PERCENTAGE, discountValue: discountPercent, discountableSubtotal: grossCost });
  /*
   * The cap, where the caller names one (the Quotation Generator: `MAX_DISCOUNT_PERCENT`), holds
   * the Discount alone, whatever is typed; `discountCap` is the rupees it allows, for the form to
   * say. Without one the Discount may take the total to nothing, as before. The extra discounts are
   * never held to the cap - a Diwali offer beside a full 15% is the studio's call - only to what the
   * Discount leaves, so together they take the total to nothing and no further.
   */
  const capPercent = finite(discountCapPercent);
  const discountCap = capPercent === null ? grossCost : Math.min(grossCost, Math.round(grossCost * (capPercent / 100)));
  const discountAmount = Math.min(discount.discountAmount, discountCap);
  const discountPercentApplied = discountAmount === discount.discountAmount ? discount.discountPercentage : (grossCost > 0 ? (discountAmount / grossCost) * 100 : 0);
  const extraDiscountLimit = Math.max(0, grossCost - discountAmount);
  const typedExtra = Array.isArray(extraDiscounts)
    ? extraDiscounts.reduce((sum, entry) => sum + Math.max(0, finite(entry?.amount) ?? 0), 0)
    : Math.max(0, finite(extraDiscountAmount) ?? 0);
  const extra = Math.min(extraDiscountLimit, typedExtra);
  // After everything else, so it never narrows what the extra discounts may take, and taken once.
  const roundOffLimit = Math.max(0, grossCost - discountAmount - extra);
  const roundOff = Math.min(roundOffLimit, Math.max(0, finite(roundOffDiscount) ?? 0));
  const amount = grossCost - discountAmount - extra - roundOff;
  // The rate the quotation is priced at - the brand's or the studio's, as configured - and none
  // where nothing configures one; never an assumed 18%.
  const gst = finite(gstPercent) ?? finite(rates.gstPercent) ?? 0;
  const gstAmount = Math.round(amount * (gst / 100));
  return { serviceCost, deliverableCost, subtotal, performanceCost: performance, grossCost, discountSource: discount.discountSource, discountPercent: discountPercentApplied, discountAmount, discountCap, extraDiscountAmount: extra, extraDiscountLimit, roundOffDiscount: roundOff, roundOffLimit, amount, gstPercent: gst, gstAmount, grandTotal: amount + gstAmount };
}

/** The most extra discounts a quotation carries. */
export const MAX_EXTRA_DISCOUNTS = 3;

/**
 * A saved quotation's extra discounts as `{ reason, amount }`: the list it was saved with, or - a
 * quotation raised when there could be only one - its `extraDiscountReason` / `extraDiscountAmount`
 * as the first. An entry with neither a reason nor an amount is not one.
 */
export function extraDiscountsOf(payload = {}) {
  const listed = Array.isArray(payload?.extraDiscounts)
    ? payload.extraDiscounts
    : (payload?.extraDiscountReason || Number(payload?.extraDiscountAmount) > 0 ? [{ reason: payload.extraDiscountReason, amount: payload.extraDiscountAmount }] : []);
  return listed.slice(0, MAX_EXTRA_DISCOUNTS)
    .map((entry) => ({ reason: String(entry?.reason ?? "").trim(), amount: Math.max(0, finite(entry?.amount) ?? 0) }))
    .filter((entry) => entry.reason || entry.amount > 0);
}

/**
 * What the client's copy prints of a saved quotation's discounts - read, never worked out again,
 * so the total it prints (the saved `amount`, which already has them taken off) and the lines it
 * lists above it are one calculation. The rupees the discount came to as `quotationTotals` stamped
 * them when the quotation was saved (`discountAmount`; worked out from the percentage only for a
 * payload that predates it), and each extra discount with an amount. Nothing at zero is listed.
 *
 * Rupees only, never the percentage: the client is told what comes off, not what share of the
 * price that is. The public API sends no percentage either (`clientFacingQuotation` in the
 * backend), so `discountAmount` is always present on what the client's page reads.
 */
export function quotationDiscountBreakdown(quotation) {
  const payload = quotation?.payload || {};
  const percent = Math.min(100, Math.max(0, finite(payload.discount) ?? finite(quotation?.discount) ?? 0));
  const gross = (finite(payload.subtotal) ?? finite(quotation?.subtotal) ?? 0) + Math.max(0, finite(payload.performanceCost) ?? 0);
  const amount = finite(payload.discountAmount) ?? (percent > 0 ? calculateDiscount({ discountValue: percent, discountableSubtotal: gross }).discountAmount : 0);
  const discount = amount > 0 ? { amount } : null;
  const extras = extraDiscountsOf(payload).filter((entry) => entry.amount > 0);
  return { discount, extras, any: Boolean(discount) || extras.length > 0 };
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
 * ── What the generator offers, and why the catalogue is always in it ──────────────────────────
 *
 * Settings → Project → Services is the list. Every active service in it is offered on every
 * brand's quotation, and a brand's own master is an **overlay** on the matching catalogue entry -
 * its name and its price - rather than a replacement for the whole list.
 *
 * It used to be a replacement: a brand holding any active master was offered those and nothing
 * else. That reading was safe only while the studio could see and edit the masters, and Quotation
 * Settings lost its Services, Deliverables, Packages and Pricing tabs at the studio's request. The
 * rows behind them stayed. So a brand configured before those screens went on answering with the
 * handful it had been given, every service added to Settings afterwards was invisible on that
 * brand's quotations, and there was no longer any screen that could change it - Corp offered five
 * services against a catalogue of ten, and the studio could do nothing about it.
 *
 * Overlaying instead of replacing is what makes Settings authoritative without losing anything the
 * generator already offers: a brand master still names the line and still stamps its price, and a
 * master naming no catalogue entry - a bespoke line, or one whose definition has since been
 * retired - is offered beside the catalogue rather than dropped. Nothing that could be picked
 * yesterday cannot be picked today; the services that were missing are simply there now.
 *
 * `usingCatalogue` says nothing of the brand's applied - the plain catalogue, exactly as it reads
 * in Settings.
 */
function offeredDefinitions(rows, catalogue, { idKey, linkKey, prefix }) {
  const configured = (rows || []).filter((row) => row?.isActive !== false);
  const list = catalogue || [];
  const catalogueIds = new Set(list.map((definition) => definition.id));
  // First by the brand's own order, so two masters naming one definition cannot disagree about
  // which name and price the line carries.
  const byDefinition = new Map();
  for (const row of configured) {
    const id = row?.[linkKey];
    if (id && catalogueIds.has(id) && !byDefinition.has(id)) byDefinition.set(id, row);
  }
  const definitions = list.map((definition) => {
    const row = byDefinition.get(definition.id);
    if (!row) return definition;
    return { ...definition, name: row.name || definition.name || "", [idKey]: row.id, brandDefaultPrice: finite(row.defaultPrice) };
  });
  /*
   * A master with no catalogue entry to sit on: one that names nothing (the plain priced line the
   * removed screens could add) or one whose definition has been retired out of the catalogue. It
   * stands on its own, under a made-up id the table can key, exactly as it always did.
   */
  const bespoke = configured
    .filter((row) => !row?.[linkKey] || !catalogueIds.has(row[linkKey]))
    .map((row) => ({
      ...(row.definition || { id: `${prefix}${row.id}`, quantityMode: "INTEGER", defaultQuantity: 1, remarksEnabled: true }),
      ...(row.definition ? {} : { id: `${prefix}${row.id}` }),
      name: row.name || row.definition?.name || "",
      [idKey]: row.id,
      brandDefaultPrice: finite(row.defaultPrice),
    }));
  return { usingCatalogue: !byDefinition.size && !bespoke.length, definitions: [...definitions, ...bespoke] };
}

/** The services a brand's generator offers: the catalogue, with the brand's own masters overlaid. */
export function brandServiceDefinitions(brandServices = [], catalogue = []) {
  return offeredDefinitions(brandServices, catalogue, { idKey: "brandServiceId", linkKey: "serviceDefinitionId", prefix: "brand-service:" });
}

/** The same for deliverables, which lost the same screen and carry the same rows behind it. */
export function brandDeliverableDefinitions(brandDeliverables = [], catalogue = []) {
  return offeredDefinitions(brandDeliverables, catalogue, { idKey: "brandDeliverableId", linkKey: "deliverableDefinitionId", prefix: "brand-deliverable:" });
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
