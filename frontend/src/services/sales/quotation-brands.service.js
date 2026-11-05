import { apiRequest } from "@/services/api/client";

/**
 * The three quotation brands and what each offers.
 *
 * `getQuotationBrandConfiguration` is what the Quotation Generator loads when a brand is picked,
 * and it is cached for the page: the same brand picked twice in one sitting, or two generators
 * opened in a row, read one response rather than four tables each time. The cache is dropped by
 * every admin write below - and by `forgetQuotationBrandConfiguration` - so a service added in
 * Settings is offered by the next generator opened without a reload.
 */

const configurationCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000;

export function getQuotationBrands({ includeInactive = false } = {}) {
  return apiRequest(`/api/sales/quotation-brands${includeInactive ? "?includeInactive=1" : ""}`);
}

export function getQuotationBrandConfiguration(code, { fresh = false } = {}) {
  const key = String(code || "").trim();
  const cached = configurationCache.get(key);
  if (!fresh && cached && cached.expiresAt > Date.now()) return cached.promise;
  const promise = apiRequest(`/api/sales/quotation-brands/${encodeURIComponent(key)}/configuration`)
    .catch((error) => { configurationCache.delete(key); throw error; });
  configurationCache.set(key, { promise, expiresAt: Date.now() + CACHE_TTL_MS });
  return promise;
}

export function forgetQuotationBrandConfiguration(code) {
  if (code) configurationCache.delete(String(code).trim());
  else configurationCache.clear();
}

// ---- Settings -> Quotation Settings (ADMIN / System Settings) ----

const admin = (code, path = "") => `/api/sales/quotation-brands/admin/${encodeURIComponent(code)}${path}`;

const write = (code, path, method, body) => apiRequest(admin(code, path), { method, body: body === undefined ? undefined : JSON.stringify(body) })
  .finally(() => forgetQuotationBrandConfiguration(code));

export function getQuotationBrandAdminConfiguration(code) {
  return apiRequest(admin(code));
}

/** The content every brand shares - Settings -> Quotation Settings -> General. */
export function getQuotationGeneralSettings() {
  return apiRequest("/api/sales/quotation-brands/admin/general");
}

export function updateQuotationGeneralSettings(data) {
  // Every brand prints it, so every brand's cached configuration is stale once it changes.
  return apiRequest("/api/sales/quotation-brands/admin/general", { method: "PATCH", body: JSON.stringify(data) })
    .finally(() => forgetQuotationBrandConfiguration());
}

export function updateQuotationBrand(code, data) {
  return write(code, "", "PATCH", data);
}

/*
 * There is nothing here for a brand's services, deliverables or packages, and the server has no
 * route for them either: the screens that managed those were removed at the studio's request and
 * these calls outlived them with nothing calling them. They are still *read* - the configuration
 * above returns them, and the generator prices off them where a brand has any.
 */

/*
 * The shoots a brand quotes for, maintained in Settings → Field Settings → Quotation → Shoot Type.
 *
 * Read through `getQuotationBrandConfiguration` above like everything else a brand offers - which is
 * what puts the same list behind the picture sets in Quotation Settings and the generator's Add
 * Shoot. These four only write it.
 */
export function createQuotationBrandShoot(code, data) {
  return write(code, "/shoots", "POST", data);
}

export function updateQuotationBrandShoot(code, id, data) {
  return write(code, `/shoots/${encodeURIComponent(id)}`, "PATCH", data);
}

export function deleteQuotationBrandShoot(code, id) {
  return write(code, `/shoots/${encodeURIComponent(id)}`, "DELETE");
}

export function reorderQuotationBrandShoots(code, ids) {
  return write(code, "/shoots/order", "PUT", { ids });
}

export function createQuotationBrandTerm(code, data) {
  return write(code, "/terms", "POST", data);
}

export function updateQuotationBrandTerm(code, id, data) {
  return write(code, `/terms/${encodeURIComponent(id)}`, "PATCH", data);
}

export function deleteQuotationBrandTerm(code, id) {
  return write(code, `/terms/${encodeURIComponent(id)}`, "DELETE");
}

export function reorderQuotationBrandTerms(code, ids) {
  return write(code, "/terms/order", "PUT", { ids });
}
