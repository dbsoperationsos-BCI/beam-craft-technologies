const invitations = require("./service");
const { renderInvitationCard } = require("./card");
const { renderInvitationVideo } = require("./video");

/*
 * Invitation Cards over HTTP: the team's (Client Management -> Invitation Cards), the client's
 * (mounted on the client portal, their own bookings only) and the guest's (`/inv/<token>`, public).
 */

const idOf = (req) => Number.parseInt(req.params.id, 10);
const actorOf = (req) => Number(req.user?.id) || null;
const fail = (res, error, fallback) => {
  // A save past the free edits: the app is told why, and what it may do now, to offer the unlock.
  if (error?.code === "PAYMENT_REQUIRED") return res.status(402).json({ message: error.message, code: error.code, access: error.access });
  if (error?.status) return res.status(error.status).json({ message: error.message });
  console.error(fallback, error);
  return res.status(500).json({ message: fallback });
};
const invalid = (res, parsed, fallback) => res.status(400).json({ message: parsed.error.issues?.[0]?.message || fallback });

// ── The team's ──

async function teamOverview(_req, res) {
  try {
    return res.json({ data: await invitations.teamOverview() });
  } catch (error) { return fail(res, error, "Unable to load the invitation cards."); }
}

function saver(schema, save, { created, saved, missing, failed }) {
  return async (req, res) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return invalid(res, parsed, "Please check the details.");
    try {
      const id = req.params.id ? idOf(req) : null;
      const row = await save(parsed.data, actorOf(req), id);
      if (!row) return res.status(404).json({ message: missing });
      return res.status(id ? 200 : 201).json({ data: row, message: id ? saved : created });
    } catch (error) { return fail(res, error, failed); }
  };
}

function remover(remove, { removed, missing, failed }) {
  return async (req, res) => {
    try {
      if (!(await remove(idOf(req), actorOf(req)))) return res.status(404).json({ message: missing });
      return res.json({ message: removed });
    } catch (error) { return fail(res, error, failed); }
  };
}

const saveTemplate = saver(invitations.templateSchema, invitations.saveTemplate, { created: "Design added.", saved: "Design saved.", missing: "Design not found.", failed: "Unable to save the design." });
const removeTemplate = remover(invitations.removeTemplate, { removed: "Design removed.", missing: "Design not found.", failed: "Unable to remove the design." });
const saveSong = saver(invitations.songSchema, invitations.saveSong, { created: "Song added.", saved: "Song saved.", missing: "Song not found.", failed: "Unable to save the song." });
const removeSong = remover(invitations.removeSong, { removed: "Song removed.", missing: "Song not found.", failed: "Unable to remove the song." });

// ── The client's ──
// `projectIds(req)` is the client portal's: every booking of the signed-in client.

function clientRoutes(projectIds) {
  return {
    async overview(req, res) {
      try {
        res.set("Cache-Control", "no-store");
        return res.json({ data: await invitations.clientOverview(await projectIds(req)) });
      } catch (error) { return fail(res, error, "Unable to load the invitation cards."); }
    },
    async designs(req, res) {
      try {
        res.set("Cache-Control", "no-store");
        const [found, preview] = await Promise.all([invitations.designsFor(req.query?.shoot), invitations.previewFor(await projectIds(req), req.query?.shoot)]);
        return res.json({ data: { ...found, preview } });
      } catch (error) { return fail(res, error, "Unable to load the designs."); }
    },
    async create(req, res) {
      try {
        const made = await invitations.createInvitation({
          projectIds: await projectIds(req),
          userId: Number(req.user.id),
          templateId: req.body?.designId,
          shootName: req.body?.shoot,
        });
        return res.status(201).json({ data: made });
      } catch (error) { return fail(res, error, "Your invitation could not be started."); }
    },
    async read(req, res) {
      try {
        res.set("Cache-Control", "no-store");
        const found = await invitations.clientInvitation(idOf(req), await projectIds(req));
        if (!found) return res.status(404).json({ message: "Invitation not found." });
        return res.json({ data: found });
      } catch (error) { return fail(res, error, "Unable to load the invitation."); }
    },
    async update(req, res) {
      const parsed = invitations.invitationSchema.safeParse(req.body);
      if (!parsed.success) return invalid(res, parsed, "Please check the invitation.");
      try {
        const saved = await invitations.updateInvitation(idOf(req), await projectIds(req), parsed.data);
        if (!saved) return res.status(404).json({ message: "Invitation not found." });
        return res.json({ data: saved, message: "Invitation saved." });
      } catch (error) { return fail(res, error, "Your invitation could not be saved."); }
    },
    async unlock(req, res) {
      try {
        const found = await invitations.requestUnlock(idOf(req), await projectIds(req));
        if (!found) return res.status(404).json({ message: "Invitation not found." });
        return res.json({ data: found, message: "The studio has your request." });
      } catch (error) { return fail(res, error, "Your request could not be sent. Please try again."); }
    },
    async remove(req, res) {
      try {
        if (!(await invitations.removeInvitation(idOf(req), await projectIds(req)))) return res.status(404).json({ message: "Invitation not found." });
        return res.json({ message: "Invitation deleted." });
      } catch (error) { return fail(res, error, "Your invitation could not be deleted."); }
    },
  };
}

