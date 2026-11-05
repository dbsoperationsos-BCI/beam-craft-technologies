const prisma = require("../../../config/db");
const objectStorage = require("../../../services/objectStorage");
const { attachmentDisposition: disposition } = require("../../../services/contentDisposition");

/**
 * HRM → Events → Download: an event's own photos, as they were posted.
 *
 * Behind `HRM / Events` (to see the event at all) and `HRM / Event Download` (to take its photos
 * away) - see `routes.js`. One photo is answered as that picture; several as a ZIP, stored rather
 * than deflated (they are JPEG and WebP already), written one photo at a time so the archive is
 * never held whole.
 *
 * Every photo is read from where the event says it is and nowhere else: by its bucket key, or from
 * the inline picture a server without object storage keeps. A stored link that is not this
 * studio's bucket - an event posted before links were refused - is never fetched, since that
 * would have the server call an address somebody typed; it is named in NOT-INCLUDED.txt instead.
 */

const CONTENT_TYPES = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif" };
const DATA_URI = /^data:image\/(jpeg|png|webp|gif);base64,(.*)$/is;

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

/*
 * A photo larger than this is not one an event holds - they are compressed to about 350 KB when
 * posted - so it is left out rather than read whole into memory.
 */
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

/** The event's title as a file name: `Annual Day 2026`, never a path or an empty string. */
function baseName(title) {
  const name = String(title || "").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
  return name || "event";
}

/** The event's photos in order; an event from before there could be several is its one cover. */
function photosOf(event) {
  if (event.images?.length) return event.images.map((image) => ({ url: image.imageUrl, key: image.imageKey }));
  return event.imageUrl ? [{ url: event.imageUrl, key: event.imageKey }] : [];
}

function createEventDownloads(dependencies = {}) {
  const db = dependencies.prisma || prisma;
  const storage = dependencies.objectStorage || objectStorage;
  const archiver = dependencies.archiver || require("archiver");

  /** `{ bytes, extension }` for one photo, or null where it cannot be read from our own storage. */
  async function readPhoto(photo) {
    const inline = DATA_URI.exec(String(photo.url || ""));
    if (inline) {
      const bytes = Buffer.from(inline[2], "base64");
      return bytes.length > MAX_PHOTO_BYTES ? null : { bytes, extension: inline[1].toLowerCase() === "jpeg" ? "jpg" : inline[1].toLowerCase() };
    }
    const key = photo.key || storage.keyFromUrl(photo.url);
    if (!key) return null;
    const bytes = await storage.getPublicObjectBuffer(key);
    if (!bytes || bytes.length > MAX_PHOTO_BYTES) return null;
    const extension = (/\.([a-z0-9]+)$/i.exec(key)?.[1] || "jpg").toLowerCase();
    return { bytes, extension };
  }

  /**
   * Answers `res` with the event's photos. Throws an `httpError` before anything is written when
   * there is no event or not one photo can be read, so the page says why rather than saving a
   * broken file.
   */
  async function sendEventPhotos(eventId, res) {
    const event = await db.hrmEvent.findUnique({
      where: { id: eventId },
      select: { title: true, imageUrl: true, imageKey: true, images: { select: { imageUrl: true, imageKey: true }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }] } },
    });
    if (!event) throw httpError(404, "That event no longer exists.");
    const photos = photosOf(event);
    const name = baseName(event.title);

    // Read before anything is sent: at most ten photos of about 350 KB, so the whole set is small,
    // and a set with nothing readable is refused with a reason instead of an empty archive.
    const read = [];
    for (const [index, photo] of photos.entries()) {
      let file = null;
      try { file = await readPhoto(photo); } catch (error) { console.error("Unable to read an event photo for download:", error); }
      read.push({ index, file });
    }
    const files = read.filter((entry) => entry.file);
    if (!files.length) throw httpError(409, "This event's photos are no longer stored, so there is nothing to download.");

    res.setHeader("Cache-Control", "private, no-store");
    // Saved as a file, never sniffed into something to run.
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (photos.length === 1) {
      const [{ file }] = files;
      res.setHeader("Content-Type", CONTENT_TYPES[file.extension] || "application/octet-stream");
      res.setHeader("Content-Disposition", disposition(`${name}.${file.extension}`));
      res.setHeader("Content-Length", file.bytes.length);
      res.end(file.bytes);
      return;
    }

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", disposition(`${name}.zip`));
    const archive = archiver("zip", { store: true });
    /*
     * A reader who goes away mid-archive ends it here too, so nothing more is written to a closed
     * connection; an archive that fails takes the response down with it, since the headers are
     * already sent and the file can no longer be refused properly.
     */
    const done = new Promise((resolve, reject) => {
      archive.on("error", (error) => { res.destroy(error); reject(error); });
      archive.on("end", resolve);
      res.on("close", () => { if (!res.writableFinished) archive.abort(); resolve(); });
    });
    archive.pipe(res);
    // Numbered by their place in the event, so the names are unique and a missing one leaves a gap.
    const width = String(photos.length).length;
    for (const { index, file } of files) {
      archive.append(file.bytes, { name: `${name} ${String(index + 1).padStart(width, "0")}.${file.extension}` });
    }
    const missing = read.filter((entry) => !entry.file).map((entry) => `Photo ${entry.index + 1}`);
    if (missing.length) archive.append(`These photos of the event could not be read from storage, so they are not in this download:\n${missing.join("\n")}\n`, { name: "NOT-INCLUDED.txt" });
    // Not awaited on its own: an archive aborted by a reader who left never finishes finalising,
    // and `done` already settles for every ending - finished, failed or abandoned.
    archive.finalize().catch(() => {});
    await done;
  }

  return { sendEventPhotos };
}

module.exports = { createEventDownloads, baseName, photosOf };
