const { optionNames } = require("../../services/optionLists");
/** What the picker offered before this list was editable, and what a failed read falls back to. */
const FALLBACK_ASSET_CONDITIONS = ["Excellent", "Good", "Fair", "Damaged"];
const { z } = require("zod");
const prisma = require("../../config/db");
const { storeImages, discardUploads } = require("../../services/imageStorage");
const { nextInspectionDate } = require("./inspection-schedule");
// The asset is read through the same scope as the Asset Management screen: an inspection is part
// of that screen and that permission, so an asset the list would not show cannot be inspected by id.
const { findScopedAsset, capabilitiesFor } = require("./assets.read.service");

const INSPECTION_IMAGE_FOLDER = "assets/inspections";

const allowedImageTypes = ["image/avif", "image/gif", "image/jpeg", "image/png", "image/webp"];
const imageInput = z.object({
  slot: z.coerce.number().int().min(1).max(3),
  imageData: z.string().max(7000000),
  fileName: z.string().trim().min(1).max(255),
  mimeType: z.enum(allowedImageTypes),
  fileSize: z.coerce.number().int().positive().max(5 * 1024 * 1024),
  lastModifiedAt: z.coerce.date().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
});
const inspectionInput = z.object({
  // Checked against the studio's own list rather than a set compiled in - it was this array here and
  // a second copy in `formPanelConfig.js` drawing the picker, so a condition added to one was
  // offered by the form and refused here. Async, hence the `safeParseAsync` below.
  condition: z.string().trim().min(1).refine(
    async (value) => (await optionNames("assetCondition", FALLBACK_ASSET_CONDITIONS)).includes(value),
    { message: "Choose the condition" },
  ),
  remarks: z.string().trim().min(1).max(10000),
  inspectedOn: z.coerce.date(),
  inspectedById: z.coerce.number().int().positive(),
  images: z.array(imageInput).length(3),
}).superRefine((input, context) => {
  if (new Set(input.images.map((image) => image.slot)).size !== 3) context.addIssue({ code: "custom", path: ["images"], message: "Upload one image for each of the three inspection slots." });
  if (input.inspectedOn > new Date()) context.addIssue({ code: "custom", path: ["inspectedOn"], message: "Inspected On cannot be in the future." });
});

const fail = (status, message, details) => Object.assign(new Error(message), { status, details });
const imageMetadataKey = (image) => [image.fileName.trim().toLowerCase(), image.mimeType.toLowerCase(), Number(image.fileSize), image.lastModifiedAt ? new Date(image.lastModifiedAt).getTime() : ""].join("|");

// `mimeType` describes the file the user picked and feeds the duplicate fingerprint, while
// `imageData` may already be the browser's compressed WebP, so the two are validated separately.
function validateImageData(image) {
  const match = image.imageData.match(/^data:([^;]+);base64,(.+)$/);
  if (!match || !allowedImageTypes.includes(match[1])) throw fail(400, `Inspection image ${image.slot} has invalid image data or MIME metadata.`);
  if (Buffer.byteLength(match[2], "base64") > 5 * 1024 * 1024) throw fail(400, `Inspection image ${image.slot} must be 5 MB or smaller.`);
}

async function actor(userId, transaction = prisma) {
  const user = await transaction.user.findUnique({ where: { id: Number(userId) }, select: { id: true, name: true, linkedEmployeeId: true } });
  if (!user) throw fail(401, "The authenticated user no longer exists.");
  const employee = user.linkedEmployeeId ? await transaction.employee.findUnique({ where: { id: user.linkedEmployeeId }, select: { employeeId: true, employeeName: true } }) : null;
  return { userId: user.id, employeeId: employee?.employeeId || null, name: employee?.employeeName || user.name };
}

async function nextInspectionCode(transaction) {
  const row = await transaction.appSequence.upsert({ where: { key: "ASSET_INSPECTION_ID" }, create: { key: "ASSET_INSPECTION_ID", currentValue: 1 }, update: { currentValue: { increment: 1 } } });
  return `INS-${String(row.currentValue).padStart(6, "0")}`;
}

async function context(req, res) {
  try {
    const assetId = Number(req.params.assetId);
    const asset = await findScopedAsset(req, assetId, { select: { currentInspectionImageMetadata: true, lastInspectionImageMetadata: true, secondLastInspectionImageMetadata: true, currentInspectionImages: true, lastInspectionImages: true, secondLastInspectionImages: true } });
    if (!asset) throw fail(404, "Asset not found.");
    const sets = [
      { label: "current", images: asset.currentInspectionImageMetadata, files: asset.currentInspectionImages },
      { label: "last", images: asset.lastInspectionImageMetadata, files: asset.lastInspectionImages },
      { label: "secondLast", images: asset.secondLastInspectionImageMetadata, files: asset.secondLastInspectionImages },
    ];
    // Only stored links are returned; rows written before R2 held inline base64 and are omitted.
    const inspections = sets.filter((set) => Array.isArray(set.images)).map((set) => ({ label: set.label, images: set.images, files: (Array.isArray(set.files) ? set.files : []).filter((file) => file && typeof file.url === "string").map((file) => ({ slot: file.slot, url: file.url, width: file.width || null, height: file.height || null, byteSize: file.byteSize || null })) }));
    return res.json({ data: inspections });
  } catch (error) {
    console.error("Asset inspection context error:", error);
    return res.status(error.status || 500).json({ message: error.status ? error.message : "Unable to load inspection history." });
  }
}

