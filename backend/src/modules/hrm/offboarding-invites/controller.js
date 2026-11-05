const crypto = require("crypto");
const { z } = require("zod");
const prisma = require("../../../config/db");
const { sendOffboardingInviteEmail, sendOffboardingSendBackEmail } = require("../../../services/emailService");
const { describeMailFailure } = require("../../../services/mailFailure");
const { storeDocument } = require("../../../services/documentStorage");
// To clear up a letter whose submission lost the race, rather than leaving it in the bucket.
const { deleteObject } = require("../../../services/objectStorage");
const { SHORT_CODE_PATTERN, generateShortCode } = require("../../../services/shortCode");
const { nextIdentifier } = require("../../../services/identifiers");
const { workingEmployeeStatuses } = require("../../../services/employeeOptionLists");
const whatsappActivity = require("../../../services/whatsappActivity");
const messageSwitches = require("../../../services/messageTemplateSwitches");
const { sendWhatsAppToPerson } = require("../../sales/whatsapp-chat/directSend");
const { recordSeparation } = require("../separations/controller");
// The onboarding invite's own number comparison, not a second one: a record holding `+91 98765 43210`
// and somebody typing `9876543210` are the same person, and deciding that twice is how the two
// gates drift apart.
const { phonesMatch } = require("../onboarding-invites/controller");
const { studioDateKey } = require("../../../services/studioTime");
const noticeHold = require("../payroll-register/noticeHold");
const payrollVersions = require("../payroll-register/settingsVersions");

/*
 * The offboarding invite: the form HR sends somebody who is leaving, and what they fill in.
 *
 * ── Why an invite at all ──
 *
 * HR could always record a separation outright (`hrm/separations`), and still can - an absconding,
 * a termination, a death are nobody's form to fill. What was missing is the ordinary case: somebody
 * resigns, and the dates that decide their notice are **theirs** to state. So HR raises a form
 * against them, says how many days of notice is to be served, and sends it; they answer from when
 * they are serving it, and the form shows the last working day that falls out of the two.
 *
 * ── What it does and does not decide ──
 *
 * The invite is the correspondence. The **separation** is the record, and writing one is what moves
 * somebody to Serving Notice - which is why approving a submission goes through
 * `separations.createSeparation` rather than touching the employee here: that path already demands
 * the leaver's pending work be handed over, closes the login on the right day, shifts their direct
 * reports up, and leaves the roll-up in `separations/relieve.js` to relieve them the morning after
 * their last working day. None of that is worth a second implementation.
 *
 * So a submitted form changes nothing about the employee. HR reads it, confirms the dates, and
 * approves; a form filled in by mistake is rejected and the person's employment is untouched.
 *
 * ── The link ──
 *
 * The same mechanics as the onboarding invite next door, for the same reasons: a short code in the
 * shared URL, the 64-hex token still accepted for links already sent, the hash as what is matched,
 * and the raw token kept so the identical link can be sent again. The public routes are rate
 * limited and never cached (`publicRoutes.js`).
 */

const OFFBOARDING_LETTER_FOLDER = "hrm/offboarding/letter";
/*
 * What a resignation letter may be: the signed page as a PDF, or a photograph of it.
 *
 * Narrower than the list `documentStorage` stores in general, because this upload comes from an
 * unauthenticated form and lands on a bucket HR opens files from. A spreadsheet or a Word document
 * is not a resignation letter, and a macro in one is a delivery route to the HR desk.
 */
const LETTER_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"];

/*
 * Why somebody is leaving, as a list rather than a sentence they type.
 *
 * **HR's own list**, from `separationFormConfig.separationReasonsByType.Resignation` on the other
 * side - the reasons the separation form offers for a resignation. A second list here would be the
 * one that drifted, and a free-typed reason is unreportable: the studio cannot count how many people
 * left for a better opportunity if each of them wrote it their own way. The place to say more is the
 * detailed reason below it, which is theirs to word.
 */
const RESIGNATION_REASONS = [
  "Better Opportunity",
  "Higher Studies",
  "Relocation",
  "Personal Reasons",
  "Health Reasons",
  "Family Commitments",
  "Compensation",
  "Work Environment",
  "Career Change",
  "Others",
];

/*
 * Sent → Verified → Submitted → Approved | Rejected, and Cancelled or Expired at any point before
 * the submission. `Approved` and `Rejected` are HR's answer and are terminal: the link stops
 * working, because the thing it was for has happened.
 *
 * **Sent Back** is the way out of a submission that is nearly right - the wrong date, a reason that
 * does not match what they said, a letter they forgot. Rejecting it is not that: a rejection says
 * the resignation itself was not accepted, which is a different thing to tell somebody and leaves
 * them unable to correct anything. So the form reopens with their own answers still on it, they
 * edit and send it again, and it comes back to HR as a submission. The status is its own rather
 * than a return to `Verified`, because the register should say which forms have been round once.
 */
const inviteStatuses = ["Sent", "Verified", "Submitted", "Sent Back", "Approved", "Rejected", "Cancelled", "Expired"];
// Every status the link still opens on - a sent-back form among them, which is the point of it.
const OPEN_STATUSES = ["Sent", "Verified", "Sent Back"];

/*
 * The four messages a form is owed, sent on WhatsApp from the sender's own WhatsApp to the number on
 * the employee's record (`contactNumber`, as their login credentials are) - each only while the form
 * is in the state the message speaks of, and only while the message is switched on under Settings →
 * Templates. The text is what the screen shows, as every Send WhatsApp in the app sends.
 */
const WHATSAPP_MESSAGES = Object.freeze({
  FORM: { key: "EMPLOYEE_OFFBOARDING_FORM", trigger: "OFFBOARDING_FORM", statuses: OPEN_STATUSES, open: true, what: "Offboarding form" },
  REMINDER: { key: "EMPLOYEE_OFFBOARDING_REMINDER", trigger: "OFFBOARDING_REMINDER", statuses: OPEN_STATUSES, open: true, what: "Reminder" },
  APPROVED: { key: "EMPLOYEE_OFFBOARDING_APPROVED", trigger: "OFFBOARDING_APPROVED", statuses: ["Approved"], what: "Confirmation" },
  NOT_ACCEPTED: { key: "EMPLOYEE_OFFBOARDING_NOT_ACCEPTED", trigger: "OFFBOARDING_NOT_ACCEPTED", statuses: ["Rejected"], what: "Message" },
});
const sendWhatsAppSchema = z.object({
  kind: z.enum(Object.keys(WHATSAPP_MESSAGES)),
  message: z.string().trim().min(1).max(4096),
});
/** How long a form stays open unless HR says otherwise. Long enough to chase, short enough to lapse. */
const DEFAULT_VALID_DAYS = 21;
const MAX_NOTICE_DAYS = 365;

const OFFBOARDING_TOKEN_PATTERN = /^[a-f0-9]{64}$/i;
const hashToken = (token) => crypto.createHash("sha256").update(token).digest("hex");
const generateToken = () => crypto.randomBytes(32).toString("hex");
const frontendBaseUrl = () => (process.env.FRONTEND_URL || "http://localhost:3000").replace(/\/$/, "");

/** Which identifier a shared link carries: the short code where there is one, else the long token. */
const offboardingLinkCode = (invite, heldToken = null) => invite?.shortCode || heldToken || invite?.token || null;
function offboardingUrlFor(invite, heldToken = null) {
  const code = offboardingLinkCode(invite, heldToken);
  return code ? `${frontendBaseUrl()}/offboarding/apply/${code}` : null;
}

