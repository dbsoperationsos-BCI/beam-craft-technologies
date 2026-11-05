const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const QRCode = require("qrcode");
const prisma = require("../../../config/db");
const {
  saveMessage, updateMessageStatus, findMessageByWaId,
  setReaction, setPinned, markDeleted, markRevoked, updateBody,
} = require("./repository");
const { recordLeadActivity } = require("../crm-leads/activityService");
const { useEncryptedAuthState, readCredentials, hasEncryptionKey } = require("./secureAuthState");
const { openMediaStream } = require("./mediaOnDemand");
const { prepareAudio } = require("./voiceNote");
// Settings → WhatsApp Activity Log: the ticks are written against its rows too. It reaches back to this
// module lazily, so requiring it here opens no cycle.
const whatsappActivity = require("../../../services/whatsappActivity");

/**
 * One WhatsApp connection per CRM, paired by scanning a QR from the lead popup.
 *
 * The link is the user's own WhatsApp account, joined the way a second phone or a desktop is:
 * WhatsApp calls these linked devices, and the pairing lasts until it is logged out from either
 * end. So the session belongs to the signed-in user, never to the app as a whole, and one CRM
 * cannot read or send from another's.
 *
 * Everything here is best-effort by design. It runs on background socket events, and an error
 * on one of those must not take the API down with it - a failed connection leaves the session
 * disconnected and the panel says so, which is recoverable by scanning again.
 */

// Where the pairing credentials live. Outside the repository tree by default, because these are
// the keys to somebody's WhatsApp account and they must never end up in a commit.
function sessionRoot() {
  return process.env.WHATSAPP_SESSION_DIR || path.join(process.cwd(), ".whatsapp-sessions");
}

/**
 * Whether this account has ever finished pairing.
 *
 * Not whether the credentials file exists: Baileys writes that as soon as it starts talking to
 * WhatsApp, keys and all, long before anybody scans anything. Reading its existence as "paired"
 * is what let an unpaired socket retry - six registrations in a few seconds, which WhatsApp
 * answers by refusing to issue a code at all. The account is paired when it says it is.
 */
async function hasCredentials(userId) {
  try {
    // Read through the seal rather than off the disk: the file is encrypted, and a caller that
    // parsed it itself would both fail and have to know how it is stored.
    const creds = await readCredentials(sessionDir(userId));
    return Boolean(creds?.registered || creds?.me?.id);
  } catch {
    return false;
  }
}

function sessionDir(userId) {
  return path.join(sessionRoot(), `user-${String(userId)}`);
}

/*
 * How close together two messages may be sent from one account.
 *
 * One-to-one conversation is what this is for, and a person writing to a client does not send
 * twice in the same second. The gap is enforced rather than assumed, so no amount of clicking -
 * or any future caller of this module - can turn the account into something that looks like a
 * broadcaster.
 */
const MIN_SEND_GAP_MS = 1500;

// Long enough to be the typing that a message of any length would take.
const TYPING_MS = 600;

// How a dropped connection comes back: quickly at first, then slower, and eventually not at all.
// A client that reconnects in a tight loop is a client WhatsApp has every reason to block.
// How long between one attempt to reach WhatsApp and the next, however it is triggered.
const MIN_CONNECT_GAP_MS = 15_000;

// How much of a conversation is asked for at a time. WhatsApp answers a request of this shape
// with a batch it chooses; asking for the lot in one go is what it refuses.
const HISTORY_PAGE_SIZE = 50;
// Where the close codes and the retry policy live, so they can be tested without Baileys.
const { decideOnClose } = require("./sessionLifecycle");

// The country the studio dials from, for lead numbers stored as bare 10 digits.
function defaultCountryCode() {
  return String(process.env.WHATSAPP_DEFAULT_COUNTRY_CODE || "91").replace(/\D/g, "") || "91";
}

/**
 * The digits WhatsApp knows a number by.
 *
 * Leads arrive from three places and are written by hand in a fourth, so the same client is
 * "9876543210" on one row, "+91 98765 43210" on the next and "0919876543210" on a third. All of
 * them are the same person, and the last ten digits are what say so.
 */
function normalizePhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "";
  const local = digits.slice(-10);
  return local.length === 10 ? `${defaultCountryCode()}${local}` : digits;
}

function jidFor(phone) {
  const digits = normalizePhone(phone);
  return digits ? `${digits}@s.whatsapp.net` : "";
}

/**
 * WhatsApp's own delivery numbers, in the CRM's words.
 *
 * 1 pending and 2 server-ack are both "it has left here" - one tick. 3 is the other phone
 * receiving it - two ticks. 4 read and 5 played are the message being opened - blue.
 */
function deliveryStatus(code) {
  if (code === undefined || code === null) return "";
  const value = Number(code);
  if (value >= 4) return "read";
  if (value === 3) return "delivered";
  if (value >= 1) return "sent";
  return "";
}

/*
 * A one-to-one conversation, and nothing else.
 *
 * Two addresses mean the same person. WhatsApp has been moving accounts onto LIDs - an opaque id
 * ending @lid - and a message from a client can arrive addressed either way, sometimes both ways
 * in the same conversation. Accepting only @s.whatsapp.net dropped every LID-addressed message as
 * though it were a group, which is why replies from clients never reached the thread while
 * everything sent from here went out fine.
 *
 * Groups (@g.us), newsletters and status broadcasts stay out, as they always did.
 */
function isDirectChat(jid) {
  if (typeof jid !== "string") return false;
  return jid.endsWith("@s.whatsapp.net") || jid.endsWith("@lid");
}

function phoneFromJid(jid) {
  return String(jid || "").split("@")[0].split(":")[0].replace(/\D/g, "");
}

/**
 * Which phone number a LID belongs to.
 *
 * A message can arrive carrying only the LID, with no phone number beside it - and a LID on its
 * own matches no lead. Every message that carries both teaches this map, and so does asking
 * WhatsApp about a number before sending to it, so by the time a bare LID turns up its owner is
 * usually already known.
 */
const lidToPhone = new Map();

function rememberLid(lid, phone) {
  const key = String(lid || "").split("@")[0].split(":")[0];
  if (key && phone) lidToPhone.set(key, phone);
}

function phoneForLid(lid) {
  return lidToPhone.get(String(lid || "").split("@")[0].split(":")[0]) || "";
}

/**
 * The client's actual number behind a message, whichever way it was addressed.
 *
 * A LID is not a phone number and cannot be matched against a lead, so the phone-number address
 * that comes alongside it is what the lookup needs. WhatsApp sends it on the key - as the sender's
 * own number on an incoming message, or the recipient's on one of ours - and only when neither is
 * present is there nothing to go on.
 */
function phoneFromMessageKey(key = {}) {
  const candidates = key.fromMe
    ? [key.remoteJidAlt, key.remoteJid]
    : [key.senderPn, key.participantPn, key.remoteJidAlt, key.remoteJid];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.endsWith("@s.whatsapp.net")) {
      const phone = phoneFromJid(candidate);
      // Both addresses in one message is the one moment the pairing between them is stated.
      for (const lid of [key.remoteJid, key.senderLid, key.participantLid]) {
        if (typeof lid === "string" && lid.endsWith("@lid")) rememberLid(lid, phone);
      }
      return phone;
    }
  }
  // Nothing but a LID: whatever has been learned about it, if anything.
  for (const candidate of [key.remoteJid, key.senderLid, key.participantLid]) {
    const known = typeof candidate === "string" && candidate.endsWith("@lid") ? phoneForLid(candidate) : "";
    if (known) return known;
  }
  return "";
}

/**
 * The lead a number belongs to, or nothing.
 *
 * This is the filter that keeps a CRM's own conversations out of the company's database. The
 * socket is handed every message the account receives; only the ones whose counterpart is a
 * lead in this CRM are kept, and a message from a friend or a delivery driver is dropped
 * without being written anywhere.
 */
// History arrives as thousands of messages at once, and every one of them asks this question.
// The answers are cached for a few minutes so a sync is a handful of queries rather than one per
// message; a lead created since is picked up on the next window.
const leadIdCache = new Map();
const LEAD_ID_CACHE_MS = 5 * 60 * 1000;

async function leadIdForPhone(phone) {
  const digits = normalizePhone(phone);
  if (!digits) return "";
  const local = digits.slice(-10);
  if (local.length !== 10) return "";

  const cached = leadIdCache.get(local);
  if (cached && cached.at > Date.now() - LEAD_ID_CACHE_MS) return cached.enquiryId;
  const rows = await prisma.$queryRawUnsafe(
    // Snake_case, because this is the lead table rather than one of this module's own. The alias
    // keeps the rest of the function reading `enquiryId`, which is what the CRM calls it.
    `SELECT \`enquiry_id\` AS \`enquiryId\` FROM \`sales_crm_lead\`
      WHERE \`deleted_at\` IS NULL
        AND (RIGHT(REGEXP_REPLACE(COALESCE(\`phone\`, ''), '[^0-9]', ''), 10) = ?
          OR RIGHT(REGEXP_REPLACE(COALESCE(\`contact_number\`, ''), '[^0-9]', ''), 10) = ?)
      ORDER BY \`updated_at\` DESC
      LIMIT 1`,
    local,
    local,
  );
  const enquiryId = rows?.[0]?.enquiryId || "";
  leadIdCache.set(local, { enquiryId, at: Date.now() });
  return enquiryId;
}

