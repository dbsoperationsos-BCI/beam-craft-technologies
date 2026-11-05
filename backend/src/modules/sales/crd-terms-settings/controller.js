const { createSettingsService } = require("./service");
const { settingsSchema } = require("./validation");

const service = createSettingsService();

// Who may read or change this is decided entirely by the route, which mounts SALES / CRD
// Documents — the same permission that already governs the CRD Documents screen this settings
// panel opens from, rather than a permission of its own.

function handleError(error, res, action) {
  if (error.status) return res.status(error.status).json({ message: error.message });
  console.error(`Unable to ${action} CRD terms & conditions settings:`, error);
  return res.status(500).json({ message: `Unable to ${action} the terms & conditions.` });
}

async function getSettings(req, res) {
  try {
    return res.json({ data: await service.read() });
  } catch (error) {
    return handleError(error, res, "load");
  }
}

async function saveSettings(req, res) {
  const result = settingsSchema.safeParse(req.body);
  if (!result.success) return res.status(400).json({ message: "Invalid terms & conditions.", errors: result.error.flatten() });

  // Only the keys the request actually named reach the database, the same rule
  // `image-selection/settings/controller.js` follows — saving Dum Dum's text must not touch Qua
  // Qua's stored value, and an `.optional()` field otherwise answers undefined either way, which
  // Object.fromEntries would then treat identically to "not sent".
  const providedKeys = new Set(Object.keys(req.body || {}));
  const data = Object.fromEntries(Object.entries(result.data).filter(([key]) => providedKeys.has(key)));

  try {
    return res.json({ data: await service.save(data, req.user.id) });
  } catch (error) {
    return handleError(error, res, "save");
  }
}

module.exports = { getSettings, saveSettings };
