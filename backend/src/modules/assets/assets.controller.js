const { z } = require("zod");
const prisma = require("../../config/db");
const { storeImage, storeImages, discardUploads } = require("../../services/imageStorage");
const { deleteObject } = require("../../services/objectStorage");
const { storeDocuments } = require("../../services/documentStorage");
const { nextInspectionDate } = require("./inspection-schedule");
const { nextIdentifier } = require("../../services/identifiers");
const { importTableRows, templateHeaders } = require("../../services/tableImport");

const iamService = require("../../services/iam.service");

/*
 * The two permissions an asset's branch is measured against, named where the routes name them.
 * Registering an asset into the register is `Asset Administration`; correcting one already on it is
 * `Asset Management` plus the per-record `capabilitiesFor` check beside it.
 */
const ASSET_ADMINISTRATION = { module: "ASSET", feature: "Asset Administration", level: "READ_WRITE" };
const ASSET_MANAGEMENT = { module: "ASSET", feature: "Asset Management", level: "READ_WRITE" };
const { assetScopeFor, findScopedAsset, assetCaller, capabilitiesOf, capabilitiesFor, ALLOWED_STATUS_TRANSITIONS } = require("./assets.read.service");

const ASSET_PHOTO_FOLDER = "assets/photos";
const ASSET_GALLERY_FOLDER = "assets/gallery";

const assignableAssetStatuses = ["ACTIVE", "UNDER_REPAIR", "IN_SERVICE", "IN_TRANSIT", "LOST", "SOLD", "DISPOSED", "UNASSIGNED"];
const reasonRequiredStatuses = ["LOST", "SOLD", "DISPOSED", "UNASSIGNED"];
const nullableDate = z.preprocess((value) => value === "" ? null : value, z.coerce.date().nullable().optional());
// A newly picked document arrives inline as `data`; one already on the asset comes back as the
// `url` it was stored at, and is passed through rather than uploaded again.
const documentInput = z.union([
  z.object({ name: z.string().trim().min(1).max(255), data: z.string().max(7000000) }),
  z.object({ name: z.string().trim().min(1).max(255), url: z.string().url().max(2000) }),
]);
const assetInput = z.object({ assetName: z.string().trim().min(1).max(150), specification: z.string().trim().max(10000).nullable().optional(), company: z.string().trim().max(150).nullable().optional(), serialNumber: z.string().trim().max(100).nullable().optional(), branchId: z.coerce.number().int().positive(), categoryId: z.string().cuid().nullable().optional(), assignedPersonId: z.coerce.number().int().positive().nullable().optional(), managerId: z.coerce.number().int().positive().nullable().optional(), remarks: z.string().trim().max(10000).nullable().optional(), photoData: z.string().max(7000000).nullable().optional(), status: z.enum(assignableAssetStatuses).optional(), color: z.string().trim().max(80).nullable().optional(), purchaseDate: nullableDate, inspectionPeriodMonths: z.coerce.number().int().nonnegative().max(600).nullable().optional(), lastInspectedDate: nullableDate, purchasePrice: z.coerce.number().nonnegative().nullable().optional(), purchasedFrom: z.string().trim().max(150).nullable().optional(), invoiceNumber: z.string().trim().max(100).nullable().optional(), warrantyMonths: z.coerce.number().int().nonnegative().nullable().optional(), insuranceDetails: z.string().trim().max(10000).nullable().optional(), insuranceExpiry: nullableDate, images: z.array(z.string().max(7000000)).max(10).nullable().optional(), documents: z.array(documentInput).max(10).nullable().optional() });
const bulkAssetInput = assetInput.extend({
  bulkItems: z.array(z.object({
    serialNumber: z.string().trim().min(1).max(100),
    company: z.string().trim().min(1).max(150),
    color: z.string().trim().min(1).max(80),
  })).min(2).max(100),
}).superRefine((input, context) => {
  const serialNumbers = input.bulkItems.map((item) => item.serialNumber.toLowerCase());
  if (new Set(serialNumbers).size !== serialNumbers.length) context.addIssue({ code: "custom", path: ["bulkItems"], message: "Serial Numbers must be unique within the bulk entry." });
});
const listInput = z.object({ categoryId: z.string().cuid().optional(), includeChildren: z.enum(["true", "false"]).optional(), q: z.string().trim().optional(), status: z.enum(["ACTIVE", "UNDER_REPAIR", "IN_SERVICE", "IN_TRANSIT", "INACTIVE", "LOST", "STOLEN", "SOLD", "DISPOSED", "UNASSIGNED"]).optional(), inspection: z.enum(["MAINTENANCE"]).optional(), branchId: z.coerce.number().int().positive().optional(), page: z.coerce.number().int().positive().default(1), limit: z.coerce.number().int().min(1).max(100).default(50) });
const statusInput = z.object({ nextStatus: z.enum(assignableAssetStatuses), changeType: z.string().trim().min(1).max(40), reason: z.string().trim().max(10000).optional(), formData: z.record(z.string(), z.unknown()).optional() }).superRefine((input, context) => {
  if (reasonRequiredStatuses.includes(input.nextStatus) && !input.reason) context.addIssue({ code: "custom", path: ["reason"], message: "Reason and remarks are required for this status." });
  if (input.nextStatus === "SOLD" && (!String(input.formData?.soldByName || "").trim() || !String(input.formData?.soldTo || "").trim() || !String(input.formData?.soldToContact || "").trim())) context.addIssue({ code: "custom", path: ["formData"], message: "Sold By Name, Sold To Name, and Sold To Contact are required." });
  if (input.nextStatus === "LOST" && !String(input.formData?.lostByName || "").trim()) context.addIssue({ code: "custom", path: ["formData", "lostByName"], message: "Lost By Name is required." });
  if (input.nextStatus === "UNDER_REPAIR" && (!input.formData?.reportedById || !input.formData?.reportedDate)) context.addIssue({ code: "custom", path: ["formData"], message: "Reported By and Reported Date are required." });
  if (input.nextStatus === "UNDER_REPAIR" && (!input.formData?.repairAssignee1Id || !input.formData?.repairAssignee2Id)) context.addIssue({ code: "custom", path: ["formData"], message: "Two repair assignees are required." });
  if (input.nextStatus === "UNDER_REPAIR" && input.formData?.repairAssignee1Id === input.formData?.repairAssignee2Id) context.addIssue({ code: "custom", path: ["formData"], message: "Select two different repair assignees." });
  if (input.changeType === "COMPLETED_SERVICE" && (!input.formData?.receivedOn || !input.formData?.receivedAndReviewedById || !input.formData?.handoverToId || !Number.isFinite(Number(input.formData?.serviceCost)) || Number(input.formData.serviceCost) < 0)) context.addIssue({ code: "custom", path: ["formData"], message: "Received On, Cost, Received and Reviewed By, and Handover To are required." });
});
const include = { category: { select: { id: true, name: true, code: true, parent: { select: { id: true, name: true, code: true } } } }, branch: { select: { id: true, name: true } }, assignedPerson: { select: { id: true, employeeId: true, employeeName: true } }, manager: { select: { id: true, employeeId: true, employeeName: true } } };
const fail = (status, message) => Object.assign(new Error(message), { status });
/** A status as a sentence reads it: UNDER_REPAIR -> "under repair". */
const statusText = (status) => String(status || "").toLowerCase().replace(/_/g, " ");
/**
 * Refuses anybody but a Super Admin.
 *
 * Importing a spreadsheet of assets and deleting one are the studio owner's, and deliberately not
 * expressed as permissions: there is one asset permission and it is held widely, so a level on it
 * could not separate these two from raising a request. This is the narrow carve-out the backend
 * README allows - a thing belonging to one role outright - and it is written here rather than
 * inside a handler's logic so it reads as a guard.
 */
