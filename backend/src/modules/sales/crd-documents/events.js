const { z } = require("zod");
const { SHOOT_DATE_ASC } = require("../../../services/shootOrder");

/*
 * A CRD document's events: one per shoot of its project, so a wedding booked for five shoots asks
 * the client about five events - each its own start, end and venue link. Dum Dum keeps the list on
 * `common.events`, Qua Qua on its top-level `events`.
 *
 * The list follows the project, not the document. Every read rebuilds it from the project's live
 * shoots, in date order, and keeps what the client already typed for each shoot (matched on
 * `shootRef`, the shoot's id): a shoot added later gains an event, a deleted one loses its event,
 * a renamed one shows its new name. Date, start time and end time are three answers, as the shoot
 * keeps them: what the studio knows - the shoot's date, its start and end times - fills in where the
 * client has not answered. Nothing here is required: the client may
 * leave any of it blank, as they always could.
 */

const MAX_EVENTS = 50;
const text = (max) => z.string().trim().max(max).optional().default("");

const eventSchema = z.object({
  // The shoot this event is - its id, so an answer stays with its shoot however the list moves.
  shootRef: text(191),
  // The shoot's name ("Haldi"), shown as the event's title; always re-read from the shoot.
  shoot: text(191),
  // `YYYY-MM-DD`, and two `HH:MM` times on the 24-hour clock - the shapes the shoot keeps.
  eventDate: text(10),
  startTime: text(5),
  endTime: text(5),
  eventAddressLink: text(1000),
});
const eventsSchema = z.array(eventSchema).max(MAX_EVENTS).optional().default([]);

const compact = (value) => String(value ?? "").trim();
/** The shoot's day as `YYYY-MM-DD`, read as the stored day (UTC midnight), never shifted by a zone. */
const dayOf = (value) => {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
};
/** `HH:MM`, or "" where there is no time. */
const timeOf = (value) => (/^\d{2}:\d{2}/.test(compact(value)) ? compact(value).slice(0, 5) : "");

/** What the studio knows of one shoot's event. */
function eventFromShoot(shoot) {
  return {
    shootRef: shoot.id,
    shoot: compact(shoot.shoot) || "Event",
    eventDate: dayOf(shoot.dateCreated),
    startTime: timeOf(shoot.eventStartTime),
    // Only where the shoot says when it ends - nobody invents an end time from a start.
    endTime: timeOf(shoot.eventEndTime),
    eventAddressLink: "",
  };
}

/**
 * The document's events for these shoots: each shoot's saved answers where the client gave them, the
 * studio's where not. `legacy` is the one event an older document asked about (on its common block);
 * its end and venue link - the client's own answers - seed the main shoot's event the first time the
 * list is built, so nothing typed there is lost. Not its start: that was filled from the lead on every
 * read, and the shoot's own date and time say it better.
 */
function eventsForShoots(shoots = [], saved = [], legacy = null) {
  const byShoot = new Map((saved || []).filter((event) => compact(event?.shootRef)).map((event) => [event.shootRef, event]));
  const main = shoots.find((shoot) => shoot.isMainEvent) || shoots[0];
  return shoots.map((shoot) => {
    const studio = eventFromShoot(shoot);
    // An older document kept the end as one "YYYY-MM-DDTHH:mm"; its time is what carries over.
    const own = byShoot.get(shoot.id) || (!byShoot.size && legacy && shoot === main ? { endTime: timeOf(compact(legacy.eventEndAt).slice(11)), eventAddressLink: legacy.eventAddressLink } : {});
    const pick = (field) => compact(own[field]) || studio[field];
    return { ...studio, eventDate: pick("eventDate"), startTime: pick("startTime"), endTime: pick("endTime"), eventAddressLink: pick("eventAddressLink") };
  });
}

/**
 * Shoots in the order they happen: by date, then start time; one with no date yet last - MySQL sorts
 * a NULL date first, which put "date to be fixed" at the top of the list.
 */
function inEventOrder(shoots = []) {
  const key = (shoot) => (shoot.dateCreated ? `${dayOf(shoot.dateCreated)}T${timeOf(shoot.eventStartTime) || "99:99"}` : "9999");
  return [...shoots].sort((a, b) => key(a).localeCompare(key(b)));
}

/** The project's live shoots, in the order they happen, with what an event reads of each. */
async function shootsForEvents(client, projectId) {
  if (!projectId) return [];
  const shoots = await client.projectShoot.findMany({
    where: { projectId, deletedAt: null },
    orderBy: [{ dateCreated: SHOOT_DATE_ASC }, { createdAt: "asc" }],
    select: { id: true, shoot: true, dateCreated: true, eventStartTime: true, eventEndTime: true, isMainEvent: true },
  });
  return inEventOrder(shoots);
}

module.exports = { MAX_EVENTS, eventSchema, eventsSchema, eventFromShoot, eventsForShoots, inEventOrder, shootsForEvents };