// What the panel needs to draw itself, per user.
const sessions = new Map();

/**
 * That a WhatsApp conversation happened, in the lead's own activity log.
 *
 * The log records contact, not content: that a message went out or came in, and what kind it was,
 * the way a status change or a follow-up date is recorded. What was actually said stays in the
 * WhatsApp Chat tab and is never copied into the log - a client's words are not an audit entry.
 *
 * Best-effort: a log line that cannot be written is no reason to lose the message it describes.
 */
/**
 * Linking and unlinking, in the log of the lead it was done from.
 *
 * A WhatsApp session belongs to a person, not to a lead, so there is no perfectly right row to
 * write this against - but it is done from a lead's chat tab, and that is where somebody looking
 * for it will look. The alternative is that the one action nobody can undo goes unrecorded.
 */
async function logWhatsAppSession({ enquiryId, userId, event }) {
  if (!enquiryId) return;
  try {
    await recordLeadActivity(
      enquiryId,
      [{
        action: event === "linked" ? "WHATSAPP_LINKED" : "WHATSAPP_LOGGED_OUT",
        field: "whatsapp",
        fieldLabel: "WhatsApp",
        toValue: event === "linked" ? "Linked" : "Logged out",
      }],
      { actorUserId: Number(userId) || null, source: "whatsapp" },
    );
  } catch (error) {
    console.warn("WhatsApp session activity not logged:", error.message);
  }
}

async function logWhatsAppActivity({ enquiryId, userId, direction, mediaType }) {
  const kind = mediaType ? `${mediaType.charAt(0).toUpperCase()}${mediaType.slice(1)}` : "Text message";
  try {
    await recordLeadActivity(
      enquiryId,
      [{
        action: direction === "in" ? "WHATSAPP_RECEIVED" : "WHATSAPP_SENT",
        field: "whatsapp",
        fieldLabel: "WhatsApp",
        toValue: kind,
      }],
      { actorUserId: Number(userId) || null, source: "whatsapp" },
    );
  } catch (error) {
    console.warn("WhatsApp activity not logged:", error.message);
  }
}

/**
 * What the socket delivered, and what became of it.
 *
 * Off unless WHATSAPP_DEBUG=1. A message that does not reach the thread is otherwise invisible -
 * it is dropped inside an event handler, and the only honest way to tell a message that never
 * arrived from one that arrived and was discarded is to write down both.
 */
/**
 * Identifiers, shortened to something that can be compared but not used.
 *
 * A trace has to be able to say "these two lines are the same conversation", which needs a stable
 * handle - and a phone number written into a log file is the client's personal data sitting in
 * plain text on a server, readable by anyone who can read logs and outliving the conversation it
 * describes. So what goes in the file is a keyed digest: the same number always gives the same
 * short tag, and the tag cannot be turned back into the number without the key.
 */
function traceTag(value) {
  const text = String(value || "");
  if (!text) return "";
  return crypto.createHmac("sha256", traceSalt()).update(text).digest("hex").slice(0, 10);
}

let cachedTraceSalt = null;
function traceSalt() {
  // Per process. A log carried off the server cannot be matched back to numbers even by someone
  // who guesses the format, because the salt died with the process that wrote it.
  if (!cachedTraceSalt) cachedTraceSalt = crypto.randomBytes(32);
  return cachedTraceSalt;
}

// What a trace is allowed to carry. Anything not named here is dropped rather than trusted to be
// harmless: message bodies, captions, whole message objects and credentials have all been one
// careless spread away from the log file.
const TRACE_SAFE_KEYS = ["why", "history", "type", "count", "fromMe", "mediaType", "stub", "keys", "target", "reason"];

function safeTraceDetail(detail = {}) {
  const safe = {};
  for (const key of TRACE_SAFE_KEYS) {
    if (detail[key] !== undefined) safe[key] = detail[key];
  }
  // The two identifiers worth keeping, in a form that cannot be dialled or looked up.
  if (detail.jid) safe.chat = traceTag(detail.jid);
  if (detail.phone) safe.contact = traceTag(detail.phone);
  if (detail.enquiryId) safe.enquiryId = detail.enquiryId;
  return safe;
}

/**
 * What the socket delivered, and what became of it.
 *
 * Off unless WHATSAPP_DEBUG=1, and never on in production. A message that does not reach the
 * thread is otherwise invisible - it is dropped inside an event handler, and the only honest way
 * to tell a message that never arrived from one that arrived and was discarded is to write down
 * both. What it may write down is deliberately narrow: no message content, no phone numbers, no
 * credentials, and no whole message objects.
 */
function trace(event, detail) {
  if (process.env.WHATSAPP_DEBUG !== "1") return;
  try {
    const file = path.join(sessionRoot(), "debug.log");
    require("fs").appendFileSync(
      file,
      JSON.stringify({ at: new Date().toISOString(), event, ...safeTraceDetail(detail) }) + "\n",
      { mode: 0o600 },
    );
  } catch {
    // Diagnostics must never break the thing they are diagnosing.
  }
}

function blankSession(userId) {
  return {
    userId,
    status: "disconnected",
    qr: "",
    phone: "",
    error: "",
    socket: null,
    starting: false,
    /*
     * Which socket the session is currently listening to.
     *
     * Baileys reports one disconnect through more than one `connection.update`, and a socket that
     * has closed can still emit. Every handler captures the id it was created with and does nothing
     * unless it is still the live one - so a second close for a socket already replaced is ignored
     * rather than scheduling a second reconnect onto the same credentials.
     */
    socketId: 0,
    /*
     * The one pending reconnect, so there can only ever be one.
     *
     * The delay used to be an `await` inside the close handler: no handle, so nothing could cancel
     * it. Two closes meant two sleeping reconnects that both woke up and opened a socket, and a
     * restart left them firing into a process on its way out.
     */
    reconnectTimer: null,
    closed: false,
  };
}

/** The next socket id. Monotonic across every session, so ids are never reused after a restart. */
let nextSocketId = 1;

/*
 * ── Answering a device that could not read what this one sent ─────────────────────────────────
 *
 * Every message a linked device sends is encrypted again for each of the account's other devices -
 * the phone, WhatsApp Web - and for the recipient's. A device that cannot decrypt its copy asks the
 * sender to send it again (a retry receipt), and shows "Waiting for this message. Learn more" until
 * it is answered. `getMessage` below is the answer, and it used to read only the CRM's own table: a
 * message that is not kept there (Interview Welcome, a group message, a login handed over) was
 * declined, and one kept there only after `sendMessage` returned could be asked for first - so the
 * sender's own phone and Web showed the placeholder for good, though the recipient had it.
 *
 * So every message sent is remembered here, by id, for a day: the message itself, as WhatsApp
 * needs it re-sent. Memory only - nothing is written, and a restart forgets it, after which the
 * CRM's table still answers for its own. Bounded, so a busy day cannot grow it without limit.
 */
const SENT_CACHE_MS = 24 * 60 * 60 * 1000;
const SENT_CACHE_MAX = 5000;
const recentlySent = new Map();

function rememberSent(sent) {
  const id = sent?.key?.id;
  if (!id || !sent.message) return;
  recentlySent.set(id, { message: sent.message, at: Date.now() });
  if (recentlySent.size > SENT_CACHE_MAX) recentlySent.delete(recentlySent.keys().next().value);
}

function recallSent(id) {
  const entry = recentlySent.get(id);
  if (!entry) return undefined;
  if (Date.now() - entry.at > SENT_CACHE_MS) { recentlySent.delete(id); return undefined; }
  return entry.message;
}

/*
 * How many times each message has been asked for again - what Baileys reads to stop retrying a
 * message for ever. Its `CacheStore` shape (get / set / del / flushAll), held in memory per socket.
 */
function retryCounterCache() {
  const store = new Map();
  return {
    get: (key) => store.get(key),
    set: (key, value) => { store.set(key, value); },
    del: (key) => { store.delete(key); },
    flushAll: () => { store.clear(); },
  };
}

const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/**
 * Takes a socket out of service: no more events, no more websocket.
 *
 * Dropping the reference is not enough. The old socket keeps its listeners and its connection, so
 * without this it goes on reporting closes - into a session that has already moved on - and each of
 * those used to start another reconnect.
 */
function teardownSocket(socket) {
  if (!socket) return;
  try {
    socket.ev?.removeAllListeners?.();
  } catch {
    // Already gone. Nothing to detach.
  }
  try {
    // `end` is Baileys' own close. It throws if the websocket is already down, which is fine: the
    // point of calling it is to make sure it is.
    socket.end?.(undefined);
  } catch {
    // Already closed.
  }
}

/** Cancels a pending reconnect, so a new one - or a shutdown - cannot race it. */
function cancelReconnect(session) {
  if (!session.reconnectTimer) return;
  clearTimeout(session.reconnectTimer);
  session.reconnectTimer = null;
}

