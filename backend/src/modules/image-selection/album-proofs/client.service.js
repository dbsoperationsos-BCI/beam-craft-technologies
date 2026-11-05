const repository = require("./repository");
const { createAlbumProofService, clientLabel } = require("./service");
const { storedPath, parsePath } = require("./paint");
const security = require("./security");
const r2 = require("../storage/r2");
const { SHORT_CODE_PATTERN, generateShortCode } = require("../../../services/shortCode");

function httpError(status, message, details) { const error = new Error(message); error.status = status; if (details) error.details = details; return error; }
const unavailable = () => httpError(404, "This album proof is not available.");

// How long a new client link lives. Six calendar months, not 180-odd days: a link made on the 31st
// of a month lands on the last day of the target month rather than skidding into the next one,
// which is what plain day arithmetic does and what made two links made a month apart expire on
// dates the studio could not explain.
/*
 * The client's URL. `/p/AB7KX2` for anything published since the short code existed, and the
 * original `/album-proof/<43-character token>` for a link that predates it - which is not a
 * fallback so much as a promise: a URL a client already has must keep working, so an old
 * publication is never quietly given a code and never stops answering on the URL it was shared as.
 *
 * The code is the shared one the client gallery uses: an alphabet with no 0/O, 1/I or L, random,
 * and carrying no album, project or database id.
 */
const PROOF_SHORT_PATH = "/p";
const clientPathFor = (publication, token) => (publication?.shortCode ? `${PROOF_SHORT_PATH}/${publication.shortCode}` : `/album-proof/${token}`);

const DEFAULT_EXPIRY_MONTHS = 6;
function addCalendarMonths(date, months) {
  const result = new Date(date.getTime());
  const day = result.getDate();
  result.setDate(1);
  result.setMonth(result.getMonth() + months);
  const lastDayOfTarget = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate();
  result.setDate(Math.min(day, lastDayOfTarget));
  return result;
}

// What the client's portal calls each state — never the admin vocabulary.
const CLIENT_STATUS_LABELS = {
  CLIENT_REVIEW: "Ready for Your Review",
  CLIENT_CHANGES_REQUESTED: "Changes Submitted",
  REVISION_IN_PROGRESS: "Changes in Progress",
  REVISION_READY_FOR_QC: "Changes in Progress",
  QC_REVIEW: "Changes in Progress",
  QC_APPROVED: "Updated Album Ready Soon",
  READY_FOR_CLIENT: "Updated Album Ready Soon",
  CLIENT_APPROVED: "Approved",
  COMPLETED: "Completed",
};

/**
 * The client side of Album Proofing: staff publish a QC-approved version behind a secure link and
 * PIN; the client reviews, pins corrections (editable until sent), and either submits one
 * correction round — consuming exactly one revision — or approves. Every rule is transacted and
 * unique-constrained so a double-click can never spend two rounds or approve twice.
 */