/** Rejects images already fingerprinted in any of the three retained inspection sets. */
function assertUnseenImages(asset, images) {
  const previousImages = [asset.currentInspectionImageMetadata, asset.lastInspectionImageMetadata, asset.secondLastInspectionImageMetadata].filter(Array.isArray).flat();
  const previousKeys = new Set(previousImages.map(imageMetadataKey));
  const duplicateSlots = images.filter((image) => previousKeys.has(imageMetadataKey(image))).map((image) => image.slot);
  if (duplicateSlots.length) throw fail(409, "This image was taken during the last inspection.", { duplicateSlots });
  const currentKeys = images.map(imageMetadataKey);
  if (new Set(currentKeys).size !== currentKeys.length) throw fail(400, "Upload three different inspection images.");
}

async function create(req, res) {
  let uploaded = [];
  try {
    const assetId = Number(req.params.assetId);
    // `parseAsync`: the condition is checked against the studio's own list.
    const input = await inspectionInput.parseAsync(req.body);
    input.images.forEach(validateImageData);

    // Validate everything cheaply before spending time compressing and uploading to R2.
    const existing = await findScopedAsset(req, assetId);
    if (!existing) throw fail(404, "Asset not found.");
    // Reading the inspection context is part of looking at the asset; writing one down is part of
    // being responsible for it, so it answers to the same rule as editing the record.
    const { canInspect } = await capabilitiesFor(req, existing);
    if (!canInspect) throw fail(403, "Only this asset's manager, or whoever added it, can record an inspection.");
    assertUnseenImages(existing, input.images);
    const recordedBy = await actor(req.user.id);
    const inspectedBy = await prisma.employee.findFirst({ where: { id: input.inspectedById, archivedAt: null }, select: { id: true, employeeId: true, employeeName: true } });
    if (!inspectedBy) throw fail(400, "Select a valid active employee for Inspected By.");

    // Compress to <=150 KB and push to R2 outside the transaction: object storage is network I/O
    // and must not hold a database transaction open.
    uploaded = await storeImages(input.images.map((image) => image.imageData), { folder: INSPECTION_IMAGE_FOLDER });
    const currentImages = input.images.map((image, index) => ({ slot: image.slot, url: uploaded[index].url, key: uploaded[index].key, byteSize: uploaded[index].byteSize, width: uploaded[index].width, height: uploaded[index].height, mimeType: uploaded[index].mimeType }));
    const currentMetadata = input.images.map((image) => ({ slot: image.slot, fileName: image.fileName, mimeType: image.mimeType, fileSize: image.fileSize, lastModifiedAt: image.lastModifiedAt || null, metadata: image.metadata || null }));

    const result = await prisma.$transaction(async (transaction) => {
      const asset = await transaction.asset.findFirst({ where: { id: assetId, isDeleted: false } });
      if (!asset) throw fail(404, "Asset not found.");
      assertUnseenImages(asset, input.images);
      const inspectedAt = input.inspectedOn;
      const inspectionCode = await nextInspectionCode(transaction);
      const updatedAsset = await transaction.asset.update({ where: { id: assetId }, data: { inspectionCode, inspectionCondition: input.condition, inspectionRemarks: input.remarks, inspectedOn: inspectedAt, inspectedById: inspectedBy.id, inspectedByUserId: recordedBy.userId, inspectedByEmployeeId: inspectedBy.employeeId, inspectedByName: inspectedBy.employeeName, secondLastInspectionImages: asset.lastInspectionImages || undefined, secondLastInspectionImageMetadata: asset.lastInspectionImageMetadata || undefined, lastInspectionImages: asset.currentInspectionImages || undefined, lastInspectionImageMetadata: asset.currentInspectionImageMetadata || undefined, currentInspectionImages: currentImages, currentInspectionImageMetadata: currentMetadata, lastInspectedDate: inspectedAt, nextInspectionDate: nextInspectionDate(inspectedAt, asset.inspectionPeriodMonths), updatedBy: recordedBy.userId } });
      return { evicted: asset.secondLastInspectionImages, inspection: { inspectionCode, condition: input.condition, remarks: input.remarks, inspectedAt, inspectedBy, recordedBy, images: currentImages, metadata: currentMetadata }, asset: updatedAsset };
    });
    uploaded = []; // Committed: these objects are now referenced and must survive any later failure.
    // Only three sets are retained, so the set that just rolled off is no longer referenced.
    await discardUploads(Array.isArray(result.evicted) ? result.evicted : []);
    return res.status(201).json({ data: { inspection: result.inspection, asset: result.asset } });
  } catch (error) {
    await discardUploads(uploaded);
    console.error("Asset inspection error:", error);
    const validationError = error instanceof z.ZodError;
    return res.status(validationError ? 400 : error.status || 500).json({ message: validationError ? error.issues[0]?.message || "Invalid inspection details." : error.status ? error.message : "Unable to save asset inspection.", details: error.details });
  }
}

module.exports = { context, create };