async function superAdminOnly(req, action) {
  const caller = await assetCaller(req);
  if (!caller.isSuperAdmin) throw fail(403, `Only a Super Admin can ${action}.`);
  return caller;
}
/**
 * An asset on its way back to the browser, carrying what this caller may do to it.
 *
 * Every response returning an asset goes through this, so a row the table splices in after a write
 * has the same `capabilities` the list gave it. Without it, changing an asset's status collapsed
 * that row's menu to View until the next refresh - the write had returned an asset with no answer
 * to "what may you do to this one" attached.
 */
async function withCapabilities(req, asset) {
  return { ...asset, capabilities: capabilitiesOf(asset, await assetCaller(req)) };
}
function calculatedInspectionDate(data, existing = {}) { const pick = (field) => Object.prototype.hasOwnProperty.call(data, field) ? data[field] : existing[field]; const baseDate = pick("lastInspectedDate") || pick("purchaseDate"); return nextInspectionDate(baseDate, pick("inspectionPeriodMonths")); }
// Maintenance Pending lists overdue assets only: the inspection date must already have passed.
// Assets merely approaching their due date are deliberately excluded.
function inspectionDateFilter(inspection) { if (!inspection) return undefined; const now = new Date(); const today = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())); return { lt: today }; }
async function descendants(categoryId) { const rows = await prisma.$queryRaw`WITH RECURSIVE tree AS (SELECT id FROM asset_category WHERE id = ${categoryId} UNION ALL SELECT child.id FROM asset_category child INNER JOIN tree parent ON child.parent_id = parent.id) SELECT id FROM tree`; return rows.map((row) => row.id); }
async function categoryIsAsset(categoryId) { if (!categoryId) return; const category = await prisma.assetCategory.findFirst({ where: { id: categoryId, isActive: true, moduleType: "ASSET" } }); if (!category) throw fail(400, "Select an active Asset Management category."); }
/**
 * One asset this request may see, or 404. Held to the same line as the list, through the same
 * resolver on the same columns: an id typed into the URL reaches exactly what the list would have
 * shown and nothing else. Not found rather than forbidden - whether the asset exists is itself
 * something the scope hides.
 */
