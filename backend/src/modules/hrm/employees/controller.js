const { z } = require("zod");
const { workingEmployeeStatuses } = require("../../../services/employeeOptionLists");
const { lookups: referenceLookups } = require("../../../services/referenceMatchers");
const { syncEmployeeReferral } = require("../referrals/service");
const { reopenLogin } = require("../separations/controller");
const { isValidPhoneNumber } = require("../../../services/phoneNumber");
const bcrypt = require("bcryptjs");
const { Prisma } = require("@prisma/client");
const prisma = require("../../../config/db");
const iamService = require("../../../services/iam.service");
const dataScope = require("../../../services/dataScope.service");
const { nextIdentifier, peekIdentifier } = require("../../../services/identifiers");
const { importTableRows, templateHeaders } = require("../../../services/tableImport");
const { sendEmployeeCredentialsEmail } = require("../../../services/emailService");
const { storeImage, discardUploads } = require("../../../services/imageStorage");
const { storeDocument } = require("../../../services/documentStorage");
// Shared with the onboarding send-back, which refuses the same way for the same reasons.
const { describeMailFailure } = require("../../../services/mailFailure");
// The one spelling of a candidate's onboarding link, shared with the module that issues it.
const { onboardingUrlFor } = require("../onboarding-invites/controller");

// The same place the public onboarding form puts the proofs a candidate uploads.
const IDENTITY_PROOF_FOLDER = "hrm/onboarding/proof";
const ONBOARDING_PHOTO_FOLDER = "hrm/onboarding/photo";
// The experience and relieving letters attached to a previous job. A document rather than an image,
// so it is filed through document storage and kept apart from the identity proofs.
const EXPERIENCE_DOCUMENT_FOLDER = "hrm/onboarding/experience";
// Each uploaded image with the folder it belongs in. The two proofs are identity documents; the
// profile photograph is not, and is filed apart from them for the same reason it is asked for in a
// section of its own.
const STORED_IMAGE_FIELDS = [
  ["aadharCardImageUrl", IDENTITY_PROOF_FOLDER],
  ["panCardImageUrl", IDENTITY_PROOF_FOLDER],
  ["profilePhotoUrl", ONBOARDING_PHOTO_FOLDER],
];

const nullableText = z.string().trim().max(5000).nullable().optional();
const nullableDate = z.coerce.date().nullable().optional();
/*
 * A date of birth that leaves somebody old enough to be employed.
 *
 * Eighteen is the studio's rule and both forms already draw a calendar that stops there, so this is
 * the half that actually decides it: the browser is never the guard, and an import or a direct call
 * reaches this schema without passing a calendar at all. Whole years, counted the way the frontend's
 * `ageInYears` counts them, so the two cannot disagree about a birthday that is today.
 */
const MINIMUM_EMPLOYEE_AGE = 18;
/*
 * Read in UTC throughout, because a date of birth is a date and not a moment: "1998-04-02" is
 * parsed as UTC midnight, and pulling the year, month and day back out through the *local* getters
 * would move the birthday a day in either direction depending on which side of UTC the server sits.
 */
function isOldEnough(value, minimumAge = MINIMUM_EMPLOYEE_AGE) {
  const born = new Date(value);
  if (Number.isNaN(born.getTime())) return false;
  const eligibleFrom = Date.UTC(born.getUTCFullYear() + minimumAge, born.getUTCMonth(), born.getUTCDate());
  return eligibleFrom <= Date.now();
}
const nullableDateOfBirth = z.coerce.date()
  .refine((value) => value <= new Date(), "Date of Birth cannot be in the future")
  .refine((value) => isOldEnough(value), `An employee must be at least ${MINIMUM_EMPLOYEE_AGE} years old`)
  .nullable().optional();
const nullableDecimal = z.coerce.number().finite().nullable().optional();
const requiredText = z.string().trim().min(1).max(5000);
/*
 * The Employee ID as the studio actually mints it.
 *
 * This asked for `DBS001` — no separator, three digits or more — and nothing has ever produced
 * that: `services/identifiers.js` builds `DBS-1`, hyphenated and unpadded, and says so on purpose
 * ("the one the studio reads out without leading zeros"). So a generator and a validator in the
 * same application disagreed about the one identifier a person is known by, and every Update and
 * Approve & Onboard that handed a stored id back was refused with "Validation failed" naming a
 * field nobody had touched.
 *
 * Both shapes are accepted: `DBS-1` is what is minted now, and `DBS1` is what a handful of older
 * rows carry. An id is server-generated either way — this only has to recognise one coming home.
 */
