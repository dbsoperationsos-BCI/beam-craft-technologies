"use client";

import { avatarOf } from "@/lib/employeeAvatar.mjs";
import { useEffect, useMemo, useState } from "react";
import SchemaFormPanel from "@/components/schema-form/SchemaFormPanel";
import SchemaFormSection from "@/components/schema-form/SchemaFormSection";
import SchemaFormSectionsBody from "@/components/schema-form/SchemaFormSectionsBody";
import SchemaFormSummary from "@/components/schema-form/SchemaFormSummary";
import SharedComboBoxField from "@/components/shared/ComboBoxField";
import SharedDateField from "@/components/shared/DateField";
import SharedDropdown from "@/components/shared/Dropdown";
import SharedImageUploadField from "@/components/shared/ImageUploadField";
import SharedSearchableMultiSelect from "@/components/shared/SearchableMultiSelect";
// The compact several-answers control: a trigger that opens a portalled menu, as against
// `SearchableMultiSelect`, which is an always-open panel. See `CompactMultiSelectField`.
import SharedMultiSelectField from "@/components/shared/MultiSelectField";
import SharedSelectableOption from "@/components/shared/SelectableOption";
import SharedTextField from "@/components/shared/TextField";
import SharedTextAreaField from "@/components/shared/TextAreaField";
import PhoneField from "@/components/shared/PhoneField";
import FloatingNotice from "@/components/shared/FloatingNotice";
import RepeatableDetailsField, { withRowKey } from "@/components/shared/RepeatableDetailsField";
import { getMasterData } from "@/services/hrm/master-data.service";
import { getPayslipDetailsSetting, updateEmployee } from "@/services/hrm/employees.service";
import { getBuiltInPayslipItems, getPayslipFields } from "@/services/hrm/payslipFields.service";
import { bloodGroupOptions, departmentOptions, designationOptions, emergencyContactRelationshipOptions, employeeOptionResources, genderOptions, isMarried, languageOptions, maritalStatusOptions, skillOptions, verticalOptions, workLocationOptions, workTypeOptions } from "@/constants/employeeOptions";
import { detailListErrors, employeeDetailLists, filledDetailRows } from "@/constants/employeeDetailFields";
import { accountSections, credentialSections, credentialSummary } from "@/constants/employeeCredentialConfig";
import { dateOfBirthError, fieldError, fieldFormatByName, latestDateOfBirth } from "@/constants/fieldValidation";
import { isSpotReview, reviewPayload, reviewTotals } from "@/constants/employeeReviewConfig";
import { defaultNextReviewDate, scheduledReview, syncedNextReviewDate } from "@/lib/employeeReviewSchedule.mjs";
// The record keeps one name; this is the one rule for taking it apart, shared with the login
// username so a person's record and their sign-in name cannot disagree about where it splits.
import { splitEmployeeName as splitName } from "@/lib/employeeName.mjs";
import { PAYSLIP_PERSONAL_FIELDS, RESIDENTIAL_STATUSES, payslipPersonalForm, payslipPersonalKey, payslipPersonalPayload } from "@/lib/payslipEmployeeDetails.mjs";
import { PAYSLIP_INPUT_TYPES as PAYSLIP_INPUT_TYPE_LIST } from "@/lib/payslipTemplate.mjs";
import Dialog from "@/components/ui/Dialog";
import Button from "@/components/shared/Button";
import { workingEmployees } from "@/lib/employmentStatus.mjs";
import { isFieldRequired, isSuperAdminSubject } from "@/lib/employeeRequiredFields.mjs";
import { markedFieldsMessage } from "@/lib/formErrors.mjs";
import AddReviewDialog from "./AddReviewDialog";
import EmployeeReviewTimeline from "./EmployeeReviewTimeline";
import useCredentialForm from "./useCredentialForm";

/**
 * What the studio decides about a hire, as against what the hire told it.
 *
 * These eight were on Personal Details, mixed in among the candidate's own answers - so **Review
 * Employee Details**, whose job is to read a submission, was two thirds a submission and one third
 * a form HR had to fill in. They are on the second page now, above the login, because that is
 * where everything the studio settles already lives: the account, what it may do, who covers the
 * work. Reviewing what somebody sent and deciding what to do about them are two readings, and the
 * rail names them separately.
 *
 * Employment Status, Company Mentioned Name, Next Review Date, Appreciation Details and the two
 * bank extras stayed behind, deliberately: they belong beside the record they qualify rather than
 * beside a login.
 *
 * Held on the *record* form, not the credential one - they are columns on `Employee`, and page
 * two's save writes the record before it writes the account. See the submit handler.
 */
const employmentSection = {
  id: "employment",
  title: "Employment Details",
  fields: [
    // Searchable, all of them: these are the lists long enough to be typed at rather than scrolled -
    // two dozen designations, every branch, and the whole employee register behind Reports To.
    ["designation", "Designation", "select", true, designationOptions, { searchable: true }],
    /*
     * Several, not one. Somebody can belong to Production and Post Production both, and the record
     * held one name - so the second was either lost or written into the first as free text. The
     * same searchable multi-select Skills and Languages Known use, storing the chosen values joined
     * by ", " exactly as those do; the column was widened to match theirs.
     */
    ["department", "Department", "multiselectCompact", true, departmentOptions],
    ["reportsToEmployeeId", "Reports To", "employeeRef", true, undefined, { searchable: true }],
    ["vertical", "Vertical", "select", true, verticalOptions, { searchable: true }],
    ["workBaseLocation", "Work Base Location", "select", true, workLocationOptions, { searchable: true }],
    ["currentWorkLocation", "Current Work Location", "select", true, workLocationOptions, { searchable: true }],
    ["joiningSalary", "Joining Salary", "number", true],
    /*
     * Who referred this hire, and **optional** - which is where it started, and where the studio has
     * asked for it back. It was made required for a while; the note here said to say so if that
     * turned out to be a problem in practice, and it did. Most hires are not referred, so a required
     * field meant every one of them had to be answered with somebody who had not referred them.
     *
     * Nothing downstream needs it: `referredByEmployeeId` is `nullableEmployeeRef` on the endpoint,
     * and `syncEmployeeReferral` reads an empty one as "no referral" and removes any row that was
     * there - refusing only when an instalment against it has already been paid, which is a fact
     * about the studio's cash rather than a field somebody may clear.
     *
     * A picked employee rather than a typed name, like Reports To above it, because the studio pays
     * a bounty for a referral and a payout has to know whose it is. What it is worth is not asked
     * here - the amounts are the studio's, set once in Referrals, and stamped onto the two
     * instalments when this saves.
     */
    ["referredByEmployeeId", "Referred By", "employeeRef", false, undefined, { searchable: true }],
    /*
     * The two dates the studio settles, last and side by side.
     *
     * They were among the candidate's own answers on Personal Details, which is where they read as
     * questions *for the candidate* - and neither is. When somebody joins and when they are next
     * reviewed are decisions the studio takes, so they belong with the designation, the department
     * and the reporting line it takes at the same moment.
     *
     * Last, and as a pair, because they are one answer read together: the second is derived from the
     * first. The section is a two-column grid and there are ten fields, so an even count before them
     * is what puts them on a row of their own - move or add a field above and they separate.
     *
     * Next Review Date still fills itself in six months from the joining date the moment one is
     * entered, and is still editable: the six months is what the studio does, not a rule the form
     * enforces, and a hire taken on mid-cycle is reviewed when their team is. Once reviews exist it
     * stops being typed at all - the latest review's own Next Review Date is the schedule and this
     * follows it, because two separately editable answers to "when is the next review" is two
     * answers that can disagree.
     */
    ["dateOfJoining", "Date of Joining", "date", true],
    ["nextReviewDate", "Next Review Date", "date", true],
  ],
};

// The same order the candidate met on the public onboarding form, so HR reviews a submission in the
// sequence it was filled in. The fields only HR sees sit alongside the ones the candidate answered.
const sectionLinks = [
  ["personal", "Personal Details"], ["qualification", "Qualification & Experience"], ["family", "Family Details"], ["identity", "Identity Details"], ["bank", "Bank Details"], ["emergency", "Emergency Contact"], ["reference", "References"], ["nominee", "Nominee Details"],
];

/*
 * Reviews are an Edit-only page, and the rail says so.
 *
 * Adding somebody and reviewing their onboarding submission are both about taking a person on;
 * neither is a moment at which they have salary reviews to record, and the empty list with its
 * "+ Add Review" was inviting HR to invent history for a hire who had not started. What onboarding
 * needs is the one date — Next Review Date, in Personal Details, six months from joining — and that
 * is what it now asks for. The list appears once there is a record to keep one against.
 */
const REVIEWS_PAGE = "reviews";

/*
 * Payslip Details: an Edit-only page after Employee Preference, for what the employee's payslip
 * prints about them. Its two headings are in place; what goes under them comes later.
 */
const PAYSLIP_PAGE = "payslip";
// One section, Payslip Info: the personal details and the PF details together.
const payslipSectionLinks = [["payslip-info", "Payslip Info"]];
// What PF Details asks: the payslip's PF and ESI numbers, typed by HR - nothing else on the record has them.
const payslipPfFields = [["pfNumber", "PF No.", "pfNumber"], ["uanNumber", "UAN", "uan"], ["epsNumber", "EPS No.", "pfNumber"], ["esiNumber", "ESI No.", "esi"]];
/*
 * What the Payslip Details page requires before it saves: every Personal Detail and Residential Status
 * always, and the four PF details when the payslip carries them (`withPf`) - with personal details
 * only they are not asked for, and their fields are disabled.
 */
// Personal Details: typed here by HR, each required when saving from this page - nothing is filled in from the record.
const payslipPersonalFields = PAYSLIP_PERSONAL_FIELDS.map(([name, label, type]) => [payslipPersonalKey(name), label, type]);
// Only what Edit Payslip lists and has on (`listed`, by the item's own label) is asked for.
const payslipRequiredFields = (withPf, listed) => [
  ...payslipPersonalFields.filter(([, label]) => listed.has(label)).map(([key, label, type]) => [key, label, type, true]),
  ...(listed.has("Residential Status") ? [["residentialStatus", "Residential Status", "select", true]] : []),
  ...(withPf ? payslipPfFields.filter(([, label]) => listed.has(label)).map(([key, label, type]) => [key, label, type, true]) : []),
];
const payslipSectionByField = {
  residentialStatus: "payslip-info",
  ...Object.fromEntries(payslipPersonalFields.map(([key]) => [key, "payslip-info"])),
  ...Object.fromEntries(payslipPfFields.map(([key]) => [key, "payslip-info"])),
};
/*
 * The details added in Settings → Payroll rules → Edit Payslip, asked for beside the built-in ones:
 * each answer held on the form under its own key (`payslipKey`) and sent as `payslipValues`. Personal
 * ones are always required; PF ones when the payslip carries the PF details - disabled otherwise.
 */