/**
 * Schedules the one reconnect this session is allowed.
 *
 * Any pending one is cancelled first, so however many closes arrive, exactly one socket is opened.
 * The timer is `unref`ed: a WhatsApp session waiting to retry is not a reason to keep the process
 * alive, and holding one open is what made a nodemon restart leave two backends fighting.
 */
function scheduleReconnect(session, delayMs) {
  cancelReconnect(session);
  session.reconnectTimer = setTimeout(() => {
    session.reconnectTimer = null;
    if (session.closed) return;
    void startSession(session.userId, { internal: true }).catch((error) => {
      session.status = "disconnected";
      session.error = error?.message || "WhatsApp reconnection failed.";
    });
  }, delayMs);
  session.reconnectTimer.unref?.();
}

function getSession(userId) {
  const key = String(userId);
  if (!sessions.has(key)) sessions.set(key, blankSession(key));
  return sessions.get(key);
}

function publicState(session) {
  return {
    status: session.status,
    qr: session.status === "pairing" ? session.qr : "",
    phone: session.phone,
    error: session.error,
  };
}

function textFromMessage(message) {
  const content = message?.message || {};
  return (
    content.conversation ||
    content.extendedTextMessage?.text ||
    content.imageMessage?.caption ||
    content.videoMessage?.caption ||
    content.documentMessage?.caption ||
    ""
  );
}

/**
 * The message a message is replying to, as WhatsApp attaches it.
 *
 * It travels in the context of the reply itself - the quoted text and who wrote it - so the
 * thread can draw the same block WhatsApp draws above a reply, without going back to look the
 * original up.
 */
function quotedFromMessage(message) {
  const content = message?.message || {};
  const context =
    content.extendedTextMessage?.contextInfo ||
    content.imageMessage?.contextInfo ||
    content.videoMessage?.contextInfo ||
    content.documentMessage?.contextInfo ||
    content.audioMessage?.contextInfo ||
    null;
  const quoted = context?.quotedMessage;
  if (!quoted) return {};

  const body =
    quoted.conversation ||
    quoted.extendedTextMessage?.text ||
    quoted.imageMessage?.caption ||
    quoted.videoMessage?.caption ||
    (quoted.imageMessage && "[image]") ||
    (quoted.videoMessage && "[video]") ||
    (quoted.audioMessage && "[audio]") ||
    (quoted.documentMessage && "[document]") ||
    "";
  if (!body) return {};

  // Ours or theirs: the participant is the account that wrote the quoted message.
  const author = String(context.participant || "").startsWith(String(message?.key?.remoteJid || "").split("@")[0])
    ? ""
    : "You";
  return { quotedBody: body, quotedAuthor: message?.key?.fromMe ? author : "" };
}

function mediaTypeFromMessage(message) {
  const content = message?.message || {};
  if (content.imageMessage) return "image";
  if (content.videoMessage) return "video";
  if (content.audioMessage) return "audio";
  if (content.documentMessage) return "document";
  if (content.stickerMessage) return "sticker";
  return "";
}

/**
 * Stores one message from the socket, if it belongs to a lead.
 *
 * Both directions come through here. WhatsApp echoes back what this app sends - and what the
 * same user sends from their phone to the same client, which belongs in the thread just as
 * much: the conversation is the conversation, wherever the CRM happened to be typing.
 */
async function recordSocketMessage(session, message, { history = false } = {}) {
  const jid = message?.key?.remoteJid;
  if (!isDirectChat(jid)) {
    trace("dropped", { why: "not a one-to-one chat", jid, history });
    return;
  }

  /*
   * The number, from the key rather than from the address.
   *
   * A LID-addressed message carries the phone number alongside it, and the lead is found by
   * number. Replayed history often carries less than a live message does - the chat address and
   * little else - so the LID is looked up in what has been learned about it before giving up.
   */
  const phone =
    phoneFromMessageKey(message.key)
    || (jid.endsWith("@s.whatsapp.net") ? phoneFromJid(jid) : "")
    || phoneForLid(jid);
  if (!phone) {
    trace("dropped", { why: "no phone number on the message", jid, history, keys: Object.keys(message.key || {}) });
    return;
  }

  /*
   * Some messages are about another message rather than being one.
   *
   * A reaction and a delete both arrive as their own message pointing at the one they act on -
   * so they are applied to that message and go no further. They were being discarded as "nothing
   * readable", which is why an emoji a client put on a message never appeared and a message they
   * deleted stayed in the thread.
   */
  const reaction = message.message?.reactionMessage;
  if (reaction?.key?.id) {
    await setReaction(reaction.key.id, reaction.text || "");
    trace("reaction", { jid, target: reaction.key.id, emoji: reaction.text || "(removed)" });
    return;
  }

  const revoked = message.message?.protocolMessage;
  if (revoked?.type === 0 && revoked?.key?.id) {
    await markRevoked({ waMessageId: revoked.key.id });
    trace("revoked", { jid, target: revoked.key.id });
    return;
  }

  // An edit is the same message said differently, so it replaces what that message says rather
  // than arriving underneath it as a second one.
  const edited = message.message?.editedMessage?.message?.protocolMessage;
  if (edited?.key?.id && edited?.editedMessage) {
    const text = edited.editedMessage.conversation || edited.editedMessage.extendedTextMessage?.text || "";
    const stored = await findMessageByWaId(edited.key.id);
    if (stored?.id && text) {
      await updateBody(stored.id, text);
      trace("edited", { jid, target: edited.key.id });
      return;
    }
  }

  const body = textFromMessage(message);
  const mediaType = mediaTypeFromMessage(message);
  if (!body && !mediaType) {
    // Nothing readable in it. Usually a receipt, or a message this device could not decrypt -
    // the last of which WhatsApp resends, so it is not lost by being skipped here.
    trace("dropped", { why: "no readable content", jid, history, keys: Object.keys(message?.message || {}), stub: message?.messageStubType });
    return;
  }

  const enquiryId = await leadIdForPhone(phone);
  if (!enquiryId) {
    trace("dropped", { why: "not a CRM lead", jid, history, phone });
    return;
  }
  trace("stored", { jid, phone, enquiryId, fromMe: Boolean(message?.key?.fromMe), history, mediaType });

  /*
   * The message only - never the file it carries.
   *
   * The studio's phone already holds every file a client sends, so the CRM keeps no copy. What it
   * keeps is the message as WhatsApp delivered it, which is what View and Download need to fetch
   * the file from WhatsApp at the moment somebody asks (see `mediaOnDemand.js`).
   */
  const stored = await saveMessage({
    enquiryId,
    userId: Number(session.userId) || null,
    // Filed under the number's own address, so a thread is one conversation however each message
    // happened to be addressed.
    chatJid: jidFor(phone) || jid,
    waMessageId: message?.key?.id || null,
    direction: message?.key?.fromMe ? "out" : "in",
    body,
    mediaType,
    // The name the client gave a document, so the thread can show it before anything is fetched.
    mediaName: message?.message?.documentMessage?.fileName || message?.message?.audioMessage?.fileName || "",
    // Only for a message carrying a file: it holds the file's address and key on WhatsApp, which is
    // all View and Download have to go on.
    rawMessage: mediaType ? message : undefined,
    ...quotedFromMessage(message),
    status: deliveryStatus(message?.status) || (message?.key?.fromMe ? "sent" : "delivered"),
    sentAt: message?.messageTimestamp ? new Date(Number(message.messageTimestamp) * 1000) : new Date(),
  });

  // Only a message that was genuinely new, and never the history WhatsApp replays on linking -
  // a year of old conversation is not a year of activity that happened today.
  if (stored && !history) {
    await logWhatsAppActivity({
      enquiryId,
      userId: session.userId,
      direction: message?.key?.fromMe ? "out" : "in",
      mediaType,
    });
  }
}

/**
 * Opens the socket and keeps the session's state in step with it.
 *
 * Baileys reports everything through one `connection.update` stream: the QR to show while it
 * waits to be scanned, the open connection once it has been, and the close with a reason on
 * the way out. A close that is not a logout is a dropped connection and reconnects itself; a
 * logout means the pairing was revoked - from the phone, usually - and the credentials are
 * cleared so the next attempt asks for a fresh scan rather than retrying a dead login.
 */
