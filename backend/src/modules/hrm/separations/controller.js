const { z } = require("zod");
const whatsappGroups = require("../whatsapp-groups/service");
const { pendingWork, handOver } = require("./handover");
const prisma = require("../../../config/db");
const { storeDocument } = require("../../../services/documentStorage");
const { nextIdentifier } = require("../../../services/identifiers");
const { shiftDirectReportsUp, nearestWorkingManager } = require("../../../services/reportingLine");
const { ONBOARDING_STATUSES, workingEmployeeStatuses } = require("../../../services/employeeOptionLists");
const { studioDateKey } = require("../../../services/studioTime");
const noticeHold = require("../payroll-register/noticeHold");

const SEPARATION_DOCUMENT_FOLDER = "hrm/separations";

/**
 * Recording a separation is how an employee is marked inactive, so each type carries the status the
 * employee is moved to. The precise type stays on the separation row; the status is the coarser
 * bucket the repository already filters its InActive tab by.
 */
const STATUS_BY_TYPE = {
  Resignation: "Relieved",
  Termination: "Fired",
  Layoff: "Relieved",
  Retirement: "Relieved",
  "Contract End": "Relieved",
  Absconding: "Absconded",
  Death: "Relieved",
  "Mutual Separation": "Relieved",
};
const separationTypes = Object.keys(STATUS_BY_TYPE);

/**
 * Whether somebody leaving is still serving their notice: their proposed last working day is today
 * or later, on the studio's calendar. Until then they keep their status and their login, mark
 * attendance and show under the repository's Serving Notice tab; the day after it,
 * `separations/relieve.js` puts the separation's status on them and closes the login.
 *
 * Restored on 1 Nov 2026 after a spell (from 27 Oct) of relieving at once: the studio's payroll
 * holds a leaver's salary through the notice they serve and settles it after their last day, which
 * needs a notice that is actually served.
 *
 * Somebody never taken on - an onboarding status, or a fallen-through invite - has no notice to
 * serve, and is relieved the moment the separation is saved, as before.
 */
function servesNotice({ previousStatus, lastWorkingDate, now = new Date() }) {
  if (ONBOARDING_STATUSES.includes(previousStatus)) return false;
  return new Date(lastWorkingDate).toISOString().slice(0, 10) >= studioDateKey(now);
}

/**
 * What saving a separation does to the employee, given whether it was already relieved
 * (`relievedAt`): `{ relievedAt, employmentStatus, closeLogin, reopenLogin }`, `employmentStatus`
 * undefined where the status is left as it is.
 *
 * The last working day decides, whichever way it moved. Today or later: they serve their notice -
 * left alone, or, if already relieved, put back on the status they held with their login open again
 * for the notice that is left. Before today: relieved now, the login closed once.
 */
function separationEffect({ previousStatus, relievedAt = null, separationStatus, lastWorkingDate, now = new Date() }) {
  if (servesNotice({ previousStatus, lastWorkingDate, now })) {
    return { relievedAt: null, employmentStatus: relievedAt ? previousStatus || "Active" : undefined, closeLogin: false, reopenLogin: Boolean(relievedAt) };
  }
  return { relievedAt: relievedAt || now, employmentStatus: separationStatus, closeLogin: !relievedAt, reopenLogin: false };
}
/** Only these two begin with the employee handing something in. */
const typesWithSubmission = new Set(["Resignation", "Mutual Separation"]);

const optionalText = (max) => z.string().trim().max(max).nullable().optional();
const optionalDays = z.coerce.number().int().min(0).max(3650).nullable().optional();
// The letter is either freshly picked, arriving as a data URI under a file name, or the one already
// stored being echoed back. Either shape is handed to document storage, which knows the difference.
const documentSchema = z.object({
  name: z.string().trim().min(1).max(255),
  data: z.string().max(8_000_000).optional(),
  url: z.string().trim().max(8_000_000).optional(),
}).refine((value) => value.data || value.url, "Attach a document or leave it empty");

