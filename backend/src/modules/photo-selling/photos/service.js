const fs = require("fs");
const crypto = require("crypto");
const sharp = require("sharp");
const prisma = require("../../../config/db");
const { httpError } = require("../../ai-feature/shared/http");
const derivatives = require("../../ai-feature/media/derivatives");
const storage = require("../shared/storage");
const cleanup = require("../shared/cleanup");
const faces = require("../faces/service");
const watermarks = require("../watermarks/service");

/**
 * A gallery's photos: uploaded straight into Photo Selling, owned by it, and nothing else's.
 *
 * Each upload carries the **original** - the file from the photographer's disk, byte for byte - and,
 * from an uploader that can make one, a web-size preview and thumbnail cut on their own computer.
 * The original goes to the private originals bucket exactly as it arrived (never decoded, resized
 * or re-encoded): it is what a buyer downloads once their payment is verified. The preview and
 * thumbnail - made here from the original when the uploader sent none - go to the public bucket and
 * are only ever shown, watermarked, never sold.
 *
 * The original is checked before anything is stored: its first bytes must be a photo format we
 * accept, and its SHA-256 must be the fingerprint the uploader declared. That fingerprint is the
 * photo's identity - one photo per gallery per fingerprint - so a retried or repeated upload is
 * answered with the photo already there and stores nothing twice.
 */
const PHOTO_TYPES = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic", "image/heif": "heif", "image/tiff": "tif" };
// The largest original the server makes a preview from itself, for an uploader that sent none.
const SERVER_PREVIEW_MAX_BYTES = 80 * 1024 * 1024;
const PAGE_SIZE = 60;
const LIVE = { removedAt: null };

const toNumber = (value) => (value == null ? null : Number(value));
const queue = () => require("../search/queue");

