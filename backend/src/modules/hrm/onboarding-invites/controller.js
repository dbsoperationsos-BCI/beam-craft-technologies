const crypto = require("crypto");
const { asksForSpouseDetails, genderNames, publicOnboardingOptionLists } = require("../../../services/employeeOptionLists");
const { z } = require("zod");
const prisma = require("../../../config/db");
const { sendOnboardingInviteEmail, sendOnboardingSendBackEmail } = require("../../../services/emailService");
// Why a send was refused, in words the studio can act on - shared with the credentials email,
// which is refused the same way and for the same reasons.
const { describeMailFailure } = require("../../../services/mailFailure");
const { storeImages, discardUploads } = require("../../../services/imageStorage");
const { storeDocument } = require("../../../services/documentStorage");
const { SHORT_CODE_PATTERN, generateShortCode } = require("../../../services/shortCode");
const { nextIdentifier } = require("../../../services/identifiers");

const ONBOARDING_PROOF_FOLDER = "hrm/onboarding/proof";
const ONBOARDING_PHOTO_FOLDER = "hrm/onboarding/photo";
// The experience and relieving letters attached to a previous job. The same folder the HR employee
// form files them under, since the two screens write the same rows.
const EXPERIENCE_DOCUMENT_FOLDER = "hrm/onboarding/experience";
const inviteStatuses = ["Created", "Verified", "Submitted", "Expired", "Cancelled"];
/*
 * Every answer the create form asks for, required here too.
 *
 * The designation and the expiry were optional, and the form let them through: an invite could be
 * raised naming neither the role the candidate is being taken on for nor when their link stops
 * working. Both are now asked for, and the rule is held here rather than only in the browser -
 * otherwise it is a rule the one screen that can break it is the only thing keeping.
 *
 * The expiry has no default any more, which is the part worth saying: the server used to fall back
 * to seven days for a request that left it out, and the two callers that relied on that now send a
 * date of their own. A default under a required field is a way for the field to go unanswered.
 */
const createInviteSchema = z.object({
  candidateName: z.string().trim().min(1).max(150),
  candidateEmail: z.string().trim().email().max(191),
  candidatePhone: z.string().trim().min(1).max(30),
  // The message covers the key being absent as well as being blank: to whoever is reading it,
  // "expected string, received undefined" and an empty box are the same unanswered field.
  intendedDesignation: z.string({ message: "Intended Designation is required." }).trim().min(1, "Intended Designation is required.").max(150),
  expiresAt: z.coerce.date({ message: "Expiry Date is required." }),
});
/*
 * Correcting an invite that has already gone out.
 *
 * The same five answers the create form asks for, because a typo can be in any of them - a wrong
 * digit in the phone number or a letter missing from the address is the whole reason this exists,
 * and the candidate cannot verify themselves with either of those wrong. Every field is required
 * here as it is there: this replaces the invite's details rather than patching one of them, so a
 * field left out would be a field blanked.
 */
const updateInviteSchema = createInviteSchema;

const identifierSchema = z.object({ identifier: z.string().trim().min(1).max(191) });
const inviteIdSchema = z.string().cuid();
// The original invite token: 64 hex characters, stored only as a hash. A short code can never
// look like one — codes are at most 8 characters — so one classifier tells them apart wherever
// an identifier arrives (the public routes, the email proof, the schema below).
const ONBOARDING_TOKEN_PATTERN = /^[a-f0-9]{64}$/i;
function classifyInviteIdentifier(identifier) {
  const value = String(identifier || "").trim();
  if (ONBOARDING_TOKEN_PATTERN.test(value)) return { kind: "token", where: { tokenHash: hashToken(value) } };
  if (SHORT_CODE_PATTERN.test(value)) return { kind: "code", code: value.toUpperCase(), where: { shortCode: value.toUpperCase() } };
  return null;
}
// One base URL for every link this module hands out. One definition on purpose: this used to be
// computed inline in three places with two different fallbacks, so an unset FRONTEND_URL made the
// emailed link and the copied link disagree about the same invite.
const frontendBaseUrl = () => (process.env.FRONTEND_URL || "http://localhost:3000").replace(/\/$/, "");

/**
 * Which identifier a shared onboarding link carries.
 *
 * The short code wherever the invite has one — /onboarding/apply/A7K9C2M4 is what the invite list
 * copies, what the invite email sends, and what a candidate can read off a screenshot without
 * mistyping it. The 64-character token is the fallback for an invite created before short codes
 * existed, which has nothing else to be linked by.
 *
 * `heldToken` is the identifier a caller has already proved they hold; it is preferred over the
 * invite's stored token so a resend cannot quietly upgrade a caller to a link they did not present.
 *
 * One function because the rule was written out at each email path, and when short codes arrived
 * only one of them was updated - Send Back went on emailing the long link for months.
 */
function onboardingLinkCode(invite, heldToken = null) {
  return invite?.shortCode || heldToken || invite?.token || null;
}

/**
 * The link a candidate opens their form at, from the invite behind it — or null where that invite
 * predates short codes and holds neither identifier.
 *
 * One place, because more than one module hands this link out now: the invite list copies it, the
 * invite email sends it, the send-back email sends it again, and the employee list carries it so
 * the Send Back confirmation can show the message before anything is sent. Four spellings of the
 * same URL is four chances for one of them to point somewhere else.
 */
