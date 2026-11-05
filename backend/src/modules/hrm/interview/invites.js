const crypto = require("crypto");
const { z } = require("zod");
const prisma = require("../../../config/db");
const { sendInterviewApplicationEmail, sendInterviewApplicationResendEmail } = require("../../../services/emailService");
const { describeMailFailure } = require("../../../services/mailFailure");
const { storeDocument, storeDocuments } = require("../../../services/documentStorage");
const { SHORT_CODE_PATTERN, generateShortCode } = require("../../../services/shortCode");
const { genderNames } = require("../../../services/employeeOptionLists");
const { phonesMatch } = require("../onboarding-invites/controller");
// Sending on WhatsApp belongs to the WhatsApp module and is reused whole; this file never learns
// what a session or a socket is. `MAX_MESSAGE_LENGTH` is that module's too, so the cap cannot drift.
const { sendWhatsAppToPerson } = require("../../sales/whatsapp-chat/directSend");
const whatsappActivity = require("../../../services/whatsappActivity");
const { MAX_MESSAGE_LENGTH } = require("../../sales/whatsapp-chat/security");
const service = require("./service");
const {
  EMPLOYMENT_TYPES,
  DEFAULT_CANDIDATE_STATUS,
  FORM_PENDING_STATUS,
  FORM_SUBMITTED_STATUS,
  APPLICATION_FORM_SOURCE,
} = require("./candidates");

/**
 * The application form a candidate is sent, and the link they fill it in from.
 *
 * The Interview module's counterpart of the onboarding invite, built the same way and for the same
 * reason: HR has a name and a number, the rest of the application is the candidate's to type, and
 * the honest way to collect it is to send them a form of their own rather than read it out over
 * the phone. The link carries a short code, opens once the candidate proves the email or phone HR
 * holds, and expires. Sending it is what moves a candidate to **Form Submission Pending**; the
 * candidate submitting moves them to **Form Submitted**.
 *
 * Every invite belongs to a register row. An invite raised for somebody not yet on the register
 * creates their row first, so the Interview screen shows the person from the moment the form goes
 * out rather than only once it comes back.
 *
 * The protected handlers answer for `HRM / Interview` on `inviteRoutes.js`; the public ones answer
 * by token on `publicRoutes.js`, rate-limited and never cached, exactly as the onboarding form's are.
 */

const INVITE_STATUSES = ["Created", "Verified", "Submitted", "Expired", "Cancelled"];
// The wording as the sender left it in the dialog's box; the link is already inside it. The cap is
// WhatsApp's own, named once in the module that owns it.
const sendWhatsAppSchema = z.object({ message: z.string().trim().min(1).max(MAX_MESSAGE_LENGTH) });
const LIVE_STATUSES = ["Created", "Verified"];
const RESUME_FOLDER = "hrm/interview/resume";
const ATTACHMENT_FOLDER = "hrm/interview/attachments";
/**
 * How many files a candidate may attach besides the résumé.
 *
 * Five is a certificate or two, an experience letter and an award - enough for an application and
 * short of a folder nobody reads. Each is held to `storeDocument`'s own 5 MB, and the form offers
 * the same number, so the refusal is a control that stops rather than an error after an upload.
 */
const MAX_ATTACHMENTS = 5;

const createInviteSchema = z.object({
  // The register row this form is for. Absent, the row is found by email or phone, or created.
  candidateId: z.string().trim().max(191).optional().nullable().transform((value) => value || null),
  candidateName: z.string().trim().min(1, "Candidate Name is required.").max(150),
  candidateEmail: z.string().trim().email("Enter a valid email address.").max(191),
  candidatePhone: z.string().trim().min(1, "Candidate Phone is required.").max(30),
  position: z.string().trim().max(150).optional().nullable().transform((value) => value || null),
  expiresAt: z.coerce.date({ message: "Expiry Date is required." }),
});
const updateInviteSchema = createInviteSchema.omit({ candidateId: true });
const identifierSchema = z.object({ identifier: z.string().trim().min(1).max(191) });
const inviteIdSchema = z.string().cuid();
const TOKEN_PATTERN = /^[a-f0-9]{64}$/i;

const hashToken = (token) => crypto.createHash("sha256").update(token).digest("hex");
const generateToken = () => crypto.randomBytes(32).toString("hex");
const frontendBaseUrl = () => (process.env.FRONTEND_URL || "http://localhost:3000").replace(/\/$/, "");

/** Which public identifier a link carries: the short code where the invite has one, else the token. */
function classifyIdentifier(identifier) {
  const value = String(identifier || "").trim();
  if (TOKEN_PATTERN.test(value)) return { kind: "token", where: { tokenHash: hashToken(value) } };
  if (SHORT_CODE_PATTERN.test(value)) return { kind: "code", code: value.toUpperCase(), where: { shortCode: value.toUpperCase() } };
  return null;
}

const applicationUrlFor = (invite, heldToken = null) => {
  const code = invite?.shortCode || heldToken || invite?.token || null;
  return code ? `${frontendBaseUrl()}/interview/apply/${code}` : null;
};

/**
 * The status an invite is reported with. "Expired" is only written when somebody next touches the
 * link (opening it, sending it, submitting it), so a lapsed form that nobody touched still holds
 * Created or Verified in the table. It is read here by the same rule those writes use - past its
 * expiry and neither submitted nor cancelled - so every list says Expired without a GET writing.
 */
