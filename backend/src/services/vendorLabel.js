/**
 * How a vendor is named wherever the application shows one: "EXT-Sudeep (DBS, Erode)" - the source
 * type and the vendor's name, then their business registration name and city in brackets. A part the
 * record does not have is left out ("EXT-Sudeep (Erode)", "EXT-Sudeep"), never shown as an empty
 * bracket. Written once here so every screen reads a vendor the same way; the frontend's copy is
 * `frontend/src/lib/vendorLabel.mjs` and the two must agree.
 */

/** What a Prisma `vendor` select needs for `vendorLabel` to read it. */
const VENDOR_LABEL_SELECT = { vendorName: true, sourceType: true, businessRegistrationName: true, city: true };

function vendorLabel(vendor) {
  const name = String(vendor?.vendorName || "").trim();
  if (!name) return null;
  const where = [vendor.businessRegistrationName, vendor.city].map((part) => String(part || "").trim()).filter(Boolean);
  return `${String(vendor.sourceType || "").trim() || "EXT"}-${name}${where.length ? ` (${where.join(", ")})` : ""}`;
}

module.exports = { VENDOR_LABEL_SELECT, vendorLabel };