async function scopedAsset(req, assetId) { const asset = await findScopedAsset(req, assetId); if (!asset) throw fail(404, "Asset not found."); return asset; }
/*
 * DBS-ASMGMT-ERD-000001, counted per branch.
 *
 * An asset is the one record in the studio that carries a real `branchId` rather than a branch
 * typed as text, so its code is read off the `location` row it points at - and each branch counts
 * its own equipment from one, which is how a stocktake at Erode reads as a list of Erode's numbers.
 * A branch the row cannot be read for falls back to the head branch rather than refusing the save.
 */
async function branchOf(branchId, client = prisma) {
  if (!branchId) return "";
  const location = await client.branch.findUnique({ where: { id: Number(branchId) }, select: { code: true, name: true } });
  return location?.name || location?.code || "";
}

const nextCode = (branch, client = prisma) => nextIdentifier("ASSET", { branch }, client);
// Field labels for validation messages, so a schema failure names the control the user sees.
// The only fields the server genuinely demands; everything else on the asset form is optional.
const requiredFields = new Set(["assetName", "branchId", "categoryId"]);
const fieldLabels = { assetName: "Asset Name", categoryId: "Subcategory", branchId: "Branch", assignedPersonId: "Assigned Person", managerId: "Manager", serialNumber: "Serial Number", company: "Brand Name", purchasePrice: "Purchase Price", inspectionPeriodMonths: "Inspection Period in Months", warrantyMonths: "Warranty in Months" };
function validationMessage(error) {
  const issue = error.issues[0];
  if (!issue) return "Invalid asset details.";
  const field = issue.path.find((part) => typeof part === "string");
  const label = fieldLabels[field] || field;
  if (!label) return issue.message;
  // An empty control arrives as "" or 0, which trips the same `too_small` rule that a genuinely
  // out-of-range value does, so the two are separated before wording the message.
  if (issue.code === "invalid_type" || issue.code === "too_small") {
    const missing = issue.code === "invalid_type"
      || (issue.origin === "string" && Number(issue.minimum) <= 1)
      || (issue.origin === "number" && !issue.inclusive && Number(issue.minimum) === 0);
    // Optional relations reject bad ids the same way a blank mandatory field does, so the two
    // cases are separated here rather than telling the user an optional field is required.
    if (missing) return requiredFields.has(field) ? `${label} is required.` : `Select a valid ${label}.`;
    return `${label} must be ${issue.inclusive ? "at least" : "greater than"} ${issue.minimum}.`;
  }
  if (issue.code === "too_big") return `${label} must be ${issue.inclusive ? "at most" : "less than"} ${issue.maximum}.`;
  return `${label}: ${issue.message}`;
}
// A unique-constraint breach is a user error, not a server fault: it reaches here only when two
// requests race past the pre-checks, and P2002 carries no status of its own.
function duplicateMessage(error) {
  const target = String(error.meta?.target || "").toLowerCase();
  if (target.includes("serial")) return "This Serial Number is already used by another asset.";
  if (target.includes("asset_code")) return "That asset code was just taken. Please try again.";
  return "An asset with these details already exists.";
}
const handler = (work, status = 200) => async (req, res) => { try { res.status(status).json(await work(req)); } catch (error) { console.error("Asset management error:", error); if (error instanceof z.ZodError) return res.status(400).json({ message: validationMessage(error) }); if (error.code === "P2002") return res.status(409).json({ message: duplicateMessage(error) }); res.status(error.status || 500).json({ message: error.status ? error.message : "Unable to process asset request." }); } };
/**
 * Pushes every inline payload on `data` to R2 and swaps in the public links: images are
 * compressed to <=150 KB first, documents are stored as picked. Returns the upload receipts so
 * the caller can roll them back if the write that follows fails.
 */
async function attachStoredFiles(data) {
  const uploads = [];
  try {
    if (Object.prototype.hasOwnProperty.call(data, "photoData")) {
      const stored = await storeImage(data.photoData, { folder: ASSET_PHOTO_FOLDER });
      if (stored) uploads.push(stored);
      data.photoData = stored ? stored.url : null;
    }
    if (Object.prototype.hasOwnProperty.call(data, "images")) {
      const stored = await storeImages(data.images, { folder: ASSET_GALLERY_FOLDER });
      uploads.push(...stored);
      data.images = data.images === null ? null : stored.map((item) => item.url);
    }
    if (Object.prototype.hasOwnProperty.call(data, "documents")) {
      const stored = await storeDocuments(data.documents);
      uploads.push(...stored);
      // `data` survives for records written before documents moved to R2, so both shapes persist.
      data.documents = data.documents === null ? null : stored.map((item) => item.url ? { name: item.name, url: item.url } : { name: item.name, data: item.data });
    }
    return uploads;
  } catch (error) {
    await discardUploads(uploads);
    throw error;
  }
}
/** Every bucket link an asset row points at, across its photo, gallery images and documents. */
function fileUrlsOf(asset) {
  const documents = (Array.isArray(asset.documents) ? asset.documents : []).map((document) => document?.url);
  return [asset.photoData, ...(Array.isArray(asset.images) ? asset.images : []), ...documents].filter((value) => typeof value === "string" && value);
}