// ── The guest's ──

async function publicInvitation(req, res) {
  try {
    const found = await invitations.publicInvitation(req.params.token, req.query?.k);
    if (!found) {
      // A miss counts against the link limiter; a real invitation never does.
      res.locals.linkMiss = true;
      return res.status(404).json({ message: "This invitation could not be found." });
    }
    res.set("Cache-Control", "no-store");
    return res.json({ data: found });
  } catch (error) { return fail(res, error, "Unable to open the invitation."); }
}

/**
 * The invitation's front as a picture (PNG, 1080 x 1920), for the client's Download - or a guest's.
 * `?download=1` asks the browser to save it rather than show it.
 */
async function invitationCard(req, res) {
  try {
    const version = await invitations.invitationVersion(req.params.token);
    if (!version) {
      res.locals.linkMiss = true;
      return res.status(404).json({ message: "This invitation could not be found." });
    }
    const png = await renderInvitationCard(req.params.token, version);
    res.set("Content-Type", "image/png");
    res.set("Cache-Control", "private, max-age=300");
    if (req.query?.download === "1") res.set("Content-Disposition", 'attachment; filename="invitation.png"');
    return res.send(png);
  } catch (error) { return fail(res, error, "The invitation picture could not be made. Please try again in a moment."); }
}

/**
 * The invitation playing, as a video (MP4, 720 x 1280, ten seconds) with its song - for the client's
 * Download, to post or send. `?download=1` asks the browser to save it rather than play it.
 */
async function invitationVideo(req, res) {
  try {
    const version = await invitations.invitationVersion(req.params.token);
    if (!version) {
      res.locals.linkMiss = true;
      return res.status(404).json({ message: "This invitation could not be found." });
    }
    const opened = await invitations.publicInvitation(req.params.token);
    const mp4 = await renderInvitationVideo(req.params.token, version, opened?.song ? { url: opened.song.url, start: opened.song.start } : null);
    res.set("Content-Type", "video/mp4");
    res.set("Cache-Control", "private, max-age=300");
    if (req.query?.download === "1") res.set("Content-Disposition", 'attachment; filename="invitation.mp4"');
    return res.send(mp4);
  } catch (error) { return fail(res, error, "The invitation video could not be made. Please try again in a moment."); }
}

/** The clients' invitations from priced designs: what is waiting on payment, and what is paid. */
async function teamInvitations(_req, res) {
  try {
    return res.json({ data: await invitations.teamInvitations() });
  } catch (error) { return fail(res, error, "Unable to load the client invitations."); }
}

/** Records an invitation paid (`{ paid: true }`) or takes that back (`{ paid: false }`). */
async function markPaid(req, res) {
  try {
    const paid = req.body?.paid !== false;
    if (!(await invitations.markPaid(idOf(req), actorOf(req), paid))) return res.status(404).json({ message: "Invitation not found." });
    return res.json({ message: paid ? "Marked as paid - the client can share it now." : "Payment taken back." });
  } catch (error) { return fail(res, error, "Unable to record the payment."); }
}

/** Several invitations paid (`{ ids, paid }`) at once. */
async function markPaidMany(req, res) {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    if (!ids.length) return res.status(400).json({ message: "Choose the invitations first." });
    const paid = req.body?.paid !== false;
    const changed = await invitations.markPaidMany(ids, actorOf(req), paid);
    return res.json({ message: `${changed} invitation${changed === 1 ? "" : "s"} ${paid ? "marked as paid - the clients can share now" : "marked as not paid"}.` });
  } catch (error) { return fail(res, error, "Unable to record the payments."); }
}

/** One client's own price and free edits (`{ price, editLimit }`, null to use the design's). */
async function setTerms(req, res) {
  const parsed = invitations.termsSchema.safeParse(req.body);
  if (!parsed.success) return invalid(res, parsed, "Please check the price and edits.");
  try {
    if (!(await invitations.setTerms(idOf(req), parsed.data))) return res.status(404).json({ message: "Invitation not found." });
    return res.json({ message: "Saved - the client sees it at once." });
  } catch (error) { return fail(res, error, "Unable to save."); }
}

/** Deletes client invitations (`{ ids }`): their links stop opening. */
async function removeInvitations(req, res) {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    if (!ids.length) return res.status(400).json({ message: "Choose the invitations first." });
    const removed = await invitations.removeInvitations(ids);
    return res.json({ message: `${removed} invitation${removed === 1 ? "" : "s"} deleted.` });
  } catch (error) { return fail(res, error, "Unable to delete the invitations."); }
}

module.exports = { teamInvitations, markPaid, markPaidMany, setTerms, removeInvitations, invitationCard, invitationVideo, teamOverview, saveTemplate, removeTemplate, saveSong, removeSong, clientRoutes, publicInvitation };
