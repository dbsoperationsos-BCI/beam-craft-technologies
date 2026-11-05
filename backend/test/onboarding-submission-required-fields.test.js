const test = require("node:test");
const assert = require("node:assert/strict");

const { onboardingSubmissionSchema } = require("../src/modules/hrm/onboarding-invites/controller");

/*
 * Everything the onboarding form asks for is asked for here too.
 *
 * The form marks a field required and refuses to submit without it, but this endpoint is public and
 * is posted to by more than the form that draws it - so the browser is never the guard. A field
 * that is required on one side and optional on the other is the two halves disagreeing rather than
 * a decision, and Bank Location had been exactly that: starred on the form, `.optional()` here.
 *
 * Two fields are deliberately not on the list below, and both are lists somebody can honestly have
 * nothing to put in: Experience, because a fresher has no job to name, and Children, because plenty
 * of married people have none. Asking for either would make this form the reason somebody could not
 * be taken on, so they are pinned as optional rather than left to drift.
 */

const IMAGE = "data:image/png;base64,iVBORw0KGgo=";

/** A submission with every answer the endpoint asks for, which each test then takes one thing from. */
const completeSubmission = () => ({
  firstName: "Raja",
  lastName: "Kumar",
  gender: "Male",
  contactNumber: "9874561233",
  emailId: "raja@gmail.com",
  dateOfJoining: "2026-10-01",
  dateOfBirth: "1998-04-11",
  workType: "Full Time",
  bloodGroup: "O+",
  skills: "Photography",
  languagesKnown: "Tamil, English",
  currentAddress: "1 Main Street, Chennai",
  permanentAddress: "1 Main Street, Chennai",
  qualifications: [{ degree: "B.Sc Visual Communication", branch: "", college: "", passedOutYear: "" }],
  fatherName: "Kumar",
  fatherOccupation: "Teacher",
  motherName: "Latha",
  motherOccupation: "Homemaker",
  maritalStatus: "Single",
  aadharCardNumber: "234567890123",
  panCardNumber: "ABCDE1234F",
  aadharCardImage: IMAGE,
  panCardImage: IMAGE,
  profilePhoto: IMAGE,
  bankName: "State Bank of India",
  bankLocation: "Chennai",
  accountNumber: "123456789",
  ifscCode: "SBIN0001234",
  emergencyContactName: "Kumar",
  emergencyContactNumber: "9874561234",
  emergencyContactRelationship: "Father",
  reference1PersonName: "Ravi",
  reference1PersonPhone: "9874561235",
  reference1PersonAddress: "2 Second Street, Chennai",
  reference2PersonName: "Priya",
  reference2PersonPhone: "9874561236",
  reference2PersonAddress: "3 Third Street, Chennai",
  nominee1PersonName: "Latha",
  nominee1PersonPhone: "9874561237",
  nominee2PersonName: "Kumar",
  nominee2PersonPhone: "9874561238",
  policyAgreementAccepted: true,
});

/** Every answer this endpoint refuses a submission for the want of. */
const REQUIRED = [
  "firstName", "lastName", "gender", "contactNumber", "emailId", "dateOfJoining", "dateOfBirth",
  "workType", "bloodGroup", "skills", "languagesKnown", "currentAddress", "permanentAddress",
  "qualifications", "fatherName", "fatherOccupation", "motherName", "motherOccupation",
  "maritalStatus", "aadharCardNumber", "panCardNumber", "aadharCardImage", "panCardImage",
  "profilePhoto", "bankName", "bankLocation", "accountNumber", "ifscCode", "emergencyContactName",
  "emergencyContactNumber", "emergencyContactRelationship", "reference1PersonName",
  "reference1PersonPhone", "reference1PersonAddress", "reference2PersonName", "reference2PersonPhone",
  "reference2PersonAddress", "nominee1PersonName", "nominee1PersonPhone", "nominee2PersonName",
  "nominee2PersonPhone", "policyAgreementAccepted",
];