const separationSchema = z.object({
  separationType: z.enum(separationTypes),
  separationReason: z.string().trim().min(1).max(150),
  detailedReason: optionalText(5000),
  resignationDate: z.coerce.date().nullable().optional(),
  resignationLetter: documentSchema.nullable().optional(),
  proposedLastWorkingDate: z.coerce.date(),
  noticePeriodRequired: optionalDays,
  noticePeriodServed: optionalDays,
  noticePeriodWaived: optionalDays,
  waiverReason: optionalText(5000),
  earlyReleaseRequested: z.boolean().optional(),
  earlyReleaseReason: optionalText(5000),
  hrRemarks: optionalText(5000),
});
/*
 * Offboarding takes one of two subjects, and exactly one.
 *
 * `employeeId` is the ordinary case. `inviteId` is a hire that fell through before the candidate
 * ever submitted their form: the repository shows those as rows, but they are onboarding invites
 * with no employee record behind them, so there is nothing for a separation to point at. Given one,
 * the invite is turned into an employee record first and then offboarded like anybody else - which
 * is what puts the row in the InActive tab instead of making it vanish, and what lets Move to Active
 * bring it back to the wait it was in. See `employeeFromInvite`.
 */
const createSchema = separationSchema
  .extend({
    employeeId: z.coerce.number().int().positive().optional(),
    inviteId: z.string().trim().min(1).max(64).optional(),
    // Who takes over the leaver's pending work (`handover.js`). Required when there is any.
    handOverToEmployeeId: z.coerce.number().int().positive().optional(),
  })
  .refine((value) => Boolean(value.employeeId) !== Boolean(value.inviteId), {
    message: "Offboard either an employee or an onboarding invite, not both.",
    path: ["employeeId"],
  });
const idSchema = z.coerce.number().int().positive();
const listQuerySchema = z.object({ employeeId: z.coerce.number().int().positive().optional() });

function validationError(res, error) {
  return res.status(400).json({ message: "Validation failed", errors: error.flatten() });
}

function handleError(res, error, fallback) {
  if (error.status) return res.status(error.status).json({ message: error.message, ...(error.pending ? { pending: error.pending } : {}) });
  if (error.code === "P2003") return res.status(404).json({ message: "Employee not found" });
  if (error.code === "P2025") return res.status(404).json({ message: "Separation not found" });
  return res.status(500).json({ message: fallback, error: error.message });
}

function parseId(req, res) {
  const parsed = idSchema.safeParse(req.params.id);
  if (parsed.success) return parsed.data;
  validationError(res, parsed.error);
  return null;
}

const include = { employee: { select: { id: true, employeeId: true, employeeName: true, designation: true, department: true, dateOfJoining: true } } };

/**
 * A resignation date and letter belong to the two types that have an employee submission. Recorded
 * against any other type they would be a puzzle on the record, so they are dropped rather than kept.
 */
function submissionFields(input, stored) {
  if (!typesWithSubmission.has(input.separationType)) {
    return { resignationDate: null, resignationLetterName: null, resignationLetterUrl: null };
  }
  return {
    resignationDate: input.resignationDate ?? null,
    ...(stored === undefined ? {} : {
      resignationLetterName: stored ? stored.name : null,
      resignationLetterUrl: stored ? (stored.url || stored.data || null) : null,
    }),
  };
}

async function storeLetter(letter) {
  if (!letter) return null;
  return storeDocument(letter, { folder: SEPARATION_DOCUMENT_FOLDER });
}