async function openSocket(session) {
  const { default: makeWASocket, fetchLatestBaileysVersion, Browsers } =
    require("@whiskeysockets/baileys");

  const dir = sessionDir(session.userId);
  // 0700 from the moment it exists: everything written here is private key material, and a
  // directory created world-readable stays that way long enough to be copied.
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  // Baileys' own useMultiFileAuthState writes all of this as plain JSON. Same contract, sealed
  // with AES-256-GCM under the key in the environment - see secureAuthState.js.
  const { state, saveCreds } = await useEncryptedAuthState(dir);
  const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: undefined }));

  /*
   * Ask for the whole conversation, every time.
   *
   * WhatsApp pushes a device's history when that device is linked, and only then - a reconnect of
   * an already-linked device is served nothing, however it asks. So the request has to be made at
   * pairing, which is also the one moment WhatsApp has been seen to refuse it: the socket closes
   * with a 428 and no code is issued.
   *
   * Both are handled rather than chosen between. The request is made; if it is refused, the close
   * below drops it and comes straight back without it, so the worst case is the pairing that used
   * to happen anyway and the best case is the conversation arriving with it.
   */
  const askForHistory = !session.fullHistoryRefused;
  session.askedForHistory = askForHistory;

  const socket = makeWASocket({
    version,
    auth: state,
    // The pairing is shown in the browser, so nothing is printed into the server's logs.
    printQRInTerminal: false,
    // The device signature a linked desktop actually sends. An invented one is the sort of
    // difference that makes an account stand out from the millions of ordinary ones.
    browser: Browsers.macOS("Desktop"),
    // Never while pairing - that request is what gets a registration refused - and yes once the
    // account is registered, which is when it brings back the conversation from before the link.
    syncFullHistory: askForHistory,
    // A linked device that announces itself online steals notifications from the phone. This one
    // is a window onto the conversation, not a replacement for it.
    markOnlineOnConnect: false,
    /*
     * What to hand back when WhatsApp asks for a message again.
     *
     * A device that cannot answer a retry request loses the message: the sender re-encrypts only
     * when asked, and asking is what this callback answers. Ours are in the CRM's own table, so
     * an outgoing message can be produced from there; anything else is declined rather than
     * guessed at.
     */
    getMessage: async (key) => {
      // What this device sent, as it sent it - and a moment's wait for one asked for before the
      // send that made it has finished. Then the CRM's own table, for anything older than memory.
      const remembered = recallSent(key?.id) || (key?.fromMe ? (await wait(1500), recallSent(key?.id)) : undefined);
      if (remembered) return remembered;
      try {
        const stored = await findMessageByWaId(key?.id);
        return stored?.body ? { conversation: stored.body } : undefined;
      } catch {
        return undefined;
      }
    },
    // Counts the times a message has been asked for again, so a device that never can read it is
    // not answered for ever.
    msgRetryCounterCache: retryCounterCache(),
  });
  /*
   * Every send through this socket is remembered for `getMessage` above - one place rather than a
   * line beside each of the module's sends, so a send added later is answered for too.
   */
  const sendMessage = socket.sendMessage.bind(socket);
  socket.sendMessage = async (...args) => {
    const sent = await sendMessage(...args);
    rememberSent(sent);
    return sent;
  };
  /*
   * This socket's claim on the session.
   *
   * Taken before any handler is attached, so every one of them closes over the id it belongs to.
   * The moment a newer socket takes the claim, this one's events are ignored - which is what stops
   * a dead socket from reconnecting on behalf of a live one.
   */
  const socketId = nextSocketId++;
  const isCurrent = () => session.socketId === socketId && !session.closed;

  // The socket being replaced is put out of service rather than merely forgotten.
  teardownSocket(session.socket);
  session.socket = socket;
  session.socketId = socketId;

  socket.ev.on("creds.update", () => {
    // Loud rather than a warning among warnings. Credentials that cannot be written mean the
    // pairing cannot survive - it will appear to work and then be gone at the next restart - and
    // the message says which of the two it is so nobody has to guess from a QR timeout.
    void saveCreds().catch((error) => {
      session.error = "WhatsApp linked, but this server could not store the session. Tell an administrator before pairing again.";
      console.error("[whatsapp] Credentials NOT saved - the pairing will not survive a restart:", error.message);
    });
  });

  socket.ev.on("connection.update", (update) => {
    void (async () => {
      try {
        // A socket that has been replaced still emits. Its updates are about a connection nobody
        // is using any more, and acting on them is how two sockets came to exist at once.
        if (!isCurrent()) return;
        if (update.qr) {
          session.status = "pairing";
          session.error = "";
          session.qr = await QRCode.toDataURL(update.qr, { margin: 1, width: 320 });
        }
        if (update.connection === "open") {
          // Once per link, not once per reconnect: a dropped connection coming back is not a new
          // WhatsApp being linked, and the log would fill with it.
          if (session.status !== "connected" && session.linkedFromLead) {
            await logWhatsAppSession({ enquiryId: session.linkedFromLead, userId: session.userId, event: "linked" });
            session.linkedFromLead = "";
          }
          session.status = "connected";
          session.qr = "";
          session.error = "";
          session.attempts = 0;
          session.phone = phoneFromJid(socket.user?.id || "");
        }
        if (update.connection === "close") {
          await handleClose(session, update, socketId);
        }
      } catch (error) {
        console.warn("WhatsApp connection update failed:", error.message);
      }
    })();
  });

  socket.ev.on("messages.upsert", (event) => {
    void (async () => {
      trace("upsert", { type: event?.type, count: event?.messages?.length || 0 });
      for (const message of event?.messages || []) {
        try {
          await recordSocketMessage(session, message);
        } catch (error) {
          console.warn("WhatsApp message not stored:", error.message);
        }
      }
    })();
  });

  /*
   * The ticks.
   *
   * WhatsApp reports what happened to a message after it left: the server took it, the phone on
   * the other end received it, the person opened it. Each is a different tick in the thread, so
   * each is written against the message rather than left as the "sent" it started as.
   */
  socket.ev.on("messages.update", (updates) => {
    void (async () => {
      for (const item of updates || []) {
        const status = deliveryStatus(item?.update?.status);
        if (!status || !item?.key?.id) continue;
        try {
          await updateMessageStatus(item.key.id, status);
        } catch (error) {
          console.warn("WhatsApp delivery status not stored:", error.message);
        }
        // The same tick, against the activity log's row for this message - every send, not only the
        // lead threads. Forward-only there too, so a late or repeated tick changes nothing.
        try {
          await whatsappActivity.onDeliveryStatus(item.key.id, status);
        } catch (error) {
          console.warn("WhatsApp delivery status not logged:", error.message);
        }
      }
    })();
  });

  /*
   * The conversation as it already stands.
   *
   * A lead the CRM has been talking to for weeks should not open as an empty thread. WhatsApp
   * delivers its history in batches after linking, and every one of them goes through the same
   * filter as a live message: kept only if the number on the other end is a lead here.
   */
  socket.ev.on("messaging-history.set", (event) => {
    void (async () => {
      // What WhatsApp actually sent, before any of it is filtered: whether a history push happened
      // at all is the first question, and until now the log could not answer it.
      trace("history", {
        messages: event?.messages?.length || 0,
        chats: event?.chats?.length || 0,
        contacts: event?.contacts?.length || 0,
        isLatest: event?.isLatest,
        progress: event?.progress,
        syncType: event?.syncType,
      });
      for (const message of event?.messages || []) {
        try {
          await recordSocketMessage(session, message, { history: true });
        } catch (error) {
          console.warn("WhatsApp history message not stored:", error.message);
        }
      }
    })();
  });

  return socket;
}

/**
 * What to do when the socket closes, which is not one situation but four.
 *
 * The one that made the CRM read disconnected a second after a successful scan is the first:
 * WhatsApp ends the stream immediately after pairing and expects the client to come straight
 * back with the credentials it just issued. Treated as a failure - or reconnected without
 * distinguishing it from the others - the link looks dead here while the phone still lists the
 * device, which is exactly what it did.
 */
async function handleClose(session, update, socketId) {
  /*
   * One close is acted on per socket, and only from the socket that still holds the session.
   *
   * Baileys reports a single disconnect through more than one update - a stream error, then the
   * websocket closing behind it - and a socket that has already been replaced can report one too.
   * Every one of those used to run this whole function, and every run scheduled a reconnect: one
   * drop, several sockets, and WhatsApp settling it with `440 replaced`, which closed a socket,
   * which scheduled another reconnect. That is the loop.
   */
  if (session.socketId !== socketId || session.closed) return;

  const statusCode = update.lastDisconnect?.error?.output?.statusCode;
  // Kept and reported: a link that will not stay up is unfixable from the panel if the panel
  // cannot say what WhatsApp objected to.
  session.lastClose = [statusCode, update.lastDisconnect?.error?.message].filter(Boolean).join(" ");
  console.warn(`[whatsapp] connection closed for user ${session.userId}: ${session.lastClose || "no reason given"}`);

  // This socket is finished either way. Put it out of service before deciding what comes next, so
  // nothing it emits from here on can be mistaken for the live connection.
  teardownSocket(session.socket);
  session.socket = null;
  session.socketId = 0;
  session.qr = "";
  // Whatever was already pending belonged to an older close and has been superseded by this one.
  cancelReconnect(session);

  const decision = decideOnClose({
    statusCode,
    hasCredentials: await hasCredentials(session.userId),
    askedForHistory: session.askedForHistory,
    fullHistoryRefused: session.fullHistoryRefused,
    attempts: session.attempts || 0,
    lastClose: session.lastClose,
  });

  if (decision.action === "retry-without-history") {
    /*
     * Refused while asking for the history: ask for less, immediately.
     *
     * Remembered, so the next reconnect does not walk into the same refusal. Costs the backfill and
     * keeps the link, which is the right way round.
     */
    session.fullHistoryRefused = true;
    session.attempts = 0;
    session.status = "connecting";
    session.error = "";
    console.warn(`[whatsapp] history sync refused for user ${session.userId}; reconnecting without it`);
    scheduleReconnect(session, 0);
    return;
  }

  if (decision.action === "clear-credentials") {
    /*
     * Logged out from the phone. The credentials are dead and keeping them would only produce a
     * login loop against an account that has revoked this device.
     *
     * This is the only path that removes a stored session. A timeout, a refused request or a
     * replacement leaves it exactly where it is - none of those means the pairing is invalid, and
     * deleting it would cost a scan to recover from something that fixes itself.
     */
    session.status = "disconnected";
    session.phone = "";
    session.attempts = 0;
    await fs.rm(sessionDir(session.userId), { recursive: true, force: true }).catch(() => {});
    // A new pairing asks for the history again: whatever made WhatsApp refuse it last time is not
    // a permanent property of the account.
    session.fullHistoryRefused = false;
    session.error = decision.error;
    return;
  }

  if (decision.action === "stop") {
    session.status = "disconnected";
    if (decision.resetAttempts) session.attempts = 0;
    session.error = decision.error;
    return;
  }

  session.attempts = decision.attempts;
  session.status = "connecting";
  session.error = "";
  scheduleReconnect(session, decision.delayMs);
}