function createAlbumClientService(repo = repository, dependencies = {}) {
  const base = dependencies.base || createAlbumProofService(repo, dependencies);
  const crypto = dependencies.security || security;
  const objects = dependencies.objects || r2;
  const { requireActiveAlbum, transition } = base._internals;

  const staffActor = (user) => ({ actorType: "STAFF", actorUserId: user?.id ?? null, actorLabel: user?.name ?? null });
  const clientActor = () => ({ actorType: "CLIENT", actorLabel: "Client" });
  const record = (albumId, event, actor, extra = {}) => repo.recordActivity({ albumId, event, ...actor, ...extra });

  // ----- staff: publish / credentials / revoke / grant -----

  /**
   * The short code is allocated here rather than read back from a sequence, so two publishes
   * racing cannot be handed the same URL: the unique index decides, and a loser simply draws
   * again. Five draws from ~887 million codes failing means something other than collision is
   * wrong, so it is an error rather than a silent link with no code.
   */
  async function createWithShortCode(data, attempts = 5) {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try { return await repo.createPublication({ ...data, shortCode: generateShortCode() }); }
      catch (error) { if (error?.code !== "P2002") throw error; }
    }
    throw httpError(500, "Unable to allocate a client proof link. Please try again.");
  }

  /**
   * Send to Client: only a QC-approved version leaves the studio. Fresh credentials each time.
   *
   * An album already in client review may be sent again - that is how an expired link, or one the
   * client lost, is replaced: the previous publication is revoked below and the status does not
   * move. The version is the same frozen one, so nothing the client has marked on it is lost.
   */
  async function publish(albumId, user) {
    const album = await requireActiveAlbum(albumId);
    if (!["QC_APPROVED", "READY_FOR_CLIENT", "CLIENT_REVIEW"].includes(album.status)) throw httpError(409, "Only a QC-approved album can be sent to the client.");
    const version = await repo.findVersion(albumId, album.currentVersionId);
    if (!version || version.status !== "FROZEN") throw httpError(409, "The album's current version is not frozen.");
    const token = crypto.generateToken();
    const pin = crypto.generatePin();
    const expiresAt = addCalendarMonths(new Date(), DEFAULT_EXPIRY_MONTHS);
    await repo.revokeActivePublications(albumId);
    const draft = {
      albumId, versionId: version.id, revisionNumber: album.revisionsUsed + 1,
      tokenHash: crypto.hashValue(token), tokenCipher: crypto.encryptValue(token),
      pinHash: await crypto.hashPin(pin), pinCipher: crypto.encryptValue(pin),
      expiresAt, publishedByUserId: user?.id ?? null,
    };
    const publication = await createWithShortCode(draft);
    await transition(albumId, album.status, "CLIENT_REVIEW");
    await record(albumId, "PUBLISHED_TO_CLIENT", staffActor(user), { versionId: version.id, detail: `V${version.versionNumber} · expires ${expiresAt.toISOString().slice(0, 10)}` });
    // The one response carrying the plain credentials: the moment of publishing, to hand over.
    return { publicationId: publication.id, clientPath: clientPathFor(publication, token), shortCode: publication.shortCode || null, pin, expiresAt, versionNumber: version.versionNumber, revisionNumber: publication.revisionNumber };
  }

  async function publicationInfo(albumId) {
    await base._internals.requireAlbum(albumId);
    const publication = await repo.latestPublication(albumId);
    if (!publication) return null;
    return { ...publication, active: !publication.revokedAt && (!publication.expiresAt || publication.expiresAt > new Date()) };
  }

  /**
   * Gives a link published before the short code existed one of its own.
   *
   * Purely additive, which is the whole reason it is safe to do to a link that is already with a
   * client: the token goes on resolving, so `/album-proof/<token>` keeps working exactly as it
   * did, and the short URL simply starts working as well. Nothing is rotated - a code, once
   * allocated, is never drawn again - so the studio sees one stable URL from here on rather than
   * a long one it cannot read out. A link published since carries its code already and never
   * reaches the loop.
   *
   * Failing to allocate is not worth failing a reveal over: the long URL still works, so the card
   * shows that instead and the next reveal tries again.
   */
  async function ensureShortCode(publication, attempts = 5) {
    if (!publication || publication.shortCode) return publication;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const shortCode = generateShortCode();
      try {
        await repo.updatePublication(publication.id, { shortCode });
        return { ...publication, shortCode };
      } catch (error) { if (error?.code !== "P2002") throw error; }
    }
    return publication;
  }

  /** Copy Link / Show PIN, a write-permission action — the ciphers exist so credentials CAN be re-shown. */
  async function revealCredentials(albumId) {
    await base._internals.requireAlbum(albumId);
    const stored = await ensureShortCode(await repo.readPublicationCredentials(albumId));
    if (!stored) throw httpError(404, "No live client publication.");
    return { clientPath: clientPathFor(stored, crypto.decryptValue(stored.tokenCipher)), shortCode: stored.shortCode || null, pin: crypto.decryptValue(stored.pinCipher), expiresAt: stored.expiresAt };
  }

  /**
   * Revoking the link takes the album out of client review as well: nobody can review it now, and
   * READY_FOR_CLIENT is the state Send to Client answers from. It used to revoke the publication
   * alone, which left the album in review with no reviewer and no path forward but the database.
   */
  async function revoke(albumId, user) {
    const album = await base._internals.requireAlbum(albumId);
    await repo.revokeActivePublications(albumId);
    if (album.status === "CLIENT_REVIEW") await transition(albumId, "CLIENT_REVIEW", "READY_FOR_CLIENT");
    await record(albumId, "PUBLICATION_REVOKED", staffActor(user));
    return { revoked: true };
  }

  /** The link the studio is managing: the latest one that has not been revoked. */
  async function livePublication(albumId) {
    await base._internals.requireAlbum(albumId);
    const publication = await repo.latestPublication(albumId);
    if (!publication || publication.revokedAt) throw httpError(404, "No live client publication.");
    return publication;
  }

  /**
   * Reset PIN: a new PIN for the same link. The URL, the album, the version and the expiry are
   * untouched — only the digits change, and the old ones stop working the moment this returns,
   * because the hash the gate checks against is replaced in the same write.
   */
  async function resetPin(albumId, user) {
    const publication = await livePublication(albumId);
    const pin = crypto.generatePin();
    await repo.updatePublication(publication.id, { pinHash: await crypto.hashPin(pin), pinCipher: crypto.encryptValue(pin) });
    await record(albumId, "CLIENT_PIN_RESET", staffActor(user));
    // Shown once here for the same reason publish shows it: this is the hand-over moment.
    return { pin };
  }

  /** Move the expiry of the live link. Nothing else about the share moves with it. */
  async function updateExpiry(albumId, expiresAt, user) {
    const publication = await livePublication(albumId);
    const before = publication.expiresAt ? publication.expiresAt.toISOString().slice(0, 10) : "none";
    const updated = await repo.updatePublication(publication.id, { expiresAt });
    await record(albumId, "CLIENT_EXPIRY_CHANGED", staffActor(user), { detail: `${before} → ${expiresAt.toISOString().slice(0, 10)}` });
    return { ...updated, active: !updated.revokedAt && (!updated.expiresAt || updated.expiresAt > new Date()) };
  }

  /** One extra client round, audited — the used count never resets. */
  async function grantExtraRevision(albumId, user) {
    const album = await requireActiveAlbum(albumId);
    if (album.revisionLimit == null) return { revisionLimit: null };
    const updated = await repo.updateAlbum(albumId, { revisionLimit: album.revisionLimit + 1 });
    await record(albumId, "REVISION_GRANTED", staffActor(user), { detail: `Limit ${album.revisionLimit} → ${updated.revisionLimit}` });
    return { revisionLimit: updated.revisionLimit };
  }

  // ----- client: resolve / gate / proof / corrections / submit / approve -----

  /**
   * One submission per version, which the (version, type) unique already enforces: two Send taps
   * racing each other, or a stale tab, hit it as P2002. That is the client having already done
   * this, not a failure - so it is told so, rather than "unable to submit".
   */
  function alreadySubmitted(error) {
    if (error?.code === "P2002") throw httpError(409, "This version has already been submitted. Reload to see where it stands.");
    throw error;
  }

  /**
   * A public URL's last segment, whichever spelling it is. Anything that is neither a token nor a
   * short code is not looked up at all - the database is never asked about a string that could not
   * be a link - and the caller gets the same generic refusal as a wrong one.
   */
  function findByUrlKey(value) {
    const key = String(value || "");
    if (crypto.TOKEN_PATTERN.test(key)) return repo.findPublicationByTokenHash(crypto.hashValue(key));
    if (SHORT_CODE_PATTERN.test(key)) return repo.findPublicationByShortCode(key.toUpperCase());
    return null;
  }

  /** Every public call starts here, and every failure is the one generic refusal. */
  async function resolve(token) {
    const publication = await findByUrlKey(token);
    if (!publication || publication.revokedAt) throw unavailable();
    if (publication.expiresAt && publication.expiresAt <= new Date()) throw httpError(410, "This proof link has expired. Please contact the studio for a new link.");
    const album = publication.album;
    if (!album || album.deletedAt || album.archivedAt) throw unavailable();
    return { publication, album, version: publication.version };
  }

  async function meta(token) {
    const { publication, album, version } = await resolve(token);
    return {
      albumName: album.name, clientName: clientLabel(album.project), projectName: album.project?.projectName ?? "",
      versionNumber: version.versionNumber, requiresPin: true,
      revisionNumber: publication.revisionNumber, revisionLimit: album.revisionLimit,
      statusLabel: CLIENT_STATUS_LABELS[album.status] || "In Progress",
      expiresAt: publication.expiresAt,
      /*
       * How many boxes the PIN gate draws.
       *
       * PINs are four digits now; links shared before that carry six and cannot be edited, so the
       * gate has to be told which this one is rather than assume. The length is all that leaves the
       * server - never the PIN - and it is read from this publication's own record. A link whose
       * cipher cannot be read falls back to four, the length everything issued from now on uses.
       */
      pinLength: await pinLengthOf(publication.id),
    };
  }

  /** The length of one publication's PIN, for the gate. The PIN itself stays here. */
  async function pinLengthOf(publicationId) {
    try {
      const stored = await repo.readPublicationPin(publicationId);
      const pin = stored?.pinCipher ? crypto.decryptValue(stored.pinCipher) : "";
      return pin.length === 6 ? 6 : crypto.PIN_LENGTH;
    } catch { return crypto.PIN_LENGTH; }
  }

  async function verifyPin(token, pin, address) {
    // The meter ticks before the lookup, so unresolvable tokens burn attempts too.
    crypto.registerPinAttempt(crypto.hashValue(String(token || "")), address || "unknown");
    const { publication, album } = await resolve(token);
    if (!(await crypto.comparePin(pin, publication.pinHash))) throw httpError(401, "Incorrect PIN. Please check and try again.");
    crypto.clearPinAttempts(crypto.hashValue(token), address || "unknown");
    await repo.recordPublicationAccess(publication.id);
    await record(album.id, "CLIENT_PIN_VERIFIED", clientActor(), { versionId: publication.versionId });
    await record(album.id, "CLIENT_OPENED", clientActor(), { versionId: publication.versionId });
    return { sessionToken: crypto.signSession(token, publication.id, album.id) };
  }

  /** The whole review payload: pages, own pins, submission state, revision arithmetic. */
  async function proof(token) {
    const { publication, album, version } = await resolve(token);
    const pages = await repo.listVersionPages(version.id);
    const corrections = await repo.listCorrections(album.id, { versionId: version.id, source: "CLIENT" });
    const [correctionsSubmitted, approval] = await Promise.all([
      repo.findSubmission(version.id, "CORRECTIONS"),
      repo.findSubmission(version.id, "APPROVAL"),
    ]);
    const locked = Boolean(correctionsSubmitted || approval || album.status !== "CLIENT_REVIEW");
    return {
      albumName: album.name, clientName: clientLabel(album.project),
      versionNumber: version.versionNumber,
      statusLabel: CLIENT_STATUS_LABELS[album.status] || "In Progress",
      revision: { number: publication.revisionNumber, limit: album.revisionLimit, used: album.revisionsUsed },
      locked,
      submitted: correctionsSubmitted ? { at: correctionsSubmitted.submittedAt, count: correctionsSubmitted.correctionCount } : null,
      approved: approval ? { at: approval.submittedAt } : Boolean(album.approvedVersionId && album.approvedVersionId === version.id),
      pages: pages.map((page) => ({
        id: page.id, pageNumber: page.pageNumber, fileName: page.fileName,
        width: page.width, height: page.height, changedFromPrevious: page.changedFromPrevious,
        previewUrl: objects.publicUrl(page.previewKey), thumbnailUrl: objects.publicUrl(page.thumbnailKey),
      })),
      corrections: corrections.map((correction) => ({
        id: correction.id, versionPageId: correction.versionPageId, pageNumber: correction.versionPage?.pageNumber,
        x: correction.xNormalized, y: correction.yNormalized, radius: correction.radiusNormalized, path: parsePath(correction.pathNormalized), comment: correction.comment,
        locked: Boolean(correction.lockedAt), status: correction.status, createdAt: correction.createdAt,
      })),
    };
  }

  async function requireReviewable(token) {
    const context = await resolve(token);
    if (context.album.status !== "CLIENT_REVIEW") throw httpError(409, "This proof is no longer open for review.");
    if (await repo.findSubmission(context.version.id, "CORRECTIONS")) throw httpError(409, "Your corrections for this version have already been submitted.");
    if (await repo.findSubmission(context.version.id, "APPROVAL")) throw httpError(409, "This album has already been approved.");
    return context;
  }

  async function addCorrection(token, input) {
    const { publication, album, version } = await requireReviewable(token);
    const pages = await repo.listVersionPages(version.id);
    const page = pages.find((candidate) => candidate.id === input.versionPageId);
    if (!page) throw unavailable();
    const correction = await repo.createCorrection({
      albumId: album.id, versionId: version.id, versionPageId: page.id, source: "CLIENT",
      xNormalized: input.x, yNormalized: input.y, radiusNormalized: input.radius, pathNormalized: storedPath(input.path), comment: input.comment,
      publicationId: publication.id, createdByLabel: "Client",
    });
    await record(album.id, "CLIENT_CORRECTION_ADDED", clientActor(), { versionId: version.id, pageId: page.id, correctionId: correction.id, detail: `Spread ${page.pageNumber}` });
    return { id: correction.id, versionPageId: page.id, pageNumber: page.pageNumber, x: correction.xNormalized, y: correction.yNormalized, radius: correction.radiusNormalized, path: parsePath(correction.pathNormalized), comment: correction.comment, locked: false };
  }

  /** Until submission the pins are the client's to shape: edit or remove, own publication only. */
  async function requireOwnDraftCorrection(token, correctionId) {
    const context = await requireReviewable(token);
    const correction = await repo.findCorrection(context.album.id, correctionId);
    if (!correction || correction.source !== "CLIENT" || correction.publicationId !== context.publication.id) throw unavailable();
    if (correction.lockedAt) throw httpError(409, "Submitted corrections can no longer be changed.");
    return { ...context, correction };
  }
  async function editCorrection(token, correctionId, input) {
    const { correction } = await requireOwnDraftCorrection(token, correctionId);
    const updated = await repo.updateCorrection(correction.id, {
      ...(input.comment !== undefined ? { comment: input.comment } : {}),
      ...(input.path !== undefined ? { pathNormalized: storedPath(input.path) } : {}),
      ...(input.x !== undefined ? { xNormalized: input.x } : {}),
      ...(input.y !== undefined ? { yNormalized: input.y } : {}),
    });
    return { id: updated.id, x: updated.xNormalized, y: updated.yNormalized, path: parsePath(updated.pathNormalized), comment: updated.comment, locked: false };
  }
  async function deleteCorrection(token, correctionId) {
    const { correction } = await requireOwnDraftCorrection(token, correctionId);
    await repo.deleteCorrection(correction.id);
    return { deleted: true };
  }

  /**
   * Send Corrections: one transaction, one revision round. The unique (versionId, CORRECTIONS)
   * makes the double-click physically unable to spend two rounds; the limit refuses the round
   * before anything is written.
   */
  async function submitCorrections(token, requestMeta = {}) {
    const { publication, album, version } = await requireReviewable(token);
    const count = await repo.countCorrections(album.id, { versionId: version.id, source: "CLIENT" });
    if (!count) throw httpError(409, "Add at least one correction — or approve the album.");
    if (album.revisionLimit != null && album.revisionsUsed >= album.revisionLimit) {
      throw httpError(409, "Revision limit reached. Please contact the studio for additional changes.", { revisionLimitReached: true });
    }
    const submission = await repo.transaction(async (tx) => {
      const created = await tx.createSubmission({
        albumId: album.id, versionId: version.id, publicationId: publication.id,
        type: "CORRECTIONS", revisionNumber: album.revisionsUsed + 1, correctionCount: count,
        ipAddress: requestMeta.ip || null, userAgent: (requestMeta.userAgent || "").slice(0, 500) || null,
      });
      await tx.lockClientCorrections(version.id, created.id);
      await tx.updateAlbum(album.id, { revisionsUsed: album.revisionsUsed + 1 });
      return created;
    }).catch(alreadySubmitted);
    await transition(album.id, "CLIENT_REVIEW", "CLIENT_CHANGES_REQUESTED");
    await record(album.id, "CLIENT_CORRECTIONS_SUBMITTED", clientActor(), { versionId: version.id, detail: `${count} correction${count === 1 ? "" : "s"} · revision ${submission.revisionNumber}${album.revisionLimit != null ? ` of ${album.revisionLimit}` : ""}` });
    const remaining = album.revisionLimit == null ? null : album.revisionLimit - submission.revisionNumber;
    return { submitted: true, correctionCount: count, revisionNumber: submission.revisionNumber, remainingRevisions: remaining };
  }

  /** Approve & Submit Album: zero corrections on this version, confirmed, once — then locked. */
  async function approve(token, input, requestMeta = {}) {
    const { publication, album, version } = await requireReviewable(token);
    const count = await repo.countCorrections(album.id, { versionId: version.id, source: "CLIENT" });
    if (count) throw httpError(409, "You still have corrections on this version — send them, or remove them to approve.");
    await repo.transaction(async (tx) => {
      await tx.createSubmission({
        albumId: album.id, versionId: version.id, publicationId: publication.id,
        type: "APPROVAL", approvedConfirmation: input.confirmation || "I approve this album for final processing.",
        ipAddress: requestMeta.ip || null, userAgent: (requestMeta.userAgent || "").slice(0, 500) || null,
      });
      await tx.updateAlbum(album.id, { approvedVersionId: version.id });
    }).catch(alreadySubmitted);
    await transition(album.id, "CLIENT_REVIEW", "CLIENT_APPROVED");
    await record(album.id, "CLIENT_APPROVED", clientActor(), { versionId: version.id, detail: `V${version.versionNumber}` });
    return { approved: true, versionNumber: version.versionNumber };
  }

  const requireSession = (token, authHeader) => crypto.verifySession(token, authHeader);

  return {
    publish, publicationInfo, revealCredentials, resetPin, updateExpiry, revoke, grantExtraRevision,
    resolve, meta, verifyPin, proof, addCorrection, editCorrection, deleteCorrection,
    submitCorrections, approve, requireSession,
  };
}

module.exports = { createAlbumClientService, CLIENT_STATUS_LABELS };
