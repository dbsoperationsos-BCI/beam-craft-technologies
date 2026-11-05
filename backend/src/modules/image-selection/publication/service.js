const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const repository = require("./repository");
const { expiredLinkError } = require("../../../services/expiredLink");
const galleryRepository = require("../gallery/repository");
const { createDeliverableService } = require("../deliverables/service");
const { createSettingsService } = require("../settings/service");
const clientPush = require("../../../services/clientPush");

const settings = createSettingsService();

function httpError(status, message) { const error = new Error(message); error.status = status; return error; }
function encryptionKey() { const secret = process.env.PUBLISH_TOKEN_ENCRYPTION_KEY || process.env.JWT_SECRET; if (!secret) throw httpError(500, "Publish token encryption is not configured."); return crypto.createHash("sha256").update(secret).digest(); }
const hashValue = (value) => crypto.createHash("sha256").update(value).digest("hex");
function encryptValue(value) { const iv = crypto.randomBytes(12); const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv); const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]); return `${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${encrypted.toString("base64url")}`; }
function decryptValue(value) { const [iv, tag, encrypted] = value.split("."); const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64url")); decipher.setAuthTag(Buffer.from(tag, "base64url")); return Buffer.concat([decipher.update(Buffer.from(encrypted, "base64url")), decipher.final()]).toString("utf8"); }
function generatePin() { return String(crypto.randomInt(1000, 10000)); }

/*
 * The short code is the public name in the client URL — gallery.dontblinkstudioz.com/<code>.
 * Six characters, not the four of the mock-ups: "View Photos" grants read access on the link
 * alone, so a four-character space (~1M codes) could be walked by a script, while six from this
 * alphabet is ~887M. The code is random — never derived from a project id — and once written it
 * is never changed: ensureShortCode only fills a blank, so editing or republishing a project
 * keeps the URL. The alphabet, length and generator are the shared shortCode service — the same
 * codes onboarding invite links use.
 */
const { SHORT_CODE_ALPHABET, SHORT_CODE_LENGTH, SHORT_CODE_PATTERN, generateShortCode } = require("../../../services/shortCode");
// A short code can never collide with a legacy token: those are exactly 43 characters.
const LEGACY_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

// Where the short URL points. Production sets GALLERY_PUBLIC_URL to the bare gallery subdomain
// (https://gallery.dontblinkstudioz.com); development falls back to the frontend's /g route, so
// nothing needs configuring locally and no environment URL is hardcoded per call site.
function galleryBaseUrl() { return (process.env.GALLERY_PUBLIC_URL || `${process.env.FRONTEND_URL || "http://localhost:3000"}/g`).replace(/\/+$/, ""); }

// Fills the short code on a publication that predates the column, retrying on the unique
// constraint until an unclaimed code lands. Never touches a code that already exists — the URL a
// client was sent must keep working — which is also why a republish (an upsert around this field)
// cannot rotate it.
async function ensureShortCode(publication, attempts = 5) {
  if (!publication || publication.shortCode) return publication;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try { return { ...publication, ...(await repository.setShortCode(publication.projectId, generateShortCode())) }; }
    catch (error) { if (error?.code !== "P2002") throw error; }
  }
  throw httpError(500, "Unable to allocate a gallery short code.");
}

// A published gallery stays reachable for a fixed window; after that the link is revoked so
// clients cannot keep selecting photos on a job that is long finished. How long that window is
// now comes from studio-wide Image Selection settings — six months is only the value used when
// nothing has been saved there.
const GALLERY_VALIDITY_MONTHS = 6;
function addMonths(date, months) { const next = new Date(date); next.setMonth(next.getMonth() + months); return next; }
// Galleries published before this window existed have no stored date, so fall back to six months
// from the day they went out. Deliberately the constant and not the current setting: the expiry a
// client was given cannot be moved by a number the studio changes today, and every gallery
// published since stores its own `expiresAt` at publish time anyway.
function expiryOf(publication) { return publication.expiresAt || addMonths(publication.publishedAt, GALLERY_VALIDITY_MONTHS); }

