const { spawn } = require("child_process");
const crypto = require("crypto");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const sharp = require("sharp");
const { uploadObject, deleteObject } = require("../../../services/objectStorage");
const { isConfigured } = require("../../../config/r2");

/*
 * The design team's artwork for an invitation design, stored as drawn - not squeezed into one still
 * WebP like an ordinary photo:
 *
 * - a still picture (PNG, JPG, WebP) keeps its see-through parts, as a WebP;
 * - a moving picture (GIF, animated WebP) keeps every frame - a GIF becomes an animated WebP, the same
 *   movement at a fraction of the size, which browsers and the app both play;
 * - a video (MP4, MOV, WebM - an animation exported from Canva or After Effects) is made into an MP4 a
 *   phone plays (H.264, no sound - the client's song is the only sound), with its first frame kept as
 *   its poster for wherever a video cannot play.
 *
 * Each is brought down to phone size, and its bytes must be the file they claim to be.
 */

const FOLDER = "client/invitations/designs";
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const MAX_VIDEO_BYTES = 30 * 1024 * 1024;
const MAX_DIMENSION = 1600;
const MAX_VIDEO_SECONDS = 20;
const ftyp = (b) => b.slice(4, 8).toString("latin1") === "ftyp";
const IMAGE_TYPES = {
  "image/gif": { extension: "gif", matches: (b) => b.slice(0, 4).toString("latin1") === "GIF8" },
  "image/webp": { extension: "webp", matches: (b) => b.slice(0, 4).toString("latin1") === "RIFF" && b.slice(8, 12).toString("latin1") === "WEBP" },
  "image/png": { extension: "png", matches: (b) => b[0] === 0x89 && b.slice(1, 4).toString("latin1") === "PNG" },
  "image/jpeg": { extension: "jpg", matches: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
};
const VIDEO_TYPES = {
  "video/mp4": { extension: "mp4", matches: ftyp },
  "video/quicktime": { extension: "mov", matches: ftyp },
  "video/webm": { extension: "webm", matches: (b) => b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3 },
};

const fail = (status, message) => Object.assign(new Error(message), { status });

const ffmpegPath = () => {
  try {
    return require("ffmpeg-static") || "";
  } catch {
    return "";
  }
};

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath(), args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-3000); });
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(fail(400, "This video could not be read. Export it again as an MP4 and upload that."))));
  });
}

async function storeImage(input, type) {
  const meta = await sharp(input, { animated: true, failOn: "none" }).metadata();
  const moving = (meta.pages || 1) > 1;
  const resize = { width: MAX_DIMENSION, height: MAX_DIMENSION, fit: "inside", withoutEnlargement: true };
  let output = await sharp(input, { animated: moving, failOn: "none" }).resize(resize).webp({ quality: moving ? 78 : 86, effort: 4, ...(moving ? { loop: meta.loop ?? 0 } : {}) }).toBuffer();
  let extension = "webp";
  let contentType = "image/webp";
  // An animated WebP is almost always the smaller; the GIF is kept in the rare case it is not.
  if (moving && type.extension === "gif" && output.length >= input.length) {
    output = input;
    extension = "gif";
    contentType = "image/gif";
  }
  const stored = await uploadObject(output, { folder: FOLDER, extension, contentType });
  return { url: stored.url, key: stored.key, type: "image", posterUrl: null, posterKey: null };
}

async function storeVideo(input, type) {
  if (!ffmpegPath()) throw fail(503, "Video artwork is not available on this server. Upload a GIF instead.");
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `artwork-${crypto.randomBytes(4).toString("hex")}-`));
  try {
    const source = path.join(dir, `in.${type.extension}`);
    const mp4 = path.join(dir, "art.mp4");
    const poster = path.join(dir, "poster.png");
    await fs.writeFile(source, input);
    // Phone sized (1080 on its long side at most, even pixels for H.264), 30 fps, silent, 20 s at most,
    // and ready to play before it has fully arrived.
    await runFfmpeg([
      "-y", "-i", source, "-t", String(MAX_VIDEO_SECONDS), "-an",
      "-vf", "scale='min(1080,iw)':'min(1080,ih)':force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2,fps=30,format=yuv420p",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-movflags", "+faststart", mp4,
    ]);
    await runFfmpeg(["-y", "-i", mp4, "-frames:v", "1", poster]);
    const posterWebp = await sharp(await fs.readFile(poster)).webp({ quality: 84 }).toBuffer();
    const video = await uploadObject(await fs.readFile(mp4), { folder: FOLDER, extension: "mp4", contentType: "video/mp4" });
    let still;
    try {
      still = await uploadObject(posterWebp, { folder: FOLDER, extension: "webp", contentType: "image/webp" });
    } catch (error) {
      await deleteObject(video.key).catch(() => {});
      throw error;
    }
    return { url: video.url, key: video.key, type: "video", posterUrl: still.url, posterKey: still.key };
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Stores one piece of artwork sent as a data URI: `{ url, key, type, posterUrl, posterKey }`.
 * `video: true` lets it be a video (the design's main artwork); the top and bottom pieces are pictures.
 */
async function storeArtwork(dataUri, { video = false } = {}) {
  const match = String(dataUri || "").match(/^data:([^;,]+);base64,(.+)$/s);
  const accepted = video ? "a GIF, PNG, JPG, WebP or video (MP4, MOV, WebM)" : "a GIF, PNG, JPG or WebP";
  if (!match) throw fail(400, `This file could not be read. Upload ${accepted}.`);
  const imageType = IMAGE_TYPES[match[1]];
  const videoType = video ? VIDEO_TYPES[match[1]] : null;
  if (!imageType && !videoType) throw fail(400, `Upload the artwork as ${accepted}.`);
  const input = Buffer.from(match[2], "base64");
  if (!input.length) throw fail(400, "This file could not be read.");
  const max = videoType ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
  if (input.length > max) throw fail(400, `Artwork must be ${Math.round(max / (1024 * 1024))} MB or smaller.`);
  const type = imageType || videoType;
  if (!type.matches(input)) throw fail(400, `This file is not really a ${type.extension.toUpperCase()}.`);
  if (!isConfigured) throw fail(500, "File storage is not configured on this server.");
  return videoType ? storeVideo(input, videoType) : storeImage(input, imageType);
}

/** Takes back artwork stored for a save that then failed. Never throws. */
async function discardArtwork(stored) {
  const keys = stored.flatMap((item) => [item.key, item.posterKey]).filter(Boolean);
  await Promise.all(keys.map((key) => deleteObject(key).catch(() => {})));
}

module.exports = { storeArtwork, discardArtwork, MAX_IMAGE_BYTES, MAX_VIDEO_BYTES };