/**
 * Starts pairing, or does nothing if this user is already connected.
 *
 * Guarded against a second start while the first is still opening: the panel polls for the QR,
 * and every poll landing on a half-open socket would leave a pile of them behind, each with its
 * own event handlers writing the same messages.
 */
async function startSession(userId, { internal = false, fromLead = "" } = {}) {
  const session = getSession(userId);
  // Remembered rather than logged now: the link is not made until WhatsApp says it is open.
  if (fromLead) session.linkedFromLead = fromLead;

  /*
   * Refused here, before a socket is opened, when there is nowhere safe to put the result.
   *
   * Without the key nothing can be persisted: Baileys pairs, tries to save, fails silently, and
   * the pairing dies at the QR timeout reading "WhatsApp did not answer" - which sends whoever
   * sees it looking at their phone, their network and WhatsApp itself for a fault that is in the
   * server's configuration. Worse, each attempt is a real registration, and a run of them is what
   * makes WhatsApp stop issuing codes to this number at all. So this says what is actually wrong
   * and costs the account nothing.
   */
  if (!hasEncryptionKey()) {
    session.status = "disconnected";
    session.qr = "";
    session.error = "WhatsApp is not configured on this server: the session encryption key is missing. Ask an administrator to set WHATSAPP_SESSION_ENCRYPTION_KEY and restart.";
    console.error("[whatsapp] Pairing refused: WHATSAPP_SESSION_ENCRYPTION_KEY is missing or invalid. Sessions cannot be stored.");
    return publicState(session);
  }

  /*
   * A new code is not something to ask for repeatedly.
   *
   * Each unpaired connection is a registration attempt, and WhatsApp stops issuing codes to a
   * client that makes a run of them. The button can be pressed as often as anyone likes; it
   * reaches WhatsApp at the pace an ordinary client would.
   *
   * Reconnects are exempt, and have to be. WhatsApp ends the stream the instant a code is
   * scanned and expects the client back immediately - hold that back behind this gap and a scan
   * that lands inside it never finishes pairing at all.
   */
  if (!internal && session.lastConnectAt && Date.now() - session.lastConnectAt < MIN_CONNECT_GAP_MS) {
    return publicState(session);
  }
  // One socket per account, always. Two sockets on one set of credentials is a conflict WhatsApp
  // resolves by closing them - and a second Connect press, or the panel polling while the code is
  // on screen, was enough to open one.
  if (session.socket) return publicState(session);
  if (session.starting) return publicState(session);

  /*
   * A start supersedes whatever was waiting to reconnect.
   *
   * Without this, pressing Connect while a backoff was sleeping opened one socket now and another
   * when the timer woke - the two-sockets-one-credential case that WhatsApp answers with 440.
   */
  cancelReconnect(session);
  session.closed = false;

  session.starting = true;
  session.lastConnectAt = Date.now();
  session.error = "";
  try {
    session.status = "pairing";
    await openSocket(session);
  } catch (error) {
    session.status = "disconnected";
    session.qr = "";
    session.error = error?.message || "Unable to start WhatsApp.";
    throw error;
  } finally {
    session.starting = false;
  }
  return publicState(session);
}

/**
 * Puts every session down cleanly, for a restart.
 *
 * nodemon starts the new process before the old one has finished dying. While both are up they hold
 * the same credentials, and WhatsApp settles that with `440 replaced` - which the surviving process
 * reads as "somebody took the session", because from where it stands somebody did. Ending the
 * sockets here means the old process has let go before the new one asks.
 *
 * `closed` stops any handler that fires during the teardown from starting something new.
 */
async function shutdownSessions() {
  for (const session of sessions.values()) {
    session.closed = true;
    cancelReconnect(session);
    teardownSocket(session.socket);
    session.socket = null;
    session.socketId = 0;
    session.status = "disconnected";
  }
}

function sessionState(userId) {
  return publicState(getSession(userId));
}

/**
 * Unlinks this user's WhatsApp.
 *
 * The logout is told to WhatsApp first so the entry disappears from Linked Devices on the
 * phone, and the credentials are removed either way - a logout that could not be delivered
 * must still not leave a usable login sitting on the server.
 */
async function logoutSession(userId, { fromLead = "" } = {}) {
  const session = getSession(userId);
  await logWhatsAppSession({ enquiryId: fromLead, userId, event: "logged-out" });
  try {
    await session.socket?.logout();
  } catch (error) {
    console.warn("WhatsApp logout not delivered:", error.message);
  }
  try {
    session.socket?.end?.(undefined);
  } catch {
    // Already closed.
  }
  await fs.rm(sessionDir(userId), { recursive: true, force: true }).catch(() => {});
  sessions.set(String(userId), blankSession(String(userId)));
  return sessionState(userId);
}

/**
 * Sends one message to a lead, and records it.
 *
 * The stored copy is written here rather than left to the echo the socket will send back,
 * so the message appears in the thread as soon as it is sent instead of whenever WhatsApp
 * gets round to repeating it. The echo carries the same id and is ignored on arrival.
 */
/*
 * The four rules every outgoing message obeys, text or file alike.
 *
 * WhatsApp does not read messages to decide who is a nuisance; it reads behaviour. The patterns
 * that get an account restricted are the ones a person cannot produce: messages fired within
 * milliseconds of each other, numbers that turn out not to be on WhatsApp at all, a client that
 * never types and never reads. They are separate functions so that a second way to send - an
 * attachment, and whatever comes after it - cannot quietly skip them.
 *
 * None of it is a guarantee. This is not an official WhatsApp API, and an account paired this way
 * can always be blocked; what these do is remove the signals that invite it.
 */
function requireConnected(userId) {
  const session = getSession(userId);
  if (session.status !== "connected" || !session.socket) {
    const error = new Error("WhatsApp is not connected. Scan the QR code to link your WhatsApp.");
    error.status = 409;
    error.code = "WHATSAPP_NOT_CONNECTED";
    throw error;
  }
  return session;
}

function requireJid(phone) {
  const jid = jidFor(phone);
  if (!jid) {
    const error = new Error("This lead has no WhatsApp number to send to.");
    error.status = 400;
    throw error;
  }
  return jid;
}

// Never faster than a person writing to a client one at a time.
async function pace(session) {
  const wait = session.lastSentAt ? MIN_SEND_GAP_MS - (Date.now() - session.lastSentAt) : 0;
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
}

// A number that is not on WhatsApp is the clearest sign of a list being worked through rather
// than a conversation being had, and it is worth telling the user about anyway.
async function confirmOnWhatsApp(session, jid) {
  try {
    const results = await session.socket.onWhatsApp(jid);

    /*
     * An empty list is the answer "nobody is registered with this number".
     *
     * Baileys returns only the users it found, so a number with no WhatsApp account produces
     * `[]` rather than `{ exists: false }`. Waiting for an explicit `false` therefore never
     * refused anything: messages went out to numbers that could not receive them, came back with
     * a single tick, and looked delivered.
     *
     * A missing list - Baileys answering `undefined` because the query failed - is genuinely
     * unknown, and must not stop a real message.
     */
    if (!Array.isArray(results)) return;

    const [check] = results;
    if (check?.lid) rememberLid(check.lid, phoneFromJid(jid));
    if (results.length === 0 || check?.exists === false) {
      const error = new Error("This number is not on WhatsApp, so nothing can be sent to it.");
      error.status = 400;
      error.code = "NOT_ON_WHATSAPP";
      throw error;
    }
  } catch (error) {
    if (error.code === "NOT_ON_WHATSAPP") throw error;
    // The check itself failing is not the client's fault, and must not stop a real message.
    console.warn("WhatsApp number check skipped:", error.message);
  }
}

/*
 * Whether a number is on WhatsApp, remembered so it is asked once rather than constantly.
 *
 * The chat panel polls its thread about once a second. Asking WhatsApp about the number on every
 * one of those is precisely the automated pattern this module exists to avoid - so an answer is
 * kept for an hour, and a number is only ever asked about while a session is actually connected.
 *
 * A negative answer is worth keeping just as long as a positive one: a client who is not on
 * WhatsApp today is not on it a minute later either, and re-asking would be the same rudeness.
 */
