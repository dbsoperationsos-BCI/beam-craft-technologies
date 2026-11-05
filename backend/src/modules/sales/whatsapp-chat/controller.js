const prisma = require("../../../config/db");
const iamService = require("../../../services/iam.service");
const { salesEmployees } = require("../../../services/employeeOptionLists");
const { leadAccessWhere } = require("../../../services/leadScope");
const path = require("path");
const { listMessages, getMessage, findMessageByWaId, isChatEnabled, setChatEnabled, chatLimits, setChatLimits, blockedChatUserIds, isChatEnabledForUser, setUserChatEnabled, usageForUsers } = require("./repository");
const { evaluateUsage, limits: activeLimits, sanitizeLimits, DEFAULT_LIMITS, LIMIT_BOUNDS } = require("./usage");
const { subscribeToThread } = require("./events");
const { MAX_MESSAGE_LENGTH, MAX_CAPTION_LENGTH } = require("./security");
// The one rule for whether a typed number is a whole number, shared with the lead forms that
// collect it and with the server that stores it.
const { isValidPhoneNumber } = require("../../../services/phoneNumber");
const {
  sessionState, startSession, logoutSession, sendMessageToLead, sendMediaToLead,
  markThreadRead, numberOnWhatsApp, jidFor, mediaFilePath, sessionStatesFor, loadOlderMessages, actOnMessage, refetchMedia,
  getMedia, isRemoteKey,
} = require("./sessionManager");

async function fileExists(file) {
  if (!file) return false;
  try {
    await require("fs/promises").access(file);
    return true;
  } catch {
    return false;
  }
}

function sendError(res, error, fallback) {
  const status = error?.status || 500;
  if (status >= 500) console.error(fallback, error.message);
  return res.status(status).json({ message: status >= 500 ? fallback : error.message, code: error?.code });
}

// The session belongs to the signed-in user, never to the app: one CRM's WhatsApp is not
// another's, and neither the state nor the messages are readable across users by id.
/**
 * Where this account stands with WhatsApp: whether it is an administrator, and whether it must have
 * WhatsApp linked before it may use the application.
 *
 * Answered here, on the session the browser already polls, rather than put on the login token. Two
 * reasons, and the second is the one that was actually wrong: a rule that travels with the token only
 * changes when somebody signs in again, so an administrator ticking somebody's exemption would not
 * release them until they logged out - and a person who cannot get in cannot log out. Asked per poll,
 * an exemption takes effect within seconds and needs nothing from the person it releases.
 *
 * `isAdmin` is sent as well as used, because the client has its own reason for it: an administrator
 * is shown **nothing** about WhatsApp. They do not work leads, so a dialog about a channel they do
 * not use is noise on every screen they open - and they are the people who have to reach Settings and
 * Login Credentials to put somebody else's WhatsApp right, which a dialog in the way does not help.
 *
 * The rule is off by default and switched on per person:
 *
 *   * **An administrator is never held.** A Super Admin, or anybody carrying a role with the
 *     Administrator tick. This is the whole reason a gate over the application is safe to have.
 *   * **Nobody else is held until somebody says so.** `whatsappRequired` is off for every account
 *     and switched on per person, by ticking **Allow WhatsApp** in Login Credentials -> WhatsApp.
 *     Unticking it releases somebody whose phone is lost or broken, with no deploy.
 *
 * The two switches the caller reads beside this are a further release, and deliberately not folded
 * in here: `whatsappLinkNeeded` on the client already treats a studio-wide or per-user WhatsApp
 * switch that is off as nobody's to link, so turning the studio switch off lifts the gate for
 * everyone at once without this having to know about it.
 */
async function whatsappStanding(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true, whatsappRequired: true, roles: { select: { role: { select: { isAdmin: true, isActive: true } } } } },
  });
  if (!user) return { isAdmin: false, linkRequired: false };
  // Only a role that is still active counts: a deactivated role grants nothing else either.
  const isAdmin = user.role === "SUPER_ADMIN" || user.roles.some((entry) => entry.role?.isActive && entry.role?.isAdmin);
  return { isAdmin, linkRequired: !isAdmin && user.whatsappRequired === true };
}

async function status(req, res) {
  try {
    /*
     * Both switches travel with the session because they and it together are what the dot on the
     * lead's WhatsApp Chat tab shows: not linked and not allowed to link are different states, and
     * asking for them separately would need a second request on the same beat.
     *
     * `userChatEnabled` is this CRM's own switch, the one a Super Admin moves in Settings → User
     * Settings → WhatsApp. It was checked on every write here and never reported, so the browser
     * could not tell somebody who has not linked their WhatsApp from somebody who is not allowed
     * to - which is the difference between a reminder worth showing and one nobody can act on.
     */
    const [chatEnabled, userChatEnabled, standing] = await Promise.all([
      isChatEnabled(),
      isChatEnabledForUser(req.user.id),
      whatsappStanding(req.user.id),
    ]);
    return res.json({ data: { ...sessionState(req.user.id), chatEnabled, userChatEnabled, ...standing } });
  } catch (error) {
    return sendError(res, error, "Unable to read the WhatsApp session.");
  }
}

