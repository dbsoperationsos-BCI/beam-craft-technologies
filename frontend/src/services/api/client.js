import { AUTH_EXPIRED_EVENT, clearAccessToken, getAccessToken } from "@/lib/auth";

const CONFIGURED_API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5001";
const LOOPBACK = new Set(["localhost", "127.0.0.1"]);

/*
 * The API address, as this browser can reach it.
 *
 * Local development points NEXT_PUBLIC_API_URL at localhost. A phone on the same Wi-Fi opens the app
 * at the Mac's network address, and to the phone "localhost" is the phone - so a page served from
 * any other host asks the API on that same host instead. That keeps phone testing working however
 * often the Wi-Fi hands the Mac a new address, with nothing to edit. A real deployment names a real
 * API host, which is never a loopback, and is used exactly as configured; so is the server side.
 */
function resolveApiUrl() {
  if (typeof window === "undefined") return CONFIGURED_API_URL;
  try {
    const url = new URL(CONFIGURED_API_URL);
    const page = window.location.hostname;
    if (LOOPBACK.has(url.hostname) && page && !LOOPBACK.has(page)) {
      url.hostname = page;
      return url.origin;
    }
  } catch {
    // Not a URL we can read - use it as given, and let the request say what went wrong.
  }
  return CONFIGURED_API_URL;
}

export const API_URL = resolveApiUrl();

export async function apiRequest(path, options = {}) {
  const headers = new Headers(options.headers);
  const token = getAccessToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  // FormData sets its own Content-Type, including the multipart boundary that the server needs to
  // split the parts. Naming the type here would send it without one, and every field would be lost.
  const isFormData = typeof FormData !== "undefined" && options.body instanceof FormData;
  if (options.body && !isFormData && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  let response;
  try {
    response = await fetch(`${API_URL}${path}`, { ...options, headers });
  } catch (cause) {
    // Names the address it tried. "Unable to reach the API service." on its own reads as a fault in
    // the app, when every cause is outside it: the backend is not running, it is on another port
    // than NEXT_PUBLIC_API_URL says, or the machine is offline. The URL is the one thing that tells
    // those apart, and it is already public - it is compiled into the bundle.
    const error = new Error(`Unable to reach the API service at ${API_URL}. Check that the backend is running.`);
    error.code = "NETWORK_ERROR";
    error.cause = cause;
    throw error;
  }

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    // A 401 raised because the linked Google account needs re-authorising is not the user's
    // own session expiring. Signing them out of the app for it would lose their place and
    // still not fix the Google connection, so it is left to the caller to prompt for.
    const message = String(data?.message || "").toLowerCase();
    const isGoogleReconnectRequired =
      data?.code === "GOOGLE_RECONNECT_REQUIRED" ||
      message.includes("google authorization has expired") ||
      message.includes("google connection expired") ||
      message.includes("please reconnect your google account");
    if (response.status === 401 && typeof window !== "undefined" && !isGoogleReconnectRequired) {
      clearAccessToken();
      window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
    }
    const error = new Error(data?.message || `Request failed with status ${response.status}`);
    error.data = data;
    error.status = response.status;
    throw error;
  }
  return data;
}
