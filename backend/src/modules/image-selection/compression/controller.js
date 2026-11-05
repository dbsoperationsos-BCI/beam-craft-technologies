const { createCompressionService } = require("./service");
const { compressionBodySchema } = require("./validation");

const service = createCompressionService();

function handleError(error, res, action) {
  if (error.status) return res.status(error.status).json({ message: error.message });
  console.error(`Unable to ${action} Visual Curation compression settings:`, error);
  return res.status(500).json({ message: `Unable to ${action} compression settings.` });
}

async function getCompression(req, res) {
  try { return res.json({ data: await service.read() }); } catch (error) { return handleError(error, res, "load"); }
}

async function saveCompression(req, res) {
  const result = compressionBodySchema.safeParse(req.body || {});
  if (!result.success) return res.status(400).json({ message: "Invalid compression settings.", errors: result.error.flatten() });
  try { return res.json({ data: await service.save(result.data, req.user.id) }); } catch (error) { return handleError(error, res, "save"); }
}

module.exports = { getCompression, saveCompression };