function onboardingUrlFor(invite, heldToken = null) {
  const code = onboardingLinkCode(invite, heldToken);
  return code ? `${frontendBaseUrl()}/onboarding/apply/${code}` : null;
}
// Either identifier proves the caller holds the link: the original 64-hex token, or the short
// code the shortened URL carries (which is what the dialog reads back off the link it shows).
const sendInviteEmailSchema = z.object({
  token: z.string().trim().refine((value) => classifyInviteIdentifier(value) !== null, "A valid onboarding token is required"),
});
const requiredSubmissionText = z.string().trim().min(1).max(5000);
const optionalSubmissionText = (max = 5000) => z.string().trim().max(max).optional();
// The same formats the employee record is validated against, so a submission cannot create a record
// that HR is then unable to edit. Phone numbers are judged on their digits, since the country code
// is optional on the public form and normalised on the way in.
const submissionPhone = z.string().trim().refine((value) => /^[6-9]\d{9}$/.test(value.replace(/\D/g, "").slice(-10)) && value.replace(/\D/g, "").length <= 13, "Enter a 10-digit mobile number");
// A proof is either a freshly picked image, which arrives as a compressed data URI, or a link the
// browser is echoing back from an earlier attempt at the same submission.
const proofImage = z.string().trim().min(1).max(12_000_000)
  .refine((value) => /^data:image\/[a-z0-9.+-]+;base64,/i.test(value) || /^https?:\/\//i.test(value), "Upload a valid image file");

/*
 * The studio takes nobody on under eighteen.
 *
 * The form's calendar already stops at the last day that leaves the candidate that age, and this is
 * the half that decides it: a public endpoint is posted to by more than the form that draws it.
 * Whole years, counted the way the browser counts them, so the two cannot disagree about a birthday
 * falling today.
 *
 * Read in UTC throughout, because a date of birth is a date and not a moment: "1998-04-02" is
 * parsed as UTC midnight, and pulling the parts back out through the *local* getters would move the
 * birthday a day in either direction depending on which side of UTC the server sits.
 */
const MINIMUM_EMPLOYEE_AGE = 18;
const submissionDateOfBirth = z.coerce.date()
  .refine((value) => value <= new Date(), "Date Of Birth cannot be in the future")
  .refine((value) => Date.UTC(value.getUTCFullYear() + MINIMUM_EMPLOYEE_AGE, value.getUTCMonth(), value.getUTCDate()) <= Date.now(),
    `You must be at least ${MINIMUM_EMPLOYEE_AGE} years old to be onboarded`);

/*
 * One child of a married candidate. A name is what makes a row worth keeping, so it is required —
 * the blank rows an "Add Child" click leaves behind are dropped by the form before they get here.
 * The date is preprocessed because an unanswered one arrives as "", which `z.coerce.date()` reads
 * as an Invalid Date rather than as "not given".
 */
const submissionChild = z.object({
  name: z.string().trim().min(1).max(150),
  dateOfBirth: z.preprocess((value) => (value === "" ? null : value),
    z.coerce.date().refine((value) => value <= new Date(), "A child's date of birth cannot be in the future").nullable().optional()),
});

/*
 * A number inside a repeating row, which reaches here as the string the input held — "" for one
 * nobody answered. `z.coerce.number()` reads "" as 0, so an unanswered year would be stored as the
 * year nought rather than as no year at all; the preprocess is what keeps the two apart.
 */
const submissionRowNumber = (schema) => z.preprocess((value) => (value === "" || value === null || value === undefined ? null : value), schema.nullable().optional());

/** One qualification. The degree makes the row worth keeping; the rest is context for it. */
const submissionQualification = z.object({
  degree: z.string().trim().min(1).max(150),
  branch: optionalSubmissionText(150),
  college: optionalSubmissionText(200),
  // The upper bound leaves room for a candidate still studying to name the year they will finish.
  passedOutYear: submissionRowNumber(z.coerce.number().int().min(1950).max(new Date().getFullYear() + 6)),
});

/*
 * One job held before this one. Only the company is required: an old job whose exact length nobody
 * remembers is still worth recording, and refusing it would be the reason somebody could not finish
 * their onboarding. The attachment takes the shape the separation letter does — freshly picked and
 * arriving as a data URI under a file name, or the one already stored being echoed back.
 */
const submissionExperience = z.object({
  companyName: z.string().trim().min(1).max(200),
  companyLocation: optionalSubmissionText(200),
  role: optionalSubmissionText(150),
  years: submissionRowNumber(z.coerce.number().min(0).max(60)),
  attachment: z.array(z.object({
    name: z.string().trim().min(1).max(255),
    data: z.string().max(8_000_000).optional(),
    url: z.string().trim().max(8_000_000).optional(),
  }).refine((value) => value.data || value.url, "Attach a document or leave it empty")).max(1).optional(),
});

const onboardingSubmissionSchema = z.object({
  firstName: requiredSubmissionText.max(75),
  lastName: requiredSubmissionText.max(75),
  /*
   * Checked against the gender list rather than a fixed set of three.
   *
   * It was `z.enum(["Male", "Female", "Other"])`, so a studio that added a gender in Settings →
   * Field Settings got a form offering it and an endpoint refusing it. Asked of the list instead,
   * which falls back to those same three where nothing has been recorded - see
   * `services/employeeOptionLists`. Async, which is what makes the parse below `safeParseAsync`.
   */
  gender: requiredSubmissionText.max(120).refine(
    async (value) => (await genderNames()).some((name) => name.toLocaleLowerCase() === value.toLocaleLowerCase()),
    "Choose a gender from the list",
  ),
  contactNumber: submissionPhone,
  emailId: z.string().trim().email().max(191),
  dateOfJoining: z.coerce.date(),
  workType: requiredSubmissionText.max(100),
  skills: requiredSubmissionText,
  languagesKnown: requiredSubmissionText,
  // Fifty, matching the widened `employee.blood_group`: the studio maintains this list now, so
  // an entry longer than "AB+" is theirs to add and must not be refused on submit.
  bloodGroup: requiredSubmissionText.max(50),
  emergencyContactName: requiredSubmissionText.max(150),
  emergencyContactNumber: submissionPhone,
  emergencyContactRelationship: requiredSubmissionText.max(100),
  nominee1PersonName: requiredSubmissionText.max(150),
  nominee1PersonPhone: submissionPhone,
  nominee2PersonName: requiredSubmissionText.max(150),
  nominee2PersonPhone: submissionPhone,
  aadharCardNumber: z.string().trim().regex(/^[2-9]\d{11}$/, "Aadhar Card Number must be 12 digits and cannot start with 0 or 1"),
  panCardNumber: z.string().trim().toUpperCase().regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/, "PAN must be five letters, four digits, then a letter"),
  aadharCardImage: proofImage,
  panCardImage: proofImage,
  /*
   * The candidate's own photograph, on the same footing as the two proofs above it.
   *
   * It was optional, on the reading that a missing photo should never be the reason somebody cannot
   * finish their onboarding. The studio puts a face to every record — the repository, the org chart
   * and the top bar all read it — and a photograph is far harder to collect afterwards than during
   * the one sitting where somebody is filling in everything else about themselves, so it is asked
   * for now. Required here as well as on the form, because this endpoint is public and is posted to
   * by more than the form that draws it.
   */
  profilePhoto: proofImage,
  fatherName: requiredSubmissionText.max(150),
  fatherOccupation: requiredSubmissionText.max(150),
  motherName: requiredSubmissionText.max(150),
  motherOccupation: requiredSubmissionText.max(150),
  maritalStatus: requiredSubmissionText.max(50),
  // Required of a married candidate alone; the superRefine below is what asks for them.
  spouseName: optionalSubmissionText(150),
  weddingAnniversary: z.coerce.date().optional(),
  // Asked of a married candidate alone, and never required of them: plenty of married people have
  // no children. Anybody else's list is ignored below rather than refused.
  children: z.array(submissionChild).max(20).optional(),
  dateOfBirth: submissionDateOfBirth,
  /*
   * What they studied and where they have worked, and the one place the two part company.
   *
   * At least one qualification is asked for: everybody has been to school, so an empty list is a
   * question nobody answered rather than an honest "none". Experience stays optional, and
   * deliberately - a fresher has no job to list, and refusing them would make this form the reason
   * somebody could not be taken on.
   */
  qualifications: z.array(submissionQualification).min(1, "Add at least one qualification").max(20),
  experiences: z.array(submissionExperience).max(30).optional(),
  currentAddress: requiredSubmissionText,
  permanentAddress: requiredSubmissionText,
  reference1PersonName: requiredSubmissionText.max(150),
  reference1PersonPhone: submissionPhone,
  reference1PersonAddress: requiredSubmissionText,
  reference2PersonName: requiredSubmissionText.max(150),
  reference2PersonPhone: submissionPhone,
  reference2PersonAddress: requiredSubmissionText,
  bankName: requiredSubmissionText.max(150),
  bankLocation: requiredSubmissionText.max(150),
  accountNumber: z.string().trim().regex(/^\d{9,18}$/, "Account Number must be between 9 and 18 digits"),
  ifscCode: z.string().trim().toUpperCase().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, "IFSC must be four letters, then 0, then six characters"),
  policyAgreementAccepted: z.literal(true),
}).superRefine(async (data, context) => {
  /*
   * The two fields the form only shows a candidate whose marital status asks for them, required
   * exactly then - the browser is never the guard, so the rule the form applies is applied again
   * here. Which statuses ask is the list's own answer (`requires_spouse_details`), not the literal
   * "Married" this used to compare against, so renaming the option or adding a second one that also
   * has a spouse keeps working.
   */
  if (!(await asksForSpouseDetails(data.maritalStatus))) return;
  if (!String(data.spouseName || "").trim()) context.addIssue({ code: z.ZodIssueCode.custom, path: ["spouseName"], message: "Spouse Name is required." });
  if (!data.weddingAnniversary) context.addIssue({ code: z.ZodIssueCode.custom, path: ["weddingAnniversary"], message: "Wedding Anniversary is required." });
});

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function generateToken() {
  return crypto.randomBytes(32).toString("hex");
}