test("a complete submission is accepted", async () => {
  const result = await onboardingSubmissionSchema.safeParseAsync(completeSubmission());
  assert.ok(result.success, `a complete submission was refused: ${JSON.stringify(result.error?.issues)}`);
});

test("every required answer is refused when it is missing", async () => {
  for (const field of REQUIRED) {
    const submission = completeSubmission();
    delete submission[field];
    const result = await onboardingSubmissionSchema.safeParseAsync(submission);
    assert.equal(result.success, false, `${field} was accepted as missing`);
    assert.ok(
      result.error.issues.some((issue) => issue.path[0] === field),
      `${field} was refused, but the complaint did not name it: ${JSON.stringify(result.error.issues)}`,
    );
  }
});

test("every required answer is refused when it is blank", async () => {
  // Not the same test as the one above: the form sends "" for a box somebody cleared rather than
  // leaving the key out, and `.max()` alone would take an empty string happily.
  for (const field of REQUIRED.filter((name) => !["qualifications", "policyAgreementAccepted"].includes(name))) {
    const submission = completeSubmission();
    submission[field] = "";
    assert.equal((await onboardingSubmissionSchema.safeParseAsync(submission)).success, false, `${field} was accepted as blank`);
  }
});

test("at least one qualification is asked for", async () => {
  // Everybody has been to school, so an empty list is a question nobody answered rather than a
  // truthful "none" - and a list holding only the blank row an "Add" click leaves behind arrives
  // here as an empty one, since the form drops those on the way.
  const submission = { ...completeSubmission(), qualifications: [] };
  assert.equal((await onboardingSubmissionSchema.safeParseAsync(submission)).success, false, "an empty qualification list was accepted");
});

test("a fresher can still finish their onboarding", async () => {
  for (const experiences of [undefined, []]) {
    const submission = { ...completeSubmission(), experiences };
    const result = await onboardingSubmissionSchema.safeParseAsync(submission);
    assert.ok(result.success, `a submission with no experience was refused: ${JSON.stringify(result.error?.issues)}`);
  }
});

test("a married candidate with no children can still finish theirs", async () => {
  const submission = { ...completeSubmission(), maritalStatus: "Married", spouseName: "Meena", weddingAnniversary: "2024-02-11", children: [] };
  const result = await onboardingSubmissionSchema.safeParseAsync(submission);
  assert.ok(result.success, `a married submission with no children was refused: ${JSON.stringify(result.error?.issues)}`);
});

test("Company Given Number is optional - most candidates do not have one yet", async () => {
  const submission = completeSubmission();
  delete submission.companyGivenNumber;
  const result = await onboardingSubmissionSchema.safeParseAsync(submission);
  assert.ok(result.success, `a submission with no company given number was refused: ${JSON.stringify(result.error?.issues)}`);
});

test("Company Given Number is still validated as a phone number when one is given", async () => {
  const submission = { ...completeSubmission(), companyGivenNumber: "not a phone number" };
  const result = await onboardingSubmissionSchema.safeParseAsync(submission);
  assert.equal(result.success, false, "an invalid company given number was accepted");
  assert.ok(result.error.issues.some((issue) => issue.path[0] === "companyGivenNumber"));
});

test("a married candidate is still asked for the two fields the form only shows them", async () => {
  // Unchanged by making the rest of the form required, and worth holding: these two are the one
  // pair whose requirement depends on another answer rather than on the field itself.
  const submission = { ...completeSubmission(), maritalStatus: "Married" };
  const result = await onboardingSubmissionSchema.safeParseAsync(submission);
  assert.equal(result.success, false, "a married submission with no spouse was accepted");
  for (const field of ["spouseName", "weddingAnniversary"]) {
    assert.ok(result.error.issues.some((issue) => issue.path[0] === field), `${field} was not asked for`);
  }
});