// Said the same way wherever the switch is found to be off, so a CRM meets one sentence rather
// than a different phrasing per button.
// A lead with no WhatsApp Number has no WhatsApp conversation. Said the same way wherever that
// is discovered, so a CRM meets one sentence rather than a different phrasing per action.
const NO_WHATSAPP_NUMBER_MESSAGE = "This lead has no WhatsApp Number. Add one on the lead before chatting.";

// Said to the CRM who has been blocked individually, rather than the studio-wide sentence: the
// difference matters, because one is "nobody can chat" and the other is "you cannot".
const USER_BLOCKED_MESSAGE = "Your WhatsApp chat has been switched off by an administrator.";

const CHAT_OFF_MESSAGE = "WhatsApp chat is switched off for the studio. An administrator has to switch it back on before you can link or message.";

async function connect(req, res) {
  try {
    // Refused here rather than only in the browser: pairing is the thing the switch exists to
    // stop, and a request that never went through this app must not get a QR code either.
    if (!(await isChatEnabled())) return res.status(403).json({ message: CHAT_OFF_MESSAGE });
    // Blocked individually. Refused before a socket opens, for the same reason the studio switch
    // is: pairing is a real registration against the studio's number and costs something.
    if (!(await isChatEnabledForUser(req.user.id))) return res.status(403).json({ message: USER_BLOCKED_MESSAGE });
    /*
     * The two switches travel with the session for the same reason `status` sends them: the chat
     * tab's dot reads "not linked" and "not allowed to link" differently, and asking for them
     * separately would need a second request on the same beat.
     */
    // The lead whose chat tab this was pressed from, so the link can be recorded there.
    const [session, chatEnabled, userChatEnabled, standing] = await Promise.all([
      startSession(req.user.id, { fromLead: String(req.body?.enquiryId || "").trim() }),
      isChatEnabled(),
      isChatEnabledForUser(req.user.id),
      whatsappStanding(req.user.id),
    ]);
    /*
     * The same shape `status` sends, and that matters rather than being tidy: the gate replaces its
     * copy of the session with whatever a reply carries, so a pairing reply without `linkRequired`
     * once read as "not required" and unlocked the application from the Refresh code button.
     */
    return res.json({ data: { ...session, chatEnabled, userChatEnabled, ...standing } });
  } catch (error) {
    return sendError(res, error, "Unable to start WhatsApp pairing.");
  }
}

async function disconnect(req, res) {
  try {
    return res.json({ data: await logoutSession(req.user.id, { fromLead: String(req.body?.enquiryId || "").trim() }) });
  } catch (error) {
    return sendError(res, error, "Unable to unlink WhatsApp.");
  }
}

/**
 * The number this lead is messaged on, which is the WhatsApp Number field and nothing else.
 *
 * Deliberately without a fallback to the enquiry number. That is where somebody called from; it is
 * frequently a landline, an office line or a number with no WhatsApp behind it, and falling back
 * to it meant the chat quietly addressed a different person from the one the field named. A lead
 * with no WhatsApp Number has no WhatsApp conversation, and the panel says exactly that.
 *
 * `typed` is that same field being entered in the lead popup and not yet saved, and it wins when it
 * is a whole number: the popup holds its edits until Update, so without this the chat beside the
 * field says "no number on this lead" about a number the person is looking straight at, and the
 * only way to message a new client is to save the lead first.
 *
 * Only a *complete* number is taken. A half-typed one falls back to what is stored, so the panel
 * behaves exactly as it does today while somebody is still typing rather than flickering between
 * two conversations at every keystroke - and a lead with nothing stored stays unmessageable until
 * the number is finished, which is the flow being kept.
 *
 * This is not a way to message an arbitrary number: whoever can pass one here can already save it
 * onto the lead and message it, and the send path still refuses a number that is not on WhatsApp.
 */
async function leadPhone(req, enquiryId, typed = "") {
  /*
   * Held to the same line as the CRM board: a conversation belongs to whoever the lead belongs to.
   * Every path into this module - the thread, sending, media, marking read, the history and the
   * forward - comes through here, so scoping the lookup scopes the chat. A lead this person may
   * not see is "not found", the same answer as a lead that does not exist.
   */
  const row = await prisma.salesCrmLead.findFirst({
    where: { enquiryId: String(enquiryId || "").trim(), deletedAt: null, AND: [await readerWhere(req)] },
    select: { whatsappNumber: true },
  });
  if (!row) {
    const error = new Error("CRM lead not found.");
    error.status = 404;
    throw error;
  }
  return resolveLeadPhone(row.whatsappNumber, typed);
}