function separationData(input, stored) {
  return {
    separationType: input.separationType,
    separationReason: input.separationReason,
    detailedReason: input.detailedReason ?? null,
    proposedLastWorkingDate: input.proposedLastWorkingDate,
    noticePeriodRequired: input.noticePeriodRequired ?? null,
    noticePeriodServed: input.noticePeriodServed ?? null,
    noticePeriodWaived: input.noticePeriodWaived ?? null,
    waiverReason: input.waiverReason ?? null,
    earlyReleaseRequested: input.earlyReleaseRequested ?? false,
    earlyReleaseReason: input.earlyReleaseReason ?? null,
    hrRemarks: input.hrRemarks ?? null,
    ...submissionFields(input, stored),
  };
}

async function listSeparations(req, res) {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) return validationError(res, parsed.error);
  try {
    const data = await prisma.employeeSeparation.findMany({
      where: parsed.data.employeeId ? { employeeId: parsed.data.employeeId } : {},
      orderBy: { proposedLastWorkingDate: "desc" },
      include,
    });
    return res.json({ data });
  } catch (error) { return handleError(res, error, "Unable to load separations"); }
}

async function getSeparation(req, res) {
  const id = parseId(req, res);
  if (!id) return;
  try {
    const data = await prisma.employeeSeparation.findUnique({ where: { id }, include });
    if (!data) return res.status(404).json({ message: "Separation not found" });
    return res.json({ data });
  } catch (error) { return handleError(res, error, "Unable to load this separation"); }
}

/**
 * The employee record a withdrawn invite becomes, so that it can be offboarded like anybody else.
 *
 * A candidate who never submitted their form has no record - the repository row they appear as is
 * built in the browser out of the invite. That row could only ever be *cancelled*, which removed it
 * from the list and left the studio with no account of a hire that fell through. Recording it
 * properly means there has to be something to record it against, and this is the smallest honest
 * one: the four answers the invite already holds, on a row that goes straight to a departure status
 * and is never handled as a live employee.
 *
 * `employmentStatus` is the status the repository was already showing the invite under, and it is
 * what the separation stores as `previousEmploymentStatus` a moment later - so Move to Active
 * returns the row to that same wait rather than promoting somebody who never started to Active.
 *
 * The invite is marked `Cancelled` and pointed at the new record: cancelled because the candidate
 * is not being asked for anything any more, pointed at it so the repository stops drawing the
 * invite row beside the employee row that now stands for it.
 */
async function employeeFromInvite(tx, inviteId) {
  const invite = await tx.employeeOnboardingInvite.findUnique({ where: { id: inviteId } });
  if (!invite) {
    const error = new Error("Onboarding invite not found");
    error.status = 404;
    throw error;
  }
  if (invite.employeeId) {
    // It has already become a record - through a submission, or through this - so that record is
    // what should have been offboarded. Saying so beats quietly creating a second one.
    const error = new Error("This invite already has an employee record. Offboard that record instead.");
    error.status = 409;
    throw error;
  }

  const employee = await tx.employee.create({
    data: {
      employeeId: await nextIdentifier("EMPLOYEE", {}, tx),
      employeeName: invite.candidateName,
      emailId: invite.candidateEmail,
      contactNumber: invite.candidatePhone,
      designation: invite.intendedDesignation || null,
      employmentStatus: "Employee Submission Pending",
    },
  });
  await tx.employeeOnboardingInvite.update({
    where: { id: invite.id },
    data: { status: "Cancelled", cancelledAt: new Date(), employeeId: String(employee.id) },
  });
  return employee;
}

/**
 * Recording a separation, as every caller does it.
 *
 * Lifted out of the route handler so the **offboarding invite** can approve a submission through
 * exactly this path (`hrm/offboarding-invites`): the status the employee moves to, the hand-over its
 * pending work demands, the reports shifted up, the login closed on the right day and the serving-
 * notice case are all decided here, once. An approval that wrote the separation itself would be a
 * second copy of all of it, and the copy would be the one that went stale.
 *
 * Throws with `status` (and `pending`, where the hand-over is what is missing); the handler below
 * turns that into a response, and so does the approval.
 */
