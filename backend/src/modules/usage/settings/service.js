const prisma = require("../../../config/db");

/**
 * How the application decides somebody has stopped using it.
 *
 * One row, read by every signed-in browser and written by an administrator. The shape follows
 * `image-selection/settings`: defaults live here, `read()` never writes, and a save merges over the
 * defaults so a partial write cannot blank a field it did not mention.
 */

const SETTINGS_ID = "default";

/*
 * Three minutes.
 *
 * Long enough to read: somebody studying a lead's remarks, listening on a call or reading a
 * quotation is using this application and may not touch anything for a minute or two. Short enough
 * that a tab left open while they went to lunch stops counting within a few beats.
 *
 * Stated here as well as in the migration's column default, because the read path has to answer
 * something sensible when the table is missing entirely - an upgrade that has not been migrated
 * yet must not stop the application recording usage at all.
 */
const DEFAULT_USAGE_TIMEOUT_MINUTES = 3;

/*
 * The bounds an administrator may type between.
 *
 * Below a minute the heartbeat cannot see the difference - it beats every 30 seconds, so a timeout
 * shorter than two beats would end a stretch between one beat and the next and record somebody
 * working continuously as a string of fragments. Above four hours it has stopped being an
 * inactivity timeout and become no timeout at all, which is the fault this setting exists to avoid.
 */
const MIN_USAGE_TIMEOUT_MINUTES = 1;
const MAX_USAGE_TIMEOUT_MINUTES = 240;

const DEFAULTS = { usageTimeoutMinutes: DEFAULT_USAGE_TIMEOUT_MINUTES };

/**
 * The settings as they stand, defaults filled in.
 *
 * Never writes. A row that does not exist yet is not an error and is not worth creating on a read -
 * the migration seeds one, and an install where it is somehow missing should still answer with the
 * defaults rather than fail. A table that does not exist is treated the same way, so a server
 * running ahead of its migrations keeps recording usage on the default timeout.
 */
async function readMonitoringSettings() {
  try {
    const stored = await prisma.appMonitoringSettings.findUnique({
      where: { id: SETTINGS_ID },
      select: { usageTimeoutMinutes: true },
    });
    return { ...DEFAULTS, ...(stored || {}) };
  } catch (error) {
    console.warn("Unable to read application monitoring settings; using defaults.", error?.message);
    return { ...DEFAULTS };
  }
}

/** Writes the settings and answers with them, defaults filled in. */
async function saveMonitoringSettings(input = {}, userId = null) {
  const data = { usageTimeoutMinutes: input.usageTimeoutMinutes, updatedByUserId: userId ?? null };
  const saved = await prisma.appMonitoringSettings.upsert({
    where: { id: SETTINGS_ID },
    update: data,
    create: { id: SETTINGS_ID, ...data },
    select: { usageTimeoutMinutes: true },
  });
  return { ...DEFAULTS, ...saved };
}

module.exports = {
  readMonitoringSettings,
  saveMonitoringSettings,
  DEFAULT_USAGE_TIMEOUT_MINUTES,
  MIN_USAGE_TIMEOUT_MINUTES,
  MAX_USAGE_TIMEOUT_MINUTES,
};
