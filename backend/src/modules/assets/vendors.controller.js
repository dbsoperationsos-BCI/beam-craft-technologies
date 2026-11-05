const { withUserNames } = require("../../services/userNames");
const { z } = require("zod");
const prisma = require("../../config/db");
const { everyChunk, matchesWordChunks } = require("../../services/wordChunks");
const { vendorTypes, skillGroups } = require("./vendor-options");
const { nextIdentifier } = require("../../services/identifiers");
const { importTableRows, templateHeaders, asList } = require("../../services/tableImport");
const { splitCsv } = require("../../services/nameCopies");
const { VENDOR_LABEL_SELECT } = require("../../services/vendorLabel");

const statuses = ["ACTIVE", "INACTIVE"];
const optionalText = (max) => z.preprocess((v) => v === "" ? null : v, z.string().trim().max(max).nullable().optional());
/*
 * Vendor Type, several at once - a studio that shoots and edits is both. Stored the way an
 * employee's Skills are: one column holding the names joined by ", " ("Photographer, Editor"),
 * which the master-data list's usage check and rename read entry by entry (`match: "csv"` in
 * definitions.js). The form sends that string; a list is taken too, which is what an imported cell
 * becomes (`asList`) and what an API caller may send. Duplicates are dropped, the order kept.
 */
const VENDOR_TYPE_MAX = 500;
const vendorTypeInput = z.preprocess(
  (value) => (Array.isArray(value) ? value.flatMap(splitCsv) : typeof value === "string" ? splitCsv(value) : value),
  z.array(z.string().trim().min(1).max(100)).min(1, "Choose at least one vendor type.").max(20, "Choose at most 20 vendor types."),
)
  .transform((list) => {
    const seen = new Set();
    return list.filter((item) => {
      const key = item.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).join(", ");
  })
  .refine((text) => text.length <= VENDOR_TYPE_MAX, `Those vendor types run past ${VENDOR_TYPE_MAX} characters. Choose fewer.`);
/*
 * A vendor whose Vendor Type includes `type`, as one whole entry: "Editor" finds "Photographer,
 * Editor" but not "Photo Editor". Four exact shapes rather than `contains`, which would.
 */
const hasVendorType = (type) => ({
  OR: [
    { vendorType: type },
    { vendorType: { startsWith: `${type}, ` } },
    { vendorType: { endsWith: `, ${type}` } },
    { vendorType: { contains: `, ${type}, ` } },
  ],
});
/*
 * A Yes / No question, and No unless somebody says Yes: true or false from the form, and the words a
 * spreadsheet cell holds - Yes, No, Y, N, True, False - read case-insensitively, so an import says it
 * the way a person types it. Anything else is refused rather than guessed.
 *
 * Blank is "not sent", never stored: a vendor created without it takes the column's default, No, and
 * an edit without it keeps the answer it had. Optional with no default here, because zod 4 applies a
 * default inside `.partial()` too and would reset every edited vendor to No.
 */
const YES = ["yes", "y", "true", "1"];
const NO = ["no", "n", "false", "0"];
const yesNoInput = z.preprocess((value) => {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "boolean") return value;
  const word = String(value).trim().toLowerCase();
  if (YES.includes(word)) return true;
  if (NO.includes(word)) return false;
  return value;
}, z.boolean({ error: "Answer Yes or No." }).optional());
const vendorInput = z.object({
  vendorName: z.string().trim().min(1).max(191), vendorType: vendorTypeInput,
  contactPerson: optionalText(150), mobileNumber: optionalText(30), whatsappNumber: optionalText(30), alternateNumber: optionalText(30),
  email: z.preprocess((v) => v === "" ? null : v, z.string().trim().email().max(191).nullable().optional()),
  gstNumber: optionalText(30), panNumber: optionalText(20), aadhaarNumber: optionalText(20), businessRegistrationName: optionalText(191),
  address: optionalText(10000), area: optionalText(150), city: optionalText(100), district: optionalText(100), state: optionalText(100), country: optionalText(100), pincode: optionalText(15),
  bankName: optionalText(150), accountNumber: optionalText(100), ifscCode: optionalText(30), upiId: optionalText(100),
  website: optionalText(500), instagram: optionalText(500), facebook: optionalText(500),
  businessStartYear: z.preprocess((v) => v === "" || v == null ? null : v, z.coerce.number().int().min(1800).max(new Date().getFullYear()).nullable().optional()),
  preferredLanguages: z.array(z.string().trim().min(1).max(100)).max(50).default([]),
  skills: z.array(z.string().trim().min(1).max(150)).max(300).default([]),
  rating: z.preprocess((v) => v === "" || v == null ? null : v, z.coerce.number().int().min(1).max(5).nullable().optional()),
  referredBy: optionalText(191), remarks: optionalText(10000),
  // Capabilities → Supported Branches: branch ids, each checked against the active branches when saved.
  // Optional with no default, deliberately: zod 4 applies a default inside `.partial()` too, so a
  // default here would wipe a vendor's branches on every edit that did not mention them. A create
  // that leaves it out gets none (`createVendor`).
  supportedBranchIds: z.array(z.coerce.number().int().positive().max(2147483647)).max(100).transform((ids) => [...new Set(ids)]).optional(),
  // Capabilities → "Can be a production team member?"
  canBeProductionTeamMember: yesNoInput
});
const listInput = z.object({ q: z.string().trim().max(191).optional(), status: z.enum(statuses).optional(), vendorType: z.string().trim().max(100).optional(), skill: z.string().trim().max(150).optional(), page: z.coerce.number().int().positive().default(1), limit: z.coerce.number().int().min(1).max(100).default(50) });
const statusInput = z.object({ status: z.enum(statuses), reason: optionalText(10000) }).superRefine((v, ctx) => { if (v.status === "INACTIVE" && !v.reason) ctx.addIssue({ code: "custom", path: ["reason"], message: "A reason is required for Inactive status." }); });
const deleteInput = z.object({ reason: z.string().trim().min(1, "A reason is required before permanently removing a vendor.").max(10000) });
const fail = (status, message) => Object.assign(new Error(message), { status });
const handler = (work, status = 200) => async (req, res) => { try { res.status(status).json(await work(req)); } catch (error) { console.error("Vendor management error:", error); if (error instanceof z.ZodError) return res.status(400).json({ message: "Please correct the vendor details.", errors: error.issues }); res.status(error.status || 500).json({ message: error.status ? error.message : "Unable to process vendor request." }); } };
const locator = (value) => /^\d+$/.test(value) ? { id: Number(value) } : { vendorId: value };
async function activeVendor(value) { const row = await prisma.vendor.findFirst({ where: { ...locator(value), isDeleted: false } }); if (!row) throw fail(404, "Vendor not found."); return row; }
/*
 * ── Supported Branches ─────────────────────────────────────────────────────────────────────
 *
 * Capabilities → Supported Branches: the studio's branches a vendor works for, held as rows of
 * `vendor_branch` (vendor id, branch id) rather than names in a column - a branch is an id with a
 * key. Vendors are the studio's, not a branch's, so any active branch may be picked; the ids are
 * still checked here rather than trusted from the request, and one that is not an active branch is
 * refused rather than dropped.
 */