/*
 * What the client is known to have done with the gallery, for the dashboard's Needs Attention
 * rows. Two stamps: the link was opened (any load of the client's page), and the client acted in
 * it (picked, unpicked, or sent an item). Both are throttled per project in this process — a client
 * clicking through two hundred photos is one write a minute, not two hundred — and neither is ever
 * allowed to fail the gallery: a statistic that cannot be written is logged and the page carries on.
 */
const OPENED_THROTTLE_MS = 5 * 60 * 1000;
const ACTIVITY_THROTTLE_MS = 60 * 1000;
const lastStamp = new Map();
function throttled(key, windowMs, now) {
  const previous = lastStamp.get(key) || 0;
  if (now.getTime() - previous < windowMs) return true;
  lastStamp.set(key, now.getTime());
  return false;
}
async function recordGalleryOpened(projectId, now = new Date()) {
  if (throttled(`opened:${projectId}`, OPENED_THROTTLE_MS, now)) return;
  try { await repository.markGalleryOpened(projectId, now); } catch (error) { console.warn("Could not record a gallery open:", error?.message || error); }
}
async function recordClientActivity(projectId, now = new Date()) {
  if (throttled(`activity:${projectId}`, ACTIVITY_THROTTLE_MS, now)) return;
  try { await repository.markClientActivity(projectId, now); } catch (error) { console.warn("Could not record client activity:", error?.message || error); }
}

function sessionSecret() { const secret = process.env.JWT_SECRET; if (!secret) throw httpError(500, "Gallery session signing is not configured."); return secret; }

// "View Photos" lets a client browse the gallery without the PIN — the 43-character link is
// already the secret that gets them this far. The preview session is read-only and short
// lived; anything that records a choice still demands the PIN.
const SESSION_SCOPE = "image-selection-gallery-session";
const PREVIEW_SCOPE = "image-selection-gallery-preview";

function serialize(publication, imageCount, selectedCount = 0) {
  let token = null; let pin = null;
  if (publication.status === "PUBLISHED") {
    try { token = decryptValue(publication.tokenCipher); } catch { token = null; }
    if (publication.pinCipher) { try { pin = decryptValue(publication.pinCipher); } catch { pin = null; } }
  }
  // `clientUrl` is what the studio shares — the short, environment-aware URL. `clientPath` keeps
  // the long tokenized route for links already sent out; the UI no longer shows it.
  const shortCode = publication.status === "PUBLISHED" ? publication.shortCode || null : null;
  return { status: publication.status, publishedAt: publication.publishedAt, expiresAt: expiryOf(publication), revokedAt: publication.revokedAt, imageCount, selectedCount, clientPath: token ? `/gallery/${token}` : null, shortCode, clientUrl: shortCode ? `${galleryBaseUrl()}/${shortCode}` : null, pin, pinConfigured: Boolean(publication.pinHash), selectionSubmittedAt: publication.selectionSubmittedAt || null };
}

function galleryType(groupType) {
  if (groupType === "Dum Dum") return "DUM_DUM";
  if (groupType === "Qua Qua") return "QUA_QUA";
  if (groupType === "Corp") return "CORP";
  return null;
}

// An expired gallery is revoked the next time anyone looks at it, from either the
// studio side or the client link, so the URL stops working on its own.
async function revokeIfExpired(publication) {
  if (publication.status !== "PUBLISHED" || expiryOf(publication) > new Date()) return publication;
  return repository.revoke(publication.projectId, "EXPIRED");
}

