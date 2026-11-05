import { apiRequest } from "@/services/api/client";

/**
 * The one call a selection makes, against whatever prefix the module mounts.
 *
 * Written once for the same reason `tableImport.service.js` beside it is: every table's bulk delete
 * asks the same question - "here are the ids I ticked" - and the endpoint is the same shape under
 * every prefix by construction (`services/bulkDelete.js` on the server, mounted by
 * `mountBulkDelete`). A module wiring its own by hand is a module whose selection bar stops matching
 * the others the first time one of them changes.
 *
 * Answers `{ deletedIds, missedIds }`. Both matter: the bar clears the ticks on the rows that went
 * and leaves them on the rows that did not, so a second press retries exactly the part that failed
 * rather than the whole selection again.
 */
export const deleteTableRows = (prefix, ids, extra) =>
  // `extra` is whatever else that module's delete asks for alongside the ids - a vendor and a client
  // storage record each want the reason they are being removed, and it is the same reason for the
  // whole selection. It travels in the body beside `ids`, where the module's own `deleteInput`
  // schema already reads it.
  apiRequest(`${prefix}/bulk`, { method: "DELETE", body: JSON.stringify({ ids, ...(extra || {}) }) });
