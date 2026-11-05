const test = require("node:test");
const { before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { EventEmitter } = require("node:events");

const prisma = require("../src/config/db");
const { publishThreadChange, subscribeToThread } = require("../src/modules/sales/whatsapp-chat/events");
const { stream } = require("../src/modules/sales/whatsapp-chat/controller");

/*
 * How a client's reply reaches the screen.
 *
 * It used to be found by asking: the panel re-read the whole conversation every 1.2 seconds and
 * compared. That is a reply arriving up to a second and a half late, and - because nothing stopped
 * one read starting before the last had answered - a thread that got slower the longer it was open.
 *
 * The server says so instead. Everything below is one of the ways that can quietly stop working,
 * and every one of them fails the same way: the panel keeps working and goes back to being slow,
 * which is exactly the fault nobody would notice until it was reported again.
 */

const CHAT = path.join(__dirname, "..", "src", "modules", "sales", "whatsapp-chat");
const read = (name) => fs.readFileSync(path.join(CHAT, name), "utf8");

/** A response that records what was written to it, in place of a socket. */
function fakeResponse() {
  const res = new EventEmitter();
  res.frames = [];
  res.headers = {};
  res.statusCode = 0;
  res.ended = false;
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; res.ended = true; return res; };
  res.set = (headers) => { Object.assign(res.headers, headers); return res; };
  res.flushHeaders = () => { res.flushed = true; };
  res.write = (chunk) => { res.frames.push(chunk); return true; };
  res.end = () => { res.ended = true; };
  return res;
}

/*
 * A stream is opened on one lead, and a lead belongs to somebody - so the request carries who is
 * asking and the permission its router guarded with, and the handler refuses a lead this person may
 * not read before it opens the line. The fixture below is one real lead created by this login, so
 * the rule answers yes and the plumbing below is what is actually being tested.
 */
const STAMP = String(Date.now()).slice(-6);
const eid = (name) => `WCS-${STAMP}-${name}`;
const F = {};

before(async () => {
  F.login = await prisma.user.create({ data: { name: "Stream scope me", email: `wcs-${STAMP}@test.local`, username: `wcs-${STAMP}`, password: "x", role: "SUPER_ADMIN" } });
  await prisma.salesCrmLead.createMany({ data: [10, 11, 12, 13].map((n) => ({ enquiryId: eid(n), name: `Stream scope lead ${n}`, createdByUserId: F.login.id })) });
});

after(async () => {
  await prisma.salesCrmLead.deleteMany({ where: { enquiryId: { startsWith: `WCS-${STAMP}` } } });
  await prisma.user.deleteMany({ where: { id: F.login.id } });
  await prisma.$disconnect();
});

function fakeRequest(enquiryId) {
  const req = new EventEmitter();
  req.params = { id: enquiryId };
  req.user = { id: F.login.id };
  req.permission = { module: "SALES", feature: "CRM Leads" };
  return req;
}

/* ───────────────────────────────────────────────────────────────────── the bus itself ── */

test("a change reaches the panel watching that lead, and no other", () => {
  /*
   * One CRM reading a lead must not be re-fetching because a colleague's client replied. The filter
   * is in `subscribeToThread` rather than at each subscriber, so it cannot be forgotten by one.
   */
  const mine = [];
  const theirs = [];
  const offMine = subscribeToThread("EID-1", (event) => mine.push(event.reason));
  const offTheirs = subscribeToThread("EID-2", (event) => theirs.push(event.reason));

  publishThreadChange({ enquiryId: "EID-1", reason: "message" });
  publishThreadChange({ enquiryId: "EID-2", reason: "status" });

  offMine();
  offTheirs();
  assert.deepEqual(mine, ["message"]);
  assert.deepEqual(theirs, ["status"]);
});

test("unsubscribing really stops it", () => {
  // A listener left behind is a panel that was closed still causing reads, and one more of them
  // every time a lead is opened.
  const seen = [];
  const off = subscribeToThread("EID-3", (event) => seen.push(event.reason));
  publishThreadChange({ enquiryId: "EID-3", reason: "first" });
  off();
  publishThreadChange({ enquiryId: "EID-3", reason: "second" });
  assert.deepEqual(seen, ["first"]);
});