/** This request's answer to "whose leads?", from the permission its router guarded with. */
const readerWhere = (req) => leadAccessWhere({ userId: Number(req.user.id), permissions: req.permission });

/**
 * Which of the two numbers a conversation is with: the one saved on the lead, or the one being
 * typed into the popup beside it.
 *
 * Its own function because it is the whole of the rule and the only part worth testing - the rest
 * of `leadPhone` is a row lookup.
 */
function resolveLeadPhone(stored, typed) {
  const saved = String(stored || "").trim();
  const draft = String(typed || "").trim();
  if (!draft || draft === saved) return saved;
  return isValidPhoneNumber(draft) ? draft : saved;
}

// The unsaved WhatsApp Number the lead popup is carrying, wherever a request puts it: the thread
// is a GET and reads it from the query string, everything else sends it in the body.
const typedPhoneOf = (req) => String(req.query?.phone || req.body?.phone || "").trim();

// The thread for one lead, which is the only shape this chat has: one CRM, one client.
async function thread(req, res) {
  try {
    const enquiryId = String(req.params.id || "").trim();
    // The number first: it decides which conversation this thread is, so the messages cannot be
    // fetched alongside it.
    const phone = await leadPhone(req, enquiryId, typedPhoneOf(req));
    const [messages, usage, saved] = await Promise.all([
      // Scoped to the number the WhatsApp Number field names. A lead messaged on one number and
      // later given another must not show the first conversation under the second.
      listMessages(enquiryId, jidFor(phone)),
      // Carried on the thread the panel already polls rather than on an endpoint of its own:
      // the warning has to keep up with the messages being sent, and a second request on the
      // same beat would only double the traffic to say the same thing.
      usageForUsers([req.user.id]),
      // What the studio saved in User Settings. One row, read on the same beat as the counts it
      // is measured against, so a limit raised on the settings screen reaches the CRM being
      // warned by it on their next poll rather than on the next deploy.
      chatLimits(),
    ]);
    return res.json({
      data: {
        messages,
        phone,
        session: sessionState(req.user.id),
        usage: evaluateUsage(usage.get(String(req.user.id)), saved),
        // Whether this number can be messaged at all. Answered from an hour-long cache, so the
        // panel's polling asks WhatsApp once rather than every second. `null` means the question
        // could not be put - no session yet, or WhatsApp did not answer - and the panel treats
        // that as "carry on" rather than as a refusal.
        onWhatsApp: await numberOnWhatsApp(req.user.id, phone),
      },
    });
  } catch (error) {
    return sendError(res, error, "Unable to load this WhatsApp conversation.");
  }
}

/*
 * ── The open line: a thread's changes, pushed as they happen ──────────────────────────────────
 *
 * The panel used to re-read the whole conversation every 1.2 seconds to find out whether the client
 * had replied. That is a reply arriving up to a second and a half late, a request per open panel
 * per second whether or not anything had happened, and no guard against one poll starting before
 * the last had answered - so a busy thread got slower the longer it was open.
 *
 * This holds the line open instead and says one word when something changes; the panel then re-reads
 * through `thread` above. A reply reaches the screen in about the time one round trip takes.
 *
 * ── Why the message is not pushed down it ──
 *
 * Because then the shape of a message, what counts as visible, and how a reaction folds onto the
 * one it points at would all have to be decided a second time in the browser - and the two would
 * drift. One round trip is a cheap price for the rule living in one place.
 *
 * ── Getting a stream through to a browser in production ──
 *
 * Three headers and a heartbeat, and every one of them earns its place. `no-transform` stops a
 * proxy compressing a stream that never ends; `X-Accel-Buffering: no` is nginx's own opt-out, and
 * without it nginx holds the bytes until its buffer fills - which for a few dozen bytes an hour is
 * for ever, and the feature would work perfectly on a developer's machine and not at all once
 * deployed. `flushHeaders` opens the response before the first event rather than at the first
 * write. The heartbeat is what stops the load balancer, and the browser, from closing a line that
 * has been quiet.
 */
const STREAM_HEARTBEAT_MS = 25000;

