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

/** Where a client's sign-in lands: its own page, outside the studio's shell. */
export const CLIENT_ROUTE = "/client";

/**
 * The client website (the Beam Craft client app, as a website), when the studio runs one: a client's
 * sign-in on these pages is handed to it, so the one login page serves clients and the team alike.
 * Unset, a client's sign-in stays on `/client` here, as before.
 */
export const CLIENT_WEB_URL = (process.env.NEXT_PUBLIC_CLIENT_WEB_URL || "").replace(/\/$/, "");
// Whether the client is still on the studio's password - from the login's answer, for the hand-over.
const CLIENT_MUST_CHANGE_KEY = "dbs_client_must_change_password";

/** Notes, for the hand-over, whether this sign-in is still on the studio's password. */
export function rememberClientSignIn(data) {
  try {
    window.sessionStorage.setItem(CLIENT_MUST_CHANGE_KEY, (data?.user || data?.data?.user)?.mustChangePassword ? "1" : "0");
  } catch {
    // Not remembered: the website asks for the current password when the client changes it.
  }
}

/**
 * Sends a signed-in client to the client website with their sign-in (in the address's fragment, which
 * never reaches a server), and signs them out of these pages. False when there is no website set or
 * nobody signed in - the caller carries on as before.
 */
export function handOffToClientWeb() {
  if (!CLIENT_WEB_URL || typeof window === "undefined") return false;
  const token = getAccessToken();
  if (!token) return false;
  let mustChange = false;
  try {
    mustChange = window.sessionStorage.getItem(CLIENT_MUST_CHANGE_KEY) === "1";
    window.sessionStorage.removeItem(CLIENT_MUST_CHANGE_KEY);
  } catch {
    // Read as not.
  }
  clearAccessToken();
  window.location.replace(`${CLIENT_WEB_URL}/handoff#token=${encodeURIComponent(token)}${mustChange ? "&mustChangePassword=1" : ""}`);
  return true;
}

/** Where a client signs in - the link their login message carries, and where signing out returns them. */
export const CLIENT_LOGIN_ROUTE = "/client/login";

/**
 * A client's sign-in (Create Project → Client Credentials), read from the token's `role`. Only for
 * routing it to its own page - the API refuses a client everything else whatever the browser does.
 */
export function isClientAccount(user = getAuthenticatedUser()) {
  return user?.role === "CLIENT";
}

/** Where signing in lands: the studio's landing screen, or a client's own page. */
export function getDefaultAuthenticatedRoute() {
  // Beam Craft opens on Client Details: the clients are what the studio works on first.
  return isClientAccount() ? CLIENT_ROUTE : "/hrm/client-details";
}
