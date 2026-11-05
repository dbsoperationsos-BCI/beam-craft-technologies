const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const QRCode = require("qrcode");
const { repository } = require("./signatureAlbum.repository");
const { generateShortCode, SHORT_CODE_PATTERN } = require("../../../services/shortCode");
const { normalizeWhatsAppNumber } = require("../publish-share/service");
const { createSettingsService } = require("../settings/service");
const { httpError, clientUrlFor, formatDay } = require("./signatureAlbum.helpers");
const { SESSION_SCOPE, SESSION_TTL, DOWNLOAD_TICKET_SCOPE, DOWNLOAD_TICKET_TTL, LIMITS } = require("./signatureAlbum.constants");

/*
 * The album's credentials and the ways it is shared.
 *
 * The same mechanics the gallery publication and the proof link use - a 32-byte base64url token
 * looked up by SHA-256 hash and kept under AES-256-GCM so staff can re-copy the link, a PIN stored
 * as a bcrypt hash with a cipher beside it for Show PIN, a short code as the public name, and a
 * scoped JWT session once the PIN checks out - written here rather than imported from either, so
 * the album's business logic is coupled to neither flow. The primitives are thirty lines; the
 * coupling would have been for life.
 *
 * The PIN is never in a URL, a QR payload or a log line, and the public URL never carries an id.
 */

