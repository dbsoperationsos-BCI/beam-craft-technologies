const prisma = require("../../config/db");
const dataScope = require("../../services/dataScope.service");
const iamService = require("../../services/iam.service");

/**
 * The columns the data scope narrows an asset by: its branch, and the two people named on it - who
 * holds it and who manages it. Declared once here and read by the screen's controller and the
 * assistant's tools alike, so the two can never narrow differently - see `dataScope.service.js`.
 *
 * The manager belongs here as much as the holder. Naming somebody the manager of an asset is
 * telling the studio it is theirs to look after, and an asset that does not appear on their screen
 * is one they cannot look after. Whoever registered it is here too: an asset in stock is still
 * somebody's work until it is handed over.
 */
const ASSET_SCOPE_COLUMNS = { branch: "branchId", employee: ["assignedPersonId", "managerId"], user: "createdBy" };

/**
 * Reading assets, for callers that are not an HTTP handler.
 *
 * The module's list logic lives in `listAssets(req, res)` in `assets.controller.js`. This is the
 * same query as a function, additive, and owed the same follow-up as the others.
 *
 * Photographs, inspection images, invoices, insurance details and purchase prices are not selected.
 * An assistant answering "which cameras are out on assignment" needs none of them, and the image
 * columns are large enough that returning them would be a problem on their own.
 */

const SAFE_FIELDS = {
  assetCode: true,
  assetName: true,
  company: true,
  status: true,
  color: true,
  purchaseDate: true,
  nextInspectionDate: true,
  category: { select: { name: true } },
  assignedPerson: { select: { employeeName: true } },
  branch: { select: { name: true } },
};

const MAX_ROWS = 50;
const DEFAULT_ROWS = 20;

function boundedLimit(value) {
  const asked = Number(value);
  if (!Number.isFinite(asked) || asked < 1) return DEFAULT_ROWS;
  return Math.min(Math.floor(asked), MAX_ROWS);
}

/**
 * The rows the caller may see, as `dataScope.resolve()` answered - always under `AND`, never spread.
 *
 * The rule's `where` is itself an `OR` (your name, your team's, your branches), so spreading it
 * beside a search that sets its own `OR` replaced the rule with the search and returned rows the
 * caller may not see. Under `AND` the two cannot collide, whatever either of them holds.
 *
 * Nothing given means nothing narrowed, which only the shape tests do.
 */
function scopeWhere(scope) {
  return { AND: [scope?.where || {}] };
}

/**
 * Whose assets an HTTP request gets: the resolver's answer for the permission the route was guarded
 * with (`req.permission`, set by `checkPermission`), on the columns above. Used by every asset
 * controller, so an id typed into a URL reaches exactly what the list would have shown.
 */
const assetScopeFor = (req) => dataScope.resolve({
  userId: Number(req.user.id),
  module: req.permission.module,
  feature: req.permission.feature,
  columns: ASSET_SCOPE_COLUMNS,
});

/**
 * One live asset the request may see, or null - whether it does not exist or is out of scope, the
 * answer is the same, because whether it exists is itself something the scope hides. The columns
 * the scope reads are always fetched, whatever `select` asks for - and so are the ones
 * `capabilitiesOf` reads, `status` among them, so a caller that narrows the row still gets one
 * that can be asked what may be done to it.
 */
async function findScopedAsset(req, assetId, { select } = {}) {
  const id = Number(assetId);
  if (!Number.isInteger(id) || id < 1) return null;
  const [scope, asset] = await Promise.all([
    assetScopeFor(req),
    prisma.asset.findFirst({ where: { id, isDeleted: false }, ...(select ? { select: { ...select, id: true, status: true, branchId: true, assignedPersonId: true, managerId: true, createdBy: true } } : {}) }),
  ]);
  return asset && scope.allows(asset) ? asset : null;
}

/** An asset in the shape the assistant needs: what it is, where it is, who has it. */
function summarise(row) {
  return {
    assetCode: row.assetCode,
    name: row.assetName,
    company: row.company || null,
    status: row.status || null,
    category: row.category?.name || null,
    assignedTo: row.assignedPerson?.employeeName || null,
    branch: row.branch?.name || null,
    nextInspectionDate: row.nextInspectionDate || null,
  };
}

async function searchAssets({ search, status, limit, scope } = {}) {
  const where = { isDeleted: false, ...scopeWhere(scope) };

  const term = String(search || "").trim();
  if (term) {
    where.OR = [{ assetCode: { contains: term } }, { assetName: { contains: term } }, { company: { contains: term } }];
  }
  const inStatus = String(status || "").trim();
  if (inStatus) where.status = inStatus;

  const take = boundedLimit(limit);
  const [rows, total] = await Promise.all([
    prisma.asset.findMany({ where, select: SAFE_FIELDS, orderBy: { assetName: "asc" }, take }),
    prisma.asset.count({ where }),
  ]);

  return { count: rows.length, total, limit: take, truncated: total > rows.length, items: rows.map(summarise) };
}