test("a lead with no id announces nothing", () => {
  // `updateMessageStatus` and friends look the lead up by WhatsApp's own message id, and a row that
  // has gone answers "". Publishing that would wake every panel on the server.
  const seen = [];
  const off = subscribeToThread("", (event) => seen.push(event));
  publishThreadChange({ enquiryId: "", reason: "message" });
  publishThreadChange({ reason: "message" });
  off();
  assert.deepEqual(seen, []);
});

/* ──────────────────────────────────────────────────────────────────── the open line ── */

test("the stream opens with the headers a proxy needs, and says so before anything happens", async () => {
  const req = fakeRequest(eid(10));
  const res = fakeResponse();
  await stream(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["Content-Type"], "text/event-stream; charset=utf-8");
  /*
   * The two that decide whether this works in production at all.
   *
   * nginx buffers a proxied response by default and only stops when told - so without
   * `X-Accel-Buffering: no` it holds the bytes until its buffer fills, which for a few dozen bytes
   * an hour is for ever. `no-transform` stops anything in between compressing a stream that never
   * ends. Both would pass every test on a developer's machine, where there is no proxy.
   */
  assert.equal(res.headers["X-Accel-Buffering"], "no");
  assert.match(res.headers["Cache-Control"], /no-transform/);
  assert.equal(res.flushed, true, "the response is not opened until something is written to it");

  // And an event before any change, so the client can tell an open line from one being buffered.
  assert.match(res.frames[0], /^event: ready\n/);
  req.emit("close");
});

test("a change is pushed down the line, and only that lead's", async () => {
  const req = fakeRequest(eid(11));
  const res = fakeResponse();
  await stream(req, res);
  const before = res.frames.length;

  publishThreadChange({ enquiryId: eid(11), reason: "message" });
  publishThreadChange({ enquiryId: eid("other"), reason: "message" });

  const pushed = res.frames.slice(before);
  assert.equal(pushed.length, 1, "the stream pushed somebody else's change, or missed its own");
  assert.match(pushed[0], /^event: changed\n/);
  assert.match(pushed[0], /"reason":"message"/);
  req.emit("close");
});

test("closing the connection releases the listener and the heartbeat", async () => {
  /*
   * Both, or a server that has been up for a week is holding a listener and an interval for every
   * lead anybody ever opened. The heartbeat is the one that would keep the process alive on its
   * own, which is how this is provable without waiting 25 seconds for one.
   */
  const req = fakeRequest(eid(12));
  const res = fakeResponse();
  await stream(req, res);
  req.emit("close");

  assert.equal(res.ended, true);
  const after = res.frames.length;
  publishThreadChange({ enquiryId: eid(12), reason: "message" });
  assert.equal(res.frames.length, after, "a closed stream is still being written to");

  // Closing twice is what happens when `close` and `aborted` both fire, which they do.
  req.emit("aborted");
  assert.equal(res.ended, true);
});

test("a write to a socket the client has left closes the stream instead of throwing", async () => {
  /*
   * This runs from an emitter rather than from a request, so an unhandled throw here is not a 500 -
   * it is the API process going down.
   */
  const req = fakeRequest(eid(13));
  const res = fakeResponse();
  await stream(req, res);
  res.write = () => { throw new Error("socket is gone"); };

  assert.doesNotThrow(() => publishThreadChange({ enquiryId: eid(13), reason: "message" }));
  assert.equal(res.ended, true, "a stream that could not be written to was left open");
});

test("a stream is refused on a lead this person may not read", async () => {
  /*
   * The one path into this module that never asks for the lead's number, so it never went through
   * `leadPhone` and never met the rule. An open line on somebody else's lead reports every message
   * as it arrives - not the content, but that there was one, and when.
   */
  const stranger = await prisma.user.create({ data: { name: "Stream scope stranger", email: `wcs-x-${STAMP}@test.local`, username: `wcs-x-${STAMP}`, password: "x", role: "ADMIN" } });
  try {
    const req = fakeRequest(eid(10));
    req.user = { id: stranger.id };
    const res = fakeResponse();
    await stream(req, res);
    assert.equal(res.statusCode, 404, "a lead this person may not read must answer not found");
    assert.equal(res.frames.length, 0, "nothing may be written to a stream that was refused");
  } finally {
    await prisma.user.deleteMany({ where: { id: stranger.id } });
  }
});

