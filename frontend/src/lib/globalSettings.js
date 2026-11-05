export const OPEN_GLOBAL_SETTINGS_EVENT = "dbs:open-global-settings";
export const TABLE_SETTINGS_SAVED_EVENT = "dbs:table-settings-saved";

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