/*
 * Keeps a gallery published exactly while the client has something to look at.
 *
 * Published with no client-visible photo left anywhere in the project (`countClientVisibleImages`:
 * every folder and subfolder, ready, not culled, not waiting in AI Culling or AI Editing, not in a
 * shoot held back until its date) - it is revoked as EMPTY. Revoked as EMPTY with a photo back - it is
 * published again with the token, PIN, short URL and expiry it had, so the link the client was sent
 * works as it did. A gallery the studio unpublished (MANUAL), one that lapsed (EXPIRED) and one
 * revoked before reasons were recorded (null) are never published again by this; nor is an expired
 * one, whose expiry `revokeIfExpired` answers for. Nothing else on the row changes.
 *
 * Asked when the studio's panel loads, when the client opens the link, before a publish, and after
 * every write that can change what the client sees (`syncAvailabilitySoon`).
 */
async function syncAvailability(projectId, now = new Date()) {
  const publication = await repository.findByProject(projectId);
  if (!publication || expiryOf(publication) <= now) return publication;
  if (publication.status === "PUBLISHED") {
    if (await repository.countClientVisibleImages(projectId)) return publication;
    await repository.revokeEmpty(projectId);
    return repository.findByProject(projectId);
  }
  if (publication.status === "REVOKED" && publication.revokedReason === "EMPTY") {
    if (!(await repository.countClientVisibleImages(projectId))) return publication;
    await repository.reviveEmpty(projectId);
    return repository.findByProject(projectId);
  }
  return publication;
}

// The same, from a write path that must not wait on it or fail because of it: an upload finishing,
// a folder deleted, photos sent on from AI Culling or AI Editing. Any error is logged, and the next
// panel load or link open asks again.
function syncAvailabilitySoon(projectId) {
  if (!projectId) return;
  Promise.resolve().then(() => syncAvailability(projectId)).catch((error) => console.warn(`[image-selection publication] availability of ${projectId} not synced: ${error?.message || error}`));
}

// A link held back because the gallery has nothing in it yet: still the client's link, so it says so
// rather than claiming the gallery does not exist.
const notAvailableYet = () => httpError(404, "Your photos are not available yet. Please check back soon.");

// Both counts every serialize needs: how many photos are in the gallery, and how many of them the
// client picked. They travel together because a publish or a PIN change hands the caller a fresh
// status, and dropping the selection count there would hide the Download Selected button until the
// next reload.
const counts = (projectId) => Promise.all([repository.countReadyImages(projectId), repository.countSelectedImages(projectId)]);

async function status(projectId) {
  if (!(await repository.findProject(projectId))) throw httpError(404, "Image Selection project not found.");
  await syncAvailability(projectId);
  const [found, [imageCount, selectedCount]] = await Promise.all([repository.findByProject(projectId), counts(projectId)]);
  let publication = found ? await revokeIfExpired(found) : null;
  // Galleries published before short codes existed pick one up the first time anyone looks.
  if (publication?.status === "PUBLISHED") publication = await ensureShortCode(publication);
  return publication ? serialize(publication, imageCount, selectedCount) : { status: "UNPUBLISHED", publishedAt: null, expiresAt: null, revokedAt: null, imageCount, selectedCount, clientPath: null, shortCode: null, clientUrl: null, pin: null, pinConfigured: false, selectionSubmittedAt: null };
}

/**
 * Submits one selection item's selection, not a shoot's and not the whole gallery.
 *
 * A project's selection items can be ready months apart — the client fills their engagement album
 * long before the wedding album — so each item is sent to the studio on its own the moment it
 * reaches its limit. `deliverableConfigId` names the item being submitted. A submitted item is
 * locked: `updateSelection` refuses to change it, and submitting it again is refused here. The
 * download flow is untouched by this shape — it already reads the per-item flags and offers a
 * shoot's download once every item under that shoot carries one.
 *
 * The publication-level flag keeps its old meaning — the whole job is done — so it is only set
 * once every selection item on the project has been submitted. A gallery with no selection items
 * at all (published before per-item selection existed) still submits the old way.
 *
 * The rules live in `submissionPlan`, pure so they can be checked without a database: the item
 * must exist, an already-sent item refuses a second submit, at least one photo must have been
 * picked for it, and the plan says whether this submit finishes the whole project.
 *
 * Submit All on the client's page sends several items in one request (`deliverableConfigIds`).
 * Every item is checked by the same rules before anything is written, so one that fails refuses
 * the whole request and nothing is half-sent; the items are then stamped in one transaction.
 *
 * The limit is a ceiling, not a quota. A client who wants only seven of the ten they were offered
 * may send seven: the studio would rather have the client's real answer than a padded one, and
 * `updateSelection` still refuses an eleventh. What the limit does gate is the *count* while they
 * are picking, and nothing else.
 */