/**
 * True when any other asset still points at this link.
 *
 * A bulk upload stores one set of objects and writes the same links onto every asset it creates,
 * so removing a file from one of them must not delete an object its siblings still show. Matched
 * with JSON_SEARCH because `images` and `documents` are JSON columns rather than related rows.
 */
async function isReferencedElsewhere(assetId, url) {
  const [row] = await prisma.$queryRaw`
    SELECT COUNT(*) AS total FROM asset
    WHERE id <> ${assetId}
      AND (photo_data = ${url} OR JSON_SEARCH(images, 'one', ${url}) IS NOT NULL OR JSON_SEARCH(documents, 'one', ${url}) IS NOT NULL)`;
  return Number(row?.total || 0) > 0;
}

/** Best-effort removal of bucket objects no asset references any more after an update. */
async function removeUnreferencedFiles(previous, next) {
  const retained = new Set(fileUrlsOf(next));
  const dropped = [...new Set(fileUrlsOf(previous))].filter((url) => !retained.has(url));
  await Promise.all(dropped.map(async (url) => { if (!await isReferencedElsewhere(previous.id, url)) await deleteObject(url); }));
}
const listAssets = handler(async (req) => { const scope = await assetScopeFor(req); const input = listInput.parse(req.query); const categoryIds = input.categoryId ? input.includeChildren === "true" ? await descendants(input.categoryId) : [input.categoryId] : undefined; const inspectionFilter = inspectionDateFilter(input.inspection); /* The scope goes under AND so nothing else in the query can stand in for it: `branchId` from the query string used to be spread after the branch filter and would have replaced it. */ const where = { isDeleted: false, AND: [scope.where], ...(categoryIds && { categoryId: { in: categoryIds } }), ...(input.status && { status: input.status }), ...(inspectionFilter && { nextInspectionDate: inspectionFilter }), ...(input.branchId && { branchId: input.branchId }), ...(input.q && { OR: ["assetCode", "assetName", "serialNumber", "company"].map((field) => ({ [field]: { contains: input.q } })) }) }; const [data, total] = await Promise.all([prisma.asset.findMany({ where, include, orderBy: { createdAt: "desc" }, skip: (input.page - 1) * input.limit, take: input.limit }), prisma.asset.count({ where })]); /* What each row's menu may offer, answered here rather than on the screen, so the menu and the endpoints behind it read one rule. */ const caller = await assetCaller(req); return { data: data.map((asset) => ({ ...asset, capabilities: capabilitiesOf(asset, caller) })), canImport: caller.isSuperAdmin, pagination: { page: input.page, limit: input.limit, total, totalPages: Math.ceil(total / input.limit) } }; });
/**
 * Validates and writes a single asset, uploads and all. Split out of the route handler so that
 * approving an asset request can add the asset it asked for under exactly these rules instead of
 * growing a second, drifting copy of them.
 */
/**
 * An asset is one of the two records with a real branch column, so its branch is the one thing on
 * it that a role's branch list actually governs. Registering one into a branch out of reach would
 * put it where its owner cannot see it — the asset list is filtered by the same reach.
 */
/*
 * `scope` is the permission the **calling route** is guarded by, and the two callers differ:
 * registering an asset answers to `ASSET / Asset Administration`, changing one to
 * `ASSET / Asset Management`. Measured against the wrong one, somebody holding Administration in a
 * branch and not Management is refused the very act their permission is for.
 */
async function branchIsReachable(userId, branchId, scope) {
  if (branchId === undefined || branchId === null) return;
  if (!(await iamService.canUseBranchId(userId, branchId, scope))) throw fail(403, "You cannot file an asset against that branch.");
}

async function createAssetRecord(body, userId) {
  const data = assetInput.parse(body);
  if (!data.categoryId) throw fail(400, "Select a final Asset category.");
  await branchIsReachable(userId, data.branchId, ASSET_ADMINISTRATION);
  await categoryIsAsset(data.categoryId);
  const uploads = await attachStoredFiles(data);
  try {
    return await prisma.asset.create({ data: { ...data, nextInspectionDate: calculatedInspectionDate(data), assetCode: await nextCode(await branchOf(data.branchId)), createdBy: userId, updatedBy: userId }, include });
  } catch (error) {
    await discardUploads(uploads);
    throw error;
  }
}
const createAsset = handler(async (req) => ({ data: await withCapabilities(req, await createAssetRecord(req.body, Number(req.user.id))) }), 201);

