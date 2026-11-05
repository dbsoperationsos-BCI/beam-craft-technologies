const { randomUUID } = require("crypto");

/**
 * Where the AI Feature keeps its objects in R2: one namespace, one folder per event, and never a
 * key under `image-selection/` or `album-proofing/`.
 *
 *   ai-feature/event-<id>/cover/            the event cover (public)
 *   ai-feature/event-<id>/originals/        full frames, only when the event asks to keep them (public bucket, unguessable)
 *   ai-feature/event-<id>/previews/         the frame the gallery and the detector read (public)
 *   ai-feature/event-<id>/thumbnails/       grid tiles (public)
 *   ai-feature/event-<id>/videos/           uploaded video files (public)
 *   ai-feature/event-<id>/guest-selfies/    a guest's selfie (private bucket)
 *   ai-feature/event-<id>/face-thumbs/      one crop per detected face (private bucket)
 *   ai-feature/event-<id>/watermark/        the event's own copy of its watermark logo (public)
 *   ai-feature/event-<id>/watermarked/      previews and thumbnails drawn with the watermark (public)
 *
 * Names are UUIDs rather than file names, so a key never reveals a guest or a client.
 */
const ROOT = "ai-feature";
const FOLDERS = Object.freeze({ cover: "cover", originals: "originals", previews: "previews", thumbnails: "thumbnails", videos: "videos", guestSelfies: "guest-selfies", faceThumbs: "face-thumbs", watermark: "watermark", watermarked: "watermarked" });

const eventRoot = (eventId) => `${ROOT}/event-${String(eventId)}`;
const folderFor = (eventId, folder) => `${eventRoot(eventId)}/${FOLDERS[folder] || folder}`;
const buildKey = (eventId, folder, extension) => `${folderFor(eventId, folder)}/${randomUUID()}.${extension}`;
const isEventKey = (key, eventId) => typeof key === "string" && key.startsWith(`${eventRoot(eventId)}/`);

module.exports = { ROOT, FOLDERS, eventRoot, folderFor, buildKey, isEventKey };