function submissionPlan(items, deliverableConfigIds, countByConfigId) {
  const wanted = [...new Set([].concat(deliverableConfigIds ?? null))];
  const several = wanted.length > 1;
  for (const id of wanted) {
    const item = items.find((candidate) => candidate.id === id);
    if (!item) throw httpError(404, "That selection item was not found.");
    if (item.selectionSubmittedAt) throw httpError(409, several ? `${item.name} has already been submitted. Nothing was sent - refresh and try again.` : "This selection item has already been submitted.");
    if ((countByConfigId[item.id] || 0) < 1) throw httpError(409, `Select at least one photo for ${item.name} before submitting.${several ? " Nothing was sent." : ""}`);
  }
  return { submittedIds: wanted, completesProject: items.every((other) => other.selectionSubmittedAt || wanted.includes(other.id)) };
}

/*
 * Settings → Automatic WhatsApp Message → Photo Selection Submitted: told once the write above has
 * committed, and not waited for - the client's answer and their saved selection owe nothing to a
 * WhatsApp message. Everything it does is caught and logged; it never throws into this flow.
 */
let submissionListener = (projectId, submittedIds, submittedAt) => require("../../settings/automatic-whatsapp/photoSelection").afterSubmission({ projectId, submittedIds, submittedAt });
// `submittedAt` is the instant the write stamped: with the items, it names this submission - so a
// reopened item sent again is announced again, while a double press or a retry (refused with 409
// before this is reached) never is.
function announceSubmission(projectId, submittedIds, submittedAt) {
  Promise.resolve().then(() => submissionListener(projectId, submittedIds, submittedAt)).catch((error) => console.warn("[photo-selection-notify] could not queue the notification:", error?.message));
}
/** Tests hand in a stand-in listener; the server keeps the real one. */
function setSubmissionListenerForTest(listener) { submissionListener = listener; }

async function submitSelection(token, deliverableConfigId = null, session = null, deliverableConfigIds = null) {
  const publication = await authorize(token);
  assertSessionCurrent(session, publication);
  const items = (await createDeliverableService().list(publication.projectId)).filter((item) => item.enabled && !item.inactiveAt);
  if (!items.length) {
    const submittedAt = await repository.markSelectionSubmitted(publication.projectId);
    await recordClientActivity(publication.projectId);
    announceSubmission(publication.projectId, [], submittedAt);
    return { submitted: true };
  }
  const wanted = deliverableConfigIds?.length ? deliverableConfigIds : deliverableConfigId;
  const countByConfigId = {};
  for (const target of items.filter((item) => [].concat(wanted).includes(item.id) && !item.selectionSubmittedAt))
    countByConfigId[target.id] = await galleryRepository.countDeliverableSelections(publication.projectId, target.id);
  const plan = submissionPlan(items, wanted, countByConfigId);
  // Whether this finishes the project is settled inside the write, under the gallery's lock - the
  // plan's `completesProject` is read from before it and could miss a submit running alongside.
  const submittedAt = await repository.markSubmitted(publication.projectId, plan.submittedIds, items.map((item) => item.id));
  await recordClientActivity(publication.projectId);
  announceSubmission(publication.projectId, plan.submittedIds, submittedAt);
  return deliverableConfigIds?.length ? { submitted: true, deliverableConfigIds: plan.submittedIds } : { submitted: true, deliverableConfigId: deliverableConfigId || null };
}