/*
 * ── Importing assets from a spreadsheet ───────────────────────────────────────────────────────
 *
 * Branch is the one column a file must carry, and it is the *name* of the branch rather than its
 * id - a spreadsheet says "Erode", not 3. It is resolved against `location` below, so a file naming
 * a branch this studio does not have is refused row by row with the name it gave, rather than
 * importing every asset to the wrong place.
 *
 * The category is named too, for the same reason, and matched on its own code or name.
 */
const ASSET_IMPORT_COLUMNS = [
  { field: "assetName", label: "Asset Name", required: true },
  { field: "branchName", label: "Branch", required: true },
  { field: "categoryName", label: "Category" },
  { field: "company", label: "Company" },
  { field: "serialNumber", label: "Serial Number" },
  { field: "specification", label: "Specification" },
  { field: "color", label: "Colour" },
  { field: "purchaseDate", label: "Purchase Date" },
  { field: "purchasePrice", label: "Purchase Price" },
  { field: "purchasedFrom", label: "Purchased From" },
  { field: "invoiceNumber", label: "Invoice Number" },
  { field: "warrantyMonths", label: "Warranty (Months)" },
  { field: "inspectionPeriodMonths", label: "Inspection Period (Months)" },
  { field: "lastInspectedDate", label: "Last Inspected Date" },
  { field: "insuranceDetails", label: "Insurance Details" },
  { field: "insuranceExpiry", label: "Insurance Expiry" },
  { field: "remarks", label: "Remarks" },
];

/*
 * The file's own words, turned into the ids the asset schema takes.
 *
 * Kept apart from `assetInput` rather than folded into it: the form sends ids because it picked
 * them from a list, and teaching the schema to also accept names would let a typed asset be created
 * with a branch that does not exist. This is the importer's own translation, and it fails loudly.
 */
const assetImportInput = z.object({
  branchName: z.string().trim().min(1),
  categoryName: z.string().trim().min(1).optional(),
}).passthrough();

async function resolveAssetImportRow(input) {
  const { branchName, categoryName, ...rest } = input;
  const branch = await prisma.branch.findFirst({
    where: { OR: [{ name: branchName }, { code: branchName }], isActive: true },
    select: { id: true },
  });
  if (!branch) throw fail(400, `No active branch is called "${branchName}".`);

  let categoryId;
  if (categoryName) {
    const category = await prisma.assetCategory.findFirst({
      where: { OR: [{ name: categoryName }, { code: categoryName }], isActive: true, moduleType: "ASSET" },
      select: { id: true },
    });
    if (!category) throw fail(400, `No active Asset category is called "${categoryName}".`);
    categoryId = category.id;
  }
  return { ...rest, branchId: branch.id, ...(categoryId ? { categoryId } : {}) };
}

const importTemplate = handler(async (req) => { await superAdminOnly(req, "import assets"); return { data: { columns: templateHeaders(ASSET_IMPORT_COLUMNS) } }; });

const importRows = handler(async (req) => {
  await superAdminOnly(req, "import assets");
  const userId = Number(req.user.id);
  return {
    data: await importTableRows({
      headers: req.body?.headers,
      rows: req.body?.rows,
      startRow: Number(req.body?.startRow) || 2,
      columns: ASSET_IMPORT_COLUMNS,
      schema: assetImportInput,
      // Through `createAssetRecord`, the module's own creator, so an imported asset is written
      // exactly as a typed one is - same identifier counter, same branch check, same audit columns.
      create: async (input) => { await createAssetRecord(await resolveAssetImportRow(input), userId); },
    }),
  };
});
/**
 * Names the serial numbers already on record, so a bulk upload fails with the offending values
 * instead of a bare unique-constraint error after every image has been uploaded.
 *
 * Soft-deleted assets keep their row and therefore their serial number, so they are deliberately
 * included: excluding them would let the pre-check pass and the insert fail anyway.
 */