async function recordSeparation({ employeeId, inviteId, resignationLetter, handOverToEmployeeId, actorId, input }) {
  // `findFirst` with the archive filter rather than `findUnique`: a removed employee is not there
  // to be offboarded, and reads as not found — which is what they are, everywhere else in the app.
  const employee = employeeId
    ? await prisma.employee.findFirst({ where: { id: employeeId, archivedAt: null }, select: { id: true, employmentStatus: true } })
    : null;
  if (employeeId && !employee) throw Object.assign(new Error("Employee not found"), { status: 404 });

  const existing = employeeId
    ? await prisma.employeeSeparation.findFirst({ where: { employeeId }, select: { id: true } })
    : null;
  if (existing) throw Object.assign(new Error("This employee already has a separation recorded."), { status: 409 });

  const employmentStatus = STATUS_BY_TYPE[input.separationType];
  const stored = await storeLetter(resignationLetter);

  // The separation and the status it puts the employee into are one change, so neither lands
  // without the other.
  return prisma.$transaction(async (tx) => {
    // A withdrawn invite becomes its record inside the same transaction that offboards it, so a
    // separation that fails to save cannot leave an employee behind who was never employed.
    const subject = employee || await employeeFromInvite(tx, inviteId);
    const effect = separationEffect({ previousStatus: subject.employmentStatus, separationStatus: employmentStatus, lastWorkingDate: input.proposedLastWorkingDate });
    // Payroll rules → Hold salary during notice, as it stands now: decided once, here, for this leaver.
    const salaryHold = await noticeHold.holdForSeparation({
      separationType: input.separationType,
      servesNotice: servesNotice({ previousStatus: subject.employmentStatus, lastWorkingDate: input.proposedLastWorkingDate }),
      resignationDate: input.resignationDate,
      today: studioDateKey(new Date()),
    }, tx);
    /*
     * ── Who takes their work, and who their team reports to - **when they actually go** ──
     *
     * Both of these used to happen the moment a separation was recorded, which for anyone serving
     * notice is weeks too early: they are still working, still their team's manager, and still the
     * person doing the work on their own name. Moving their reports up and reassigning their jobs on
     * the day they resign leaves somebody who comes in tomorrow with no team and nothing to do, and
     * it made approving a resignation demand an answer - "who takes over?" - about a day that had
     * not come yet, or refuse the resignation outright because nobody above them was free to take
     * their reports.
     *
     * So they belong to **relieving**, which is the day they become InActive: `relieve.js` does them
     * the morning after the last working day, in the same transaction that closes the login and
     * moves them out of Serving Notice.
     *
     * A separation with no notice to serve - an absconding, a termination today, a last working day
     * already past - makes them InActive *now*, so for those two this **is** that moment and both
     * run here exactly as they always did, hand-over question included.
     */
    if (!effect.relievedAt) {
      // Serving notice: nothing is taken off them yet.
    } else {
      await shiftDirectReportsUp(subject.id, tx);
      if (employee) {
        const pending = await pendingWork(tx, subject.id);
        if (pending.total && !handOverToEmployeeId) {
          throw Object.assign(new Error("Choose who takes over this employee's pending work."), { status: 409, pending });
        }
        if (pending.total) {
          const actor = await tx.user.findUnique({ where: { id: actorId }, select: { id: true, name: true, username: true } });
          await handOver(tx, { fromEmployeeId: subject.id, toEmployeeId: handOverToEmployeeId, actor: { id: actorId, name: actor?.name || actor?.username || "HR" } });
        }
      }
    }
    const created = await tx.employeeSeparation.create({
      data: {
        ...separationData(input, stored),
        employeeId: subject.id,
        employmentStatus,
        previousEmploymentStatus: subject.employmentStatus,
        relievedAt: effect.relievedAt,
        ...salaryHold,
        createdBy: actorId,
        updatedBy: actorId,
      },
      include,
    });
    await tx.employee.update({
      where: { id: subject.id },
      data: { ...(effect.employmentStatus ? { employmentStatus: effect.employmentStatus } : {}), dateOfRelieving: input.proposedLastWorkingDate, relievingRemarks: input.hrRemarks ?? null },
    });
    if (effect.closeLogin) await closeLogin(tx, subject.id);
    return created;
    // Room for a leaver who holds a lot: the hand-over is set-based, but it is still several writes.
  }, { timeout: 60000, maxWait: 10000 });
}