const employeeIdSchema = z.string().trim().regex(/^DBS-?\d+$/, "Employee ID must read like DBS-1").max(50).nullable().optional();
// One rule for every phone number in the OS, in src/services/phoneNumber.js: exactly ten digits
// behind +91, and E.164's 4-to-14 behind any other code. A flat ten refused an eight-digit
// Singapore number outright and silently accepted a truncated Chinese one.
const nullablePhone = z.string().trim().refine((value) => !value || isValidPhoneNumber(value), "Enter a valid phone number with its country code").nullable().optional();
// The formats the frontend's `constants/fieldValidation` accepts, checked again here because the
// browser is never the guard.
const nullableEmail = z.string().trim().regex(/^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/, "Enter a valid email address").max(191).nullable().optional();
const nullableAadhar = z.string().trim().regex(/^[2-9]\d{11}$/, "Aadhar Card Number must be 12 digits and cannot start with 0 or 1").nullable().optional();
const nullablePan = z.string().trim().regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/, "PAN must be five letters, four digits, then a letter, for example ABCDE1234F").nullable().optional();
const nullableIfsc = z.string().trim().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, "IFSC must be four letters, then 0, then six characters, for example SBIN0001234").nullable().optional();
const nullableBankAccountStatus = z.enum(["Active", "Inactive"]).nullable().optional();
// A pointer at another employee row. Sent as "" by a cleared dropdown, which `cleanData` turns into
// null before this ever sees it.
const nullableEmployeeRef = z.coerce.number().int().positive().nullable().optional();
const nullableAccountNumber = z.string().trim().regex(/^\d{9,18}$/, "Account Number must be between 9 and 18 digits").nullable().optional();
// Either a freshly picked picture, which arrives as a compressed data URI, or the link an earlier
// upload returned and the form is handing straight back.
const nullableProofImage = z.string().trim().max(12_000_000)
  .refine((value) => !value || /^data:image\/[a-z0-9.+-]+;base64,/i.test(value) || /^https?:\/\//i.test(value), "Upload a valid image file")
  .nullable().optional();

/** How a review went. Fixed here as well as in the browser, so the column holds one of these or nothing. */
const REVIEW_OUTCOMES = ["Shine", "Shadow"];

// One salary review. The employee's totals are worked out from the whole list, never sent up.
const reviewSchema = z.object({
  reviewDate: z.coerce.date(),
  /*
   * What was awarded, where anything was.
   *
   * Optional, and null where the box was left empty rather than 0: a review held without a figure
   * and a review that awarded nothing are different facts, and coercing the first into the second
   * loses the difference permanently. An empty string is what an untouched number input sends, so
   * it is read as "not answered" rather than failing to coerce.
   */
  incrementAmount: z.preprocess(
    (value) => (value === "" || value === null || value === undefined ? null : value),
    z.coerce.number().finite().min(0).nullable(),
  ).optional(),
  outcome: z.preprocess(
    (value) => (value === "" || value === undefined ? null : value),
    z.enum(REVIEW_OUTCOMES).nullable(),
  ).optional(),
  nextReviewDate: z.coerce.date().nullable().optional(),
  remarks: z.string().trim().max(5000).nullable().optional(),
});

/*
 * One child of an employee. A name is what makes the row worth keeping, so it is required — the
 * blank rows an "Add Child" click leaves behind are dropped by the form before they get here.
 */
const childSchema = z.object({
  name: z.string().trim().min(1).max(150),
  // `cleanData` only reaches the top level of the body, so an unanswered date inside a row still
  // arrives as "" — which `z.coerce.date()` reads as an Invalid Date rather than as "not given".
  dateOfBirth: z.preprocess((value) => (value === "" ? null : value),
    z.coerce.date().refine((value) => value <= new Date(), "A child's date of birth cannot be in the future").nullable().optional()),
});

/*
 * A number inside a repeating row, which reaches here as the string the input held — "" for one
 * nobody answered. `z.coerce.number()` reads "" as 0, so an unanswered year would be stored as the
 * year nought rather than as no year at all; the preprocess is what keeps the two apart.
 */
const rowNumber = (schema) => z.preprocess((value) => (value === "" || value === null || value === undefined ? null : value), schema.nullable().optional());

/** One qualification. The degree is what makes the row worth keeping; the rest is context for it. */
const qualificationSchema = z.object({
  degree: z.string().trim().min(1).max(150),
  branch: z.string().trim().max(150).nullable().optional(),
  college: z.string().trim().max(200).nullable().optional(),
  // A year, not a date. The upper bound leaves room for somebody still studying to name the year
  // they will finish, which is what a candidate part way through a course actually has to give.
  passedOutYear: rowNumber(z.coerce.number().int().min(1950).max(new Date().getFullYear() + 6)),
});

/*
 * One job held before this one. Only the company is required: an old job whose exact length nobody
 * remembers is still worth recording, and refusing it would be the reason somebody could not save.
 * The attachment is the same shape the separation letter takes — freshly picked and arriving as a
 * data URI under a file name, or the one already stored being echoed back.
 */
const experienceSchema = z.object({
  companyName: z.string().trim().min(1).max(200),
  companyLocation: z.string().trim().max(200).nullable().optional(),
  role: z.string().trim().max(150).nullable().optional(),
  years: rowNumber(z.coerce.number().min(0).max(60)),
  attachment: z.array(z.object({
    name: z.string().trim().min(1).max(255),
    data: z.string().max(8_000_000).optional(),
    url: z.string().trim().max(8_000_000).optional(),
  }).refine((value) => value.data || value.url, "Attach a document or leave it empty")).max(1).nullable().optional(),
});

/*
 * `department` is nullable here, and that is not an oversight - it was `requiredText` for a moment
 * and had to come back.
 *
 * The form asks for it on the **Login Credentials** page, in Employment Details, and the record is
 * *created* by the page before it: Review Employee Details posts the record, then the credentials
 * page fills in what the studio decided and writes the account. So at the moment of creation there
 * is no department to send - the field has not been reached - and a schema that demands one refuses
 * every new employee. Verified rather than reasoned: a create payload carries `department: null`
 * (`cleanData` folds "" to null), which `requiredText` rejects outright.
 *
 * It is still required where it is asked. The field is marked required on the credentials page and
 * `getMissingRequiredFields` refuses to save that page without it, so nobody reaches an account
 * without a department. Making the API agree would mean either moving the field back to the first
 * page or splitting create from update here - both real options, neither one to take quietly.
 */
const employeeSchema = z.object({
  reviews: z.array(reviewSchema).max(100).optional(),
  /*
   * The whole list, replacing whatever is stored, the way `reviews` above works — and `undefined`
   * means the request said nothing about children and the stored rows are left alone. `null` and
   * `[]` both mean there are none, which is how somebody who is no longer married is cleared.
   */
  children: z.array(childSchema).max(20).nullable().optional(),
  /** The other two repeating lists, replaced whole on save exactly as the children are. */
  qualifications: z.array(qualificationSchema).max(20).nullable().optional(),
  experiences: z.array(experienceSchema).max(30).nullable().optional(),
  /*
   * Who referred this hire. Optional, and `null` clears it - the studio pays a bounty for a
   * referral, so it is a fact worth keeping, but most hires are not referred by anybody.
   *
   * The amount is not accepted here. It comes from the studio's settings when the referral is
   * created and is stamped onto the instalments, so nothing a form posts can decide what the
   * studio pays.
   */
  referredByEmployeeId: nullableEmployeeRef,
  employeeId: employeeIdSchema, employeeName: requiredText.max(150), employmentStatus: z.enum(["Active", "in Training", "PIP", "Relieved", "Absconded", "Long Leave", "Fired", "HR Onboarding Pending", "Employee Submission Pending"]).default("HR Onboarding Pending"),
  contactNumber: nullablePhone, emailId: nullableEmail, workEmailId: nullableEmail, dateOfJoining: nullableDate, designation: nullableText, department: nullableText, skills: nullableText, vertical: nullableText, workBaseLocation: nullableText, currentWorkLocation: nullableText, photoShooter: z.boolean().nullable().optional(), workType: nullableText, languagesKnown: nullableText, bloodGroup: nullableText, gender: nullableText,
  emergencyContactName: nullableText, emergencyContactNumber: nullablePhone, emergencyContactRelationship: nullableText, aadharCardNumber: nullableAadhar, panCardNumber: nullablePan, aadharCardImageUrl: nullableProofImage, panCardImageUrl: nullableProofImage, profilePhotoUrl: nullableProofImage, fatherName: nullableText, fatherOccupation: nullableText, motherName: nullableText, motherOccupation: nullableText, spouseName: nullableText, dateOfBirth: nullableDateOfBirth, maritalStatus: nullableText, weddingAnniversary: nullableDate, currentAddress: nullableText, permanentAddress: nullableText,
  reference1PersonName: nullableText, reference1PersonPhone: nullablePhone, reference1PersonAddress: nullableText, reference2PersonName: nullableText, reference2PersonPhone: nullablePhone, reference2PersonAddress: nullableText, nominee1PersonName: nullableText, nominee1PersonPhone: nullablePhone, nominee2PersonName: nullableText, nominee2PersonPhone: nullablePhone, alternative1EmployeeId: nullableEmployeeRef, alternative2EmployeeId: nullableEmployeeRef, leaveApprover1EmployeeId: nullableEmployeeRef, leaveApprover2EmployeeId: nullableEmployeeRef, leaveApprover3EmployeeId: nullableEmployeeRef, permissionApproverEmployeeId: nullableEmployeeRef, reportsToEmployeeId: nullableEmployeeRef,
  bankName: nullableText, bankLocation: nullableText, accountNumber: nullableAccountNumber, ifscCode: nullableIfsc, bankAccountStatus: nullableBankAccountStatus, addedAccounts: nullableText, companyMentionedName: nullableText, dateOfRelieving: nullableDate, relievingRemarks: nullableText, totalSalary: nullableDecimal, joiningSalary: nullableDecimal, lastReviewDate: nullableDate, nextReviewDate: nullableDate, totalIncrement: nullableDecimal,
  remarksDetails: nullableText, appreciationDetails: nullableText,
});
// Employee IDs are generated inside the create transaction. Keep them out of the
// create payload schema so a UI preview can never become the source of truth.
const createEmployeeSchema = employeeSchema.omit({ employeeId: true });

// One definition of "working here", shared with the read service the assistant uses.
const { WORKING_STATUSES } = require("./read.service");

const querySchema = z.object({
  q: z.string().trim().max(120).optional(),
  /*
   * `active=true` narrows the list to the people actually working here, which is what every picker
   * wants: assign an asset, name a manager, choose whom a task is for. The repository's own screen
   * asks for everybody, because it has a tab per status and a row that never arrives lands in none
   * of them.
   */
  active: z.enum(["true", "false"]).optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});
const idSchema = z.coerce.number().int().positive();
const credentialSchema = z.object({
  email: z.string().trim().email().max(191),
  username: z.string().trim().min(3).max(50).regex(/^[a-zA-Z0-9._-]+$/, "Username may contain letters, numbers, dots, underscores, and hyphens only"),
  /*
   * The password the account starts on, which every account now starts on the same one of.
   *
   * The mixed-case-and-symbol rule that used to be here was relaxed because the studio's chosen
   * starting password does not meet it. Worth knowing what that leans on: the create paths below
   * set `mustChangePassword: true`, but nothing reads that flag yet — no screen forces the change —
   * so this value stays a working password until its owner changes it by choice.
   *
   * A length is still required, because whatever arrives here is bcrypt-hashed and becomes a real
   * password until it is changed.
   */
  temporaryPassword: z.string().min(8).max(128),
  // The branch the account belongs to, as a `location` id. IAM scopes what a person reaches by it,
  // so it is stored on the user rather than re-read from the employee's free-text work location.
  branchId: z.coerce.number().int().positive().nullable().optional(),
  // The roles the account is created with. None is allowed and means an account that can sign in
  // and do nothing until Administration gives it one.
  roleIds: z.array(z.string().trim().min(1).max(60)).max(30).optional().default([]),
  /*
   * Whether this account must have WhatsApp linked before it may use the application.
   *
   * Off unless somebody ticks it, and defaulted `false` here too - so an older client that does not
   * send the field leaves an account unheld rather than quietly gating somebody who never agreed to
   * it. An administrator is never held whatever this says.
   */
  whatsappRequired: z.coerce.boolean().optional().default(false),
  // The two colleagues who cover this person's work. Recorded against the employee rather than the
  // account, because cover is a fact about the person and outlives any login they are given.
  alternative1EmployeeId: nullableEmployeeRef,
  alternative2EmployeeId: nullableEmployeeRef,
  // Up to three colleagues who approve this person's leaves, in order. Recorded against the
  // employee for the same reason the alternatives are.
  leaveApprover1EmployeeId: nullableEmployeeRef,
  leaveApprover2EmployeeId: nullableEmployeeRef,
  leaveApprover3EmployeeId: nullableEmployeeRef,
  // The one colleague who approves this person's permissions. One rather than three: a permission
  // is an hour out of a day and is settled the same morning it is asked for.
  permissionApproverEmployeeId: nullableEmployeeRef,
});

/**
 * Answers the reason the pair cannot be saved, or null. Somebody cannot cover for themselves, and
 * naming one person in both slots is two slots holding one answer.
 */
function alternativesProblem(employeeId, first, second) {
  if (first && first === employeeId) return "An employee cannot be their own alternative.";
  if (second && second === employeeId) return "An employee cannot be their own alternative.";
  if (first && second && first === second) return "The two alternatives must be different people.";
  return null;
}

/**
 * The same two rules for the leave approvers: nobody approves their own leave, and one person
 * filling two slots is two slots holding one answer.
 */
function leaveApproversProblem(employeeId, approverIds) {
  const named = approverIds.filter(Boolean);
  if (named.includes(employeeId)) return "An employee cannot approve their own leave.";
  if (new Set(named).size !== named.length) return "Each leave approver must be a different person.";
  return null;
}

/**
 * The one rule the permission approver has: nobody approves their own time out.
 *
 * The other half of `leaveApproversProblem` - two slots holding one answer - cannot arise on a
 * single slot. Naming the same person here and among the leave approvers is allowed and expected:
 * for most of the studio one manager settles both, and refusing that would make the studio pick a
 * second person for no reason.
 */
function permissionApproverProblem(employeeId, approverId) {
  if (approverId && approverId === employeeId) return "An employee cannot approve their own permission requests.";
  return null;
}

/**
 * Answers the reason `managerId` cannot be this employee's reporting person, or null.
 *
 * The chart is only a tree while nobody reports, however indirectly, to somebody below them. Two
 * people pointing at each other, or a longer ring, would leave the walk upward with no root to
 * arrive at — so the loop is refused where it would be written rather than worked around when it is
 * read. Walking up from the proposed manager and looking for this employee is the whole check: if
 * they are already above them, putting them below closes a ring.
 *
 * `seen` guards the walk itself, because the data being edited may already contain a loop written
 * before this check existed.
 */
async function reportingProblem(employeeId, managerId, client = prisma) {
  if (!managerId) return null;
  if (managerId === employeeId) return "An employee cannot report to themselves.";

  const manager = await client.employee.findFirst({ where: { id: managerId, archivedAt: null }, select: { id: true, reportsToEmployeeId: true } });
  if (!manager) return "That reporting person is no longer an employee.";

  const seen = new Set([managerId]);
  let cursor = manager.reportsToEmployeeId;
  while (cursor) {
    if (cursor === employeeId) return "That would make the reporting line a loop: this employee is already above that person.";
    if (seen.has(cursor)) break;
    seen.add(cursor);
    const next = await client.employee.findFirst({ where: { id: cursor, archivedAt: null }, select: { reportsToEmployeeId: true } });
    if (!next) break;
    cursor = next.reportsToEmployeeId;
  }
  return null;
}

function cleanData(data) {
  return Object.fromEntries(Object.entries(data).map(([key, value]) => [key, value === "" ? null : ["panCardNumber", "ifscCode"].includes(key) && typeof value === "string" ? value.toUpperCase() : value]));
}

/**
 * Replaces any newly picked identity proof with the link it was uploaded to, leaving links that
 * were already stored untouched. Returns the data to save alongside the uploads made for it, so a
 * request that fails afterwards can delete what it put there.
 */
async function storeIdentityProofs(data) {
  const uploads = [];
  const stored = { ...data };
  try {
    for (const [field, folder] of STORED_IMAGE_FIELDS) {
      if (!stored[field]) continue;
      const result = await storeImage(stored[field], { folder });
      stored[field] = result?.url || null;
      if (result && !result.reused) uploads.push(result);
    }
  } catch (error) {
    await discardUploads(uploads);
    throw error;
  }
  return { data: stored, uploads };
}

/**
 * What the reviews add up to on the employee row. The total increment is the sum of them, the total
 * salary is the joining salary plus that sum, and the two review dates come from the most recent
 * review — so none of the four can disagree with the reviews behind them.
 *
 * `scheduledNextReviewDate` is the one the form itself carries, and it only matters for an employee
 * with no reviews yet. A review is due six months after joining, so onboarding asks for that date
 * and HR can move it — but this function is spread *over* the submitted data by both callers, so
 * returning a flat null here quietly threw that answer away and every newly onboarded employee was
 * stored with no review scheduled at all. Once there is a review, the latest one's own next date is
 * the schedule and wins: the employee's Next Review Date is never a second, separate answer that
 * could disagree with the reviews under it.
 */
function reviewTotals(reviews, joiningSalary, scheduledNextReviewDate = null) {
  if (!reviews.length) {
    return { totalIncrement: null, totalSalary: joiningSalary ?? null, lastReviewDate: null, nextReviewDate: scheduledNextReviewDate ?? null };
  }
  const totalIncrement = reviews.reduce((sum, review) => sum + Number(review.incrementAmount || 0), 0);
  const latest = reviews.reduce((newest, review) => new Date(review.reviewDate) > new Date(newest.reviewDate) ? review : newest);
  return {
    totalIncrement,
    totalSalary: joiningSalary === null || joiningSalary === undefined ? totalIncrement : Number(joiningSalary) + totalIncrement,
    lastReviewDate: latest.reviewDate,
    nextReviewDate: latest.nextReviewDate ?? null,
  };
}

/** One child as the table stores it. Nothing is derived from these, so there is no total to keep. */
const childRow = (child, employeeId) => ({
  employeeId,
  name: child.name,
  dateOfBirth: child.dateOfBirth ?? null,
});

const qualificationRow = (qualification, employeeId) => ({
  employeeId,
  degree: qualification.degree,
  branch: qualification.branch ?? null,
  college: qualification.college ?? null,
  passedOutYear: qualification.passedOutYear ?? null,
});

/**
 * One job as the table stores it. The attachment has already been uploaded by
 * {@link storeExperienceAttachments} by the time this runs, so what arrives here is the stored
 * name and link rather than a file still to be dealt with.
 */
const experienceRow = (experience, employeeId) => ({
  employeeId,
  companyName: experience.companyName,
  companyLocation: experience.companyLocation ?? null,
  role: experience.role ?? null,
  years: experience.years ?? null,
  attachmentName: experience.attachmentName ?? null,
  attachmentUrl: experience.attachmentUrl ?? null,
});

/**
 * Uploads the letter attached to each job and rewrites the row to carry the stored name and link.
 *
 * Run before the transaction opens, the way the identity proofs are, so a slow upload never holds
 * one open — and the uploads are returned alongside so a request that fails afterwards can delete
 * what it put there. A letter that already carries a `url` is one the form is echoing back, and
 * `storeDocument` hands it straight through rather than uploading it a second time.
 */
async function storeExperienceAttachments(experiences) {
  const uploads = [];
  const stored = [];
  for (const experience of experiences) {
    const { attachment, ...rest } = experience;
    const file = Array.isArray(attachment) ? attachment[0] : null;
    if (!file) {
      stored.push({ ...rest, attachmentName: null, attachmentUrl: null });
      continue;
    }
    const result = await storeDocument(file, { folder: EXPERIENCE_DOCUMENT_FOLDER });
    if (result && !result.reused) uploads.push(result);
    stored.push({ ...rest, attachmentName: result?.name || null, attachmentUrl: result ? (result.url || result.data || null) : null });
  }
  return { experiences: stored, uploads };
}

const reviewRow = (review, employeeId, actorId) => ({
  employeeId,
  reviewDate: review.reviewDate,
  incrementAmount: review.incrementAmount ?? null,
  outcome: review.outcome ?? null,
  nextReviewDate: review.nextReviewDate ?? null,
  remarks: review.remarks ?? null,
  createdBy: actorId,
  updatedBy: actorId,
});

/*
 * DBS-1, DBS-2, DBS-3 - the staff list, unpadded.
 *
 * A person belongs to the studio rather than to a branch or a vertical, so this is the one
 * identifier that carries neither and the one the studio reads out without leading zeros. The
 * shape and the counter both live in `services/identifiers.js`; the onboarding-invite route mints
 * the same identifier from the same place, which is what stops an invited employee and a
 * hand-added one drawing the same number.
 */
/**
 * The reference columns that belong beside an employee's free-text ones.
 *
 * `vertical`, `workBaseLocation` and `currentWorkLocation` are text a person typed; `verticalId` and
 * `branchId` are what every branch and vertical filter in the application actually reads. Sales
 * projects, CRD documents and WhatsApp group names all resolve theirs on write — this module never
 * did, so every employee created or edited since the columns were added was left at NULL.
 *
 * That is not a cosmetic drift. `Employee.branchId` is one of only three columns branch scoping can
 * filter on, and the attendance geofence finds a person's office through it: with it NULL every
 * capture reads "no branch on their record", so nobody can ever be inside their own office however
 * many office locations the studio records.
 *
 * The branch is the work base, falling back to where they are currently working — the same rule the
 * backfill applied and the one `data-scope-backfill.test.js` holds this table to.
 *
 * Only resolves what the save actually carries: a patch that does not mention the vertical must not
 * blank the reference beside it, so a key absent from `data` stays absent from the answer.
 */
async function referenceColumnsFor(data) {
  const refs = await referenceLookups();
  const columns = {};
  if (data.vertical !== undefined) columns.verticalId = refs.verticalId(data.vertical);
  if (data.workBaseLocation !== undefined || data.currentWorkLocation !== undefined) {
    columns.branchId = refs.branchId(data.workBaseLocation) ?? refs.branchId(data.currentWorkLocation);
  }
  return columns;
}

const nextEmployeeId = (transaction) => nextIdentifier("EMPLOYEE", {}, transaction);

/**
 * What the next Employee ID will read as, without taking it.
 *
 * Deliberately not a reservation: two people opening the form at once are shown the same number and
 * whichever saves first gets it. Reserving would burn a number every time somebody opened the form
 * and changed their mind, and the studio reads these numbers as a headcount.
 */
async function previewNextEmployeeId(req, res) {
  try {
    return res.json({ employeeId: await peekIdentifier("EMPLOYEE") });
  } catch (error) {
    return handleError(res, error, "Unable to preview the next Employee ID");
  }
}

/*
 * ── Whose employees ──────────────────────────────────────────────────────────────────────────
 *
 * The repository was the studio's last unscoped screen of people: anybody holding
 * `HRM / Employee Management` READ saw every employee in it, which DATA-SCOPE.md recorded as a
 * decision waiting to be taken rather than a leak. This is that decision, and it is the same rule
 * every other scoped screen reads - no second answer invented here:
 *
 *   * **A branch administrator** (`ADMIN / Branch Administration`) gets the people in the branches
 *     their roles reach, plus themselves and everybody reporting to them.
 *   * **Everybody else** holding the repository permission gets themselves and their own reports,
 *     at any depth.
 *   * **A Super Admin**, and anybody reaching every branch, is narrowed by nothing.
 *
 * `employee: "id"` is what makes it read that way: on an employee row the person named *is* the
 * row, so `resolve`'s "your name is on it, or the name on it reports to you" resolves to the
 * employee's own id measured against the reader and their subtree.
 *
 * The branch limb names **three** columns, and that is the point of it. `branchId` is derived on
 * write from Work Base Location and only falls back to Current Work Location
 * (`referenceColumnsFor`), so somebody based in one branch and posted to another carries the base
 * branch alone - the reference on its own would hide them from the branch they actually work in.
 * Both texts are matched against the reachable branches' names beside the reference, so either one
 * is enough, which is what the studio asked for.
 */
/*
 * `branchOnReach`: the branches on somebody's roles open this register on their own.
 *
 * Everywhere else in the app reaching a branch is not a claim on the records in it - a colleague's
 * leads are not yours because you both file against Erode - and widening past your own name asks
 * for `ADMIN / Branch Administration`. A register of *who works here* is not that kind of record:
 * it is the studio's own shape, which is why the employee **directory** needs no permission at all.
 * So the branches ticked on a role decide which people this screen shows, and ticking them all
 * shows everybody.
 */
const EMPLOYEE_SCOPE_COLUMNS = { employee: "id", branch: "branchId", branchText: ["workBaseLocation", "currentWorkLocation"], branchOnReach: true };
/*
 * `level` is what the caller is about to do. It matters here more than almost anywhere, because
 * `EMPLOYEE_SCOPE_COLUMNS` declares `branchOnReach`: reaching a branch **is** the claim on its rows,
 * with no `ADMIN / Branch Administration` gate in front of it. Asked at `READ`, a role that only
 * ever let somebody read three branches' staff would let them edit and archive those staff too,
 * because a *different* role of theirs satisfies the router's write guard.
 */
const employeeScope = (req, level = "READ") => dataScope.resolve({ userId: Number(req.user?.id), module: "HRM", feature: "Employee Management", columns: EMPLOYEE_SCOPE_COLUMNS, level });

/**
 * Who the Employee Repository shows: the scope, plus everybody still being onboarded.
 *
 * A hire at **HR Onboarding Pending** or **Employee Submission Pending** has no branch yet, and
 * usually no work location and no reporting line either - the form that answers those questions is
 * the one still being filled in. Under the branch rule alone such a row is nobody's: it is reachable
 * by no branch and named on nobody, so it is invisible to every holder of this permission except a
 * Super Admin, and the onboarding it is waiting for cannot be done by the people whose job it is.
 *
 * So the two onboarding statuses are visible to anyone holding `HRM / Employee Management`. They
 * are a queue of work rather than somebody's record, and they stop being an exception the moment
 * the form is completed and the person has a branch like everybody else.
 *
 * One definition, returned as both the list's `where` and the single read's `allows`, so an id
 * typed into a URL reaches exactly what the list would have shown.
 */
async function employeeVisibility(req, level = "READ") {
  const scope = await employeeScope(req, level);
  /*
   * A scope that narrows nothing is returned untouched.
   *
   * A Super Admin's `where` is `{}` - no condition at all - and `{}` inside an `OR` is **not**
   * "everything": Prisma contributes nothing for it, so `OR: [{}, onboarding]` collapsed to the
   * onboarding clause alone and narrowed a Super Admin from every employee to the three being
   * onboarded. There is nothing to widen when nothing is narrowed, so this returns before building
   * the union at all.
   */
  if (scope.unlimited) return { scope, where: scope.where, allows: () => true };
  return {
    scope,
    where: { OR: [scope.where, { employmentStatus: { in: ONBOARDING_STATUSES } }] },
    allows: (row) => scope.allows(row) || ONBOARDING_STATUSES.includes(row?.employmentStatus),
  };
}

/**
 * The employee this request may act on, or null - out of scope reads as not found.
 *
 * 404 rather than 403, for the reason the referral register answers that way: a person somebody may
 * not read is not one they should learn the existence of by being refused them. The four scope
 * columns are selected alongside whatever the caller asked for, so `allows` reads the same values
 * the list's `where` filtered on.
 */
async function scopedEmployee(req, id, select, { level = "READ" } = {}) {
  const [visible, employee] = await Promise.all([
    // A caller about to change or archive this employee asks at write level; one only reading
    // asks at read level and gets the wider, correct answer. See `employeeScope`.
    employeeVisibility(req, level),
    prisma.employee.findFirst({
      where: { id, archivedAt: null },
      // `employmentStatus` alongside the scope's own columns: somebody still being onboarded is
      // read by anyone holding the permission, and `allows` cannot see that without it.
      select: { ...select, id: true, branchId: true, workBaseLocation: true, currentWorkLocation: true, employmentStatus: true },
    }),
  ]);
  return employee && visible.allows(employee) ? employee : null;
}

function parseId(req, res) {
  const parsed = idSchema.safeParse(req.params.id);
  if (parsed.success) return parsed.data;
  res.status(400).json({ message: "Validation failed", errors: parsed.error.flatten() });
  return null;
}

function handleError(res, error, fallback) {
  if (error.code === "P2002") return res.status(409).json({ message: "Employee ID already exists" });
  if (error.code === "P2025") return res.status(404).json({ message: "Employee not found" });
  // Something still points at this record and the database is right to refuse. A refusal is the
  // answer, not a server fault, so it reads as one rather than as a 500 carrying a Prisma trace.
  if (error.code === "P2003") return res.status(409).json({ message: "This employee is still referenced by other records and cannot be deleted." });
  return res.status(500).json({ message: fallback, error: error.message });
}

/**
 * An employee row as the rest of the app may see it: without the login credentials draft.
 *
 * That column holds a half-made account, the password it would start on included, and it is read
 * back through one endpoint of its own that asks for `ADMIN / User Management` write. Riding along
 * on the ordinary employee row would hand it to every reader of the repository instead - this
 * router lets any signed-in session read, which is right for departments and branches and quite
 * wrong for a credential - so it comes off here, at the one place rows are answered from.
 */
function withoutCredentialsDraft(employee) {
  if (!employee || typeof employee !== "object") return employee;
  const { loginCredentialsDraft, ...rest } = employee;
  return rest;
}

/**
 * The people a picker may name, and nothing about them but the name.
 *
 * Asset Management hands an asset to somebody and Client Storage names who holds a shoot, and the
 * roles that do those jobs do not hold HRM - so their pickers cannot read `/employees`, which
 * carries a person's children, qualifications, reviews and login beside the name. This is the
 * name alone: id, Employee ID and the name to show, for the people actually working here, in the
 * order a picker lists them. It answers to a session, the way the department and branch lists do,
 * because who works here is the studio's shape and its members are entitled to read it - the same
 * reasoning as the self-service org chart.
 */
async function employeeDirectory(req, res) {
  try {
    const data = await prisma.employee.findMany({
      where: { archivedAt: null, employmentStatus: { in: await workingEmployeeStatuses() } },
      select: { id: true, employeeId: true, employeeName: true },
      orderBy: { employeeName: "asc" },
    });
    return res.json({ data });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
}

/**
 * Whether a login is a Super Admin, by either of the two spellings the app has.
 *
 * `user.role` is the legacy column `iamService.hasPermission` short-circuits on. The system role
 * named SUPER_ADMIN is the other, and it is the one an administrator added through Login
 * Credentials actually carries - their `role` column still says `EMPLOYEE`. A deactivated role
 * grants nothing, here as everywhere else.
 */
function isSuperAdmin(login) {
  if (!login) return false;
  return login.role === "SUPER_ADMIN"
    || (login.roles || []).some((entry) => entry.role?.isActive && entry.role?.name === "SUPER_ADMIN");
}

async function listEmployees(req, res) {
  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ message: "Validation failed", errors: parsed.error.flatten() });
  const { q, active, page, pageSize } = parsed.data;
  const search = q ? { OR: [{ employeeId: { contains: q } }, { employeeName: { contains: q } }, { emailId: { contains: q } }, { contactNumber: { contains: q } }] } : {};
  // A removed employee is off every list, this one included — and that means every tab of it, since
  // the tabs are cut from `employmentStatus` and a row that never arrives lands in none of them.
  // Removing somebody is not the same as offboarding them: the InActive tab is where a person the
  // studio parted with belongs, and somebody deleted is not a person to be read about there.
  // Under `AND` rather than spread: the scope's `where` is itself an `OR`, and spreading it beside
  // the search's own `OR` would replace the rule rather than narrow with it.
  const visible = await employeeVisibility(req);
  const where = { ...search, archivedAt: null, AND: [visible.where], ...(active === "true" ? { employmentStatus: { in: await workingEmployeeStatuses() } } : {}) };
  try {
    const [data, total] = await prisma.$transaction([
      // The reviews come with the row so the form can show them without a second request.
      prisma.employee.findMany({ where, skip: (page - 1) * pageSize, take: pageSize, orderBy: { createdAt: "desc" }, include: {
        reviews: { orderBy: { reviewDate: "asc" } },
        // All three ordered by id rather than by a date or a year, so each list reopens in the order
        // it was typed — a row whose date was never recorded would otherwise sort to one end of it.
        children: { orderBy: { id: "asc" } },
        qualifications: { orderBy: { id: "asc" } },
        experiences: { orderBy: { id: "asc" } },
        // Who referred this hire, so the form reopens on the name it was saved with. The referral's
        // money is deliberately not here: it answers to Accounts, and this list answers to HR.
        referral: { select: { referrerEmployeeId: true, referrerName: true } },
      } }),
      prisma.employee.count({ where }),
    ]);
    /*
     * The login this employee signs in with, if they have one.
     *
     * Whether it exists decides if the row may still be offered one; the username and the address
     * are on the row because the repository shows them as columns. Both are identifiers rather than
     * credentials - the address is generated from the person's name and is not a mailbox anybody
     * reads, and the password is not here and never has been. `linkedEmployeeId` is a plain unique
     * column rather than a Prisma relation, which is why this is a second query and not an include.
     */
    const credentialed = data.length
      ? await prisma.user.findMany({
        where: { linkedEmployeeId: { in: data.map((employee) => employee.id) } },
        /*
         * `role` and the role names come along so the row can say whether this person is a Super
         * Admin, which is what lets the form stop insisting on a Reports To for them.
         *
         * Both spellings are read, because there are two and either one is the real thing: the
         * legacy `user.role` column, which `iamService` short-circuits on before it looks at a
         * single grant, and the **system role named SUPER_ADMIN**, which is how an administrator
         * added through Login Credentials carries it (their login still says `EMPLOYEE`). Reading
         * only the column would have missed every Super Admin made the ordinary way.
         */
        select: { linkedEmployeeId: true, username: true, email: true, role: true, roles: { select: { role: { select: { name: true, isActive: true } } } } },
      })
      : [];
    const loginFor = new Map(credentialed.map((user) => [user.linkedEmployeeId, user]));
    /*
     * Whether this row got here through an onboarding invite the candidate has actually submitted.
     *
     * Send Back reopens that submission under its original link, so it is only an action on a row
     * that has one. A manually added employee starts on HR Onboarding Pending too - that is the
     * default the Add Employee form uses - and offering Send Back on the strength of the status
     * alone put a button on those rows that could only ever answer "nothing to send back".
     *
     * Read here rather than inferred in the browser from the invite list, and matched on exactly
     * what `sendBackOnboarding` requires, so the menu cannot offer what the endpoint will refuse.
     * `employeeId` on an invite is the employee's numeric id held as text, which is why it is
     * compared as a string.
     */
    /*
     * The candidate's own onboarding link, on the employee row.
     *
     * Two screens read it and they want the same string. Send Back asks its question *with* the
     * message to hand the candidate already written out - their link and its expiry in it, copyable
     * before anything is sent - and **Copy Link** on a row that has been sent back hands over the
     * same link again, for a candidate who lost the mail or never got one. It is the same invite in
     * both cases: sending back does not issue a new link, it reopens the one they already hold, so
     * the URL is unchanged and only the invite's *status* moves from Submitted to Verified.
     *
     * Cancelled invites are left out, being the one state that is not the candidate's link any
     * more. Everything else is read, so a row keeps its link after the send-back rather than losing
     * it the moment the submission is reopened - which is what left **Employee Submission Pending**
     * showing Copy Link on the invites that had never been submitted and on nothing else.
     */
    const invites = data.length
      ? await prisma.employeeOnboardingInvite.findMany({
        where: { employeeId: { in: data.map((employee) => String(employee.id)) }, status: { not: "Cancelled" } },
        select: { employeeId: true, status: true, shortCode: true, token: true, expiresAt: true, createdAt: true },
        /*
         * Newest last, and the same "newest" `sendBackOnboarding` means.
         *
         * A candidate can hold more than one invite - re-invited, submitted again - and the two
         * sides were choosing between them differently: this read them in whatever order the
         * database returned and the Map kept whichever landed last, while the send-back reopens
         * `orderBy: createdAt desc`. When they disagreed, the dialog showed the link of one invite
         * and the send-back reopened the *other* - so the candidate opened a link still marked
         * Submitted and was told their form had already been sent. Ordered here, the last write to
         * the Map is the newest invite, which is the one that will be reopened.
         */
        orderBy: { createdAt: "asc" },
      })
      : [];
    const latestInvite = new Map(invites.map((invite) => [invite.employeeId, invite]));
    /*
     * Whether there is a submission for HR to send back, which is a different question from whether
     * the candidate has a link - and stays keyed on Submitted alone, because that is exactly what
     * `sendBackOnboarding` requires. An employee added by hand through Add Employee also starts on
     * HR Onboarding Pending with no submission behind them.
     */
    const awaitingReview = new Set(invites.filter((invite) => invite.status === "Submitted").map((invite) => invite.employeeId));
    /*
     * Whether that link would actually open if it were handed over now.
     *
     * A Submitted invite answers "this onboarding invite has already been submitted" and an expired
     * one says so too, so offering either to be copied is offering a link that refuses. Only a live
     * Created or Verified invite is worth passing to a candidate - and Verified is precisely what a
     * send-back leaves behind.
     */
    const linkOpens = (invite) => Boolean(invite)
      && ["Created", "Verified"].includes(invite.status)
      && invite.expiresAt > new Date();
    return res.json({
      data: data.map(({ referral, ...employee }) => ({
        ...withoutCredentialsDraft(employee),
        hasLoginCredentials: loginFor.has(employee.id),
        // Whether this person is a Super Admin. The top of the org chart reports to nobody, so the
        // form asks them for no Reports To - see `isFieldRequired` in EmployeeFormPanel.
        isSuperAdmin: isSuperAdmin(loginFor.get(employee.id)),
        // Blank rather than null where there is no account, so the column reads as an empty cell
        // rather than the dash the table draws for a value it was given and could not render.
        loginUsername: loginFor.get(employee.id)?.username || "",
        loginEmail: loginFor.get(employee.id)?.email || "",
        hasOnboardingSubmission: awaitingReview.has(String(employee.id)),
        // Null on an invite that predates short codes and holds no token either - the same invite
        // `sendBackOnboarding` refuses, so the screen has nothing to offer for it and says so.
        onboardingUrl: onboardingUrlFor(latestInvite.get(String(employee.id))),
        onboardingExpiresAt: latestInvite.get(String(employee.id))?.expiresAt || null,
        // Whether that link is worth offering to copy, as opposed to merely existing.
        onboardingLinkOpen: linkOpens(latestInvite.get(String(employee.id))),
        // Flattened onto the row under the name the form posts back, so reading and writing the
        // field are the same key rather than two shapes to keep in step.
        referredByEmployeeId: referral?.referrerEmployeeId || null,
        referredByName: referral?.referrerName || null,
      })),
      meta: { total, page, pageSize, totalPages: Math.ceil(total / pageSize) },
    });
  } catch (error) { return handleError(res, error, "Unable to load employees"); }
}