const payslipKey = (id) => `payslip_${id}`;
const PAYSLIP_INPUT_TYPES = Object.fromEntries(PAYSLIP_INPUT_TYPE_LIST.map((type) => [type.value, type.input]));
const addedPayslipFields = (fields, withPf) => fields.map((field) => [payslipKey(field.id), field.label, PAYSLIP_INPUT_TYPES[field.inputType] || "text", field.section === "PERSONAL" || withPf]);

/*
 * Onboarding is two pages under one rail, not two panels: Review Employee Details, then Login
 * Credentials. Each names its own headings underneath it, so the rail says what is on a page
 * before it is opened and a heading can be reached in one click rather than by opening the page
 * and then hunting down it. Only where credentials could ever follow — Add and Review, both of which lead an
 * employee toward being taken on — so an Edit of somebody already Active keeps the rail it always
 * had, one entry per section of their record, with nothing about a login on it.
 */
const onboardingPageLinks = [
  ["review", "Review Employee Details", sectionLinks],
  ["credentials", "Employee Preference", [[employmentSection.id, employmentSection.title], ...credentialSections.map((section) => [section.id, section.title])]],
];

/*
 * Edit gets the same two pages, and for the same reason the rail was split in the first place: the
 * record and the login are two different things to look at, and a rail that names both says so
 * before either is opened.
 *
 * It was Add and Review only, on the reasoning that those are the moments credentials could follow.
 * That reads an account as something issued once and never looked at again - so an employee taken on
 * before this flow existed had no way to be given one without going round through Administration,
 * and the roles, cover and leave approval recorded beside their login could be read nowhere on the
 * screen that owns the person. The page itself decides which of its two jobs it is doing.
 */
/*
 * Reviews is a page of its own, last, the way Employee Preference is one: the salary history is a
 * different thing to look at from the record, and it was the last heading of a long page where
 * nobody found it. One entry rather than a group of one, since the page has one heading.
 */
const editPageLinks = [
  ["review", "Employee Details", sectionLinks],
  ["credentials", "Employee Preference", [[employmentSection.id, employmentSection.title], ...credentialSections.map((section) => [section.id, section.title])]],
  // One entry rather than a group of one, as Reviews is: the page has the one heading, Payslip Info.
  payslipSectionLinks[0],
  [REVIEWS_PAGE, "Reviews"],
];
const pageLinksFor = (mode) => (mode === "edit" ? editPageLinks : onboardingPageLinks);

/** Which of the two pages a rail entry belongs to. Only children are ever selectable. */
const reviewSectionIds = new Set(sectionLinks.map(([id]) => id));
const payslipSectionIds = new Set(payslipSectionLinks.map(([id]) => id));
const pageForSection = (id) => (id === REVIEWS_PAGE ? REVIEWS_PAGE : payslipSectionIds.has(id) ? PAYSLIP_PAGE : reviewSectionIds.has(id) ? "review" : "credentials");
const firstSectionOf = (pageId) => (pageId === "credentials" ? employmentSection.id : pageId === REVIEWS_PAGE ? REVIEWS_PAGE : pageId === PAYSLIP_PAGE ? payslipSectionLinks[0][0] : sectionLinks[0]?.[0]);

/**
 * Put the chosen heading at the top of the reader's view.
 *
 * The rail reports clicks rather than scrolling once `onSectionSelect` is given, so moving to a
 * heading is this panel's job. Deferred a frame because a click that also changes page is asking
 * for a section that has not been rendered yet.
 */
