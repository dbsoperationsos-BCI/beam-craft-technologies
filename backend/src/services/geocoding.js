/**
 * Turning coordinates into an address.
 *
 * Used by Employee Attendance, where "11.351332, 77.691160" tells somebody reviewing a day nothing
 * they can act on. Nominatim (OpenStreetMap) rather than a paid provider: no key, no billing, and
 * one lookup per check-in is comfortably inside what it is meant for.
 *
 * Three rules shape everything below, and all three come from the same place — this is a courtesy
 * service run for free, and an employee's precise position is not ours to leak.
 *
 *  1. **It never blocks a capture.** The caller resolves an address *after* the attendance row is
 *     safely written, and a geocoder that is slow, rate-limited or down costs an address and never
 *     an attendance record.
 *  2. **At most one request per second, process-wide.** Nominatim's usage policy says so plainly.
 *     Requests queue behind each other rather than going out together, which is why rule 1 matters:
 *     fifty people checking in at half past nine must not each wait their turn before being told
 *     they are logged in.
 *  3. **It identifies itself.** The policy requires a User-Agent naming the application, and asks
 *     for a contact address. `GEOCODING_CONTACT_EMAIL` supplies one; without it the request still
 *     names the application, and the server says once that it should be set.
 */

const BASE_URL = (process.env.NOMINATIM_BASE_URL || "https://nominatim.openstreetmap.org").replace(/\/+$/, "");
const CONTACT = (process.env.GEOCODING_CONTACT_EMAIL || "").trim();
const ENABLED = String(process.env.GEOCODING_ENABLED ?? "true").toLowerCase() !== "false";
/** Long enough for a courtesy service having a slow moment, short enough not to pile up a queue. */
const TIMEOUT_MS = Number(process.env.GEOCODING_TIMEOUT_MS) || 5000;
const MIN_GAP_MS = 1100;

let warnedNoContact = false;
/** The tail of the request queue. Every lookup chains onto it, so two never overlap. */
let queue = Promise.resolve();
let lastCallAt = 0;

function userAgent() {
  if (!CONTACT && !warnedNoContact) {
    warnedNoContact = true;
    console.warn("[geocoding] GEOCODING_CONTACT_EMAIL is not set. Nominatim's usage policy asks for a contact address in the User-Agent; set one before relying on this in production.");
  }
  return `DBS-Operations-OS/1.0 (attendance address lookup${CONTACT ? `; ${CONTACT}` : ""})`;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Formats Nominatim's `address` object into one readable line.
 *
 * Its `display_name` is not used: it runs to eight or nine comma-separated parts ending in the
 * country and the postcode, which is a paragraph rather than a label. This picks the parts somebody
 * would actually say — the road, the locality, the district, the state — and drops the rest.
 */
function formatAddress(payload) {
  const address = payload?.address;
  if (!address) return typeof payload?.display_name === "string" ? payload.display_name.slice(0, 300) : null;

  const parts = [
    address.road || address.pedestrian || address.neighbourhood || address.suburb,
    address.village || address.town || address.city || address.municipality,
    address.state_district || address.county,
    address.state,
    address.postcode,
  ];

  // De-duplicated in order: Nominatim often repeats a name across levels — a town that is also its
  // own district — and "Erode, Erode, Tamil Nadu" reads like a mistake.
  const seen = new Set();
  const line = parts
    .filter(Boolean)
    .map((part) => String(part).trim())
    .filter((part) => { const key = part.toLowerCase(); if (seen.has(key)) return false; seen.add(key); return true; })
    .join(", ");

  return line ? line.slice(0, 300) : (typeof payload.display_name === "string" ? payload.display_name.slice(0, 300) : null);
}

/**
 * The address for a point, or null.
 *
 * Never throws. Every failure — disabled, bad input, a timeout, a rate-limit, a broken payload —
 * answers null, because the only caller is writing an optional column and the alternative is an
 * exception thrown after a successful check-in.
 */
async function reverseGeocode(latitude, longitude) {
  if (!ENABLED) return null;
  // `Number(null)` is 0, and 0,0 is a real place in the Atlantic — so a capture that reported no
  // position would otherwise be geocoded to Null Island and have that stored as its address. Only
  // an actual number, or a string holding one, is a coordinate.
  const isScalar = (value) => (typeof value === "number" || (typeof value === "string" && value.trim() !== ""));
  if (!isScalar(latitude) || !isScalar(longitude)) return null;
  const lat = Number(latitude);
  const lon = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;

  const run = async () => {
    const wait = lastCallAt + MIN_GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastCallAt = Date.now();

    const url = `${BASE_URL}/reverse?format=jsonv2&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&zoom=18&addressdetails=1`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(url, { signal: controller.signal, headers: { "User-Agent": userAgent(), Accept: "application/json" } });
      if (!response.ok) {
        console.warn(`[geocoding] reverse lookup answered ${response.status}`);
        return null;
      }
      return formatAddress(await response.json());
    } catch (error) {
      console.warn(`[geocoding] reverse lookup failed: ${error.name === "AbortError" ? `no answer in ${TIMEOUT_MS}ms` : error.message}`);
      return null;
    } finally {
      clearTimeout(timer);
    }
  };

  // Chained onto the queue so requests are serialised, and detached from its failures so one bad
  // lookup cannot poison every lookup after it.
  const result = queue.then(run, run);
  queue = result.then(() => undefined, () => undefined);
  return result;
}

module.exports = { formatAddress, reverseGeocode, MIN_GAP_MS };
