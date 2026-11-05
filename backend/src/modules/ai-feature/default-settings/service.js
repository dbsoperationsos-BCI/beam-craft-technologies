const prisma = require("../../../config/db");
const { GROUPS, resolveAll, mergeGroup } = require("../shared/settingsDefaults");
const watermarks = require("../watermarks/service");
const { assertCanRequireCodes } = require("../notifications/otp");

const ROW_ID = "default";

/** Reading never writes: a database with no row answers the code's defaults. */
async function read() {
  const row = await prisma.aiEventDefaultSetting.findUnique({ where: { id: ROW_ID } });
  return { ...resolveAll(row), updatedAt: row?.updatedAt ?? null, updatedByUserId: row?.updatedByUserId ?? null };
}

/** Saves the groups given, each merged over what is stored, so a panel that edits one group leaves the others alone. */
async function save(patch, userId) {
  // Under the Watermark Presets lock, so a preset named as the default cannot be deleted mid-save;
  // the defaults name a preset and nothing more, and it has to exist when it is named.
  const saved = await watermarks.withDefaultsLock(async (tx) => {
    if (patch.gallery?.watermarkPresetId) await watermarks.assertPreset(patch.gallery.watermarkPresetId, tx);
    const row = await tx.aiEventDefaultSetting.findUnique({ where: { id: ROW_ID } });
    // Turning on Confirm phone numbers by SMS needs a gateway; leaving it on or turning it off does not.
    if (!mergeGroup("guestAccess", row?.guestAccess).verifyPhone) assertCanRequireCodes(patch.guestAccess);
    const data = { updatedByUserId: userId ?? null };
    for (const group of GROUPS) if (patch[group]) data[group] = mergeGroup(group, { ...mergeGroup(group, row?.[group]), ...patch[group] });
    return tx.aiEventDefaultSetting.update({ where: { id: ROW_ID }, data });
  });
  return { ...resolveAll(saved), updatedAt: saved.updatedAt, updatedByUserId: saved.updatedByUserId };
}

/** The raw row for the wizard to snapshot from; null groups fall back inside `snapshotForEvent`. */
const rawRow = () => prisma.aiEventDefaultSetting.findUnique({ where: { id: ROW_ID } });

module.exports = { read, save, rawRow };
