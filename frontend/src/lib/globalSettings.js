export const OPEN_GLOBAL_SETTINGS_EVENT = "dbs:open-global-settings";
export const TABLE_SETTINGS_SAVED_EVENT = "dbs:table-settings-saved";

/*
 * Settings is an overlay on whatever page is open, not a page of its own, so a reload used to drop
 * it and leave the reader on the page underneath. The open section is kept in the address instead -
 * `/admin/activity-logs?settings=activity-log-purge` - so a reload, Back from another tab or a shared
 * link opens Settings on the same section again. Written with `replaceState`: moving between
 * sections is not a page of history to step back through.
 */
export const SETTINGS_URL_PARAM = "settings";

/** The Settings section the address names, or null. */
export function settingsSectionInUrl() {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get(SETTINGS_URL_PARAM) || null;
}

/** Puts the open section into the address, or takes it out when Settings closes (`null`). */
export function rememberSettingsSection(section) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (section) url.searchParams.set(SETTINGS_URL_PARAM, section);
  else url.searchParams.delete(SETTINGS_URL_PARAM);
  if (url.href !== window.location.href) window.history.replaceState(window.history.state, "", url);
}

export function openGlobalSettings(detail = {}) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(OPEN_GLOBAL_SETTINGS_EVENT, { detail }));
}

export function announceTableSettingsSaved(vertical, fields) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(TABLE_SETTINGS_SAVED_EVENT, {
    detail: { vertical, fields },
  }));
}