// Read with the transaction that writes the links, so a branch disabled in between cannot be linked.
async function checkSupportedBranches(ids, client = prisma) {
  if (!ids?.length) return;
  const found = await client.branch.findMany({ where: { id: { in: ids }, isActive: true }, select: { id: true } });
  if (found.length !== ids.length) throw fail(400, "Choose supported branches from the list - one of them is not an active branch.");
}
/** Replaces a vendor's supported branches with `ids`, inside the caller's transaction. */
async function saveSupportedBranches(tx, vendorId, ids) {
  await tx.vendorBranch.deleteMany({ where: { vendorId } });
  if (ids.length) await tx.vendorBranch.createMany({ data: ids.map((branchId) => ({ vendorId, branchId })), skipDuplicates: true });
}
/**
 * Every vendor's supported branches in one query, for whatever the caller is about to send back:
 * the ids the form edits, and the names - read through the branch, never stored - the details
 * panel shows. A branch renamed shows its new name here at once.
 */
async function supportedBranchesFor(vendorIds) {
  const ids = vendorIds.filter(Boolean);
  const rows = ids.length ? await prisma.vendorBranch.findMany({
    where: { vendorId: { in: ids } },
    select: { vendorId: true, branch: { select: { id: true, name: true } } },
  }) : [];
  const byVendor = new Map();
  for (const row of rows) {
    if (!byVendor.has(row.vendorId)) byVendor.set(row.vendorId, []);
    byVendor.get(row.vendorId).push(row.branch);
  }
  return (vendorId) => {
    const branches = (byVendor.get(vendorId) || []).sort((a, b) => a.name.localeCompare(b.name));
    return {
      supportedBranchIds: branches.map((branch) => branch.id),
      supportedBranches: branches,
      supportedBranchNames: branches.map((branch) => branch.name).join(", "),
    };
  };
}
/**
 * Creates a vendor and its supported branches together, as the form and the import both do - one
 * transaction, so a vendor never exists without the branches it was saved with.
 */
async function createVendor(input, userId) {
  const { supportedBranchIds = [], ...data } = input;
  const vendorId = await nextVendorId();
  return prisma.$transaction(async (tx) => {
    await checkSupportedBranches(supportedBranchIds, tx);
    const row = await tx.vendor.create({ data: { ...data, vendorId, createdBy: userId, updatedBy: userId } });
    await saveSupportedBranches(tx, row.id, supportedBranchIds);
    return row;
  });
}

