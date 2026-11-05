/**
 * What a project's service and deliverable lines come to at their Settings prices - the figure
 * Create Project and Edit Sale Details put in Schedule Payment's **Signed Quotation** when no
 * quotation answers it.
 *
 * A project line stores no price: a project records the work, and the money was settled on a
 * quotation. A project booked without one had no figure at all, so Signed Quotation sat at ₹0 with
 * every schedule row a share of nothing. This prices each line the way the Quotation Generator does -
 * a service at its one Price, a deliverable at its variant's price, else its own pricing, else its
 * flat price - and totals them through the generator's own `quotationTotals`, so quantity, No. of
 * Count and complimentary lines are read by one rule, not two. No discount is applied: a project has
 * none to apply. A line nothing prices counts ₹0 and is counted in `unpriced`, never given a figure.
 *
 * Every definition is read **as Settings holds it now**, by the line's own id, from the catalogue
 * passed in; the copy a line carries answers only for one gone from the catalogue.
 *
 * Kept free of React so `node --test` can hold the rule.
 */

import { quotationTotals } from "./quotationBrand.mjs";
import { deliverablePriceForRow } from "./deliverablePricing.mjs";

const finite = (value) => (value === null || value === undefined || value === "" || !Number.isFinite(Number(value)) ? null : Number(value));
const fold = (value) => String(value ?? "").trim().toLowerCase();

/** A service line's unit price: the service's one Settings Price, or null where it has none. */
export function projectServiceUnitPrice(row, definition = row?.serviceDefinition) {
  return finite(definition?.price);
}

/**
 * A deliverable line's unit price, or null where Settings prices nothing for it.
 *
 * A pending line names its variant by id. A saved one keeps the variant's words instead - brand,
 * size, frame, length (see `deliverableRowVariant`) - and is matched on all four, so a line is never
 * given another variant's price. A chosen variant nobody has priced is ₹0, the generator's rule; a
 * line naming a variant that no longer exists is unpriced rather than priced as something else.
 */
export function projectDeliverableUnitPrice(row, definition = row?.deliverableDefinition, shoot = null) {
  if (!definition) return null;
  const variants = (definition.brands || []).flatMap((brand) => (brand.variants || []).map((variant) => ({ ...variant, brandName: brand.name || "" })));
  const named = Boolean(row?.deliverableVariantId || row?.brandName || row?.frameInches || row?.videoLength || (row?.size && !row?.sizeOptionValueId));
  if (named) {
    const variant = row.deliverableVariantId
      ? variants.find((candidate) => candidate.id === row.deliverableVariantId)
      : variants.find((candidate) => ["brandName", "size", "frameInches", "videoLength"].every((field) => fold(candidate[field]) === fold(row[field])));
    if (!variant) return null;
    return finite(variant.price) ?? 0;
  }
  return deliverablePriceForRow(definition, row, shoot) ?? finite(definition.price);
}

/**
 * The lines' total, and how many of them Settings prices nothing for.
 *
 * `services` and `deliverables` are the lines across every shoot; `serviceDefinitions` and
 * `deliverableDefinitions` the catalogue they are read from; `shoots` lets a full-length video be
 * priced by its shoot's session.
 */
export function projectLinesAmount({ services = [], deliverables = [], serviceDefinitions = [], deliverableDefinitions = [], shoots = [] } = {}) {
  const servicesById = new Map(serviceDefinitions.map((definition) => [definition.id, definition]));
  const deliverablesById = new Map(deliverableDefinitions.map((definition) => [definition.id, definition]));
  const shootsById = new Map(shoots.map((shoot) => [shoot.id, shoot]));
  let unpriced = 0;
  const pricedServices = services.map((row) => {
    const definition = servicesById.get(row.serviceDefinitionId) || row.serviceDefinition || null;
    const unitPrice = projectServiceUnitPrice(row, definition);
    if (unitPrice === null && row.complimentary !== true) unpriced += 1;
    return { ...row, serviceDefinition: definition, unitPrice: unitPrice ?? 0 };
  });
  const pricedDeliverables = deliverables.map((row) => {
    const definition = deliverablesById.get(row.deliverableDefinitionId) || row.deliverableDefinition || null;
    const unitPrice = projectDeliverableUnitPrice(row, definition, shootsById.get(row.shootId) || null);
    if (unitPrice === null && row.complimentary !== true) unpriced += 1;
    return { ...row, deliverableDefinition: definition, unitPrice: unitPrice ?? 0 };
  });
  const { amount } = quotationTotals({ services: pricedServices, deliverables: pricedDeliverables, rates: {} });
  return { amount, unpriced };
}