function reportedInviteStatus(invite, now = new Date()) {
  const status = invite?.status;
  if (status === "Submitted" || status === "Cancelled" || status === "Expired") return status;
  const expiresAt = invite?.expiresAt ? new Date(invite.expiresAt) : null;
  return expiresAt && expiresAt <= now ? "Expired" : status;
}

function serializeInvite(invite, candidate = null) {
  const { tokenHash, token, ...safe } = invite;
  return {
    ...safe,
    status: reportedInviteStatus(invite),
    applicationUrl: invite.shortCode ? applicationUrlFor(invite) : null,
    candidateCode: candidate?.candidateCode || null,
    candidateStatus: candidate?.status || null,
  };
}

function maskEmail(email) {
  const [localPart, domain] = String(email || "").split("@");
  if (!domain) return "***";
  const visible = localPart.slice(0, Math.min(2, localPart.length));
  return `${visible}${"*".repeat(Math.max(1, localPart.length - visible.length))}@${domain}`;
}

function maskPhone(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  return digits.length <= 4 ? "****" : `${"*".repeat(digits.length - 4)}${digits.slice(-4)}`;
}

/** `+91 9876543210`, the shape the register keeps a number in, from whatever the form typed. */
function toStoredPhone(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 10) return raw;
  return `+${digits.slice(0, -10) || "91"} ${digits.slice(-10)}`;
}