// DBS-1, DBS-2 - the same identifier the Employee Repository hands out, from the same counter, so
// an invited employee and a hand-added one can never draw the same number.
const nextEmployeeId = (transaction) => nextIdentifier("EMPLOYEE", {}, transaction);

function serializeInvite(invite) {
  const { tokenHash, ...safeInvite } = invite;
  // With the short code stored on the row, the link can be rebuilt on any read — copying it is
  // no longer possible only in the moment after creation. Null for invites that predate codes:
  // their token is hashed and cannot be reconstructed, by design.
  return { ...safeInvite, onboardingUrl: invite.shortCode ? `${frontendBaseUrl()}/onboarding/apply/${invite.shortCode}` : null };
}

function maskEmail(email) {
  const [localPart, domain] = email.split("@");
  if (!domain) return "***";
  const visible = localPart.slice(0, Math.min(2, localPart.length));
  return `${visible}${"*".repeat(Math.max(1, localPart.length - visible.length))}@${domain}`;
}

function normalizePhone(value) {
  return String(value ?? "").replace(/[\s\-()+]/g, "");
}

/**
 * Whether two phone numbers are the same number, when only one of them carries its country code.
 *
 * Exact digit equality is not enough, and the gap is a real one: HR types the candidate's number
 * into a field that stores it as `+91 9876543210`, and the candidate proving who they are types the
 * ten digits they would give anybody. Compared strictly, `919876543210` and `9876543210` are two
 * different numbers and the candidate is turned away from their own invite.
 *
 * So one may carry a dialling prefix the other omits: they match when the shorter is the tail of the
 * longer. The shorter must be a national number in its own right — seven digits, the shortest in
 * use anywhere — because without that floor a four-digit fragment would match every number ending
 * in it, and this decides both who may open an invite and whether a second invite is a duplicate.
 */
function phonesMatch(first, second) {
  const left = normalizePhone(first);
  const right = normalizePhone(second);
  if (!left || !right) return false;
  if (left === right) return true;
  const [longer, shorter] = left.length >= right.length ? [left, right] : [right, left];
  return shorter.length >= 7 && longer.endsWith(shorter);
}

/**
 * Rewrites a phone number into the `+91 9876543210` shape the employee record is validated against,
 * so a number typed on the public form is still editable in the HR employee form afterwards.
 * Anything too short to be a national number is left as it was typed.
 */
function toStoredPhone(value) {
  const raw = String(value || "").trim();
  // An optional number that was left blank stays absent rather than becoming an empty string.
  if (!raw) return undefined;
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 10) return raw;
  return `+${digits.slice(0, -10) || "91"} ${digits.slice(-10)}`;
}