const NUMBER_CHECK_TTL_MS = 60 * 60 * 1000;
const numberChecks = new Map();

function cachedNumberCheck(phone) {
  const entry = numberChecks.get(phone);
  if (!entry || entry.at <= Date.now() - NUMBER_CHECK_TTL_MS) return null;
  return entry.onWhatsApp;
}

/**
 * Whether this lead's number can be messaged at all.
 *
 * `true` it is on WhatsApp, `false` it is not, and `null` when the question could not be put -
 * no session, no number, or WhatsApp did not answer. Null is deliberately not `false`: refusing
 * to let a CRM chat because a check failed would be worse than letting the send find out.
 */
async function numberOnWhatsApp(userId, phone) {
  const digits = normalizePhone(phone);
  if (!digits) return null;

  const remembered = cachedNumberCheck(digits);
  if (remembered !== null) return remembered;

  const session = sessions.get(String(userId));
  // Only a live socket can ask, and only a connected one should: a session still pairing has
  // enough to do.
  if (!session?.socket || session.status !== "connected") return null;

  try {
    const results = await session.socket.onWhatsApp(jidFor(digits));

    /*
     * An empty list means the number has no WhatsApp account.
     *
     * Baileys filters its answer down to the users it found - `results.list.filter(a => !!a.contact)`
     * - so a number nobody is registered with comes back as `[]`, never as `{ exists: false }`.
     * Reading the missing entry as "could not tell" is what let messages go to numbers that are
     * not on WhatsApp: the check said nothing, so nothing stopped the send.
     *
     * A missing list is different again, and is the real "could not tell": Baileys returns
     * `undefined` when the query itself got no answer.
     */
    if (!Array.isArray(results)) return null;

    const [check] = results;
    if (check?.lid) rememberLid(check.lid, digits);
    const answer = results.length > 0 && check?.exists !== false;
    numberChecks.set(digits, { onWhatsApp: answer, at: Date.now() });
    return answer;
  } catch (error) {
    console.warn("WhatsApp number check skipped:", error.message);
    return null;
  }
}

// Type into the chat first, the way the conversation would go if this were the phone.
async function showTyping(session, jid) {
  try {
    await session.socket.sendPresenceUpdate("composing", jid);
    await new Promise((resolve) => setTimeout(resolve, TYPING_MS));
    await session.socket.sendPresenceUpdate("paused", jid);
  } catch (error) {
    console.warn("WhatsApp presence not sent:", error.message);
  }
}

/**
 * Sends one message to a lead, and records it.
 *
 * The stored copy is written here rather than left to the echo the socket will send back, so the
 * message appears in the thread as soon as it is sent instead of whenever WhatsApp gets round to
 * repeating it. The echo carries the same id and is ignored on arrival.
 */
async function sendMessageToLead({ userId, enquiryId, phone, body }) {
  const session = requireConnected(userId);
  const jid = requireJid(phone);

  const text = String(body || "").trim();
  if (!text) {
    const error = new Error("Write a message before sending.");
    error.status = 400;
    throw error;
  }

  await pace(session);
  await confirmOnWhatsApp(session, jid);
  await showTyping(session, jid);

  const sent = await session.socket.sendMessage(jid, { text });
  session.lastSentAt = Date.now();
  const stored = await saveMessage({
    enquiryId,
    userId: Number(userId) || null,
    chatJid: jid,
    waMessageId: sent?.key?.id || null,
    direction: "out",
    body: text,
    status: "sent",
    sentAt: new Date(),
  });
  if (stored) await logWhatsAppActivity({ enquiryId, userId, direction: "out", mediaType: "" });
  return { waMessageId: sent?.key?.id || "", chatJid: jid };
}

/**
 * Sends one message to a person who is not a lead, and records nothing.
 *
 * The studio writes to two kinds of stranger: a client, who is a lead and whose every message
 * belongs in that lead's thread, and somebody the studio is **employing** - a candidate handed an
 * onboarding link, a new joiner handed their login. The second has no lead, no enquiry id and no
 * thread to belong to, and inventing one would put a colleague's private credentials into the CRM
 * beside the clients.
 *
 * So this is `sendMessageToLead` without the half that files it: same pacing, same check that the
 * number is on WhatsApp at all, same typing indicator. Those three are not decoration - they are
 * what keeps the studio's paired number looking like a person writing to one person at a time,
 * which is the whole of why this module is allowed to exist. A second send path that skipped them
 * would be the one that gets the number banned.
 *
 * Nothing is stored, so nothing here can be read back: the caller is the one that knows what it
 * sent and is the one that records it, the way the onboarding invite records that it went out.
 */
async function sendMessageToPerson({ userId, phone, body }) {
  const session = requireConnected(userId);
  const jid = requireJid(phone);

  const text = String(body || "").trim();
  if (!text) {
    const error = new Error("Write a message before sending.");
    error.status = 400;
    throw error;
  }

  await pace(session);
  await confirmOnWhatsApp(session, jid);
  await showTyping(session, jid);

  const sent = await session.socket.sendMessage(jid, { text });
  session.lastSentAt = Date.now();
  return { waMessageId: sent?.key?.id || "", chatJid: jid };
}

/*
 * ── Groups ───────────────────────────────────────────────────────────────────────────────────
 *
 * Image Selection sends a gallery invite into the project's WhatsApp group - the one the studio
 * already runs with the client - from whichever coordinator pressed Send, on their own paired
 * number. The Attendance Register's daily report goes into its linked group the same way, on a clock
 * rather than a button (`hrm/attendance/reportGroup.js`), from whoever linked it. Those are the places
 * this module addresses a group, and they are deliberately narrow: a group is written to, never read. `isDirectChat` still keeps every group message out of the lead
 * threads, and nothing here records what a group says back.
 */

// A WhatsApp group's address and nothing else: "120363012345678901@g.us", or the older
// "<creator>-<timestamp>@g.us". Checked before a socket sees it, because sendMessage would take a
// person's jid here just as happily and turn a group invite into a message to a stranger.
function isGroupJid(jid) {
  return typeof jid === "string" && /^[0-9]{5,25}(-[0-9]{5,25})?@g\.us$/.test(jid);
}

/**
 * The groups this user's WhatsApp is in, by name.
 *
 * Asked of WhatsApp each time rather than remembered: it is one query, made when somebody opens
 * the picker, and a group renamed on the phone should read by its new name here.
 */
async function listGroups(userId) {
  const session = requireConnected(userId);
  const groups = await session.socket.groupFetchAllParticipating();
  return Object.values(groups || {})
    .filter((group) => isGroupJid(group?.id))
    .map((group) => ({
      jid: group.id,
      subject: String(group.subject || "").trim(),
      participantCount: Array.isArray(group.participants) ? group.participants.length : 0,
    }))
    .sort((a, b) => a.subject.localeCompare(b.subject, undefined, { sensitivity: "base" }));
}

// The bare id of a WhatsApp address - "919442548610:12@s.whatsapp.net" and "919442548610@s.whatsapp.net"
// are one person - so this account can be found among a group's members whichever form it is listed in.
const bareId = (jid) => String(jid || "").split("@")[0].split(":")[0];

/**
 * The groups this user's WhatsApp is in, each saying whether this user is one of its admins.
 *
 * For HRM's employee WhatsApp groups (`hrm/whatsapp-groups`): only an admin can add somebody to a
 * group, so that screen offers the groups this flag is true for. The account is matched by its phone
 * id and by its `lid`, the hidden id WhatsApp lists members under in newer groups.
 */
async function listAdminGroups(userId) {
  const session = requireConnected(userId);
  const own = new Set([session.socket.user?.id, session.socket.user?.lid].map(bareId).filter(Boolean));
  const groups = await session.socket.groupFetchAllParticipating();
  return Object.values(groups || {})
    .filter((group) => isGroupJid(group?.id))
    .map((group) => {
      const members = Array.isArray(group.participants) ? group.participants : [];
      const isAdmin = members.some((member) => Boolean(member?.admin)
        && [member.id, member.lid, member.phoneNumber, member.jid].some((id) => own.has(bareId(id))));
      return { jid: group.id, subject: String(group.subject || "").trim(), participantCount: members.length, isAdmin };
    })
    .sort((a, b) => a.subject.localeCompare(b.subject, undefined, { sensitivity: "base" }));
}

/**
 * Adds one phone number to a group this user administers.
 *
 * Paced like a message - adding many people to many groups in seconds is what WhatsApp bans for -
 * and the number checked first, since a number not on WhatsApp cannot be added. WhatsApp answers
 * each add with a code: 200 added, 409 already a member, and two different refusals - 403, their
 * privacy keeps a non-contact from adding them, and 408, which is what it answers for somebody who
 * **left this group recently** and is held out of it for a while whatever their privacy says. For
 * both the group's invite link comes back instead, with the code, for the caller to say which it was
 * (`whatsapp-groups/service.js` `inviteReason`) - they are not the same thing to whoever is fixing it.
 */
