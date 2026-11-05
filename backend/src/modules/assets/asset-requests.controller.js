const { z } = require("zod");
const prisma = require("../../config/db");
const iamService = require("../../services/iam.service");
const { createAssetRecord, validationMessage: assetValidationMessage, duplicateMessage: assetDuplicateMessage } = require("./assets.controller");

const fail = (status, message) => Object.assign(new Error(message), { status });
const handler = (work, status = 200) => async (req, res) => { try { res.status(status).json(await work(req)); } catch (error) { console.error("Asset request error:", error); if (error instanceof z.ZodError) return res.status(400).json({ message: error.issues[0]?.message || "Please correct the asset request details.", errors: error.issues }); res.status(error.status || 500).json({ message: error.status ? error.message : "Unable to process asset request." }); } };

// Preprocessed so a missing field reports the same readable message as a blank one.
const required = (max, message) => z.preprocess((value) => value ?? "", z.string().trim().min(1, message).max(max));
const requestInput = z.object({
  assetName: required(150, "Enter the name of the asset being requested."),
  categoryId: required(191, "Select the category this asset belongs to."),
  // Optional because not every category has children to choose from.
  subCategoryId: z.preprocess((value) => value === "" ? null : value, z.string().max(191).nullable().optional()),
  remarks: z.preprocess((value) => typeof value === "string" && value.trim() === "" ? null : value, z.string().trim().max(10000).nullable().optional()),
});
const requestStatuses = ["PENDING", "APPROVED", "REJECTED"];
const listInput = z.object({ status: z.enum(requestStatuses).optional(), page: z.coerce.number().int().positive().default(1), limit: z.coerce.number().int().min(1).max(100).default(50) });
// A rejection is only useful to the person who asked if it says why, so the remark is mandatory.
const rejectInput = z.object({ remarks: z.preprocess((value) => value ?? "", z.string().trim().min(1, "Enter a reason for rejecting this request.").max(10000)) });

const include = { category: { select: { id: true, name: true } }, subCategory: { select: { id: true, name: true } }, asset: { select: { id: true, assetCode: true, assetName: true } } };

async function nextRequestCode() {
  const row = await prisma.appSequence.upsert({ where: { key: "ASSET_REQUEST_ID" }, create: { key: "ASSET_REQUEST_ID", currentValue: 1 }, update: { currentValue: { increment: 1 } } });
  return `AR-${String(row.currentValue).padStart(6, "0")}`;
}

/**
 * Both categories are checked against the tree rather than trusted: the sub category must be
 * active, and must actually sit under the category chosen, so a request cannot pair two
 * unrelated branches.
 */
async function verifyCategories(input) {
  const category = await prisma.assetCategory.findFirst({ where: { id: input.categoryId, isActive: true }, select: { id: true } });
  if (!category) throw fail(400, "Select a valid asset category.");
  if (!input.subCategoryId) return;
  const subCategory = await prisma.assetCategory.findFirst({ where: { id: input.subCategoryId, isActive: true }, select: { parentId: true } });
  if (!subCategory) throw fail(400, "Select a valid asset sub category.");
  if (subCategory.parentId !== category.id) throw fail(400, "That sub category does not belong to the category chosen.");
}

/** Attaches the requesting and deciding users' names so a list can show who asked and who ruled. */
async function decorate(rows) {
  const list = Array.isArray(rows) ? rows : [rows];
  const ids = [...new Set(list.flatMap((row) => [row.requestedBy, row.decidedBy]).filter(Boolean))];
  const users = ids.length ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : [];
  const names = new Map(users.map((user) => [user.id, user.name]));
  const result = list.map((row) => ({
    ...row,
    requestedByName: row.requestedBy ? names.get(row.requestedBy) || null : null,
    decidedByName: row.decidedBy ? names.get(row.decidedBy) || null : null,
  }));
  return Array.isArray(rows) ? result : result[0];
}

// Who decided. The right to decide is checked by the route's own ASSET / Asset Request Approval
// guard - this used to refuse anybody but a SUPER_ADMIN here instead, which meant the permission
// could be granted and still not work, and no role short of super admin could ever approve.
const decidedBy = (req) => Number(req.user.id);

