const prisma = require("../../../config/db");

// One row, always this id. Studio-wide settings have exactly one answer, so the id is fixed
// rather than generated: there is no way to end up with a second row disagreeing with the first,
// and every read and write addresses the same record without having to look up which one is live.
const SETTINGS_ID = "default";

const settingsSelect = {
  galleryValidityMonths: true, defaultSelectionLimit: true, originalStoragePath: true, selectedOutputPath: true, studioName: true, loginCredentialName: true, galleryLogoUrl: true, faviconUrl: true,
  loginSlides: true, updatedByUserId: true, createdAt: true, updatedAt: true,
};

function createRepository(client = prisma) {
  return {
    find: () => client.imageSelectionSettings.findUnique({ where: { id: SETTINGS_ID }, select: settingsSelect }),
    // Upsert rather than update: the row is only written the first time a Super Admin saves the
    // form, so a fresh database has no settings row and still serves the defaults.
    upsert: (data) => client.imageSelectionSettings.upsert({
      where: { id: SETTINGS_ID },
      create: { id: SETTINGS_ID, ...data },
      update: data,
      select: settingsSelect,
    }),
  };
}

module.exports = { ...createRepository(), createRepository, SETTINGS_ID };