async function createEmployee(req, res) {
  const parsed = createEmployeeSchema.safeParse(cleanData(req.body));
  if (!parsed.success) return res.status(400).json({ message: "Validation failed", errors: parsed.error.flatten() });
  let uploads = [];
  try {
    // A row that does not exist yet cannot be above anybody, so there is no loop to look for here —
    // only the question of whether the reporting person named is somebody the studio still employs.
    if (parsed.data.reportsToEmployeeId) {
      const reportingFault = await reportingProblem(null, parsed.data.reportsToEmployeeId);
      if (reportingFault) return res.status(400).json({ message: reportingFault });
    }
    // The pictures are uploaded before the transaction opens, so a slow upload never holds one open.
    const proofs = await storeIdentityProofs(parsed.data);
    uploads = proofs.uploads;
    const { reviews = [], children, qualifications, experiences, referredByEmployeeId = null, ...employeeData } = proofs.data;
    const childrenRows = children || [];
    const qualificationRows = qualifications || [];
    // The letters are uploaded out here for the reason the pictures are: a slow upload must never
    // hold the transaction open, and what it put there has to be deletable if the save then fails.
    const attachments = await storeExperienceAttachments(experiences || []);
    uploads = [...uploads, ...attachments.uploads];
    const actorId = Number(req.user.id);
    const data = await prisma.$transaction(async (transaction) => {
      const employee = await transaction.employee.create({
        data: {
          ...employeeData,
          ...await referenceColumnsFor(employeeData),
          ...reviewTotals(reviews, employeeData.joiningSalary, employeeData.nextReviewDate),
          employeeId: await nextEmployeeId(transaction),
        },
      });
      if (reviews.length) await transaction.employeeReview.createMany({ data: reviews.map((review) => reviewRow(review, employee.id, actorId)) });
      if (childrenRows.length) await transaction.employeeChild.createMany({ data: childrenRows.map((child) => childRow(child, employee.id)) });
      if (qualificationRows.length) await transaction.employeeQualification.createMany({ data: qualificationRows.map((row) => qualificationRow(row, employee.id)) });
      if (attachments.experiences.length) await transaction.employeeExperience.createMany({ data: attachments.experiences.map((row) => experienceRow(row, employee.id)) });
      // Inside the transaction, so a referral is never left behind by a save that then failed. The
      // instalment dates are counted from the joining date, which is why it is handed over here.
      await syncEmployeeReferral(transaction, employee.id, {
        referrerEmployeeId: referredByEmployeeId,
        referredOn: employee.dateOfJoining,
        userId: actorId,
      });
      return employee;
    });
    return res.status(201).json({ data: withoutCredentialsDraft(data) });
  } catch (error) {
    await discardUploads(uploads);
    return handleError(res, error, "Unable to create employee");
  }
}

