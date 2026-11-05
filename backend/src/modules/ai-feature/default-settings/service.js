const prisma = require("../../../config/db");
const { GROUPS, resolveAll, mergeGroup } = require("../shared/settingsDefaults");

const ROW_ID = "default";

/** Reading never writes: a database with no row answers the code's defaults. */
async function read() {
  const row = await prisma.aiEventDefaultSetting.findUnique({ where: { id: ROW_ID } });
  return { ...resolveAll(row), updatedAt: row?.updatedAt ?? null, updatedByUserId: row?.updatedByUserId ?? null };
}

/** Saves the groups given, each merged over what is stored, so a panel that edits one group leaves the others alone. */
async function save(patch, userId) {
  const row = await prisma.aiEventDefaultSetting.findUnique({ where: { id: ROW_ID } });
  const data = { updatedByUserId: userId ?? null };
  for (const group of GROUPS) if (patch[group]) data[group] = mergeGroup(group, { ...mergeGroup(group, row?.[group]), ...patch[group] });
  const saved = await prisma.aiEventDefaultSetting.upsert({ where: { id: ROW_ID }, create: { id: ROW_ID, ...data }, update: data });
  return { ...resolveAll(saved), updatedAt: saved.updatedAt, updatedByUserId: saved.updatedByUserId };
}

/** The raw row for the wizard to snapshot from; null groups fall back inside `snapshotForEvent`. */
const rawRow = () => prisma.aiEventDefaultSetting.findUnique({ where: { id: ROW_ID } });

module.exports = { read, save, rawRow };