/**
 * Moves a published gallery's expiry to the date the studio chose in Selection Settings. Called
 * whenever that date is saved; a project with nothing published has nothing to move, and a revoked
 * one is left alone — republishing reads the date again anyway.
 */
async function setExpiry(projectId, expiresAt) {
  const existing = await repository.findByProject(projectId);
  if (!existing || existing.status !== "PUBLISHED") return null;
  return repository.setExpiry(projectId, expiresAt ?? addMonths(existing.publishedAt, (await settings.read()).galleryValidityMonths));
}

/*
 * Starts reading the gallery's scenes as it is published, so the People tab's Scene filter is
 * usually ready before the client opens it - instead of starting on the client's first look and
 * showing "Organizing scenes..." while it runs. The same background pass the gallery would start
 * (`scene/backfill.pending`): one per project, capped per process, never awaited, and a photo
 * already read is never read again. Its failure is the gallery's to retry, never the publish's.
 */
function readScenesAhead(projectId) {
  try {
    require("../ai-culling/scene/backfill").pending(projectId).catch((error) => console.warn(`[image-selection scenes] could not start reading project ${projectId} at publish: ${error.message}`));
  } catch (error) {
    console.warn(`[image-selection scenes] could not start reading project ${projectId} at publish: ${error.message}`);
  }
}

async function publish(projectId, userId) {
  const project = await repository.findProject(projectId);
  if (!project) throw httpError(404, "Image Selection project not found.");
  const [imageCount, selectedCount] = await counts(projectId);
  if (!imageCount) throw httpError(409, "Process at least one image before publishing the gallery.");
  // A gallery revoked only for being empty comes back with its own link and PIN rather than new ones.
  await syncAvailability(projectId);
  const found = await repository.findByProject(projectId);
  const existing = found ? await revokeIfExpired(found) : null;
  if (existing?.status === "PUBLISHED") {
    readScenesAhead(projectId);
    return serialize(await ensureShortCode(existing), imageCount, selectedCount);
  }
  const token = crypto.randomBytes(32).toString("base64url");
  const pin = generatePin();
  const publishedAt = new Date();
  // The expiry the studio set for this project wins; otherwise the studio-wide window applies,
  // read at publish time and stored on the row so the client keeps the expiry they were given even
  // if that window is changed afterwards.
  const { galleryValidityMonths } = await settings.read();
  const expiresAt = project.selectionValidUntil || addMonths(publishedAt, galleryValidityMonths);
  // shortCode is deliberately absent from the upsert data: a republished gallery keeps the code
  // (and so the URL) it already had, and a first publish gets one from ensureShortCode below.
  const publication = await repository.publish(projectId, {
    tokenHash: hashValue(token), tokenCipher: encryptValue(token),
    pinHash: await bcrypt.hash(pin, 12), pinCipher: encryptValue(pin),
    status: "PUBLISHED", publishedByUserId: userId, publishedAt: publishedAt, expiresAt, revokedAt: null, revokedReason: null,
  });
  readScenesAhead(projectId);
  // A newly shared gallery: the client's phone hears their photos are ready to choose.
  if (project.salesProjectId) clientPush.notifyProject(project.salesProjectId, { title: "Your photos are ready to choose", body: "Open the Don't Blink Studioz app to pick your favourites", data: { type: "gallery" } });
  return serialize(await ensureShortCode(publication), imageCount, selectedCount);
}

async function revoke(projectId) {
  const existing = await repository.findByProject(projectId);
  if (!existing) throw httpError(404, "Published gallery not found.");
  // The studio's own switch: MANUAL, so nothing publishes it again by itself - including a gallery
  // that was only held for being empty, which the studio has now chosen to keep down.
  const current = existing.status === "REVOKED" && existing.revokedReason !== "EMPTY" ? existing : await repository.revoke(projectId, "MANUAL");
  return serialize(current, ...(await counts(projectId)));
}