/*
 * ── Importing employees from a spreadsheet ────────────────────────────────────────────────────
 *
 * The columns a studio actually has when it moves its staff list in: who the person is, how to
 * reach them, and where they work. Everything else on an employee - the increments, the identity
 * proofs, the nominees - is filled in afterwards on the form, and asking a spreadsheet for it would
 * make the template unusable.
 *
 * Employee ID is deliberately not a column. It is minted inside the create transaction from the
 * studio's own counter (`DBS-1`, `DBS-2`, ...), so a file cannot bring its own and cannot collide
 * with one already issued.
 */
const EMPLOYEE_IMPORT_COLUMNS = [
  { field: "employeeName", label: "Employee Name", required: true },
  { field: "employmentStatus", label: "Employment Status" },
  { field: "contactNumber", label: "Contact Number" },
  { field: "emailId", label: "Email ID" },
  { field: "dateOfJoining", label: "Date of Joining" },
  { field: "designation", label: "Designation" },
  { field: "department", label: "Department" },
  { field: "vertical", label: "Vertical" },
  { field: "workBaseLocation", label: "Work Base Location" },
  { field: "currentWorkLocation", label: "Current Work Location" },
  { field: "workType", label: "Work Type" },
  { field: "skills", label: "Skills" },
  { field: "languagesKnown", label: "Languages Known" },
  { field: "bloodGroup", label: "Blood Group" },
  { field: "gender", label: "Gender" },
  { field: "dateOfBirth", label: "Date of Birth" },
  { field: "currentAddress", label: "Current Address" },
  { field: "permanentAddress", label: "Permanent Address" },
  { field: "emergencyContactName", label: "Emergency Contact Name" },
  { field: "emergencyContactNumber", label: "Emergency Contact Number" },
];

