const { z } = require("zod");
const prisma = require("../../../config/db");
const { storeDocument } = require("../../../services/documentStorage");
const { nextIdentifier } = require("../../../services/identifiers");

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
  if (error.status) return res.status(error.status).json({ message: error.message });
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

async function createSeparation(req, res) {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return validationError(res, parsed.error);
  const { employeeId, inviteId, resignationLetter, ...input } = parsed.data;

  try {
    // `findFirst` with the archive filter rather than `findUnique`: a removed employee is not there
    // to be offboarded, and reads as not found — which is what they are, everywhere else in the app.
    const employee = employeeId
      ? await prisma.employee.findFirst({ where: { id: employeeId, archivedAt: null }, select: { id: true, employmentStatus: true } })
      : null;
    if (employeeId && !employee) return res.status(404).json({ message: "Employee not found" });

    const existing = employeeId
      ? await prisma.employeeSeparation.findFirst({ where: { employeeId }, select: { id: true } })
      : null;
    if (existing) return res.status(409).json({ message: "This employee already has a separation recorded." });

    const actorId = Number(req.user.id);
    const employmentStatus = STATUS_BY_TYPE[input.separationType];
    const stored = await storeLetter(resignationLetter);

    // The separation and the status it puts the employee into are one change, so neither lands
    // without the other.
    const data = await prisma.$transaction(async (tx) => {
      // A withdrawn invite becomes its record inside the same transaction that offboards it, so a
      // separation that fails to save cannot leave an employee behind who was never employed.
      const subject = employee || await employeeFromInvite(tx, inviteId);
      const created = await tx.employeeSeparation.create({
        data: {
          ...separationData(input, stored),
          employeeId: subject.id,
          employmentStatus,
          previousEmploymentStatus: subject.employmentStatus,
          createdBy: actorId,
          updatedBy: actorId,
        },
        include,
      });
      await tx.employee.update({
        where: { id: subject.id },
        data: { employmentStatus, dateOfRelieving: input.proposedLastWorkingDate, relievingRemarks: input.hrRemarks ?? null },
      });
      await closeLogin(tx, subject.id);
      return created;
    });
    return res.status(201).json({ data });
  } catch (error) { return handleError(res, error, "Unable to record this separation"); }
}

async function updateSeparation(req, res) {
  const id = parseId(req, res);
  if (!id) return;
  const parsed = separationSchema.safeParse(req.body);
  if (!parsed.success) return validationError(res, parsed.error);
  const { resignationLetter, ...input } = parsed.data;

  try {
    const existing = await prisma.employeeSeparation.findUnique({ where: { id }, select: { id: true, employeeId: true } });
    if (!existing) return res.status(404).json({ message: "Separation not found" });

    const employmentStatus = STATUS_BY_TYPE[input.separationType];
    // A letter is only re-stored when the request carried the field; a request that says nothing
    // about it leaves the one on file alone.
    const stored = "resignationLetter" in parsed.data ? await storeLetter(resignationLetter) : undefined;

    const data = await prisma.$transaction(async (tx) => {
      const updated = await tx.employeeSeparation.update({
        where: { id },
        data: { ...separationData(input, stored), employmentStatus, updatedBy: Number(req.user.id) },
        include,
      });
      await tx.employee.update({
        where: { id: existing.employeeId },
        data: { employmentStatus, dateOfRelieving: input.proposedLastWorkingDate, relievingRemarks: input.hrRemarks ?? null },
      });
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
    const existing = await prisma.employeeSeparation.findUnique({ where: { id }, select: { employeeId: true, previousEmploymentStatus: true } });
    if (!existing) return res.status(404).json({ message: "Separation not found" });

    await prisma.$transaction(async (tx) => {
      await tx.employeeSeparation.delete({ where: { id } });
      await tx.employee.update({
        where: { id: existing.employeeId },
        data: { employmentStatus: existing.previousEmploymentStatus || "Active", dateOfRelieving: null, relievingRemarks: null },
      });
      await reopenLogin(tx, existing.employeeId);
    });
    return res.status(204).send();
  } catch (error) { return handleError(res, error, "Unable to remove this separation"); }
}

module.exports = { listSeparations, getSeparation, createSeparation, updateSeparation, deleteSeparation, employeeFromInvite, separationCreateSchema: createSchema, closeLogin, reopenLogin, separationTypes, STATUS_BY_TYPE };
