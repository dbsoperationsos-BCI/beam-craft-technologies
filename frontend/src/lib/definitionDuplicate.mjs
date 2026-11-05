/**
 * What a duplicated deliverable is created with, beyond what its dialog shows.
 *
 * More → Duplicate opens the Add Deliverable dialog filled from the deliverable being copied, name
 * left empty. The dialog sends only what it asks - an edit leaves everything else on the row as it
 * is, so it never had to send more - but a duplicate is a new row, and what the dialog does not ask
 * would otherwise start blank on it: the shoot type and timings a project's picker narrows by, the
 * usual duration, the flat price and size list an older deliverable is priced by, and the one brand
 * and size a deliverable sold by nobody was given before brands existed.
 *
 * So those are carried from the source, and what the dialog sends is laid over them - the dialog's
 * own answer always wins. Only plain values are copied, never an id, a code or a timestamp; arrays
 * are copied rather than shared, so nothing the new row holds is the source's own object.
 *
 * Kept free of React so `node --test` can hold it, the way `servicePricing.mjs` is.
 */

const copy = (value) => (Array.isArray(value) ? [...value.map((item) => (item && typeof item === "object" ? { ...item } : item))] : value);

export function duplicateDeliverableValues(source, values) {
  if (!source) return values;
  const carried = {
    price: source.price ?? null,
    sizeOptionSetId: source.sizeOptionSetId ?? null,
    shootTypes: copy(source.shootTypes ?? null),
    timingModes: copy(source.timingModes ?? null),
    defaultDurationHours: source.defaultDurationHours ?? null,
    defaultDurationMinutes: source.defaultDurationMinutes ?? null,
  };
  const hasBrands = (source.brands || []).some((brand) => String(brand?.name ?? "").trim() || (brand?.variants || []).length);
  // The server rewrites these four from the first brand's first variant whenever there are brands,
  // so they are the source's own words only on a deliverable sold by nobody.
  if (!hasBrands) {
    Object.assign(carried, { brandName: source.brandName ?? null, imageSize: source.imageSize ?? null, videoLength: source.videoLength ?? null, frameInches: source.frameInches ?? null });
  }
  // A type never answered keeps the per-kind pricing it was priced under; the dialog sends the
  // type, and clears that pricing, only once it is answered.
  if (!source.mediaType) Object.assign(carried, { kind: source.kind ?? null, pricing: copy(source.pricing ?? null) });
  return { ...carried, ...values };
}
