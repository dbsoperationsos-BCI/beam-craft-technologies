const { createWhatsappService } = require("./service"); const { createPublishShareService } = require("../publish-share/service");
const { createGroupLinkService } = require("./group.service");
const { projectIdSchema } = require("../projects/validation");
const { linkGroupSchema } = require("./validation");
const { sessionState, startSession } = require("../../sales/whatsapp-chat/sessionManager");
const { isChatEnabled, isChatEnabledForUser } = require("../../sales/whatsapp-chat/repository");
// The client hears of photos sent their way in the app too, not only on WhatsApp.
const clientPush = require("../../../services/clientPush");
const whatsapp = createWhatsappService(); const publishShare = createPublishShareService(); const groups = createGroupLinkService();

// The same two switches the CRM chat honours, in the same words. Pairing is a real registration
// against the studio's number and a send goes out on it, so the studio-wide switch and the
// person's own are both asked before either happens here - a request that never went through the
// CRM's screens must not get past them.
const CHAT_OFF_MESSAGE = "WhatsApp chat is switched off for the studio. An administrator has to switch it back on before you can link or message.";
const USER_BLOCKED_MESSAGE = "Your WhatsApp chat has been switched off by an administrator.";

function parse(schema, value, res, message) { const result = schema.safeParse(value); if (result.success) return result.data; res.status(400).json({ message, errors: result.error.flatten() }); return null; }
// `code` travels with the status so the panel can tell "link your WhatsApp" (WHATSAPP_NOT_CONNECTED)
// from "link a group" (the 422's details.action) without reading the sentence.
function fail(res, error, fallback) { if (error?.status) return res.status(error.status).json({ message: error.message, ...(error.code ? { code: error.code } : {}), ...(error.details ? { details: error.details } : {}) }); console.error(fallback, error); return res.status(500).json({ message: fallback }); }
async function switchedOff(userId) { if (!(await isChatEnabled())) return CHAT_OFF_MESSAGE; if (!(await isChatEnabledForUser(userId))) return USER_BLOCKED_MESSAGE; return ""; }

async function send(req, res) { try { const prepared = await publishShare.prepareForNotification(req.params.projectId, req.user.id, req.body?.pending || {}); /* The gallery is ready to send: the client's app hears of it whether or not WhatsApp gets through. */ clientPush.notifyGallery(req.params.projectId, { title: "New photos are ready for you", body: "Open the Don't Blink Studioz app to choose your favourites", data: { type: "gallery" } }); const preview = prepared.whatsappPreview; const result = await whatsapp.queue({ salesProjectId: prepared.client.salesProjectId, imageSelectionProjectId: req.params.projectId, initiatedByUserId: req.user.id, recipient: prepared._recipient, publishVersion: prepared.gallery.publishVersion, templateName: process.env.META_WHATSAPP_TEMPLATE_NAME || preview.template, languageCode: process.env.META_WHATSAPP_TEMPLATE_LANGUAGE || "en", context: { ...preview.variables, pin: prepared.gallery.pin, deliverables: preview.variables.deliverableSummary, deadline: preview.variables.linkExpiryLabel } }); delete prepared._recipient; return res.status(result.status === "QUEUED" ? 202 : 200).json({ data: { preview: prepared, notification: result } }); } catch (error) { if (error.status) return res.status(error.status).json({ message: error.message, ...(error.details ? { details: error.details } : {}) }); return res.status(500).json({ message: "Unable to queue WhatsApp notification." }); } }
async function status(req, res) { const item = await require("./repository").findById(req.params.notificationId); if (!item) return res.status(404).json({ message: "Notification not found." }); return res.json({ data: item }); }

// Where this coordinator's own WhatsApp stands, with the two switches beside it so the panel can
// tell "not linked" from "not allowed to link".
async function session(req, res) { try { const [chatEnabled, userChatEnabled] = await Promise.all([isChatEnabled(), isChatEnabledForUser(req.user.id)]); return res.json({ data: { ...sessionState(req.user.id), chatEnabled, userChatEnabled } }); } catch (error) { return fail(res, error, "Unable to read the WhatsApp session."); } }
async function connect(req, res) { try { const off = await switchedOff(req.user.id); if (off) return res.status(403).json({ message: off }); return res.json({ data: { ...(await startSession(req.user.id)), chatEnabled: true, userChatEnabled: true } }); } catch (error) { return fail(res, error, "Unable to start WhatsApp pairing."); } }
async function listGroups(req, res) { const params = parse(projectIdSchema, req.params, res, "Invalid project request."); if (!params) return; try { return res.json({ data: await groups.listGroups(params.projectId, req.user.id) }); } catch (error) { return fail(res, error, "Unable to read your WhatsApp groups."); } }
async function linkGroup(req, res) { const params = parse(projectIdSchema, req.params, res, "Invalid project request."); const body = parse(linkGroupSchema, req.body, res, "Choose a WhatsApp group."); if (!params || !body) return; try { return res.json({ data: await groups.link(params.projectId, req.user.id, body.jid) }); } catch (error) { return fail(res, error, "Unable to link the WhatsApp group."); } }
async function unlinkGroup(req, res) { const params = parse(projectIdSchema, req.params, res, "Invalid project request."); if (!params) return; try { return res.json({ data: await groups.unlink(params.projectId) }); } catch (error) { return fail(res, error, "Unable to unlink the WhatsApp group."); } }
async function linkAllGroups(req, res) { try { return res.json({ data: await groups.linkAll(req.user.id) }); } catch (error) { return fail(res, error, "Unable to match WhatsApp groups."); } }
/* Send to Client opens the studio's WhatsApp in the browser and never reaches this server, so the web tells it here: the client's app hears that photos are ready. Answers how many phones it went to. */
async function notifyApp(req, res) { const params = parse(projectIdSchema, req.params, res, "Invalid project request."); if (!params) return; try { const sent = await clientPush.notifyGallery(params.projectId, { title: "New photos are ready for you", body: "Open the Don't Blink Studioz app to choose your favourites", data: { type: "gallery" } }); return res.json({ data: { sent } }); } catch (error) { return fail(res, error, "Unable to tell the client's app."); } }
async function sendGroup(req, res) { const params = parse(projectIdSchema, req.params, res, "Invalid project request."); if (!params) return; try { const off = await switchedOff(req.user.id); if (off) return res.status(403).json({ message: off }); const sent = await groups.sendInvite(params.projectId, req.user.id, req.body?.pending || {}); clientPush.notifyGallery(params.projectId, { title: "New photos are ready for you", body: "Open the Don't Blink Studioz app to choose your favourites", data: { type: "gallery" } }); return res.json({ data: sent }); } catch (error) { return fail(res, error, "Unable to send the invite to the WhatsApp group."); } }

module.exports = { send, status, session, connect, listGroups, linkGroup, unlinkGroup, linkAllGroups, sendGroup, notifyApp };
