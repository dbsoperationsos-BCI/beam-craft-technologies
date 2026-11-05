const { z } = require("zod");
const {
  readMonitoringSettings, saveMonitoringSettings,
  MIN_USAGE_TIMEOUT_MINUTES, MAX_USAGE_TIMEOUT_MINUTES,
} = require("./service");
const iamService = require("../../../services/iam.service");

const settingsSchema = z.object({
  usageTimeoutMinutes: z.coerce.number().int().min(MIN_USAGE_TIMEOUT_MINUTES).max(MAX_USAGE_TIMEOUT_MINUTES),
});

/**
 * The settings, plus whether this viewer may change them.
 *
 * Readable by anybody signed in, deliberately: every browser needs the timeout to know when to stop
 * beating, so gating the read would leave most of the studio measuring usage by a number nobody
 * told them. `canEdit` is what the Settings panel uses to decide between a field and a read-only
 * line - the same shape the WhatsApp chat switch answers with - and the write is guarded on the
 * server regardless of what the client does with it.
 */
async function getSettings(req, res) {
  try {
    const settings = await readMonitoringSettings();
    const canEdit = await iamService.hasPermission(req.user.id, "SETTINGS", "Application Monitoring", "READ_WRITE");
    return res.json({
      data: { ...settings, canEdit, minMinutes: MIN_USAGE_TIMEOUT_MINUTES, maxMinutes: MAX_USAGE_TIMEOUT_MINUTES },
    });
  } catch (error) {
    console.error("Unable to read application monitoring settings:", error);
    return res.status(500).json({ message: "Unable to read application monitoring settings." });
  }
}

async function saveSettings(req, res) {
  const parsed = settingsSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      message: `Usage timeout must be a whole number of minutes between ${MIN_USAGE_TIMEOUT_MINUTES} and ${MAX_USAGE_TIMEOUT_MINUTES}.`,
      errors: parsed.error.flatten(),
    });
  }
  try {
    const saved = await saveMonitoringSettings(parsed.data, req.user?.id ?? null);
    return res.json({ data: { ...saved, canEdit: true } });
  } catch (error) {
    console.error("Unable to save application monitoring settings:", error);
    return res.status(500).json({ message: "Unable to save application monitoring settings." });
  }
}

module.exports = { getSettings, saveSettings };
