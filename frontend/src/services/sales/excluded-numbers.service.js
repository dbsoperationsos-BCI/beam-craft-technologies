import { apiRequest } from "@/services/api/client";

/**
 * The numbers the CRM must never make a lead out of.
 *
 * Staff, their families, suppliers, the office landline. The Callyzer webhook reads this list on
 * every delivery and sets those calls aside before a lead is built, so a number added here stops
 * producing enquiries straight away. The call itself is still recorded - what it no longer does is
 * create somebody to ring back.
 */

const ROOT = "/api/sales/crm-leads/excluded-numbers";

/** Every excluded number, with the count and the ceiling the server enforces. */
export function getExcludedNumbers() {
  return apiRequest(ROOT);
}

export function addExcludedNumber({ name, number }) {
  return apiRequest(ROOT, { method: "POST", body: JSON.stringify({ name, number }) });
}

export function updateExcludedNumber(id, { name, number }) {
  return apiRequest(`${ROOT}/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify({ name, number }) });
}

export function removeExcludedNumber(id) {
  return apiRequest(`${ROOT}/${encodeURIComponent(id)}`, { method: "DELETE" });
}

/** Several at once, which is what the table's checkboxes select for. */
export function removeExcludedNumbers(ids) {
  return apiRequest(`${ROOT}/bulk`, { method: "DELETE", body: JSON.stringify({ ids }) });
}

/**
 * A pasted list, added in one go.
 *
 * Answers with `{ added, skipped, failed }` rather than failing at the first bad line: a list of two
 * hundred numbers with one typo in it adds a hundred and ninety-nine and says which line was wrong.
 */
export function importExcludedNumbers(entries) {
  return apiRequest(`${ROOT}/import`, { method: "POST", body: JSON.stringify({ entries }) });
}
