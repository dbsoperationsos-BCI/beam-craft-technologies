/**
 * Whether Settings prices a quotation line on its own shoot - and, where it does not, what to say.
 *
 * A service has one price in Settings, quoted on every shoot it is added to. A service with none -
 * one that used to be priced only per Shoot Type and Session Timing, until its single Price is
 * entered - comes to ₹0, since nothing invents a price for it, and this is what lets the screen say
 * so, on the line and in the summary, rather than leave a shoot looking as if it were never counted.
 *
 * Read from the service **as Settings holds it now** - `live`, the catalogue's entry for the line's
 * service id - and the line's shoot. Not from the definition frozen onto the line when its quotation
 * was saved: a reopened quotation's lines carry the service as it stood then, which may be from
 * before its price was entered, so reading that copy said "Not priced in Settings" about a service
 * Settings prices today. The frozen copy answers only for a service no longer in the
 * catalogue.
 *
 * And never about a line that carries a price: "Not priced" is said only of a line that counts ₹0.
 * A line saved with ₹0 is still asked of Settings, since ₹0 alone cannot tell "unpriced" from
 * "free". A line a package prices, or one marked complimentary, is priced by that.
 *
 * Kept free of React so `node --test` can hold the rule.
 */

import { deliverablePriceForRow } from "./deliverablePricing.mjs";

const finite = (value) => (value === null || value === undefined || value === "" || !Number.isFinite(Number(value)) ? null : Number(value));

/** Null where Settings prices this service line; otherwise the note to show. */
export function unpricedServiceNote(row, shoot, live = null) {
  if (!row || row.packageId || row.complimentary === true) return null;
  if ((finite(row.unitPrice) ?? 0) > 0) return null;
  const definition = live || row.serviceDefinition;
  if (!definition) return null;
  if (finite(definition.price) !== null || finite(definition.brandDefaultPrice) !== null) return null;
  return "Not priced in Settings";
}

/** Null where Settings prices this deliverable line; otherwise the note to show. */
export function unpricedDeliverableNote(row, shoot, live = null) {
  if (!row || row.packageId || row.complimentary === true) return null;
  if ((finite(row.unitPrice) ?? 0) > 0) return null;
  const definition = live || row.deliverableDefinition;
  if (!definition) return null;
  // A variant is its own price, and the studio has chosen that an unpriced variant is quoted at ₹0.
  if (row.deliverableVariantId) return null;
  if (finite(definition.price) !== null || finite(definition.brandDefaultPrice) !== null) return null;
  if (deliverablePriceForRow(definition, row, shoot) !== null) return null;
  return "Not priced in Settings";
}
