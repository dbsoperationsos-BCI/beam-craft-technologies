import { apiRequest } from "@/services/api/client";

/**
 * The application's contact directory.
 *
 * Not a Sales service, though the screen sits in the Sales & CRM section: the rows come from every
 * module that keeps a phone number - HR, the CRM, projects, galleries, accounts and vendors - so it
 * answers to `/api/contacts` rather than to any one module's prefix.
 *
 * Nothing is stored behind it. A contact is what a phone number's records add up to, so the server
 * reads the modules' own tables live and the directory can never fall out of step with them.
 */

const ROOT = "/api/contacts";

/**
 * Every contact the signed-in user may read.
 *
 * The server includes a module's numbers only when the viewer holds that module's own Read
 * permission, so the answer is already scoped to them; `sources` in the response names the modules
 * it was actually built from.
 */
export function getContacts({ limit } = {}) {
  const query = limit ? `?limit=${encodeURIComponent(limit)}` : "";
  return apiRequest(`${ROOT}${query}`);
}
