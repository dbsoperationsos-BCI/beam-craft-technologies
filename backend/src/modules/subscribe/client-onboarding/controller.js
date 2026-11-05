const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const { Prisma } = require("@prisma/client");
const prisma = require("../../../config/db");
const { storeFavicon, discardUploads } = require("../../../services/imageStorage");
const { SHORT_CODE_PATTERN, generateShortCode } = require("../../../services/shortCode");
const { isConfigured: storageConfigured } = require("../../../config/r2");
const { healthFor, checkAndRecord } = require("./siteHealth");
const { makeSiteKey } = require("./siteApi");
const { subscriptionSchema, generatePassword, subscriptionStatus, accountMessage } = require("./subscription");
const { sendClientOnboardingInviteEmail } = require("../../../services/emailService");
const { PRODUCTS, isProduct, inviteState, contactSchema, clientInviteSchema, submissionSchema, checkUpload, LOGO_RULE, FAVICON_RULE } = require("./rules");

const LOGO_FOLDER = "beamcraft/client-onboarding/logo";
const FAVICON_FOLDER = "beamcraft/client-onboarding/favicon";
const TOKEN_PATTERN = /^[a-f0-9]{64}$/i;

const frontendBaseUrl = () => (process.env.FRONTEND_URL || "http://localhost:3000").replace(/\/$/, "");
const hashToken = (token) => crypto.createHash("sha256").update(token).digest("hex");
const linkFor = (invite) => (invite.shortCode ? `${frontendBaseUrl()}/client-onboarding/apply/${invite.shortCode}` : null);

// The studio and its clients read times in India; the server's own zone must not move the date.
const formatExpiry = (value) => new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }).format(new Date(value));

function fail(status, message) {
  return Object.assign(new Error(message), { status });
}

/** The chosen expiry day ("YYYY-MM-DD") as the end of that day, Indian time. */
const expiryFromDay = (day) => new Date(`${day}T23:59:59+05:30`);

/** The message the team copies and sends: the employee invite's wording, addressed to the client. */
function buildInviteMessage({ link, expiresAt, contactName }) {
  return [
    `Hi ${contactName || "there"},`,
    "",
    "Welcome to Beam Craft. Please complete your company's onboarding details here:",
    link,
    "",
    `The link is open until ${formatExpiry(expiresAt)}.`,
    "",
    "Please keep this link to yourself.",
  ].join("\n");
}

/** Throws `{ status }` unless this invite may take a submission now. */
function assertSubmittable(invite, now = new Date()) {
  const state = inviteState(invite, now);
  if (state === "Submitted") throw fail(409, "This onboarding form has already been submitted.");
  if (state === "Cancelled") throw fail(410, "This onboarding invite has been cancelled.");
  if (state === "Expired") throw fail(410, "This onboarding invite has expired.");
}

/**
 * Claims the invite, then files the company - in that order, inside the caller's transaction.
 *
 * The claim is a conditional write, so of two submits racing (a double-click, a retry during a slow
 * upload) only one finds the invite still open; and a Cancel the team commits a moment earlier is
 * seen, rather than overwritten by a submit that read the row before it.
 */
async function claimAndCreateClient(tx, invite, fields, { logoUrl, faviconUrl }) {
  const claimed = await tx.clientOnboardingInvite.updateMany({
    where: { id: invite.id, submittedAt: null, cancelledAt: null, expiresAt: { gte: new Date() } },
    data: { status: "Submitted", submittedAt: new Date() },
  });
  if (claimed.count !== 1) {
    // Why the claim missed decides what the client is told: only a real earlier submit reads as submitted.
    const current = await tx.clientOnboardingInvite.findUnique({ where: { id: invite.id } });
    if (current?.submittedAt) throw fail(409, "This onboarding form has already been submitted.");
    throw fail(410, current?.cancelledAt ? "This onboarding invite has been cancelled." : "This onboarding invite has expired.");
  }
  const client = await tx.subscriptionClient.create({
    data: { ...fields, product: invite.product, contactEmail: invite.contactEmail, logoUrl, faviconUrl, inviteId: invite.id },
  });
  await tx.clientOnboardingInvite.update({ where: { id: invite.id }, data: { clientId: client.id } });
  return client;
}

/**
 * Without R2 the image service falls back to keeping the whole file as a data URI, which no URL column
 * holds - so say so plainly instead of failing on the insert.
 */