async function assertUnusedSerialNumbers(serialNumbers) {
  const taken = await prisma.asset.findMany({ where: { serialNumber: { in: serialNumbers } }, select: { serialNumber: true, assetCode: true } });
  if (!taken.length) return;
  const list = taken.map((asset) => `${asset.serialNumber} (${asset.assetCode})`).join(", ");
  throw fail(409, `${taken.length === 1 ? "Serial Number is" : "These Serial Numbers are"} already used by another asset: ${list}.`);
}
const createAssetsBulk = handler(async (req) => {
  const input = bulkAssetInput.parse(req.body);
  if (!input.categoryId) throw fail(400, "Select a final Asset category.");
  await categoryIsAsset(input.categoryId);
  const { bulkItems, ...sharedData } = input;
  await assertUnusedSerialNumbers(bulkItems.map((item) => item.serialNumber));
  // The photo, gallery and documents belong to the whole batch, so they are uploaded once and the
  // same links are written onto every asset: one set of objects instead of one set per asset.
  // removeUnreferencedFiles checks for siblings before deleting, so editing the files on one of
  // these assets later cannot break the others.
  const uploads = await attachStoredFiles(sharedData);
  try {
    const data = await prisma.$transaction(async (tx) => {
      const created = [];
      for (const item of bulkItems) {
        const assetData = { ...sharedData, ...item };
        created.push(await tx.asset.create({
          data: { ...assetData, nextInspectionDate: calculatedInspectionDate(assetData), assetCode: await nextCode(await branchOf(assetData.branchId, tx), tx), createdBy: Number(req.user.id), updatedBy: Number(req.user.id) },
          include,
        }));
      }
      return created;
    }, { timeout: 30000 });
    return { data: await Promise.all(data.map((asset) => withCapabilities(req, asset))), count: data.length };
  } catch (error) {
    await discardUploads(uploads);
    throw error;
  }
}, 201);
/** Who is acting, with the employee identity behind their login where there is one. */
async function actingUser(userId) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true, linkedEmployeeId: true } });
  if (!user) throw fail(401, "The authenticated user no longer exists.");
  const employee = user.linkedEmployeeId ? await prisma.employee.findUnique({ where: { id: user.linkedEmployeeId }, select: { employeeId: true, employeeName: true } }) : null;
  return { userId: user.id, actorName: employee?.employeeName || user.name, actorEmployeeId: employee?.employeeId || null };
}

/**
 * The log row for a change of custody made through the Edit form. The status is unchanged, so it
 * is written on both sides of the row: an asset does not change state by changing hands.
 *
 * Names are snapshotted into formData alongside the employee links, so the history still reads
 * correctly once somebody has left and the link has been nulled.
 */
async function assignmentLogEntry(transaction, asset, nextAssigneeId, actor) {
  const previousId = asset.assignedPersonId ?? null;
  const nextId = nextAssigneeId ?? null;
  const people = await transaction.employee.findMany({ where: { id: { in: [previousId, nextId].filter(Boolean) } }, select: { id: true, employeeId: true, employeeName: true } });
  const byId = new Map(people.map((person) => [person.id, person]));
  if (nextId && !byId.has(nextId)) throw fail(400, "Assign this asset to a valid employee.");
  const previous = previousId ? byId.get(previousId) : null;
  const next = nextId ? byId.get(nextId) : null;
  return {
    assetId: asset.id,
    previousStatus: asset.status,
    nextStatus: asset.status,
    changeType: !previousId ? "ASSIGNED" : !nextId ? "UNASSIGNED" : "REASSIGNED",
    changedByUserId: actor.userId,
    changedByEmployeeId: actor.actorEmployeeId,
    changedByName: actor.actorName,
    // A handover only. The asset's status is untouched by editing who holds it.
    isStatusChange: false,
    isAssigneeChange: true,
    assignedFromId: previousId,
    assignedToId: nextId,
    formData: {
      assignedFromId: previousId, assignedFromName: previous?.employeeName || null, assignedFromEmployeeId: previous?.employeeId || null,
      assignedToId: nextId, assignedToName: next?.employeeName || null, assignedToEmployeeId: next?.employeeId || null,
      statusChangedByName: actor.actorName, statusChangedByEmployeeId: actor.actorEmployeeId, statusChangedByUserId: actor.userId,
    },
  };
}

/**
 * Everyone who has held this asset, oldest first. Read on demand for one asset rather than
 * embedded in the list, which returns many and would carry every log row of each.
 *
 * Names come from the employee link where it survives, and from the snapshot in formData where it
 * does not, so history written before somebody left still reads correctly.
 */
const assetCustody = handler(async (req) => {
  const assetId = Number(req.params.assetId);
  if (!Number.isInteger(assetId) || assetId < 1) throw fail(404, "Asset not found.");
  // Checked so an asset that does not exist reports 404 rather than an empty history, which would
  // read as "this one has never changed hands".
  await scopedAsset(req, assetId);
  const rows = await prisma.assetStatusLog.findMany({
    where: { assetId, isAssigneeChange: true },
    orderBy: { createdAt: "asc" },
    select: {
      id: true, changeType: true, createdAt: true, changedByName: true, isStatusChange: true, formData: true,
      assignedFrom: { select: { id: true, employeeId: true, employeeName: true } },
      assignedTo: { select: { id: true, employeeId: true, employeeName: true } },
    },
  });
  return {
    data: rows.map((row) => ({
      id: row.id,
      changeType: row.changeType,
      changedAt: row.createdAt,
      changedByName: row.changedByName,
      cameFromStatusChange: row.isStatusChange,
      fromName: row.assignedFrom?.employeeName || row.formData?.assignedFromName || null,
      fromEmployeeId: row.assignedFrom?.employeeId || row.formData?.assignedFromEmployeeId || null,
      toName: row.assignedTo?.employeeName || row.formData?.assignedToName || null,
      toEmployeeId: row.assignedTo?.employeeId || row.formData?.assignedToEmployeeId || null,
    })),
  };
});