async function createSeparation(req, res) {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return validationError(res, parsed.error);
  const { employeeId, inviteId, resignationLetter, handOverToEmployeeId, ...input } = parsed.data;

  try {
    const actorId = Number(req.user.id);
    const data = await recordSeparation({ employeeId, inviteId, resignationLetter, handOverToEmployeeId, actorId, input });
    /*
     * A resignation recorded here, from the panel that opens filled in from the employee's own
     * offboarding form, settles that form too: it is approved and linked to this separation, as
     * approving it from Offboarding Forms would have done, rather than left waiting in HR's queue
     * for an exit already on record. Only a Submitted form, and only for a resignation - another
     * kind of exit is not an answer to their form. Never allowed to undo the separation above.
     */
    if (input.separationType === "Resignation" && data?.employeeId) {
      await prisma.employeeOffboardingInvite.updateMany({
        where: { employeeId: data.employeeId, status: "Submitted" },
        data: { status: "Approved", reviewedAt: new Date(), reviewedByUserId: actorId || null, separationId: data.id },
      }).catch((linkError) => console.error(`Separation ${data.id} recorded, but the employee's offboarding form could not be marked approved`, linkError?.message));
    }
    /*
     * **Out of the studio's WhatsApp groups, from the moment the exit is recorded.**
     *
     * The studio asked for it here rather than only at relieving, and relieving alone left two gaps:
     * a separation whose last working day is already past is relieved by this save and the scheduled
     * job never sees it (it looks for `relievedAt` null), so those people were never queued at all;
     * and somebody marked inactive without a separation has nothing for any job to find.
     *
     * Queued after the answer, like the reports and the forms: the exit is the time-critical half and
     * must be recorded whatever WhatsApp is doing. The rows are a queue worked through thirty seconds
     * apart, so a leaver in a dozen groups does not read as automation from the studio's number, and
     * `removeEmployeeFromAllGroups` never throws.
     *
     * Relieving still calls it too. It only moves rows that are currently in a group, so the second
     * call finds nothing left to do - which is what makes having both safe.
     *
     * **Somebody serving notice is removed now, while they are still coming in.** That is what was
     * asked for; it does mean a leaver loses their work groups on the day the exit is recorded rather
     * than on their last day.
     */
    if (data?.employeeId) {
      const left = await whatsappGroups.removeEmployeeFromAllGroups(data.employeeId, { userId: actorId });
      if (left.queued) console.log(`[separations] employee ${data.employeeId}: queued out of ${left.queued} WhatsApp ${left.queued === 1 ? "group" : "groups"} on recording the exit`);
    }
    return res.status(201).json({ data });
  } catch (error) { return handleError(res, error, "Unable to record this separation"); }
}


/**
 * What an employee still has pending - tasks, leads, projects, production - for the hand-over
 * pop-up the separation form shows before it saves.
 */
async function getPendingWork(req, res) {
  const id = idSchema.safeParse(req.params.employeeId);
  if (!id.success) return res.status(400).json({ message: "Choose an employee." });
  try {
    const employee = await prisma.employee.findFirst({ where: { id: id.data, archivedAt: null }, select: { id: true } });
    if (!employee) return res.status(404).json({ message: "Employee not found" });
    const pending = await pendingWork(prisma, employee.id);
    // Their manager is who usually takes over, so the pop-up starts there - the nearest one still
    // working, the same person their direct reports are about to be moved up to.
    const nearest = await nearestWorkingManager(employee.id, prisma);
    const manager = nearest ? { id: nearest.id, name: nearest.employeeName } : null;
    return res.json({ data: { ...pending, suggested: manager } });
  } catch (error) { return handleError(res, error, "Unable to read this employee's pending work"); }
}

