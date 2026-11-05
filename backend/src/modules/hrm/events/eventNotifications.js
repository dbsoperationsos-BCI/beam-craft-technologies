const prisma = require("../../../config/db");
const iamService = require("../../../services/iam.service");
const { TYPES } = require("../../../services/notifications");
const clientPush = require("../../../services/clientPush");

/**
 * The bell's side of HRM → Events: a new post is announced to everybody who can open the page.
 *
 * "Everybody who can open it" is the same `HRM / Events` Read the route guard asks for, checked per
 * login through `hasPermission` - so a Super Admin, a role granting it and a branch administrator
 * carried by the Admin Permission set are all reached, and nobody the page would refuse is told
 * about a post they cannot see. The poster is left out: they know, they just did it.
 *
 * Never throws. The event is already posted when this runs, and a bell that could not be written
 * is not a reason to tell the poster their post failed.
 */

const ENTITY_TYPE = "HRM_EVENT";
const LINK = "/hrm/events";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * `2026-09-20` as `20 Sep 2026`, read off the key itself so no timezone can shift the day. Spelled
 * from a list rather than `Intl`, whose `en-GB` short month is "Sept" on some ICU builds and "Sep" on
 * others.
 */
const displayDay = (dateKey) => {
  const [year, month, day] = String(dateKey || "").split("-").map(Number);
  return year && MONTHS[month - 1] && day ? `${day} ${MONTHS[month - 1]} ${year}` : "";
};

/** Who is told: every active login holding `HRM / Events`, bar the one who posted. */
async function audienceFor(actorId) {
  const users = await prisma.user.findMany({
    where: { status: "ACTIVE", ...(actorId ? { NOT: { id: actorId } } : {}) },
    select: { id: true },
    orderBy: { id: "asc" },
  });
  const audience = [];
  // One at a time, as the bell's own controller asks: `hasPermission` fills a per-user cache.
  for (const user of users) {
    if (await iamService.hasPermission(user.id, "HRM", "Events", "READ").catch(() => false)) audience.push(user.id);
  }
  return audience;
}

/** The notice a new post raises, from the event as `serialize` answers it. */
function postedNotice(event) {
  return {
    type: TYPES.EVENT_POSTED,
    title: `New event: ${event.title}`.slice(0, 200),
    body: [displayDay(event.eventDate), event.postedBy && `Posted by ${event.postedBy}`].filter(Boolean).join(" · ") || null,
    entityType: ENTITY_TYPE,
    entityId: String(event.id),
    link: LINK,
  };
}

/** Tells everybody who can open Events that `event` was posted. Answers how many were told. */
async function announceEvent(event, actorId) {
  try {
    const audience = await audienceFor(actorId);
    if (!audience.length) return 0;
    const notice = postedNotice(event);
    const { count } = await prisma.notification.createMany({ data: audience.map((userId) => ({ userId, ...notice })) });
    clientPush.pushToStaff(audience, notice);
    return count;
  } catch (error) {
    console.warn("Unable to announce the event:", error?.message || error);
    return 0;
  }
}

/** A removed event takes its notices with it, so nobody is sent to a post that is no longer there. */
async function withdrawEvent(id) {
  try {
    await prisma.notification.deleteMany({ where: { type: TYPES.EVENT_POSTED, entityType: ENTITY_TYPE, entityId: String(id) } });
  } catch (error) {
    console.warn("Unable to withdraw the event's notifications:", error?.message || error);
  }
}

module.exports = { announceEvent, withdrawEvent, postedNotice };
