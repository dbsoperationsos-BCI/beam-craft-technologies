const prisma = require("../../config/db");

function buildTree(rows, parentId = null) {
  return rows.filter((row) => row.parentId === parentId).map((row) => ({ ...row, children: buildTree(rows, row.id) }));
}
const withCounts = { _count: { select: { children: true, assets: true } } };
const handler = (work) => async (req, res) => {
  try { res.json({ data: await work(req) }); }
  catch (error) { console.error("Asset category error:", error); res.status(500).json({ message: "Unable to load asset categories." }); }
};
const filters = (req) => ({ ...(req.query.level && { level: Number(req.query.level) }), ...(req.query.parentId && { parentId: req.query.parentId }), ...(req.query.moduleType && { moduleType: req.query.moduleType }), ...(req.query.isActive !== "false" && { isActive: true }), ...(req.query.search && { name: { contains: req.query.search } }) });
exports.list = handler((req) => prisma.assetCategory.findMany({ where: filters(req), orderBy: [{ sortOrder: "asc" }, { name: "asc" }], include: withCounts }));
exports.children = handler((req) => prisma.assetCategory.findMany({ where: { parentId: req.params.categoryId, isActive: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], include: withCounts }));
exports.tree = handler(async () => buildTree(await prisma.assetCategory.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], include: withCounts })));