/**
 * Hands a leaver's pending work to somebody, after they have gone.
 *
 * The other half of deferring this out of `recordSeparation`. Somebody serving notice keeps their
 * own work - they are still coming in to do it - so nothing is reassigned when the separation is
 * recorded; the day they are relieved they become **InActive**, and this is how HR moves what is
 * left. The same `handOver` the immediate separations run, with the same receiver check, so the work
 * lands exactly where it would have.
 *
 * Only for somebody **not working here**: on a person still serving notice it would take the work
 * off somebody who is in tomorrow to do it, and on anybody else it is not a hand-over at all - a
 * reassignment while somebody works here belongs to the screen that owns that work.
 */
async function handOverPendingWork(req, res) {
  const id = idSchema.safeParse(req.params.employeeId);
  if (!id.success) return res.status(400).json({ message: "Choose an employee." });
  const parsed = z.object({ toEmployeeId: z.coerce.number().int().positive() }).strict().safeParse(req.body);
  if (!parsed.success) return validationError(res, parsed.error);
  try {
    /*
     * Lazily required: `employees/controller` already requires this module, so asking for it at the
     * top of the file closes the circle.
     */
    const { scopedEmployee } = require("../employees/controller");
    const employee = await scopedEmployee(req, id.data, { id: true, employeeName: true, employmentStatus: true, dateOfRelieving: true }, { level: "READ_WRITE" });
    if (!employee) return res.status(404).json({ message: "Employee not found" });
    /*
     * One check, because "working here" covers both cases that must be refused: somebody who is
     * simply employed, and somebody serving notice - a working status with a relieving date set
     * (`isServingNotice`). The second is the one worth a sentence of its own: their work is still
     * theirs to finish, and taking it away mid-notice is how a leaver spends their last fortnight
     * with nothing to do.
     */
    if ((await workingEmployeeStatuses()).includes(employee.employmentStatus)) {
      return res.status(409).json({
        message: employee.dateOfRelieving
          ? `${employee.employeeName} is serving notice and is still doing their own work. Hand it over once they are relieved.`
          : `${employee.employeeName} still works here, so there is nothing to hand over.`,
      });
    }
    const actor = await prisma.user.findUnique({ where: { id: Number(req.user?.id) || 0 }, select: { id: true, name: true, username: true } });
    const moved = await prisma.$transaction(async (tx) => handOver(tx, {
      fromEmployeeId: employee.id,
      toEmployeeId: parsed.data.toEmployeeId,
      actor: { id: actor?.id || null, name: actor?.name || actor?.username || "HR" },
    }));
    return res.json({ data: moved });
  } catch (error) { return handleError(res, error, "Unable to hand this employee's pending work over"); }
}