async function regeneratePin(projectId) {
  const existing = await repository.findByProject(projectId);
  if (!existing || existing.status !== "PUBLISHED") throw httpError(409, "Publish the gallery before setting a PIN.");
  const pin = generatePin();
  const updated = await repository.setPin(projectId, { pinHash: await bcrypt.hash(pin, 12), pinCipher: encryptValue(pin) });
  return serialize(updated, ...(await counts(projectId)));
}

// The public identifier is either the legacy 43-character token (links already with clients) or
// the short code. Both resolve to the same publication row and run the same publish/expiry rules
// below — the identifier only names the gallery, it never authenticates: the PIN still does that,
// and PIN-less preview stays exactly the read-only session it always was.
//
// An expired link answers 410 and nothing about itself (`expiredLink`), and keeps answering it: the
// first expired visit revokes the row, so a later one - a refresh, an old bookmark - finds it
// revoked, and a row revoked on or after its expiry is one that lapsed, not one the studio took
// down early, which still answers the same 404 an unknown link does.
function galleryExpired() {
  return expiredLinkError();
}

async function authorize(token) {
  const legacy = LEGACY_TOKEN_PATTERN.test(token);
  const short = !legacy && SHORT_CODE_PATTERN.test(token);
  const publication = legacy
    ? await repository.findByTokenHash(hashValue(token))
    : short ? await repository.findByShortCode(token.toUpperCase()) : null;
  if (!publication || publication.project.deletedAt) {
    const lapsed = legacy ? await repository.findAnyByTokenHash(hashValue(token)) : short ? await repository.findAnyByShortCode(token.toUpperCase()) : null;
    if (lapsed && !lapsed.project.deletedAt && lapsed.status === "REVOKED" && lapsed.revokedAt && expiryOf(lapsed) <= lapsed.revokedAt) throw galleryExpired();
    // Held only for being empty: asked again now, and answered as the published gallery once a photo
    // is back - same link, same PIN.
    if (lapsed && !lapsed.project.deletedAt && lapsed.status === "REVOKED" && lapsed.revokedReason === "EMPTY") {
      if ((await syncAvailability(lapsed.projectId))?.status === "PUBLISHED") return authorize(token);
      throw notAvailableYet();
    }
    throw httpError(404, "Published gallery not found.");
  }
  if (expiryOf(publication) <= new Date()) {
    await repository.revoke(publication.projectId, "EXPIRED");
    throw galleryExpired();
  }
  // Disabled from Expand: the link is paused, not revoked - the row, URL, PIN and expiry are left
  // exactly as they are, so it opens again the moment the project is enabled. Every public gallery
  // route (opening, the PIN, the photos, picking, submitting) comes through here.
  if (publication.project.disabledAt) throw httpError(404, "This gallery is temporarily unavailable. Please check back soon.");
  return publication;
}

// async function meta(token) {
//   const publication = await authorize(token);
//   return { projectName: publication.project.projectName, requiresPin: Boolean(publication.pinHash) };
// }
async function meta(token) {
  const publication = await authorize(token);
  // Opening the link is when the client would find an empty gallery: held back instead, until a photo is in.
  const synced = await syncAvailability(publication.projectId);
  if (synced && synced.status !== "PUBLISHED") throw notAvailableYet();
  // The first thing the client's page asks for, so it is the moment the link was opened.
  await recordGalleryOpened(publication.projectId);
  const imageCount = await repository.countReadyImages(publication.projectId);
  const groupName = await repository.findWhatsappGroupName(publication.project.salesProject?.whatsappGroupNameId);
  // Branding travels with the gallery so the client's page can name and badge the studio without a
  // second, unauthenticated endpoint that would expose settings to anyone who asked.
  const { studioName, galleryLogoUrl } = await settings.read();
  return {
    projectName: publication.project.projectName,
    studioName,
    galleryLogoUrl,
    projectType: galleryType(publication.project.salesProject?.groupType),
    groomName: groupName?.groomName || null,
    brideName: groupName?.brideName || null,
    // A linked project's client is its WhatsApp group's; a manually named one has no group and
    // carries the name the studio typed on the Create New Project form.
    clientName: groupName?.clientName || publication.project.clientName || null,
    companyName: null,
    eventDate: groupName?.mainEventDate || publication.project.salesProject?.mainEventDate || null,
    requiresPin: Boolean(publication.pinHash),
    imageCount,
    expiresAt: expiryOf(publication),
  };
}