/** How many assets there are, by status and category, counted in the database. */
async function getAssetSummary({ scope } = {}) {
  const where = { isDeleted: false, ...scopeWhere(scope) };
  const [byStatus, total, categories] = await Promise.all([
    prisma.asset.groupBy({ by: ["status"], where, _count: { _all: true } }),
    prisma.asset.count({ where }),
    prisma.assetCategory.findMany({ select: { name: true, _count: { select: { assets: { where } } } } }).catch(() => []),
  ]);

  /*
   * Only categories that actually hold something, and only the busiest.
   *
   * The category list is a fixed taxonomy of about a hundred and fifty entries - Softboxes, FASTag,
   * Sensor Swabs - and returning all of them put a hundred and fifty zeroes into the payload. A
   * summary is meant to be the shape of the estate, not its filing system.
   */
  const used = categories
    .map((row) => ({ value: row.name, count: row._count?.assets ?? 0 }))
    .filter((row) => row.count > 0)
    .sort((a, b) => b.count - a.count);

  return {
    total,
    byStatus: byStatus.map((row) => ({ value: row.status || "(not set)", count: row._count._all })).sort((a, b) => b.count - a.count),
    byCategory: used.slice(0, 12),
    categoriesInUse: used.length,
  };
}

/**
 * The status changes an asset may legally make, whoever is asking.
 *
 * This map used to live only on the Asset Management screen, which made it advice rather than a
 * rule: the ⋮ menu hid "Dispose" from somebody who only holds the asset, and a PATCH sent it
 * anyway, because `changeStatus` checked the target against the status enum and nothing else. It
 * belongs here now, and the screen renders from the copy the list hands it - one map, so the two
 * sides cannot drift.
 */
const ALLOWED_STATUS_TRANSITIONS = {
  ACTIVE: ["UNDER_REPAIR", "IN_TRANSIT", "LOST", "SOLD", "DISPOSED", "UNASSIGNED"],
  UNDER_REPAIR: ["ACTIVE", "IN_SERVICE", "IN_TRANSIT"],
  IN_SERVICE: ["ACTIVE", "SOLD", "DISPOSED"],
  IN_TRANSIT: ["ACTIVE", "UNDER_REPAIR"],
  UNASSIGNED: ["ACTIVE", "LOST", "SOLD", "DISPOSED"],
};

/** The one status change somebody who does not manage an asset may make: reporting it faulty. */
const FLAG_FAULTY = "UNDER_REPAIR";

/**
 * Who the caller is, in both of the numbers an asset is marked with.
 *
 * An asset names its manager and its holder by **employee** id (`Employee.id`, a real foreign key)
 * and its creator by **user** id (`User.id`, the login). They are different tables with different
 * sequences, so one person is two different numbers, and comparing the wrong one would silently
 * hand out or withhold rights. They cannot be collapsed into one: `User.linkedEmployeeId` is
 * nullable and the studio's Super Admin is precisely the account with no employee behind it.
 *
 * Resolved once and cached on the request, because every row of a list asks the same question. The
 * promise is cached rather than its value, so several rows resolving at once share one read.
 */
function assetCaller(req) {
  if (!req._assetCaller) {
    const userId = Number(req.user.id);
    req._assetCaller = Promise.all([
      iamService.getUserWithPermissions(userId),
      iamService.hasPermission(userId, "ASSET", "Asset Management", "READ_WRITE"),
    ]).then(([user, canWrite]) => ({
      userId: user.id,
      employeeId: user.linkedEmployeeId ?? null,
      isSuperAdmin: user.role === "SUPER_ADMIN",
      canWrite,
    }));
  }
  return req._assetCaller;
}

/**
 * What this caller may do to this asset.
 *
 * Whether they see the row at all is the scope's question and has already been answered above.
 * This is the second question, and it is answered per row rather than per screen: an asset is
 * **yours to manage** if you are the employee named as its manager, or the login that added it.
 *
 * The creator is here so a record can be finished later. Approving an asset request creates the
 * asset, and the approver is its `createdBy` - so somebody who approved a request and forgot to
 * name a manager can open the asset and set one. It also means whoever registers an asset keeps
 * those rights after a manager is named; a Super Admin is the one who can change that.
 *
 * Anything else you can see, you may look at and report faulty, and that is all. Reporting a fault
 * is the one write that is not the manager's, because the person holding a broken camera is the
 * person who knows it is broken - but clearing the fault is a manager's call, so UNDER_REPAIR is
 * the only status they are offered, and only where the map above allows it from here.
 *
 * Deleting and importing belong to a Super Admin outright, the way Image Selection's two do.
 * Neither is expressed as a permission: there is one asset permission, and it is held widely.
 */
function capabilitiesOf(asset, caller) {
  const idle = { canManage: false, canEdit: false, canInspect: false, canDelete: false, allowedTransitions: [] };
  // READ alone reads. Without this the list would hand a viewer an "Under Repair" action that the
  // PATCH behind it refuses - a control that is present and then says no, which is what Rule 4
  // means by an unfinished change.
  if (!caller.canWrite) return idle;

  const manages = caller.isSuperAdmin
    || (caller.employeeId !== null && asset.managerId === caller.employeeId)
    || (asset.createdBy !== null && asset.createdBy !== undefined && asset.createdBy === caller.userId);

  const fromHere = ALLOWED_STATUS_TRANSITIONS[asset.status] || [];
  return {
    canManage: manages,
    canEdit: manages,
    canInspect: manages,
    canDelete: caller.isSuperAdmin,
    allowedTransitions: manages ? [...fromHere] : fromHere.filter((status) => status === FLAG_FAULTY),
  };
}

/** The same, for a request that has already read the asset. */
async function capabilitiesFor(req, asset) {
  return capabilitiesOf(asset, await assetCaller(req));
}

module.exports = { searchAssets, getAssetSummary, summarise, SAFE_FIELDS, MAX_ROWS, ASSET_SCOPE_COLUMNS, assetScopeFor, findScopedAsset, ALLOWED_STATUS_TRANSITIONS, FLAG_FAULTY, assetCaller, capabilitiesOf, capabilitiesFor };