async function addToGroup({ userId, groupJid, phone }) {
  const session = requireConnected(userId);
  if (!isGroupJid(groupJid)) {
    throw Object.assign(new Error("This is not a WhatsApp group."), { status: 400, code: "NOT_A_GROUP" });
  }
  const jid = jidFor(phone);
  if (!jid) throw Object.assign(new Error("This employee has no mobile number to add."), { status: 400, code: "NO_NUMBER" });

  await pace(session);
  await confirmOnWhatsApp(session, jid);
  const [result] = await session.socket.groupParticipantsUpdate(groupJid, [jid], "add");
  session.lastSentAt = Date.now();
  const status = String(result?.status || "");
  if (status === "200") return { outcome: "ADDED", status };
  if (status === "409") return { outcome: "ALREADY", status };
  if (status === "403" || status === "408") {
    const code = await session.socket.groupInviteCode(groupJid);
    return { outcome: "INVITE", status, inviteLink: code ? `https://chat.whatsapp.com/${code}` : "" };
  }
  return { outcome: "FAILED", status };
}

/**
 * Takes one person out of a group this WhatsApp is an admin of.
 *
 * The mirror of `addToGroup`, and deliberately plainer: there is no invite fallback, because there
 * is no equivalent of "ask them to leave" - either WhatsApp removes them or it does not.
 *
 * `confirmOnWhatsApp` is **not** called. Adding needs it, because a number that is not on WhatsApp
 * cannot be added and saying so early is kinder than a silent failure. Removal is the opposite case:
 * somebody whose number has since left WhatsApp may still be sitting in the group as a participant,
 * and refusing to remove them because the check fails would leave them there for good.
 *
 * Answers in the same shape the add does, so the queue reads one of them the way it reads the other:
 *
 *   * **REMOVED** - WhatsApp took them out.
 *   * **NOT_IN** - they were not in the group, which is the state being asked for, so not a failure.
 *   * **NOT_ADMIN** - this WhatsApp is not an admin of the group any more. Somebody else's to do.
 *   * **FAILED** - anything else, with WhatsApp's own code kept.
 */
async function removeFromGroup({ userId, groupJid, phone }) {
  const session = requireConnected(userId);
  if (!isGroupJid(groupJid)) {
    throw Object.assign(new Error("This is not a WhatsApp group."), { status: 400, code: "NOT_A_GROUP" });
  }
  const jid = jidFor(phone);
  if (!jid) throw Object.assign(new Error("This employee has no mobile number to remove."), { status: 400, code: "NO_NUMBER" });

  await pace(session);
  const [result] = await session.socket.groupParticipantsUpdate(groupJid, [jid], "remove");
  session.lastSentAt = Date.now();
  const status = String(result?.status || "");
  if (status === "200") return { outcome: "REMOVED", status };
  // 404 is "no such participant": they are already out, which is what was wanted.
  if (status === "404" || status === "409") return { outcome: "NOT_IN", status };
  if (status === "401" || status === "403") return { outcome: "NOT_ADMIN", status };
  return { outcome: "FAILED", status };
}

/**
 * Sends one message into a group this user is a member of.
 *
 * Paced and typed like a message to a person, for the same reason those are: WhatsApp reads
 * behaviour, and a text that lands in a group the instant a button is pressed is a bot's. Not
 * written to the lead threads - a group is not a lead - and never put through `confirmOnWhatsApp`,
 * which answers for phone numbers and not for groups. Whether the caller may address this group at
 * all is the caller's question, answered against what `listGroups` returned.
 */
async function sendMessageToGroup({ userId, jid, body }) {
  const session = requireConnected(userId);
  if (!isGroupJid(jid)) {
    const error = new Error("This is not a WhatsApp group.");
    error.status = 400;
    error.code = "NOT_A_GROUP";
    throw error;
  }
  const text = String(body || "").trim();
  if (!text) {
    const error = new Error("Write a message before sending.");
    error.status = 400;
    throw error;
  }
  await pace(session);
  await showTyping(session, jid);
  const sent = await session.socket.sendMessage(jid, { text });
  session.lastSentAt = Date.now();
  return { waMessageId: sent?.key?.id || "", chatJid: jid };
}

/**
 * Marks the lead's messages read, so the client sees the blue ticks they expect.
 *
 * The other half of the ticks this app shows: a conversation open on this screen has been read,
 * and a linked device that never reads anything is both rude to the client and unlike every real
 * WhatsApp client there is.
 */
async function markThreadRead({ userId, phone, messageIds = [] }) {
  const session = getSession(userId);
  if (session.status !== "connected" || !session.socket) return;
  const jid = jidFor(phone);
  const keys = messageIds.filter(Boolean).map((id) => ({ remoteJid: jid, id, fromMe: false }));
  if (!jid || !keys.length) return;
  try {
    await session.socket.readMessages(keys);
  } catch (error) {
    console.warn("WhatsApp read receipt not sent:", error.message);
  }
}

/**
 * The Baileys content for one attachment.
 *
 * WhatsApp does not take "a file": it takes an image, a video, a voice note or a document, and
 * shows each of them differently to the person receiving it. The kind is decided from the mime
 * type the browser sent, and anything unrecognised goes as a document, which is the one form
 * that carries a file name and always arrives intact.
 */
/**
 * What to hand WhatsApp for one file.
 *
 * Audio is the awkward one. A voice note has to be OGG/Opus - the browser records `audio/webm`
 * on Chrome and `audio/mp4` on Safari, and sending either as a voice note produced something the
 * recipient could not play while the sender saw a delivered tick. So audio is converted first,
 * and only genuine OGG/Opus is ever marked `ptt`.
 *
 * `voice` says the microphone button made it rather than the file picker. Guessing that from the
 * mime type made every uploaded .ogg a voice note, which is not what someone attaching a song
 * meant.
 */
async function mediaContentFor(file, caption, { voice = false } = {}) {
  const mimetype = String(file.mimetype || "application/octet-stream");
  const fileName = String(file.originalname || "file");
  if (mimetype.startsWith("image/")) return { image: file.buffer, mimetype, caption };
  if (mimetype.startsWith("video/")) return { video: file.buffer, mimetype, caption };
  if (mimetype.startsWith("audio/")) {
    const audio = await prepareAudio(file.buffer, mimetype, { voice });
    return { audio: audio.buffer, mimetype: audio.mimetype, ptt: audio.ptt };
  }
  return { document: file.buffer, mimetype, fileName, caption };
}

function mediaTypeFor(mimetype) {
  const type = String(mimetype || "");
  if (type.startsWith("image/")) return "image";
  if (type.startsWith("video/")) return "video";
  if (type.startsWith("audio/")) return "audio";
  return "document";
}

/**
 * Sends one attachment to a lead, with the same restraint as a text message.
 *
 * The gap, the number check and the typing all still apply: a file is a message, and an account
 * that fires files off faster than a person could type is the same signal to WhatsApp as one
 * that fires off text.
 */
async function sendMediaToLead({ userId, enquiryId, phone, file, caption = "", voice = false }) {
  const session = requireConnected(userId);
  const jid = requireJid(phone);
  if (!file?.buffer?.length) {
    const error = new Error("Attach a file to send.");
    error.status = 400;
    throw error;
  }

  await pace(session);
  await confirmOnWhatsApp(session, jid);
  await showTyping(session, jid);

  const text = String(caption || "").trim();
  const sent = await session.socket.sendMessage(jid, await mediaContentFor(file, text || undefined, { voice }));
  session.lastSentAt = Date.now();

  const saved = await saveMessage({
    enquiryId,
    userId: Number(userId) || null,
    chatJid: jid,
    waMessageId: sent?.key?.id || null,
    direction: "out",
    body: text,
    mediaType: mediaTypeFor(file.mimetype),
    mediaName: file.originalname || "",
    rawMessage: sent,
    status: "sent",
    sentAt: new Date(),
  });
  if (saved) await logWhatsAppActivity({ enquiryId, userId, direction: "out", mediaType: mediaTypeFor(file.mimetype) });
  return { waMessageId: sent?.key?.id || "", chatJid: jid };
}

/**
 * A message's file, streamed from WhatsApp for View or Download and never stored.
 *
 * The owner's socket is passed only when it is already up: it is what lets WhatsApp be asked to
 * re-upload a file whose link has expired. A message from a session that is not running is still
 * fetched - asking for it must not start one.
 */
function mediaStreamFor(message) {
  const live = sessions.get(String(message?.userId));
  return openMediaStream(message, live?.socket || null);
}

/**
 * Whether each user's WhatsApp is linked right now, for the Settings table that lists them.
 *
 * Reads the sessions this process is holding, plus whether credentials are on disk: a CRM who
 * linked before the last restart is paired but not connected, and the two are different answers.
 * Nothing here reads or reports a message - only whether the line is up.
 */
async function sessionStatesFor(userIds = []) {
  const states = new Map();
  for (const userId of userIds) {
    const key = String(userId);
    const session = sessions.get(key);
    const paired = await hasCredentials(key);
    states.set(key, {
      status: session?.status || "disconnected",
      phone: session?.phone || "",
      paired,
    });
  }
  return states;
}

/**
 * Brings back the sessions that were already linked when the server last stopped.
 *
 * The credentials outlive the process; the socket does not. Without this a restart left every CRM
 * reading "not connected" here while their phone still listed the device - nothing was wrong, and
 * nothing short of pressing Connect again would say so.
 */
