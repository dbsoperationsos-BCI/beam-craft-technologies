export const TOKEN_STORAGE_KEY = "dbs_access_token";
export const AUTH_EXPIRED_EVENT = "dbs-auth-expired";

export function getAccessToken() {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_STORAGE_KEY);
}

export function setAccessToken(token) {
  if (typeof window !== "undefined") window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
}

export function clearAccessToken() {
  if (typeof window !== "undefined") window.localStorage.removeItem(TOKEN_STORAGE_KEY);
}

export function hasAccessToken() {
  return Boolean(getAuthenticatedUser());
}

export function getAuthenticatedUser() {
  const token = getAccessToken();
  if (!token || typeof window === "undefined") return null;
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padding = "=".repeat((4 - (normalized.length % 4)) % 4);
    const user = JSON.parse(window.atob(`${normalized}${padding}`));
    if (typeof user.exp !== "number" || user.exp * 1000 <= Date.now()) return null;
    return user;
  } catch {
    return null;
  }
}

/** Where signing in lands. One place for everybody now that the Technical dashboard is gone. */
export function getDefaultAuthenticatedRoute() {
  return "/employees";
}
