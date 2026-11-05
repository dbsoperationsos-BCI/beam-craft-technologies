const { z } = require("zod");
const prisma = require("../../../config/db");
const { storeImages, discardUploads } = require("../../../services/imageStorage");
const { isAdministrator } = require("../../../services/administrator");
const { announceEvent, withdrawEvent } = require("./eventNotifications");
const { sendEventPhotos } = require("./download").createEventDownloads();
// A day, read the way attendance reads one, so an event on the 20th is never stored as the 19th.
const { calendarDay, localIsoDate } = require("../attendance/attendanceRules");

/**
 * HRM → Events: the studio's events, each some photographs and what happened.
 *
 * Anybody holding `HRM / Events` reads them and posts one; only the poster or an administrator
 * removes one (see `routes.js`). The photos - up to `MAX_EVENT_IMAGES`, taken with the camera or
 * uploaded - go through `storeImages` like every other public image here: compressed, and put in the
 * bucket, or kept inline on a server without one. The first is the cover.
 */

/** A bit more room than the 150 KB default: an event photo is the whole point of the post and is shown large. */
const EVENT_IMAGE_MAX_BYTES = 350 * 1024;
const EVENT_IMAGE_FOLDER = "hrm/events";
/** How many photos one event may carry. Also the page's limit, which says so under the field. */
const MAX_EVENT_IMAGES = 10;

/*
 * One photo as the page sends it: a picture encoded into the request, never a link. A link was
 * stored as it was, so a post could make every employee's browser fetch an outside address; and
 * with no size of its own each photo was bounded only by the whole body's. The page compresses a
 * photo to about 600 KB before sending, which is some 800,000 characters encoded - the cap leaves
 * room for that several times over.
 */
const MAX_PHOTO_CHARS = 3_000_000;
const photoSchema = z.string().trim()
  .regex(/^data:image\/(jpeg|png|webp|gif);base64,/i, "Each photo has to be a JPEG, PNG, WebP or GIF picture.")
  .max(MAX_PHOTO_CHARS, "One of the photos is too large.");

const eventSchema = z.object({
  // The same sentence whether a field is empty or missing altogether, rather than zod's own
  // "expected string, received undefined" for the second.
  title: z.string({ error: "Give the event a title." }).trim().min(1, "Give the event a title.").max(150, "That title is too long."),
  // Optional: a photo and a title say enough on their own. Stored as "" when left out - the column
  // has always held text, and an empty one reads as no description on the page.
  description: z.string().trim().max(5000, "That description is too long.").optional().default(""),
  /*
   * No longer asked for - the form does not have the field; the day an event was posted is what
   * the page sorts and shows by. Still taken when a caller sends one, and checked as a real day then
   * (2026-02-31 matched the pattern and was quietly stored as 3 March). Events posted with a date
   * keep it.
   */
  eventDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose the day of the event.")
    .refine((value) => localIsoDate(calendarDay(value)) === value, "Choose the day of the event.")
    .optional(),
  /*
   * The photos, as the data URIs the page sends, in the order they were added. `image` - one
   * photo - is what the page sent before an event could hold several, and is still taken.
   */
  images: z.array(photoSchema).max(MAX_EVENT_IMAGES, `An event can have up to ${MAX_EVENT_IMAGES} photos.`).optional(),
  image: photoSchema.optional(),
}).transform((input) => ({ ...input, images: input.images?.length ? input.images : input.image ? [input.image] : [] }))
  .refine((input) => input.images.length > 0, { message: "Add at least one photo of the event." });

const serialize = (row) => ({
  id: row.id,
  title: row.title,
  description: row.description,
  eventDate: row.eventDate ? localIsoDate(row.eventDate) : null,
  imageUrl: row.imageUrl,
  // Every photo in order; an event from before there could be several reads as its one cover.
  images: row.images?.length ? row.images.map((image) => image.imageUrl) : [row.imageUrl].filter(Boolean),
  postedBy: row.createdByUser?.name || row.createdByUser?.username || null,
  createdAt: row.createdAt,
});

const include = {
  createdByUser: { select: { name: true, username: true } },
  images: { select: { imageUrl: true }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }] },
};

/** An event can be removed by whoever posted it, and by an administrator. Nobody else. */
const mayRemove = (row, userId, admin) => admin || (userId != null && row.createdById === userId);

/**
 * `?from=YYYY-MM-DD&to=YYYY-MM-DD`: the events **posted** on those days, both counted, read on the
 * studio's clock (Asia/Kolkata) whatever the server's is - an event no longer carries a day of its
 * own, so the day it was posted is the one there is. Either end may be left out; a value that is
 * not a real day is ignored rather than refused, so a bad link still shows the events.
 */