/* ─────────────────────────────────────────────────── what the speed actually rests on ── */

test("every write to a thread announces itself, from the repository", () => {
  /*
   * In the repository rather than at each caller, because that is what makes it complete: a write
   * path added later announces itself by construction. Announced from the callers instead, a new
   * one would simply not wake the panel - and the panel would still work, a poll later, which is
   * the class of slowness this whole change is about.
   */
  const repository = read("repository.js");
  assert.match(repository, /const \{ publishThreadChange \} = require\("\.\/events"\);/);
  for (const [fn, reason] of [
    ["saveMessage", "message"],
    ["updateMessageStatus", "status"],
    ["setReaction", "reaction"],
    ["setPinned", "pin"],
    ["markDeleted", "delete"],
    ["markRevoked", "revoke"],
    ["updateBody", "edit"],
  ]) {
    const start = repository.indexOf(`async function ${fn}(`);
    assert.notEqual(start, -1, `${fn} has gone`);
    const body = repository.slice(start, repository.indexOf("\nasync function ", start + 1));
    // Non-greedy across whatever is passed, because the lead is usually looked up inline and that
    // brings its own brackets: `announce(await enquiryIdFor({ waMessageId: id }), "status")`.
    assert.match(body, new RegExp(`announce\\([\\s\\S]*?"${reason}"\\)`), `${fn} no longer announces the change it made`);
  }
});

test("a redelivered message announces nothing", () => {
  /*
   * Callyzer is not the only thing that resends: WhatsApp redelivers a message it is not sure
   * arrived, and `INSERT IGNORE` lands it on the row already held. Nothing on screen changed, and
   * waking every open panel to re-read an unchanged thread is the polling this replaced, arriving
   * by another route.
   */
  const repository = read("repository.js");
  const save = repository.slice(repository.indexOf("async function saveMessage("), repository.indexOf("async function listMessages("));
  assert.match(save, /if \(stored\) announce\(message\.enquiryId, "message"\);/);
});

test("a file in the thread is never downloaded or stored by the CRM", () => {
  /*
   * The studio's phone holds every file a client sends, so the CRM keeps no copy - not in the
   * bucket, not on disk. The message is stored with WhatsApp's own reference to the file, and View
   * and Download fetch it from WhatsApp when asked (mediaOnDemand.js).
   */
  const manager = read("sessionManager.js");
  assert.doesNotMatch(manager, /putMedia|storeIncomingMedia|mediaStore/);
  const record = manager.slice(manager.indexOf("async function recordSocketMessage("), manager.indexOf("async function openSocket("));
  assert.doesNotMatch(record, /downloadMediaMessage/);
  // What View and Download need is kept: the message as WhatsApp delivered it.
  assert.match(record, /rawMessage: mediaType \? message : undefined/);
  const send = manager.slice(manager.indexOf("async function sendMediaToLead("), manager.indexOf("function mediaStreamFor("));
  assert.doesNotMatch(send, /mediaPath/);
  assert.match(send, /rawMessage: sent/);
});

test("the panel reads one thread at a time, and slows its polling when the line is open", () => {
  const panel = fs.readFileSync(
    path.join(__dirname, "..", "..", "frontend", "src", "components", "sales", "WhatsAppChatPanel.js"),
    "utf8",
  );
  /*
   * The guard matters more than either interval. Without it the timer fired again whether or not
   * the last read had answered, so a thread slower to read than the beat piled requests on top of
   * each other - each making the next slower, and the newest answer not necessarily arriving last.
   */
  assert.match(panel, /if \(loadingRef\.current\) return;\s*\n\s*loadingRef\.current = true;/);
  assert.match(panel, /loadingRef\.current = false;/, "the in-flight guard is never released");
  // And with the stream up the poll is only a long-stop.
  assert.match(panel, /streamUp \? THREAD_SAFETY_POLL_MS : THREAD_POLL_MS/);
  // A dropped line is re-opened rather than falling back to polling for the rest of the session.
  assert.match(panel, /retry = window\.setTimeout\(open, wait\);/);
  assert.match(panel, /Math\.min\(1000 \* \(2 \*\* attempt\), 15000\)/);
});
