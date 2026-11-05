const { createAlbumClientService } = require("./client.service");
const {
  tokenParamsSchema, clientCorrectionParamsSchema, pinBodySchema, clientCorrectionSchema,
  clientCorrectionEditSchema, approveBodySchema,
} = require("./validation");

const { expiredLinkBody } = require("../../../services/expiredLink");
const { clientIp } = require("../../../middleware/rateLimit");

const service = createAlbumClientService();

// Params that fail validation answer the same generic 404 an unknown token gets — a probe learns
// nothing from the difference.
function validate(schema, value, res, status = 404, message = "This album proof is not available.") { const parsed = schema.safeParse(value); if (parsed.success) return parsed.data; res.status(status).json({ message }); return null; }
function handleError(error, res, action) { if (error.status) return res.status(error.status).json({ message: error.message, ...(error.details ? { details: error.details } : {}), ...expiredLinkBody(error) }); console.error(`Unable to ${action}:`, error); return res.status(500).json({ message: `Unable to ${action}.` }); }
async function requireSession(req, res, token) { try { return await service.requireCurrentSession(token, req.headers.authorization); } catch (error) { handleError(error, res, "verify the proof session"); return null; } }

async function meta(req, res) { const params = validate(tokenParamsSchema, req.params, res); if (!params) return; try { return res.json({ data: await service.meta(params.token) }); } catch (error) { return handleError(error, res, "load the album proof"); } }
async function verifyPin(req, res) { const params = validate(tokenParamsSchema, req.params, res); const body = validate(pinBodySchema, req.body, res, 400, "Enter the 6-digit PIN shared with you."); if (!params || !body) return; try { return res.json({ data: await service.verifyPin(params.token, body.pin, clientIp(req)) }); } catch (error) { return handleError(error, res, "verify the PIN"); } }
async function proof(req, res) { const params = validate(tokenParamsSchema, req.params, res); if (!params) return; if (!(await requireSession(req, res, params.token))) return; try { return res.json({ data: await service.proof(params.token) }); } catch (error) { return handleError(error, res, "load the proof"); } }
async function addCorrection(req, res) { const params = validate(tokenParamsSchema, req.params, res); const body = validate(clientCorrectionSchema, req.body, res, 400, "Tap a spot and write your correction."); if (!params || !body) return; if (!(await requireSession(req, res, params.token))) return; try { return res.status(201).json({ data: await service.addCorrection(params.token, body) }); } catch (error) { return handleError(error, res, "add the correction"); } }
async function editCorrection(req, res) { const params = validate(clientCorrectionParamsSchema, req.params, res); const body = validate(clientCorrectionEditSchema, req.body, res, 400, "Invalid correction update."); if (!params || !body) return; if (!(await requireSession(req, res, params.token))) return; try { return res.json({ data: await service.editCorrection(params.token, params.correctionId, body) }); } catch (error) { return handleError(error, res, "update the correction"); } }
async function deleteCorrection(req, res) { const params = validate(clientCorrectionParamsSchema, req.params, res); if (!params) return; if (!(await requireSession(req, res, params.token))) return; try { return res.json({ data: await service.deleteCorrection(params.token, params.correctionId) }); } catch (error) { return handleError(error, res, "remove the correction"); } }
async function submitCorrections(req, res) { const params = validate(tokenParamsSchema, req.params, res); if (!params) return; if (!(await requireSession(req, res, params.token))) return; try { return res.json({ data: await service.submitCorrections(params.token, { ip: req.ip, userAgent: req.headers["user-agent"] }) }); } catch (error) { return handleError(error, res, "submit the corrections"); } }
async function approve(req, res) { const params = validate(tokenParamsSchema, req.params, res); const body = validate(approveBodySchema, req.body ?? {}, res, 400, "Invalid approval request."); if (!params || !body) return; if (!(await requireSession(req, res, params.token))) return; try { return res.json({ data: await service.approve(params.token, body, { ip: req.ip, userAgent: req.headers["user-agent"] }) }); } catch (error) { return handleError(error, res, "approve the album"); } }

module.exports = { meta, verifyPin, proof, addCorrection, editCorrection, deleteCorrection, submitCorrections, approve };
