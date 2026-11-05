/**
 * How a vendor is named wherever the application shows one: "EXT-Sudeep (DBS, Erode)" - the source
 * type and the vendor's name, then their business registration name and city in brackets. A part the
 * record does not have is left out ("EXT-Sudeep (Erode)", "EXT-Sudeep"), never shown as an empty
 * bracket. The server names vendors the same way (`backend/src/services/vendorLabel.js`).
 */
export function vendorLabel(vendor) {
  const name = String(vendor?.vendorName || "").trim();
  if (!name) return "";
  const where = [vendor.businessRegistrationName, vendor.city].map((part) => String(part || "").trim()).filter(Boolean);
  return `${String(vendor.sourceType || "").trim() || "EXT"}-${name}${where.length ? ` (${where.join(", ")})` : ""}`;
}