/** The invite carries one candidate name, so the form is seeded with everything before the last word. */
function splitCandidateName(candidateName) {
  const parts = String(candidateName || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return { firstName: parts[0] || "", lastName: "" };
  return { firstName: parts.slice(0, -1).join(" "), lastName: parts.at(-1) };
}

function dateOnly(value) {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString().slice(0, 10);
}

/**
 * A submitted employee row folded back into the shape the public form holds, so a sent-back
 * candidate edits what they typed instead of retyping it. Images travel as the stored URLs -
 * the form shows them and the submission schema accepts a URL back unchanged. Only released
 * after verification, like everything else the form is seeded with.
 */
// The form holds skills and languages as arrays of picks and joins them with ", " on submit,
// so the stored string goes back the way it came - handed back whole, the multi-select mapped
// over its characters.
function splitList(value) {
  return String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
}

function employeePrefill(employee) {
  const entries = {
    ...splitCandidateName(employee.employeeName),
    gender: employee.gender,
    dateOfBirth: dateOnly(employee.dateOfBirth),
    contactNumber: employee.contactNumber,
    emailId: employee.emailId,
    dateOfJoining: dateOnly(employee.dateOfJoining),
    workType: employee.workType,
    bloodGroup: employee.bloodGroup,
    currentAddress: employee.currentAddress,
    permanentAddress: employee.permanentAddress,
    skills: splitList(employee.skills),
    languagesKnown: splitList(employee.languagesKnown),
    fatherName: employee.fatherName,
    fatherOccupation: employee.fatherOccupation,
    motherName: employee.motherName,
    motherOccupation: employee.motherOccupation,
    maritalStatus: employee.maritalStatus,
    spouseName: employee.spouseName,
    weddingAnniversary: dateOnly(employee.weddingAnniversary),
    // Handed back as the rows the field draws, so a sent-back candidate corrects the children they
    // entered rather than adding them again. Only present when the row was read with them.
    children: (employee.children || []).map((child) => ({ name: child.name || "", dateOfBirth: dateOnly(child.dateOfBirth) || "" })),
    qualifications: (employee.qualifications || []).map((qualification) => ({
      degree: qualification.degree || "",
      branch: qualification.branch || "",
      college: qualification.college || "",
      passedOutYear: qualification.passedOutYear == null ? "" : String(qualification.passedOutYear),
    })),
    // The stored letter goes back as the one-file list the upload field holds, and the submission
    // schema accepts that link back unchanged — so a sent-back candidate keeps the letter they
    // already attached instead of having to find it again.
    experiences: (employee.experiences || []).map((experience) => ({
      companyName: experience.companyName || "",
      companyLocation: experience.companyLocation || "",
      role: experience.role || "",
      years: experience.years == null ? "" : String(experience.years),
      attachment: experience.attachmentName ? [{ name: experience.attachmentName, url: experience.attachmentUrl }] : [],
    })),
    aadharCardNumber: employee.aadharCardNumber,
    panCardNumber: employee.panCardNumber,
    aadharCardImage: employee.aadharCardImageUrl,
    panCardImage: employee.panCardImageUrl,
    profilePhoto: employee.profilePhotoUrl,
    bankName: employee.bankName,
    bankLocation: employee.bankLocation,
    accountNumber: employee.accountNumber,
    ifscCode: employee.ifscCode,
    emergencyContactName: employee.emergencyContactName,
    emergencyContactNumber: employee.emergencyContactNumber,
    emergencyContactRelationship: employee.emergencyContactRelationship,
    reference1PersonName: employee.reference1PersonName,
    reference1PersonPhone: employee.reference1PersonPhone,
    reference1PersonAddress: employee.reference1PersonAddress,
    reference2PersonName: employee.reference2PersonName,
    reference2PersonPhone: employee.reference2PersonPhone,
    reference2PersonAddress: employee.reference2PersonAddress,
    nominee1PersonName: employee.nominee1PersonName,
    nominee1PersonPhone: employee.nominee1PersonPhone,
    nominee2PersonName: employee.nominee2PersonName,
    nominee2PersonPhone: employee.nominee2PersonPhone,
  };
  return Object.fromEntries(Object.entries(entries).filter(([, value]) => value !== null && value !== undefined));
}

function maskPhone(phone) {
  const normalized = normalizePhone(phone);
  if (normalized.length <= 4) return "*".repeat(normalized.length);
  return `${"*".repeat(Math.max(1, normalized.length - 4))}${normalized.slice(-4)}`;
}

function validationError(res, error) {
  return res.status(400).json({ message: "Validation failed", errors: error.flatten() });
}

function unavailableInviteResponse(res, invite) {
  if (invite.status === "Cancelled") return res.status(410).json({ message: "This onboarding invite has been cancelled." });
  if (invite.status === "Submitted") return res.status(410).json({ message: "This onboarding invite has already been submitted." });
  return res.status(410).json({ message: "This onboarding invite has expired." });
}

// The public routes accept either public identifier: the original 64-hex token (links already
// sent out keep working) or the short code from the shortened link.
async function findUsableInvite(identifier) {
  const classified = classifyInviteIdentifier(identifier);
  if (!classified) return { invite: null, state: "missing" };
  const invite = await prisma.employeeOnboardingInvite.findUnique({ where: classified.where });
  if (!invite) return { invite: null, state: "missing" };
  if (invite.status === "Cancelled" || invite.status === "Submitted") return { invite, state: "unavailable" };
  if (invite.expiresAt <= new Date()) {
    const expiredInvite = invite.status === "Expired" ? invite : await prisma.employeeOnboardingInvite.update({ where: { id: invite.id }, data: { status: "Expired" } });
    return { invite: expiredInvite, state: "expired" };
  }
  if (!inviteStatuses.includes(invite.status)) return { invite, state: "unavailable" };
  return { invite, state: "valid" };
}

async function createInvite(req, res) {
  const parsed = createInviteSchema.safeParse(req.body);
  if (!parsed.success) return validationError(res, parsed.error);

  const expiresAt = parsed.data.expiresAt;
  if (expiresAt <= new Date()) return res.status(400).json({ message: "expiresAt must be in the future" });

  try {
    const activeInvites = await prisma.employeeOnboardingInvite.findMany({
      where: { status: { in: ["Created", "Verified"] }, expiresAt: { gt: new Date() } },
      select: { candidateEmail: true, candidatePhone: true },
    });
    const hasActiveInvite = activeInvites.some((invite) => (
      invite.candidateEmail.toLowerCase() === parsed.data.candidateEmail.toLowerCase()
      || phonesMatch(invite.candidatePhone, parsed.data.candidatePhone)
    ));
    if (hasActiveInvite) return res.status(409).json({ message: "An active onboarding invite already exists for this candidate." });

    const token = generateToken();
    // The short code is what the candidate's link carries, so it is allocated with the invite —
    // retrying past the unique constraint until an unclaimed code lands, like gallery codes do.
    // Eight characters rather than the gallery's six: a gallery code is paired with a PIN, while
    // this link's own gate is the candidate verifying their email or phone — so the code space
    // carries more of the weight (31^8 ≈ 8.5e11 against a handful of live invites).
    let invite = null;
    for (let attempt = 0; attempt < 5 && !invite; attempt += 1) {
      try {
        invite = await prisma.employeeOnboardingInvite.create({
          data: {
            ...parsed.data,
            expiresAt,
            tokenHash: hashToken(token),
            tokenPreview: `${token.slice(0, 4)}…${token.slice(-4)}`,
            token,
            shortCode: generateShortCode(8),
          },
        });
      } catch (error) {
        if (error?.code !== "P2002") throw error;
      }
    }
    if (!invite) return res.status(500).json({ message: "Unable to create onboarding invite" });
    // The shared link is the short one; the long tokenized path stays valid for links already out.
    const serialized = serializeInvite(invite);
    return res.status(201).json({ invite: serialized, token, onboardingUrl: serialized.onboardingUrl });
  } catch (error) {
    return res.status(500).json({ message: "Unable to create onboarding invite" });
  }
}

async function listInvites(req, res) {
  try {
    const invites = await prisma.employeeOnboardingInvite.findMany({ orderBy: { createdAt: "desc" } });
    return res.json({ data: invites.map(serializeInvite) });
  } catch (error) {
    return res.status(500).json({ message: "Unable to load onboarding invites" });
  }
}

async function cancelInvite(req, res) {
  const parsedId = inviteIdSchema.safeParse(req.params.id);
  if (!parsedId.success) return validationError(res, parsedId.error);

  try {
    const existingInvite = await prisma.employeeOnboardingInvite.findUnique({ where: { id: parsedId.data } });
    if (!existingInvite) return res.status(404).json({ message: "Onboarding invite not found" });
    if (existingInvite.status === "Submitted") return res.status(400).json({ message: "Submitted onboarding invites cannot be cancelled" });

    const invite = await prisma.employeeOnboardingInvite.update({
      where: { id: existingInvite.id },
      data: { status: "Cancelled", cancelledAt: new Date() },
    });
    return res.json({ invite: serializeInvite(invite) });
  } catch (error) {
    return res.status(500).json({ message: "Unable to cancel onboarding invite" });
  }
}

/**
 * Corrects an invite that has already been created - and keeps its link.
 *
 * The recovery for a mistyped address or phone number used to be Cancel and re-invite, which
 * issues a *new* link and leaves the old one dead. That is right when the link went to the wrong
 * person and has to be revoked; it is heavy-handed when the studio simply typed a digit wrong and
 * nobody ever received anything. So this edits the invite in place: same token, same short code,
 * same URL - only the details the candidate is contacted on change, and the mail can go again
 * afterwards through the existing Send.
 *
 * ── What it will not edit ──
 *
 * A submitted invite, because its details are what the candidate filled the form in against, and
 * a cancelled one, because cancelling is a decision and this must not quietly undo it. An expired
 * invite *is* editable - the expiry is one of the fields, so correcting it is how a lapsed invite
 * is brought back without issuing a new link.
 *
 * ── Verification is given back ──
 *
 * `Verified` means the candidate proved they hold the address or the number on this invite. Change
 * either and that proof is about a value the invite no longer carries, so the status returns to
 * `Created` and the corrected contact has to be proven in its turn. Leaving it Verified would let
 * whoever holds the link past the check using details nobody has confirmed.
 */
async function updateInvite(req, res) {
  const parsedId = inviteIdSchema.safeParse(req.params.id);
  if (!parsedId.success) return res.status(400).json({ message: "Invalid onboarding invite id" });
  const parsed = updateInviteSchema.safeParse(req.body);
  if (!parsed.success) return validationError(res, parsed.error);
  if (parsed.data.expiresAt <= new Date()) return res.status(400).json({ message: "expiresAt must be in the future" });

  try {
    const invite = await prisma.employeeOnboardingInvite.findUnique({ where: { id: parsedId.data } });
    if (!invite) return res.status(404).json({ message: "Onboarding invite not found" });
    if (invite.status === "Submitted") {
      return res.status(400).json({ message: "This candidate has already submitted their details, so the invite cannot be edited. Send it back to them instead." });
    }
    if (invite.status === "Cancelled") {
      return res.status(400).json({ message: "This invite was cancelled. Create a fresh one instead of editing it." });
    }

    // The same rule the create path keeps, minus this invite itself: correcting a typo must not be
    // refused on the grounds that the invite being corrected already holds the old details.
    const others = await prisma.employeeOnboardingInvite.findMany({
      where: { id: { not: invite.id }, status: { in: ["Created", "Verified"] }, expiresAt: { gt: new Date() } },
      select: { candidateEmail: true, candidatePhone: true },
    });
    const clashes = others.some((other) => (
      other.candidateEmail.toLowerCase() === parsed.data.candidateEmail.toLowerCase()
      || phonesMatch(other.candidatePhone, parsed.data.candidatePhone)
    ));
    if (clashes) return res.status(409).json({ message: "An active onboarding invite already exists for this candidate." });

    const contactChanged = invite.candidateEmail.toLowerCase() !== parsed.data.candidateEmail.toLowerCase()
      || !phonesMatch(invite.candidatePhone, parsed.data.candidatePhone);

    const updated = await prisma.employeeOnboardingInvite.update({
      where: { id: invite.id },
      data: {
        candidateName: parsed.data.candidateName,
        candidateEmail: parsed.data.candidateEmail,
        candidatePhone: parsed.data.candidatePhone,
        intendedDesignation: parsed.data.intendedDesignation,
        expiresAt: parsed.data.expiresAt,
        // An expired invite whose expiry has just been moved forward is open again; and a verified
        // one whose contact details changed has to be proven afresh. See the note above.
        ...(invite.status === "Expired" || (contactChanged && invite.status === "Verified") ? { status: "Created" } : {}),
      },
    });

    // The same shape `createInvite` answers with, so the screen can move straight on to sending.
    return res.json({ invite: serializeInvite(updated), onboardingUrl: onboardingUrlFor(updated) });
  } catch (error) {
    console.error("[hrm] Unable to update onboarding invite:", error.message);
    return res.status(500).json({ message: "Unable to update this onboarding invite." });
  }
}

async function sendInviteEmail(req, res) {
  const parsedId = inviteIdSchema.safeParse(req.params.id);
  const parsedBody = sendInviteEmailSchema.safeParse(req.body);
  if (!parsedId.success || !parsedBody.success) return validationError(res, (!parsedId.success ? parsedId : parsedBody).error);

  try {
    const invite = await prisma.employeeOnboardingInvite.findUnique({ where: { id: parsedId.data } });
    if (!invite) return res.status(404).json({ message: "Onboarding invite not found" });
    if (invite.status === "Cancelled" || invite.status === "Submitted") return res.status(400).json({ message: "This onboarding invite can no longer be sent." });
    if (invite.expiresAt <= new Date()) {
      if (invite.status !== "Expired") await prisma.employeeOnboardingInvite.update({ where: { id: invite.id }, data: { status: "Expired" } });
      return res.status(400).json({ message: "This onboarding invite has expired." });
    }
    const classified = classifyInviteIdentifier(parsedBody.data.token);
    const proves = classified?.kind === "token"
      ? classified.where.tokenHash === invite.tokenHash
      : Boolean(classified) && Boolean(invite.shortCode) && classified.code === invite.shortCode;
    if (!proves) return res.status(400).json({ message: "The onboarding link is no longer valid for this invite." });

    // The candidate gets the short link when the invite has a code; an old invite without one
    // falls back to the long tokenized link the caller proved they hold.
    const onboardingUrl = onboardingUrlFor(invite, parsedBody.data.token.trim());
    // The designation goes with it: an invite that names the role somebody is being taken on for
    // reads as addressed to them, rather than as a form the studio wants filled in.
    /*
     * Both shapes of refusal, answered the same way - see the send-back below for why they differ.
     * `smtpPool` reports `{ sent: false }` only for a server with no sender configured and *throws*
     * when senders exist and all of them refuse, which is what a spent daily quota does. Left to the
     * generic catch, that arrived as a bare 500 with nothing in it: the studio was told the invite
     * could not be sent and not that its mail account was out of sends for the day.
     */
    let emailFailure = null;
    try {
      const emailResult = await sendOnboardingInviteEmail({ candidateName: invite.candidateName, email: invite.candidateEmail, onboardingUrl, expiresAt: invite.expiresAt, intendedDesignation: invite.intendedDesignation });
      if (!emailResult.sent) emailFailure = emailResult.reason || "the email could not be sent";
    } catch (emailError) {
      // The reason only, never the thrown text: an SMTP error can quote the message it carried.
      console.error(`[hrm] Onboarding invite email refused for invite ${invite.id}:`, emailError.message);
      emailFailure = describeMailFailure(emailError);
    }
    if (emailFailure) {
      return res.status(502).json({ message: `Unable to send onboarding invite email: ${emailFailure}`, emailSent: false, warning: emailFailure });
    }
    return res.json({ message: "Onboarding invite email sent successfully." });
  } catch (error) {
    // Reaching here is the invite itself failing to be read or marked, not the email - that is
    // caught above and answered with its reason.
    console.error("[hrm] Unable to send onboarding invite email:", error.message);
    return res.status(500).json({ message: "Unable to send onboarding invite email." });
  }
}

/**
 * Sends a submitted onboarding back to the candidate to edit and resubmit.
 *
 * The invite is reopened under the same link: back to Verified (they proved themselves once
 * already), the submission stamp cleared so the guarded resubmit can land, and the expiry
 * extended so the emailed link is not already dead. The employee row stays where it is - the
 * resubmission updates it in place, so the DBS id survives and no duplicate appears. The email
 * is its own template, not the invite mail sent again: the candidate already filled the form
 * once, so "complete your onboarding" reads as a mistake, while this one says plainly that what
 * they submitted was reviewed and needs another look. Same URL either way, which the form answers
 * by pre-filling everything they typed the first time.
 */
async function sendBackOnboarding(req, res) {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: "Invalid employee id" });
  try {
    const employee = await prisma.employee.findUnique({ where: { id }, select: { id: true, employmentStatus: true } });
    if (!employee) return res.status(404).json({ message: "Employee not found" });
    if (employee.employmentStatus !== "HR Onboarding Pending") {
      return res.status(400).json({ message: "Only a submission still pending HR review can be sent back." });
    }
    const invite = await prisma.employeeOnboardingInvite.findFirst({ where: { employeeId: String(id), status: "Submitted" }, orderBy: { createdAt: "desc" } });
    if (!invite) return res.status(404).json({ message: "No onboarding submission was found for this employee, so there is nothing to send back." });
    // Either identifier is a sendable link: the short code the shortened URL carries, or the long
    // token behind it. Only an invite holding neither predates resendable links.
    if (!onboardingLinkCode(invite)) {
      return res.status(400).json({ message: "This invite predates resendable links, so its original link cannot be emailed again. Cancel it and create a fresh invite instead." });
    }

    const expiresAt = new Date(Math.max(invite.expiresAt.getTime(), Date.now() + 7 * 24 * 60 * 60 * 1000));
    await prisma.$transaction([
      prisma.employeeOnboardingInvite.update({
        where: { id: invite.id },
        data: { status: "Verified", submittedAt: null, expiresAt },
      }),
      // The ball is back in the candidate's court, so the employee row moves from HR Onboarding
      // Pending to Employee Submission Pending — the same status the invite's synthetic row carried
      // before the first submission, now on the real row so a single entry appears in one tab.
      prisma.employee.update({
        where: { id },
        data: { employmentStatus: "Employee Submission Pending" },
      }),
    ]);

    /*
     * The short link, the same one the invite list copies and the invite email sends — a candidate
     * who is asked to come back to a form should not be handed a 64-character URL when everybody
     * else gets /onboarding/apply/A7K9C2M4. An invite from before short codes falls back to its
     * long tokenized link, which is the only one it has.
     *
     * Built from `frontendBaseUrl()` like every other link in this module. It used to read
     * FRONTEND_URL here with a fallback of its own, so with that variable unset this one mail
     * pointed at the production host while the invite mail beside it pointed at localhost.
     */
    const onboardingUrl = onboardingUrlFor(invite);
    /*
     * Sending is the last thing this does, and the least of it.
     *
     * Everything above has already happened and is not undone by a refused email: the invite is
     * open again and the employee is back on **Employee Submission Pending**. What a failed send
     * costs is only that the candidate has not been told - and the screen answers that by handing
     * over the message to send by hand, which is why this replies with the link and the details
     * rather than with an error.
     *
     * ── Why the throw is caught here ──
     *
     * `smtpPool` returns `{ sent: false }` for one case only - no sender configured at all - and
     * *throws* when senders exist and every one of them refuses. A studio that has spent its daily
     * quota is the second case, which is the common one, and it was reaching the generic catch at
     * the bottom: a 500 saying "Unable to send this onboarding back", carrying no link. The screen
     * reads that as a hard failure, closes, and leaves somebody holding a reopened submission with
     * no way to tell the candidate. Both shapes are the same answer here.
     */
    let emailFailure = null;
    try {
      const emailResult = await sendOnboardingSendBackEmail({
        candidateName: invite.candidateName,
        email: invite.candidateEmail,
        onboardingUrl,
        expiresAt,
        intendedDesignation: invite.intendedDesignation,
      });
      if (!emailResult.sent) emailFailure = emailResult.reason || "the email could not be sent";
    } catch (emailError) {
      // The reason only, never the thrown text: an SMTP error can quote the message it carried.
      console.error(`[hrm] Send-back email refused for invite ${invite.id}:`, emailError.message);
      emailFailure = describeMailFailure(emailError);
    }
    if (emailFailure) {
      return res.status(502).json({
        message: `The submission was reopened, but the email could not be sent: ${emailFailure}`,
        candidateName: invite.candidateName,
        onboardingUrl,
        expiresAt,
        emailSent: false,
        warning: emailFailure,
      });
    }
    return res.json({
      message: "Sent back. The candidate has been emailed the same onboarding link to edit and resubmit their details.",
      candidateName: invite.candidateName,
      onboardingUrl,
      expiresAt,
      emailSent: true,
    });
  } catch (error) {
    // Reaching here now means the *reopening* failed, not the email - that is caught above and
    // answered with the link. So this really is "nothing happened", which is what it says.
    console.error("[hrm] Unable to send this onboarding back:", error.message);
    return res.status(500).json({ message: "Unable to send this onboarding back." });
  }
}