async function employeeImportTemplate(req, res) {
  return res.json({ data: { columns: templateHeaders(EMPLOYEE_IMPORT_COLUMNS) } });
}

async function importEmployees(req, res) {
  try {
    const data = await importTableRows({
      headers: req.body?.headers,
      rows: req.body?.rows,
      startRow: Number(req.body?.startRow) || 2,
      columns: EMPLOYEE_IMPORT_COLUMNS,
      schema: createEmployeeSchema,
      /*
       * The same transaction a typed employee is written in, minus the parts a spreadsheet cannot
       * carry: no identity-proof uploads, no review rows. The Employee ID still comes from
       * `nextEmployeeId` inside the transaction, so an import and a form save draw from one counter.
       */
      create: async (input) => {
        const { reviews, children, qualifications, experiences, ...employeeData } = input;
        await prisma.$transaction(async (transaction) => {
          await transaction.employee.create({
            data: { ...employeeData, ...await referenceColumnsFor(employeeData), employeeId: await nextEmployeeId(transaction) },
          });
        });
      },
    });
    return res.json({ data });
  } catch (error) {
    if (error?.status === 400) return res.status(400).json({ message: error.message });
    return handleError(res, error, "Unable to import employees");
  }
}

async function updateEmployee(req, res) {
  const id = parseId(req, res); if (!id) return;
  const parsed = employeeSchema.partial().safeParse(cleanData(req.body));
  if (!parsed.success) return res.status(400).json({ message: "Validation failed", errors: parsed.error.flatten() });
  if (Object.keys(parsed.data).length === 0) return res.status(400).json({ message: "Provide at least one field to update" });
  let uploads = [];
  try {
    // `nextReviewDate` is read as well as the salary: an edit that sends no reviews has to keep the
    // schedule the employee already has rather than fall back to null. See `reviewTotals`.
    // Held to the same rows the list shows. Hiding a person from the repository is not protection
    // while their id can still be sent to the endpoint that edits them.
    const existing = await scopedEmployee(req, id, { employeeId: true, joiningSalary: true, nextReviewDate: true }, { level: "READ_WRITE" });
    if (!existing) return res.status(404).json({ message: "Employee not found" });
    if (parsed.data.employeeId && parsed.data.employeeId !== existing.employeeId) return res.status(400).json({ message: "Employee ID cannot be changed after creation." });
    const alternativesFault = alternativesProblem(id, parsed.data.alternative1EmployeeId ?? null, parsed.data.alternative2EmployeeId ?? null);
    if (alternativesFault) return res.status(400).json({ message: alternativesFault });
    const approversFault = leaveApproversProblem(id, [parsed.data.leaveApprover1EmployeeId ?? null, parsed.data.leaveApprover2EmployeeId ?? null, parsed.data.leaveApprover3EmployeeId ?? null]);
    if (approversFault) return res.status(400).json({ message: approversFault });
    const permissionApproverFault = permissionApproverProblem(id, parsed.data.permissionApproverEmployeeId ?? null);
    if (permissionApproverFault) return res.status(400).json({ message: permissionApproverFault });
    // Only when the request actually says something about it: `undefined` means "leave it alone",
    // and re-checking an unchanged value would refuse an edit that never touched the reporting line.
    if (parsed.data.reportsToEmployeeId !== undefined) {
      const reportingFault = await reportingProblem(id, parsed.data.reportsToEmployeeId);
      if (reportingFault) return res.status(400).json({ message: reportingFault });
    }
    const proofs = await storeIdentityProofs(parsed.data);
    uploads = proofs.uploads;
    const { employeeId, reviews, children, qualifications, experiences, referredByEmployeeId, ...updates } = proofs.data;
    // `undefined` means the request said nothing about the jobs, so nothing is uploaded for them.
    const attachments = experiences === undefined ? null : await storeExperienceAttachments(experiences || []);
    if (attachments) uploads = [...uploads, ...attachments.uploads];
    const actorId = Number(req.user.id);

    /*
     * A request that says nothing about reviews - or about the referrer - leaves them alone.
     * `undefined` is "not mentioned"; `null` is "cleared", which for a referral means removing it,
     * and the service refuses that once an instalment has actually been paid.
     */
    const data = await prisma.$transaction(async (transaction) => {
      if (reviews !== undefined) {
        // The list the form sends is the whole list, so the stored rows are replaced by it.
        await transaction.employeeReview.deleteMany({ where: { employeeId: id } });
        if (reviews.length) await transaction.employeeReview.createMany({ data: reviews.map((review) => reviewRow(review, id, actorId)) });
      }
      // The same rule the reviews follow: the whole list replaces the stored one, and a request
      // that never mentions children leaves them alone. `null` is an empty list, which is how the
      // form clears them when somebody stops being married.
      if (children !== undefined) {
        await transaction.employeeChild.deleteMany({ where: { employeeId: id } });
        const rows = children || [];
        if (rows.length) await transaction.employeeChild.createMany({ data: rows.map((child) => childRow(child, id)) });
      }
      if (qualifications !== undefined) {
        await transaction.employeeQualification.deleteMany({ where: { employeeId: id } });
        const rows = qualifications || [];
        if (rows.length) await transaction.employeeQualification.createMany({ data: rows.map((row) => qualificationRow(row, id)) });
      }
      if (attachments) {
        await transaction.employeeExperience.deleteMany({ where: { employeeId: id } });
        if (attachments.experiences.length) await transaction.employeeExperience.createMany({ data: attachments.experiences.map((row) => experienceRow(row, id)) });
      }
      const joiningSalary = updates.joiningSalary === undefined ? existing.joiningSalary : updates.joiningSalary;
      // The schedule to keep when the reviews come back empty: what this save carries, or what the
      // employee already had. Without the fallback, editing an employee who has no reviews and
      // changing nothing about their review date would clear the date they were onboarded with.
      const scheduledNextReviewDate = updates.nextReviewDate === undefined ? existing.nextReviewDate : updates.nextReviewDate;
      const employee = await transaction.employee.update({
        where: { id },
        data: {
          ...(reviews === undefined ? updates : { ...updates, ...reviewTotals(reviews, joiningSalary, scheduledNextReviewDate) }),
          // Resolved from the patch, so an edit that changes somebody's work base moves their
          // branch with it and one that never mentions it leaves the reference alone.
          ...await referenceColumnsFor(updates),
        },
      });
      /*
       * ── One person, one name ────────────────────────────────────────────────────────────────
       *
       * `User` and `Employee` are separate records joined by `User.linkedEmployeeId`, and the name
       * lives on both: the employee record carries `employeeName`, the login carries `name`. They
       * were written by two screens and neither told the other, so renaming somebody in one place
       * left every reader of the other still showing who they used to be - and which readers those
       * are is not obvious from either screen.
       *
       * The login follows the employee record, which is the studio's register of people. Done here
       * rather than left to whoever edits, so there is no way to rename an employee and forget.
       *
       * The same rule `loginUsername` already follows in the other direction - see the note on that
       * field in `schema.prisma` - and done inside this transaction for the same reason: a rename
       * that half applied would leave the two records disagreeing with nothing to say which is
       * right.
       *
       * `updateMany` rather than `update`: an employee with no login has no row to write, and that
       * is ordinary rather than an error.
       */
      if (updates.employeeName !== undefined) {
        await transaction.user.updateMany({
          where: { linkedEmployeeId: id },
          data: { name: updates.employeeName },
        });
      }
      if (referredByEmployeeId !== undefined) {
        await syncEmployeeReferral(transaction, id, {
          referrerEmployeeId: referredByEmployeeId,
          referredOn: employee.dateOfJoining,
          userId: actorId,
        });
      }
      return employee;
    });
    return res.json({ data: withoutCredentialsDraft(data) });
  } catch (error) {
    await discardUploads(uploads);
    return handleError(res, error, "Unable to update employee");
  }
}