/** Either public identifier, and nothing else: a 64-hex token, or an 8-character short code. */
function classifyInviteIdentifier(identifier) {
  const value = String(identifier || "").trim();
  if (OFFBOARDING_TOKEN_PATTERN.test(value)) return { where: { tokenHash: hashToken(value) } };
  if (SHORT_CODE_PATTERN.test(value)) return { where: { shortCode: value.toUpperCase() } };
  return null;
}

/**
 * The last working day: the day before the notice ends, counting from the day notice starts.
 *
 * Calendar days, which is what a notice period means - 30 days from 5 Nov is 4 Dec, their last
 * working day, and the day after it is their first day gone. Worked in UTC on a date-only value so
 * nobody's last day moves with a timezone, the way `addMonths` in the referral schedule is.
 */
function lastWorkingDateFrom(noticeStartDate, noticePeriodDays) {
  const start = new Date(`${String(noticeStartDate).slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime())) return null;
  // Blank is not zero: `Number("")` is 0, and 0 days would answer with the start date itself.
  if (noticePeriodDays === "" || noticePeriodDays === null || noticePeriodDays === undefined) return null;
  const days = Number(noticePeriodDays);
  if (!Number.isInteger(days) || days < 0) return null;
  // `days - 1`, because the first day of notice is a day served: a one-day notice starting today
  // ends today.
  return new Date(start.getTime() + Math.max(0, days - 1) * 86_400_000);
}

/*
 * Whether HR set the resignation date when raising the form - it carries one and has never been
 * submitted. Then the date is HR's: the employee sees it, cannot change it, and the server keeps it
 * whatever a submission says. A form sent back after a submission carries the employee's own date,
 * which stays theirs to correct.
 */
const hrSetResignationDate = (invite) => Boolean(invite?.resignationDate) && !invite?.submittedAt;

const optionalText = (max) => z.string().trim().max(max).nullable().optional();
/*
 * The letter, as the browser hands it over: a name and a data URI. No `url` field at all - a public
 * caller's url is discarded by `trustUrls: false` anyway, and a field that is always dropped is one
 * somebody later believes in.
 */
const documentSchema = z.object({
  name: z.string().trim().min(1).max(255),
  data: z.string().max(8_000_000),
}).strict();

const createSchema = z.object({
  employeeId: z.coerce.number().int().positive(),
  noticePeriodDays: z.coerce.number().int().min(0).max(MAX_NOTICE_DAYS),
  hrNote: optionalText(2000),
  expiresAt: z.coerce.date().optional(),
  // The resignation date HR already knows, if they do. The employee's form opens on it, and they can
  // still change it; the last working day is worked out here from it, never taken from the request.
  resignationDate: z.coerce.date().optional(),
}).strict();

/*
 * What the form sends: the resignation date, why, anything more they want to say, and the letter if
 * they attached one. **Three answers and a file, and nothing else.**
 *
 * `reason` is one of the list, not free text - `z.enum`, so a value nobody could have picked is a
 * 400 rather than an unreportable sentence in the register's Reason column.
 *
 * The **last working day is not sent at all**. It is the notice period counted from the resignation
 * date, worked out here and stored here: the form shows it so nobody agrees to a date they cannot
 * see, but a date posted from a browser would be a second answer to the one question this form
 * exists to settle, and the one somebody could quietly shorten. Leaving before the notice runs out
 * is a conversation with HR, who can set the date on the separation itself.
 */
const submitSchema = z.object({
  resignationDate: z.coerce.date(),
  reason: z.enum(RESIGNATION_REASONS),
  detailedReason: optionalText(5000),
  letter: documentSchema.nullable().optional(),
}).strict();

const reviewSchema = z.object({
  decision: z.enum(["Approved", "Rejected"]),
  remark: optionalText(5000),
  // The hand-over the separation demands when the leaver still holds work. Read here so the
  // approval can pass it straight on rather than asking HR for it twice.
  handOverToEmployeeId: z.coerce.number().int().positive().optional(),
}).strict();

/*
 * Sending a submission back always says what to correct.
 *
 * Not optional, and not a nicety: the employee is being asked to open their resignation form again,
 * and "please check it" tells them nothing about which of four answers is wrong. The remark is what
 * the form shows them when it reopens.
 */
const sendBackSchema = z.object({ remark: z.string().trim().min(1).max(5000) }).strict();

/*
 * What can be corrected on a form already sent: the notice period, the note that went with it, and
 * how long the link stays open.
 *
 * Not who it is for. A form raised against the wrong person is cancelled and raised again - moving
 * it would leave the employee who was emailed the link holding one that now asks somebody else's
 * name, and the register would lose the fact that the first form existed at all.
 */
const updateSchema = z.object({
  noticePeriodDays: z.coerce.number().int().min(0).max(MAX_NOTICE_DAYS),
  hrNote: optionalText(2000),
  expiresAt: z.coerce.date().optional(),
  resignationDate: z.coerce.date().optional(),
}).strict();

const identifierSchema = z.object({ identifier: z.string().trim().min(1).max(191) }).strict();
const inviteIdSchema = z.string().cuid();

function validationError(res, error) {
  return res.status(400).json({ message: "Validation failed", errors: error.flatten() });
}

function handleError(res, error, fallback) {
  if (error?.status) return res.status(error.status).json({ message: error.message });
  console.error(fallback, error);
  return res.status(500).json({ message: fallback });
}

/**
 * The same, for the public routes - and it logs the error's **code and message only**.
 *
 * A Prisma error prints the query's arguments, and on these routes those arguments are somebody's
 * resignation: the reason they are leaving, the note they wrote, and in local development the
 * letter itself as inline base64. None of that belongs in a log file read for an unrelated reason.
 */
function handlePublicError(res, error, fallback) {
  if (error?.status) return res.status(error.status).json({ message: error.message });
  console.error(`${fallback} [${error?.code || error?.name || "error"}] ${String(error?.message || "").slice(0, 200)}`);
  return res.status(500).json({ message: fallback });
}

/**
 * The employees this caller may act on, which is **not** every employee.
 *
 * `HRM / Employee Management` is held per branch: somebody granted it for one branch runs that
 * branch's HR, and a form raised against a person they cannot reach is a resignation recorded
 * outside their remit. So the register, the dropdown and all four writes go through the Employee
 * Repository's own `employeeVisibility` - the same definition the employee list narrows itself by,
 * named with the permission it is asking about, as Rule 4's branch reach requires.
 *
 * Lazily required as a precaution rather than a fix: `employees/controller` pulls in this module's
 * neighbours (separations, onboarding invites), and requiring it from the top of a module those in
 * turn reach is the shape a cycle appears in. Nothing here depends on the laziness today.
 */
const employeeVisibility = (req, level = "READ") => require("../employees/controller").employeeVisibility(req, level);

/**
 * One invite's employee, confirmed to be in this caller's reach, or `null`.
 *
 * `null` answers 404 rather than 403 on purpose: a form against somebody outside their branches is
 * one they are not shown, and "no such form" is what the register already told them.
 */
async function reachableEmployee(req, employeeId, level) {
  if (!employeeId) return null;
  const visible = await employeeVisibility(req, level);
  const employee = await prisma.employee.findFirst({
    where: { id: employeeId, archivedAt: null },
    // The scope's own columns, plus what the handlers read off the row.
    select: { ...employeeSelect, branchId: true, workBaseLocation: true, currentWorkLocation: true },
  });
  return employee && visible.allows(employee) ? employee : null;
}

/*
 * The employee's own columns, as this module reads them.
 *
 * `designationRef` beside the `designation` text on purpose: the text is a **copy**
 * (`services/nameCopies.js`), and the client extension that resolves copies into the linked name
 * does not reach inside a nested include - so an invite read through `include: { employee }` carries
 * whatever the copy said when it was written, which a rename in master data has since moved on
 * from. Read the relation and prefer it; the copy answers only where nothing is linked.
 */
const employeeSelect = {
  id: true,
  employeeId: true,
  employeeName: true,
  designation: true,
  designationRef: { select: { name: true } },
  department: true,
  // The departments the person is actually filed under, which is what the form shows them: the
  // `department` text beside it is the copy, and a person may be in more than one team.
  departments: { select: { department: { select: { name: true } } } },
  reportsTo: { select: { employeeName: true, designation: true, designationRef: { select: { name: true } } } },
  dateOfJoining: true,
  emailId: true,
  workEmailId: true,
  contactNumber: true,
  employmentStatus: true,
  dateOfRelieving: true,
  archivedAt: true,
};

/**
 * The seven things the form fills in by itself, read off the record rather than asked for.
 *
 * Nobody resigning should be made to type their own employee ID, designation or joining date: the
 * studio holds all of it, and a form that asks is a form that can be answered wrongly. They are
 * shown so the person can see **whose** exit this is before they confirm anything - the one check
 * worth their attention - and none of them is editable here. A detail that is wrong is a
 * conversation with HR, not a box on a resignation form.
 */
function autoFilledFrom(employee) {
  if (!employee) return null;
  const teams = (employee.departments || []).map((link) => link.department?.name).filter(Boolean);
  return {
    employeeCode: employee.employeeId || null,
    employeeName: employee.employeeName || null,
    designation: employee.designationRef?.name || employee.designation || null,
    // The linked teams where there are any, and the text copy only where nothing is linked.
    department: teams.length ? teams.join(", ") : employee.department || null,
    reportingManager: employee.reportsTo?.employeeName || null,
    reportingManagerDesignation: employee.reportsTo?.designationRef?.name || employee.reportsTo?.designation || null,
    dateOfJoining: employee.dateOfJoining || null,
    // The work address where the studio gave them one; their own otherwise. The login address is
    // deliberately not here - it is a credential, not a contact detail.
    officialEmail: employee.workEmailId || employee.emailId || null,
  };
}

/** One invite as every screen reads it. The link is given only where the caller may see it. */
/*
 * Where the leaver stands now, which an Approved form alone does not say - HR Offboarding List shows
 * this rather than the form's own status. Approved and its separation still on record: **Serving
 * Notice** while they are still on a working status, else the status they left on (Relieved,
 * Absconded, Fired). Approved but the separation since removed (moved back to Active): **Withdrawn**.
 * Every other form reads its own status. `working` is the working statuses, read by the caller.
 */
function offboardingStage(invite, working) {
  if (invite.status !== "Approved" || !working) return invite.status;
  if (!invite.separationId) return "Withdrawn";
  const status = invite.employee?.employmentStatus;
  return !status || working.has(status) ? "Serving Notice" : status;
}

function serializeInvite(invite, { withLink = false, settingsOf = null, working = null } = {}) {
  const employee = invite.employee || null;
  // The day the leaver's full and final settlement is paid - the payable date of the payroll month
  // whose cycle holds their last working day (as the separation now has it) - for the message that
  // confirms their resignation. Only where the payroll settings were read for it.
  const lastDay = invite.separation?.proposedLastWorkingDate || invite.proposedLastWorkingDate;
  const settlesIn = settingsOf && lastDay ? noticeHold.settlementMonth(new Date(lastDay).toISOString().slice(0, 10), settingsOf) : null;
  return {
    id: invite.id,
    offboardingId: invite.offboardingId,
    status: invite.status,
    stage: offboardingStage(invite, working),
    employeeId: invite.employeeId,
    employeeCode: employee?.employeeId || null,
    employeeName: employee?.employeeName || null,
    designation: employee?.designationRef?.name || employee?.designation || null,
    department: employee?.department || null,
    employeeEmail: employee?.emailId || null,
    employeeContact: employee?.contactNumber || null,
    noticePeriodDays: invite.noticePeriodDays,
    hrNote: invite.hrNote,
    expiresAt: invite.expiresAt,
    verifiedAt: invite.verifiedAt,
    submittedAt: invite.submittedAt,
    cancelledAt: invite.cancelledAt,
    resignationDate: invite.resignationDate,
    /*
     * The last working day the notice period comes to. Stored rather than recomputed on every read,
     * because it is the date the studio acts on - the separation carries it, and the roll-up that
     * relieves them reads it - and because the employee was shown exactly this date when they
     * submitted. A figure recomputed later would move the day if the rule or the days ever changed.
     */
    proposedLastWorkingDate: invite.proposedLastWorkingDate,
    reason: invite.reason,
    detailedReason: invite.detailedReason,
    letterFileName: invite.letterFileName,
    letterUrl: invite.letterUrl,
    reviewedAt: invite.reviewedAt,
    sentBackAt: invite.sentBackAt,
    sendBackRemark: invite.sendBackRemark,
    reviewedBy: invite.reviewedBy?.name || null,
    reviewRemark: invite.reviewRemark,
    separationId: invite.separationId,
    // Payroll rules → Hold salary during notice, as it was decided for this leaver's separation.
    salaryHeld: Boolean(invite.separation?.salaryHeld),
    finalSettlementOn: settlesIn?.payableOn || null,
    createdAt: invite.createdAt,
    ...(withLink ? { offboardingUrl: offboardingUrlFor(invite), tokenPreview: invite.tokenPreview } : {}),
  };
}

const listInclude = {
  employee: { select: employeeSelect },
  reviewedBy: { select: { name: true } },
  separation: { select: { salaryHeld: true, proposedLastWorkingDate: true } },
};

/** Every offboarding form, newest first - the register HR works. */
async function listInvites(req, res) {
  try {
    const visible = await employeeVisibility(req);
    const invites = await prisma.employeeOffboardingInvite.findMany({
      // `archivedAt: null` as well, because `reachableEmployee` has it: without it the register
      // listed forms about archived people that then 404'd on every action offered beside them.
      where: { employee: { archivedAt: null, AND: [visible.where] } },
      orderBy: { createdAt: "desc" },
      include: listInclude,
    });
    const [settingsOf, working] = await Promise.all([payrollVersions.settingsBook(prisma), workingEmployeeStatuses()]);
    return res.json({ data: invites.map((invite) => serializeInvite(invite, { withLink: true, settingsOf, working: new Set(working) })) });
  } catch (error) {
    return handleError(res, error, "Unable to load offboarding forms.");
  }
}

/**
 * Who a form can be raised against: somebody working here, who is not already serving their notice
 * and has no form open. Offered as the dialog's dropdown, so HR picks a person rather than typing a
 * name - the record exists, unlike a candidate's.
 */
async function listCandidates(req, res) {
  try {
    // Asked at `READ_WRITE`, because picking somebody here is the first step of changing their
    // record: `EMPLOYEE_SCOPE_COLUMNS` grants a branch's rows on reach, so asking at `READ` would
    // offer staff this caller may read through one role and not act on through any.
    const visible = await employeeVisibility(req, "READ_WRITE");
    const [employees, open] = await Promise.all([
      prisma.employee.findMany({
        where: { archivedAt: null, employmentStatus: { in: await workingEmployeeStatuses() }, dateOfRelieving: null, AND: [visible.where] },
        select: { id: true, employeeId: true, employeeName: true, designation: true, department: true, emailId: true },
        orderBy: { employeeName: "asc" },
      }),
      prisma.employeeOffboardingInvite.findMany({
        where: { status: { in: [...OPEN_STATUSES, "Submitted"] } },
        select: { employeeId: true },
      }),
    ]);
    const busy = new Set(open.map((invite) => invite.employeeId));
    return res.json({ data: employees.filter((employee) => !busy.has(employee.id)) });
  } catch (error) {
    return handleError(res, error, "Unable to load the employees a form can be sent to.");
  }
}

/** Raises the form and answers with the link; sending it is the next call. */
async function createInvite(req, res) {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return validationError(res, parsed.error);
  const { employeeId, noticePeriodDays, hrNote } = parsed.data;
  const resignationKey = parsed.data.resignationDate ? studioDateKey(parsed.data.resignationDate) : null;
  const expiresAt = parsed.data.expiresAt || new Date(Date.now() + DEFAULT_VALID_DAYS * 86_400_000);
  if (expiresAt <= new Date()) return res.status(400).json({ message: "The form's last day must be in the future." });

  try {
    // Never the id as the body sent it: the row has to be one this caller reaches.
    const employee = await reachableEmployee(req, employeeId, "READ_WRITE");
    if (!employee) return res.status(404).json({ message: "Employee not found." });
    if (!(await workingEmployeeStatuses()).includes(employee.employmentStatus)) {
      return res.status(409).json({ message: `${employee.employeeName} is not working here, so there is no notice to serve.` });
    }
    if (employee.dateOfRelieving) {
      return res.status(409).json({ message: `${employee.employeeName} is already serving notice. Their offboarding is recorded on their own record.` });
    }
    const existing = await prisma.employeeOffboardingInvite.findFirst({
      where: { employeeId, status: { in: [...OPEN_STATUSES, "Submitted"] } },
      select: { id: true, status: true },
    });
    if (existing) return res.status(409).json({ message: "This employee already has an offboarding form open." });

    const token = generateToken();
    // The short code is allocated with the invite, retrying past the unique constraint until an
    // unclaimed one lands - the way onboarding invites and gallery codes do.
    let invite = null;
    for (let attempt = 0; attempt < 5 && !invite; attempt += 1) {
      try {
        invite = await prisma.$transaction(async (tx) => {
          const offboardingId = await nextIdentifier("OFFBOARDING_INVITE", {}, tx);
          return tx.employeeOffboardingInvite.create({
            data: {
              offboardingId,
              employeeId,
              noticePeriodDays,
              hrNote: hrNote || null,
              ...(resignationKey ? {
                resignationDate: new Date(`${resignationKey}T00:00:00.000Z`),
                proposedLastWorkingDate: lastWorkingDateFrom(resignationKey, noticePeriodDays),
              } : {}),
              expiresAt,
              tokenHash: hashToken(token),
              tokenPreview: `${token.slice(0, 4)}…${token.slice(-4)}`,
              token,
              shortCode: generateShortCode(8),
              createdByUserId: Number(req.user?.id) || null,
            },
            include: listInclude,
          });
        });
      } catch (error) {
        if (error?.code !== "P2002") throw error;
      }
    }
    if (!invite) return res.status(500).json({ message: "Unable to raise the offboarding form." });
    return res.status(201).json({ data: serializeInvite(invite, { withLink: true }), token });
  } catch (error) {
    return handleError(res, error, "Unable to raise the offboarding form.");
  }
}

/**
 * One form by id, for a caller who may act on the person it is about. Both halves answer the same
 * 404: a malformed cuid is not a form, and neither is one about somebody out of reach.
 */
async function scopedInvite(req, res, level = "READ_WRITE") {
  const id = inviteIdSchema.safeParse(req.params.id);
  if (!id.success) {
    res.status(404).json({ message: "Offboarding form not found." });
    return null;
  }
  const invite = await prisma.employeeOffboardingInvite.findUnique({ where: { id: id.data }, include: listInclude });
  if (!invite || !(await reachableEmployee(req, invite.employeeId, level))) {
    res.status(404).json({ message: "Offboarding form not found." });
    return null;
  }
  return invite;
}

/** Emails the form to the address the studio reaches them on - never the login address. */
async function sendInviteEmail(req, res) {
  try {
    const invite = await scopedInvite(req, res);
    if (!invite) return undefined;
    if (!OPEN_STATUSES.includes(invite.status)) return res.status(409).json({ message: "This form is no longer open, so it cannot be sent again." });
    // A link past its last day opens to a 410, so emailing it sends somebody to a dead page. The
    // status is still `Sent` until somebody opens it, which is why the date is checked here too.
    if (invite.expiresAt <= new Date()) return res.status(409).json({ message: "This form's last day has passed. Raise a new one." });
    const to = invite.employee?.emailId;
    if (!to) return res.status(400).json({ message: `${invite.employee?.employeeName || "This employee"} has no email address on their record. Add one, or copy the link and send it another way.` });
    const url = offboardingUrlFor(invite);
    if (!url) return res.status(409).json({ message: "This form has no link to send." });

    const result = await sendOffboardingInviteEmail({
      employeeName: invite.employee.employeeName,
      email: to,
      offboardingUrl: url,
      expiresAt: invite.expiresAt,
      noticePeriodDays: invite.noticePeriodDays,
    });
    if (result?.sent === false) return res.status(503).json({ message: describeMailFailure(result.reason) });
    // Sending the link again is HR saying "try again", so it hands back the verify tries: a leaver
    // locked out by their own typing is unblocked by the resend they would ask for anyway.
    await prisma.employeeOffboardingInvite.updateMany({ where: { id: invite.id }, data: { verifyFailures: 0, verifyLockedUntil: null } });
    return res.json({ data: { sent: true, to } });
  } catch (error) {
    return handleError(res, error, "Unable to email the offboarding form.");
  }
}

/**
 * Sends one of the form's messages on WhatsApp (`WHATSAPP_MESSAGES`): the form or a reminder while it
 * is open and in date, the confirmation once approved, the refusal once rejected. Recorded in
 * Settings → WhatsApp Activity Log, where a failed one can be sent again.
 */
async function sendInviteWhatsApp(req, res) {
  const parsed = sendWhatsAppSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ message: "Choose which message to send, and write it." });
  try {
    const invite = await scopedInvite(req, res);
    if (!invite) return undefined;
    const kind = WHATSAPP_MESSAGES[parsed.data.kind];
    await messageSwitches.assertEnabled(kind.key);
    if (!kind.statuses.includes(invite.status)) {
      return res.status(409).json({ message: kind.open ? "This form is no longer open, so it cannot be sent again." : "This form is no longer in the state this message speaks of. Reload to see where it is." });
    }
    if (kind.open && invite.expiresAt <= new Date()) return res.status(409).json({ message: "This form's last day has passed. Raise a new one." });
    const name = invite.employee?.employeeName || "the employee";
    await whatsappActivity.track({
      mode: "MANUAL", provider: "baileys", trigger: kind.trigger, eventRef: `offboarding-invite:${invite.id}`,
      initiatedByUserId: req.user.id, senderUserId: req.user.id,
      recipient: { kind: "PERSON", address: invite.employee?.contactNumber || "", name: invite.employee?.employeeName || null },
      templateKey: kind.key, body: parsed.data.message, resendable: true, links: { employeeId: invite.employeeId },
    }, () => sendWhatsAppToPerson({
      userId: req.user.id,
      phone: invite.employee?.contactNumber,
      body: parsed.data.message,
      noNumberMessage: `${name} has no contact number on their record. Add one before sending on WhatsApp.`,
    }));
    return res.json({ message: `${kind.what} sent on WhatsApp to ${name}.` });
  } catch (error) {
    // The send's own refusals - switched off, WhatsApp not linked, the number not on WhatsApp - say why.
    if (error?.status) return res.status(error.status).json({ message: error.message, ...(error.code ? { code: error.code } : {}) });
    console.error(`[hrm] Offboarding WhatsApp refused for form ${req.params.id}:`, error.message);
    return res.status(502).json({ message: "Unable to send this message on WhatsApp." });
  }
}

/** Called off before it was filled in. A submitted or decided form is not cancelled; it is history. */
async function cancelInvite(req, res) {
  try {
    const invite = await scopedInvite(req, res);
    if (!invite) return undefined;
    if (!OPEN_STATUSES.includes(invite.status)) return res.status(409).json({ message: "Only a form that is still open can be cancelled." });
    // Claimed on its status rather than on its id alone: a form the employee is filling in at this
    // moment must not be cancelled from under a submission that has already gone through.
    const claimed = await prisma.employeeOffboardingInvite.updateMany({
      where: { id: invite.id, status: { in: OPEN_STATUSES } },
      data: { status: "Cancelled", cancelledAt: new Date() },
    });
    if (!claimed.count) return res.status(409).json({ message: "This form has just been filled in, so it can no longer be cancelled." });
    const updated = await prisma.employeeOffboardingInvite.findUnique({ where: { id: invite.id }, include: listInclude });
    return res.json({ data: serializeInvite(updated, { withLink: true }) });
  } catch (error) {
    return handleError(res, error, "Unable to cancel the offboarding form.");
  }
}

/*
 * A resignation form removed from the register, at any status - HR Offboarding List's ⋮ Delete, and
 * the ticked rows through `/offboarding-invites/bulk`, both through here so the two cannot drift.
 * Only a form this caller may reach at Read / Write; anything else is "not found", as a form out of
 * reach is everywhere else. The uploaded letter goes with it. A separation the form recorded is
 * **not** touched - it is the employee's own record (their notice, relieving date and payroll hold)
 * and points nowhere back here; only the form is removed.
 */
async function deleteInviteRecord(req, rawId) {
  const id = inviteIdSchema.safeParse(rawId);
  const invite = id.success
    ? await prisma.employeeOffboardingInvite.findUnique({ where: { id: id.data }, select: { id: true, employeeId: true, letterKey: true } })
    : null;
  if (!invite || !(await reachableEmployee(req, invite.employeeId, "READ_WRITE"))) {
    throw Object.assign(new Error("Offboarding form not found."), { status: 404 });
  }
  await prisma.employeeOffboardingInvite.delete({ where: { id: invite.id } });
  if (invite.letterKey) await deleteObject(invite.letterKey).catch(() => {});
  return invite;
}

async function deleteInvite(req, res) {
  try {
    await deleteInviteRecord(req, req.params.id);
    return res.json({ message: "Resignation form deleted." });
  } catch (error) {
    if (error?.status === 404) return res.status(404).json({ message: error.message });
    return handleError(res, error, "Unable to delete the offboarding form.");
  }
}

/**
 * A form already sent, corrected - the notice period HR typed wrongly, the note they meant to add,
 * or a link that needs longer.
 *
 * Only while it is **open**: once somebody has filled it in, changing the notice period would move a
 * last working day they have already been shown and agreed to, which is Send Back's job rather than
 * this one. The link itself never changes, so the employee's copy keeps working.
 */
async function updateInvite(req, res) {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return validationError(res, parsed.error);
  if (parsed.data.expiresAt && parsed.data.expiresAt <= new Date()) {
    return res.status(400).json({ message: "The form's last day must be in the future." });
  }
  try {
    const invite = await scopedInvite(req, res);
    if (!invite) return undefined;
    if (!OPEN_STATUSES.includes(invite.status)) {
      return res.status(409).json({
        message: invite.status === "Submitted"
          ? "This form has been filled in. Send it back if the notice period is wrong, so they can see the dates it changes."
          : "This form is no longer open, so it cannot be edited.",
      });
    }
    // HR's resignation date, changed or kept, and the last working day recounted from it whenever
    // the notice period moves - so the date the employee is shown never disagrees with the notice.
    const resignationKey = parsed.data.resignationDate
      ? studioDateKey(parsed.data.resignationDate)
      : hrSetResignationDate(invite) ? studioDateKey(invite.resignationDate) : null;
    const updated = await prisma.employeeOffboardingInvite.update({
      where: { id: invite.id },
      data: {
        noticePeriodDays: parsed.data.noticePeriodDays,
        hrNote: parsed.data.hrNote || null,
        ...(parsed.data.expiresAt ? { expiresAt: parsed.data.expiresAt } : {}),
        ...(resignationKey ? {
          resignationDate: new Date(`${resignationKey}T00:00:00.000Z`),
          proposedLastWorkingDate: lastWorkingDateFrom(resignationKey, parsed.data.noticePeriodDays),
        } : {}),
      },
      include: listInclude,
    });
    return res.json({ data: serializeInvite(updated, { withLink: true }) });
  } catch (error) {
    return handleError(res, error, "Unable to edit this offboarding form.");
  }
}

/**
 * A submission handed back for a correction.
 *
 * The missing move between approving and rejecting. A form with the wrong date on it, or a reason
 * that does not match what the person said, or no letter attached, is not a resignation to refuse -
 * refusing says the exit itself was not accepted, which is a different thing to tell somebody and
 * leaves them nothing to fix. So the form reopens on the **same link**, still carrying their own
 * answers, with HR's remark saying what to look at; they edit and send it again.
 *
 * Nothing about the employee is touched, because nothing was: a submission has never changed their
 * employment - only an approval does that. So this is the invite's own status and dates and no
 * transaction across tables.
 *
 * The expiry is pushed out to at least a week, the way the onboarding send-back does it: a form
 * reopened two days before its link lapses is a correction nobody can make.
 */
async function sendBackInvite(req, res) {
  const parsed = sendBackSchema.safeParse(req.body);
  if (!parsed.success) return validationError(res, parsed.error);
  try {
    const invite = await scopedInvite(req, res);
    if (!invite) return undefined;
    if (invite.status !== "Submitted") {
      return res.status(409).json({ message: invite.status === "Approved" || invite.status === "Rejected" ? "This form has already been decided, so it cannot be sent back." : "This form has not been filled in yet, so there is nothing to send back." });
    }
    if (!offboardingLinkCode(invite)) {
      return res.status(409).json({ message: "This form has no link left to reopen. Cancel it and raise a new one." });
    }

    const expiresAt = new Date(Math.max(invite.expiresAt.getTime(), Date.now() + 7 * 86_400_000));
    // Claimed on `Submitted` like every other decision, so a form being approved in another tab at
    // this moment is not reopened from under the separation that approval is writing.
    const claimed = await prisma.employeeOffboardingInvite.updateMany({
      where: { id: invite.id, status: "Submitted" },
      data: {
        status: "Sent Back",
        // Their answers stay exactly as they are - this is an edit, not a fresh form - and only
        // the submission itself is undone.
        submittedAt: null,
        expiresAt,
        sentBackAt: new Date(),
        sendBackRemark: parsed.data.remark,
        sentBackByUserId: Number(req.user?.id) || null,
      },
    });
    if (!claimed.count) return res.status(409).json({ message: "This form has just been decided, so it cannot be sent back." });
    const updated = await prisma.employeeOffboardingInvite.findUnique({ where: { id: invite.id }, include: listInclude });

    /*
     * Telling them is the last thing and the least of it: the form is already open again, and a
     * refused email does not undo that. So a failure answers with the form and the link rather than
     * an error, and the screen offers the message to send by hand - the same shape the onboarding
     * send-back answers in, and for the same reason.
     */
    let emailFailure = null;
    const to = updated.employee?.emailId;
    if (!to) emailFailure = `${updated.employee?.employeeName || "This employee"} has no email address on their record`;
    else {
      try {
        const result = await sendOffboardingSendBackEmail({
          employeeName: updated.employee.employeeName,
          email: to,
          offboardingUrl: offboardingUrlFor(updated),
          expiresAt,
          remark: parsed.data.remark,
        });
        if (result?.sent === false) emailFailure = describeMailFailure(result.reason);
      } catch (error) {
        // The reason only, never the thrown text: an SMTP error can quote the message it carried.
        console.error(`[hrm] Offboarding send-back email refused for form ${invite.id}:`, error.message);
        emailFailure = describeMailFailure(error);
      }
    }
    return res.json({
      data: serializeInvite(updated, { withLink: true }),
      emailSent: !emailFailure,
      ...(emailFailure ? { warning: `The form was reopened, but the email could not be sent: ${emailFailure}.` } : {}),
    });
  } catch (error) {
    return handleError(res, error, "Unable to send this offboarding form back.");
  }
}

/* ────────────────────────────────── the employee's own link ────────────────────────────────── */

/*
 * Why a link no longer opens, in a word as well as a sentence.
 *
 * `state` is there because the page needs to know whether this is a **failure**. A form that has
 * already been sent in is the one state here that is not one: it is the ordinary end of this link,
 * and a red "cannot be opened" for somebody who did everything right reads as their resignation
 * having gone wrong. The page tones itself from this rather than matching on the wording.
 */
function unavailableInviteResponse(res, invite) {
  const states = {
    Cancelled: ["cancelled", "This offboarding form has been cancelled. Speak to HR."],
    Submitted: ["submitted", "You have already sent this form to HR."],
    Approved: ["approved", "This offboarding form has been approved. Your dates are on your record."],
    Rejected: ["rejected", "This offboarding form was not accepted. Speak to HR."],
  };
  const [state, message] = states[invite.status] || ["expired", "This offboarding form has expired. Ask HR for a new one."];
  return res.status(410).json({ state, message });
}

async function findUsableInvite(identifier) {
  const classified = classifyInviteIdentifier(identifier);
  if (!classified) return { invite: null, state: "missing" };
  const invite = await prisma.employeeOffboardingInvite.findUnique({ where: classified.where, include: listInclude });
  if (!invite) return { invite: null, state: "missing" };
  if (!OPEN_STATUSES.includes(invite.status)) return { invite, state: "unavailable" };
  if (invite.expiresAt <= new Date()) {
    const expired = await prisma.employeeOffboardingInvite.update({ where: { id: invite.id }, data: { status: "Expired" }, include: listInclude });
    return { invite: expired, state: "expired" };
  }
  return { invite, state: "valid" };
}

/*
 * Masked, because nothing is proved yet: enough to say *which* of their two contacts to type, not
 * enough to reconstruct it.
 *
 * Deliberately meaner than a mask that shows the first letters and the length. What is behind this
 * link is somebody's resignation, and the gate in front of it is a contact detail - so a mask that
 * narrows the guess is part of the gate. The email keeps its domain, since that is usually the
 * studio's own and tells a guesser nothing; the local part is a fixed run of dots, so neither its
 * letters nor its length leak. The phone keeps its last two digits, enough to tell a personal
 * number from a work one.
 */
const maskEmail = (email) => {
  const [name = "", domain = ""] = String(email || "").split("@");
  if (!name || !domain) return "";
  return `••••@${domain}`;
};
const maskPhone = (phone) => {
  const digits = String(phone || "").replace(/\D/g, "");
  return digits.length >= 2 ? `••••••${digits.slice(-2)}` : "";
};

/**
 * How many wrong contacts a link takes before it stops asking.
 *
 * The network-wide limiter counts misses per address, which a guesser defeats by moving address; a
 * counter on the **form** cannot be moved off. Five is generous for somebody typing their own email
 * and far short of useful for guessing one, and HR raises a new form when it locks.
 */
const MAX_VERIFY_FAILURES = 5;
/** And for how long it stops asking. Long enough to end a guesser, short enough to be a pause. */
const VERIFY_LOCK_MINUTES = 30;

/** What the page shows before anybody has proved who they are. */
async function getPublicInvite(req, res) {
  try {
    const result = await findUsableInvite(req.params.token);
    if (result.state === "missing") return res.status(404).json({ message: "This offboarding form is invalid or unavailable." });
    if (result.state !== "valid") return unavailableInviteResponse(res, result.invite);
    const { invite } = result;
    return res.json({
      data: {
        status: invite.status,
        expiresAt: invite.expiresAt,
        noticePeriodDays: invite.noticePeriodDays,
        maskedEmail: maskEmail(invite.employee?.emailId),
        maskedPhone: maskPhone(invite.employee?.contactNumber),
      },
    });
  } catch (error) {
    return handlePublicError(res, error, "Unable to open this offboarding form.");
  }
}

/** Their own email or phone, as the record holds it: the link's gate, as onboarding's is. */
async function verifyPublicInvite(req, res) {
  const parsed = identifierSchema.safeParse(req.body);
  if (!parsed.success) return validationError(res, parsed.error);
  try {
    const result = await findUsableInvite(req.params.token);
    if (result.state === "missing") return res.status(404).json({ verified: false, message: "This offboarding form is invalid or unavailable." });
    if (result.state !== "valid") return unavailableInviteResponse(res, result.invite);

    const { invite } = result;
    /*
     * A try is **taken** before the answer is looked at, and taken conditionally.
     *
     * Read-then-compare-then-increment was not a cap at all: a script firing fifty requests at once
     * had every one of them read `verifyFailures` as 0, pass the check, and be compared, while the
     * increments landed behind them. Only the per-address limiter stood in the way, and that is the
     * thing a guesser defeats by changing address. So the budget is spent in the same statement
     * that checks it: an `updateMany` conditional on there being a try left, which the database
     * serialises, and a count of 0 means there was not one.
     *
     * The window rather than a permanent lock, because the lock is also a weapon: anybody who gets
     * hold of the link - a forwarded email, a chat preview - could otherwise spend five wrong
     * answers and shut the real leaver out of their own form for good. Half an hour costs a guesser
     * everything and costs somebody mistyping their own address a cup of tea.
     */
    const now = new Date();
    if (invite.verifyLockedUntil && invite.verifyLockedUntil > now) {
      return res.status(429).json({ verified: false, message: "Too many wrong answers. Try again in half an hour, or ask HR to send you a new form." });
    }
    const tryTaken = await prisma.employeeOffboardingInvite.updateMany({
      where: { id: invite.id, verifyFailures: { lt: MAX_VERIFY_FAILURES } },
      data: { verifyFailures: { increment: 1 } },
    });
    if (!tryTaken.count) {
      // The budget is spent: close the link for the window and start the count again, so the next
      // window has its own five rather than refusing for ever on the same five.
      await prisma.employeeOffboardingInvite.updateMany({
        where: { id: invite.id },
        data: { verifyFailures: 0, verifyLockedUntil: new Date(now.getTime() + VERIFY_LOCK_MINUTES * 60_000) },
      });
      return res.status(429).json({ verified: false, message: "Too many wrong answers. Try again in half an hour, or ask HR to send you a new form." });
    }

    const typed = parsed.data.identifier.trim();
    const matchesEmail = typed.toLowerCase() === String(invite.employee?.emailId || "").toLowerCase();
    const matchesPhone = phonesMatch(typed, invite.employee?.contactNumber);
    if (!matchesEmail && !matchesPhone) {
      const left = Math.max(0, MAX_VERIFY_FAILURES - (invite.verifyFailures + 1));
      return res.status(400).json({
        verified: false,
        // The count is said out loud: somebody typing their own address and getting it wrong twice
        // deserves to know the link is running out, and it tells a guesser nothing it could not
        // count itself.
        message: left ? `That does not match our record. ${left} ${left === 1 ? "try" : "tries"} left.` : "That does not match our record. Try again in half an hour, or ask HR for a new form.",
      });
    }

    /*
     * Right answer. The count goes back to nothing, and the status is moved **conditionally**: a
     * form HR cancelled between the read above and this write must not be reopened as Verified by
     * somebody who was mid-answer when they did it.
     */
    const opened = await prisma.employeeOffboardingInvite.updateMany({
      where: { id: invite.id, status: { in: OPEN_STATUSES } },
      data: { verifiedAt: now, verifyFailures: 0, verifyLockedUntil: null, ...(invite.status === "Sent" ? { status: "Verified" } : {}) },
    });
    if (!opened.count) {
      const current = await prisma.employeeOffboardingInvite.findUnique({ where: { id: invite.id } });
      return unavailableInviteResponse(res, current || invite);
    }
    const updated = await prisma.employeeOffboardingInvite.findUnique({ where: { id: invite.id }, include: listInclude });
    return res.json({
      verified: true,
      data: {
        // The record's own seven, so the form fills itself in rather than asking them to.
        ...autoFilledFrom(updated.employee),
        noticePeriodDays: updated.noticePeriodDays,
        hrNote: updated.hrNote,
        expiresAt: updated.expiresAt,
        /*
         * What they answered last time, where there was a last time.
         *
         * A form sent back for a correction is an **edit**: handing back a blank form would make
         * somebody re-enter three right answers to fix the fourth, and the one they are least likely
         * to re-attach is the letter. `letterFileName` is the name only - the file itself is already
         * stored, and a form resubmitted without a new one keeps it.
         */
        answers: updated.sentBackAt ? {
          resignationDate: updated.resignationDate,
          reason: updated.reason,
          detailedReason: updated.detailedReason,
          proposedLastWorkingDate: updated.proposedLastWorkingDate,
          letterFileName: updated.letterFileName,
        // Not sent back, but HR gave the resignation date when raising it: the form shows that, fixed.
        } : hrSetResignationDate(updated) ? {
          resignationDate: updated.resignationDate,
          proposedLastWorkingDate: updated.proposedLastWorkingDate,
        } : null,
        // The resignation date is HR's and is shown, not asked (`hrSetResignationDate`).
        resignationDateFixed: hrSetResignationDate(updated),
        // What HR asked them to correct, which is the whole reason the form is open again.
        sendBackRemark: updated.sentBackAt ? updated.sendBackRemark : null,
        // The list they pick their reason from, sent with the form rather than written into the
        // page: it is HR's list, and the server is where the two sides agree on it.
        reasons: RESIGNATION_REASONS,
      },
    });
  } catch (error) {
    return handlePublicError(res, error, "Unable to verify this offboarding form.");
  }
}

/**
 * The form, filled in. Nothing about their employment changes here: the dates are recorded, the
 * form goes to HR as Submitted, and HR's approval is what writes the separation.
 */
async function submitPublicInvite(req, res) {
  const parsed = submitSchema.safeParse(req.body);
  if (!parsed.success) return validationError(res, parsed.error);
  try {
    const result = await findUsableInvite(req.params.token);
    if (result.state === "missing") return res.status(404).json({ message: "This offboarding form is invalid or unavailable." });
    if (result.state !== "valid") return unavailableInviteResponse(res, result.invite);
    const { invite } = result;
    if (!invite.verifiedAt) return res.status(409).json({ message: "Verify your email or phone before sending the form." });

    /*
     * The one date they answer with, and the one the server works out from it.
     *
     * The notice period runs from the day they resign, so the last working day is arithmetic - and
     * it is this server's arithmetic, not the browser's. Nothing about it is taken from the request.
     */
    // HR's date where HR set one - never the request's - and theirs otherwise.
    const resignationKey = studioDateKey(hrSetResignationDate(invite) ? invite.resignationDate : parsed.data.resignationDate);
    const proposed = lastWorkingDateFrom(resignationKey, invite.noticePeriodDays);
    if (!proposed) return res.status(400).json({ message: "Enter the date you are resigning." });

    /*
     * The letter is stored **before** the form is claimed, and the claim writes it with everything
     * else - one write, in this order, for a reason worth stating.
     *
     * `trustUrls: false` because this is a public form: the shortcut that echoes an `http(s)` url
     * back untouched is right for an authenticated edit returning the files already on a record,
     * and on a token-authenticated form it would let whoever holds the link decide what the
     * studio's "resignation letter" points at, with nothing ever uploaded. `types` narrows it to a
     * PDF or a photograph of the signed page.
     *
     * Storing first because `storeDocument` **refuses** things: a file too large, a type this form
     * does not take, bytes that do not carry the type they claim, or a bucket having a bad day.
     * Claimed first, every one of those left the form Submitted with the dates saved and no letter,
     * and the employee holding a link that now answers "already sent" - their one submission spent
     * on an error. Stored first, a refusal leaves the form open and they simply try again.
     */
    const letter = parsed.data.letter ? await storeDocument(parsed.data.letter, { folder: OFFBOARDING_LETTER_FOLDER, trustUrls: false, types: LETTER_TYPES }) : null;
    /*
     * And the form is claimed on its **status**, not merely updated by id.
     *
     * Two sends at once - a double tap, or a link open in two tabs - both passed the status check
     * above, and the second overwrote the first's dates. A conditional update is the lock: whoever's
     * `updateMany` counts 1 owns the submission, and the loser is told the form has already gone in.
     * The loser's upload is deleted rather than left in the bucket for nothing.
     */
    const claimed = await prisma.employeeOffboardingInvite.updateMany({
      where: { id: invite.id, status: { in: OPEN_STATUSES } },
      data: {
        status: "Submitted",
        submittedAt: new Date(),
        resignationDate: new Date(`${resignationKey}T00:00:00.000Z`),
        proposedLastWorkingDate: proposed,
        reason: parsed.data.reason,
        detailedReason: parsed.data.detailedReason || null,
        ...(letter ? { letterKey: letter.key, letterUrl: letter.url || letter.data || null, letterFileName: letter.name } : {}),
      },
    });
    if (!claimed.count) {
      if (letter?.key) await deleteObject(letter.key).catch(() => {});
      return res.status(410).json({ state: "submitted", message: "You have already sent this form to HR." });
    }
    const updated = await prisma.employeeOffboardingInvite.findUnique({ where: { id: invite.id }, include: listInclude });
    return res.json({
      data: {
        status: updated.status,
        resignationDate: updated.resignationDate,
        proposedLastWorkingDate: updated.proposedLastWorkingDate,
        // What the notice period came to, so the page can say whether what they proposed is early.
        noticePeriodDays: updated.noticePeriodDays,
      },
    });
  } catch (error) {
    return handlePublicError(res, error, "Unable to send this offboarding form.");
  }
}

/**
 * HR's answer to a submission: approve it, which writes the separation, or reject it with a reason.
 *
 * **Approving is what moves them to Serving Notice**, and it does it by writing a separation through
 * `separations.recordSeparation` - the one path that also hands their pending work on, shifts their
 * reports up, sets the relieving date and leaves the roll-up to relieve them the morning after their
 * last working day. Nothing about the employee is touched here; a form filled in by mistake and
 * rejected leaves their employment exactly as it was.
 *
 * The separation is a Resignation: the form exists because somebody resigned, and the other kinds -
 * a termination, an absconding - are nobody's form to fill and are still recorded by HR directly.
 *
 * The 409 that asks who takes over the leaver's work is passed back as it comes, `pending` and all,
 * so the screen can offer the hand-over picker and try again - exactly as the separation form does.
 */
async function reviewInvite(req, res) {
  const parsed = reviewSchema.safeParse(req.body);
  if (!parsed.success) return validationError(res, parsed.error);
  const { decision, remark, handOverToEmployeeId } = parsed.data;
  if (decision === "Rejected" && !remark) return res.status(400).json({ message: "Say why the form was not accepted." });

  try {
    const invite = await scopedInvite(req, res);
    if (!invite) return undefined;
    if (invite.status !== "Submitted") {
      return res.status(409).json({ message: invite.status === "Approved" || invite.status === "Rejected" ? "This form has already been decided." : "This form has not been filled in yet." });
    }

    /*
     * The hand-over, checked before it is passed on. It is the last id here that came from the
     * request body, and `recordSeparation` takes it as given - so without this a branch-scoped HR
     * user could put the leaver's work on somebody in a branch they do not reach.
     */
    if (handOverToEmployeeId) {
      const taker = await reachableEmployee(req, handOverToEmployeeId, "READ_WRITE");
      if (!taker) return res.status(404).json({ message: "The employee you picked to hand the work over to was not found." });
      if (taker.id === invite.employeeId) return res.status(400).json({ message: "Pick somebody other than the person leaving to take the work on." });
      if (!(await workingEmployeeStatuses()).includes(taker.employmentStatus) || taker.dateOfRelieving) {
        return res.status(409).json({ message: `${taker.employeeName} is not working here, so the work cannot be handed to them.` });
      }
    }

    const actorId = Number(req.user?.id) || null;
    /*
     * The decision is claimed on `Submitted` the way the submission is claimed on its open status,
     * and for a worse reason than tidiness: two approvals racing each other would both reach
     * `recordSeparation` and write the person two separations. The claim happens **before** the
     * separation for exactly that, and an approval that then fails - the hand-over 409 below, say -
     * puts the status back, so the form returns to HR's queue rather than being lost as Approved
     * with nothing recorded.
     */
    const claim = async () => {
      const claimed = await prisma.employeeOffboardingInvite.updateMany({
        where: { id: invite.id, status: "Submitted" },
        data: { status: decision, reviewedAt: new Date(), reviewedByUserId: actorId, reviewRemark: remark || null },
      });
      return claimed.count > 0;
    };
    if (decision === "Rejected") {
      if (!(await claim())) return res.status(409).json({ message: "This form has already been decided." });
      const updated = await prisma.employeeOffboardingInvite.findUnique({ where: { id: invite.id }, include: listInclude });
      return res.json({ data: serializeInvite(updated, { withLink: true }) });
    }
    if (!(await claim())) return res.status(409).json({ message: "This form has already been decided." });

    let separation = null;
    try {
      separation = await recordSeparation({
        employeeId: invite.employeeId,
        handOverToEmployeeId,
        actorId,
        // The letter is already stored, so it is handed over by url rather than uploaded again.
        resignationLetter: invite.letterUrl && invite.letterFileName ? { name: invite.letterFileName, url: invite.letterUrl } : null,
        input: {
          separationType: "Resignation",
          // Their own answers, in HR's own vocabulary: the reason comes from the list the separation
          // form offers, so the record reads as though HR had filled it in - and reports as one.
          separationReason: invite.reason || "Resignation",
          detailedReason: invite.detailedReason || null,
          resignationDate: invite.resignationDate || invite.submittedAt,
          proposedLastWorkingDate: invite.proposedLastWorkingDate,
          noticePeriodRequired: invite.noticePeriodDays,
          hrRemarks: remark || null,
        },
      });
    } catch (error) {
      /*
       * Nothing was recorded, so the form goes back to the queue it was claimed out of - and the
       * **original** error is what the caller hears either way. A revert that itself fails (a
       * database blip) must not replace a 409 that was about to ask HR who takes over the leaver's
       * work; that would leave the form reading Approved and the question unasked.
       */
      try {
        await prisma.employeeOffboardingInvite.updateMany({
          where: { id: invite.id, status: "Approved" },
          data: { status: "Submitted", reviewedAt: null, reviewedByUserId: null, reviewRemark: null },
        });
      } catch (revertError) {
        console.error(`Unable to return offboarding form ${invite.id} to Submitted after a failed approval`, revertError?.message);
      }
      throw error;
    }
    /*
     * The separation **exists** from here on, so nothing below is allowed to undo this approval.
     *
     * `separationId` is the link between the two rows, not the fact of the exit: if writing it
     * fails, the person is on Serving Notice and the form is Approved, which is the truth, and a
     * reverted form would be the lie. So it is attempted, logged if it will not take, and the
     * approval is reported as what it is.
     */
    const updated = await prisma.employeeOffboardingInvite
      .update({ where: { id: invite.id }, data: { separationId: separation.id }, include: listInclude })
      .catch(async (error) => {
        console.error(`Offboarding form ${invite.id} approved as separation ${separation.id}, but the link between them could not be written`, error?.message);
        return prisma.employeeOffboardingInvite.findUnique({ where: { id: invite.id }, include: listInclude });
      });
    return res.json({ data: serializeInvite(updated, { withLink: true }), separation });
  } catch (error) {
    // The hand-over question, passed through with what is pending so the screen can ask it.
    if (error?.status === 409 && error.pending) return res.status(409).json({ message: error.message, pending: error.pending });
    return handleError(res, error, "Unable to approve this offboarding form.");
  }
}

module.exports = {
  offboardingStage,
  deleteInvite,
  deleteInviteRecord,
  reviewInvite,
  hrSetResignationDate,
  inviteStatuses,
  OPEN_STATUSES,
  lastWorkingDateFrom,
  offboardingUrlFor,
  classifyInviteIdentifier,
  listInvites,
  listCandidates,
  createInvite,
  sendInviteEmail,
  sendInviteWhatsApp,
  WHATSAPP_MESSAGES,
  cancelInvite,
  sendBackInvite,
  updateInvite,
  getPublicInvite,
  verifyPublicInvite,
  submitPublicInvite,
  serializeInvite,
  listInclude,
  reviewSchema,
  sendBackSchema,
  updateSchema,
  inviteIdSchema,
  validationError,
  handleError,
  handlePublicError,
  MAX_VERIFY_FAILURES,
  VERIFY_LOCK_MINUTES,
  LETTER_TYPES,
  RESIGNATION_REASONS,
  autoFilledFrom,
};