function scrollToSection(id) {
  if (typeof window === "undefined") return;
  window.requestAnimationFrame(() => {
    document.querySelector(`[data-schema-section="${id}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}


const sections = [
  { id: "personal", title: "Personal Details", fields: [
    // No Employee ID field: it is generated by the server on save and shown in the table afterwards.
    /*
     * The studio takes nobody on under eighteen, so the calendar behind Date of Birth stops at the
     * last day that still leaves them that age — a function, not a value, because this list is
     * built once at import and the boundary moves every midnight.
     */
    ["firstName", "First Name", "text", true], ["lastName", "Last Name", "text", true], ["gender", "Gender", "select", true, genderOptions], ["dateOfBirth", "Date of Birth", "date", false, undefined, () => ({ restriction: "future", maxDate: latestDateOfBirth() })], ["contactNumber", "Mobile Number", "phone", true], ["companyGivenNumber", "Company Given Number", "phone", false], ["emailId", "Personal Email ID", "email", true], ["workType", "Work Type", "select", false, workTypeOptions], ["bloodGroup", "Blood Group", "select", true, bloodGroupOptions],

    ["currentAddress", "Current Address", "textarea", true], ["sameAsCurrent", "Permanent address is the same as the current address", "sameAddress"], ["permanentAddress", "Permanent Address", "textarea", true],
    // Both tick-lists are tall, so they follow a full-width field: whatever is added above them, the
    // row is already broken and the two always land side by side rather than one under the other.
    ["skills", "Skills", "multiselect", false, skillOptions], ["languagesKnown", "Languages Known", "multiselect", false, languageOptions],
  ] },
  // The same two lists the candidate filled in on the public onboarding form, in the same place in
  // the order, so a submission is reviewed in the sequence it was given.
  { id: "qualification", title: "Qualification & Experience", fields: [
    ["qualifications", "Qualification Details", "detailList"], ["experiences", "Experience Details", "detailList"],
  ] },
  { id: "family", title: "Family Details", fields: [
    ["fatherName", "Father’s Name", "text", true], ["fatherOccupation", "Father’s Occupation"], ["motherName", "Mother’s Name", "text", true], ["motherOccupation", "Mother’s Occupation"],
    // Marital status is asked before the three fields it decides, which stay hidden until it says Married.
    ["maritalStatus", "Marital Status", "select", false, maritalStatusOptions], ["spouseName", "Spouse Name"], ["weddingAnniversary", "Wedding Anniversary", "date"],
    // Full width, and last in the section, because it is a list that grows rather than one field.
    ["children", "Children Details", "detailList"],
  ] },
  { id: "identity", title: "Identity Details", fields: [
    ["aadharCardNumber", "Aadhar Card Number", "aadhar", true], ["panCardNumber", "PAN Card Number", "pan", true], ["profilePhotoUrl", "Profile Photo", "image"], ["aadharCardImageUrl", "Aadhar Card Photo", "image"], ["panCardImageUrl", "PAN Card Photo", "image"],
  ] },
  { id: "bank", title: "Bank Details", fields: [
    ["bankName", "Bank Name", "text", true], ["bankLocation", "Bank Location", "text", true], ["accountNumber", "Account Number", "accountNumber", true], ["ifscCode", "IFSC Code", "ifsc", true],
  ] },
  { id: "emergency", title: "Emergency Contact", fields: [
    ["emergencyContactName", "Emergency Contact Name", "text", true], ["emergencyContactNumber", "Emergency Contact Number", "phone", true], ["emergencyContactRelationship", "Emergency Contact Relationship", "combobox", true, emergencyContactRelationshipOptions],
  ] },
  { id: "reference", title: "References", fields: [
    ["reference1PersonName", "Reference Person Name 1", "text", true], ["reference1PersonPhone", "Reference Person Phone Number 1", "phone", true], ["reference1PersonAddress", "Reference Person Address 1", "textarea"], ["reference2PersonName", "Reference Person Name 2"], ["reference2PersonPhone", "Reference Person Phone Number 2", "phone"], ["reference2PersonAddress", "Reference Person Address 2", "textarea"],
  ] },
  { id: "nominee", title: "Nominee Details", fields: [
    ["nominee1PersonName", "Nominee Person Name 1"], ["nominee1PersonPhone", "Nominee Person Phone Number 1", "phone"], ["nominee2PersonName", "Nominee Person Name 2"], ["nominee2PersonPhone", "Nominee Person Phone Number 2", "phone"],
  ] },
];

/*
 * The ⓘ help beside each field's label, by field key. Kept beside the section lists rather than in
 * their tuples, which are positional and would need a slot for it in every row.
 */
const fieldHelp = {
  firstName: "Their given name, spelled as on their ID card.",
  lastName: "Their family name or initial, spelled as on their ID card.",
  gender: "As the employee identifies, kept on their record.",
  dateOfBirth: "As on their ID; the studio takes nobody under eighteen.",
  contactNumber: "Their own mobile number, where the studio reaches them.",
  companyGivenNumber: "The studio phone number given to them for work, if any.",
  emailId: "Their own email address, not the studio one, for personal messages.",
  workType: "Whether they are full time, part time, a trainee or an intern.",
  bloodGroup: "Kept on record in case of a medical emergency.",
  currentAddress: "Where they live now, with house number, street, city and PIN code.",
  sameAsCurrent: "Tick to copy the current address into the permanent address.",
  permanentAddress: "Their home address as on their ID, if different from where they live now.",
  skills: "Tick the work they can do, such as photography, editing or album designing.",
  languagesKnown: "Tick every language they can speak, kept on their record.",
  fatherName: "Their father's full name, as on their ID.",
  fatherOccupation: "What their father does for a living.",
  motherName: "Their mother's full name, as on their ID.",
  motherOccupation: "What their mother does for a living.",
  maritalStatus: "Choosing Married asks for the spouse, anniversary and children.",
  spouseName: "Their husband's or wife's full name.",
  weddingAnniversary: "Their wedding date, so the studio can wish them.",
  aadharCardNumber: "The twelve-digit number on their Aadhaar card.",
  panCardNumber: "The ten-character number on their PAN card, used for tax.",
  profilePhotoUrl: "A clear face photo, shown on their employee record.",
  aadharCardImageUrl: "A clear photo of the Aadhaar card, front side.",
  panCardImageUrl: "A clear photo of the PAN card.",
  bankName: "The bank their salary is paid into.",
  bankLocation: "The branch or city of their bank account.",
  accountNumber: "The salary account number, digits only.",
  ifscCode: "The eleven-character code of their bank branch, from the passbook or cheque.",
  emergencyContactName: "Who the studio should call if something happens to them.",
  emergencyContactNumber: "The phone number to call in an emergency.",
  emergencyContactRelationship: "How that person is related to them; pick one or type your own.",
  reference1PersonName: "Someone who knows their work, such as a past employer.",
  reference1PersonPhone: "The phone number to reach the first reference.",
  reference1PersonAddress: "Where the first reference lives or works, if known.",
  reference2PersonName: "A second person who knows their work, if any.",
  reference2PersonPhone: "The phone number to reach the second reference.",
  reference2PersonAddress: "Where the second reference lives or works, if known.",
  nominee1PersonName: "The person they name as nominee for their benefits.",
  nominee1PersonPhone: "The phone number to reach the first nominee.",
  nominee2PersonName: "A second nominee, if they want one.",
  nominee2PersonPhone: "The phone number to reach the second nominee.",
  designation: "Their job title at the studio.",
  department: "The teams they work in; pick more than one if needed.",
  reportsToEmployeeId: "The manager this employee reports to at work.",
  vertical: "The studio team or brand they work under.",
  workBaseLocation: "The office they are hired for and normally belong to.",
  currentWorkLocation: "Where they are working at present, if not their base.",
  joiningSalary: "Their salary when they join; review increments add to it.",
  referredByEmployeeId: "The employee who referred them, who is paid the referral bonus.",
  dateOfJoining: "Their first working day; the next review date is set six months on.",
  nextReviewDate: "When their next salary review is due.",
  residentialStatus: "Their residential status for tax, printed on the payslip.",
  pfNumber: "Their PF account number, printed on the payslip.",
  uanNumber: "Their twelve-digit Universal Account Number for PF, printed on the payslip.",
  epsNumber: "Their pension scheme number, printed on the payslip.",
  esiNumber: "Their ESI insurance number, printed on the payslip.",
  [payslipPersonalKey("empCode")]: "The employee code printed on the payslip, exactly as typed.",
  [payslipPersonalKey("empName")]: "Their name as the payslip should print it.",
  [payslipPersonalKey("department")]: "The department the payslip should print.",
  [payslipPersonalKey("designation")]: "The designation the payslip should print.",
  [payslipPersonalKey("location")]: "The work location the payslip should print.",
  [payslipPersonalKey("dateOfBirth")]: "The date of birth the payslip should print.",
  [payslipPersonalKey("dateOfJoining")]: "The joining date the payslip should print.",
  [payslipPersonalKey("pan")]: "The PAN number the payslip should print.",
  [payslipPersonalKey("bankAccount")]: "The bank account number the payslip should print.",
};

/** Every field the record form holds, wherever it is drawn. Validation and the labels read this. */
const allSections = [...sections, employmentSection];

// Wider than the fields above: the relieving and review dates are no longer edited here, but an
// existing employee still carries them into the form and back out again on save, and they have to
// make that round trip in the same shape they arrived in. The ten numbered increment dates were
// here for the same reason and are gone with the columns - a salary review is a row of its own now.
const dateFields = new Set(["dateOfBirth", "dateOfJoining", "dateOfRelieving", "lastReviewDate", "nextReviewDate", "weddingAnniversary"]);
const phoneFields = new Set(["contactNumber", "companyGivenNumber", "emergencyContactNumber", "reference1PersonPhone", "reference2PersonPhone", "nominee1PersonPhone", "nominee2PersonPhone"]);

/*
 * Which heading each field sits under, read off the same section list the form is drawn from. This
 * is what lets Save put the first outstanding field in front of the reader — on a form eight headings
 * long, a mark two thousand pixels down the page is a form that says no and never says why.
 */
const sectionByField = { ...Object.fromEntries(allSections.flatMap((section) => section.fields.map(([key]) => [key, section.id]))), ...payslipSectionByField };

function parsePhone(value) {
  const raw = String(value || "").trim();
  const separated = raw.match(/^\s*(\+\d{1,4})[\s-]+(\d{0,10})\s*$/);
  if (separated) return { countryCode: separated[1], number: separated[2] };
  const explicitDigits = raw.replace(/[^\d+]/g, "").match(/^\+(\d+)$/);
  if (explicitDigits) {
    const digits = explicitDigits[1];
    return { countryCode: digits.length > 10 ? `+${digits.slice(0, -10)}` : "+91", number: digits.slice(-10) };
  }
  const digits = raw.replace(/\D/g, "");
  return { countryCode: "+91", number: digits.length > 10 ? digits.slice(-10) : digits.slice(0, 10) };
}

function normalizePhoneValue(value) {
  const { countryCode, number } = parsePhone(value);
  return number ? `${countryCode} ${number}` : "";
}

/** Reviews are held as plain rows with a key of their own, since a new one has no id to be listed by. */
let reviewKeySeed = 0;
const withReviewKey = (review) => ({
  key: review.key || `review-${(reviewKeySeed += 1)}`,
  reviewDate: review.reviewDate ? String(review.reviewDate).slice(0, 10) : "",
  // Named here as well as everywhere else. This rebuilds the row field by field rather than
  // spreading it, so anything not listed is dropped on the way in - a stored mark would come back
  // from the server, be quietly discarded here, and the list would show every review as unjudged.
  outcome: review.outcome || "",
  incrementAmount: review.incrementAmount ?? "",
  nextReviewDate: review.nextReviewDate ? String(review.nextReviewDate).slice(0, 10) : "",
  remarks: review.remarks || "",
});

/** Spouse, anniversary and children only apply to a married employee, so only one is shown or sent them. */
const isFieldVisible = (key, form) => !["spouseName", "weddingAnniversary", "children"].includes(key) || isMarried(form);


function emptyForm(employee) {
  const base = { employmentStatus: "HR Onboarding Pending", sameAsCurrent: false, reviews: [], children: [], qualifications: [], experiences: [], firstName: "", lastName: "" };
  if (!employee) return base;
  const form = Object.fromEntries(Object.entries({ ...base, ...employee }).map(([key, value]) => [key, dateFields.has(key) && value ? new Date(value).toISOString().slice(0, 10) : phoneFields.has(key) ? normalizePhoneValue(value) : value ?? ""]));
  return {
    ...form,
    ...splitName(employee.employeeName),
    /*
     * Six months from joining, for a record that arrived without a review date.
     *
     * The rule already existed in two places - `update` moves this date when the joining date is
     * edited, and `withReviewSchedule` falls back to it when the last review row is deleted - but
     * neither runs on the way *in*, so it only ever appeared once somebody touched the joining date.
     * That was fine while HR typed the joining date themselves. It stopped being fine when the
     * candidate started supplying it: the date is already stored by the time Review Employee opens,
     * nothing changes it, and the field sat empty on a form whose joining date was right there -
     * which is exactly the "empty until I change the date, then it fills" the studio reported.
     *
     * Derived only into an empty field. A stored date is HR's answer, or the latest review's, and
     * both outrank the default - the same rule `syncedNextReviewDate` applies, stated for load.
     */
    nextReviewDate: form.nextReviewDate || defaultNextReviewDate(form.dateOfJoining),
    // The record stores only the two addresses, never the checkbox - so a submission whose
    // permanent address the candidate copied from the current one arrives here checked, the way
    // they filled it in, rather than as two coincidentally equal boxes.
    sameAsCurrent: Boolean(String(employee.currentAddress || "").trim()) && employee.currentAddress === employee.permanentAddress,
    // Personal Details as HR typed them, each under its own key - empty where nothing is typed yet.
    ...payslipPersonalForm(employee.payslipPersonalDetails),
    // The answers to the added payslip details, each under its own key.
    ...Object.fromEntries((employee.payslipValues || []).map((answer) => [payslipKey(answer.fieldId), answer.value])),
    reviews: (employee.reviews || []).map(withReviewKey),
    // Keyed the way the reviews are, and for the same reason: a row the form adds has no id yet,
    // and removing one from the middle of a list by index moves every row below it.
    children: (employee.children || []).map(withRowKey),
    qualifications: (employee.qualifications || []).map(withRowKey),
    // The stored letter is folded back into the one-file shape the upload field holds, so it is
    // shown as an attachment that can be opened rather than as an empty control.
    experiences: (employee.experiences || []).map((experience, index) => withRowKey({
      ...experience,
      attachment: experience.attachmentName ? [{ name: experience.attachmentName, url: experience.attachmentUrl }] : [],
    }, index)),
  };
}

function hasRequiredValue(value) {
  return typeof value === "boolean" ? value : String(value ?? "").trim().length > 0;
}

/**
 * Keyed by field rather than by label, so each problem can be shown on the input it belongs to.
 *
 * A field the form is not showing is skipped: it is cleared on save rather than sent, so asking for
 * it would refuse a record over an answer there is nowhere to give.
 */
function getMissingRequiredFields(form, fields, context = {}) {
  return fields
    .filter(([key, , , required]) => isFieldRequired(key, required, context) && isFieldVisible(key, form) && !hasRequiredValue(form[key]))
    .map(([key]) => key);
}

/**
 * What Save says when it will not save: how many fields are marked, missing and malformed alike.
 *
 * It used to name them ("Fill in Designation, Department and 2 more; check PAN."), which made the
 * reader match names to boxes by hand. Each field now says its own problem under itself, and the
 * scroll goes to the first, so the top says only how many there are.
 */
function describeProblems(missing, invalid) {
  return markedFieldsMessage(new Set([...missing, ...Object.keys(invalid)]).size);
}

/**
 * The same email, phone, Aadhaar, PAN, IFSC and account formats the public onboarding form accepts,
 * so a record cannot pass one screen and fail the other. Phone numbers additionally have to carry the
 * country code here, since that is the shape the record stores.
 */
function getInvalidFields(form) {
  const invalid = {};
  Object.entries(fieldFormatByName).forEach(([key, kind]) => {
    const message = fieldError(kind, form[key]);
    if (message) invalid[key] = message;
  });
  phoneFields.forEach((key) => {
    if (form[key] && !/^\+\d{1,4}\s\d{10}$/.test(form[key]) && !invalid[key]) {
      invalid[key] = "Include the country code, for example +91 9876543210.";
    }
  });
  /*
   * Nobody under eighteen is taken on. The calendar behind the field already refuses those days,
   * so this is for a date that arrived another way — an imported row, a record typed before the
   * rule existed — which is exactly when somebody needs to be told rather than silently allowed.
   */
  const ageProblem = dateOfBirthError(form.dateOfBirth);
  if (ageProblem) invalid.dateOfBirth = ageProblem;
  /*
   * The three repeating lists. A row nobody filled in is dropped on save rather than complained
   * about, so what is left is a row somebody started and did not finish. Each list's problems are
   * the row-keyed object the field draws its own messages from, not a single message — and
   * children are only judged for a married employee, since nobody else is shown that list.
   */
  Object.keys(employeeDetailLists)
    .filter((name) => name !== "children" || isMarried(form))
    .forEach((name) => {
      const problems = detailListErrors(name, form[name]);
      if (Object.keys(problems).length) invalid[name] = problems;
    });
  return invalid;
}

function hasFormChanged(form, originalForm) {
  const keys = new Set([...Object.keys(originalForm), ...Object.keys(form)]);
  return [...keys].some((key) => key !== "sameAsCurrent" && (form[key] ?? "") !== (originalForm[key] ?? ""));
}

export default function EmployeeFormPanel({ employee, employees = [], mode, onClose, onBack, backAriaLabel, onSave, onApprove, onSendBack, saving, error, savedForCredentials, onCredentialsCreated , onCredentialsUpdated, onSaveDetails, autoOpenReview = false}) {
  // Whether this instance can ever reach a Login Credentials page at all - only Add and Review, an
  // employee already Active having nothing left to onboard onto.
  const onboards = mode !== "edit";
  const [originalForm, setOriginalForm] = useState(() => emptyForm(employee));
  const [form, setForm] = useState(() => originalForm);
  // Which of the two onboarding pages is on screen. Only meaningful when `onboards`; Edit ignores
  // it entirely and keeps the section-per-record-part rail it always had.
  const [page, setPage] = useState("review");
  // Which heading the rail is showing as the reader's place. A child of `page`, since the rail's
  // parents are groups that open rather than screens that can be selected.
  const [activeSection, setActiveSection] = useState(() => firstSectionOf("review"));
  // The moment the caller hands back a saved record - Add's first Save, or Review's Approve & Next
  // - this panel moves itself on to Login Credentials rather than waiting to be told to. That is
  // still the flow when Save & Next is used; it is no longer the only way to get there.
  useEffect(() => {
    if (!savedForCredentials) return;
    setPage("credentials");
    setActiveSection(firstSectionOf("credentials"));
  }, [savedForCredentials]);

  /*
   * The rail moves freely between both pages, in either direction, at any time.
   *
   * Login Credentials used to be refused until the employee had been saved, which made the rail a
   * one-way "next" rather than navigation: somebody wanting to see what the second page asked for
   * before committing the first had no way to look. The page is safe to open early - it says
   * "Save the employee details first" and its Create button stays disabled, because there is
   * genuinely nobody yet to create a login for - so refusing the click only hid that from them.
   */
  function goToSection(id) {
    const target = pageForSection(id);
    if (target !== page) setPage(target);
    setActiveSection(id);
    scrollToSection(id);
  }
  /*
   * Whose account the Login Credentials page is about.
   *
   * Onboarding has no employee until Review Employee Details has been saved, which is what
   * `savedForCredentials` is; an Edit is already looking at one.
   */
  const credentialSubject = mode === "edit" ? employee : savedForCredentials;
  // `departmentSignal`: the live department, so the credentials page's WhatsApp Groups re-reads when
  // Employment Details changes it. That field saves on the spot; this is what tells the other page.
  const credentialForm = useCredentialForm(credentialSubject, employees, onCredentialsCreated, { manage: mode === "edit", onUpdated: onCredentialsUpdated, departmentSignal: form.department || "" });

  /*
   * Whether this person is a Super Admin, which is what excuses them from Reports To.
   *
   * Two answers, and either is enough. The **record** carries `isSuperAdmin` from the server - the
   * login's legacy `role` column or the system role named SUPER_ADMIN, whichever they hold - which
   * is the answer for somebody who already has an account. The **credentials page** answers for
   * somebody being made one right now, before any of it has been saved, so an administrator can be
   * created in a single pass rather than refused on a manager they do not have.
   */
  const superAdmin = isSuperAdminSubject(employee, credentialForm.superAdminSelected);
  const requiredContext = useMemo(() => ({ superAdmin }), [superAdmin]);

  // Both jobs of the panel now carry a second page, so the rail and the page switch are no longer
  // onboarding's alone. What stays onboarding's is the footer: Save & Next, and the draft.
  const twoPage = true;
  // Every list in `employeeOptionResources` - designation, department, vertical, skills, work type,
  // gender, marital status, emergency contact relationship and the work locations - is maintained by
  // the studio, in Settings → Field Settings or the repository's own Settings dialog, so they are
  // read fresh each time the form opens. A list that has not been populated, or that cannot be
  // reached, leaves the field on the values it has always offered rather than empty.
  const [managedOptions, setManagedOptions] = useState({});
  useEffect(() => {
    let live = true;
    void Promise.all(employeeOptionResources.map((option) => getMasterData(option.resource, { active: true })
      // One list can answer more than one field - Work Base Location and Current Work Location are
      // the same set of places - so each resource yields an entry per field it fills.
      .then((result) => option.fields.map((field) => [field, (result.data || []).map((record) => record.name)]))
      .catch(() => [])))
      .then((entries) => {
        if (live) setManagedOptions(Object.fromEntries(entries.flat().filter((entry) => entry && entry[1].length)));
      });
    return () => { live = false; };
  }, []);
  const title = twoPage && page === "credentials"
    ? "Employee Preference"
    : page === REVIEWS_PAGE ? "Reviews"
    : page === PAYSLIP_PAGE ? "Payslip Info"
    : mode === "review" ? "Review Employee Details" : employee ? "Edit Employee Details" : "Employee Registration Details";
  /*
   * The fields Save is allowed to complain about: the ones on the page being saved.
   *
   * It was every field of every section, which was harmless only while Employment Details asked
   * nothing required. The moment those became required, **Approve and Next** on Review Employee
   * Details started refusing with "Fill in Designation, Department, Reports To and 6 more" - fields
   * that live on the *next* page and are not on screen to fill in. A form that will not move on
   * until you answer something it is not showing you is a form with no way forward.
   *
   * Each page therefore validates its own: the record pages ask for the record's fields, and the
   * credentials page asks for Employment Details. Nothing is skipped by the split - the employment
   * fields are still required, and the press that writes them is the one that now checks them.
   */
  /*
   * Whether the payslip carries the PF details (Settings → Template Settings) - read for an Edit,
   * the only form with a Payslip Details page. Both until it answers, so nothing is waved through.
   */
  const [payslipWithPf, setPayslipWithPf] = useState(true);
  // The details added in Settings → Payroll rules → Edit Payslip, still offered.
  const [payslipFields, setPayslipFields] = useState([]);
  // The payslip's own items Edit Payslip lists and has on, by label - the only ones asked for here.
  const [payslipListed, setPayslipListed] = useState(() => new Set());
  useEffect(() => {
    if (mode !== "edit") return undefined;
    let live = true;
    getPayslipDetailsSetting()
      .then((response) => { if (live) setPayslipWithPf(response?.data?.details !== "PERSONAL"); })
      .catch(() => {});
    getPayslipFields({ active: true })
      // Only those on in Edit Payslip - one turned off is not printed, so it is not asked for.
      .then((response) => { if (live) setPayslipFields((response?.data || []).filter((field) => field.shownOnPayslip !== false)); })
      .catch(() => {});
    getBuiltInPayslipItems()
      .then((response) => { if (live) setPayslipListed(new Set((response?.data || []).filter((item) => item.shown && !item.deleted).map((item) => item.label))); })
      .catch(() => {});
    return () => { live = false; };
  }, [mode]);
  // The page being saved decides what is checked: Payslip Details adds its own required fields to the record's.
  const fields = useMemo(
    () => (twoPage && page === "credentials"
      ? employmentSection.fields
      // Each field once - Payslip Details' requirement, where it adds one, over the record's own.
      : [...new Map([...sections.flatMap((section) => section.fields), ...(mode === "edit" && page === PAYSLIP_PAGE ? [...payslipRequiredFields(payslipWithPf, payslipListed), ...addedPayslipFields(payslipFields, payslipWithPf)] : [])].map((field) => [field[0], field])).values()]),
    [mode, page, payslipFields, payslipListed, payslipWithPf, twoPage],
  );
  /**
   * Who this employee can be pointed at as their reporting person.
   *
   * Everyone but themselves — reporting to yourself is the shortest possible loop, and refusing it
   * here means the form never offers what the server would only reject. A longer ring (reporting to
   * somebody who already reports to you) cannot be seen from this list, so the server checks that
   * one on save; this is the obvious half, kept out of the way.
   *
   * The employee id is shown beside the name because two people can share one.
   */
  const reportingOptions = useMemo(() => workingEmployees(employees)
    .filter((candidate) => candidate.id !== employee?.id)
    .map((candidate) => ({ label: candidate.employeeId ? `${candidate.employeeName} (${candidate.employeeId})` : candidate.employeeName, value: String(candidate.id), avatar: avatarOf(candidate) })), [employees, employee?.id]);
  const validation = useMemo(() => ({ missing: getMissingRequiredFields(form, fields, requiredContext), invalid: getInvalidFields(form) }), [fields, form, requiredContext]);
  /**
   * Whether anything is still standing between this record and being saved.
   *
   * The button used to be disabled whenever something was, which meant the message naming what was
   * outstanding — built on submit — could never be reached, because a disabled button cannot
   * submit. The form said no and refused to say why. Now Save always tries: if something is
   * missing or malformed it marks those fields and says so, and the button itself only guards what
   * the reader cannot act on — a save already in flight, and an edit that has changed nothing.
   */
  const hasProblems = validation.missing.length > 0 || Object.keys(validation.invalid).length > 0;
  const canSave = !saving && (mode === "add" || hasFormChanged(form, originalForm));
  // Nothing is marked until Save has been pressed: a form should not open covered in complaints
  // about fields nobody has reached yet. After that the marks follow the answers as they are typed.
  const [showProblems, setShowProblems] = useState(false);
  const fieldErrors = useMemo(() => showProblems
    ? { ...Object.fromEntries(validation.missing.map((key) => [key, "Required"])), ...validation.invalid }
    : {}, [showProblems, validation]);
  /*
   * Saying someone is no longer married takes the spouse, the anniversary and the children with it,
   * rather than leaving answers that would reappear if the status were set back.
   *
   * The joining date drags the next review with it in the same way, but only while nobody has
   * chosen their own — `syncedNextReviewDate` decides that, and the whole reason it takes the old
   * joining date as well as the new one is to tell "still the default" from "typed by hand". A
   * correction to the joining date on an onboarding form should move the review; a joining date
   * corrected after HR has set a review date of their own should not take it away from them.
   */
  /*
   * Department is saved the moment it changes, on an employee who already exists.
   *
   * It is the one field on this form another screen reads **before** Save: the credentials page's
   * WhatsApp Groups offers the groups of the employee's departments, and those come from the saved
   * record. Picked here and left unsaved, that box sat empty while somebody had visibly chosen
   * departments a moment earlier - and nothing on either screen said why.
   *
   * Only this field, and only on an edit: a new employee has no id to save against, and their
   * departments go in with the rest when the form is saved. A failure is deliberately quiet - the
   * form's own Save is still coming and will write it again - so a WhatsApp list that has not caught
   * up is never a reason to interrupt somebody filling in an employee.
   */
  function saveDepartmentNow(value) {
    if (!employee?.id) return;
    void updateEmployee(employee.id, { department: value }).catch(() => {});
  }

  function update(key, value) {
    if (key === "department") saveDepartmentNow(value);
    setForm((current) => ({
      ...current,
      [key]: value,
      ...(key === "maritalStatus" && value !== "Married" ? { spouseName: "", weddingAnniversary: "", children: [] } : {}),
      ...(key === "dateOfJoining" ? { nextReviewDate: syncedNextReviewDate({ previousSource: current.dateOfJoining, nextSource: value, currentNext: current.nextReviewDate }) } : {}),
      /*
       * The tick is a standing statement, not a one-off copy.
       *
       * It only copied at the moment it was ticked, so the ordinary way of filling the form — tick
       * the box, then type the address, or correct the address afterwards — left Permanent Address
       * empty or holding the old wording while the box on screen said the two were the same. Save
       * then refused a form whose every starred field the reader had answered, and marked a field
       * they had been told they did not have to fill in. While it is ticked, the two are the same.
       */
      ...(key === "currentAddress" && current.sameAsCurrent ? { permanentAddress: value } : {}),
    }));
  }
  function copyAddress(checked) { setForm((current) => ({ ...current, sameAsCurrent: checked, permanentAddress: checked ? current.currentAddress : current.permanentAddress })); }

  const [reviewDialog, setReviewDialog] = useState(null);
  // Opens on Upcoming: the list is read to find the next review far more often than to read history.
  const reviews = form.reviews || [];
  /*
   * The one date nobody has acted on yet — the employee's own Next Review Date, which follows the
   * latest review or six months from joining. The timeline draws it at its foot.
   *
   * Recomputed per render rather than memoised, because "upcoming" is measured against today and a
   * panel left open across midnight would otherwise keep showing yesterday's answer.
   */
  const upcoming = scheduledReview(form.nextReviewDate);
  /*
   * "Start Review", from the repository row menu: the panel opens the same dialog "Record this
   * review" does, on its own, instead of leaving the reader to find Reviews and press it themselves
   * — the row menu already said what it was asked for.
   *
   * Runs once, on mount, so the dialog does not reopen itself if the reader closes it and keeps
   * working in the rest of the form. There is nothing to open when `upcoming` is empty — nobody
   * offers Start Review on a row with no Next Review Date to be overdue in the first place, but the
   * panel can also be reached directly, so it checks rather than assumes.
   */
  useEffect(() => {
    // `"add"` (the row's Add Review) opens whether or not a review is due; Start Review only when one is.
    if (mode !== "edit" || !autoOpenReview || (autoOpenReview !== "add" && !upcoming)) return;
    // A one-time bootstrap off `autoOpenReview`, not a value this effect keeps in sync with
    // anything that changes afterwards — see the note above.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    goToSection("reviews");
    // Start Review records the review that is due (cyclic, on its date); Add Review opens on a spot one.
    setReviewDialog({ review: null, ...(autoOpenReview !== "add" && upcoming ? { prefill: { reviewDate: upcoming.dueOn } } : {}) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /*
   * The other direction of the same rule: once reviews exist, the employee's Next Review Date is the
   * latest review's, not a separate answer sitting in Personal Details.
   *
   * Kept in step here rather than left to the save, so the field shows what will be stored while the
   * dialog is still open — the server derives exactly this from the rows, and a field that only
   * caught up after a reload would be the form disagreeing with itself in the meantime. With every
   * review deleted it falls back to six months from joining, which is where an employee with no
   * review history stands.
   */
  // Only cyclic reviews set the schedule; with none, the date stands as it was (or six months from joining).
  const withReviewSchedule = (current, reviews) => ({
    ...current,
    reviews,
    nextReviewDate: reviews.some((review) => !isSpotReview(review))
      ? (reviewTotals(reviews, current.joiningSalary).nextReviewDate || "")
      : (current.nextReviewDate || defaultNextReviewDate(current.dateOfJoining)),
  });

  function saveReviews(rows) {
    setForm((current) => {
      const list = current.reviews || [];
      const next = reviewDialog?.review
        ? list.map((item) => item.key === reviewDialog.review.key ? { ...withReviewKey(rows[0]), key: item.key } : item)
        : [...list, ...rows.map(withReviewKey)];
      return withReviewSchedule(current, next);
    });
    setReviewDialog(null);
  }

  function deleteReview(review) {
    setForm((current) => withReviewSchedule(current, (current.reviews || []).filter((item) => item.key !== review.key)));
  }

  function buildPayload() {
    // Counted: the fields carry the detail where they sit, and the scroll goes to the first.
    if (hasProblems) return { error: describeProblems(validation.missing, validation.invalid) };
    const entries = Object.entries(form)
      // Read-only everywhere it's shown, and the server never writes it back on an edit either — so
      // it is never sent. Sending it back unchanged used to fail validation on any employee whose
      // stored id predates the current `DBS-<n>` format (seed and legacy rows), refusing an edit
      // that touched nothing about the id.
      .filter(([key]) => key !== "sameAsCurrent" && key !== "employeeId")
      // The added payslip details go as one `payslipValues` below, never as columns.
      .filter(([key]) => key !== "payslipValues" && !key.startsWith("payslip_"))
      // Personal Details go as one `payslipPersonalDetails` below, never as columns.
      .filter(([key]) => key !== "payslipPersonalDetails" && !key.startsWith("payslipPersonal_"))
      // Sent below in the shape the record stores, without the keys the field tells rows apart by.
      .filter(([key]) => !Object.keys(employeeDetailLists).includes(key))
      // The record has one name column, and the two halves the form asks for are not fields on it.
      .filter(([key]) => key !== "firstName" && key !== "lastName")
      /*
       * The totals are the server's to work out from the reviews, so the form never sends them back.
       *
       * `nextReviewDate` is no longer among them: it is a field HR answers now, and for an employee
       * with no reviews it is the only place the schedule exists. The server still overrules it from
       * the latest review when there are reviews, so sending it cannot put the two out of step.
       */
      .filter(([key]) => !["totalIncrement", "totalSalary", "lastReviewDate"].includes(key))
      // A field the form is not showing is not an answer, so it is cleared rather than left behind.
      .map(([key, value]) => [key, isFieldVisible(key, form) ? (value === "" ? null : value) : null]);
    const payload = Object.fromEntries(entries);
    payload.employeeName = `${form.firstName || ""} ${form.lastName || ""}`.trim();
    // Every added payslip detail's answer - "" clears one - only where Payslip Details is on the form.
    if (mode === "edit") payload.payslipPersonalDetails = payslipPersonalPayload(form);
    if (mode === "edit" && payslipFields.length) payload.payslipValues = Object.fromEntries(payslipFields.map((field) => [field.id, String(form[payslipKey(field.id)] ?? "")]));
    // Through the shared shape, so an amount nobody typed reaches the server as null rather than as
    // `Number("")` — which is 0, and a real increment of zero once it is stored.
    payload.reviews = reviews.map(reviewPayload);
    // The whole of each list, always, so the stored rows are replaced by what is on screen — and an
    // empty one for the children of somebody no longer married, which is how they are cleared with
    // the status. The blank rows an "Add" click leaves behind are dropped rather than saved.
    payload.children = isMarried(form) ? filledDetailRows("children", form.children) : [];
    payload.qualifications = filledDetailRows("qualifications", form.qualifications);
    payload.experiences = filledDetailRows("experiences", form.experiences);
    return { payload };
  }
  /**
   * Mark what is outstanding and go to the first of it.
   *
   * The marks alone were only useful to somebody already looking at the right heading. Eight
   * sections of form scroll well past a screen, so a refusal that leaves the reader where they
   * pressed Save is a refusal they cannot act on.
   */
  function showFirstProblem() {
    setShowProblems(true);
    const first = validation.missing[0] || Object.keys(validation.invalid)[0];
    const added = payslipFields.find((field) => payslipKey(field.id) === first);
    const sectionId = first && (sectionByField[first] || (added && "payslip-info"));
    if (!sectionId) return;
    /*
     * Through `goToSection`, so the page changes with the section.
     *
     * This set the active section and scrolled to it directly, which cannot cross pages: asked for a
     * section belonging to the other one it scrolled to a heading that was not rendered, did nothing
     * visible, and left the reader on the page they pressed from with no sign of what was wrong.
     * Harmless while only the record pages refused, and not harmless now that the credentials page
     * does - a malformed IFSC is refused from a page that does not show Bank Details.
     */
    goToSection(sectionId);
  }
  function submit(event) {
    event.preventDefault();
    if (hasProblems) showFirstProblem();
    const result = buildPayload();
    onSave(result.payload || null, result.error);
  }
  function approve() {
    if (hasProblems) showFirstProblem();
    const result = buildPayload();
    onApprove(result.payload || null, result.error);
  }
  const onCredentialsPage = twoPage && page === "credentials";
  // Edit only: the rail offers the page nowhere else.
  const onReviewsPage = mode === "edit" && page === REVIEWS_PAGE;
  const onPayslipPage = mode === "edit" && page === PAYSLIP_PAGE;

  /*
   * What would be lost by closing, and the question that gets asked before it is.
   *
   * Two pages, two kinds of unsaved work, one question. **Review Employee Details** holds
   * corrections to the record; **Login Credentials** holds a half-made account - the username, the
   * roles, the branch, who covers for this person - which belongs nowhere until the account is
   * created, and used to be thrown away by the × without a word. Both are answered by Save Draft,
   * each saving its own: the record through the same call its own Save Draft button makes, the
   * credentials page into its draft.
   *
   * Edit and Add are here as well as Review, and each was an omission that lost work.
   *
   * The prompt began on Review alone, on the reading that Edit's own footer button says "Discard
   * changes" and so says what it does. The × does not, and Edit is where salary reviews are
   * recorded — a review is added through a dialog that closes with a saved-looking list, while
   * nothing reaches the server until this panel's Update. Somebody who recorded three reviews and
   * closed the panel lost all three without being asked.
   *
   * **Add Employee was excluded on the reasoning that its first page "is not a review of
   * anything".** True, and beside the point: it is the longest form in the application, and a ×
   * pressed halfway through it threw away everything typed without a word. Being new is not a
   * reason to lose the work — it is the case where the most of it is lost, because nothing has ever
   * been saved.
   *
   * What Save draft *does* there differs, and honestly so: an employee that does not exist yet
   * cannot be half-written to the register, so the save is the same one Add Employee's own footer
   * makes and is held to the same required fields. On a form too incomplete to save it names what
   * is missing and the panel stays open with the work still in it - which is the thing that was
   * actually wanted. Discard still discards.
   */
  const recordDirty = ["review", "edit", "add"].includes(mode) && hasFormChanged(form, originalForm);
  const credentialsDirty = twoPage && credentialForm.dirty;
  /*
   * Whether those changes are the kind that can be put down half-finished.
   *
   * Only while the account is still being made. Once it exists there is no draft behind this page -
   * roles and cover are written to a live account by **Save Changes** or not at all - and offering
   * to keep them would have closed the panel on a save that could not happen: `saveDraft` answers
   * false for an account that exists, and the close path reads that as "the save failed, stay
   * open", which is a panel that cannot be shut.
   */
  const credentialsDraftable = credentialsDirty && !credentialForm.managing;
  const hasUnsavedWork = recordDirty || credentialsDirty;
  const [closeRequested, setCloseRequested] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);

  /*
   * The × and the Escape key, which say "leave" without saying what to do with the work.
   *
   * The footer's own **Discard changes** is left alone deliberately: it already says what it does,
   * and asking "are you sure" after somebody pressed the button named for the answer is the kind of
   * confirmation people learn to click through.
   */
  function requestClose() {
    if (!hasUnsavedWork || saving || savingDraft) { onClose(); return; }
    setCloseRequested(true);
  }

  /** Saves whichever page has something to save, then leaves. */
  async function saveDraftAndClose() {
    setSavingDraft(true);
    try {
      // The credentials draft first: saving the record is what closes the panel, through the
      // caller, and a draft still being written when that happens would not finish.
      if (credentialsDraftable && !(await credentialForm.saveDraft())) return;
      setCloseRequested(false);
      if (!recordDirty) { onClose(); return; }
      // The same save the review footer's own Save Draft makes - the record is kept and the
      // submission stays under review - and the caller closes the panel on the strength of it.
      // Marked and shown as the main Save does, so Payslip Info's required fields say so too.
      if (hasProblems) showFirstProblem();
      const result = buildPayload();
      await onSave(result.payload || null, result.error);
    } finally {
      setSavingDraft(false);
    }
  }
  /*
   * One `<form>`, one submit handler - which of the two very different things it does depends on
   * which page is open when it fires, the same way the footer below already has to.
   */
  async function handleSubmit(event) {
    // Reviews are saved one at a time from their own dialog, so this page has nothing to submit.
    if (onReviewsPage || onPayslipPage) { event.preventDefault(); return; }
    if (!onCredentialsPage) { submit(event); return; }
    event.preventDefault();
    /*
     * Employment Details is this page's own, and this is the press that has to have it.
     *
     * Those ten fields were moved here from Personal Details precisely so the page that asks for
     * them is the page that checks them - `fields` above already narrows to them while this page is
     * open, and the note there says "the press that writes them is the one that now checks them".
     * It did not: nothing here read `hasProblems`, so the required marks were an asterisk and
     * nothing behind it. An account could be created for an employee with no Designation,
     * Department, Vertical or Reports To, and the record was written that way.
     *
     * Worse, it was quiet in the ordinary case. The record below is only saved `if (recordDirty)`,
     * so leaving every one of these untouched - which is exactly what happens when nobody fills
     * them in - skipped the record entirely and went straight to creating the login.
     *
     * Refused rather than disabled, the way every other press on this panel refuses: the button
     * stays live and says what is missing, because a dead button cannot explain itself.
     */
    if (hasProblems) {
      // Said out loud - the same line Review Employee Details refuses with. The marks and the scroll
      // answer "where"; on a page whose fields are mostly filled in already, a press that silently
      // moves the view is easy to read as a press that did nothing.
      credentialForm.showError(describeProblems(validation.missing, validation.invalid));
      showFirstProblem();
      return;
    }
    /*
     * Saving the login also saves the record, where the record has been changed.
     *
     * The two pages are one panel and one press, and this press used to write only the page it was
     * standing on: an edit made on Employee Details, then Save Changes over on Login Credentials,
     * wrote the roles and closed - because the credential save closes the panel through its own
     * callback, which is a *programmatic* close and so walks straight past the unsaved-work prompt
     * guarding the × . The details were gone with nothing said.
     *
     * The record goes first, and a refusal stops there: a failure is shown on the page that caused
     * it, with the reader sent back to it, rather than half the press succeeding silently.
     */
    if (recordDirty && onSaveDetails) {
      const result = buildPayload();
      // Reported through the caller exactly as Review Employee Details reports it - `(null, error)`
      // is how this panel has always said "the record will not do" - so there is one place that
      // decides what a refused save looks like.
      const saved = result.payload
        ? await onSaveDetails(result.payload)
        : (await onSaveDetails(null, result.error), false);
      // Sent back to the page that refused: a message about Bank Details is no use read over the
      // roles, and on the credentials page the panel is showing that page's error, not this one.
      if (!saved) { goToSection(firstSectionOf("review")); return; }
      // Written, so the panel stops calling them unsaved - otherwise a credential save that fails
      // afterwards would send the same record again on the next press.
      setOriginalForm(form);
    }
    void credentialForm.submit(event);
  }
  // Nothing left to lose once the record is saved - Close says that plainly instead of Discard
  // changes threatening to undo something that already happened.
  const closeLabel = onboards && savedForCredentials ? "Close" : "Discard changes";
  const isReview = mode === "review";
  /*
   * The three things a reviewer can do with a submission, in the order they are reached for.
   *
   * **Save Draft** is what "Update" was: a review is read over more than one sitting, and the
   * button was named as though it finished something. It keeps the corrections and leaves the
   * submission under review, which is what it always did — only the label was wrong.
   *
   * **Send Back** returns it to the candidate. It is the same act the row menu offers and asks the
   * same confirmation, because it emails them and reopens their form; it is offered only where
   * there is a submission to reopen, so a hand-added employee — who also starts on HR Onboarding
   * Pending, with nothing behind them — does not get a button whose only answer is "nothing to send
   * back".
   *
   * **Approve & Next** is the one that finishes, and it is the only one wearing the primary colour:
   * three blue buttons would have said all three were the thing to press.
   */
  const reviewFooter = <>
    <button type="button" onClick={onClose} className="min-h-10 rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 max-sm:w-full">{closeLabel}</button>
    <button disabled={!canSave} className={isReview
      ? "min-h-10 rounded-md border border-slate-300 px-5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400 max-sm:flex-1"
      : "min-h-10 rounded-md px-5 py-2 text-sm font-medium max-sm:flex-1 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500 enabled:bg-blue-600 enabled:text-white enabled:hover:bg-blue-700"}>
      {saving ? "Saving..." : isReview ? "Save Draft" : employee ? "Update" : onboards ? "Save & Next" : "Save"}
    </button>
    {isReview && onSendBack && employee?.hasOnboardingSubmission && <button type="button" disabled={saving} onClick={() => onSendBack(employee)} className="min-h-10 rounded-md border border-amber-300 bg-amber-50 px-5 py-2 text-sm font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-60 max-sm:flex-1">Send Back</button>}
    {isReview && <button type="button" disabled={saving} onClick={approve} className="min-h-10 rounded-md bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60 max-sm:flex-1">Approve &amp; Next</button>}
  </>;
  /*
   * Nothing on the Reviews page is its own to save - each review is written from its own dialog the
   * moment it is pressed - but Employee Details or Employee Preference can still be sitting on an
   * edit made before the reader switched pages, same as if they had never left. Save here is that
   * same save, `saveDraftAndClose` - the one the unsaved-work dialog's own Save/Save draft button
   * already makes - so leaving from Reviews cannot quietly lose it. Discard says what it does and
   * acts on it directly, the way the credentials page's own Discard changes does, rather than
   * asking "are you sure" a second time after the button already named the answer.
   */
  const reviewsFooter = <>
    <button type="button" onClick={onClose} className="min-h-10 rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 max-sm:w-full">Discard</button>
    <button type="button" disabled={!hasUnsavedWork || savingDraft} onClick={() => void saveDraftAndClose()} className="min-h-10 rounded-md px-5 py-2 text-sm font-medium max-sm:flex-1 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500 enabled:bg-blue-600 enabled:text-white enabled:hover:bg-blue-700">{savingDraft ? "Saving..." : "Save"}</button>
  </>;
  const credentialsFooter = credentialForm.result
    ? <button type="button" onClick={onClose} className="min-h-10 rounded-md bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700 max-sm:w-full">Close</button>
    : <>
      {/*
        * "Back to the details" while nothing is saved yet: this page was opened to be read, and
        * leaving the panel entirely would throw away the form still being filled in above.
        *
        * Once the employee is saved there is no button on this side at all. There was a
        * "Skip for now" here, and creating the login is the point of the page — an offer to walk
        * past it, sitting where the eye goes first, invited exactly that. Nothing is trapped by
        * dropping it: the panel's own × still closes the page, the employee is already saved by
        * then, and the ⋮ on their row opens this same form whenever the login is picked up again.
        */}
      {!credentialForm.ready && <button type="button" onClick={() => goToSection(firstSectionOf("review"))} className="min-h-10 rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 max-sm:w-full">Back to details</button>}
      {/*
        * The same pair Review Employee Details ends on, because this page holds the same kind of
        * unfinished work: what has been chosen, with nowhere to live until the account is created.
        *
        * Only once there is an employee to attach one to. Before that the page is being read rather
        * than filled in - there is no record to hang a draft off - and the Back to details button
        * above is the only thing to press.
        */}
      {/* Nothing to keep as a draft once the account exists: the page saves or it does not. */}
      {credentialForm.ready && !credentialForm.managing && <>
        <button type="button" onClick={onClose} className="min-h-10 rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 max-sm:w-full">Discard changes</button>
        {/* Enabled only where there is something to keep: a page still reading exactly as it was
            proposed has nothing to save, and a button offering to save it says otherwise. */}
        <button type="button" disabled={!credentialForm.dirty || credentialForm.saving || credentialForm.loading} onClick={() => void credentialForm.saveDraft()} className="min-h-10 rounded-md border border-slate-300 px-5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400 max-sm:flex-1">Save Draft</button>
      </>}
      {/* Disabled rather than absent, and that is the difference between a permission and a
          sequence: this is not something the reader may never do, it is something there is not yet
          anybody to do it for. `submit` already refuses when nothing is saved, which left the
          button looking live and answering with nothing at all. */}
      <button disabled={!credentialForm.ready || credentialForm.saving || credentialForm.loading} className="min-h-10 rounded-md px-5 py-2 text-sm font-medium max-sm:flex-1 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500 enabled:bg-blue-600 enabled:text-white enabled:hover:bg-blue-700">{credentialForm.managing ? (credentialForm.saving ? "Saving..." : recordDirty ? "Save All Changes" : "Save Changes") : (credentialForm.saving ? "Creating..." : "Create User & Send Email")}</button>
    </>;
  return (<>
    <SchemaFormPanel
      title={title}
      description={onCredentialsPage
        ? "The account this employee signs in with, what it may do, and who covers for them."
        : onReviewsPage ? "Salary reviews recorded against this employee."
        : onPayslipPage ? "What this employee's payslip shows about them."
          : "Create a complete employee record for DBS operations."}
      sections={pageLinksFor(mode)}
      activeSectionId={activeSection}
      onSectionSelect={goToSection}
      sidebarAriaLabel={onboards ? "Onboarding pages" : "Employee pages"}
      closeAriaLabel="Close employee form"
      onClose={requestClose}
      onBack={onBack}
      backAriaLabel={backAriaLabel}
      onSubmit={handleSubmit}
      error={onCredentialsPage ? credentialForm.error : error}
      loading={onCredentialsPage && credentialForm.loading}
      loadingLabel="Loading branches and roles..."
      footer={onCredentialsPage ? credentialsFooter : onReviewsPage || onPayslipPage ? reviewsFooter : reviewFooter}
    >
      {!onCredentialsPage && !onReviewsPage && !onPayslipPage && sections.map((section) => <SchemaFormSection id={section.id} key={section.id} title={section.title}><div className="grid gap-4 md:grid-cols-2">{section.fields.filter(([key]) => isFieldVisible(key, form)).map(([key, label, type = "text", required, options, props]) => <FormField key={key} label={label} helperText={fieldHelp[key]} field={key} type={type} required={isFieldRequired(key, required, requiredContext)} error={fieldErrors[key]} options={managedOptions[key] || (["reportsToEmployeeId", "referredByEmployeeId"].includes(key) ? reportingOptions : options)} props={props} value={form[key]} onChange={update} onCopyAddress={copyAddress} disabled={key === "nextReviewDate" && reviews.length > 0} />)}</div></SchemaFormSection>)}

      {/* Edit only, and a page of its own. Adding a person and reviewing their onboarding are not
          moments at which they have salary reviews; onboarding answers the one date it does need —
          Next Review Date, in Personal Details — and the history appears once there is a record to
          keep one against. */}
      {onReviewsPage && <>
        <SchemaFormSection id="reviews" title="Reviews">
          {/* A timeline rather than tabs over a table: the joining salary, every review in the order
              it happened with the salary it left them on, and the next review waiting at the foot.
              Mark review opens the same dialog Add Review does, with the due date already in it. */}
          <EmployeeReviewTimeline
            reviews={reviews}
            // A client's Appreciation (Shine) and Not Satisfied (Shadow), read with the record.
            clientFeedback={employee?.clientFeedback || []}
            joiningDate={form.dateOfJoining}
            joiningSalary={form.joiningSalary}
            upcoming={upcoming}
            onAdd={() => setReviewDialog({ review: null })}
            onMark={() => setReviewDialog({ review: null, prefill: { reviewDate: upcoming.dueOn } })}
            onEdit={(review) => setReviewDialog({ review })}
            onDelete={deleteReview}
          />
        </SchemaFormSection>
      </>}
      {/*
        Edit only. Payslip Info is what the payslip prints about the employee - the personal details
        and then the PF details, in one section - typed here by HR and printed as typed; nothing is
        filled in from the rest of the record. Residential Status is saved with the record.
      */}
      {onPayslipPage && <>
        <SchemaFormSection id="payslip-info" title="Payslip Info">
          <p className="mb-4 text-xs text-slate-500 sm:text-sm">Typed by HR. The payslip prints these as typed here.{payslipWithPf ? "" : " The PF details are off - the payslip carries the personal details only."}</p>
          <div className="grid gap-4 md:grid-cols-2">
            {payslipPersonalFields.filter(([, label]) => payslipListed.has(label)).map(([key, label, type]) => <FormField key={key} label={label} helperText={fieldHelp[key]} field={key} type={type} required error={fieldErrors[key]} value={form[key]} onChange={update} />)}
            {payslipListed.has("Residential Status") && <FormField label="Residential Status" helperText={fieldHelp.residentialStatus} field="residentialStatus" type="select" required error={fieldErrors.residentialStatus} options={RESIDENTIAL_STATUSES} value={form.residentialStatus} onChange={update} />}
            {/* Added in Settings → Payroll rules → Edit Payslip. */}
            {payslipFields.filter((field) => field.section === "PERSONAL").map((field) => <FormField key={field.id} label={field.label} helperText="Printed on the payslip exactly as typed here." field={payslipKey(field.id)} type={PAYSLIP_INPUT_TYPES[field.inputType] || "text"} options={field.options} required error={fieldErrors[payslipKey(field.id)]} value={form[payslipKey(field.id)]} onChange={update} />)}
            {/* The PF details, after the personal ones - required when the payslip carries them, disabled otherwise. */}
            {payslipPfFields.filter(([, label]) => payslipListed.has(label)).map(([key, label, type]) => <FormField key={key} label={label} helperText={fieldHelp[key]} field={key} type={type} required={payslipWithPf} disabled={!payslipWithPf} error={fieldErrors[key]} value={form[key]} onChange={update} />)}
            {payslipFields.filter((field) => field.section === "PF").map((field) => <FormField key={field.id} label={field.label} helperText="Printed on the payslip exactly as typed here." field={payslipKey(field.id)} type={PAYSLIP_INPUT_TYPES[field.inputType] || "text"} options={field.options} required={payslipWithPf} disabled={!payslipWithPf} error={fieldErrors[payslipKey(field.id)]} value={form[payslipKey(field.id)]} onChange={update} />)}
          </div>
        </SchemaFormSection>
      </>}
      {/* Reachable on purpose now: the rail opens this page whenever it is asked to, so somebody
          can read what the login step will want before committing the details above. There is no
          employee to attach an account to yet, so it says so rather than offering a form that
          could only fail. */}
      {onCredentialsPage && !credentialForm.ready && <p className="px-4 py-6 text-sm text-slate-600 sm:px-6">
        Save the employee&rsquo;s details first — a login is created against the saved record, so there is nobody to create one for yet.
      </p>}
      {onCredentialsPage && credentialForm.ready && !credentialForm.loading && (credentialForm.result ? <div className="w-full max-w-[1040px] px-4 py-5 sm:px-6">
        <p className={`text-sm leading-6 ${credentialForm.result.emailSent ? "text-emerald-700" : "text-amber-700"}`}>{credentialForm.result.emailSent ? "User created and credential email sent." : credentialForm.result.warning || "User created, but credential email failed."}</p>
        <p className="mt-3 text-sm leading-6 text-slate-600">{credentialForm.result.user?.roles?.length ? `Roles: ${credentialForm.result.user.roles.map((role) => role.name).join(", ")}.` : "No roles were given, so this account cannot do anything yet."}</p>
      </div> : <>
        <FloatingNotice notice={credentialForm.notice} onClose={credentialForm.clearNotice} />
        <div className="w-full max-w-[1040px] px-4 pt-4 sm:px-6 sm:pt-5">
          <SchemaFormSummary items={credentialSummary(credentialSubject || {})} />
        </div>
        {/*
          What the studio decides about this hire, ahead of the login it is about to give them.
          Drawn with the record page's own `FormField` and bound to `form`/`update`, not to the
          credential form: these are columns on the employee, and the press at the bottom of this
          page writes the record before it writes the account - see the submit handler. Being on
          `form` is also what makes an edit here count as unsaved work, so closing asks about it.
        */}
        <SchemaFormSection id={employmentSection.id} title={employmentSection.title}>
          <div className="grid gap-4 md:grid-cols-2">
            {employmentSection.fields.map(([key, label, type = "text", required, options, props]) => <FormField
              key={key}
              label={label}
              helperText={fieldHelp[key]}
              field={key}
              type={type}
              required={isFieldRequired(key, required, requiredContext)}
              error={fieldErrors[key]}
              options={managedOptions[key] || (["reportsToEmployeeId", "referredByEmployeeId"].includes(key) ? reportingOptions : options)}
              props={props}
              value={form[key]}
              onChange={update}
              /*
               * Next Review Date stops being typed once there are reviews - the latest review's own
               * next date is the schedule, and this follows it.
               *
               * The rule came with the field when it moved here from Personal Details, and it had to
               * be brought deliberately: it was written into the loop that renders *that* page, so
               * moving the field alone would have quietly made a derived value editable again, and
               * two editable answers to "when is the next review" is two answers that can disagree.
               */
              disabled={key === "nextReviewDate" && reviews.length > 0}
            />)}
          </div>
        </SchemaFormSection>
        {/* Same four headings either way, so the rail matches. Only the first section differs: an
            account that exists states what it signs in with instead of asking for it. */}
        <SchemaFormSectionsBody sections={credentialForm.managing ? accountSections : credentialSections} values={credentialForm.values} onChange={credentialForm.change} errors={credentialForm.errors} context={credentialForm.context} />
      </>)}
    </SchemaFormPanel>
    {reviewDialog && <AddReviewDialog initialReview={reviewDialog.review} prefill={reviewDialog.prefill} existingReviews={reviews} joiningSalary={form.joiningSalary} scheduledDate={form.nextReviewDate} onClose={() => setReviewDialog(null)} onSave={saveReviews} />}
    {/*
      * Three answers, because closing a half-finished page is a three-answer question and the
      * usual two-button confirmation can only ask it badly. **Save draft** keeps the work and
      * leaves; **Discard** leaves without it; **Keep editing** is the way back, and is also what
      * the × and the Escape key do, so the answer that loses nothing is the one that needs no
      * decision.
      *
      * The message names what is actually unsaved rather than saying "unsaved changes" over a
      * panel with two pages in it - which of the two is the thing somebody needs to know before
      * choosing, and it is the only thing this dialog can tell them that they cannot already see.
      */}
    {closeRequested && <Dialog
      title="You have unsaved work"
      description={recordDirty && credentialsDirty
        ? "This employee's details and the login credentials page have both been changed. Saving keeps each as a draft — nothing is approved and no account is created."
        : recordDirty
          ? (mode === "edit"
            ? "This employee's details have been changed — including any salary reviews recorded, which are only written when the record is saved. Saving keeps them."
            : mode === "add"
              // Not "kept as a draft": there is no record behind this form yet, so saving creates
              // one. Said plainly, because a prompt that promised a draft and then asked for eight
              // more fields would read as a button that does not work.
              ? "This employee has been filled in but not saved. Saving adds them to the register; anything still required will be named rather than saved."
              : "The reviewed details have been changed. Saving keeps them as a draft; the submission stays under review and nobody is approved.")
          : credentialForm.managing
            ? "The roles, cover and leave approval on the Employee Preference page have been changed. There is no draft behind a login that already exists — leaving now discards them, and Save Changes on that page is what keeps them."
            : "The login credentials page has been filled in. Saving keeps it as a draft — no account is created and no email is sent until Create User & Send Email."}
      size="sm"
      // Over the panel it is asking about, the way the review dialog beside it already is: a plain
      // dialog sits below a form panel and would be asked for and never seen.
      layer="dialogOverPanel"
      busy={savingDraft}
      onClose={() => setCloseRequested(false)}
      footer={<>
        <Button type="button" variant="secondary" className="max-sm:flex-1" disabled={savingDraft} onClick={() => { setCloseRequested(false); onClose(); }}>Discard</Button>
        {/* Primary only where it is the one forward-moving button in the footer: with Save draft
            offered as well, two buttons of equal weight leaves a first-time user unable to tell
            which is recommended - and Keep editing does not need the emphasis to compete for
            attention anyway, since it is also what the × and Escape already do (see the note
            above). Without Save draft, Keep editing is the only positive answer left and carries
            the weight alone. */}
        <Button type="button" variant={(recordDirty || credentialsDraftable) ? "secondary" : "primary"} className="max-sm:flex-1" disabled={savingDraft} onClick={() => setCloseRequested(false)}>Keep editing</Button>
        {/* "Save draft" is the right word where the work stays a draft — a submission still under
            review, a login credentials page with no account behind it yet. Editing an employee is
            not a draft of anything: it writes the record.

            Absent when the only unsaved work is on a login that already exists: there is nothing
            this button could save, and one labelled "Save" that closed the panel having kept none
            of it would be worse than not offering it. Discard and Keep editing are the two honest
            answers then, and the page's own Save Changes is the third. */}
        {(recordDirty || credentialsDraftable) && <Button type="button" variant="primary" className="max-sm:flex-1" disabled={savingDraft} onClick={() => void saveDraftAndClose()}>{savingDraft ? "Saving..." : (mode === "edit" && !credentialsDirty) || (mode === "add" && !credentialsDirty) ? "Save" : "Save draft"}</Button>}
      </>}
    />}
  </>
  );
}



/** The record keeps these as one comma-separated string, so the ticked list is joined back up. */
/**
 * Several answers in the space of one field.
 *
 * `SearchableMultiSelect` - what Skills and Languages Known use - draws its search box and its
 * whole tick-list open on the page. That is right for those two, which are the last fields in
 * their section and are given the full width to be tall in. Department sits in a grid of ordinary
 * one-line controls, and the open panel stood about 250px tall in a cell beside Designation,
 * leaving a hole next to it and pushing everything below it down.
 *
 * So this one is the portalled kind: a trigger the size of every other control, opening its list
 * over the form the way `Dropdown` does - the same shape the Roles picker beside it has.
 */
function CompactMultiSelectField({ label, helperText = "", field, options, value, onChange, required = false, error = "" }) {
  const safeOptions = Array.isArray(options) ? options.filter((option) => typeof option === "string") : [];
  const selected = Array.isArray(value) ? value.map((item) => String(item).trim()).filter(Boolean) : String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
  // Something already chosen that has since left the list is still shown, so it can be seen and
  // removed rather than sitting invisibly on the record.
  const listedOptions = [...safeOptions, ...selected.filter((item) => !safeOptions.includes(item))];
  return <SharedMultiSelectField
    label={label}
    helperText={helperText}
    // Threaded through, not defaulted: `SharedMultiSelectField` already draws the rose asterisk, and
    // this wrapper simply was not passing it - so Department was required on save and unmarked on
    // screen, which reads as the form refusing an answer it never asked for.
    required={required}
    // The same reasoning one line further on. The asterisk said Department had to be answered and
    // the refusal named it, but the control itself never reddened - so on a page where every other
    // unanswered field had, Department read as the one that was fine.
    error={error}
    searchable
    options={listedOptions}
    values={selected}
    onChange={(next) => onChange(field, next.join(", "))}
    placeholder={`Select ${label.toLocaleLowerCase()}`}
  />;
}

function MultiSelectField({ label, helperText = "", field, options, value, onChange, required = false, error = "" }) {
  const safeOptions = Array.isArray(options) ? options.filter((option) => typeof option === "string") : [];
  const selected = Array.isArray(value) ? value.map((item) => String(item).trim()).filter(Boolean) : String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
  const noun = label.toLocaleLowerCase();
  // Something already ticked that has since been removed from the list is still shown, so it can be
  // seen and unticked rather than sitting invisibly on the record.
  const listedOptions = [...safeOptions, ...selected.filter((item) => !safeOptions.includes(item))];
  return <SharedSearchableMultiSelect
    // The full width, one below the other: side by side, each long tick-list had half the form.
    className="md:col-span-2"
    label={label}
    helperText={helperText}
    required={required}
    // Optional today, and threaded anyway: the sibling wrapper above went years marking nothing
    // because this one line was missing, and the field that needs it is only ever one config edit
    // away.
    error={error}
    options={listedOptions}
    value={selected}
    onChange={(next) => onChange(field, next.join(", "))}
    placeholder={`Search ${noun}...`}
    emptyText={`No matching ${noun}.`}
    summary={(count) => count ? `${count} selected` : `No ${noun} selected`}
  />;
}

/**
 * A picture picked here arrives as a data URI and is uploaded by the server on save; one that came
 * back with the record is already a link and is handed straight back untouched. A file the field
 * refuses leaves the current picture alone and says why underneath it.
 *
 * There is no Remove on any of them - the profile photograph, the Aadhaar card, the PAN card. An
 * employee record is not a record the studio keeps without those, so emptying one is never the
 * answer; **Replace photo** is, and it is the same single click. This panel is both the Add
 * Employee form and the one HR reviews an Onboarding Pending submission on, so it covers both.
 */
function ImageField({ label, helperText = "", field, value, onChange }) {
  const [error, setError] = useState("");
  return <SharedImageUploadField
    removable={false}
    label={label}
    helperText={helperText}
    value={value || null}
    error={error}
    onChange={(nextValue, nextError) => {
      setError(nextError || "");
      if (!nextError) onChange(field, nextValue || "");
    }}
  />;
}

function normalizeFieldInput(type, value) {
  const raw = String(value || "");
  if (type === "aadhar") return raw.replace(/\D/g, "").slice(0, 12);
  if (type === "pan") return raw.replace(/[^a-z0-9]/gi, "").toUpperCase().slice(0, 10);
  if (type === "ifsc") return raw.replace(/[^a-z0-9]/gi, "").toUpperCase().slice(0, 11);
  if (type === "accountNumber") return raw.replace(/\D/g, "").slice(0, 18);
  if (type === "uan") return raw.replace(/\D/g, "").slice(0, 12);
  if (type === "esi") return raw.replace(/\D/g, "").slice(0, 17);
  if (type === "pfNumber") return raw.replace(/[^a-z0-9/]/gi, "").toUpperCase().slice(0, 30);
  return value;
}

function FormField({ label, helperText = "", field, type, required, error, options, props, value, onChange, onCopyAddress, readOnly, disabled = false }) {
  // The same shared checkbox the public onboarding form uses for this, rather than bare markup.
  if (type === "sameAddress") return <SharedSelectableOption className="md:col-span-2" label={label} helperText={helperText} checked={Boolean(value)} onCheckedChange={onCopyAddress} />;
  // The same lists the public onboarding form draws, from the same descriptions, so a candidate's
  // answers stay editable here. The error is the row-keyed object `detailListErrors()` builds
  // rather than a single message: a problem belongs on the row, and on the field within it.
  if (type === "detailList") return <RepeatableDetailsField className="md:col-span-2" {...employeeDetailLists[field].props} value={value} errors={error && typeof error === "object" ? error : {}} onChange={(next) => onChange(field, next)} />;
  const inputClass = "mt-2 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100";
  if (type === "phone") return <PhoneField label={label} helperText={helperText} field={field} required={required} error={error} value={value} onChange={onChange} />;
  if (type === "multiselect") return <MultiSelectField label={label} helperText={helperText} field={field} required={required} error={error} options={options} value={value} onChange={onChange} />;
  if (type === "multiselectCompact") return <CompactMultiSelectField label={label} helperText={helperText} field={field} required={required} error={error} options={options} value={value} onChange={onChange} />;
  // `select` filters its options down to plain strings and stores the label as the value, which is
  // right for a designation and wrong for a person: what is saved here is an employee id. The
  // options arrive as { label, value } pairs already and are passed straight through.
  // `clearable` on the optional ones: a person named by mistake has to be removable, and until
  // this the menu could only swap them for somebody else. Clearing Referred By is what removes the
  // referral itself — see `syncEmployeeReferral` on the endpoint.
  if (type === "employeeRef") return <SharedDropdown mode="input" label={label} helperText={helperText} required={required} clearable={!required} error={error} placeholder="Select" value={value == null ? "" : String(value)} onChange={(nextValue) => onChange(field, nextValue)} options={Array.isArray(options) ? options : []} {...(typeof props === "function" ? props() : props || {})} />;
  if (type === "image") return <ImageField label={label} helperText={helperText} field={field} value={value} onChange={onChange} />;
  const safeOptions = Array.isArray(options) ? options.filter((option) => typeof option === "string") : [];
  const normalizedValue = ["aadhar", "pan", "ifsc", "accountNumber", "uan", "esi", "pfNumber"].includes(type) ? normalizeFieldInput(type, value) : value || "";
  const selectOptions = safeOptions.includes(value) || !value ? safeOptions : [...safeOptions, value];
  /*
   * `disabled` on a date is for a value the form works out rather than asks for — Next Review Date
   * once the employee has reviews, where the latest review's own next date is the schedule. The
   * field stays on screen showing what will be stored, rather than disappearing and leaving the
   * reader to wonder where the answer went; it just stops being a second place to answer it.
   *
   * A date field's bounds travel with it in the section list, and are read here rather than there
   * because "eighteen years ago" moves every midnight and that list is built once, at import.
   */
  if (type === "date") return <SharedDateField label={label} helperText={helperText} required={required} error={error} disabled={disabled} value={normalizedValue} onChange={(nextValue) => onChange(field, nextValue)} {...(typeof props === "function" ? props() : props || {})} />;
  /*
   * `combobox` is a `select` whose list is a suggestion rather than a rule - pick one of the common
   * answers, or type one nobody listed. `selectOptions` still carries a stored value that is not on
   * the list, which costs nothing here and keeps the two branches reading the same.
   */
  if (type === "combobox") return <SharedComboBoxField label={label} helperText={helperText} required={required} error={error} value={normalizedValue} onChange={(nextValue) => onChange(field, nextValue)} options={selectOptions} />;
  /*
   * A field's own `props` reach the control, which is how `searchable` is set on the few lists long
   * enough to want typing at - the designations, the branches, the employees - without putting a
   * search box over Gender and Blood Group, which are three answers each.
   */
  if (type === "select") return <SharedDropdown mode="input" label={label} helperText={helperText} required={required} clearable={!required} error={error} placeholder="Select" value={normalizedValue} onChange={(nextValue) => onChange(field, nextValue)} options={selectOptions.map((option) => ({ label: option, value: option }))} {...(typeof props === "function" ? props() : props || {})} />;
  if (type !== "textarea" && type !== "checkbox") return <SharedTextField label={label} helperText={helperText} required={required} error={error} disabled={disabled} type={["employeeId", "aadhar", "pan", "ifsc", "accountNumber", "uan", "esi", "pfNumber"].includes(type) ? "text" : type} inputMode={["accountNumber", "uan", "esi"].includes(type) ? "numeric" : undefined} maxLength={{ accountNumber: 18, uan: 12, esi: 17, pfNumber: 30 }[type]} readOnly={readOnly} placeholder={type === "employeeId" ? "Auto-generated on save" : undefined} value={normalizedValue} onChange={(event) => onChange(field, normalizeFieldInput(type, event.target.value))} inputClassName={readOnly ? "bg-slate-50 text-slate-500" : ""} />;
  if (type === "textarea") return <SharedTextAreaField className="md:col-span-2" inputClassName="min-h-24" label={label} helperText={helperText} required={required} error={error} value={value || ""} onChange={(event) => onChange(field, event.target.value)} />;
  return <label className="text-sm font-medium text-slate-700">{label}{required && <span aria-hidden="true" className="ml-0.5 text-rose-500">*</span>}{error && <span className="ml-1 text-xs font-normal text-red-600">{error}</span>}{type === "select" ? <select value={value || ""} onChange={(event) => onChange(field, event.target.value)} className={inputClass}><option value="">Select</option>{selectOptions.map((option) => <option key={option} value={option}>{option}</option>)}</select> : type === "checkbox" ? <span className="mt-2 flex items-center gap-2 text-sm font-normal"><input type="checkbox" checked={Boolean(value)} onChange={(event) => onChange(field, event.target.checked)} />Yes</span> : <input type={type === "employeeId" || type === "aadhar" || type === "pan" || type === "ifsc" || type === "accountNumber" ? "text" : type} inputMode={type === "accountNumber" ? "numeric" : undefined} maxLength={type === "accountNumber" ? 18 : undefined} readOnly={readOnly} placeholder={type === "employeeId" ? "Auto-generated on save" : undefined} value={normalizedValue} onChange={(event) => onChange(field, normalizeFieldInput(type, event.target.value))} className={`${inputClass} ${readOnly ? "bg-slate-50 text-slate-500" : ""}`} />}</label>;
}