async function restoreSessions() {
  /*
   * Said at boot rather than at the first attempt to pair.
   *
   * Without the key nothing can be stored, so every CRM meets the same failure the first time
   * they press Link - long after whoever deployed the server has stopped watching. This is the
   * moment the configuration is wrong, so this is where it is reported.
   */
  if (!hasEncryptionKey()) {
    console.warn(
      "[whatsapp] WHATSAPP_SESSION_ENCRYPTION_KEY is not set or is not a 32-byte key. WhatsApp pairing is unavailable until it is. Generate one with: openssl rand -hex 32",
    );
  }
  if (process.env.WHATSAPP_DEBUG === "1") {
    console.warn("[whatsapp] WHATSAPP_DEBUG is on. It records which chats were handled and when - keep it off in production.");
  }

  let entries = [];
  try {
    entries = await fs.readdir(sessionRoot(), { withFileTypes: true });
  } catch {
    return 0;
  }

  let restored = 0;
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith("user-")) continue;
    const userId = entry.name.slice("user-".length);
    try {
      await fs.access(path.join(sessionDir(userId), "creds.json"));
    } catch {
      continue;
    }
    try {
      await startSession(userId);
      restored += 1;
    } catch (error) {
      console.warn(`WhatsApp session for user ${userId} not restored:`, error.message);
    }
  }
  return restored;
}

/**
 * Brings an already paired session back, the way `restoreSessions` does at boot - and nothing more.
 *
 * Connected: left alone. Never paired here (no saved login): nothing is started, because starting
 * one means a new QR registration, which only a person should ask for. Paired but not connected:
 * reconnected from the saved login, and waited on for up to `waitMs`. Answers the session's state.
 */
async function resumeSession(userId, { waitMs = 8000 } = {}) {
  if (getSession(userId).status === "connected") return publicState(getSession(userId));
  try {
    await fs.access(path.join(sessionDir(userId), "creds.json"));
  } catch {
    return { ...publicState(getSession(userId)), paired: false };
  }
  await startSession(userId);
  const until = Date.now() + waitMs;
  while (getSession(userId).status !== "connected" && Date.now() < until) {
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return publicState(getSession(userId));
}

/**
 * Asks WhatsApp for the messages before the oldest one held for a chat.
 *
 * The full sync at pairing is not an option - asking for it is what makes WhatsApp refuse to
 * register the client at all - so the conversation is pulled a page at a time instead, on
 * request, the way scrolling up a chat works. What comes back arrives through the same history
 * handler as everything else and is filtered the same way.
 */
async function loadOlderMessages({ userId, phone, oldest }) {
  const session = requireConnected(userId);
  const jid = requireJid(phone);
  if (!session.socket.fetchMessageHistory) {
    const error = new Error("This WhatsApp connection cannot fetch older messages.");
    error.status = 409;
    throw error;
  }

  // WhatsApp needs a message to count back from. Without one there is nothing here yet, and the
  // recent history it sends on linking is all there is to show.
  if (!oldest?.waMessageId) return { requested: 0 };

  const key = { remoteJid: jid, id: oldest.waMessageId, fromMe: oldest.direction === "out" };
  const timestamp = Math.floor(new Date(oldest.sentAt || Date.now()).getTime() / 1000);
  await session.socket.fetchMessageHistory(HISTORY_PAGE_SIZE, key, timestamp);
  return { requested: HISTORY_PAGE_SIZE };
}

/**
 * The key WhatsApp knows one of our stored messages by.
 *
 * Everything below acts on a message that already exists in a chat, and WhatsApp identifies those
 * by chat, id and who sent it - which is exactly what the row holds.
 */
function keyForStored(message, jid) {
  return { remoteJid: jid, id: message.waMessageId, fromMe: message.direction === "out" };
}

/**
 * The actions the thread offers on a message, each one the real thing in WhatsApp.
 *
 * Reply quotes it, react puts an emoji on it, forward sends it on to another lead, pin holds it
 * to the top of the chat and delete removes it for both sides. They go out under the same
 * restraints as any other message: this is still one person, in one conversation, at a human pace.
 */
async function actOnMessage({ userId, phone, message, action, emoji = "", body = "", toPhone = "" }) {
  // Clearing the CRM's own copy asks nothing of WhatsApp, so it must not need the link to be up.
  // Every other action reaches the client's phone and does.
  if (action === "deleteForMe") {
    await markDeleted({ id: message.id });
    return { ok: true };
  }

  const session = requireConnected(userId);
  const jid = requireJid(phone);
  if (!message?.waMessageId) {
    const error = new Error("This message cannot be acted on.");
    error.status = 400;
    throw error;
  }
  const key = keyForStored(message, jid);

  /*
   * Each of these is done in both places, and both are needed.
   *
   * WhatsApp is told, so the client sees it on their phone; the CRM's own copy is updated, so the
   * thread shows it here. Doing only the first is what made these look broken - the emoji reached
   * the client and the deleted message stayed on screen, because nothing had changed in the row
   * the thread is drawn from.
   */
  if (action === "react") {
    await session.socket.sendMessage(jid, { react: { text: emoji || "", key } });
    await setReaction(message.waMessageId, emoji || "");
    return { ok: true };
  }
  if (action === "delete") {
    await session.socket.sendMessage(jid, { delete: key });
    await markRevoked({ id: message.id });
    return { ok: true };
  }

  /*
   * Editing what was already sent.
   *
   * WhatsApp allows this for about fifteen minutes after a message goes, and refuses it after -
   * so a refusal is passed back as it comes rather than dressed up, and the CRM's copy is only
   * rewritten once WhatsApp has accepted the new text.
   */
  if (action === "edit") {
    const text = String(body || "").trim();
    if (!text) {
      const error = new Error("Write the new message before saving.");
      error.status = 400;
      throw error;
    }
    if (message.direction !== "out") {
      const error = new Error("Only your own messages can be edited.");
      error.status = 400;
      throw error;
    }
    await session.socket.sendMessage(jid, { text, edit: key });
    await updateBody(message.id, text);
    return { ok: true };
  }
  if (action === "pin" || action === "unpin") {
    const pinning = action === "pin";
    try {
      // A week is WhatsApp's own default for a pin; unpinning is the same call with type 2.
      await session.socket.sendMessage(jid, { pin: key, type: pinning ? 1 : 2, time: 604800 });
    } catch (error) {
      // Not every account's WhatsApp accepts a pin from a linked device. The thread's own pin is
      // still worth having, so this is reported rather than thrown.
      console.warn("WhatsApp pin not accepted:", error.message);
    }
    await setPinned(message.id, pinning);
    return { ok: true };
  }

  if (action === "reply") {
    const text = String(body || "").trim();
    if (!text) {
      const error = new Error("Write a reply before sending.");
      error.status = 400;
      throw error;
    }
    await pace(session);
    await showTyping(session, jid);
    const sent = await session.socket.sendMessage(
      jid,
      { text },
      { quoted: { key, message: { conversation: message.body || "" } } },
    );
    session.lastSentAt = Date.now();

    // Stored here rather than left to the echo the socket will repeat, the same as any other
    // message this app sends - otherwise a reply is missing from the thread until WhatsApp gets
    // round to sending it back, which is the one message the user is watching for.
    const savedReply = await saveMessage({
      enquiryId: message.enquiryId,
      userId: Number(userId) || null,
      chatJid: jid,
      waMessageId: sent?.key?.id || null,
      direction: "out",
      body: text,
      status: "sent",
      sentAt: new Date(),
      quotedBody: message.body || (message.mediaType ? `[${message.mediaType}]` : ""),
      quotedAuthor: message.direction === "out" ? "You" : "",
    });
    if (savedReply) {
      await logWhatsAppActivity({ enquiryId: message.enquiryId, userId, direction: "out", mediaType: "" });
    }
    return { waMessageId: sent?.key?.id || "" };
  }

  if (action === "forward") {
    const target = requireJid(toPhone);
    await pace(session);
    await confirmOnWhatsApp(session, target);
    await showTyping(session, target);
    const sent = await session.socket.sendMessage(target, {
      forward: { key, message: { conversation: message.body || "" } },
    });
    session.lastSentAt = Date.now();
    return { waMessageId: sent?.key?.id || "", chatJid: target };
  }

  const error = new Error("Unknown message action.");
  error.status = 400;
  throw error;
}

module.exports = {
  rememberSent,
  recallSent,
  shutdownSessions,
  logWhatsAppActivity,
  mediaStreamFor,
  isDirectChat,
  phoneFromMessageKey,
  rememberLid,
  actOnMessage,
  loadOlderMessages,
  sendMediaToLead,
  markThreadRead,
  numberOnWhatsApp,
  restoreSessions,
  sessionStatesFor,
  jidFor,
  normalizePhone,
  sessionState,
  startSession,
  resumeSession,
  logoutSession,
  sendMessageToLead,
  sendMessageToPerson,
  leadIdForPhone,
  isGroupJid,
  listGroups,
  listAdminGroups,
  addToGroup,
  removeFromGroup,
  sendMessageToGroup,
};
