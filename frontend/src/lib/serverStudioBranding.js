/*
 * The studio's public branding, read on the server for what the page's `<head>` must carry before
 * any script runs - the tab icons. The same public endpoint the browser reads
 * (`useStudioBranding`), cached for a minute so a page render does not cost a request each time,
 * and given two seconds at most: a slow or unreachable API leaves the bundled mark in place rather
 * than holding up the page. Null when it cannot be read.
 */
// The same address `services/api/client.js` reads, without importing it: that module is the
// browser's request helper and brings the browser's sign-in state with it.
const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5001";
const REVALIDATE_SECONDS = 60;
const TIMEOUT_MS = 2000;

export async function serverStudioBranding() {
  try {
    const response = await fetch(`${API_URL}/api/public/studio-branding`, { next: { revalidate: REVALIDATE_SECONDS }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) return null;
    return (await response.json())?.data || null;
  } catch {
    return null;
  }
}

/** What the installed app is called when the studio has not named itself in Settings. */
export const BUNDLED_APP_NAME = "DBS Operations OS";
export const BUNDLED_APP_SHORT_NAME = "DBS OS";

/** The studio's name from Settings → Branding, or null. */
export function studioAppName(branding) {
  const name = typeof branding?.studioName === "string" ? branding.studioName.trim() : "";
  return name || null;
}

// A short, stable fingerprint of the favicon, put in the icon's address so a new upload is a new
// address - browsers and the device keep an icon they have already fetched.
function fingerprint(value) {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) hash = ((hash * 33) ^ value.charCodeAt(index)) >>> 0;
  return hash.toString(36);
}

/**
 * Where the installed app's icon at `variant` comes from: drawn by the API from the studio's
 * favicon when one is set, otherwise the bundled PNG of the same name in `public/icons`. The API
 * sends the bundled icon itself if it cannot draw the favicon, so either address always answers.
 */
export function appIconUrl(branding, variant) {
  const favicon = typeof branding?.faviconUrl === "string" ? branding.faviconUrl.trim() : "";
  if (!favicon) return `/icons/${variant}.png`;
  return `${API_URL}/api/public/app-icon/${variant}.png?v=${fingerprint(favicon)}`;
}