/**
 * Removes an employee from the studio's screens, unless something is still holding on to them.
 *
 * Assets are the case that matters: `assignedPersonId` and `managerId` are `onDelete: Restrict`,
 * deliberately, because deleting the person an asset is out with would leave the asset held by
 * nobody and nothing to say who had it. So the assets are counted first and the refusal names them
 * and says what to do — the database would refuse anyway, but as a foreign key error nobody can act
 * on.
 *
 * The removal itself is an archive, not a delete — see the comment on the write below.
 */
/*
 * The two statuses that mean "not taken on yet", which is a different thing from not working.
 *
 * The same pair the browser names in `lib/employmentStatus.mjs`, and unlike the working statuses
 * these are not the studio's to rename: the onboarding flow writes them itself. Named here rather
 * than written into the check below so a tenth status added to the enum has one place to be
 * considered.
 */
const ONBOARDING_STATUSES = ["HR Onboarding Pending", "Employee Submission Pending"];

/**
 * The status to put somebody back on when they return.
 *
 * Their own previous status where that is somebody working here — the `in Training` or `PIP` they
 * were on when they left is the honest answer, not a promotion to Active. Where it is not, the
 * studio's first working status is: somebody who went Long Leave, then Relieved, would otherwise be
 * "restored" to Long Leave and stay in the InActive tab, having just been told they were being
 * moved back to Active.
 *
 * An **onboarding** status is restored as well, and that is not the same exception. A hire that
 * falls through can be offboarded from HR Onboarding Pending or Employee Submission Pending, so a
 * row taken back from that has to return to the wait it was in — putting a candidate who never
 * started on Active would hand the studio an employee it never took on, holding a joining date and
 * a salary nobody agreed.
 *
 * Read from the status list rather than written here, because which statuses count as working is
 * the studio's to set in Field Settings — see `workingEmployeeStatuses`.
 */
async function returningStatus(previousEmploymentStatus) {
  const working = await workingEmployeeStatuses();
  if (!previousEmploymentStatus) return working[0] || "Active";
  if (working.includes(previousEmploymentStatus)) return previousEmploymentStatus;
  if (ONBOARDING_STATUSES.includes(previousEmploymentStatus)) return previousEmploymentStatus;
  return working[0] || "Active";
}

/**
 * Putting somebody in the InActive tab back to work.
 *
 * One action for the whole of that tab, because it holds two different situations and the person
 * clicking has the same intention in both: a departure that was recorded — Relieved, Fired,
 * Absconded, which carries a separation row — and a `Long Leave`, which is only a status and has no
 * separation behind it at all.
 *
 * **The separation is removed rather than kept.** Reactivating is how an offboarding is taken back,
 * so the record of it goes with it and the employee returns to the status they held before — the
 * same thing `deleteSeparation` does, reached from the row rather than from inside the offboarding
 * panel. That is also what leaves them able to be offboarded again later, since a second separation
 * is refused while one is on record.
 *
 * Their login is reopened with them, the other half of a departure closing it. Everything else on
 * the record — reviews, salary history, assets, attendance, documents — was never touched by the
 * departure and is not touched here.
 */
const reactivateSchema = z.object({ reason: z.string().trim().min(1).max(5000) });

async function reactivateEmployee(req, res) {
  const id = parseId(req, res); if (!id) return;
  // Asked for, and required, because this deletes the offboarding it reverses: without a reason the
  // only trace of a departure that was taken back would be a status quietly reading Active again.
  const parsed = reactivateSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ message: "Give a reason for bringing this employee back." });
  try {
    const employee = await scopedEmployee(req, id, { employmentStatus: true }, { level: "READ_WRITE" });
    if (!employee) return res.status(404).json({ message: "Employee not found" });

    // Somebody already working here has nothing to return from, and saying so is more use than
    // quietly rewriting the status of a record that was fine.
    const working = await workingEmployeeStatuses();
    if (working.includes(employee.employmentStatus)) {
      return res.status(409).json({ message: "This employee is already active." });
    }
    // The two statuses that mean "not taken on yet" are not a departure either: there is nothing to
    // bring them back to, and the way out of those is the onboarding itself.
    if (ONBOARDING_STATUSES.includes(employee.employmentStatus)) {
      return res.status(409).json({ message: "This employee is still onboarding, so there is nothing to reactivate. Finish their onboarding instead." });
    }

    const separation = await prisma.employeeSeparation.findFirst({ where: { employeeId: id }, select: { id: true, previousEmploymentStatus: true } });
    const employmentStatus = await returningStatus(separation?.previousEmploymentStatus);

    const data = await prisma.$transaction(async (tx) => {
      if (separation) await tx.employeeSeparation.delete({ where: { id: separation.id } });
      const updated = await tx.employee.update({
        where: { id },
        data: {
          employmentStatus,
          dateOfRelieving: null,
          relievingRemarks: null,
          reactivationReason: parsed.data.reason,
          reactivatedAt: new Date(),
          reactivatedByUserId: Number(req.user.id),
        },
      });
      await reopenLogin(tx, id);
      return updated;
    });
    return res.json({ data: withoutCredentialsDraft(data) });
  } catch (error) { return handleError(res, error, "Unable to reactivate this employee"); }
}

/**
 * Archiving one employee, as the route and the bulk delete both do it.
 *
 * Split out so `DELETE /employees/bulk` runs this rather than its own update, which matters more
 * here than almost anywhere else: the scope check, the refusal for somebody still holding assets,
 * and the closing of their login are all conditions of removing a person, and a bulk route that
 * skipped any of them would archive people the single-row route refuses - or leave a live account
 * behind an archived employee, which is the exact state that transaction exists to prevent.
 *
 * Throws rather than answering, so the bulk runner counts the refusal and leaves the row ticked.
 */
