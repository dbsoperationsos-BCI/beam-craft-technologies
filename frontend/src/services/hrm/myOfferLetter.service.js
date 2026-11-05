import { apiRequest } from "@/services/api/client";
import { downloadPdf } from "@/services/api/downloadPdf";

/*
 * My Profile → Offer Letter (`/api/hrm/my-offer-letter`): the signed-in employee's own offer letter,
 * for every employee by default. The server answers for this login's employee alone.
 */
const ROOT = "/api/hrm/my-offer-letter";

/** `{ status, availableOn, fileName, html }` - status READY, PENDING, NOT_SET or NO_JOINING_DATE. */
export function getMyOfferLetter() {
  return apiRequest(ROOT);
}

/** Downloads the letter as a PDF, under the name the server gives it. */
export function downloadMyOfferLetter({ fileName } = {}) {
  return downloadPdf(`${ROOT}/pdf`, fileName || "Offer-Letter.pdf", { fallback: "Unable to download your offer letter." });
}
