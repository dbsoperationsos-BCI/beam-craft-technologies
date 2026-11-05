/*
 * A shoot held at more than one place - the Add / Edit Shoot dialog's Location: Multiple.
 *
 * Several shoots ticked together are one shoot named for all of them, "Haldi + Mehandi". When they
 * are at different places, `shootLocations` holds one `{ shoot, shootPlace, district, state }` per
 * name, in the name's order. `shootPlace` holds the places joined the way the name is, one per
 * name - "Haldi + Mehandi" at "Chennai + Madurai" - so every screen reading one place shows each
 * shoot's place beside its name; `district` and `state` hold each one once.
 * The server keeps the same rule (`backend/src/services/shootLocations.js`) and is the authority;
 * this is what the dialog shows before it saves. Kept free of React so `node --test` can hold it.
 */

export const SHOOT_NAME_SEPARATOR = " + ";
export const SHOOT_PLACE_MAX_LENGTH = 191;
export const LOCATION_MODES = ["Single", "Multiple"];

/** The names a shoot is made of: "Haldi + Mehandi" is Haldi and Mehandi. */
export function shootNamesOf(shoot) {
  return String(shoot || "").split(SHOOT_NAME_SEPARATOR).map((name) => name.trim()).filter(Boolean);
}

/** A saved shoot's own locations, or [] where it is held at one place. */
export function savedShootLocations(shoot) {
  const locations = Array.isArray(shoot?.shootLocations) ? shoot.shootLocations : [];
  return locations.length > 1 ? locations : [];
}

// District and State each once, in the order first given: two shoots in Chennai is one Chennai.
const joined = (values) => [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))].join(SHOOT_NAME_SEPARATOR);

/** The three columns' values for a shoot held at several places. */
export function shootLocationsSummary(locations) {
  return {
    // One place per name, in the name's order - repeats kept - so "Haldi + Mehandi" at
    // "Chennai + Chennai" still says where each shoot is, read side by side with the name.
    shootPlace: locations.map((location) => String(location.shootPlace || "").trim()).join(SHOOT_NAME_SEPARATOR),
    district: joined(locations.map((location) => location.district)),
    state: joined(locations.map((location) => location.state)),
  };
}

/**
 * One location per name, from what was typed for each (`byShoot`, keyed by the name), trimmed.
 * Blank district or state is null, as the server stores it.
 */
export function shootLocationsFor(names, byShoot) {
  return names.map((name) => {
    const typed = byShoot?.[name] || {};
    return {
      shoot: name,
      shootPlace: String(typed.shootPlace || "").trim(),
      district: String(typed.district || "").trim() || null,
      state: String(typed.state || "").trim() || null,
    };
  });
}

/** Why these locations cannot be saved, or "". */
export function shootLocationsError(locations) {
  const missing = locations.find((location) => !location.shootPlace);
  if (missing) return `Enter the Shoot Place for ${missing.shoot}.`;
  const summary = shootLocationsSummary(locations);
  if (summary.shootPlace.length > SHOOT_PLACE_MAX_LENGTH) return `Those Shoot Places are too long together (${summary.shootPlace.length} characters, and ${SHOOT_PLACE_MAX_LENGTH} is the most a shoot's place can hold). Shorten them, or add the shoots separately.`;
  if (summary.district.length > SHOOT_PLACE_MAX_LENGTH || summary.state.length > SHOOT_PLACE_MAX_LENGTH) return "Those districts or states are too long together. Add the shoots separately instead.";
  return "";
}