const STUDIO_OFFSET = "+05:30";
function postedRange(query) {
  const day = (value) => {
    const text = String(value || "").trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(text) && localIsoDate(calendarDay(text)) === text ? text : "";
  };
  let from = day(query?.from);
  let to = day(query?.to);
  if (from && to && to < from) [from, to] = [to, from];
  const range = {};
  if (from) range.gte = new Date(`${from}T00:00:00.000${STUDIO_OFFSET}`);
  if (to) range.lt = new Date(new Date(`${to}T00:00:00.000${STUDIO_OFFSET}`).getTime() + 24 * 60 * 60 * 1000);
  return Object.keys(range).length ? range : null;
}

async function listEvents(req, res) {
  try {
    const userId = Number(req.user?.id) || null;
    const posted = postedRange(req.query);
    // Newest post first, by when it was posted rather than the day it happened, so a post always
    // lands at the top. `id` breaks a tie between two posted in the same millisecond.
    const [rows, admin] = await Promise.all([
      prisma.hrmEvent.findMany({
        ...(posted ? { where: { createdAt: posted } } : {}),
        include,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 200,
      }),
      isAdministrator(userId),
    ]);
    // Said per event, so the page offers Remove only where the delete below would succeed.
    return res.json({ data: rows.map((row) => ({ ...serialize(row), canRemove: mayRemove(row, userId, admin) })) });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Unable to load the events." });
  }
}

async function createEvent(req, res) {
  const parsed = eventSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0]?.message || "Check the event and try again." });
  const input = parsed.data;

  let stored = [];
  try {
    // All or none: `storeImages` takes back whatever it had uploaded if one of them fails.
    stored = await storeImages(input.images, { folder: EVENT_IMAGE_FOLDER, maxBytes: EVENT_IMAGE_MAX_BYTES });
    if (!stored.length) return res.status(400).json({ message: "Add at least one photo of the event." });
    const [cover] = stored;
    const row = await prisma.hrmEvent.create({
      data: {
        title: input.title,
        description: input.description,
        eventDate: input.eventDate ? calendarDay(input.eventDate) : null,
        imageUrl: cover.url,
        imageKey: cover.key || null,
        createdById: Number(req.user?.id) || null,
        images: { create: stored.map((image, index) => ({ imageUrl: image.url, imageKey: image.key || null, sortOrder: index })) },
      },
      include,
    });
    const event = serialize(row);
    // The bell, for everybody else who can open Events. Not awaited: the post is written, and
    // checking every login's permission is not something the poster should wait on.
    void announceEvent(event, Number(req.user?.id) || null);
    // The poster can always remove what they just posted.
    return res.status(201).json({ data: { ...event, canRemove: true } });
  } catch (error) {
    // The pictures were uploaded for a post that was never written, so they are taken back down.
    await discardUploads(stored.filter((image) => !image.reused));
    return res.status(error.status || 500).json({ message: error.message || "Unable to post the event." });
  }
}

async function deleteEvent(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(404).json({ message: "That event no longer exists." });
  try {
    const userId = Number(req.user?.id) || null;
    const existing = await prisma.hrmEvent.findUnique({ where: { id }, select: { createdById: true } });
    if (!existing) return res.status(404).json({ message: "That event no longer exists." });
    if (!mayRemove(existing, userId, await isAdministrator(userId))) {
      return res.status(403).json({ message: "Only the person who posted this event, or an administrator, can remove it." });
    }
    const row = await prisma.hrmEvent.delete({ where: { id }, include: { images: { select: { imageKey: true } } } });
    // Every photo's object, the cover's among them once - its key is also the first photo's.
    const keys = new Set([row.imageKey, ...row.images.map((image) => image.imageKey)].filter(Boolean));
    await discardUploads([...keys].map((key) => ({ key })));
    await withdrawEvent(id);
    return res.json({ data: { id } });
  } catch (error) {
    if (error?.code === "P2025") return res.status(404).json({ message: "That event no longer exists." });
    return res.status(500).json({ message: error.message || "Unable to remove the event." });
  }
}

/**
 * The event's photos as a file - the picture itself, or a ZIP of several (see `download.js`). Any
 * event the list would show: they are the studio's shared wall, with no branch or owner to narrow
 * by, so the two permissions on the route are the whole of who may take one away.
 */
async function downloadEvent(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(404).json({ message: "That event no longer exists." });
  try {
    await sendEventPhotos(id, res);
  } catch (error) {
    if (error.status) return res.status(error.status).json({ message: error.message });
    console.error("Unable to download the event:", error);
    // Part of an archive may already be on its way; then the connection is simply ended.
    if (res.headersSent) return res.destroy(error);
    return res.status(500).json({ message: "Unable to download the event. Try again in a moment." });
  }
}

// `eventSchema` for the tests, which check what a post needs without a database or storage.
module.exports = { listEvents, createEvent, deleteEvent, downloadEvent, eventSchema, postedRange };