async function deleteEmployeeRecord(req, id) {
  const parsed = Number.parseInt(id, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error("That is not a valid employee id.");
  const answer = await removeEmployee(req, parsed);
  if (answer.error) throw new Error(answer.error);
  return { id: parsed };
}

/**
 * The body of both: archives the employee or explains why it will not, without touching a response.
 * `error` is the sentence the route turns into its status code and the bulk runner turns into a
 * missed id; `status` is the code the route answers with.
 */
async function removeEmployee(req, id) {
  // Before the assets are counted, so a person out of scope is answered "not found" rather than
  // told how many assets they hold.
  if (!await scopedEmployee(req, id, { id: true }, { level: "READ_WRITE" })) return { status: 404, error: "Employee not found" };
  const [assigned, managed] = await Promise.all([
    prisma.asset.count({ where: { assignedPersonId: id, isDeleted: false } }),
    prisma.asset.count({ where: { managerId: id, isDeleted: false } }),
  ]);
  if (assigned || managed) {
    const holding = [
      assigned ? `${assigned} asset${assigned === 1 ? "" : "s"} assigned to them` : null,
      managed ? `${managed} asset${managed === 1 ? "" : "s"} they manage` : null,
    ].filter(Boolean).join(" and ");
    return { status: 409, error: `This employee still has ${holding}. Reassign those in Asset Management before deleting the record.` };
  }
  await prisma.$transaction(async (tx) => {
    await tx.employee.update({ where: { id }, data: { archivedAt: new Date() } });
    await tx.user.updateMany({ where: { linkedEmployeeId: id }, data: { status: "INACTIVE" } });
  });
  return { status: 204 };
}

async function deleteEmployee(req, res) {
  const id = parseId(req, res); if (!id) return;
  try {
    const answer = await removeEmployee(req, id);
    if (answer.error) return res.status(answer.status).json({ message: answer.error });
    return res.status(204).send();
  } catch (error) { return handleError(res, error, "Unable to delete employee"); }
}

async function createLoginCredentials(req, res) {
  // Making somebody a login is User Management's business, not the employee record's, so it is the
  // one thing on this router that asks for a permission of its own rather than riding on
  // HRM / Employee Management. It used to demand the legacy SUPER_ADMIN role, which no grant could
  // satisfy.
  if (!(await iamService.hasPermission(req.user?.id, "ADMIN", "User Management", "READ_WRITE"))) {
    return res.status(403).json({ message: "You need User Management access to create login credentials." });
  }
  const id = parseId(req, res); if (!id) return;
  const parsed = credentialSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Validation failed", errors: parsed.error.flatten() });

  try {
    const employee = await prisma.employee.findFirst({ where: { id, archivedAt: null } });
    if (!employee) return res.status(404).json({ message: "Employee not found" });
    // Onboarding ends here, not at the review: an approved submission stays HR Onboarding
    // Pending until this call creates the login AND its email lands, and only then goes Active.
    if (!["Active", "HR Onboarding Pending"].includes(employee.employmentStatus)) {
      return res.status(400).json({ message: "Login credentials can be created only for Active or onboarding employees." });
    }

    const [existingEmployeeUser, existingEmailUser, existingUsernameUser] = await Promise.all([
      prisma.user.findFirst({ where: { linkedEmployeeId: id } }),
      prisma.user.findUnique({ where: { email: parsed.data.email } }),
      prisma.user.findUnique({ where: { username: parsed.data.username } }),
    ]);
    if (existingEmployeeUser) return res.status(409).json({ message: "Login credentials already exist for this employee." });
    if (existingEmailUser) return res.status(409).json({ message: "A user already exists with this email address." });
    if (existingUsernameUser) return res.status(409).json({ message: "A user already exists with this username." });

    // Both are checked before anything is written: a role or branch that has since been deleted
    // would otherwise surface as a foreign key error, which reads as a server fault rather than as
    // the bad request it is.
    const roleIds = [...new Set(parsed.data.roleIds)];
    const roles = roleIds.length ? await prisma.role.findMany({ where: { id: { in: roleIds }, isActive: true }, select: { id: true, name: true } }) : [];
    if (roles.length !== roleIds.length) return res.status(400).json({ message: "One of those roles no longer exists." });

    const branchId = parsed.data.branchId ?? null;
    if (branchId) {
      const branch = await prisma.branch.findUnique({ where: { id: branchId }, select: { id: true } });
      if (!branch) return res.status(400).json({ message: "That branch no longer exists." });
      // And one this person may put somebody in: creating an account in a branch out of reach is
      // the same act as editing a user into it, and is refused the same way.
      // Measured against **User Management**, which is what guards this handler - making somebody a
      // login is that permission's business, and reach asked of the employee record's permission
      // instead would refuse an administrator who holds one and not the other.
      if (!(await iamService.canUseBranchId(req.user.id, branchId, { module: "ADMIN", feature: "User Management", level: "READ_WRITE" }))) {
        return res.status(403).json({ message: "You cannot assign a branch you do not have access to." });
      }
    }

    const alternative1EmployeeId = parsed.data.alternative1EmployeeId ?? null;
    const alternative2EmployeeId = parsed.data.alternative2EmployeeId ?? null;
    const problem = alternativesProblem(id, alternative1EmployeeId, alternative2EmployeeId);
    if (problem) return res.status(400).json({ message: problem });

    const leaveApproverIds = [parsed.data.leaveApprover1EmployeeId ?? null, parsed.data.leaveApprover2EmployeeId ?? null, parsed.data.leaveApprover3EmployeeId ?? null];
    const approverProblem = leaveApproversProblem(id, leaveApproverIds);
    if (approverProblem) return res.status(400).json({ message: approverProblem });

    const permissionApproverEmployeeId = parsed.data.permissionApproverEmployeeId ?? null;
    const permissionApproverFault = permissionApproverProblem(id, permissionApproverEmployeeId);
    if (permissionApproverFault) return res.status(400).json({ message: permissionApproverFault });

    const referencedIds = [...new Set([alternative1EmployeeId, alternative2EmployeeId, ...leaveApproverIds, permissionApproverEmployeeId].filter(Boolean))];
    if (referencedIds.length) {
      const found = await prisma.employee.count({ where: { id: { in: referencedIds }, archivedAt: null } });
      if (found !== referencedIds.length) return res.status(400).json({ message: "One of those employees is no longer on the repository." });
    }

    // The account, its roles and the cover recorded alongside them are one thing to create, not
    // three: a user that exists with none of the roles it was meant to carry is an account nobody
    // asked for.
    const user = await prisma.$transaction(async (transaction) => {
      const created = await transaction.user.create({
        data: {
          name: employee.employeeName,
          email: parsed.data.email,
          username: parsed.data.username,
          password: await bcrypt.hash(parsed.data.temporaryPassword, 12),
          role: "EMPLOYEE",
          status: "ACTIVE",
          linkedEmployeeId: employee.id,
          branchId,
          // The department-based access the app had before IAM, still read by the WhatsApp module.
          // Taken from the employee's own department, which is the answer the record already holds.
          accessDepartment: employee.department || null,
          mustChangePassword: true,
          whatsappRequired: parsed.data.whatsappRequired,
        },
      });
      if (roleIds.length) await transaction.userRole.createMany({ data: roleIds.map((roleId) => ({ userId: created.id, roleId })) });
      // Cover and leave approval belong to the employee, not to the account, so they are written
      // to the row the form was opened on rather than to the user just created.
      //
      // `loginUsername` is different: it belongs to the account (`created.username`, just set
      // above) and is only *mirrored* here, so that a lookup by login - the CRM's Google Sheet
      // sync foremost, through `referenceMatchers.js` - reads this table alone rather than joining
      // to `User`. See the note on this field in schema.prisma.
      await transaction.employee.update({
        where: { id },
        data: {
          alternative1EmployeeId,
          alternative2EmployeeId,
          leaveApprover1EmployeeId: leaveApproverIds[0],
          leaveApprover2EmployeeId: leaveApproverIds[1],
          leaveApprover3EmployeeId: leaveApproverIds[2],
          permissionApproverEmployeeId,
          loginUsername: created.username,
        },
      });
      // The draft of this page, now spent. The account is the answer to the question the draft was
      // holding an unfinished one to, and two answers to one question is how a stale username gets
      // restored over a live account's on the next visit.
      await transaction.employee.update({ where: { id }, data: { loginCredentialsDraft: Prisma.DbNull } });
      return created;
    });

    /*
     * A refused email no longer undoes the account.
     *
     * It used to: creating the login and mailing it were one act, on the reasoning that credentials
     * nobody received are not credentials, so a failed send deleted the account just made. That was
     * right while the email was the only way the details could reach anybody. It is not any more —
     * the screen now shows the username, the login address and the temporary password with a copy
     * of them the moment the account exists, so a studio whose mail is refused hands them over
     * itself. Deleting the account in that situation threw away work that was already done and
     * asked for it again, against a mail server that would refuse it again.
     *
     * So the account stands and the employee goes Active either way. What changes is what the
     * screen is told: `emailSent` false, and the reason, so it can say the mail did not go and lean
     * on the copy instead.
     *
     * `credentialsSentAt` is deliberately left unstamped when the send fails — it records that the
     * credentials were sent, and they were not.
     */
    let emailFailureReason = null;
    try {
      /*
       * Sent to the address the studio can actually reach them on, not to the one being created.
       *
       * `user.email` is the studio login address, and since it became something the application
       * *works out* from the person's name rather than something somebody typed, sending the
       * credentials there was posting them to a mailbox that does not exist yet — the account was
       * made, the mail went nowhere, and the new employee never learned they had a login. Their
       * personal email is the address their onboarding invite arrived at, which is the one address
       * they are known to read.
       *
       * The login address goes in the body instead, beside the username, because it is now
       * something they are being told rather than something they already knew.
       *
       * Falls back to the account's own address for a record with no personal email — a hand-added
       * employee can have one — which is the old behaviour and no worse than it was.
       */
      const emailResult = await sendEmployeeCredentialsEmail({
        employeeName: employee.employeeName,
        email: employee.emailId || user.email,
        username: user.username,
        loginEmail: user.email,
        temporaryPassword: parsed.data.temporaryPassword,
      });
      if (!emailResult.sent) emailFailureReason = emailResult.reason || "the email could not be sent";
    } catch (emailError) {
      /*
       * Said out loud on the server, because otherwise nobody can find out why.
       *
       * This used to answer "the email could not be sent" and throw the reason away, so a studio
       * whose mail account had hit its daily sending limit — which is what a refusal here usually
       * is — saw a message that could equally have meant a typo in the address, and had nothing to
       * act on. The full text goes to the log; only a classified summary goes to the browser, since
       * a thrown SMTP error can quote the message it was carrying.
       */
      console.error(`[hrm] Credential email refused for ${employee.employeeId || employee.id}:`, emailError.message);
      emailFailureReason = describeMailFailure(emailError);
    }
    if (!emailFailureReason) await prisma.user.update({ where: { id: user.id }, data: { credentialsSentAt: new Date() } });
    /*
     * The end of onboarding: the person now has everything they need to sign in.
     *
     * The login address used to be written back onto the record as the employee's Work Email ID.
     * It is not any more, and the field is no longer asked for anywhere: the address is the
     * studio's, built from the person's name (`lib/employeeName.mjs`), and filing a generated
     * address as though it were a fact somebody had recorded said something the record did not
     * know. What the record keeps is the status.
     *
     * It runs whether or not the email went. The account exists either way now, and what makes
     * somebody Active is having a login — not having been emailed about it. A studio whose mail was
     * refused copies the details off the screen and hands them over, and leaving the person on
     * HR Onboarding Pending for that would say their onboarding is unfinished when the only thing
     * outstanding is a message.
     */
    if (employee.employmentStatus === "HR Onboarding Pending") {
      await prisma.employee.update({ where: { id }, data: { employmentStatus: "Active" } });
    }

    return res.status(201).json({
      message: emailFailureReason ? "User created, but the credential email could not be sent." : "User created and credential email sent.",
      user: { id: user.id, name: user.name, email: user.email, username: user.username, role: user.role, accessDepartment: user.accessDepartment, branchId: user.branchId, roles, linkedEmployeeId: user.linkedEmployeeId, mustChangePassword: user.mustChangePassword },
      emailSent: !emailFailureReason,
      // Why it did not go, in the words `describeMailFailure` chose - the screen repeats this, so it
      // has to be something a person can act on rather than the raw SMTP text.
      warning: emailFailureReason ? `The credential email could not be sent: ${emailFailureReason}.` : undefined,
      // Where it went, or would have gone, so the screen can say so rather than leaving the studio to
      // guess between the person's own address and the login address it just handed out.
      sentTo: employee.emailId || user.email,
    });
  } catch (error) {
    if (error.code === "P2002") return res.status(409).json({ message: "Login credentials already exist for this employee." });
    return res.status(500).json({ message: "Unable to create employee login credentials." });
  }
}

/**
 * What the Login Credentials page had been filled in with when somebody stopped.
 *
 * A draft, not an account: no `User` row, no email, no access. It exists because that page is a
 * screen's worth of decisions — the username and address, the roles, the branch, who covers for
 * this person — and closing the panel used to throw all of it away.
 *
 * ── Why these two ask for `ADMIN / User Management` rather than HRM ──
 *
 * The draft carries the password the account will start on, so reading one is close enough to
 * reading a credential to be guarded like creating one. `createLoginCredentials` above asks for the
 * same permission, which is the point: whoever may finish this page may put it down and pick it up,
 * and nobody else may see what is on it. The GET needs saying explicitly because this router lets
 * any signed-in session read - reference data is read all over the app - and that pass must not
 * reach a half-made credential.
 */
async function mayHandleCredentials(req, res) {
  if (await iamService.hasPermission(req.user?.id, "ADMIN", "User Management", "READ_WRITE")) return true;
  res.status(403).json({ message: "You need User Management access to work on login credentials." });
  return false;
}

/**
 * The Login Credentials page for an account that already exists.
 *
 * The onboarding page creates an account; this reads the one an employee already has, so Edit
 * Employee can show the same page rather than the record's details alone. `null` for an employee
 * who has no login — not a 404, because the employee exists and the page then opens on the create
 * form exactly as onboarding does.
 *
 * Its own endpoint rather than a field on the employee row, and behind `ADMIN / User Management`
 * like the draft beside it: the employee list is readable by HR, and who may sign in as whom is not
 * theirs to read. `hasLoginCredentials` on the row says *whether* there is an account, which is all
 * the list needs to decide what to offer.
 */
async function getLoginCredentials(req, res) {
  if (!(await mayHandleCredentials(req, res))) return undefined;
  const id = parseId(req, res); if (!id) return undefined;
  try {
    const employee = await prisma.employee.findFirst({
      where: { id, archivedAt: null },
      select: {
        alternative1EmployeeId: true, alternative2EmployeeId: true,
        leaveApprover1EmployeeId: true, leaveApprover2EmployeeId: true, leaveApprover3EmployeeId: true,
        permissionApproverEmployeeId: true,
      },
    });
    if (!employee) return res.status(404).json({ message: "Employee not found" });
    const user = await prisma.user.findFirst({
      where: { linkedEmployeeId: id },
      select: { id: true, username: true, email: true, branchId: true, whatsappRequired: true, roles: { select: { roleId: true } } },
    });
    if (!user) return res.json({ data: null });
    return res.json({
      data: {
        userId: user.id,
        username: user.username,
        email: user.email,
        branchId: user.branchId,
        roleIds: user.roles.map((row) => row.roleId),
        whatsappRequired: user.whatsappRequired,
        alternative1EmployeeId: employee.alternative1EmployeeId,
        alternative2EmployeeId: employee.alternative2EmployeeId,
        // Sent as the ordered list the page shows, holes dropped: approval is asked in the order
        // they were picked, and a blank second slot is not a person to ask.
        leaveApproverIds: [employee.leaveApprover1EmployeeId, employee.leaveApprover2EmployeeId, employee.leaveApprover3EmployeeId].filter(Boolean),
        permissionApproverEmployeeId: employee.permissionApproverEmployeeId ?? null,
      },
    });
  } catch (error) {
    return res.status(500).json({ message: "Unable to read the login credentials." });
  }
}

/**
 * What an existing account may be changed to from Edit Employee, which is deliberately not
 * everything.
 *
 * **The sign-in identity is not here.** Username, email and password are what the person signs in
 * with, and are read-only on that page: changing them is Admin -> User Management's, which is the
 * one screen that owns accounts, and two screens writing an identity is how the two disagree about
 * who somebody is. What this takes is what the page is for — what the account may *do*, and who
 * covers the person while they are away.
 *
 * Roles belong to the account and the rest to the employee, so both are written together or not at
 * all: an account left carrying roles nobody asked for because the second write failed is exactly
 * the state `createLoginCredentials` takes a transaction to avoid.
 */
const credentialUpdateSchema = z.object({
  roleIds: z.array(z.string().min(1)).max(50).default([]),
  /*
   * Whether this account must have WhatsApp linked before it may use the application.
   *
   * Off unless somebody ticks it, and defaulted `false` here too - so an older client that does not
   * send the field leaves an account unheld rather than quietly gating somebody who never agreed to
   * it. An administrator is never held whatever this says.
   */
  whatsappRequired: z.coerce.boolean().optional().default(false),
  alternative1EmployeeId: nullableEmployeeRef,
  alternative2EmployeeId: nullableEmployeeRef,
  leaveApprover1EmployeeId: nullableEmployeeRef,
  leaveApprover2EmployeeId: nullableEmployeeRef,
  leaveApprover3EmployeeId: nullableEmployeeRef,
  // The one colleague who approves this person's permissions. One rather than three: a permission
  // is an hour out of a day and is settled the same morning it is asked for.
  permissionApproverEmployeeId: nullableEmployeeRef,
});

async function updateLoginCredentials(req, res) {
  if (!(await mayHandleCredentials(req, res))) return undefined;
  const id = parseId(req, res); if (!id) return undefined;
  const parsed = credentialUpdateSchema.safeParse(cleanData(req.body));
  if (!parsed.success) return res.status(400).json({ message: "Validation failed", errors: parsed.error.flatten() });
  try {
    const employee = await prisma.employee.findFirst({ where: { id, archivedAt: null }, select: { id: true } });
    if (!employee) return res.status(404).json({ message: "Employee not found" });
    const user = await prisma.user.findFirst({ where: { linkedEmployeeId: id }, select: { id: true } });
    // Nothing to change rather than something to create: creating is the other endpoint, under the
    // rules that go with issuing an account.
    if (!user) return res.status(404).json({ message: "This employee has no login credentials yet." });

    const roleIds = [...new Set(parsed.data.roleIds)];
    const roles = roleIds.length ? await prisma.role.findMany({ where: { id: { in: roleIds }, isActive: true }, select: { id: true } }) : [];
    if (roles.length !== roleIds.length) return res.status(400).json({ message: "One of those roles no longer exists." });

    const alternative1EmployeeId = parsed.data.alternative1EmployeeId ?? null;
    const alternative2EmployeeId = parsed.data.alternative2EmployeeId ?? null;
    const problem = alternativesProblem(id, alternative1EmployeeId, alternative2EmployeeId);
    if (problem) return res.status(400).json({ message: problem });

    const leaveApproverIds = [parsed.data.leaveApprover1EmployeeId ?? null, parsed.data.leaveApprover2EmployeeId ?? null, parsed.data.leaveApprover3EmployeeId ?? null];
    const approverProblem = leaveApproversProblem(id, leaveApproverIds);
    if (approverProblem) return res.status(400).json({ message: approverProblem });

    const permissionApproverEmployeeId = parsed.data.permissionApproverEmployeeId ?? null;
    const permissionApproverFault = permissionApproverProblem(id, permissionApproverEmployeeId);
    if (permissionApproverFault) return res.status(400).json({ message: permissionApproverFault });

    const referencedIds = [...new Set([alternative1EmployeeId, alternative2EmployeeId, ...leaveApproverIds, permissionApproverEmployeeId].filter(Boolean))];
    if (referencedIds.length) {
      const found = await prisma.employee.count({ where: { id: { in: referencedIds }, archivedAt: null } });
      if (found !== referencedIds.length) return res.status(400).json({ message: "One of those employees is no longer on the repository." });
    }

    await prisma.$transaction(async (transaction) => {
      // Replaced rather than diffed: the page sends the whole list it is showing, so what it says
      // is what the account carries afterwards - and a role removed on screen is a role gone.
      await transaction.userRole.deleteMany({ where: { userId: user.id } });
      if (roleIds.length) await transaction.userRole.createMany({ data: roleIds.map((roleId) => ({ userId: user.id, roleId })) });
      // The WhatsApp rule is the account's, so it goes with the roles rather than with the cover
      // recorded on the employee below - and inside the same transaction, so an account cannot end up
      // held to a rule the roles beside it were never given.
      await transaction.user.update({ where: { id: user.id }, data: { whatsappRequired: parsed.data.whatsappRequired } });
      await transaction.employee.update({
        where: { id },
        data: {
          alternative1EmployeeId,
          alternative2EmployeeId,
          leaveApprover1EmployeeId: leaveApproverIds[0],
          leaveApprover2EmployeeId: leaveApproverIds[1],
          leaveApprover3EmployeeId: leaveApproverIds[2],
          permissionApproverEmployeeId,
        },
      });
    });
    return res.json({ message: "Login credentials updated successfully." });
  } catch (error) {
    return handleError(res, error, "Unable to update the login credentials");
  }
}

/**
 * The draft as it will be filled back into the page.
 *
 * `null` for an employee nobody has started this page for, which is not a 404: the employee exists
 * and the page opens on its proposals as it always did. A missing *employee* is still a 404.
 */
async function getLoginCredentialsDraft(req, res) {
  if (!(await mayHandleCredentials(req, res))) return undefined;
  const id = parseId(req, res); if (!id) return undefined;
  try {
    const employee = await prisma.employee.findFirst({ where: { id, archivedAt: null }, select: { loginCredentialsDraft: true } });
    if (!employee) return res.status(404).json({ message: "Employee not found" });
    return res.json({ data: employee.loginCredentialsDraft || null });
  } catch (error) {
    return res.status(500).json({ message: "Unable to read the login credentials draft." });
  }
}

/**
 * Puts the page down as it stands, or clears what was put down.
 *
 * Deliberately far looser than `credentialSchema`: a draft is by definition unfinished, so a blank
 * username or no role at all is exactly what it is for. Nothing here is in force, and the real
 * schema still refuses anything wrong when the account is finally created - validating twice would
 * only mean the work could not be saved until it was already correct, which is the problem this
 * column exists to solve.
 *
 * What is *not* loose is the shape: unknown keys are dropped rather than stored, so this stays a
 * draft of this page and does not become a place to park arbitrary JSON on an employee.
 */
const credentialDraftSchema = z.object({
  username: z.string().max(191).optional(),
  email: z.string().max(191).optional(),
  temporaryPassword: z.string().max(128).optional(),
  branchId: z.union([z.coerce.number().int().positive(), z.literal(""), z.null()]).optional(),
  roleIds: z.array(z.string().max(60)).max(30).optional(),
  alternative1EmployeeId: z.union([z.coerce.number().int().positive(), z.literal(""), z.null()]).optional(),
  alternative2EmployeeId: z.union([z.coerce.number().int().positive(), z.literal(""), z.null()]).optional(),
  leaveApproverIds: z.array(z.union([z.coerce.number().int().positive(), z.string().max(20)])).max(3).optional(),
  // One employee, or blank for "the leave approvers decide" - the same shape as the two
  // alternative slots above, which is what the form sends it as.
  permissionApproverEmployeeId: z.union([z.coerce.number().int().positive(), z.literal(""), z.null()]).optional(),
  /*
   * The WhatsApp toggle, which `draftFrom` has always sent and this schema never listed.
   *
   * `.strict()` refuses an unknown key rather than dropping it - the note above says dropped, and
   * that is `.strip()`, zod's default - so every Save Draft on this page has been answered with a
   * 400 since the toggle was added to the payload. Found while adding the field beside it: the
   * draft is meant to keep the page as it stands, and the toggle is part of the page.
   */
  whatsappAllowed: z.boolean().optional(),
}).strict();

async function saveLoginCredentialsDraft(req, res) {
  if (!(await mayHandleCredentials(req, res))) return undefined;
  const id = parseId(req, res); if (!id) return undefined;
  // An empty body clears the draft, which is what Discard does: the page goes back to proposing
  // from the record rather than restoring what somebody explicitly threw away.
  const clearing = req.body === null || req.body === undefined || (typeof req.body === "object" && !Array.isArray(req.body) && Object.keys(req.body).length === 0);
  const parsed = clearing ? { success: true, data: null } : credentialDraftSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Validation failed", errors: parsed.error.flatten() });

  try {
    const employee = await prisma.employee.findFirst({ where: { id, archivedAt: null }, select: { id: true } });
    if (!employee) return res.status(404).json({ message: "Employee not found" });
    // An account already made is the answer; a draft written beside it would be restored over it
    // the next time the page opened.
    const account = await prisma.user.findFirst({ where: { linkedEmployeeId: id }, select: { id: true } });
    if (account && !clearing) return res.status(409).json({ message: "Login credentials already exist for this employee." });

    const draft = parsed.data === null ? null : { ...parsed.data, savedAt: new Date().toISOString() };
    await prisma.employee.update({ where: { id }, data: { loginCredentialsDraft: draft === null ? Prisma.DbNull : draft } });
    return res.json({ data: draft, message: draft ? "Draft saved." : "Draft discarded." });
  } catch (error) {
    return res.status(500).json({ message: "Unable to save the login credentials draft." });
  }
}

module.exports = { employeeSchema, ONBOARDING_STATUSES, EMPLOYEE_SCOPE_COLUMNS, employeeVisibility, isSuperAdmin, listEmployees, employeeDirectory, previewNextEmployeeId, createEmployee, employeeImportTemplate, importEmployees, updateEmployee, deleteEmployee, deleteEmployeeRecord, reactivateEmployee, returningStatus, createLoginCredentials, getLoginCredentialsDraft, saveLoginCredentialsDraft, getLoginCredentials, updateLoginCredentials, credentialUpdateSchema, credentialDraftSchema, withoutCredentialsDraft, reviewSchema, REVIEW_OUTCOMES, nextEmployeeId, reportingProblem };
