const { z } = require("zod");
const prisma = require("../../config/db");
const { vendorTypes, skillGroups } = require("./vendor-options");
const { nextIdentifier } = require("../../services/identifiers");
const { importTableRows, templateHeaders, asList } = require("../../services/tableImport");

const statuses = ["ACTIVE", "INACTIVE"];
const optionalText = (max) => z.preprocess((v) => v === "" ? null : v, z.string().trim().max(max).nullable().optional());
const vendorInput = z.object({
  vendorName: z.string().trim().min(1).max(191), vendorType: z.string().trim().min(1).max(100),
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
  referredBy: optionalText(191), remarks: optionalText(10000)
});
const listInput = z.object({ q: z.string().trim().max(191).optional(), status: z.enum(statuses).optional(), vendorType: z.string().trim().max(100).optional(), skill: z.string().trim().max(150).optional(), page: z.coerce.number().int().positive().default(1), limit: z.coerce.number().int().min(1).max(100).default(50) });
const statusInput = z.object({ status: z.enum(statuses), reason: optionalText(10000) }).superRefine((v, ctx) => { if (v.status === "INACTIVE" && !v.reason) ctx.addIssue({ code: "custom", path: ["reason"], message: "A reason is required for Inactive status." }); });
const deleteInput = z.object({ reason: z.string().trim().min(1, "A reason is required before permanently removing a vendor.").max(10000) });
const fail = (status, message) => Object.assign(new Error(message), { status });
const handler = (work, status = 200) => async (req, res) => { try { res.status(status).json(await work(req)); } catch (error) { console.error("Vendor management error:", error); if (error instanceof z.ZodError) return res.status(400).json({ message: "Please correct the vendor details.", errors: error.issues }); res.status(error.status || 500).json({ message: error.status ? error.message : "Unable to process vendor request." }); } };
const locator = (value) => /^\d+$/.test(value) ? { id: Number(value) } : { vendorId: value };
async function activeVendor(value) { const row = await prisma.vendor.findFirst({ where: { ...locator(value), isDeleted: false } }); if (!row) throw fail(404, "Vendor not found."); return row; }
// DBS-VNMGMT-000001. One run of numbers for the studio: a vendor is not a branch's or a vertical's.
const nextVendorId = () => nextIdentifier("VENDOR");
async function addCreatorNames(rows) { const list = Array.isArray(rows) ? rows : [rows]; const ids = [...new Set(list.map((row) => row.createdBy).filter(Boolean))]; const users = ids.length ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : []; const names = new Map(users.map((user) => [user.id, user.name])); const result = list.map((row) => ({ ...row, dateAdded: row.createdAt, addedBy: row.createdBy ? { id: row.createdBy, name: names.get(row.createdBy) || null } : null, yearsOfExperience: row.businessStartYear ? Math.max(0, new Date().getFullYear() - row.businessStartYear) : null })); return Array.isArray(rows) ? result : result[0]; }

exports.options = handler(async (req) => { const q = String(req.query.q || "").trim().toLowerCase(); const groups = Object.entries(skillGroups).map(([group, values]) => ({ group, options: values.filter((value) => !q || value.toLowerCase().includes(q) || group.toLowerCase().includes(q)) })).filter((item) => item.options.length); return { data: { statuses, vendorTypes: await vendorTypes(), skillGroups: groups, skills: [...new Set(groups.flatMap((item) => item.options))] } }; });
// The vendor picker the asset status dialog fills when an asset goes in for service. It is a read
// of names, not of the vendor records - no contact details, no rating, no commercial terms - so it
// is reachable by Asset Management as well as by Vendor Management, which is what lets the two be
// granted apart. `list` above stays behind Vendor Management alone.
exports.picker = handler(async () => {
  const rows = await prisma.vendor.findMany({
    where: { isDeleted: false, status: "ACTIVE" },
    orderBy: { vendorName: "asc" },
    take: 200,
    select: { id: true, vendorId: true, vendorName: true, vendorType: true },
  });
  return { data: rows };
});

exports.list = handler(async (req) => {
  const input = listInput.parse(req.query);
  // Everything the caller asked for except the status itself. The tab counts are read from this,
  // so switching tabs cannot move them, while a search or type filter still narrows them.
  const base = { isDeleted: false, ...(input.vendorType && { vendorType: input.vendorType }), ...(input.skill && { skills: { array_contains: input.skill } }), ...(input.q && { OR: ["vendorId", "vendorName", "contactPerson", "mobileNumber", "email", "businessRegistrationName", "city"].map((field) => ({ [field]: { contains: input.q } })) }) };
  const where = { ...base, ...(input.status && { status: input.status }) };
  const [rows, total, grouped] = await Promise.all([
    prisma.vendor.findMany({ where, orderBy: { createdAt: "desc" }, skip: (input.page - 1) * input.limit, take: input.limit }),
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
exports.create = handler(async (req) => { const input = vendorInput.parse(req.body); const userId = Number(req.user.id); const row = await prisma.vendor.create({ data: { ...input, vendorId: await nextVendorId(), createdBy: userId, updatedBy: userId } }); return { data: await addCreatorNames(row) }; }, 201);

/*
 * ── Importing vendors from a spreadsheet ──────────────────────────────────────────────────────
 *
 * The columns a file may carry, and the one it must. `vendorName` and `vendorType` are what the
 * schema demands of every vendor, so a file without those headings is refused before a row is read
 * rather than failing on all of them.
 *
 * The two list columns hold several values in one cell - "Photography; Videography" - which is how
 * a person writes a list in a spreadsheet. Everything else is left as text for `vendorInput` to
 * coerce, so an imported vendor is validated by exactly what the form is validated by.
 */
const VENDOR_IMPORT_COLUMNS = [
  { field: "vendorName", label: "Vendor Name", required: true },
  { field: "vendorType", label: "Vendor Type", required: true },
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
        await prisma.vendor.create({ data: { ...input, vendorId: await nextVendorId(), createdBy: userId, updatedBy: userId } });
      },
    }),
  };
});
exports.update = handler(async (req) => { const current = await activeVendor(req.params.vendorId); const input = vendorInput.partial().parse(req.body); if (!Object.keys(input).length) throw fail(400, "Provide at least one field."); const row = await prisma.vendor.update({ where: { id: current.id }, data: { ...input, updatedBy: Number(req.user.id) } }); return { data: await addCreatorNames(row) }; });
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