const updateAsset = handler(async (req) => {
  const assetId = Number(req.params.assetId);
  const asset = await scopedAsset(req, assetId);
  // Seeing an asset is not being responsible for one. Everybody who works with assets can see the
  // ones they hold; changing the record is the manager's, and the creator's so an asset registered
  // in a hurry can be finished later.
  const { canEdit } = await capabilitiesFor(req, asset);
  if (!canEdit) throw fail(403, "Only this asset's manager, or whoever added it, can change its details.");
  const data = assetInput.partial().parse(req.body);
  if (!Object.keys(data).length) throw fail(400, "Provide at least one field.");
  await branchIsReachable(Number(req.user.id), data.branchId, ASSET_MANAGEMENT);
  await categoryIsAsset(data.categoryId);
  const uploads = await attachStoredFiles(data);

  // Editing who holds an asset is a change of custody and is logged like any other, so the
  // previous holder is not simply overwritten with no record of who it was.
  const reassigning = Object.prototype.hasOwnProperty.call(data, "assignedPersonId") && (data.assignedPersonId ?? null) !== (asset.assignedPersonId ?? null);
  const actor = reassigning ? await actingUser(Number(req.user.id)) : null;

  let updated;
  try {
    updated = await prisma.$transaction(async (tx) => {
      const row = await tx.asset.update({ where: { id: assetId }, data: { ...data, nextInspectionDate: calculatedInspectionDate(data, asset), updatedBy: Number(req.user.id) }, include });
      if (reassigning) await tx.assetStatusLog.create({ data: await assignmentLogEntry(tx, asset, data.assignedPersonId ?? null, actor) });
      return row;
    });
  } catch (error) { await discardUploads(uploads); throw error; }
  await removeUnreferencedFiles(asset, updated);
  return { data: await withCapabilities(req, updated) };
});
/**
 * Retiring one asset, as the route and the bulk delete both do it.
 *
 * Split out of the handler below so `DELETE /bulk` runs *this* rather than its own idea of what
 * deleting an asset means - the branch scope, `capabilitiesFor`'s refusal, the soft delete and the
 * stamp. A bulk route with its own query would be a second way off the register that drifts from
 * this one, and the drift would show up as assets deleted that `DELETE /:assetId` would have
 * refused. Throws exactly as before; the bulk runner counts the throw as an id it could not take.
 */
const deleteAssetRecord = async (req, assetId) => { const asset = await scopedAsset(req, assetId); const { canDelete } = await capabilitiesFor(req, asset); if (!canDelete) throw fail(403, "Only a Super Admin can delete an asset."); const result = await prisma.asset.updateMany({ where: { id: assetId, isDeleted: false }, data: { isDeleted: true, updatedBy: Number(req.user.id) } }); if (!result.count) throw fail(404, "Asset not found."); return { id: assetId, isDeleted: true }; };
const deleteAsset = handler(async (req) => ({ data: await deleteAssetRecord(req, Number(req.params.assetId)) }));
/**
 * Moves an asset from one status to another, and with it who is holding it.
 *
 * Two of the transitions are custody changes as much as status changes, and are the reason this
 * touches `assignedPersonId` at all:
 *
 * - Unassigned → Active hands the asset to somebody, so it asks who — and who manages it, since
 *   unassigning cleared that too and nothing else would put it back.
 * - Anything → Unassigned is the asset coming back. Both the assigned person and the manager are
 *   cleared, because "unassigned" and "still showing the last person who had it" cannot both be
 *   true — the field was left standing and read as though they still held it.
 *
 * A return is logged as the handover it is, from whoever had it to nobody, so the custody history
 * shows where the asset went rather than skipping from one holder to the next.
 */