// DBS-VNMGMT-000001. One run of numbers for the studio: a vendor is not a branch's or a vertical's.
const nextVendorId = () => nextIdentifier("VENDOR");
/* Who added and last changed each vendor, by name - the user's linked employee (`services/userNames`). */
async function addCreatorNames(rows) { const list = await withUserNames(Array.isArray(rows) ? rows : [rows]); const branchesOf = await supportedBranchesFor(list.map((row) => row.id)); const result = list.map((row) => ({ ...row, ...branchesOf(row.id), dateAdded: row.createdAt, addedBy: row.createdBy ? { id: row.createdBy, name: row.createdByName || null } : null, yearsOfExperience: row.businessStartYear ? Math.max(0, new Date().getFullYear() - row.businessStartYear) : null })); return Array.isArray(rows) ? result : result[0]; }

exports.options = handler(async (req) => { const q = String(req.query.q || "").trim(); /* Word Chunk Search: every word typed, any order, across the skill and its group. */ const groups = Object.entries(skillGroups).map(([group, values]) => ({ group, options: values.filter((value) => matchesWordChunks(`${group}\n${value}`, q)) })).filter((item) => item.options.length); return { data: { statuses, vendorTypes: await vendorTypes(), skillGroups: groups, skills: [...new Set(groups.flatMap((item) => item.options))] } }; });
// The vendor picker the asset status dialog fills when an asset goes in for service. It is a read
// of names, not of the vendor records - the name as `vendorLabel` shows it (source, business name,
// city), no contact details, no rating, no commercial terms - so it
// is reachable by Asset Management as well as by Vendor Management, which is what lets the two be
// granted apart. `list` above stays behind Vendor Management alone.
exports.picker = handler(async () => {
  const rows = await prisma.vendor.findMany({
    where: { isDeleted: false, status: "ACTIVE" },
    orderBy: { vendorName: "asc" },
    take: 200,
    select: { id: true, vendorId: true, ...VENDOR_LABEL_SELECT, vendorType: true },
  });
  return { data: rows };
});

exports.list = handler(async (req) => {
  const input = listInput.parse(req.query);
  // Everything the caller asked for except the status itself. The tab counts are read from this,
  // so switching tabs cannot move them, while a search or type filter still narrows them.
  // The type filter and the search's words share one AND. Word Chunk Search: every word typed, any order.
  const searchWords = everyChunk(input.q, (chunk) => ({ OR: ["vendorId", "vendorName", "contactPerson", "mobileNumber", "email", "businessRegistrationName", "city"].map((field) => ({ [field]: { contains: chunk } })) }));
  const and = [...(input.vendorType ? [hasVendorType(input.vendorType)] : []), ...searchWords];
  const base = { isDeleted: false, ...(and.length && { AND: and }), ...(input.skill && { skills: { array_contains: input.skill } }) };
  const where = { ...base, ...(input.status && { status: input.status }) };
  const [rows, total, grouped] = await Promise.all([
    prisma.vendor.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (input.page - 1) * input.limit, take: input.limit }),
    prisma.vendor.count({ where }),
    prisma.vendor.groupBy({ by: ["status"], where: base, _count: { _all: true } }),
  ]);
  // Seeded from `statuses` so a status nobody currently holds still reports 0 rather than nothing.
  const counts = Object.fromEntries(statuses.map((status) => [status, 0]));
  grouped.forEach((group) => { counts[group.status] = group._count._all; });
  return {
    data: await addCreatorNames(rows),
    pagination: { page: input.page, limit: input.limit, total, totalPages: Math.ceil(total / input.limit) },
    counts: { all: grouped.reduce((sum, group) => sum + group._count._all, 0), ...counts },
  };
});
exports.get = handler(async (req) => ({ data: await addCreatorNames(await activeVendor(req.params.vendorId)) }));
exports.create = handler(async (req) => { const input = vendorInput.parse(req.body); const row = await createVendor(input, Number(req.user.id)); return { data: await addCreatorNames(row) }; }, 201);

/*
 * ── Importing vendors from a spreadsheet ──────────────────────────────────────────────────────
 *
 * The columns a file may carry, and the one it must. `vendorName` and `vendorType` are what the
 * schema demands of every vendor, so a file without those headings is refused before a row is read
 * rather than failing on all of them.
 *
 * The list columns - Vendor Type, Preferred Languages, Skills - hold several values in one cell -
 * "Photography; Videography" - which is how
 * a person writes a list in a spreadsheet. Everything else is left as text for `vendorInput` to
 * coerce, so an imported vendor is validated by exactly what the form is validated by.
 */
