const prisma = require("../../../config/db");

// One row, always this id — the studio's own wording, not a user's, so there is nothing else to
// key it by. Mirrors the same fixed-id idiom `image-selection/settings/repository.js` uses.
const SETTINGS_ID = "default";

const settingsSelect = { dumDumTerms: true, quaQuaTerms: true, updatedByUserId: true, createdAt: true, updatedAt: true };

function createRepository(client = prisma) {
  return {
    find: () => client.salesCrdTermsSettings.findUnique({ where: { id: SETTINGS_ID }, select: settingsSelect }),
    // Upsert rather than update: the migration seeds an empty row, but a database restored from
    // before this table existed would have none, and the first save still has to succeed.
    upsert: (data) => client.salesCrdTermsSettings.upsert({
      where: { id: SETTINGS_ID },
      create: { id: SETTINGS_ID, ...data },
      update: data,
      select: settingsSelect,
    }),
  };
}

module.exports = { ...createRepository(), createRepository, SETTINGS_ID };
