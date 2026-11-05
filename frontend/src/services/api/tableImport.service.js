import { apiRequest } from "@/services/api/client";

/**
 * The two calls every module's import makes, against whatever prefix that module mounts.
 *
 * Written once because every importer answers the same two questions - "what should the file look
 * like" and "here are some of its rows" - and the endpoints are the same shape under every prefix
 * by construction (`services/tableImport.js` on the server). A module that wired its own pair by
 * hand is a module whose dialog stops matching the others the first time one of them changes.
 */
export const getImportTemplate = (prefix) => apiRequest(`${prefix}/import/template`);

export const importTableRows = (prefix, { headers, rows, startRow }) =>
  apiRequest(`${prefix}/import`, { method: "POST", body: JSON.stringify({ headers, rows, startRow }) });