const VENDOR_IMPORT_COLUMNS = [
  { field: "vendorName", label: "Vendor Name", required: true },
  // Several in one cell, as the two list columns below are: "Photographer; Editor".
  { field: "vendorType", label: "Vendor Type", required: true, parse: asList },
  { field: "contactPerson", label: "Contact Person" },
  { field: "mobileNumber", label: "Mobile Number" },
  { field: "whatsappNumber", label: "WhatsApp Number" },
  { field: "alternateNumber", label: "Alternate Number" },
  { field: "email", label: "Email" },
  { field: "gstNumber", label: "GST Number" },
  { field: "panNumber", label: "PAN Number" },
  { field: "businessRegistrationName", label: "Business Registration Name" },
  { field: "address", label: "Address" },
  { field: "area", label: "Area" },
  { field: "city", label: "City" },
  { field: "district", label: "District" },
  { field: "state", label: "State" },
  { field: "country", label: "Country" },
  { field: "pincode", label: "Pincode" },
  { field: "bankName", label: "Bank Name" },
  { field: "accountNumber", label: "Account Number" },
  { field: "ifscCode", label: "IFSC Code" },
  { field: "upiId", label: "UPI ID" },
  { field: "website", label: "Website" },
  { field: "instagram", label: "Instagram" },
  { field: "facebook", label: "Facebook" },
  { field: "businessStartYear", label: "Business Start Year" },
  { field: "preferredLanguages", label: "Preferred Languages", parse: asList },
  { field: "skills", label: "Skills", parse: asList },
  // "Yes" or "No" in the cell; `vendorInput` reads the word.
  { field: "canBeProductionTeamMember", label: "Can Be a Production Team Member" },
  { field: "rating", label: "Rating" },
  { field: "referredBy", label: "Referred By" },
  { field: "remarks", label: "Remarks" },
];

exports.importTemplate = handler(async () => ({ data: { columns: templateHeaders(VENDOR_IMPORT_COLUMNS) } }));

exports.importRows = handler(async (req) => {
  const userId = Number(req.user.id);
  return {
    data: await importTableRows({
      headers: req.body?.headers,
      rows: req.body?.rows,
      startRow: Number(req.body?.startRow) || 2,
      columns: VENDOR_IMPORT_COLUMNS,
      schema: vendorInput,
      // The module's own creator, so an imported vendor is written exactly as a typed one is -
      // same identifier counter, same audit columns.
      create: async (input) => {
        await createVendor(input, userId);
      },
    }),
  };
});
exports.update = handler(async (req) => {
  const current = await activeVendor(req.params.vendorId);
  const input = vendorInput.partial().parse(req.body);
  if (!Object.keys(input).length) throw fail(400, "Provide at least one field.");
  // Supported Branches are replaced only when the edit sends them; an edit that leaves them out keeps them.
  const { supportedBranchIds, ...data } = input;
  const row = await prisma.$transaction(async (tx) => {
    if (supportedBranchIds !== undefined) await checkSupportedBranches(supportedBranchIds, tx);
    const updated = await tx.vendor.update({ where: { id: current.id }, data: { ...data, updatedBy: Number(req.user.id) } });
    if (supportedBranchIds !== undefined) await saveSupportedBranches(tx, current.id, supportedBranchIds);
    return updated;
  });
  return { data: await addCreatorNames(row) };
});
exports.changeStatus = handler(async (req) => { const current = await activeVendor(req.params.vendorId); const input = statusInput.parse(req.body); const row = await prisma.vendor.update({ where: { id: current.id }, data: { status: input.status, statusReason: input.status === "ACTIVE" ? null : input.reason, updatedBy: Number(req.user.id) } }); return { data: await addCreatorNames(row) }; });
/**
 * Removing one vendor, as the route and the bulk delete both do it.
 *
 * Split out so `DELETE /bulk` runs this rather than its own query: `activeVendor` is what refuses a
 * vendor already gone, and `deleteInput` is what refuses a removal with no reason on it. The reason
 * comes off `req.body` either way - one vendor's confirmation and a selection's both put it there -
 * so a bulk removal is audited exactly as a single one is.
 */
const removeVendorRecord = async (req, vendorId) => { const current = await activeVendor(vendorId); const input = deleteInput.parse(req.body); await prisma.vendor.update({ where: { id: current.id }, data: { isDeleted: true, deletedReason: input.reason, deletedAt: new Date(), updatedBy: Number(req.user.id) } }); return { id: current.id, vendorId: current.vendorId, isDeleted: true }; };
exports.removeVendorRecord = removeVendorRecord;
exports.remove = handler(async (req) => ({ data: await removeVendorRecord(req, req.params.vendorId), message: "Vendor removed. The record was soft-deleted and retained for audit purposes." }));
