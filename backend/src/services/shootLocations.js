const { z } = require("zod");
const { Prisma } = require("@prisma/client");

/*
 * A shoot held at more than one place - the Add / Edit Shoot dialog's Location: Multiple.
 *
 * Several shoots ticked together are one shoot named for all of them, "Haldi + Mehandi". Most are
 * one sitting at one place, which `shootPlace`, `district` and `state` hold as they always have.
 * When the names are at different places, `shoot_locations` holds one `{ shoot, shootPlace,
 * district, state }` per name, in the order of the name. `shoot_place` holds the places joined the
 * way the name is, one per name - "Haldi + Mehandi" at "Chennai + Madurai" - so every screen that
 * reads one place (Pre Production, Production, the calendar, Client Storage) shows each shoot's
 * place beside its name; `district` and `state` hold each one once. Null is one place.
 */

const SEPARATOR = " + ";
const COLUMN_MAX = 191;

const optionalText = z.string().trim().max(COLUMN_MAX).nullable().optional();
const shootLocationsSchema = z.array(z.object({
  shoot: z.string().trim().min(1).max(COLUMN_MAX),
  shootPlace: z.string().trim().min(1, "Enter the Shoot Place for every shoot.").max(COLUMN_MAX),
  district: optionalText,
  state: optionalText,
})).max(50).nullable().optional();

const namesOf = (shoot) => String(shoot || "").split(SEPARATOR).map((name) => name.trim()).filter(Boolean);
// District and State each once, in the order first given: two shoots in Chennai is one Chennai.
const joined = (values) => [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))].join(SEPARATOR);

/** Why a shoot's locations cannot be saved, or "" - one per name of the shoot, in the name's order. */
function shootLocationsIssue(data) {
  const locations = data?.shootLocations;
  if (!Array.isArray(locations) || !locations.length) return "";
  const names = namesOf(data.shoot);
  if (names.length < 2) return "Only a shoot made of several shoots can have a location for each.";
  if (locations.length !== names.length || locations.some((location, index) => location.shoot !== names[index])) {
    return "Give every shoot in the name a location of its own.";
  }
  const summary = shootLocationsSummary(locations);
  if (summary.shootPlace.length > COLUMN_MAX) return `Those Shoot Places are too long together (${summary.shootPlace.length} characters, and ${COLUMN_MAX} is the most a shoot's place can hold). Shorten them, or add the shoots separately.`;
  if (summary.district.length > COLUMN_MAX || summary.state.length > COLUMN_MAX) return "Those districts or states are too long together. Add the shoots separately instead.";
  return "";
}

/** The three columns' values for a shoot held at several places. */
function shootLocationsSummary(locations) {
  return {
    // One place per name, in the name's order - repeats kept - so "Haldi + Mehandi" at
    // "Chennai + Chennai" still says where each shoot is, read side by side with the name.
    shootPlace: locations.map((location) => String(location.shootPlace || "").trim()).join(SEPARATOR),
    district: joined(locations.map((location) => location.district)),
    state: joined(locations.map((location) => location.state)),
  };
}

/**
 * What the shoot stores: its locations and the three columns kept in step with them, or - one
 * place - no locations at all (SQL NULL) and the columns as given. Blank district or state is null (Rule 5).
 */
function shootLocationColumns(data) {
  const locations = Array.isArray(data?.shootLocations) && data.shootLocations.length > 1
    ? data.shootLocations.map((location) => ({
      shoot: location.shoot.trim(),
      shootPlace: location.shootPlace.trim(),
      district: String(location.district || "").trim() || null,
      state: String(location.state || "").trim() || null,
    }))
    : null;
  // `DbNull`, not `null`: Prisma refuses a bare null for a JSON column.
  if (!locations) return { shootLocations: Prisma.DbNull, shootPlace: data.shootPlace, district: data.district || null, state: data.state || null };
  const summary = shootLocationsSummary(locations);
  return { shootLocations: locations, shootPlace: summary.shootPlace, district: summary.district || null, state: summary.state || null };
}

/*
 * The venue of each place, found out in Pre Production.
 *
 * A shoot held at one place has one Location Address and Link (`project_pre_production`'s
 * `location_address` / `location_link`). A shoot held at several (`shoot_locations` above) is asked
 * one per name instead, kept in `project_pre_production.locations` as `{ shoot, locationAddress,
 * locationLink }` in the name's order; the two columns then hold them labelled, one per line -
 * "Haldi: …" - so every reader of one address (the crew's WhatsApp message, the export) still says
 * where each shoot is.
 */
const LINK_MAX = 2048;
// Well inside MySQL's TEXT, which `location_address` is.
const ADDRESS_MAX = 20000;
const labelled = (venues, key) => venues
  .filter((venue) => venue[key])
  .map((venue) => `${venue.shoot}: ${venue[key]}`)
  .join("\n");

/**
 * The shoot's venues, one per name, or null for a shoot held at one place. Saved venues are matched
 * by name, so a name added since starts blank; a shoot never asked per name before starts every name
 * on the one address it had, which was all of theirs.
 */
function shootVenues(shoot, pre) {
  const places = Array.isArray(shoot?.shootLocations) ? shoot.shootLocations : [];
  if (places.length < 2) return null;
  const saved = Array.isArray(pre?.locations) ? pre.locations : null;
  return places.map(({ shoot: name }) => {
    const own = saved ? saved.find((venue) => venue?.shoot === name) || {} : { locationAddress: pre?.locationAddress, locationLink: pre?.locationLink };
    return { shoot: name, locationAddress: own.locationAddress || null, locationLink: own.locationLink || null };
  });
}

/** Why these venues cannot be saved for this shoot, or "". */
function shootVenuesIssue(shoot, venues) {
  const names = (shootVenues(shoot, null) || []).map((venue) => venue.shoot);
  if (!names.length) return "This shoot is held at one place now. Close the form and open it again.";
  if (venues.length !== names.length || venues.some((venue, index) => venue.shoot !== names[index])) {
    return "The shoot's places have changed since the form opened. Close the form and open it again.";
  }
  return shootVenueLengthIssue(venues);
}

/** Why these venues are too long to keep together, or "" - asked of the team's save and the client's. */
function shootVenueLengthIssue(venues) {
  if (labelled(venues, "locationLink").length > LINK_MAX) return "Those Location Links are too long together. Shorten them.";
  if (labelled(venues, "locationAddress").length > ADDRESS_MAX) return "Those Location Addresses are too long together. Shorten them.";
  return "";
}

/** What the pre production row stores for a shoot held at several places. Blank is null (Rule 5). */
function shootVenueColumns(venues) {
  const locations = venues.map((venue) => ({
    shoot: venue.shoot,
    locationAddress: String(venue.locationAddress || "").trim() || null,
    locationLink: String(venue.locationLink || "").trim() || null,
  }));
  return { locations, locationAddress: labelled(locations, "locationAddress") || null, locationLink: labelled(locations, "locationLink") || null };
}

module.exports = { shootLocationsSchema, shootLocationsIssue, shootLocationsSummary, shootLocationColumns, shootVenues, shootVenuesIssue, shootVenueLengthIssue, shootVenueColumns };
