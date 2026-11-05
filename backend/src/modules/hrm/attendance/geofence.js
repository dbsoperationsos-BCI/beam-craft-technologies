/**
 * Was this person at work when they marked their day?
 *
 * Every function here is pure — coordinates and settings in, a verdict out — for the same reason
 * `attendanceRules.js` beside it is: this decides something about a named person that they may want
 * to argue with, and an argument is easier to settle against a test than against a controller.
 *
 * The module recorded latitude, longitude and accuracy on every login from the day it shipped and
 * then compared them to nothing, because no branch knew where its office was. This is the missing
 * half. It is deliberately forgiving by default: a branch with no office recorded has no geofence
 * rather than a failing one, and `enforceGeofence` starts off, so turning the circle on is a
 * decision the studio makes once the offices are in — not something that happens to everybody on
 * the morning this ships.
 */

/** Why a location could not be confirmed. The row stores the words, not just a false. */
const LOCATION_NOTES = {
  NO_OFFICE: "No office location is recorded for this branch, so the distance could not be checked.",
  NO_BRANCH: "This employee has no branch on their record, so there was nothing to measure against.",
  NO_FIX: "The browser did not report a position.",
  POOR_ACCURACY: "The position was too imprecise to judge.",
  OUTSIDE: "Outside the allowed attendance location.",
};

/** Metres per degree of latitude, and the earth's mean radius the haversine below is scaled by. */
const EARTH_RADIUS_METRES = 6371008.8;

const toRadians = (degrees) => (degrees * Math.PI) / 180;

/** A coordinate is only a coordinate if it is a real number inside the range the earth has. */
function isLatitude(value) {
  return Number.isFinite(Number(value)) && Math.abs(Number(value)) <= 90;
}

function isLongitude(value) {
  return Number.isFinite(Number(value)) && Math.abs(Number(value)) <= 180;
}

/**
 * Metres between two points, by the haversine formula.
 *
 * Haversine rather than the flat-earth approximation because the approximation needs a cosine of
 * latitude to not be wrong by a factor at the top of the country, and rather than Vincenty because
 * the ellipsoid's extra accuracy is measured in centimetres over a distance the answer is a
 * hundred-metre circle. Returns null when either point is not a point, so a caller cannot mistake
 * "could not measure" for "zero metres away", which is the one wrong answer that would read as a
 * pass.
 */
function distanceMetres(from, to) {
  if (!from || !to) return null;
  if (!isLatitude(from.latitude) || !isLongitude(from.longitude)) return null;
  if (!isLatitude(to.latitude) || !isLongitude(to.longitude)) return null;

  const lat1 = toRadians(Number(from.latitude));
  const lat2 = toRadians(Number(to.latitude));
  const deltaLat = lat2 - lat1;
  const deltaLon = toRadians(Number(to.longitude) - Number(from.longitude));

  const a = Math.sin(deltaLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
  return Math.round(2 * EARTH_RADIUS_METRES * Math.asin(Math.min(1, Math.sqrt(a))));
}

/** The circle this office actually enforces: its own radius, or the studio's default. */
function radiusFor(office, settings) {
  const own = Number(office?.allowedRadiusMeters);
  if (Number.isFinite(own) && own > 0) return Math.round(own);
  const fallback = Number(settings?.defaultRadiusMeters);
  return Number.isFinite(fallback) && fallback > 0 ? Math.round(fallback) : 0;
}

/**
 * Whether a reported position is precise enough to judge anybody by.
 *
 * A browser that says "somewhere within two kilometres" has not located a person, and calling that
 * "inside the office" would make the whole circle decorative — a phone indoors on wifi routinely
 * reports hundreds of metres. Accuracy that is absent is treated as unusable rather than as
 * perfect, for the same reason.
 */
function accuracyAcceptable(accuracyMetres, settings) {
  const limit = Number(settings?.maxGpsAccuracyMeters);
  if (!Number.isFinite(limit) || limit <= 0) return true;
  // `Number(null)` is 0, and 0 metres is the most accurate reading there is - so a browser that
  // reported no accuracy at all would otherwise pass the check perfectly. Only an actual number or
  // a string holding one is a reading; everything else is silence.
  if (typeof accuracyMetres !== "number" && typeof accuracyMetres !== "string") return false;
  if (typeof accuracyMetres === "string" && accuracyMetres.trim() === "") return false;
  const reported = Number(accuracyMetres);
  if (!Number.isFinite(reported) || reported < 0) return false;
  return reported <= limit;
}

/**
 * The whole verdict for one capture.
 *
 * `office` is the branch's active office location or null; `position` is what the browser reported.
 * Answers the row that gets stored — the branch measured against, the distance, whether it passed,
 * and the sentence saying why when it did not.
 *
 * `verified` is only ever true for a measured distance inside a real circle. Every other outcome —
 * no office, no branch, no fix, a fix too vague — is false with a note, never a pass by default.
 * Whether a false *refuses* the capture is a separate question, and `enforceGeofence` answers it;
 * this function does not, because the same verdict is recorded either way.
 */
function evaluateLocation({ office, branchId = null, position, settings } = {}) {
  const base = { branchId: office?.branchId ?? branchId ?? null, distanceMeters: null, verified: false, note: null };

  if (!isLatitude(position?.latitude) || !isLongitude(position?.longitude)) {
    return { ...base, note: LOCATION_NOTES.NO_FIX };
  }
  if (!branchId && !office) return { ...base, note: LOCATION_NOTES.NO_BRANCH };
  if (!office || office.isActive === false) return { ...base, note: LOCATION_NOTES.NO_OFFICE };

  const distance = distanceMetres(position, office);
  if (distance === null) return { ...base, note: LOCATION_NOTES.NO_OFFICE };

  // The distance is recorded whatever the accuracy — a reading of "1.2km away, ±800m" is still worth
  // keeping — but it is not allowed to confirm anybody.
  if (!accuracyAcceptable(position.accuracy, settings)) {
    return { ...base, distanceMeters: distance, note: LOCATION_NOTES.POOR_ACCURACY };
  }

  const radius = radiusFor(office, settings);
  if (!radius) return { ...base, distanceMeters: distance, note: LOCATION_NOTES.NO_OFFICE };
  if (distance > radius) return { ...base, distanceMeters: distance, note: LOCATION_NOTES.OUTSIDE };

  return { ...base, distanceMeters: distance, verified: true, note: null };
}

/**
 * Whether this verdict should stop the capture being recorded at all.
 *
 * Only when the studio has turned the circle on, and only for a capture that was actually measured
 * and found outside it. A branch with no office, or a phone that could not get a fix, is never a
 * refusal: that would punish somebody for a gap in the studio's own configuration, and the honest
 * record of it is an unverified capture for HR to look at.
 */
function refusesCapture(verdict, settings) {
  if (!settings?.enforceGeofence) return false;
  if (verdict?.verified) return false;
  return verdict?.note === LOCATION_NOTES.OUTSIDE;
}

module.exports = {
  EARTH_RADIUS_METRES,
  LOCATION_NOTES,
  accuracyAcceptable,
  distanceMetres,
  evaluateLocation,
  isLatitude,
  isLongitude,
  radiusFor,
  refusesCapture,
};