async function updateSeparation(req, res) {
  const id = parseId(req, res);
  if (!id) return;
  const parsed = separationSchema.safeParse(req.body);
  if (!parsed.success) return validationError(res, parsed.error);
  const { resignationLetter, ...input } = parsed.data;

  try {
    const existing = await prisma.employeeSeparation.findUnique({ where: { id }, select: { id: true, employeeId: true, previousEmploymentStatus: true, relievedAt: true, salaryHeld: true, salaryHeldFrom: true } });
    if (!existing) return res.status(404).json({ message: "Separation not found" });
    // A held salary stays held only as a resignation or mutual separation, and from the resignation date
    // as corrected; a hold is never added here - it is decided when the separation is recorded.
    const salaryHold = existing.salaryHeld
      ? (["Resignation", "Mutual Separation"].includes(input.separationType)
        ? { salaryHeldFrom: input.resignationDate ? new Date(`${new Date(input.resignationDate).toISOString().slice(0, 10)}T00:00:00Z`) : existing.salaryHeldFrom }
        : { salaryHeld: false, salaryHeldFrom: null })
      : {};

    const employmentStatus = STATUS_BY_TYPE[input.separationType];
    const effect = separationEffect({ previousStatus: existing.previousEmploymentStatus, relievedAt: existing.relievedAt, separationStatus: employmentStatus, lastWorkingDate: input.proposedLastWorkingDate });
    // A letter is only re-stored when the request carried the field; a request that says nothing
    // about it leaves the one on file alone.
    const stored = "resignationLetter" in parsed.data ? await storeLetter(resignationLetter) : undefined;

    const data = await prisma.$transaction(async (tx) => {
      const updated = await tx.employeeSeparation.update({
        where: { id },
        data: { ...separationData(input, stored), employmentStatus, relievedAt: effect.relievedAt, ...salaryHold, updatedBy: Number(req.user.id) },
        include,
      });
      await tx.employee.update({
        where: { id: existing.employeeId },
        data: { ...(effect.employmentStatus ? { employmentStatus: effect.employmentStatus } : {}), dateOfRelieving: input.proposedLastWorkingDate, relievingRemarks: input.hrRemarks ?? null },
      });
      if (effect.closeLogin) await closeLogin(tx, existing.employeeId);
      if (effect.reopenLogin) await reopenLogin(tx, existing.employeeId);
      return updated;
    });
    return res.json({ data });
  } catch (error) { return handleError(res, error, "Unable to update this separation"); }
}

/**
 * The account a departure closes, and opens again if that departure is taken back.
 *
 * A user and an employee are separate records joined only by `linkedEmployeeId`, so marking
 * somebody Relieved, Fired or Absconded used to leave their login exactly as it was: they could
 * still sign in the next morning carrying every role they held, because nothing but `User.status`
 * decides that. Deleting an employee already closed the account this way; a departure - which is
 * what actually happens to most people who leave - did not.
 *
 * Inside the caller's transaction, so the status and the account can never disagree. The roles are
 * deliberately left on the account: closing it is what stops the sign-in, and stripping the grants
 * as well would mean rebuilding them by hand for somebody who returns, or whose offboarding turns
 * out to have been recorded in error.
 */
function setLoginStatus(client, employeeId, status) {
  return client.user.updateMany({ where: { linkedEmployeeId: employeeId }, data: { status } });
}
const closeLogin = (client, employeeId) => setLoginStatus(client, employeeId, "INACTIVE");
const reopenLogin = (client, employeeId) => setLoginStatus(client, employeeId, "ACTIVE");

/** Removing a separation entered by mistake puts the employee back on the status they held before. */
async function deleteSeparation(req, res) {
  const id = parseId(req, res);
  if (!id) return;
  try {
    const existing = await prisma.employeeSeparation.findUnique({ where: { id }, select: { employeeId: true, previousEmploymentStatus: true, relievedAt: true } });
    if (!existing) return res.status(404).json({ message: "Separation not found" });

    await prisma.$transaction(async (tx) => {
      await tx.employeeSeparation.delete({ where: { id } });
      await tx.employee.update({
        where: { id: existing.employeeId },
        data: { employmentStatus: existing.previousEmploymentStatus || "Active", dateOfRelieving: null, relievingRemarks: null },
      });
      // Somebody still serving notice never had their login closed, so there is nothing to reopen.
      if (existing.relievedAt) await reopenLogin(tx, existing.employeeId);
    });
    return res.status(204).send();
  } catch (error) { return handleError(res, error, "Unable to remove this separation"); }
}

module.exports = {
  handOverPendingWork, recordSeparation, getPendingWork, listSeparations, getSeparation, createSeparation, updateSeparation, deleteSeparation, employeeFromInvite, separationCreateSchema: createSchema, closeLogin, reopenLogin, separationEffect, servesNotice, separationTypes, STATUS_BY_TYPE };
