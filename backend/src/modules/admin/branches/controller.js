const { createBranchesService } = require("./service");
const { storeImage } = require("../../../services/imageStorage");
const { createBranchSchema, updateBranchSchema } = require("./validation");
const { describeRenamed } = require("../../../services/nameCopies");

/**
 * Settings → Organization → Branches, over HTTP.
 *
 * Who may reach any of this is decided by the router, which mounts ADMIN / System Settings once for
 * every route below — the same permission the rest of the studio's settings answer to. Nothing here
 * looks at `req.user.role`: a check inside a controller silently overrules the guard above it and
 * cannot be granted to anybody.
 */

const service = createBranchesService();

function handleError(error, res, action) {
  // A clash carries a message per field, so it arrives in the same shape a validation failure does
  // and the form can put each one under the box it belongs to.
  if (error.status) return res.status(error.status).json({ message: error.message, ...(error.fieldErrors ? { errors: { fieldErrors: error.fieldErrors } } : {}) });
  console.error(`Unable to ${action} branch:`, error);
  return res.status(500).json({ message: `Unable to ${action} branch.` });
}

/** A validation failure, in the shape the form reads: one message per field it names. */
const refuse = (res, result, message) => res.status(400).json({ message, errors: result.error.flatten() });

/**
 * The QR code put where a link can reach it, before the branch is written.
 *
 * The browser sends the picture itself, as the compressed data URI `ImageUploadField` produces —
 * the same journey the gallery logo and an asset's photograph already make. `storeImage` uploads
 * it and answers the link to store. What it does *not* do is re-upload a link: a branch edited to
 * fix its IFSC sends back the QR link it already holds, and that comes through untouched rather
 * than becoming a second copy of the same picture in the bucket.
 *
 * Only ever run when the request named the key. On a create the schema always answers it, so an
 * absent QR is a null and is stored as one; on an edit an unnamed key means "not changing this",
 * and uploading nothing over it is precisely the point — an edit to the phone number must not
 * clear the QR.
 */
async function withStoredQrCode(data) {
  if (!("qrCodeUrl" in data)) return data;
  const stored = await storeImage(data.qrCodeUrl, { folder: "branches/qr-codes" });
  return { ...data, qrCodeUrl: stored ? stored.url : null };
}

/** The id in the URL, or null if it is not one — never trusted as given. */
const idFrom = (req) => {
  const id = Number(req.params.id);
  return Number.isInteger(id) && id > 0 ? id : null;
};

async function listBranches(req, res) {
  try {
    return res.json({ data: await service.list() });
  } catch (error) {
    return handleError(error, res, "load");
  }
}

async function createBranch(req, res) {
  const result = createBranchSchema.safeParse(req.body);
  if (!result.success) return refuse(res, result, "Check the branch details.");
  try {
    return res.status(201).json({ data: await service.create(await withStoredQrCode(result.data)) });
  } catch (error) {
    return handleError(error, res, "create");
  }
}

async function updateBranch(req, res) {
  const id = idFrom(req);
  if (!id) return res.status(400).json({ message: "That is not a branch." });
  const result = updateBranchSchema.safeParse(req.body);
  if (!result.success) return refuse(res, result, "Check the branch details.");
  try {
    const { renamed, ...branch } = await service.update(id, await withStoredQrCode(result.data));
    // Said rather than left to be noticed: renaming a branch rewrites it on every record filed
    // under it, and whoever did it should hear so at the moment it happens.
    return res.json({ data: branch, ...(renamed ? { message: `Branch renamed, and ${describeRenamed(renamed)}.` } : {}) });
  } catch (error) {
    return handleError(error, res, "save");
  }
}

module.exports = { listBranches, createBranch, updateBranch };
