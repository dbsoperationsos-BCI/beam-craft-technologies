import { apiRequest } from "@/services/api/client";

/**
 * Settings → Employee → Certificate, behind `/api/settings/certificates` - an administrator's alone.
 *
 * `kind` is `experience` or `employment`. Each certificate's settings are `{ signatureUrl, note,
 * signatoryName, signatoryDesignation }`, and every answer carries `html`, the certificate's A4
 * preview as the server prints it (heading, logo and address as the payslip's).
 */
const base = "/api/settings/certificates";

export function getCertificateSettings(kind) {
  return apiRequest(`${base}/${kind}`);
}

/** Saves `{ signature, note, signatoryName, signatoryDesignation }`: `signature` a data image, the stored URL unchanged, or null to remove it. */
export function saveCertificateSettings(kind, payload) {
  return apiRequest(`${base}/${kind}`, { method: "PUT", body: JSON.stringify(payload) });
}

/** The preview for unsaved edits, as on screen. Nothing is stored. */
export function previewCertificateSettings(kind, payload) {
  return apiRequest(`${base}/${kind}/preview`, { method: "POST", body: JSON.stringify(payload) });
}

/**
 * Settings → Employee → Certificate → Offer Letter → When to generate: `{ generateAfterDays }`, how
 * many days after joining each employee's letter comes. Its sign-off and preview are the `offer` kind.
 */
export function getOfferLetterTiming() {
  return apiRequest(`${base}/offer-letter/timing`);
}

/** Sets when each employee's offer letter is generated: `{ generateAfterDays }` days after joining. */
export function saveOfferLetterTiming(payload) {
  return apiRequest(`${base}/offer-letter/timing`, { method: "PUT", body: JSON.stringify(payload) });
}

/** The offer letter's own sections after Employment Details and Compensation: `{ sections: [{ title, content }] }`. */
export function getOfferLetterSections() {
  return apiRequest(`${base}/offer-letter/sections`);
}

/** Replaces the offer letter's own sections with `{ sections }`, in that order. */
export function saveOfferLetterSections(payload) {
  return apiRequest(`${base}/offer-letter/sections`, { method: "PUT", body: JSON.stringify(payload) });
}

/** Which of Compensation's lines print: `{ monthlyGross, annualCtc, paymentDate, statutory, statutorySummary }`. */
export function saveOfferLetterCompensation(payload) {
  return apiRequest(`${base}/offer-letter/compensation`, { method: "PUT", body: JSON.stringify(payload) });
}

/** Which of Employment Details' lines print: `{ designation, department, employmentType, workLocation, reportingTo, dateOfJoining }`. */
export function saveOfferLetterEmployment(payload) {
  return apiRequest(`${base}/offer-letter/employment`, { method: "PUT", body: JSON.stringify(payload) });
}

/**
 * Reads a .docx into offer letter sections for review - `{ sections, warnings }`. Nothing is saved;
 * the review saves through `saveOfferLetterSections`. `file` is `{ name, data }` with `data` a data
 * URL, as the file field holds it.
 */
export async function importOfferLetterSections(file) {
  const blob = await (await fetch(file.data)).blob();
  const form = new FormData();
  form.append("file", blob, file.name);
  return apiRequest(`${base}/offer-letter/sections/import`, { method: "POST", body: form });
}

/** The letter drawn with `{ sections }` in place of the saved ones - `{ html }`. Nothing is saved. */
export function previewOfferLetterSections(payload) {
  return apiRequest(`${base}/offer-letter/sections/preview`, { method: "POST", body: JSON.stringify(payload) });
}