function assertUploadsCanBeStored(configured = storageConfigured) {
  if (!configured) throw fail(503, "File storage is not set up on this server yet, so the logo and favicon cannot be saved. Please try again later.");
}

/**
 * A logo or favicon as submitted: a new upload (a data URI, held to `rule`), or exactly the file the
 * team already attached on the invite. Any other link is refused - the form never stores a URL it
 * was handed.
 */
function resolveSubmittedImage(value, keptUrl, rule) {
  if (String(value).startsWith("data:")) {
    const problem = checkUpload(value, rule);
    if (problem) throw fail(400, problem);
    return { upload: true };
  }
  if (keptUrl && value === keptUrl) return { keep: keptUrl };
  // A stored link that is no longer the kept one: the team replaced the image after this form opened.
  if (/^https?:\/\//.test(String(value))) throw fail(400, "This image was changed by the Beam Craft team after you opened the form. Reload the page, or choose the file again.");
  throw fail(400, `${rule.label}.`);
}

const IMAGES = [["logo", "logoUrl", LOGO_RULE, LOGO_FOLDER], ["favicon", "faviconUrl", FAVICON_RULE, FAVICON_FOLDER]];

/** Stores whichever images the team picked and returns the company as the invite keeps it, or null. */
async function storeCompany(company, uploads) {
  const { logo: _logo, favicon: _favicon, ...stored } = company;
  for (const [key, urlKey, rule, folder] of IMAGES) {
    if (!company[key]) continue;
    const problem = checkUpload(company[key], rule);
    if (problem) throw fail(400, problem);
    assertUploadsCanBeStored();
    // Stored as uploaded (not re-encoded), so the PNG logo keeps its transparency.
    const result = await storeFavicon(company[key], { folder });
    uploads.push(result);
    stored[urlKey] = result.url;
  }
  return Object.keys(stored).length ? stored : null;
}

function serializeInvite(invite, now = new Date()) {
  const { tokenHash, token, ...safe } = invite;
  // The Admin's password hash and the site key's hash never leave the server; only whether a key exists does.
  const client = invite.client ? (({ adminPasswordHash, siteKeyHash, ...rest }) => ({ ...rest, hasSiteKey: Boolean(siteKeyHash), subscription: subscriptionStatus(rest, now) }))(invite.client) : invite.client;
  return { ...safe, ...(client !== undefined ? { client } : {}), productLabel: PRODUCTS[invite.product] || null, state: inviteState(invite, now), link: linkFor(invite) };
}

function respondError(res, error, fallback) {
  if (error?.status) return res.status(error.status).json({ message: error.message });
  console.error(`[subscribe] ${fallback}:`, error?.message);
  return res.status(500).json({ message: fallback });
}

const validationError = (res, error) => res.status(400).json({ message: error.issues?.[0]?.message || "Validation failed", errors: error.flatten() });

/** An invite by the identifier in a link: the 8-character short code, or a long token. */
async function findInviteByLink(identifier) {
  const value = String(identifier || "").trim();
  let where = null;
  if (TOKEN_PATTERN.test(value)) where = { tokenHash: hashToken(value) };
  else if (SHORT_CODE_PATTERN.test(value)) where = { shortCode: value.toUpperCase() };
  const invite = where ? await prisma.clientOnboardingInvite.findUnique({ where }) : null;
  if (!invite) throw fail(404, "This onboarding link is invalid.");
  return invite;
}

// ── Team ────────────────────────────────────────────────────────────────────────────────────────

async function listInvites(req, res) {
  // No product is every client (HRM -> Client Details); a named one must be real.
  const product = req.query.product ? String(req.query.product) : null;
  if (product && !isProduct(product)) return res.status(400).json({ message: "Unknown product." });
  try {
    const invites = await prisma.clientOnboardingInvite.findMany({ where: product ? { product } : {}, include: { client: true }, orderBy: { createdAt: "desc" } });
    const now = new Date();
    // Each live site's health, from the monitor's checks over the last day.
    const health = await healthFor(invites.filter((invite) => invite.client?.activatedAt).map((invite) => invite.client.id), now);
    // A pending row carries its message, so Copy message works from the list as well as on create.
    return res.json({ data: invites.map((invite) => {
      const row = serializeInvite(invite, now);
      if (row.client && health[row.client.id]) row.client.health = health[row.client.id];
      return row.state === "Pending" ? { ...row, message: buildInviteMessage({ link: row.link, expiresAt: row.expiresAt, contactName: row.contactName }) } : row;
    }) });
  } catch (error) {
    return respondError(res, error, "Unable to load client onboarding invites");
  }
}

async function createInvite(req, res) {
  const parsed = clientInviteSchema.safeParse(req.body || {});
  if (!parsed.success) return validationError(res, parsed.error);

  const uploads = [];
  try {
    const { company: prefill, expiresAt: expiryDay, ...contact } = parsed.data;
    const expiresAt = assertFutureExpiry(expiryDay);
    await assertNoLiveInvite(contact.contactEmail);
    const company = await storeCompany(prefill, uploads);
    const token = crypto.randomBytes(32).toString("hex");
    let invite = null;
    // Retry past the unique constraint until an unclaimed code lands, as the employee invite does.
    for (let attempt = 0; attempt < 5 && !invite; attempt += 1) {
      try {
        invite = await prisma.clientOnboardingInvite.create({
          data: { ...contact, company: company ?? undefined, expiresAt, tokenHash: hashToken(token), token, shortCode: generateShortCode(8), createdBy: req.user?.id ? String(req.user.id) : null },
        });
      } catch (error) {
        if (error?.code !== "P2002") throw error;
      }
    }
    if (!invite) throw fail(500, "Unable to create the onboarding invite.");
    const serialized = serializeInvite(invite);
    const message = buildInviteMessage({ link: serialized.link, expiresAt: invite.expiresAt, contactName: invite.contactName });
    return res.status(201).json({ data: { invite: serialized, link: serialized.link, message } });
  } catch (error) {
    if (uploads.length) await discardUploads(uploads).catch(() => {});
    return respondError(res, error, "Unable to create the onboarding invite");
  }
}

/** An expiry day the link can still be opened on: today or later, Indian time. */
function assertFutureExpiry(day) {
  const expiresAt = expiryFromDay(day);
  if (Number.isNaN(expiresAt.getTime()) || expiresAt < new Date()) throw fail(400, "The expiry date must be today or later.");
  return expiresAt;
}

/** One live link per client email, as the employee invite refuses a second for the same candidate. */
async function assertNoLiveInvite(contactEmail, exceptId = null) {
  const live = await prisma.clientOnboardingInvite.findFirst({
    where: { contactEmail, submittedAt: null, cancelledAt: null, expiresAt: { gt: new Date() }, ...(exceptId ? { NOT: { id: exceptId } } : {}) },
    select: { id: true },
  });
  if (live) throw fail(409, "This client already has a live onboarding link. Edit or cancel it in View All Invites.");
}

/**
 * View All Invites -> Edit: corrects who the link is for, or moves its expiry. The link itself is kept,
 * so the one already sent keeps working. Not once submitted (that is the filed record) or cancelled
 * (cancelling was a decision an edit must not undo).
 */
async function updateInviteContact(req, res) {
  const parsed = contactSchema.safeParse(req.body || {});
  if (!parsed.success) return validationError(res, parsed.error);
  try {
    const invite = await prisma.clientOnboardingInvite.findUnique({ where: { id: String(req.params.id) } });
    if (!invite) throw fail(404, "Onboarding invite not found.");
    const state = inviteState(invite);
    if (state === "Submitted" || state === "Cancelled") throw fail(400, `This invite is ${state.toLowerCase()} and can no longer be edited.`);
    const { expiresAt: expiryDay, ...contact } = parsed.data;
    const expiresAt = assertFutureExpiry(expiryDay);
    await assertNoLiveInvite(contact.contactEmail, invite.id);
    const updated = await prisma.clientOnboardingInvite.update({ where: { id: invite.id }, data: { ...contact, expiresAt } });
    const serialized = serializeInvite(updated);
    const message = buildInviteMessage({ link: serialized.link, expiresAt: updated.expiresAt, contactName: updated.contactName });
    return res.json({ data: { invite: serialized, link: serialized.link, message } });
  } catch (error) {
    return respondError(res, error, "Unable to update the invite");
  }
}

/** Send Invite: the link emailed to the client's address, through the studio's mail pool. */
async function sendInvite(req, res) {
  try {
    const invite = await prisma.clientOnboardingInvite.findUnique({ where: { id: String(req.params.id) } });
    if (!invite) throw fail(404, "Onboarding invite not found.");
    if (inviteState(invite) !== "Pending") throw fail(400, `This invite is ${inviteState(invite).toLowerCase()}, so it cannot be sent.`);
    if (!invite.contactEmail) throw fail(400, "This invite has no client email. Edit it to add one.");
    const link = linkFor(invite);
    const result = await sendClientOnboardingInviteEmail({ contactName: invite.contactName || "there", email: invite.contactEmail, onboardingUrl: link, expiresAt: invite.expiresAt });
    if (result?.sent === false) throw fail(503, `The email could not be sent: ${result.reason || "no sender is set up"}. Copy the message and send it yourself.`);
    return res.json({ message: `Invite emailed to ${invite.contactEmail}.` });
  } catch (error) {
    if (!error?.status) return res.status(502).json({ message: "The email could not be sent. Copy the message and send it yourself." });
    return respondError(res, error, "Unable to send the invite");
  }
}

async function cancelInvite(req, res) {
  try {
    const invite = await prisma.clientOnboardingInvite.findUnique({ where: { id: String(req.params.id) } });
    if (!invite) throw fail(404, "Onboarding invite not found.");
    if (inviteState(invite) !== "Pending") throw fail(400, `This invite is ${inviteState(invite).toLowerCase()} and can no longer be cancelled.`);
    const updated = await prisma.clientOnboardingInvite.update({ where: { id: invite.id }, data: { status: "Cancelled", cancelledAt: new Date() } });
    return res.json({ data: serializeInvite(updated) });
  } catch (error) {
    return respondError(res, error, "Unable to cancel the invite");
  }
}

/** One row gone: its company (when it has one), then its invite. Inside the caller's transaction. */
async function deleteInviteAndClient(tx, id) {
  const invite = await tx.clientOnboardingInvite.findUnique({ where: { id: String(id) } });
  if (!invite) throw fail(404, "Client not found.");
  await tx.subscriptionClient.deleteMany({ where: { inviteId: invite.id } });
  await tx.clientOnboardingInvite.delete({ where: { id: invite.id } });
}

const deleteRow = (id) => prisma.$transaction((tx) => deleteInviteAndClient(tx, id));

async function deleteInvite(req, res) {
  try {
    await deleteRow(req.params.id);
    return res.json({ message: "Client deleted." });
  } catch (error) {
    return respondError(res, error, "Unable to delete the client");
  }
}

/** The product an Edit sets: a real one, "" to clear it, or undefined to leave it as it is. */
function productFromEdit(value) {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (!isProduct(value)) throw fail(400, "Unknown product.");
  return value;
}

/**
 * A set-up account's modules belong to its product, so moving it to another product (or none) is done
 * in Edit subscription, where the modules are chosen again - never from the plain Edit.
 */
function assertProductEditable(invite, product) {
  if (product === undefined || !invite?.client?.activatedAt || product === invite.product) return;
  throw fail(400, "This client's account is set up. Change its product in Edit subscription, where its modules are chosen again.");
}

/**
 * Edit a row's company details, and which product it is under. A submitted company is the filed record, so every field stays
 * required; a pending invite is what the client's form will open with, so any may be left blank.
 * Images are a new upload or the file already stored on the row.
 */
async function updateInvite(req, res) {
  const uploads = [];
  try {
    const invite = await prisma.clientOnboardingInvite.findUnique({ where: { id: String(req.params.id) }, include: { client: true } });
    if (!invite) throw fail(404, "Client not found.");
    const current = invite.client || invite.company || {};
    const product = productFromEdit(req.body?.product);
    assertProductEditable(invite, product);
    const parsed = (invite.client ? submissionSchema : clientInviteSchema.shape.company).safeParse(req.body?.company ?? {});
    if (!parsed.success) return validationError(res, parsed.error);

    const { logo: _logo, favicon: _favicon, ...fields } = parsed.data;
    const images = {};
    for (const [key, urlKey, rule, folder] of IMAGES) {
      if (!parsed.data[key]) continue;
      const resolved = resolveSubmittedImage(parsed.data[key], current[urlKey], rule);
      if (resolved.keep) { images[urlKey] = resolved.keep; continue; }
      assertUploadsCanBeStored();
      const stored = await storeFavicon(parsed.data[key], { folder });
      uploads.push(stored);
      images[urlKey] = stored.url;
    }

    const productChange = product === undefined ? {} : { product };
    await prisma.$transaction(async (tx) => {
      if (invite.client) {
        await tx.subscriptionClient.update({ where: { id: invite.client.id }, data: { ...fields, ...images, ...productChange } });
        await tx.clientOnboardingInvite.update({ where: { id: invite.id }, data: productChange });
      } else {
        const company = { ...fields, ...images };
        await tx.clientOnboardingInvite.update({ where: { id: invite.id }, data: { company: Object.keys(company).length ? company : Prisma.DbNull, ...productChange } });
      }
    });
    return res.json({ message: "Client details saved." });
  } catch (error) {
    if (uploads.length) await discardUploads(uploads).catch(() => {});
    return respondError(res, error, "Unable to save the client details");
  }
}

/** Only a company that has submitted its form can have an account set up. */
function assertCanSetUp(invite) {
  if (!invite) throw fail(404, "Client not found.");
  if (!invite.client) throw fail(400, "Set up the account after the client has submitted the onboarding form.");
}

/** A new Admin password is made on the first setup, or when the team asks for a reset - never otherwise. */
const passwordChange = ({ firstTime, resetPassword }) => Boolean(firstTime || resetPassword);

/** A new Admin password as stored: its bcrypt hash, and when it was made - which tells the client's site to take it. */
const passwordColumns = async (password, now = new Date()) => ({ adminPasswordHash: await bcrypt.hash(password, 10), adminPasswordSetAt: now });

const asDate = (value) => new Date(`${value}T00:00:00Z`);

/** A saved subscription (the form's body, dates as "YYYY-MM-DD") as the columns the client's site reads. */
function liveFields({ product, subdomain, usersAllowed, adminUsername, validFrom, validUntil, modules }) {
  return { product, subdomain, usersAllowed, adminUsername, validFrom: asDate(validFrom), validUntil: asDate(validUntil), modules };
}

/** Update site: the pending change as the next live version, with the pending slot cleared. */
function publishPending(client) {
  if (!client?.pendingChanges) throw fail(400, "There is no change waiting to go live.");
  const version = (client.liveVersion || 0) + 1;
  return { version, data: { ...liveFields(client.pendingChanges), liveVersion: version, publishedAt: new Date(), pendingChanges: Prisma.DbNull } };
}

/** What a unique-key clash on a subscription save means: the subdomain, or a save someone else just made. */
function conflictMessage(error) {
  const target = [].concat(error?.meta?.target || []).join(",");
  if (/version/.test(target)) return "This was just saved by someone else. Reload the page to see the latest.";
  return "That subdomain is already used by another client.";
}

/**
 * Another client already holding `subdomain` - live on it, or with it in a change waiting for Update site,
 * which reserves it. Checked when a change is saved as well as when it goes live, so a change that saved
 * cleanly is never refused later by somebody else's setup.
 */
async function assertSubdomainFree(subdomain, clientId, db = prisma) {
  const taken = await db.subscriptionClient.findFirst({
    where: { NOT: { id: clientId }, OR: [{ subdomain }, { pendingChanges: { path: "$.subdomain", equals: subdomain } }] },
    select: { id: true },
  });
  if (taken) throw fail(409, "That subdomain is already used by another client.");
}

const publishedBy = (req) => (req.user?.id ? String(req.user.id) : null);

/**
 * Client Details -> Set up account / Edit subscription.
 *
 * The first setup goes live at once, as version 1. After that the client's site is live, so a change is
 * held as pending until Update site publishes it - except a password reset, which is about getting in
 * rather than about the site, and happens immediately. The Admin's password is returned (inside the
 * message to send) only when one was just made.
 */
async function saveSubscription(req, res) {
  const parsed = subscriptionSchema.safeParse(req.body || {});
  if (!parsed.success) return validationError(res, parsed.error);
  const { resetPassword, ...subscription } = parsed.data;
  try {
    const invite = await prisma.clientOnboardingInvite.findUnique({ where: { id: String(req.params.id) }, include: { client: true } });
    assertCanSetUp(invite);
    const { client } = invite;
    await assertSubdomainFree(subscription.subdomain, client.id);
    const firstTime = !client.activatedAt;
    const password = passwordChange({ firstTime, resetPassword }) ? generatePassword() : null;
    const passwordData = password ? await passwordColumns(password) : {};

    if (firstTime) {
      const live = liveFields(subscription);
      await prisma.$transaction([
        prisma.subscriptionClient.update({ where: { id: client.id }, data: { ...live, ...passwordData, activatedAt: new Date(), liveVersion: 1, publishedAt: new Date(), pendingChanges: Prisma.DbNull } }),
        prisma.subscriptionVersion.create({ data: { clientId: client.id, version: 1, snapshot: subscription, publishedBy: publishedBy(req) } }),
        // The product page lists by the invite's product, so the two move together.
        prisma.clientOnboardingInvite.update({ where: { id: invite.id }, data: { product: subscription.product } }),
      ]);
    } else {
      await prisma.subscriptionClient.update({ where: { id: client.id }, data: { pendingChanges: subscription, ...passwordData } });
    }

    const message = password ? accountMessage({ contactName: client.mainContactName, subdomain: firstTime ? subscription.subdomain : client.subdomain, adminUsername: firstTime ? subscription.adminUsername : client.adminUsername, password, validUntil: firstTime ? asDate(subscription.validUntil) : client.validUntil }) : null;
    return res.json({ message: firstTime ? "Account set up." : "Change saved. Use Update site to put it live.", data: { password, accountMessage: message } });
  } catch (error) {
    if (error?.code === "P2002") return res.status(409).json({ message: conflictMessage(error) });
    return respondError(res, error, "Unable to save the account");
  }
}

/** SUBSCRIBE -> Check now: a live client's site checked at once, its summary returned. */
async function checkSiteNow(req, res) {
  try {
    const invite = await prisma.clientOnboardingInvite.findUnique({ where: { id: String(req.params.id) }, include: { client: true } });
    if (!invite?.client?.activatedAt || !invite.client.subdomain) throw fail(400, "This client has no live site to check yet.");
    await checkAndRecord(invite.client);
    const summary = (await healthFor([invite.client.id]))[invite.client.id];
    return res.json({ message: summary.status === "Up" ? "The site is up." : `The site is down: ${summary.error || "no answer"}.`, data: summary });
  } catch (error) {
    return respondError(res, error, "Unable to check the site");
  }
}

/** Only an account that is set up has an Admin whose password can be reset. */
function assertCanResetPassword(invite) {
  if (!invite) throw fail(404, "Client not found.");
  if (!invite.client?.activatedAt) throw fail(400, "Set up this client's account first; the password is made then.");
}

/**
 * Client Details -> Reset password: for an Admin who has forgotten it. Immediate - it is about getting in,
 * not about what the site does, so it never waits for Update site - and the new password is shown once,
 * inside the message to send the client.
 */
async function resetAdminPassword(req, res) {
  try {
    const invite = await prisma.clientOnboardingInvite.findUnique({ where: { id: String(req.params.id) }, include: { client: true } });
    assertCanResetPassword(invite);
    const { client } = invite;
    const password = generatePassword();
    await prisma.subscriptionClient.update({ where: { id: client.id }, data: await passwordColumns(password) });
    const message = accountMessage({ contactName: client.mainContactName, subdomain: client.subdomain, adminUsername: client.adminUsername, password, validUntil: client.validUntil });
    return res.json({ message: "Password reset.", data: { password, accountMessage: message } });
  } catch (error) {
    return respondError(res, error, "Unable to reset the password");
  }
}

/** Only an account that is set up has a site to read its subscription. */
function assertCanMakeSiteKey(invite) {
  if (!invite) throw fail(404, "Client not found.");
  if (!invite.client?.activatedAt) throw fail(400, "Set up this client's account first; the site key is for its live site.");
}

/**
 * Client Details -> Site key: a new key for the client's server, replacing any old one at once. Only its
 * SHA-256 hash is stored; the key is returned this once, for the server's `.env`.
 */
async function createSiteKey(req, res) {
  try {
    const invite = await prisma.clientOnboardingInvite.findUnique({ where: { id: String(req.params.id) }, include: { client: true } });
    assertCanMakeSiteKey(invite);
    const { key, hash } = makeSiteKey();
    await prisma.subscriptionClient.update({ where: { id: invite.client.id }, data: { siteKeyHash: hash } });
    return res.json({ message: "Site key made.", data: { siteKey: key, subdomain: invite.client.subdomain } });
  } catch (error) {
    return respondError(res, error, "Unable to make the site key");
  }
}

/** Client Details -> Update site: the saved change goes live on the client's site as the next version. */
async function publishSubscription(req, res) {
  try {
    const invite = await prisma.clientOnboardingInvite.findUnique({ where: { id: String(req.params.id) }, include: { client: true } });
    assertCanSetUp(invite);
    const { client } = invite;
    const { version, data } = publishPending(client);
    await assertSubdomainFree(client.pendingChanges.subdomain, client.id);
    await prisma.$transaction([
      prisma.subscriptionClient.update({ where: { id: client.id }, data }),
      prisma.subscriptionVersion.create({ data: { clientId: client.id, version, snapshot: client.pendingChanges, publishedBy: publishedBy(req) } }),
      prisma.clientOnboardingInvite.update({ where: { id: invite.id }, data: { product: client.pendingChanges.product } }),
    ]);
    return res.json({ message: `Site updated to version ${version}.`, data: { version } });
  } catch (error) {
    if (error?.code === "P2002") return res.status(409).json({ message: conflictMessage(error) });
    return respondError(res, error, "Unable to update the site");
  }
}

/** Client Details -> Discard changes: the saved change is dropped; the live site is untouched. */
async function discardPending(req, res) {
  try {
    const invite = await prisma.clientOnboardingInvite.findUnique({ where: { id: String(req.params.id) }, include: { client: true } });
    assertCanSetUp(invite);
    await prisma.subscriptionClient.update({ where: { id: invite.client.id }, data: { pendingChanges: Prisma.DbNull } });
    return res.json({ message: "Pending change discarded." });
  } catch (error) {
    return respondError(res, error, "Unable to discard the change");
  }
}

// ── Public (the client's link) ──────────────────────────────────────────────────────────────────

async function getPublicInvite(req, res) {
  try {
    const invite = await findInviteByLink(req.params.token);
    const state = inviteState(invite);
    return res.json({ expiresAt: invite.expiresAt, state, company: state === "Pending" ? invite.company || null : null });
  } catch (error) {
    return respondError(res, error, "Unable to open the onboarding link");
  }
}

async function submitPublicInvite(req, res) {
  const parsed = submissionSchema.safeParse(req.body);
  if (!parsed.success) return validationError(res, parsed.error);
  const { logo: _logo, favicon: _favicon, ...fields } = parsed.data;

  const uploads = [];
  try {
    const invite = await findInviteByLink(req.params.token);
    assertSubmittable(invite);
    const images = {};
    for (const [key, urlKey, rule, folder] of IMAGES) {
      const resolved = resolveSubmittedImage(parsed.data[key], invite.company?.[urlKey], rule);
      if (resolved.keep) { images[urlKey] = resolved.keep; continue; }
      assertUploadsCanBeStored();
      // Stored as uploaded (not re-encoded), so the PNG logo keeps its transparency.
      const stored = await storeFavicon(parsed.data[key], { folder });
      uploads.push(stored);
      images[urlKey] = stored.url;
    }
    const client = await prisma.$transaction((tx) => claimAndCreateClient(tx, invite, fields, images));
    return res.status(201).json({ data: { id: client.id, companyName: client.companyName } });
  } catch (error) {
    if (uploads.length) await discardUploads(uploads).catch(() => {});
    // P2034: the transaction lost a write conflict with a racing submit - the same answer as losing the claim.
    if (error?.code === "P2002" || error?.code === "P2034") return res.status(409).json({ message: "This onboarding form has already been submitted." });
    return respondError(res, error, "Unable to submit the onboarding form");
  }
}

module.exports = { updateInviteContact, sendInvite, serializeInvite, passwordColumns, assertCanMakeSiteKey, createSiteKey, conflictMessage, assertSubdomainFree, assertCanResetPassword, resetAdminPassword, checkSiteNow, liveFields, publishPending, publishSubscription, discardPending, assertProductEditable, assertCanSetUp, passwordChange, saveSubscription, productFromEdit, deleteInviteAndClient, deleteRow, deleteInvite, updateInvite, buildInviteMessage, assertSubmittable, claimAndCreateClient, assertUploadsCanBeStored, resolveSubmittedImage, listInvites, createInvite, cancelInvite, getPublicInvite, submitPublicInvite };