async function getPublicInvite(req, res) {
  const result = await findUsableInvite(req.params.token);
  if (result.state === "missing") return res.status(404).json({ message: "This onboarding invite is invalid or unavailable." });
  if (result.state !== "valid") return unavailableInviteResponse(res, result.invite);

  const { invite } = result;
  return res.json({
    candidateName: invite.candidateName,
    candidateEmailMasked: maskEmail(invite.candidateEmail),
    candidatePhoneMasked: maskPhone(invite.candidatePhone),
    intendedDesignation: invite.intendedDesignation,
    status: invite.status,
    expiresAt: invite.expiresAt,
    /*
     * The option lists the form draws its pickers from, served with the invite.
     *
     * A candidate has no session, so the apply page cannot read the master data the employee form
     * reads - and without this it would go on offering the arrays compiled into the browser while HR
     * edited the studio's own lists, which is the two screens asking different things about the same
     * person. `spouseRequiringMaritalStatuses` carries the meaning as well as the words: it is what
     * decides whether the spouse name and wedding anniversary are shown at all.
     */
    options: await publicOnboardingOptionLists(),
  });
}

async function verifyPublicInvite(req, res) {
  const parsed = identifierSchema.safeParse(req.body);
  if (!parsed.success) return validationError(res, parsed.error);

  const result = await findUsableInvite(req.params.token);
  if (result.state === "missing") return res.status(404).json({ verified: false, message: "This onboarding invite is invalid or unavailable." });
  if (result.state !== "valid") return unavailableInviteResponse(res, result.invite);

  const identifier = parsed.data.identifier;
  const matchesEmail = identifier.toLowerCase() === result.invite.candidateEmail.toLowerCase();
  const matchesPhone = phonesMatch(identifier, result.invite.candidatePhone);
  if (!matchesEmail && !matchesPhone) return res.status(400).json({ verified: false, message: "The entered email or phone does not match this invite." });

  const invite = await prisma.employeeOnboardingInvite.update({
    where: { id: result.invite.id },
    data: { verifiedAt: new Date(), ...(result.invite.status === "Created" ? { status: "Verified" } : {}) },
  });
  // Only now are the details returned unmasked: whoever asked has just proved they already know one
  // of them, and the form fills itself in from them rather than asking for what HR has typed once.
  //
  // A sent-back submission carries more: the invite points at the employee row the first
  // submission created, and every field of it is handed back so the candidate edits their
  // details rather than retyping them.
  let prefill = null;
  if (invite.employeeId) {
    // With the children, in the order they were typed, so the list comes back the way it was filled
    // in rather than reordered around a child whose date of birth was never recorded.
    const employee = await prisma.employee.findUnique({
      where: { id: Number(invite.employeeId) },
      include: { children: { orderBy: { id: "asc" } }, qualifications: { orderBy: { id: "asc" } }, experiences: { orderBy: { id: "asc" } } },
    });
    if (employee && ["HR Onboarding Pending", "Employee Submission Pending"].includes(employee.employmentStatus)) prefill = employeePrefill(employee);
  }
  return res.json({
    verified: true,
    status: invite.status,
    candidate: {
      ...splitCandidateName(invite.candidateName),
      email: invite.candidateEmail,
      phone: toStoredPhone(invite.candidatePhone),
    },
    prefill,
  });
}

