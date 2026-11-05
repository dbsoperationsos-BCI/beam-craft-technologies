const { z } = require("zod");
const service = require("./service");

const consentSchema = z.object({ consent: z.boolean() }).strict();

function handleError(error, res, action) {
  if (error.status) return res.status(error.status).json({ message: error.message });
  console.error(`Unable to ${action}:`, error);
  return res.status(500).json({ message: `Unable to ${action}.` });
}

async function getConsent(req, res) {
  try { return res.json({ data: await service.consent() }); } catch (error) { return handleError(error, res, "read the culling training consent"); }
}

async function setConsent(req, res) {
  const parsed = consentSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ message: "Send { consent: true } or { consent: false }." });
  try { return res.json({ data: await service.setConsent(parsed.data.consent, req.user.id) }); } catch (error) { return handleError(error, res, "save the culling training consent"); }
}

async function listModels(req, res) {
  try { return res.json({ data: await service.models() }); } catch (error) { return handleError(error, res, "list the culling models"); }
}

module.exports = { getConsent, setConsent, listModels, consentSchema };