function splitName(candidateName) {
  const parts = String(candidateName || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return { firstName: parts[0] || "", lastName: "" };
  return { firstName: parts.slice(0, -1).join(" "), lastName: parts.at(-1) };
}

const validationError = (res, error) => res.status(400).json({ message: error.issues?.[0]?.message || "Validation failed", errors: error.flatten() });

function unavailableResponse(res, invite) {
  if (invite.status === "Cancelled") return res.status(410).json({ message: "This application link has been cancelled." });
  if (invite.status === "Submitted") return res.status(410).json({ message: "This application has already been submitted." });
  return res.status(410).json({ message: "This application link has expired." });
}

async function findUsableInvite(identifier) {
  const classified = classifyIdentifier(identifier);
  if (!classified) return { invite: null, state: "missing" };
  const invite = await prisma.hrmInterviewApplicationInvite.findUnique({ where: classified.where });
  if (!invite) return { invite: null, state: "missing" };
  if (invite.status === "Cancelled" || invite.status === "Submitted") return { invite, state: "unavailable" };
  if (invite.expiresAt <= new Date()) {
    const expired = invite.status === "Expired" ? invite : await prisma.hrmInterviewApplicationInvite.update({ where: { id: invite.id }, data: { status: "Expired" } });
    return { invite: expired, state: "expired" };
  }
  if (!INVITE_STATUSES.includes(invite.status)) return { invite, state: "unavailable" };
  return { invite, state: "valid" };
}

/** The candidates the listed invites belong to, keyed by id, for the code and stage on each row. */
async function candidatesFor(invites) {
  const ids = [...new Set(invites.map((invite) => invite.candidateId).filter(Boolean))];
  if (!ids.length) return new Map();
  const rows = await prisma.hrmInterviewCandidate.findMany({ where: { id: { in: ids } }, select: { id: true, candidateCode: true, status: true } });
  return new Map(rows.map((row) => [row.id, row]));
}

/**
 * The register row an invite is for: the one named, else the one already holding this email or
 * phone, else a new one. A person invited twice is one row twice, not two rows.
 */
async function resolveCandidate(data, actor) {
  if (data.candidateId) {
    const named = await prisma.hrmInterviewCandidate.findFirst({ where: { id: data.candidateId, deletedAt: null } });
    if (!named) throw Object.assign(new Error("That candidate could not be found."), { status: 404 });
    return named;
  }
  /*
   * Asked of the service rather than looked up here, because `createCandidate` now **refuses** a
   * duplicate: if this and the guard below it disagreed about what counts as the same person, the
   * gap between them would be an invite that cannot be raised at all. One definition, so the call
   * below can only ever be reached when there is genuinely nobody to reuse.
   */
  const clash = await service.findDuplicateCandidate({ email: data.candidateEmail, phone: data.candidatePhone });
  // Re-read in full: the match carries only enough to identify a row, and everything downstream of
  // here - the stage, the position, the details the form fills in - reads the whole candidate.
  if (clash) return prisma.hrmInterviewCandidate.findFirst({ where: { id: clash.candidate.id } });
  return service.createCandidate({
    name: data.candidateName,
    email: data.candidateEmail,
    phone: toStoredPhone(data.candidatePhone),
    position: data.position,
    source: APPLICATION_FORM_SOURCE,
    status: FORM_PENDING_STATUS,
  }, actor);
}

/**
 * Sending the form moves a candidate nobody has worked yet to Form Submission Pending, and fills in
 * the contact details the invite carries where the row had none. A candidate further along keeps
 * their stage: sending a form to somebody already shortlisted is asking for more detail, not
 * starting over.
 */
async function markFormSent(candidate, data) {
  const patch = {};
  if (!candidate.email && data.candidateEmail) patch.email = data.candidateEmail.toLowerCase();
  if (!candidate.phone && data.candidatePhone) patch.phone = toStoredPhone(data.candidatePhone);
  if (!candidate.position && data.position) patch.position = data.position;
  if (!candidate.status || candidate.status === DEFAULT_CANDIDATE_STATUS) patch.status = FORM_PENDING_STATUS;
  if (Object.keys(patch).length) await prisma.hrmInterviewCandidate.update({ where: { id: candidate.id }, data: patch });
}

async function createInvite(req, res) {
  const parsed = createInviteSchema.safeParse(req.body || {});
  if (!parsed.success) return validationError(res, parsed.error);
  const data = parsed.data;
  if (data.expiresAt <= new Date()) return res.status(400).json({ message: "The expiry date must be in the future." });

  try {
    const active = await prisma.hrmInterviewApplicationInvite.findMany({
      where: { status: { in: LIVE_STATUSES }, expiresAt: { gt: new Date() } },
      select: { candidateEmail: true, candidatePhone: true },
    });
    const duplicate = active.some((invite) => invite.candidateEmail.toLowerCase() === data.candidateEmail.toLowerCase() || phonesMatch(invite.candidatePhone, data.candidatePhone));
    if (duplicate) return res.status(409).json({ message: "An active application link already exists for this candidate." });

    const candidate = await resolveCandidate(data, req.user);
    const token = generateToken();
    let invite = null;
    for (let attempt = 0; attempt < 5 && !invite; attempt += 1) {
      try {
        invite = await prisma.hrmInterviewApplicationInvite.create({
          data: {
            candidateId: candidate.id,
            candidateName: data.candidateName,
            candidateEmail: data.candidateEmail,
            candidatePhone: data.candidatePhone,
            position: data.position,
            expiresAt: data.expiresAt,
            tokenHash: hashToken(token),
            tokenPreview: `${token.slice(0, 4)}…${token.slice(-4)}`,
            token,
            shortCode: generateShortCode(8),
            createdByUserId: req.user?.id ?? null,
          },
        });
      } catch (error) {
        if (error?.code !== "P2002") throw error;
      }
    }
    if (!invite) return res.status(500).json({ message: "Unable to create the application link." });
    await markFormSent(candidate, data);
    const serialized = serializeInvite(invite, candidate);
    return res.status(201).json({ invite: serialized, token, applicationUrl: serialized.applicationUrl });
  } catch (error) {
    if (error?.status) return res.status(error.status).json({ message: error.message });
    console.error("[interview] Unable to create an application invite:", error);
    return res.status(500).json({ message: "Unable to create the application link." });
  }
}

/**
 * The forms raised, newest first - every one of them, or only those belonging to the candidates
 * named in `?candidateIds=`.
 *
 * The register asks for the narrow answer. It reads a page of a hundred candidates at a time and
 * uses the forms only to decide what each row's menu offers, so pulling every invite the studio has
 * ever raised - and then every candidate those invites name - was a second read of the whole
 * register, paid on opening the screen and again after every write. View All Invites still asks
 * for the lot, because that is what it is.
 *
 * Capped either way: an unbounded list is how this became the slowest thing on the screen.
 */
const INVITE_LIST_LIMIT = 2000;

async function listInvites(req, res) {
  try {
    const asked = String(req.query.candidateIds || "").split(",").map((id) => id.trim()).filter(Boolean);
    const where = asked.length ? { candidateId: { in: asked.slice(0, INVITE_LIST_LIMIT) } } : {};
    const invites = await prisma.hrmInterviewApplicationInvite.findMany({ where, orderBy: { createdAt: "desc" }, take: INVITE_LIST_LIMIT });
    const candidates = await candidatesFor(invites);
    return res.json({ data: invites.map((invite) => serializeInvite(invite, candidates.get(invite.candidateId))) });
  } catch (error) {
    console.error("[interview] Unable to list application invites:", error);
    return res.status(500).json({ message: "Unable to load application invites." });
  }
}

/**
 * Correcting the details an invite was sent on. The link is kept, which is the whole point over
 * cancelling and re-inviting; an expired invite comes back to life when its expiry is moved on.
 */
async function updateInvite(req, res) {
  const parsedId = inviteIdSchema.safeParse(req.params.id);
  const parsed = updateInviteSchema.safeParse(req.body || {});
  if (!parsedId.success) return res.status(400).json({ message: "That is not an application invite." });
  if (!parsed.success) return validationError(res, parsed.error);
  try {
    const existing = await prisma.hrmInterviewApplicationInvite.findUnique({ where: { id: parsedId.data } });
    if (!existing) return res.status(404).json({ message: "Application invite not found." });
    if (!["Created", "Verified", "Expired"].includes(existing.status)) {
      return res.status(400).json({ message: "This application invite can no longer be edited." });
    }
    const data = parsed.data;
    const revived = existing.status === "Expired" && data.expiresAt > new Date();
    const invite = await prisma.hrmInterviewApplicationInvite.update({
      where: { id: existing.id },
      data: { candidateName: data.candidateName, candidateEmail: data.candidateEmail, candidatePhone: data.candidatePhone, position: data.position, expiresAt: data.expiresAt, ...(revived ? { status: "Created" } : {}) },
    });
    // The same person, corrected on the register too: the row was written from the invite.
    if (invite.candidateId) {
      await prisma.hrmInterviewCandidate.updateMany({
        where: { id: invite.candidateId, deletedAt: null },
        data: { name: data.candidateName, email: data.candidateEmail.toLowerCase(), phone: toStoredPhone(data.candidatePhone), ...(data.position ? { position: data.position } : {}) },
      });
    }
    const candidates = await candidatesFor([invite]);
    const serialized = serializeInvite(invite, candidates.get(invite.candidateId));
    return res.json({ invite: serialized, applicationUrl: serialized.applicationUrl });
  } catch (error) {
    console.error("[interview] Unable to update an application invite:", error);
    return res.status(500).json({ message: "Unable to update the application invite." });
  }
}

/** Cancelling puts a candidate who was only waiting on the form back to Yet to Connect. */
async function cancelInvite(req, res) {
  const parsedId = inviteIdSchema.safeParse(req.params.id);
  if (!parsedId.success) return res.status(400).json({ message: "That is not an application invite." });
  try {
    const existing = await prisma.hrmInterviewApplicationInvite.findUnique({ where: { id: parsedId.data } });
    if (!existing) return res.status(404).json({ message: "Application invite not found." });
    if (existing.status === "Submitted") return res.status(400).json({ message: "This application has already been submitted and cannot be cancelled." });
    if (existing.status === "Cancelled") {
      const candidates = await candidatesFor([existing]);
      return res.json({ invite: serializeInvite(existing, candidates.get(existing.candidateId)) });
    }
    const invite = await prisma.hrmInterviewApplicationInvite.update({ where: { id: existing.id }, data: { status: "Cancelled", cancelledAt: new Date() } });
    if (invite.candidateId) {
      await prisma.hrmInterviewCandidate.updateMany({ where: { id: invite.candidateId, deletedAt: null, status: FORM_PENDING_STATUS }, data: { status: DEFAULT_CANDIDATE_STATUS } });
    }
    const candidates = await candidatesFor([invite]);
    return res.json({ invite: serializeInvite(invite, candidates.get(invite.candidateId)) });
  } catch (error) {
    console.error("[interview] Unable to cancel an application invite:", error);
    return res.status(500).json({ message: "Unable to cancel the application invite." });
  }
}

const sendEmailSchema = z.object({ token: z.string().trim().refine((value) => classifyIdentifier(value) !== null, "A valid application link is required.") });

/**
 * The same screening form, handed over on WhatsApp instead of by email.
 *
 * The wording comes from the dialog's editable box - somebody adds a line, or writes it in the
 * candidate's language - so what is sent is what they are looking at. The **number** does not: it
 * is read off the invite, so this can only ever reach the candidate this link is for.
 *
 * The invite's state is checked exactly as the email checks it. Nothing is recorded, which is what
 * the email does too.
 */
async function sendInviteWhatsApp(req, res) {
  const parsedId = inviteIdSchema.safeParse(req.params.id);
  const parsedBody = sendWhatsAppSchema.safeParse(req.body || {});
  if (!parsedId.success || !parsedBody.success) return res.status(400).json({ message: "A message is required." });
  try {
    const invite = await prisma.hrmInterviewApplicationInvite.findUnique({ where: { id: parsedId.data } });
    if (!invite) return res.status(404).json({ message: "Application invite not found." });
    if (invite.status === "Cancelled" || invite.status === "Submitted") return res.status(400).json({ message: "This application link can no longer be sent." });
    if (invite.expiresAt <= new Date()) {
      if (invite.status !== "Expired") await prisma.hrmInterviewApplicationInvite.update({ where: { id: invite.id }, data: { status: "Expired" } });
      return res.status(400).json({ message: "This application link has expired." });
    }

    // Recorded in Settings → WhatsApp Activity Log, where a failed one can be sent again.
    await whatsappActivity.track({
      mode: "MANUAL", provider: "baileys", trigger: "INTERVIEW_APPLICATION_INVITE", eventRef: `interview-invite:${invite.id}`,
      initiatedByUserId: req.user.id, senderUserId: req.user.id,
      recipient: { kind: "PERSON", address: invite.candidatePhone, name: invite.candidateName },
      body: parsedBody.data.message, resendable: true,
    }, () => sendWhatsAppToPerson({
      userId: req.user.id,
      phone: invite.candidatePhone,
      body: parsedBody.data.message,
      noNumberMessage: "This application link has no phone number to send to.",
    }));
    return res.json({ message: `Screening form sent on WhatsApp to ${invite.candidateName}.` });
  } catch (error) {
    // The send's own refusals carry a status and a sentence worth acting on - not linked, switched
    // off, the number not on WhatsApp - so they are passed through rather than flattened.
    if (error?.status) return res.status(error.status).json({ message: error.message });
    console.error(`[interview] Application invite WhatsApp refused for invite ${parsedId.data}:`, error.message);
    return res.status(502).json({ message: "Unable to send this screening form on WhatsApp." });
  }
}

async function sendInviteEmail(req, res) {
  const parsedId = inviteIdSchema.safeParse(req.params.id);
  const parsedBody = sendEmailSchema.safeParse(req.body || {});
  if (!parsedId.success || !parsedBody.success) return res.status(400).json({ message: "A valid application link is required." });
  try {
    const invite = await prisma.hrmInterviewApplicationInvite.findUnique({ where: { id: parsedId.data } });
    if (!invite) return res.status(404).json({ message: "Application invite not found." });
    if (invite.status === "Cancelled" || invite.status === "Submitted") return res.status(400).json({ message: "This application link can no longer be sent." });
    if (invite.expiresAt <= new Date()) {
      if (invite.status !== "Expired") await prisma.hrmInterviewApplicationInvite.update({ where: { id: invite.id }, data: { status: "Expired" } });
      return res.status(400).json({ message: "This application link has expired." });
    }
    const classified = classifyIdentifier(parsedBody.data.token);
    const proves = classified?.kind === "token"
      ? classified.where.tokenHash === invite.tokenHash
      : Boolean(classified) && Boolean(invite.shortCode) && classified.code === invite.shortCode;
    if (!proves) return res.status(400).json({ message: "The application link is no longer valid for this invite." });

    const applicationUrl = applicationUrlFor(invite, parsedBody.data.token.trim());
    let emailFailure = null;
    try {
      const result = await sendInterviewApplicationEmail({ candidateName: invite.candidateName, email: invite.candidateEmail, applicationUrl, expiresAt: invite.expiresAt, position: invite.position });
      if (!result.sent) emailFailure = result.reason || "the email could not be sent";
    } catch (emailError) {
      console.error(`[interview] Application invite email refused for invite ${invite.id}:`, emailError.message);
      emailFailure = describeMailFailure(emailError);
    }
    if (emailFailure) return res.status(502).json({ message: `Unable to send the application email: ${emailFailure}`, emailSent: false, warning: emailFailure });
    return res.json({ message: "Application form email sent successfully." });
  } catch (error) {
    console.error("[interview] Unable to send an application invite email:", error.message);
    return res.status(500).json({ message: "Unable to send the application email." });
  }
}

/*
 * How much longer a reopened form is given. A week, the same as the onboarding send-back: long
 * enough for somebody to find an evening, short enough that a link left open is not open forever.
 */
const REOPEN_DAYS = 7;

/**
 * Resend: the candidate applied once, and HR needs them to look at it again.
 *
 * The Interview module's counterpart of `sendBackOnboarding`, built the same way and for the same
 * reason. An application comes back with something missing or wrong in it, and the only answers the
 * register had were to ask for the whole thing again on a new link - which throws away what they
 * typed - or to correct it on their behalf, which puts HR's words in the candidate's mouth. This
 * reopens **their own submission, under their own link**, so the form comes back to them with every
 * answer still in it (see `prefillFrom`) for them to correct and resubmit.
 *
 * Keyed by candidate rather than by invite, because that is what the screen asking holds: the
 * record panel is open on a person, not on a form. The newest **Submitted** form is the one
 * reopened - somebody asked twice is answered by their most recent application.
 *
 * ── What moves, and what does not ──
 *
 * The form goes back to **Verified**, which is the state it was in while the candidate held it, and
 * its `submittedAt` is cleared so `submitPublicInvite`'s own guard accepts the next submission.
 *
 * The candidate moves back to **Form Submission Pending** only from **Form Submitted**. A candidate
 * who has since been scheduled, put on hold or selected keeps their stage: the studio has already
 * moved past the form, and pulling them backwards would undo a decision somebody took. This is the
 * same care `submitPublicInvite` takes on the way in and `cancelInvite` on the way out.
 */
async function resendSubmittedForm(req, res) {
  const candidateId = String(req.params.id || "").trim();
  if (!candidateId) return res.status(400).json({ message: "That is not a candidate." });
  try {
    const candidate = await prisma.hrmInterviewCandidate.findFirst({ where: { id: candidateId, deletedAt: null } });
    if (!candidate) return res.status(404).json({ message: "That candidate could not be found." });

    const invite = await prisma.hrmInterviewApplicationInvite.findFirst({
      where: { candidateId, status: "Submitted" },
      orderBy: { createdAt: "desc" },
    });
    if (!invite) return res.status(404).json({ message: "This candidate has not submitted an application form, so there is nothing to resend." });

    /*
     * The link has to be one that can be given out again, and only the short code can be.
     *
     * A token is stored **hashed** and never kept in the clear, so an invite raised before short
     * codes has no link left that anybody - this endpoint included - could put in an email. Saying
     * so is the honest answer; the screen offers a fresh form instead.
     */
    const applicationUrl = applicationUrlFor(invite);
    if (!applicationUrl) {
      return res.status(400).json({ message: "This form predates resendable links, so its original link cannot be sent again. Send a new screening form instead." });
    }

    // Never shortened: a form reopened today must not arrive already expired because the original
    // deadline has passed.
    const expiresAt = new Date(Math.max(invite.expiresAt.getTime(), Date.now() + REOPEN_DAYS * 24 * 60 * 60 * 1000));
    const [reopened] = await prisma.$transaction([
      prisma.hrmInterviewApplicationInvite.update({
        where: { id: invite.id },
        data: { status: "Verified", submittedAt: null, expiresAt },
      }),
      prisma.hrmInterviewCandidate.updateMany({
        where: { id: candidateId, deletedAt: null, status: FORM_SUBMITTED_STATUS },
        data: { status: FORM_PENDING_STATUS },
      }),
    ]);

    /*
     * Sending is the last thing this does, and the least of it.
     *
     * Everything above has already happened and is not undone by a refused email: the form is open
     * again and the candidate is back on Form Submission Pending. What a failed send costs is only
     * that they have not been told - so this answers with the link and the deadline rather than
     * with a bare error, and the screen hands over the message to send by hand.
     *
     * `smtpPool` answers `{ sent: false }` for one case only - no sender configured at all - and
     * *throws* when senders exist and every one refuses, which is what a spent daily quota looks
     * like. Both shapes are the same answer here.
     */
    let emailFailure = null;
    try {
      const result = await sendInterviewApplicationResendEmail({
        candidateName: invite.candidateName,
        email: invite.candidateEmail,
        applicationUrl,
        expiresAt,
        position: invite.position,
      });
      if (!result.sent) emailFailure = result.reason || "the email could not be sent";
    } catch (emailError) {
      // The reason only, never the thrown text: an SMTP error can quote the message it carried.
      console.error(`[interview] Resend email refused for invite ${invite.id}:`, emailError.message);
      emailFailure = describeMailFailure(emailError);
    }

    const candidates = await candidatesFor([reopened]);
    const body = { invite: serializeInvite(reopened, candidates.get(reopened.candidateId)), applicationUrl, expiresAt };
    if (emailFailure) return res.status(502).json({ ...body, message: `The form was reopened, but the email could not be sent: ${emailFailure}`, emailSent: false, warning: emailFailure });
    return res.json({ ...body, message: "Application form sent again." });
  } catch (error) {
    console.error("[interview] Unable to resend an application form:", error);
    return res.status(500).json({ message: "Unable to resend the application form." });
  }
}

/* ── The public form ──────────────────────────────────────────────────────────────────────── */

async function getPublicInvite(req, res) {
  const result = await findUsableInvite(req.params.token);
  if (result.state === "missing") return res.status(404).json({ message: "This application link is invalid or unavailable." });
  if (result.state !== "valid") return unavailableResponse(res, result.invite);
  const { invite } = result;
  return res.json({
    candidateName: invite.candidateName,
    candidateEmailMasked: maskEmail(invite.candidateEmail),
    candidatePhoneMasked: maskPhone(invite.candidatePhone),
    position: invite.position,
    status: invite.status,
    expiresAt: invite.expiresAt,
    // The lists the form's pickers draw from, served with the invite: a candidate has no session.
    options: { genders: await genderNames().catch(() => []), employmentTypes: EMPLOYMENT_TYPES },
  });
}

/** What the register already holds for this candidate, as the form's own values, so a re-opened link edits rather than retypes. */
function prefillFrom(candidate) {
  if (!candidate) return null;
  const { firstName, lastName } = splitName(candidate.name);
  // Read once: `toRow` parses the JSON columns - the entries, the links, the attachments - which
  // the raw row holds as strings.
  const row = service.toRow(candidate);
  return {
    firstName,
    lastName,
    gender: candidate.gender || "",
    dateOfBirth: candidate.dateOfBirth || "",
    contactNumber: candidate.phone || "",
    whatsappNumber: candidate.whatsappNumber || "",
    emailId: candidate.email || "",
    city: candidate.city || "",
    nativePlace: candidate.nativePlace || "",
    currentLocation: candidate.currentLocation || "",
    position: candidate.position || "",
    employmentType: candidate.employmentType || "",
    experience: candidate.experience || "",
    currentCompany: candidate.currentCompany || "",
    currentDesignation: candidate.currentDesignation || "",
    currentCtc: candidate.currentCtc || "",
    expectedCtc: candidate.expectedCtc || "",
    noticePeriod: candidate.noticePeriod || "",
    availableFrom: candidate.availableFrom || "",
    skills: candidate.skills || "",
    languagesKnown: candidate.languagesKnown || "",
    minExpectedCtc: candidate.minExpectedCtc || "",
    /*
     * The links the record already holds, so a link opened a second time comes back with them.
     * Falls back to the single column for a candidate written before the list existed, which is
     * what makes that row read as exactly one link rather than none.
     */
    portfolioLinks: row.portfolioLinks?.length
      ? row.portfolioLinks
      : (candidate.portfolioUrl ? [candidate.portfolioUrl] : []),
    portfolioUrl: candidate.portfolioUrl || "",
    referredBy: candidate.referredBy || "",
    howYouKnowUs: candidate.howYouKnowUs || "",
    aboutUs: candidate.aboutUs || "",
    remarks: "",
    qualifications: row.educationEntries || [],
    experiences: row.experienceEntries || [],
    resumeUrl: candidate.resumeUrl || "",
    // Sent back so a link opened a second time shows what is already attached rather than an empty
    // control; the files themselves are not re-uploaded, since each already carries its URL.
    attachments: Array.isArray(row.attachments) ? row.attachments : [],
  };
}

async function verifyPublicInvite(req, res) {
  const parsed = identifierSchema.safeParse(req.body || {});
  if (!parsed.success) return validationError(res, parsed.error);
  const result = await findUsableInvite(req.params.token);
  if (result.state === "missing") return res.status(404).json({ verified: false, message: "This application link is invalid or unavailable." });
  if (result.state !== "valid") return unavailableResponse(res, result.invite);

  const identifier = parsed.data.identifier;
  const matchesEmail = identifier.toLowerCase() === result.invite.candidateEmail.toLowerCase();
  const matchesPhone = phonesMatch(identifier, result.invite.candidatePhone);
  if (!matchesEmail && !matchesPhone) return res.status(400).json({ verified: false, message: "The entered email or phone does not match this application link." });

  const invite = await prisma.hrmInterviewApplicationInvite.update({
    where: { id: result.invite.id },
    data: { verifiedAt: new Date(), ...(result.invite.status === "Created" ? { status: "Verified" } : {}) },
  });
  const candidate = invite.candidateId ? await prisma.hrmInterviewCandidate.findFirst({ where: { id: invite.candidateId, deletedAt: null } }) : null;
  return res.json({
    verified: true,
    status: invite.status,
    candidate: { ...splitName(invite.candidateName), email: invite.candidateEmail, phone: toStoredPhone(invite.candidatePhone), position: invite.position || "" },
    prefill: prefillFrom(candidate),
  });
}

const shortText = (max = 191) => z.string().trim().max(max).optional().nullable().transform((value) => value || null);
const submissionPhone = z.string().trim().refine((value) => /^[6-9]\d{9}$/.test(value.replace(/\D/g, "").slice(-10)) && value.replace(/\D/g, "").length <= 13, "Enter a 10-digit mobile number");
const detailRows = z.array(z.record(z.string(), z.any())).max(20).optional().nullable();
const documentSchema = z.object({ name: z.string().trim().min(1).max(255), data: z.string().optional().nullable(), url: z.string().optional().nullable() });

const applicationSubmissionSchema = z.object({
  firstName: z.string().trim().min(1, "First Name is required.").max(120),
  lastName: z.string().trim().max(120).optional().nullable().transform((value) => value || ""),
  gender: shortText(30),
  dateOfBirth: shortText(40),
  contactNumber: submissionPhone,
  whatsappNumber: z.string().trim().max(30).optional().nullable().transform((value) => value || null),
  emailId: z.string().trim().email("Enter a valid email address.").max(191),
  city: shortText(120),
  /*
   * Where they are **from** and where they are **now**, in place of a state and a postal address.
   *
   * A state was too coarse to answer the question a studio actually asks - can this person be on the
   * floor on Saturday, and would taking the job mean moving - and a full address is more than a
   * studio should hold about somebody it has not hired.
   *
   * **No `state` and no `address` here**, and left out rather than accepted and ignored, for exactly
   * the reason the department is below: `prepareValues` runs **partially**, so a key that arrived
   * empty would be written, and an empty one would wipe what a linked sheet or the CSV import put on
   * the record. An older tab still posting them is no trouble - the object schema drops what it does
   * not name.
   */
  nativePlace: shortText(191),
  currentLocation: shortText(191),
  position: z.string().trim().min(1, "Position Applied For is required.").max(150),
  /*
   * No department. The form stopped asking - which department a hire lands in is the studio's
   * answer, not a candidate's guess about a studio they have not joined - and it is left out here
   * as well rather than accepted and ignored: `prepareValues` is called **partially** below, so a
   * key that arrived empty would be written, and an empty department would wipe the one HR set.
   * An older tab that still posts the field is no trouble: the object schema drops what it does
   * not name.
   */
  employmentType: shortText(40),
  experience: shortText(60),
  currentCompany: shortText(191),
  currentDesignation: shortText(150),
  currentCtc: shortText(60),
  minExpectedCtc: shortText(60),
  expectedCtc: shortText(60),
  noticePeriod: shortText(60),
  availableFrom: shortText(40),
  /*
   * No highest qualification. The form asked for it in a box beside a Qualifications list that
   * already asks for every qualification with its marks and year - the same answer twice, in a
   * shorter form, with nothing to say which the studio should believe. Left out of the schema as
   * well as the write for the reason the department is: `prepareValues` runs partially below, so a
   * key that arrived empty would be written over the one on the record.
   */

  skills: shortText(5000),
  languagesKnown: shortText(5000),
  /*
   * The candidate's own links: up to three, each an ordinary URL string.
   *
   * `portfolioUrl` stays in the schema beside it because an older tab still posts one, and because
   * the write below derives the column from the first link - a submission carrying only the single
   * field is still a submission with one link.
   */
  portfolioLinks: z.array(z.string().trim().max(1000)).max(3).optional().nullable(),
  portfolioUrl: shortText(1000),
  referredBy: shortText(191),
  howYouKnowUs: shortText(1000),
  aboutUs: shortText(5000),
  /*
   * No `remarks`. It was the form's last box - "Anything you would like us to know" - and the two
   * questions above replace it. Left out of the schema as well as the write, the way `department`
   * and `highestQualification` are: `prepareValues` runs **partially**, so a key that arrived empty
   * would be written, and `remarks` is HR's own note on the candidate. An older tab still posting
   * one is no trouble, since the object schema drops what it does not name.
   */
  qualifications: detailRows,
  experiences: detailRows,
  resume: z.array(documentSchema).max(1).optional().nullable(),
  /*
   * Everything else the candidate attached. Same shape as the résumé and stored the same way -
   * uploaded to R2 by the shared helper, with only the name and the returned URL kept here.
   */
  attachments: z.array(documentSchema).max(MAX_ATTACHMENTS).optional().nullable(),
  policyAgreementAccepted: z.boolean().optional(),
});

function publicError(status, message) {
  return Object.assign(new Error(message), { publicStatus: status });
}

async function submitPublicInvite(req, res) {
  const parsed = applicationSubmissionSchema.safeParse(req.body || {});
  if (!parsed.success) return validationError(res, parsed.error);
  const result = await findUsableInvite(req.params.token);
  if (result.state === "missing") return res.status(404).json({ message: "This application link is invalid or unavailable." });
  if (result.state !== "valid") return unavailableResponse(res, result.invite);
  if (!result.invite.verifiedAt) return res.status(403).json({ message: "Verify this application link before submitting." });

  const data = parsed.data;
  // The résumé is stored before the transaction opens, so a slow upload never holds one open.
  let resumeUrl = null;
  // The attachments travel with the résumé: uploaded before the transaction opens, so a slow one
  // never holds it open, and kept as `{ name, url }` because the name is what HR reads in the list.
  let attachments = null;
  try {
    const file = Array.isArray(data.resume) ? data.resume[0] : null;
    if (file) {
      // `trustUrls: false`: whoever holds the link may not choose what the studio's Résumé link
      // points at - only upload a file. See `storeDocument`.
      const stored = await storeDocument(file, { folder: RESUME_FOLDER, trustUrls: false });
      resumeUrl = stored?.url || stored?.data || null;
    }
    if (Array.isArray(data.attachments) && data.attachments.length) {
      const stored = await storeDocuments(data.attachments.slice(0, MAX_ATTACHMENTS), { folder: ATTACHMENT_FOLDER, trustUrls: false });
      // `data` is the inline fallback the helper returns when R2 is unconfigured in development;
      // it is kept so a local submission still has something to open.
      // Rows, not a string: `prepareValues` serialises every list the same way, and handing it
      // JSON it would have to recognise as already-serialised is how this came to be dropped.
      attachments = stored
        .map((entry) => ({ name: entry?.name || "Attachment", url: entry?.url || entry?.data || "" }))
        .filter((entry) => entry.url);
    }
  } catch (error) {
    return res.status(error.status || 500).json({ message: error.status ? error.message : "Unable to upload your files. Please try again." });
  }

  try {
    const candidate = await prisma.$transaction(async (tx) => {
      const invite = await tx.hrmInterviewApplicationInvite.findUnique({ where: { id: result.invite.id } });
      if (!invite) throw publicError(404, "This application link is invalid or unavailable.");
      if (invite.status === "Cancelled") throw publicError(410, "This application link has been cancelled.");
      if (invite.status === "Submitted") throw publicError(410, "This application has already been submitted.");
      if (invite.expiresAt <= new Date()) {
        await tx.hrmInterviewApplicationInvite.update({ where: { id: invite.id }, data: { status: "Expired" } });
        throw publicError(410, "This application link has expired.");
      }
      if (!invite.verifiedAt) throw publicError(403, "Verify this application link before submitting.");

      const values = {
        name: `${data.firstName} ${data.lastName}`.trim(),
        phone: toStoredPhone(data.contactNumber),
        whatsappNumber: data.whatsappNumber ? toStoredPhone(data.whatsappNumber) : null,
        email: data.emailId,
        gender: data.gender,
        dateOfBirth: data.dateOfBirth,
        city: data.city,
        nativePlace: data.nativePlace,
        currentLocation: data.currentLocation,
        position: data.position,
        employmentType: data.employmentType,
        experience: data.experience,
        currentCompany: data.currentCompany,
        currentDesignation: data.currentDesignation,
        currentCtc: data.currentCtc,
        expectedCtc: data.expectedCtc,
        noticePeriod: data.noticePeriod,
        availableFrom: data.availableFrom,
        skills: data.skills,
        languagesKnown: data.languagesKnown,
        minExpectedCtc: data.minExpectedCtc,
        portfolioLinks: data.portfolioLinks,
        portfolioUrl: data.portfolioUrl,
        referredBy: data.referredBy,
        howYouKnowUs: data.howYouKnowUs,
        aboutUs: data.aboutUs,
        educationEntries: data.qualifications || [],
        experienceEntries: data.experiences || [],
        ...(resumeUrl ? { resumeUrl } : {}),
        // Only when something was attached, so a re-submission that adds none keeps what is there.
        ...(attachments?.length ? { attachments } : {}),
        ...(data.remarks ? { remarks: data.remarks } : {}),
      };
      const prepared = await service.prepareValues(values, { partial: true });
      // What the form writes: the candidate's own answers. The stage moves on only from the two
      // stages the form is the answer to; a candidate already shortlisted keeps their place.
      const existing = invite.candidateId ? await tx.hrmInterviewCandidate.findFirst({ where: { id: invite.candidateId, deletedAt: null } }) : null;
      let row;
      if (existing) {
        const advance = !existing.status || [DEFAULT_CANDIDATE_STATUS, FORM_PENDING_STATUS, FORM_SUBMITTED_STATUS].includes(existing.status);
        row = await tx.hrmInterviewCandidate.update({ where: { id: existing.id }, data: { ...prepared, ...(advance ? { status: FORM_SUBMITTED_STATUS } : {}) } });
      } else {
        row = await tx.hrmInterviewCandidate.create({
          data: { ...prepared, status: FORM_SUBMITTED_STATUS, source: APPLICATION_FORM_SOURCE, candidateCode: await service.nextCandidateCode(tx), appliedDate: prepared.appliedDate || new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()) },
        });
      }
      const updated = await tx.hrmInterviewApplicationInvite.updateMany({
        where: { id: invite.id, status: "Verified", submittedAt: null },
        data: { status: "Submitted", submittedAt: new Date(), candidateId: row.id },
      });
      if (updated.count !== 1) throw publicError(409, "This application has already been submitted.");
      return row;
    });
    return res.status(201).json({ message: "Application submitted successfully.", candidate: { candidateCode: candidate.candidateCode, name: candidate.name, status: candidate.status } });
  } catch (error) {
    if (error.publicStatus) return res.status(error.publicStatus).json({ message: error.message });
    if (error.status) return res.status(error.status).json({ message: error.message });
    console.error("[interview] Unable to submit an application:", error);
    return res.status(500).json({ message: "Unable to submit the application." });
  }
}

module.exports = { reportedInviteStatus, createInvite, listInvites, updateInvite, cancelInvite, sendInviteEmail, sendInviteWhatsApp, resendSubmittedForm, getPublicInvite, verifyPublicInvite, submitPublicInvite, applicationUrlFor, toStoredPhone, splitName };