function publicSubmissionError(status, message) {
  const error = new Error(message);
  error.publicStatus = status;
  return error;
}

async function createSubmittedEmployee(tx, data, invite, proofUrls, experiences) {
  /*
   * A sent-back submission comes home to the row it created the first time: the invite kept the
   * employee id, so the resubmission updates that row - same DBS id, no duplicate - and the row
   * stays on HR Onboarding Pending for review. Only a first submission creates.
   */
  const existingId = invite.employeeId ? Number(invite.employeeId) : null;
  if (existingId) {
    const existing = await tx.employee.findUnique({ where: { id: existingId }, select: { id: true, employmentStatus: true } });
    if (existing && ["HR Onboarding Pending", "Employee Submission Pending"].includes(existing.employmentStatus)) {
      return tx.employee.update({
        where: { id: existingId },
        // A resubmission carries the whole of each list, so the stored rows are replaced by them —
        // which is also how a candidate who has corrected their marital status is left with no
        // children, and how one who removed a job is left without it.
        data: {
          // No designation, department or vertical: see `submittedEmployeeData`. A resubmission is
          // the candidate's answers again, and must not undo what HR settled while reviewing.
          ...(await submittedEmployeeData(data, proofUrls)),
          children: { deleteMany: {}, create: await submittedChildren(data) },
          qualifications: { deleteMany: {}, create: submittedQualifications(data) },
          experiences: { deleteMany: {}, create: submittedExperiences(experiences) },
        },
      });
    }
  }
  return tx.employee.create({
    data: {
      employeeId: await nextEmployeeId(tx),
      ...(await submittedEmployeeData(data, proofUrls)),
      /*
       * The one studio answer seeded here, because the invite already carries it: Intended
       * Designation is required to send an invite at all, so a new record starts with the job it
       * was raised for. Department and Vertical have no such answer yet and are left NULL, so
       * Review Employee asks for them on an empty required field rather than offering a sentinel
       * that is on none of its lists.
       */
      designation: invite.intendedDesignation || null,
      children: { create: await submittedChildren(data) },
      qualifications: { create: submittedQualifications(data) },
      experiences: { create: submittedExperiences(experiences) },
    },
  });
}