async function verifyPin(token, pin) {
  const publication = await authorize(token);
  if (!publication.pinHash) throw httpError(409, "This gallery has not been configured with a PIN yet. Please contact your photographer.");
  // Existing galleries used SHA-256. New and regenerated PINs use bcrypt;
  // accepting the legacy format avoids locking out galleries already published.
  const pinValue = String(pin);
  const matches = publication.pinHash.startsWith("$2")
    ? await bcrypt.compare(pinValue, publication.pinHash)
    : hashValue(pinValue) === publication.pinHash;
  if (!matches) throw httpError(401, "Incorrect PIN. Please check your WhatsApp/email or ask your photographer.");
  const sessionToken = jwt.sign({ scope: SESSION_SCOPE, galleryToken: token, projectId: publication.projectId, pv: pinVersion(publication.pinHash) }, sessionSecret(), { expiresIn: "30d" });
  return { sessionToken, preview: false, projectName: publication.project.projectName };
}

// A short fingerprint of the PIN a session was opened with. Regenerating the PIN, or revoking and
// republishing (a fresh PIN behind the same short code), changes it, so the sessions the old PIN
// opened stop working. Sessions issued before the marker existed carry none and stay accepted.
const pinVersion = (pinHash) => (pinHash ? hashValue(pinHash).slice(0, 16) : null);
function assertSessionCurrent(session, publication) {
  if (session?.pv && session.pv !== pinVersion(publication.pinHash)) throw httpError(401, "Your session has expired. Please enter the PIN again.");
}

async function startPreview(token) {
  const publication = await authorize(token);
  const sessionToken = jwt.sign({ scope: PREVIEW_SCOPE, galleryToken: token, projectId: publication.projectId }, sessionSecret(), { expiresIn: "1d" });
  return { sessionToken, preview: true, projectName: publication.project.projectName };
}

// `allowPreview` is off for anything that writes, so a browsing client is turned back with a
// message the gallery turns into the "enter your PIN to select photos" prompt.
function verifySession(token, authHeader, { allowPreview = true } = {}) {
  if (!authHeader || !authHeader.startsWith("Bearer ")) throw httpError(401, "PIN verification required.");
  let payload;
  try { payload = jwt.verify(authHeader.slice(7), sessionSecret()); } catch { throw httpError(401, "Your session has expired. Please enter the PIN again."); }
  const preview = payload.scope === PREVIEW_SCOPE;
  if ((payload.scope !== SESSION_SCOPE && !preview) || payload.galleryToken !== token) throw httpError(401, "Invalid gallery session.");
  if (preview && !allowPreview) throw httpError(403, "Enter your 4-digit PIN to select photos.");
  return { ...payload, preview };
}

// `decryptValue` is shared with the client portal, which shows a signed-in client their own gallery's PIN.
module.exports = { announceSubmission, setSubmissionListenerForTest, status, syncAvailability, syncAvailabilitySoon, publish, revoke, regeneratePin, setExpiry, authorize, meta, verifyPin, startPreview, verifySession, assertSessionCurrent, submitSelection, submissionPlan, expiryOf, recordGalleryOpened, recordClientActivity, GALLERY_VALIDITY_MONTHS, generateShortCode, ensureShortCode, galleryBaseUrl, SHORT_CODE_ALPHABET, SHORT_CODE_LENGTH, decryptValue };