function encryptionKey() {
  const secret = process.env.PUBLISH_TOKEN_ENCRYPTION_KEY || process.env.JWT_SECRET;
  if (!secret) throw httpError(500, "Album link encryption is not configured.");
  return crypto.createHash("sha256").update(secret).digest();
}
const hashValue = (value) => crypto.createHash("sha256").update(value).digest("hex");
function encryptValue(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${encrypted.toString("base64url")}`;
}
function decryptValue(value) {
  const [iv, tag, encrypted] = value.split(".");
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encrypted, "base64url")), decipher.final()]).toString("utf8");
}
const safeDecrypt = (value) => { if (!value) return null; try { return decryptValue(value); } catch { return null; } };

const generateToken = () => crypto.randomBytes(32).toString("base64url");
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
// Padded rather than ranged, so 0047 is a PIN the studio may issue; a string from here on.
function generatePin(length = 4) {
  const digits = Math.min(LIMITS.MAX_PIN_LENGTH, Math.max(LIMITS.MIN_PIN_LENGTH, Number(length) || 4));
  return String(crypto.randomInt(0, 10 ** digits)).padStart(digits, "0");
}
const hashPin = (pin) => bcrypt.hash(String(pin), 12);
const comparePin = (pin, hash) => bcrypt.compare(String(pin), hash);

function sessionSecret() { const secret = process.env.JWT_SECRET; if (!secret) throw httpError(500, "Album session signing is not configured."); return secret; }
/*
 * Which PIN a session was opened under: a short digest of the PIN hash, or "none" for an album
 * without one. Reset PIN re-hashes, and turning the PIN on or off flips it, so a session opened
 * before either stops answering and the client is asked for the PIN again. Sessions signed before
 * the marker existed carry none and are still accepted until they expire.
 */
const pinMarkOf = (album) => (album?.requirePin && album?.pinHash ? hashValue(album.pinHash).slice(0, 16) : "none");
// `expiresIn` is shorter only for the server's own print of the album (Download Album's PDF).
function signSession(shortCode, albumId, { expiresIn = SESSION_TTL, pinMark } = {}) { return jwt.sign({ scope: SESSION_SCOPE, album: shortCode, albumId, ...(pinMark ? { pin: pinMark } : {}) }, sessionSecret(), { expiresIn }); }
function verifySession(shortCode, authHeader, album = null) {
  if (!authHeader || !authHeader.startsWith("Bearer ")) throw httpError(401, "Please enter the PIN to open this album.");
  let payload;
  try { payload = jwt.verify(authHeader.slice(7), sessionSecret()); } catch { throw httpError(401, "Your session has expired. Please enter the PIN again."); }
  if (payload.scope !== SESSION_SCOPE || payload.album !== shortCode) throw httpError(401, "Invalid album session.");
  if (album && payload.pin !== undefined && payload.pin !== pinMarkOf(album)) throw httpError(401, "The PIN for this album has changed. Please enter the PIN again.");
  return payload;
}

/*
 * The download ticket: what a session that may download is handed so the browser can fetch the
 * album's PDF as a plain URL - a download cannot carry a header - without the session itself ever
 * being written into a URL. Its own scope, so a session token can never stand in for it and it can
 * never open the album, and minutes rather than days, because it travels where the session does not.
 */
function signDownloadTicket(shortCode, albumId) { return jwt.sign({ scope: DOWNLOAD_TICKET_SCOPE, album: shortCode, albumId }, sessionSecret(), { expiresIn: DOWNLOAD_TICKET_TTL }); }
function verifyDownloadTicket(shortCode, ticket) {
  let payload;
  try { payload = jwt.verify(String(ticket || ""), sessionSecret()); } catch { throw httpError(401, "This download link has expired. Please open the album and press Download Album again."); }
  if (payload.scope !== DOWNLOAD_TICKET_SCOPE || payload.album !== shortCode) throw httpError(401, "Invalid download link.");
  return payload;
}

/*
 * PIN brute-force protection, the proof link's rule: eight tries per link per address in fifteen
 * minutes, thirty per address across links. In memory on purpose; a restart forgiving the count is
 * acceptable behind a random six-character code.
 */
const PIN_WINDOW_MS = 15 * 60 * 1000;
const PIN_MAX_PER_LINK = 8;
const PIN_MAX_PER_ADDRESS = 30;
const attempts = new Map();
function bump(key, max, now) {
  const entry = attempts.get(key);
  if (!entry || entry.resetAt <= now) { attempts.set(key, { count: 1, resetAt: now + PIN_WINDOW_MS }); return true; }
  entry.count += 1;
  return entry.count <= max;
}
function registerPinAttempt(shortCode, address) {
  const now = Date.now();
  if (attempts.size > 10000) for (const [key, entry] of attempts) { if (entry.resetAt <= now) attempts.delete(key); }
  const linkOk = bump(`link:${shortCode}:${address}`, PIN_MAX_PER_LINK, now);
  const addressOk = bump(`addr:${address}`, PIN_MAX_PER_ADDRESS, now);
  if (!linkOk || !addressOk) throw httpError(429, "Too many attempts. Please wait a few minutes and try again.");
}
const clearPinAttempts = (shortCode, address) => attempts.delete(`link:${shortCode}:${address}`);
const _resetPinAttempts = () => attempts.clear();

/*
 * A fresh link: token and short code together, retrying the code on the unique constraint until
 * an unclaimed one lands. Used for the first publish and for Regenerate Link - the old code stops
 * answering the moment the new one is written.
 */
async function mintLink(repo, albumId, attemptsLeft = 5) {
  const token = generateToken();
  for (let attempt = 0; attempt < attemptsLeft; attempt += 1) {
    try {
      return await repo.updateAlbum(albumId, { shortCode: generateShortCode(), tokenHash: hashValue(token), tokenCipher: encryptValue(token) });
    } catch (error) { if (error?.code !== "P2002") throw error; }
  }
  throw httpError(500, "Unable to allocate an album link. Please try again.");
}
async function mintPin(repo, albumId, length) {
  const pin = generatePin(length);
  return repo.updateAlbum(albumId, { pinHash: await hashPin(pin), pinCipher: encryptValue(pin) });
}

/*
 * The message the client receives - one wording for Copy, WhatsApp and the group send, built here
 * so the three cannot say different things. Optional lines are dropped rather than left blank.
 */
function albumMessage({ clientName, clientUrl, pin, expiresAt, studioName }) {
  return [
    `Hi ${clientName || "there"},`,
    "",
    "Your Signature Album is ready.",
    "",
    `Album:\n${clientUrl}`,
    pin ? `\nPIN:\n${pin}` : "",
    expiresAt ? `\nValid until:\n${formatDay(expiresAt)}` : "",
    studioName ? `\n${studioName}` : "",
  ].filter((line) => line !== "").join("\n");
}

function createSignatureAlbumShareService(repo = repository, dependencies = {}) {
  const studioSettings = dependencies.studioSettings || createSettingsService();
  const sessions = () => dependencies.sessions || require("../../sales/whatsapp-chat/sessionManager");
  const chatSwitches = () => dependencies.chatSwitches || require("../../sales/whatsapp-chat/repository");
  // Settings → WhatsApp Activity Log: every group send is recorded there, and a failed one resent from it.
  const activity = () => dependencies.activity || require("../../../services/whatsappActivity");

  // Who the album is addressed to: the linked Sales project's client, or the manual project's own.
  // The number is only ever turned into a wa.me link; it never travels to the browser as digits.
  async function resolveClient(project) {
    if (project.salesProjectId) {
      const salesProject = await repo.findSalesProject(project.salesProjectId);
      const details = salesProject?.groupNameGeneratorJson || {};
      const groupName = await repo.findWhatsappGroupName(salesProject?.whatsappGroupNameId);
      const couple = [groupName?.groomName, groupName?.brideName].filter(Boolean).join(" & ");
      return { clientName: couple || (typeof details.clientName === "string" && details.clientName) || salesProject?.whatsappGroupName || project.projectName, recipient: normalizeWhatsAppNumber(salesProject?.clientMainNumber), eventDate: groupName?.mainEventDate || salesProject?.mainEventDate || null };
    }
    return { clientName: project.clientName || project.projectName, recipient: normalizeWhatsAppNumber(project.clientMainNumber), eventDate: null };
  }

  // Everything the Review & Share card shows: link, PIN, expiry, message, wa.me link, QR.
  async function shareDetails(album, project) {
    const client = await resolveClient(project);
    const { studioName } = await studioSettings.read();
    const clientUrl = clientUrlFor(album.shortCode);
    const pin = album.requirePin ? safeDecrypt(album.pinCipher) : null;
    const message = clientUrl ? albumMessage({ clientName: album.title || client.clientName, clientUrl, pin, expiresAt: album.expiresAt, studioName }) : "";
    return {
      clientUrl, pin, requiresPin: album.requirePin, expiresAt: album.expiresAt, expiresAtLabel: formatDay(album.expiresAt),
      message,
      clientName: client.clientName,
      whatsappShareUrl: client.recipient ? `https://wa.me/${client.recipient.slice(1)}` : null,
      whatsappGroupSubject: project.whatsappGroupSubject || null,
      // Only the public link: never an id, never the PIN.
      qrDataUrl: clientUrl ? await QRCode.toDataURL(clientUrl, { margin: 1, width: 320 }) : null,
    };
  }

  /*
   * Sends the message into the project's linked WhatsApp group from this person's own paired
   * WhatsApp - the same socket, switches and group the gallery invite uses, and nothing else of
   * that flow: the album publishes itself, and this only carries its message.
   */
  async function sendToGroup(album, project, userId) {
    if (!project.whatsappGroupJid) throw httpError(422, "This project is not linked to a WhatsApp group yet. Link one in Selection Settings first.", { action: "link_whatsapp_group" });
    const switches = chatSwitches();
    if (!(await switches.isChatEnabled())) throw httpError(403, "WhatsApp chat is switched off for the studio. An administrator has to switch it back on before you can message.");
    if (!(await switches.isChatEnabledForUser(userId))) throw httpError(403, "Your WhatsApp chat has been switched off by an administrator.");
    const details = await shareDetails(album, project);
    if (!details.clientUrl) throw httpError(409, "Publish the album before sending it.");
    const sent = await activity().track({
      mode: "MANUAL", provider: "baileys", trigger: "SIGNATURE_ALBUM_SHARE", eventRef: `signature-album:${album.id}`,
      initiatedByUserId: userId, senderUserId: userId, links: { imageSelectionProjectId: project.id, salesProjectId: project.salesProjectId || null },
      recipient: { kind: "GROUP", address: project.whatsappGroupJid, name: project.whatsappGroupSubject || null },
      body: details.message, resendable: true,
    }, () => sessions().sendMessageToGroup({ userId, jid: project.whatsappGroupJid, body: details.message }));
    return { sent: true, providerMessageId: sent?.waMessageId || null, groupSubject: project.whatsappGroupSubject || null };
  }

  return { resolveClient, shareDetails, sendToGroup, mintLink: (albumId) => mintLink(repo, albumId), mintPin: (albumId, length) => mintPin(repo, albumId, length) };
}

module.exports = {
  createSignatureAlbumShareService, albumMessage,
  hashValue, encryptValue, decryptValue, safeDecrypt, generateToken, generatePin, hashPin, comparePin, TOKEN_PATTERN, SHORT_CODE_PATTERN,
  pinMarkOf, signSession, verifySession, signDownloadTicket, verifyDownloadTicket, registerPinAttempt, clearPinAttempts, _resetPinAttempts, PIN_MAX_PER_LINK, PIN_MAX_PER_ADDRESS,
};