/**
 * Reads the request being decided and refuses a second decision on it, so an approval cannot add a
 * duplicate asset for a request another admin has already handled.
 */
async function pendingRequest(req) {
  const id = Number(req.params.requestId);
  if (!Number.isInteger(id) || id < 1) throw fail(400, "Asset request not found.");
  const row = await prisma.assetRequest.findUnique({ where: { id } });
  if (!row) throw fail(404, "Asset request not found.");
  if (row.status !== "PENDING") throw fail(409, `This request has already been ${row.status.toLowerCase()}.`);
  return row;
}

exports.list = handler(async (req) => {
  const input = listInput.parse(req.query);
  // Requests are raised by the person who wants the asset, and Asset Assignment is meant to be held
  // widely so anybody can raise one. Unscoped, that handed every employee everybody else's requests.
  // Approving is what carries the right to read the queue, so it is what widens this.
  const mayDecide = await iamService.hasPermission(req.user.id, "ASSET", "Asset Request Approval", "READ");
  const where = {
    ...(input.status ? { status: input.status } : {}),
    ...(mayDecide ? {} : { requestedBy: Number(req.user.id) }),
  };
  const [rows, total] = await Promise.all([
    prisma.assetRequest.findMany({ where, include, orderBy: { createdAt: "desc" }, skip: (input.page - 1) * input.limit, take: input.limit }),
    prisma.assetRequest.count({ where }),
  ]);
  return { data: await decorate(rows), pagination: { page: input.page, limit: input.limit, total, totalPages: Math.ceil(total / input.limit) } };
});

exports.create = handler(async (req) => {
  const input = requestInput.parse(req.body);
  await verifyCategories(input);
  const row = await prisma.assetRequest.create({
    data: { ...input, requestCode: await nextRequestCode(), requestedBy: Number(req.user.id) },
    include,
  });
  return { data: await decorate(row), message: `Asset request ${row.requestCode} raised.` };
}, 201);

/**
 * Approving is the act of adding the asset that was asked for: the body carries the full Add Asset
 * form under `asset`, which is written through the assets module so an approved asset is validated
 * and stored exactly like any other. Only once that asset exists is the request marked APPROVED and
 * pointed at it, so a failed or abandoned save leaves the request pending rather than approved with
 * nothing to show for it.
 */
exports.approve = handler(async (req) => {
  const userId = decidedBy(req);
  const request = await pendingRequest(req);
  let asset;
  try {
    asset = await createAssetRecord(req.body?.asset ?? {}, userId);
  } catch (error) {
    // The asset rules speak in the Add Asset form's own labels; without this they would surface as
    // a bare 500 from the request handler below.
    if (error instanceof z.ZodError) throw fail(400, assetValidationMessage(error));
    if (error.code === "P2002") throw fail(409, assetDuplicateMessage(error));
    throw error;
  }
  // Guarded on PENDING so two admins approving at once cannot both claim the request; the loser's
  // asset is still created, and is reported rather than silently attached to a settled request.
  const claimed = await prisma.assetRequest.updateMany({
    where: { id: request.id, status: "PENDING" },
    data: { status: "APPROVED", decidedBy: userId, decidedAt: new Date(), assetId: asset.id },
  });
  if (!claimed.count) throw fail(409, `Another admin decided this request first. Asset ${asset.assetCode} was still created.`);
  const row = await prisma.assetRequest.findUnique({ where: { id: request.id }, include });
  return { data: await decorate(row), message: `Asset request ${request.requestCode} approved and asset ${asset.assetCode} added.` };
});

exports.reject = handler(async (req) => {
  const userId = decidedBy(req);
  const request = await pendingRequest(req);
  const input = rejectInput.parse(req.body);
  const claimed = await prisma.assetRequest.updateMany({
    where: { id: request.id, status: "PENDING" },
    data: { status: "REJECTED", decisionRemarks: input.remarks, decidedBy: userId, decidedAt: new Date() },
  });
  if (!claimed.count) throw fail(409, "Another admin decided this request first.");
  const row = await prisma.assetRequest.findUnique({ where: { id: request.id }, include });
  return { data: await decorate(row), message: `Asset request ${request.requestCode} rejected.` };
});