/** The children to store: only a married candidate is asked for any, so only theirs are kept. */
async function submittedChildren(data) {
  if (!(await asksForSpouseDetails(data.maritalStatus))) return [];
  return (data.children || []).map((child) => ({ name: child.name, dateOfBirth: child.dateOfBirth ?? null }));
}

const submittedQualifications = (data) => (data.qualifications || []).map((qualification) => ({
  degree: qualification.degree,
  branch: qualification.branch ?? null,
  college: qualification.college ?? null,
  passedOutYear: qualification.passedOutYear ?? null,
}));

/**
 * The jobs to store. The letters are already uploaded by the time this runs — the caller hands over
 * what `storeExperienceAttachments` gave back — so what arrives is a stored name and link rather
 * than a file still to be dealt with.
 */
const submittedExperiences = (experiences) => (experiences || []).map((experience) => ({
  companyName: experience.companyName,
  companyLocation: experience.companyLocation ?? null,
  role: experience.role ?? null,
  years: experience.years ?? null,
  attachmentName: experience.attachmentName ?? null,
  attachmentUrl: experience.attachmentUrl ?? null,
}));

/**
 * Uploads the letter attached to each job and rewrites the row to carry the stored name and link.
 *
 * Run before the transaction opens, the way the identity proofs are, so a slow upload never holds
 * one open — and the uploads come back alongside so a submission that then fails can delete what it
 * put there. A letter already carrying a `url` is one the form is echoing back after a send-back,
 * and `storeDocument` hands it straight through rather than uploading it a second time.
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

/**
 * The candidate's own answers, as an employee record.
 *
 * ── What is deliberately not here ─────────────────────────────────────────────────────────────
 *
 * Designation, Department and Vertical. The onboarding form never asks the candidate for any of
 * them - they are the studio's decisions, taken in Review Employee - and this wrote all three as
 * the literal string "Not Allocated", which caused two faults at once.
 *
 * On the review form it read as an answer. `SchemaFormFields` adds a stored value that is not on
 * its list back into the options rather than losing it, and "Not Allocated" is on none of the three
 * lists - so it arrived as a selected option in a required field. HR could approve the record
 * without ever choosing, and the register then held a designation that no dropdown offers.
 *
 * And on a resubmission it overwrote. This runs on the update path too - a candidate sent back for
 * corrections resubmits through it - so any department or vertical HR had already chosen was reset
 * to the sentinel by the candidate pressing Submit.
 *
 * Left unwritten, the columns are NULL (all three are nullable), the review form shows its own
 * "Select Department" placeholder on an empty required field, and a resubmission leaves HR's
 * choices alone. Designation is seeded once from the invite's Intended Designation, by the create
 * path below, for the same reason: it is the studio's answer, and re-applying it on every
 * resubmission would undo a correction made during review.
 */
