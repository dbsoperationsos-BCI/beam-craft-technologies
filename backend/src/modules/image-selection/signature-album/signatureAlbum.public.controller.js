const { createSignatureAlbumClientService } = require("./signatureAlbum.client.service");
const v = require("./signatureAlbum.validation");
const { expiredLinkBody } = require("../../../services/expiredLink");
const { clientIp } = require("../../../middleware/rateLimit");
const { wantsPage, backToPage } = require("../../../services/downloadNavigation");
const { clientUrlFor } = require("./signatureAlbum.helpers");

const service = createSignatureAlbumClientService();

// Params that fail validation answer the same generic 404 an unknown code gets.
function validate(schema, value, res, status = 404, message = "This album is not available.") { const parsed = schema.safeParse(value); if (parsed.success) return parsed.data; res.status(status).json({ message }); return null; }
function isClientAbort(error) { return error?.code === "ECONNABORTED" || error?.code === "ECONNRESET"; }
function handleError(error, res, action) {
  if (isClientAbort(error) || res.destroyed || res.writableEnded) return undefined;
  if (res.headersSent) { console.error(`Unable to finish ${action}:`, error); return undefined; }
  if (error?.status) return res.status(error.status).json({ message: error.message, ...expiredLinkBody(error) });
  console.error(`Unable to ${action}:`, error);
  return res.status(500).json({ message: `Unable to ${action}.` });
}
async function requireSession(req, res, token) { try { return await service.requireSession(token, req.headers.authorization); } catch (error) { handleError(error, res, "verify the album session"); return null; } }

async function meta(req, res) {
  const params = validate(v.publicTokenSchema, req.params, res); if (!params) return;
  try { return res.json({ data: await service.meta(params.token) }); } catch (error) { return handleError(error, res, "load the album"); }
}
// PIN attempts are counted per caller, read the way every public budget here reads it
// (`clientIp`): behind nginx `req.ip` is the proxy's for everyone, so counting by it let a stranger's
// wrong guesses lock every client of the studio out of every album.
async function verify(req, res) {
  const params = validate(v.publicTokenSchema, req.params, res); const body = validate(v.verifySchema, req.body || {}, res, 400, "Enter the PIN shared with you."); if (!params || !body) return;
  try { return res.json({ data: await service.verifyPin(params.token, body.pin, clientIp(req)) }); } catch (error) { return handleError(error, res, "verify the PIN"); }
}
async function content(req, res) {
  const params = validate(v.publicTokenSchema, req.params, res); if (!params) return;
  if (!(await requireSession(req, res, params.token))) return;
  try { return res.json({ data: await service.content(params.token) }); } catch (error) { return handleError(error, res, "load the album"); }
}
async function chapterItems(req, res) {
  const params = validate(v.publicChapterSchema, req.params, res); const query = validate(v.publicItemsQuerySchema, req.query, res, 400, "Invalid request."); if (!params || !query) return;
  if (!(await requireSession(req, res, params.token))) return;
  try { return res.json({ data: await service.chapterItems(params.token, params.chapterId, query) }); } catch (error) { return handleError(error, res, "load the photos"); }
}
// Download Album, step one: the session starts the album's PDF. Refused - as JSON the page can
// show - when the album does not allow downloads, so no download starts that cannot finish.
async function startDownload(req, res) {
  const params = validate(v.publicTokenSchema, req.params, res); if (!params) return;
  if (!(await requireSession(req, res, params.token))) return;
  try { return res.json({ data: await service.startDownload(params.token) }); } catch (error) { return handleError(error, res, "prepare the album download"); }
}
// Step two, asked every few seconds: preparing, failed, or ready with the ticket that fetches it.
async function downloadStatus(req, res) {
  const params = validate(v.publicTokenSchema, req.params, res); if (!params) return;
  if (!(await requireSession(req, res, params.token))) return;
  try { return res.json({ data: await service.downloadStatus(params.token) }); } catch (error) { return handleError(error, res, "prepare the album download"); }
}
// Step three: the ticket fetches the finished PDF. The browser is pointed here as a page load, so a
// refusal sends it back to the album (`backToPage`) rather than replacing the album with JSON.
async function downloadAlbum(req, res) {
  const params = validate(v.publicTokenSchema, req.params, res); if (!params) return;
  const page = wantsPage(req);
  const query = v.downloadTicketQuerySchema.safeParse(req.query);
  if (!query.success) return page ? backToPage(res, clientUrlFor(params.token)) : res.status(401).json({ message: "Invalid download link." });
  try {
    const download = await service.downloadAlbum(params.token, query.data.ticket);
    res.set("Cache-Control", "private, no-store");
    res.type("application/pdf");
    res.attachment(download.fileName);
    download.stream.on("error", (error) => { if (!res.headersSent) handleError(error, res, "download the album"); else res.destroy(error); });
    download.stream.pipe(res);
    return undefined;
  } catch (error) {
    if (page && !isClientAbort(error) && !res.headersSent) return backToPage(res, clientUrlFor(params.token));
    return handleError(error, res, "download the album");
  }
}
function sendMedia(type) {
  return async (req, res) => {
    const params = validate(v.publicImageSchema, req.params, res); if (!params) return;
    // The session is checked by the service: the album's cover is the one photo the PIN screen needs before there is one.
    try {
      const media = await service.media(params.token, params.imageId, type, req.headers.authorization);
      if (media.redirectUrl) return res.redirect(302, media.redirectUrl);
      res.type(media.contentType);
      res.set("Cache-Control", "private, max-age=3600");
      return res.sendFile(media.path, (error) => { if (error) handleError(error, res, "load the photo"); });
    } catch (error) { return handleError(error, res, "load the photo"); }
  };
}

module.exports = { meta, verify, content, chapterItems, startDownload, downloadStatus, downloadAlbum, thumbnail: sendMedia("thumbnail"), preview: sendMedia("preview") };