/** The photo type a file's first bytes say it is - never its name or the type the uploader claimed. */
function sniffImageType(head) {
  if (!head || head.length < 12) return null;
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "image/jpeg";
  if (head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (head.toString("ascii", 0, 4) === "RIFF" && head.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  if ((head[0] === 0x49 && head[1] === 0x49 && head[2] === 0x2a && head[3] === 0x00) || (head[0] === 0x4d && head[1] === 0x4d && head[2] === 0x00 && head[3] === 0x2a)) return "image/tiff";
  if (head.toString("ascii", 4, 8) === "ftyp") {
    const brand = head.toString("ascii", 8, 12);
    if (["heic", "heix", "hevc", "hevx", "heim", "heis"].includes(brand)) return "image/heic";
    if (["mif1", "msf1"].includes(brand)) return "image/heif";
  }
  return null;
}

/** The first bytes of a file and its SHA-256, read by streaming it once. */
async function readOriginal(filePath) {
  const hash = crypto.createHash("sha256");
  let head = Buffer.alloc(0);
  await new Promise((resolve, reject) => {
    fs.createReadStream(filePath)
      .on("data", (chunk) => { if (head.length < 32) head = Buffer.concat([head, chunk.subarray(0, 32 - head.length)]); hash.update(chunk); })
      .on("error", reject).on("end", resolve);
  });
  return { head, sha256: hash.digest("hex") };
}

/** The original's own pixel size, upright, read from its header only; null when it cannot be read. */
async function originalSize(filePath) {
  try {
    const meta = await sharp(filePath, { failOn: "none" }).metadata();
    if (!meta.width || !meta.height) return null;
    return meta.orientation >= 5 ? { width: meta.height, height: meta.width } : { width: meta.width, height: meta.height };
  } catch { return null; }
}

function serializePhoto(row, hash) {
  const addresses = row.available ? watermarks.addressesFor(row.id, hash) : { previewUrl: null, thumbnailUrl: null };
  return {
    id: row.id, fileName: row.fileName, relativePath: row.relativePath, mimeType: row.mimeType, width: row.width, height: row.height, capturedAt: row.capturedAt,
    sizeBytes: toNumber(row.sizeBytes), sourceSizeBytes: toNumber(row.sourceSizeBytes),
    // Whether the original is stored - a photo without one cannot be bought. Its key never leaves the server.
    hasOriginal: Boolean(row.originalKey),
    // Staff see the clean thumbnail; the watermarked addresses are what guests are handed.
    thumbnailUrl: storage.publicUrl(row.thumbnailKey), watermarkedThumbnailUrl: addresses.thumbnailUrl, watermarkedPreviewUrl: addresses.previewUrl,
    available: row.available, pricePaise: row.pricePaise, sortOrder: row.sortOrder,
    faceStatus: row.faceStatus, faceCount: row.faceCount, faceError: row.faceError ?? null, createdAt: row.createdAt,
  };
}

/** The gallery a photo may be added to or changed in: 404 when there is none, 409 when archived. */
async function loadEditable(galleryId) {
  const gallery = await prisma.photoSaleGallery.findUnique({ where: { id: String(galleryId) } });
  if (!gallery) throw httpError(404, "Gallery not found.");
  if (gallery.archivedAt) throw httpError(409, "Restore this gallery before changing its photos.");
  return gallery;
}

async function findByHash(galleryId, contentHash) {
  return prisma.photoSalePhoto.findUnique({ where: { galleryId_contentHash: { galleryId, contentHash } } });
}

/**
 * Takes one photo into a gallery. `files.original` is the file as the uploader has it (on disk here,
 * `{ path, size, originalname }`); `files.preview` and `files.thumbnail` are the web-size copy and
 * tile its computer made, when it made them (`{ buffer }`). Answers `{ photo, duplicate }`: a photo
 * the gallery already holds is `duplicate: true` and changes nothing - except one taken off sale
 * earlier, which comes back, and one stored before originals were kept, which gets its original now.
 */
async function upload(galleryId, files, { source = null, userId = null } = {}) {
  const gallery = await loadEditable(galleryId);
  const original = files?.original;
  if (!original?.path || !original.size) throw httpError(400, "Choose a photo to upload.");
  const { head, sha256 } = await readOriginal(original.path);
  const mime = sniffImageType(head);
  if (!mime) throw httpError(415, "Only photos can be uploaded (JPG, PNG, WebP, HEIC or TIFF).");
  if (source?.fingerprint && source.fingerprint !== sha256) throw httpError(422, "The photo changed on its way here (its fingerprint does not match). Upload it again.");
  const fileName = String(source?.fileName || original.originalname || "photo").replace(/\\/g, "/").split("/").pop().slice(0, 500);
  const sizeBytes = BigInt(original.size);
  const hash = watermarks.lookHash(gallery.watermarkSnapshot);

  const answerExisting = async (existing) => {
    const data = {};
    if (existing.removedAt) Object.assign(data, { removedAt: null, available: true });
    if (!existing.originalKey) Object.assign(data, { originalKey: await storage.putOriginal(gallery.id, fileName, original.path, original.size, mime), mimeType: mime, sizeBytes });
    if (!Object.keys(data).length) return { photo: serializePhoto(existing, hash), duplicate: true };
    const back = await prisma.photoSalePhoto.update({ where: { id: existing.id }, data });
    return { photo: serializePhoto(back, hash), duplicate: false, restored: true };
  };
  const existing = await findByHash(gallery.id, sha256);
  if (existing) return answerExisting(existing);

  let derived;
  try {
    if (files.preview?.buffer?.length) derived = await derivatives.derive(files.preview.buffer, { preOptimized: true, clientThumbnail: files.thumbnail?.buffer || null });
    else if (original.size <= SERVER_PREVIEW_MAX_BYTES) derived = await derivatives.derive(await fs.promises.readFile(original.path));
    else throw new Error("it is too large for the server to make a preview from - upload it from the web or desktop app, which prepare one");
  } catch (error) { throw httpError(422, `The photo could not be read: ${error.message}`); }
  const measured = await originalSize(original.path);
  // A format this server can read must read: magic bytes followed by anything else are not a photo.
  // HEIC/HEIF is exempt - this server may not decode it, and the uploader's own preview vouches for it.
  if (!measured && !["image/heic", "image/heif"].includes(mime)) throw httpError(422, "The photo could not be read: the file is damaged or is not really a photo.");
  const size = measured || { width: derived.width, height: derived.height };

  const written = [];
  let row;
  try {
    const originalKey = await storage.putOriginal(gallery.id, fileName, original.path, original.size, mime);
    written.push(originalKey);
    const [previewKey, thumbnailKey] = await Promise.all([
      storage.putPublic(gallery.id, "previews", "jpg", derived.preview, "image/jpeg"),
      storage.putPublic(gallery.id, "thumbnails", derived.thumbnailExtension, derived.thumbnail, derived.thumbnailMime),
    ]);
    written.push(previewKey, thumbnailKey);
    const last = await prisma.photoSalePhoto.aggregate({ where: { galleryId: gallery.id }, _max: { sortOrder: true } });
    row = await prisma.photoSalePhoto.create({ data: {
      galleryId: gallery.id, fileName, relativePath: source?.relativePath ? source.relativePath.slice(0, 1024) : null,
      mimeType: mime, sizeBytes, sourceSizeBytes: source?.sizeBytes == null ? null : BigInt(source.sizeBytes),
      width: size.width, height: size.height, capturedAt: derived.capturedAt || source?.capturedAt || null,
      contentHash: sha256, originalKey, previewKey, thumbnailKey, sortOrder: (last._max.sortOrder ?? -1) + 1,
      // Selfie search is offered when a face engine is set up, so each photo is indexed as soon as one is.
      faceStatus: faces.current().impl ? "QUEUED" : "NONE", uploadedByUserId: userId,
    } });
  } catch (error) {
    // Nothing half-stored: whatever this upload wrote is given back - recorded first, so a file R2
    // will not delete now is retried until it is gone. The same photo landing twice at once keeps one
    // row, and the other upload is answered with it.
    await cleanup.record(cleanup.plan(gallery.id, { originals: written.filter(storage.isOriginalKey), public: written.filter((key) => !storage.isOriginalKey(key)) }));
    await cleanup.drain({ galleryId: gallery.id }).catch((failure) => console.error("[photo-selling] upload cleanup failed:", failure.message));
    if (error?.code === "P2002") { const winner = await findByHash(gallery.id, sha256); if (winner) return answerExisting(winner); }
    throw error;
  }
  if (row.faceStatus === "QUEUED") queue().enqueueIndex(row.id).catch((error) => console.error("[photo-selling] face index enqueue failed:", error.message));
  if (gallery.status === "PUBLISHED") watermarks.warmGallery(gallery.id);
  return { photo: serializePhoto(row, hash), duplicate: false };
}

/** The gallery's photos. `scope` all | available | hidden | preparing (faces being found) | issues (indexing failed). */
async function list(galleryId, { scope = "all", search = "", sort = "upload", page = 1 } = {}) {
  const gallery = await prisma.photoSaleGallery.findUnique({ where: { id: String(galleryId) }, select: { id: true, watermarkSnapshot: true } });
  if (!gallery) throw httpError(404, "Gallery not found.");
  const base = { galleryId: gallery.id, ...LIVE };
  const scopes = { all: base, available: { ...base, available: true }, hidden: { ...base, available: false }, preparing: { ...base, faceStatus: { in: ["QUEUED", "PROCESSING"] } }, issues: { ...base, faceStatus: "FAILED" } };
  const where = { ...(scopes[scope] || base), ...(search ? { fileName: { contains: search } } : {}) };
  const orderBy = sort === "name" ? [{ fileName: "asc" }] : sort === "captured" ? [{ capturedAt: "asc" }, { fileName: "asc" }] : sort === "newest" ? [{ createdAt: "desc" }] : [{ sortOrder: "asc" }];
  const current = Math.max(1, Number(page) || 1);
  const [total, rows, counts] = await Promise.all([
    prisma.photoSalePhoto.count({ where }),
    prisma.photoSalePhoto.findMany({ where, orderBy, skip: (current - 1) * PAGE_SIZE, take: PAGE_SIZE }),
    Promise.all(["all", "available", "hidden", "preparing", "issues"].map((key) => prisma.photoSalePhoto.count({ where: scopes[key] }))),
  ]);
  const hash = watermarks.lookHash(gallery.watermarkSnapshot);
  return { items: rows.map((row) => serializePhoto(row, hash)), total, page: current, pageSize: PAGE_SIZE, counts: { all: counts[0], available: counts[1], hidden: counts[2], preparing: counts[3], issues: counts[4] } };
}

/** Availability and price for a selection. `pricePaise: null` clears a photo's own price. */
async function update(galleryId, { photoIds, available, pricePaise }) {
  const gallery = await loadEditable(galleryId);
  const data = {};
  if (available !== undefined) data.available = available;
  if (pricePaise !== undefined) data.pricePaise = pricePaise;
  const result = await prisma.photoSalePhoto.updateMany({ where: { galleryId: gallery.id, id: { in: photoIds }, ...LIVE }, data });
  if (available === true && gallery.status === "PUBLISHED") watermarks.warmGallery(gallery.id);
  return { updated: result.count };
}

/**
 * Takes photos out of a gallery. One nobody has bought goes entirely - its row and its files. One
 * somebody has ordered is only taken off sale (`removedAt`), so every buyer keeps their download.
 */
async function remove(galleryId, { photoIds }) {
  const gallery = await loadEditable(galleryId);
  const rows = await prisma.photoSalePhoto.findMany({ where: { galleryId: gallery.id, id: { in: photoIds }, ...LIVE }, select: { id: true, originalKey: true, previewKey: true, thumbnailKey: true, _count: { select: { orderItems: true } }, watermarks: { select: { previewKey: true, thumbnailKey: true } } } });
  // The database refuses to delete a photo any order names (Restrict), so an order made a moment
  // after the count above still keeps its photo: that delete fails and the photo is taken off sale.
  const sold = rows.filter((row) => row._count.orderItems > 0);
  const deleted = [];
  for (const row of rows.filter((item) => item._count.orderItems === 0)) {
    try {
      // The photo's files are recorded for deletion in the same transaction that deletes its row.
      const plan = cleanup.plan(gallery.id, { public: [row.previewKey, row.thumbnailKey, ...row.watermarks.flatMap((copy) => [copy.previewKey, copy.thumbnailKey])], originals: [row.originalKey] });
      await prisma.$transaction(async (tx) => { await cleanup.record(plan, tx); await tx.photoSalePhoto.delete({ where: { id: row.id } }); });
      deleted.push(row);
    }
    catch (error) { if (error?.code === "P2003") sold.push(row); else throw error; }
  }
  if (sold.length) await prisma.photoSalePhoto.updateMany({ where: { id: { in: sold.map((row) => row.id) } }, data: { removedAt: new Date(), available: false } });
  if (deleted.length) await cleanup.drain({ galleryId: gallery.id }).catch((failure) => console.error("[photo-selling] photo cleanup failed:", failure.message));
  if (gallery.coverPhotoId && photoIds.includes(gallery.coverPhotoId)) await prisma.photoSaleGallery.update({ where: { id: gallery.id }, data: { coverPhotoId: null } });
  return { removed: deleted.length, keptForBuyers: sold.length };
}

/** Finds the faces again in photos whose indexing failed (or all not yet indexed) - the studio's Retry. */
async function reindex(galleryId, { photoIds } = {}) {
  const gallery = await loadEditable(galleryId);
  if (!faces.current().impl) throw httpError(503, faces.current().reason);
  return { queued: await faces.queueIndexing({ galleryId: gallery.id, photoIds: photoIds || null, includeFailed: true }) };
}

module.exports = { PHOTO_TYPES, PAGE_SIZE, SERVER_PREVIEW_MAX_BYTES, sniffImageType, serializePhoto, assertEditable: loadEditable, upload, list, update, remove, reindex };