async function submittedEmployeeData(data, proofUrls) {
  // Asked once here rather than twice below, and asked of the marital status list rather than
  // compared against the word "Married".
  const spouseAsked = await asksForSpouseDetails(data.maritalStatus);
  return {
          employeeName: `${data.firstName} ${data.lastName}`.trim(),
          employmentStatus: "HR Onboarding Pending",
          gender: data.gender,
          contactNumber: toStoredPhone(data.contactNumber),
          emailId: data.emailId,
          dateOfJoining: data.dateOfJoining,
          workType: data.workType,
          skills: data.skills,
          languagesKnown: data.languagesKnown,
          bloodGroup: data.bloodGroup,
          emergencyContactName: data.emergencyContactName,
          emergencyContactNumber: toStoredPhone(data.emergencyContactNumber),
          emergencyContactRelationship: data.emergencyContactRelationship,
          nominee1PersonName: data.nominee1PersonName,
          nominee1PersonPhone: toStoredPhone(data.nominee1PersonPhone),
          nominee2PersonName: data.nominee2PersonName,
          nominee2PersonPhone: toStoredPhone(data.nominee2PersonPhone),
          aadharCardNumber: data.aadharCardNumber,
          panCardNumber: data.panCardNumber,
          aadharCardImageUrl: proofUrls.aadharCardImageUrl,
          panCardImageUrl: proofUrls.panCardImageUrl,
          profilePhotoUrl: proofUrls.profilePhotoUrl,
          fatherName: data.fatherName,
          fatherOccupation: data.fatherOccupation,
          motherName: data.motherName,
          motherOccupation: data.motherOccupation,
          maritalStatus: data.maritalStatus,
          // Only a candidate whose marital status asks for these is offered them, so anyone else
          // stores nothing. `spouseAsked` is the list's answer, resolved once above.
          spouseName: spouseAsked ? data.spouseName : null,
          weddingAnniversary: spouseAsked ? data.weddingAnniversary : null,
          dateOfBirth: data.dateOfBirth,
          currentAddress: data.currentAddress,
          permanentAddress: data.permanentAddress,
          reference1PersonName: data.reference1PersonName,
          reference1PersonPhone: toStoredPhone(data.reference1PersonPhone),
          reference1PersonAddress: data.reference1PersonAddress,
          reference2PersonName: data.reference2PersonName,
          reference2PersonPhone: toStoredPhone(data.reference2PersonPhone),
          reference2PersonAddress: data.reference2PersonAddress,
          bankName: data.bankName,
          bankLocation: data.bankLocation,
          accountNumber: data.accountNumber,
          ifscCode: data.ifscCode,
          policyAgreementAccepted: true,
          policyAgreementAcceptedAt: new Date(),
  };
}

async function submitPublicInvite(req, res) {
  // Async because two of its rules ask the option lists: the gender must be one on the list, and
  // whether a spouse is required is the marital status list's own answer.
  const parsed = await onboardingSubmissionSchema.safeParseAsync(req.body);
  if (!parsed.success) return validationError(res, parsed.error);

  const result = await findUsableInvite(req.params.token);
  if (result.state === "missing") return res.status(404).json({ message: "This onboarding invite is invalid or unavailable." });
  if (result.state !== "valid") return unavailableInviteResponse(res, result.invite);
  if (!result.invite.verifiedAt) return res.status(403).json({ message: "Verify this onboarding invite before submitting details." });

  // The proofs are uploaded before the transaction opens, so a slow upload never holds a database
  // transaction open. Anything stored here is deleted again if the submission does not land.
  let uploads = [];
  let photoUploads = [];
  let experiences = [];
  let experienceUploads = [];
  try {
    uploads = await storeImages([parsed.data.aadharCardImage, parsed.data.panCardImage], { folder: ONBOARDING_PROOF_FOLDER });
    // Filed apart from the proofs: a person's photograph is not an identity document, and the two
    // are read in different places. Only uploaded when one was given, since it is optional.
    if (parsed.data.profilePhoto) {
      photoUploads = await storeImages([parsed.data.profilePhoto], { folder: ONBOARDING_PHOTO_FOLDER });
    }
    // The experience letters go the same way, and to document storage rather than image storage:
    // most of them are PDFs, and none of them is a picture of the candidate or of their ID.
    const stored = await storeExperienceAttachments(parsed.data.experiences || []);
    experiences = stored.experiences;
    experienceUploads = stored.uploads;
  } catch (error) {
    // Whatever landed before the failure is removed, so a half-finished submission leaves nothing
    // orphaned in the bucket.
    await discardUploads([...uploads, ...photoUploads, ...experienceUploads]);
    return res.status(error.status || 500).json({ message: error.status ? error.message : "Unable to upload the attached files. Please try again." });
  }
  const proofUrls = {
    aadharCardImageUrl: uploads[0]?.url || null,
    panCardImageUrl: uploads[1]?.url || null,
    profilePhotoUrl: photoUploads[0]?.url || null,
  };

  try {
    const employee = await prisma.$transaction(async (tx) => {
      const invite = await tx.employeeOnboardingInvite.findUnique({ where: { id: result.invite.id } });
      if (!invite) throw publicSubmissionError(404, "This onboarding invite is invalid or unavailable.");
      if (invite.status === "Cancelled") throw publicSubmissionError(410, "This onboarding invite has been cancelled.");
      if (invite.status === "Submitted") throw publicSubmissionError(410, "This onboarding invite has already been submitted.");
      if (invite.expiresAt <= new Date()) {
        await tx.employeeOnboardingInvite.update({ where: { id: invite.id }, data: { status: "Expired" } });
        throw publicSubmissionError(410, "This onboarding invite has expired.");
      }
      if (!invite.verifiedAt) throw publicSubmissionError(403, "Verify this onboarding invite before submitting details.");

      const createdEmployee = await createSubmittedEmployee(tx, parsed.data, invite, proofUrls, experiences);
      const updated = await tx.employeeOnboardingInvite.updateMany({
        where: { id: invite.id, status: "Verified", submittedAt: null },
        data: { status: "Submitted", submittedAt: new Date(), employeeId: String(createdEmployee.id) },
      });
      if (updated.count !== 1) throw publicSubmissionError(409, "This onboarding invite has already been submitted.");
      return createdEmployee;
    });
    return res.status(201).json({ message: "Onboarding details submitted successfully.", employee: { id: employee.id, employeeId: employee.employeeId, employeeName: employee.employeeName, employmentStatus: employee.employmentStatus } });
  } catch (error) {
    // The photograph and the experience letters go with the proofs: the submission did not land,
    // so nothing it uploaded should survive in the bucket.
    await discardUploads([...uploads, ...photoUploads, ...experienceUploads]);
    if (error.publicStatus) return res.status(error.publicStatus).json({ message: error.message });
    if (error.code === "P2002") return res.status(409).json({ message: "Unable to create employee details. Please contact HR." });
    return res.status(500).json({ message: "Unable to submit onboarding details." });
  }
}

module.exports = { phonesMatch, onboardingUrlFor, updateInvite, onboardingSubmissionSchema, createInvite, listInvites, cancelInvite, sendInviteEmail, sendBackOnboarding, getPublicInvite, verifyPublicInvite, submitPublicInvite, onboardingLinkCode };