async function stream(req, res) {
  const enquiryId = String(req.params.id || "").trim();
  if (!enquiryId) return res.status(400).json({ message: "A lead id is required." });
  // The one path that reaches a lead without asking for its number, so it asks here instead - an
  // open stream on somebody else's lead would report every message as it arrived.
  const readable = await prisma.salesCrmLead.count({ where: { enquiryId, deletedAt: null, AND: [await readerWhere(req)] } });
  if (!readable) return res.status(404).json({ message: "CRM lead not found." });

  res.status(200).set({
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders?.();
  // An event before anything has happened, so the client knows the line is open and can stand its
  // fallback polling down. Without it a stream that connected and a stream that is silently being
  // buffered look identical from the browser.
  res.write(`event: ready\ndata: ${JSON.stringify({ enquiryId })}\n\n`);

  const unsubscribe = subscribeToThread(enquiryId, (event) => {
    // `write` on a socket the client has already gone from throws, and this runs from an emitter
    // rather than from a request - an unhandled throw here would take the process with it.
    try {
      res.write(`event: changed\ndata: ${JSON.stringify({ reason: event.reason, at: event.at })}\n\n`);
    } catch {
      close();
    }
  });

  const heartbeat = setInterval(() => {
    // A comment frame: it keeps the connection alive and every SSE client ignores it.
    try { res.write(": ping\n\n"); } catch { close(); }
  }, STREAM_HEARTBEAT_MS);

  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    unsubscribe();
    try { res.end(); } catch { /* already gone */ }
  }

  // Both ends. `close` fires when the browser navigates away or the tab is shut; `aborted` fires
  // when the connection is cut under it. Leaking a listener and an interval per opened panel is
  // how a long-lived server ends up holding thousands of them.
  req.on("close", close);
  req.on("aborted", close);
  res.on("error", close);
  return undefined;
}

async function send(req, res) {
  try {
    // Belt as well as braces. Switching off disconnects every session, so there should be
    // nothing left to send with - but a socket that outlived the sweep must not keep messaging
    // clients after the studio said to stop.
    if (!(await isChatEnabled())) return res.status(403).json({ message: CHAT_OFF_MESSAGE });
    if (!(await isChatEnabledForUser(req.user.id))) return res.status(403).json({ message: USER_BLOCKED_MESSAGE });
    const enquiryId = String(req.params.id || "").trim();
    // Checked before the socket sees it: an empty send is a mistake and an oversized one is
    // refused by WhatsApp anyway, so neither should reach the account and count against it.
    const body = typeof req.body?.body === "string" ? req.body.body : "";
    if (!body.trim()) return res.status(400).json({ message: "Write a message before sending." });
    if (body.length > MAX_MESSAGE_LENGTH) {
      return res.status(400).json({ message: `A WhatsApp message cannot be longer than ${MAX_MESSAGE_LENGTH} characters.` });
    }
    const phone = await leadPhone(req, enquiryId, typedPhoneOf(req));
    if (!phone) return res.status(400).json({ message: NO_WHATSAPP_NUMBER_MESSAGE });
    const sent = await sendMessageToLead({ userId: req.user.id, enquiryId, phone, body });
    return res.status(201).json({ message: "Message sent.", data: sent });
  } catch (error) {
    return sendError(res, error, "Unable to send this WhatsApp message.");
  }
}

// The employment statuses that count as working here, read off the status list the studio
// maintains in Settings → Field Settings rather than written out again - the same answer the CRM
// Name picker on Create Project is drawn from. See `services/employeeOptionLists`.

/**
 * The CRMs who can chat, and whether their WhatsApp is linked.
 *
 * Built from the sales team as it stands rather than a list kept by hand: an employee added to
 * Sales appears here without anyone editing this module, which is the whole point of reading it
 * from the repository. A CRM who also has a login is matched to it through `linkedEmployeeId`,
 * and that login is what carries a WhatsApp session; a login in Sales with no employee record
 * behind it is listed in its own right rather than left out.
 *
 * An administrator's own account is not a CRM and is not listed. It is a login, not somebody a
 * client is talking to.
 */
async function users(req, res) {
  try {
    const [employees, accounts] = await Promise.all([
      salesEmployees({ select: { id: true, employeeName: true, department: true, designation: true, contactNumber: true } }),
      prisma.user.findMany({
        where: { status: "ACTIVE" },
        select: { id: true, name: true, username: true, linkedEmployeeId: true, accessDepartment: true },
      }),
    ]);

    const accountByEmployee = new Map(
      accounts.filter((account) => Number.isInteger(account.linkedEmployeeId)).map((account) => [account.linkedEmployeeId, account]),
    );

    const rows = employees.map((employee) => ({
      key: `employee-${employee.id}`,
      name: employee.employeeName,
      role: employee.designation || employee.department || "",
      contactNumber: employee.contactNumber || "",
      account: accountByEmployee.get(employee.id) || null,
    }));

    // A Sales login with no employee record is still a CRM someone can chat as.
    for (const account of accounts) {
      if (accountByEmployee.has(account.linkedEmployeeId)) continue;
      if (String(account.accessDepartment || "").trim().toUpperCase() !== "SALES") continue;
      rows.push({
        key: `user-${account.id}`,
        name: account.name || account.username || "",
        role: account.accessDepartment || "",
        contactNumber: "",
        account,
      });
    }

    const accountIds = rows.map((row) => row.account?.id).filter(Boolean);
    const [states, usage, blocked, saved] = await Promise.all([
      sessionStatesFor(accountIds),
      usageForUsers(accountIds),
      // Read once for the whole table rather than per row.
      blockedChatUserIds(),
      chatLimits(),
    ]);

    const data = rows.map((row) => {
      const state = row.account ? states.get(String(row.account.id)) : null;
      return {
        // The same reading the CRM sees in their own chat panel, so an administrator deciding
        // whether to disconnect somebody is looking at the number that asked them to stop
        // rather than at a second measure of their own.
        usage: row.account ? evaluateUsage(usage.get(String(row.account.id)), saved) : evaluateUsage({}, saved),
        // Whether this CRM in particular may chat. A CRM with no login cannot be blocked - there
        // is nothing to block - so those read as enabled and their switch is not offered.
        chatEnabled: row.account ? !blocked.has(Number(row.account.id)) : true,
        key: row.key,
        // The account behind the row, which is what a disconnect acts on. Absent for a CRM who
        // has not signed in yet - there is a person, but no session to end.
        userId: row.account?.id || null,
        name: row.name,
        role: row.role,
        // The number WhatsApp is linked with while it is linked, and the number the studio has on
        // file otherwise - the second is who to call, not what is connected.
        whatsappNumber: state?.phone || "",
        contactNumber: row.contactNumber,
        hasAccount: Boolean(row.account),
        status: state?.status || "disconnected",
        paired: Boolean(state?.paired),
        isSelf: row.account?.id === req.user.id,
      };
    });

    return res.json({ data });
  } catch (error) {
    return sendError(res, error, "Unable to load WhatsApp users.");
  }
}

/**
 * Sends an attachment.
 *
 * The file is held in memory and handed straight to WhatsApp rather than parked on disk first:
 * it is one message on its way out, not an upload the app owns.
 */
async function sendMedia(req, res) {
  try {
    if (!(await isChatEnabled())) return res.status(403).json({ message: CHAT_OFF_MESSAGE });
    if (!(await isChatEnabledForUser(req.user.id))) return res.status(403).json({ message: USER_BLOCKED_MESSAGE });
    const enquiryId = String(req.params.id || "").trim();
    if (!req.file?.buffer?.length) return res.status(400).json({ message: "Choose a file to send." });
    const caption = typeof req.body?.caption === "string" ? req.body.caption : "";
    if (caption.length > MAX_CAPTION_LENGTH) {
      return res.status(400).json({ message: `A caption cannot be longer than ${MAX_CAPTION_LENGTH} characters.` });
    }
    const phone = await leadPhone(req, enquiryId, typedPhoneOf(req));
    if (!phone) return res.status(400).json({ message: NO_WHATSAPP_NUMBER_MESSAGE });
    const sent = await sendMediaToLead({
      userId: req.user.id,
      enquiryId,
      phone,
      file: req.file,
      caption,
      // Set by the microphone button only. It decides whether this goes as a voice note or as an
      // ordinary audio file, which is not something the mime type can be asked.
      voice: String(req.body?.voice || "") === "1",
    });
    return res.status(201).json({ message: "Attachment sent.", data: sent });
  } catch (error) {
    return sendError(res, error, "Unable to send this attachment.");
  }
}

// A file from the thread, served from the sender's own folder. The message is looked up first,
// so a path can never be asked for directly.
async function media(req, res) {
  try {
    const message = await getMessage(req.params.messageId);
    if (!message?.mediaPath && !message?.rawMessage) {
      return res.status(404).json({ message: "No file on this message." });
    }

    /*
     * The file belongs to the session that received it, and only that session may read it.
     *
     * Without this, any signed-in account could ask for any message id. It happened to fail -
     * the bytes were served from the caller's own folder, so another CRM's file was simply not
     * there - but the refetch below would then ask WhatsApp for it again, which is the leak the
     * accident was hiding. Said as "no file" rather than "not yours": whether a message id
     * exists is itself something the caller has no business learning.
     */
    if (Number(message.userId) !== Number(req.user.id)) {
      return res.status(404).json({ message: "No file on this message." });
    }

    const gone = () => res.status(404).json({ message: "This file is no longer stored." });

    /*
     * Streams an object out of the bucket.
     *
     * Piped rather than buffered: a video can be tens of megabytes, and holding one per viewer
     * in the server's memory is how a chat panel takes the API down with it. Nothing public is
     * involved - the object is read by the server and sent through this authenticated endpoint,
     * so a URL to the file itself is never built and never handed out.
     */
    const sendFromBucket = async (key) => {
      const object = await getMedia(key);
      if (!object) return false;
      res.setHeader("Content-Type", object.contentType);
      // The bucket is the copy of record; nothing in between should keep one of a client's
      // conversation.
      res.setHeader("Cache-Control", "private, no-store");
      if (object.contentLength) res.setHeader("Content-Length", String(object.contentLength));
      object.stream.pipe(res).on("error", () => {
        if (!res.headersSent) gone();
      });
      return true;
    };

    /*
     * The bucket, then the disk.
     *
     * Attachments live in R2 under the client they belong to. Messages stored before that still
     * point at a file beside the application, so both are read - a slash in the stored path is
     * what tells them apart, since a local name can never contain one.
     */
    let stored = message.mediaPath;
    if (isRemoteKey(stored) && (await sendFromBucket(stored))) return undefined;

    const localMissing = !isRemoteKey(stored)
      && (!stored || !(await fileExists(mediaFilePath(req.user.id, stored))));

    // Whatever is missing, ask WhatsApp for it again while it still has the keys. A re-fetch
    // files into the bucket, so the thread heals forward rather than rebuilding the old layout.
    if (isRemoteKey(stored) || localMissing) {
      const refetched = await refetchMedia(message);
      if (refetched) stored = refetched;
      if (isRemoteKey(stored)) return (await sendFromBucket(stored)) ? undefined : gone();
    }

    const file = stored ? mediaFilePath(req.user.id, stored) : "";
    if (!file) return res.status(404).json({ message: "No file on this message." });
    /*
     * `dotfiles: "allow"` is the whole reason this worked on disk and not over HTTP.
     *
     * The older files sit under `.whatsapp-sessions`, and Express refuses any path with a
     * dot-segment in it unless told otherwise - so every image in the thread answered 404 and
     * read as "no longer stored" while the file was sitting there the whole time.
     */
    return res.sendFile(path.resolve(file), { dotfiles: "allow" }, (error) => {
      if (error && !res.headersSent) gone();
    });
  } catch (error) {
    return sendError(res, error, "Unable to load this attachment.");
  }
}

// The thread is open on screen, so the client's messages in it have been read.
async function markRead(req, res) {
  try {
    const enquiryId = String(req.params.id || "").trim();
    const phone = await leadPhone(req, enquiryId, typedPhoneOf(req));
    const messages = await listMessages(enquiryId, jidFor(phone));
    await markThreadRead({
      userId: req.user.id,
      phone,
      messageIds: messages.filter((message) => message.direction === "in").map((message) => message.waMessageId),
    });
    return res.json({ message: "Marked read." });
  } catch (error) {
    return sendError(res, error, "Unable to mark this conversation read.");
  }
}

/**
 * Pulls the conversation further back.
 *
 * What WhatsApp sends does not come back in the reply - it arrives on the socket moments later,
 * through the same handler that stores every other message - so this answers as soon as the
 * request is made and the thread's own polling shows what turned up.
 */
async function history(req, res) {
  try {
    const enquiryId = String(req.params.id || "").trim();
    const phone = await leadPhone(req, enquiryId, typedPhoneOf(req));
    const messages = await listMessages(enquiryId, jidFor(phone));
    const result = await loadOlderMessages({ userId: req.user.id, phone, oldest: messages[0] || null });
    return res.json({ message: "Asked WhatsApp for older messages.", data: result });
  } catch (error) {
    return sendError(res, error, "Unable to load older messages.");
  }
}

/**
 * Reply, react, forward, pin or delete one message.
 *
 * The message is read from this lead's own thread before anything is done with it, so an action
 * can only ever reach a conversation the caller is already looking at.
 */
async function act(req, res) {
  try {
    const enquiryId = String(req.params.id || "").trim();
    const messages = await listMessages(enquiryId, jidFor(await leadPhone(req, enquiryId, typedPhoneOf(req))));
    const message = messages.find((item) => item.id === req.params.messageId);
    if (!message) return res.status(404).json({ message: "Message not found in this conversation." });

    const phone = await leadPhone(req, enquiryId, typedPhoneOf(req));
    // Forwarding names another lead, and that lead's number is looked up the same way - never
    // taken from the request, so a message cannot be forwarded to an arbitrary number.
    const toPhone = req.body?.toEnquiryId ? await leadPhone(req, String(req.body.toEnquiryId).trim()) : "";

    const result = await actOnMessage({
      userId: req.user.id,
      phone,
      message,
      action: String(req.body?.action || ""),
      emoji: req.body?.emoji,
      body: req.body?.body,
      toPhone,
    });
    return res.json({ message: "Done.", data: result });
  } catch (error) {
    return sendError(res, error, "Unable to act on this message.");
  }
}

/**
 * Who may reach into somebody else's WhatsApp: disconnect them, switch them off, or switch the
 * whole studio off.
 *
 * The three sit on Settings → User Settings, and answer to that section's permission at Read /
 * Write - the same row that decides which logins are held to linking WhatsApp. They used to demand
 * the legacy `SUPER_ADMIN` role, which no grant can satisfy: a role given every Settings section
 * still found the switches dead, and nothing in Role Management could change that. A Super Admin
 * holds every permission, so they keep all three.
 */
const managesWhatsappUsers = (req) => iamService.hasPermission(req.user?.id, "SETTINGS", "User Settings", "READ_WRITE");

/**
 * Ends another CRM's WhatsApp link.
 *
 * The one action in this module that reaches into a session that is not the caller's own - so it
 * is guarded on User Settings rather than on the id in the URL. The credentials go with it: the
 * CRM has to scan again, and the device disappears from their phone's Linked devices, which is
 * what disconnecting somebody has to mean to be worth having.
 */
async function disconnectUser(req, res) {
  if (!(await managesWhatsappUsers(req))) {
    return res.status(403).json({ message: "You need User Settings access to disconnect another user's WhatsApp." });
  }
  try {
    const userId = Number(req.params.userId);
    if (!Number.isInteger(userId)) return res.status(400).json({ message: "Unknown user." });
    return res.json({ data: await logoutSession(userId) });
  } catch (error) {
    return sendError(res, error, "Unable to disconnect this WhatsApp.");
  }
}

/**
 * Whether WhatsApp chat is switched on for the studio, and the usage limits it is held to.
 *
 * Readable by anyone signed in, because every CRM's chat tab has to know why its Link button is
 * refusing them. `canEdit` says whether this account may move any of it, so the screen can show
 * the switch and the limits to everybody and offer them only to those who hold User Settings.
 *
 * Three answers about the limits, and the screen needs all three:
 *
 *   * `limits` - what is in force right now, whatever decided it.
 *   * `saved` - what this studio chose, with a null per limit nobody has set. The difference
 *     between the two is what lets a box show `60` as a placeholder the studio can accept by
 *     leaving it empty, rather than as a number they appear to have typed.
 *   * `defaults` - what the app falls back to, so the screen can say so in words instead of
 *     making somebody clear a box to find out.
 */
async function chatSettings(req, res) {
  try {
    const [enabled, saved, canEdit] = await Promise.all([
      isChatEnabled(),
      chatLimits(),
      managesWhatsappUsers(req),
    ]);
    return res.json({
      data: {
        enabled,
        canEdit,
        limits: activeLimits(saved),
        saved,
        defaults: DEFAULT_LIMITS,
        bounds: LIMIT_BOUNDS,
      },
    });
  } catch (error) {
    return sendError(res, error, "Unable to read the WhatsApp switch.");
  }
}

/**
 * Saves the studio's usage limits.
 *
 * Its own endpoint rather than a second thing the switch above understands: that one ends every
 * CRM's session when it is turned off, and a mistyped limit must not be one keystroke away from
 * disconnecting the studio.
 *
 * Guarded on User Settings Read / Write, exactly as the switch and the per-CRM blocks beside it
 * are - the router's own CRM Leads guard is about reading and sending messages, and cannot tell a
 * CRM changing their own screen from an administrator changing everybody's limits.
 *
 * Nothing here disconnects anyone or touches a session. The limits decide what a CRM is *told*,
 * and raising one takes effect on the next poll of a panel that is already open.
 */
async function setChatLimitsHandler(req, res) {
  if (!(await managesWhatsappUsers(req))) {
    return res.status(403).json({ message: "You need User Settings access to change the WhatsApp limits." });
  }
  const { values, problems } = sanitizeLimits(req.body?.limits ?? req.body);
  if (problems.length) {
    // Named, because "invalid" on a form of three boxes is a hunt. The rule is the same for all
    // three, so it is said once rather than per field.
    const named = {
      hourlyChats: "Different clients an hour",
      hourlyMessages: "Messages an hour",
      dailyMessages: "Messages a day",
    };
    return res.status(400).json({
      message: `${problems.map((key) => named[key]).join(", ")} must be a whole number between ${LIMIT_BOUNDS.min} and ${LIMIT_BOUNDS.max}, or empty to use the default.`,
    });
  }
  try {
    const saved = await setChatLimits(values, req.user.id);
    return res.json({
      message: "WhatsApp limits saved.",
      data: { limits: activeLimits(saved), saved, defaults: DEFAULT_LIMITS, bounds: LIMIT_BOUNDS },
    });
  } catch (error) {
    return sendError(res, error, "Unable to save the WhatsApp limits.");
  }
}

/**
 * Moves the studio's WhatsApp switch.
 *
 * Switching off ends every CRM's link, not only the switch: leaving the sessions paired would
 * mean the sockets stayed up and clients kept being answered by an app that says WhatsApp is
 * off. They are logged out the way a single disconnect does it, so each phone drops the device
 * from its Linked devices and a fresh QR code is needed once it is switched back on. The
 * conversations are not touched - they are rows in this module's own table, so a CRM who links
 * again finds the thread where they left it.
 *
 * Guarded on User Settings rather than on anything in the body: this is the one control in the
 * module that acts on everybody at once.
 */
async function setChatSettings(req, res) {
  if (!(await managesWhatsappUsers(req))) {
    return res.status(403).json({ message: "You need User Settings access to switch WhatsApp chat on or off." });
  }
  if (typeof req.body?.enabled !== "boolean") {
    return res.status(400).json({ message: "Send whether WhatsApp chat should be on or off." });
  }
  const enabled = req.body.enabled;
  try {
    // The switch moves first. If disconnecting somebody fails half way through, the studio is
    // still off rather than on with an unknown number of live sessions.
    await setChatEnabled(enabled, req.user.id);

    let disconnected = 0;
    if (!enabled) {
      const accounts = await prisma.user.findMany({ where: { status: "ACTIVE" }, select: { id: true } });
      const states = await sessionStatesFor(accounts.map((account) => account.id));
      for (const account of accounts) {
        const state = states.get(String(account.id));
        if (!state?.paired && state?.status !== "connected") continue;
        try {
          await logoutSession(account.id);
          disconnected += 1;
        } catch (error) {
          // One phone that would not let go must not leave the rest linked.
          console.warn("Unable to disconnect WhatsApp for user", account.id, error?.message || error);
        }
      }
    }

    return res.json({
      message: enabled
        ? "WhatsApp chat is switched on. Each CRM can link their own account again."
        : `WhatsApp chat is switched off${disconnected ? ` and ${disconnected} CRM${disconnected === 1 ? "" : "s"} disconnected` : ""}. Nobody can link until it is switched back on.`,
      data: { enabled, disconnected },
    });
  } catch (error) {
    return sendError(res, error, "Unable to switch WhatsApp chat.");
  }
}

/**
 * Switches one CRM's WhatsApp on or off.
 *
 * User Settings Read / Write, like the studio switch and the single disconnect - this decides
 * whether somebody can do their job, and is not a thing a CRM may do to a colleague.
 *
 * Switching off ends their link as well as setting the flag. Leaving the session up would mean
 * the socket stayed connected and clients kept being answered by somebody the studio has just
 * stopped; their conversations are untouched, so switching them back on and re-scanning finds
 * every thread where it was.
 */
async function setUserChatSettings(req, res) {
  if (!(await managesWhatsappUsers(req))) {
    return res.status(403).json({ message: "You need User Settings access to switch a CRM's WhatsApp on or off." });
  }
  if (typeof req.body?.enabled !== "boolean") {
    return res.status(400).json({ message: "Send whether this CRM's WhatsApp should be on or off." });
  }
  const userId = Number(req.params.userId);
  if (!Number.isInteger(userId)) return res.status(400).json({ message: "Unknown user." });

  const enabled = req.body.enabled;
  try {
    const account = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true, username: true } });
    if (!account) return res.status(404).json({ message: "That user was not found." });

    // The flag first. If ending the session then fails, the CRM is still blocked rather than
    // left switched on with a live socket.
    await setUserChatEnabled(userId, enabled, req.user.id);

    let disconnected = false;
    if (!enabled) {
      try {
        await logoutSession(userId);
        disconnected = true;
      } catch (error) {
        console.warn("Unable to disconnect WhatsApp for user", userId, error?.message || error);
      }
    }

    const who = account.name || account.username || "This CRM";
    return res.json({
      message: enabled
        ? `${who} can use WhatsApp chat again. They will need to link their account.`
        : `${who} can no longer use WhatsApp chat${disconnected ? " and has been disconnected" : ""}.`,
      data: { userId, enabled, disconnected },
    });
  } catch (error) {
    return sendError(res, error, "Unable to switch this CRM's WhatsApp.");
  }
}

module.exports = { resolveLeadPhone, status, stream, connect, disconnect, disconnectUser, setUserChatSettings, thread, send, sendMedia, media, markRead, history, act, users, chatSettings, setChatSettings, setChatLimitsHandler };
