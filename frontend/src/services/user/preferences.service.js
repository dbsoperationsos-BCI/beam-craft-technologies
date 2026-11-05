import { apiRequest } from "@/services/api/client";

/*
 * The signed-in account's own arrangement of the application - column order, hidden columns, frozen
 * columns, column widths, density, remembered tabs - kept on the server so it follows the person to
 * whatever machine they sign in on.
 *
 * Read once per session by `PreferencesProvider`, which is the only thing that should call these:
 * a request behind every table on the screen is exactly what the provider exists to avoid.
 */

/** Everything this login has saved, as one object keyed the way it was saved. */
export const getMyPreferences = () => apiRequest("/api/user/preferences");

/** One preference, saved. The key names what it is; the server decides what shape it may hold. */
export const saveMyPreference = (key, value) =>
  apiRequest(`/api/user/preferences/${encodeURIComponent(key)}`, {
    method: "PUT",
    body: JSON.stringify({ value }),
  });

/** Forgets one preference - the Reset column order item, and anything like it added later. */
export const clearMyPreference = (key) =>
  apiRequest(`/api/user/preferences/${encodeURIComponent(key)}`, { method: "DELETE" });