const changeStatus = handler(async (req) => { const input = statusInput.parse(req.body); const assetId = Number(req.params.assetId); const asset = await scopedAsset(req, assetId); /* Two separate refusals, because they are two different mistakes. A move the map does not allow from here is wrong for everybody and is a 400; one the map allows but this person may not make is a 403 that says what they can do instead. Neither was checked before: the transition map lived on the screen, so any caller who could write could PATCH straight to DISPOSED. */ if (!(ALLOWED_STATUS_TRANSITIONS[asset.status] || []).includes(input.nextStatus)) throw fail(400, `An asset that is ${statusText(asset.status)} cannot be moved to ${statusText(input.nextStatus)}.`); const { allowedTransitions } = await capabilitiesFor(req, asset); if (!allowedTransitions.includes(input.nextStatus)) throw fail(403, `Only this asset's manager, or whoever added it, can mark it ${statusText(input.nextStatus)}. You can report it as needing repair.`); const assigning = asset.status === "UNASSIGNED" && input.nextStatus === "ACTIVE"; const unassigning = input.nextStatus === "UNASSIGNED"; if (asset.status === "UNDER_REPAIR" && input.nextStatus === "ACTIVE" && !input.reason) throw fail(400, "A cancellation reason is required."); if (input.nextStatus === "SOLD" && (!input.formData?.soldDate || !Number.isFinite(Number(input.formData?.soldPrice)) || Number(input.formData.soldPrice) < 0)) throw fail(400, "Sold date and a valid sold price are required."); if (assigning && (!input.formData?.assignedToId || !input.formData?.assignedOn)) throw fail(400, "Assigned To and Assigned On are required."); const assignedTo = assigning ? await prisma.employee.findUnique({ where: { id: Number(input.formData.assignedToId) }, select: { id: true, employeeId: true, employeeName: true } }) : null; if (assigning && !assignedTo) throw fail(400, "Select a valid employee to assign this asset to."); const managerChosen = assigning && input.formData?.managerId ? Number(input.formData.managerId) : null; const manager = managerChosen ? await prisma.employee.findUnique({ where: { id: managerChosen }, select: { id: true, employeeId: true, employeeName: true } }) : null; if (managerChosen && !manager) throw fail(400, "Select a valid employee as the manager."); const user = await prisma.user.findUnique({ where: { id: Number(req.user.id) }, select: { id: true, name: true, linkedEmployeeId: true } }); if (!user) throw fail(401, "The authenticated user no longer exists."); const employee = user.linkedEmployeeId ? await prisma.employee.findUnique({ where: { id: user.linkedEmployeeId }, select: { employeeId: true, employeeName: true } }) : null; const actorName = employee?.employeeName || user.name; const actorEmployeeId = employee?.employeeId || null; const statusActorFields = { statusChangedByName: actorName, statusChangedByEmployeeId: actorEmployeeId, statusChangedByUserId: user.id }; const statusSpecificActorFields = { ...(input.nextStatus === "DISPOSED" ? { disposedByName: actorName, disposedByEmployeeId: actorEmployeeId, disposedByUserId: user.id } : {}), ...(assigning ? { assignedToId: assignedTo.id, assignedToName: assignedTo.employeeName, assignedToEmployeeId: assignedTo.employeeId, managerId: manager?.id ?? null, managerName: manager?.employeeName ?? null, managerEmployeeId: manager?.employeeId ?? null, assignedByName: actorName, assignedByEmployeeId: actorEmployeeId, assignedByUserId: user.id } : {}) }; const result = await prisma.$transaction(async (tx) => { const updated = await tx.asset.update({ where: { id: assetId }, data: { status: input.nextStatus, ...(assigning ? { assignedPersonId: assignedTo.id, managerId: manager?.id ?? null } : {}), ...(unassigning ? { assignedPersonId: null, managerId: null } : {}), updatedBy: user.id }, include }); await tx.assetStatusLog.create({ data: { assetId, previousStatus: asset.status, nextStatus: input.nextStatus, changeType: input.changeType, changedByUserId: user.id, changedByEmployeeId: actorEmployeeId, changedByName: actorName, reason: input.reason || null, isStatusChange: true, isAssigneeChange: assigning || (unassigning && Boolean(asset.assignedPersonId)), assignedFromId: assigning || unassigning ? asset.assignedPersonId ?? null : null, assignedToId: assigning ? assignedTo.id : null, lostByName: input.nextStatus === "LOST" ? String(input.formData.lostByName).trim() : null, lostByEmployeeId: null, soldByName: input.nextStatus === "SOLD" ? String(input.formData.soldByName).trim() : null, soldByEmployeeId: input.nextStatus === "SOLD" ? String(input.formData.soldByEmployeeId || "").trim() || null : null, soldToName: input.nextStatus === "SOLD" ? String(input.formData.soldTo).trim() : null, soldToContact: input.nextStatus === "SOLD" ? String(input.formData.soldToContact).trim() : null, soldDate: input.nextStatus === "SOLD" ? new Date(input.formData.soldDate) : null, soldPrice: input.nextStatus === "SOLD" ? Number(input.formData.soldPrice) : null, formData: { ...(input.formData || {}), ...statusActorFields, ...statusSpecificActorFields, ...(input.reason ? { reason: input.reason } : {}) } } }); return updated; }); return { data: await withCapabilities(req, result) }; });
module.exports = { listAssets, createAsset, createAssetsBulk, importTemplate, importRows, updateAsset, deleteAsset, deleteAssetRecord, changeStatus, assetCustody, descendants, createAssetRecord, validationMessage, duplicateMessage };
