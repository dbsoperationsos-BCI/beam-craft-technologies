const { assertCompatible, roundBox, MAX_THUMBNAIL_BASE64 } = require("../../desktop/descriptors");
const { expectedFaceModel } = require("../../desktop/flags");
const { httpError } = require("../shared/http");

/**
 * The desktop hand-off for an event's photo: faces the Virtual Curation desktop app found and
 * described with this server's own face engine, written exactly as `processMedia` writes what the
 * server's engine finds - the same face and embedding rows, the same clustering, the same guest
 * matching, the same timeline - with the engine step left out. The one addition is that the
 * desktop may send each face's private 160x160 crop; a face without one is cropped from the
 * media's preview on the server, as it always was.
 *
 * Every side effect comes in through `deps` so the decisions are tested with fakes;
 * `createIngest()` with no arguments is the real wiring, built the first time a request needs it.
 */
const FACE_THUMB_EDGE = 160;

function defaultDeps() {
  const sharp = require("sharp");
  const prisma = require("../../../config/db");
  const storage = require("../shared/storage");
  const service = require("./service");
  return {
    prisma,
    storage,
    vectors: require("../shared/vectors"),
    activity: require("../shared/activity"),
    people: require("../people/clustering"),
    matching: require("../matches/matching"),
    loadEvent: require("../shared/eventAccess").loadEvent,
    aiSettingsFor: service.aiSettingsFor,
    announceIfFinished: service.announceIfFinished,
    failMedia: service.failMedia,
    expectedModel: expectedFaceModel,
    /** The media's preview, decoded once per hand-off and only when some face arrives without a crop. */
    readPreview: async (media) => {
      const frame = await service.fetchPublic(media.previewKey);
      const { width, height } = await sharp(frame, { failOn: "none" }).metadata();
      return { frame, width, height };
    },
    thumbnails: {
      /**
       * The desktop's crop, never stored as sent: decoded, decoded-size capped, and re-encoded
       * through sharp to a 160x160 WebP - so what the private bucket holds is an image this server
       * made, whatever bytes arrived under the name.
       */
      fromBase64: async (eventId, base64) => {
        const buffer = Buffer.from(base64, "base64");
        if (!buffer.length || buffer.length > MAX_THUMBNAIL_BASE64) return null;
        const webp = await sharp(buffer, { failOn: "none", limitInputPixels: 1024 * 1024, animated: false })
          .resize({ width: FACE_THUMB_EDGE, height: FACE_THUMB_EDGE, fit: "cover" }).webp({ quality: 78 }).toBuffer();
        return storage.putPrivate(eventId, "faceThumbs", "webp", webp, "image/webp");
      },
      /** The server's own crop from the preview, the fractions turned back into the preview's pixels. */
      fromPreview: (eventId, { frame, width, height }, box) => service.cropFace(eventId, frame, [box.x * width, box.y * height, (box.x + box.w) * width, (box.y + box.h) * height], width, height),
    },
  };
}

function createIngest(deps) {
  const { prisma, storage, vectors, activity, people, matching, loadEvent, aiSettingsFor, announceIfFinished, failMedia, expectedModel, readPreview, thumbnails } = deps;

  async function ingest(eventId, mediaId, body) {
    await loadEvent(eventId);
    assertCompatible(body, { model: expectedModel() });
    const media = await prisma.aiEventMedia.findFirst({ where: { id: mediaId, eventId, deletedAt: null } });
    if (!media || media.kind !== "PHOTO") throw httpError(404, "Photo not found in this event.");
    const ai = await aiSettingsFor(eventId);
    if (!ai.faceRecognition) throw httpError(409, "Face recognition is switched off for this event, so its photos take no faces.");

    const started = await prisma.aiEventMedia.update({ where: { id: mediaId }, data: { aiStatus: "PROCESSING", aiStartedAt: new Date(), aiAttempts: { increment: 1 }, aiError: null } });
    if (started.aiAttempts === 1) await activity.record(eventId, activity.EVENTS.AI_PROCESSING_STARTED, activity.systemActor(), media.fileName);
    try {
      // Handed over again, or after the server's own run: what was written for this photo before
      // is cleared - rows, crops and the people they counted towards - so nothing is counted twice.
      const stale = await prisma.aiEventFace.findMany({ where: { mediaId }, select: { id: true, thumbnailKey: true, personId: true } });
      if (stale.length) {
        await prisma.aiEventFace.deleteMany({ where: { mediaId } });
        await storage.deletePrivateKeys(stale.map((row) => row.thumbnailKey).filter(Boolean));
        await people.recount(eventId, [...new Set(stale.map((row) => row.personId).filter(Boolean))]);
      }

      // Read once, and a preview that cannot be read is asked for once too: the hand-off is about
      // the descriptors, and a missing crop is drawn as no circle rather than a failed photo.
      let preview;
      const previewOnce = async () => { if (preview === undefined) preview = await readPreview(media).catch(() => null); return preview; };
      const faces = [];
      for (const found of body.faces) {
        const box = roundBox(found.box);
        const thumbnailKey = await thumbnailFor(eventId, found, box, previewOnce);
        const face = await prisma.aiEventFace.create({ data: {
          eventId, mediaId, box, detScore: found.detScore, quality: found.quality, thumbnailKey,
          embedding: { create: { eventId, model: body.model, dimension: found.embedding.length, vector: vectors.encode(found.embedding) } },
        } });
        faces.push({ id: face.id, quality: found.quality, vector: vectors.normalize(found.embedding) });
      }

      const usable = faces.filter((face) => face.quality >= ai.minFaceQuality);
      const assigned = ai.faceClustering && usable.length ? await people.assignFaces(eventId, usable, ai) : [];
      const matched = ai.automaticMatching && usable.length ? await matching.matchFacesToGuests(eventId, mediaId, usable, ai) : [];

      await prisma.aiEventMedia.update({ where: { id: mediaId }, data: { aiStatus: "COMPLETED", aiCompletedAt: new Date(), faceCount: faces.length, aiError: null } });
      await announceIfFinished(eventId);
      return { mediaId, faces: faces.length, people: assigned.length, matches: matched.length };
    } catch (error) {
      await failMedia(mediaId, error.message).catch(() => {});
      throw error;
    }
  }

  /** The desktop's crop when it sent one and it decodes; the server's own from the preview otherwise; none when neither can be made. */
  async function thumbnailFor(eventId, found, box, previewOnce) {
    if (found.thumbnail) {
      const key = await thumbnails.fromBase64(eventId, found.thumbnail).catch(() => null);
      if (key) return key;
    }
    const preview = await previewOnce();
    if (!preview) return null;
    return thumbnails.fromPreview(eventId, preview, box).catch(() => null);
  }

  return { ingest };
}

let instance = null;
const ingest = (eventId, mediaId, body) => (instance || (instance = createIngest(defaultDeps()))).ingest(eventId, mediaId, body);

module.exports = { createIngest, ingest };
