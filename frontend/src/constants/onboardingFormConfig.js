/**
 * The public onboarding form a candidate fills in from an invite link, described as sections of
 * fields for the shared schema-form inputs to draw.
 *
 * The order runs from what the candidate knows without looking anything up to what they have to
 * fetch a document for: who they are, how to reach them and when they start, their family, then
 * their identity proofs and bank details, and last the three lists of other people — who to call in
 * an emergency, who will vouch for them, and who to pay out to.
 */

// Explicit extensions: this module is read directly by the tests, which resolve as plain
// Node ESM rather than through the bundler.
/*
 * Six of this form's lists - gender, work type, marital status, the emergency contact
 * relationship, blood group and the languages - are the studio's own, maintained in
 * Settings → Field Settings, and are named here as keys into `context.options` rather than
 * imported as arrays. The page fills that from the invite it loads, because a candidate has no
 * session to read the master data with; the arrays in `employeeOptions` remain as the fallback
 * it uses when the server sends none.
 */
import { isMarried } from "./employeeOptions.js";
import { employeeDetailLists, filledDetailRows } from "./employeeDetailFields.js";
import { latestDateOfBirth } from "./fieldValidation.js";

/**
 * Identity, bank and account numbers are typed straight into the employee record, which validates
 * them strictly, so the form only ever accepts characters that record would accept.
 */
export const fieldNormalizers = {
  aadharCardNumber: (value) => String(value || "").replace(/\D/g, "").slice(0, 12),
  panCardNumber: (value) => String(value || "").replace(/[^a-z0-9]/gi, "").toUpperCase().slice(0, 10),
  ifscCode: (value) => String(value || "").replace(/[^a-z0-9]/gi, "").toUpperCase().slice(0, 11),
  accountNumber: (value) => String(value || "").replace(/\D/g, "").slice(0, 18),
  contactNumber: (value) => String(value || "").replace(/[^\d+\s-]/g, "").slice(0, 20),
  emergencyContactNumber: (value) => String(value || "").replace(/[^\d+\s-]/g, "").slice(0, 20),
  reference1PersonPhone: (value) => String(value || "").replace(/[^\d+\s-]/g, "").slice(0, 20),
  reference2PersonPhone: (value) => String(value || "").replace(/[^\d+\s-]/g, "").slice(0, 20),
  nominee1PersonPhone: (value) => String(value || "").replace(/[^\d+\s-]/g, "").slice(0, 20),
  nominee2PersonPhone: (value) => String(value || "").replace(/[^\d+\s-]/g, "").slice(0, 20),
};

export const onboardingFormSections = [
  {
    id: "personal",
    title: "Personal Details",
    fields: [
      /*
       * Required, like the two identity proofs below it.
       *
       * The studio puts a face to every record — the repository, the org chart and the top bar all
       * read it — and a photograph is far harder to collect after the fact than during the one
       * sitting where somebody is filling in everything else about themselves.
       */
      { name: "profilePhoto", label: "Profile Photo", type: "image", required: true, colSpan: 2 },
      { name: "firstName", label: "First Name", required: true },
      { name: "lastName", label: "Last Name", required: true },
      { name: "gender", label: "Gender", type: "select", required: true, options: "genders" },
      /*
       * The studio does not take anybody on under eighteen, so the calendar stops at the last day
       * that still leaves the candidate that age. `props` is read at render time rather than at
       * import, so a form left open overnight does not keep yesterday's boundary, and the form's
       * own check says why if an out-of-range date arrives any other way.
       */
      { name: "dateOfBirth", label: "Date Of Birth", type: "date", required: true, props: () => ({ restriction: "future", maxDate: latestDateOfBirth() }) },
      { name: "contactNumber", label: "Contact Number", type: "phone", required: true },
      { name: "emailId", label: "Personal Email ID", required: true, props: { type: "email" } },
      { name: "dateOfJoining", label: "Date Of Joining", type: "date", required: true },
      { name: "workType", label: "Work Type", type: "select", required: true, options: "workTypes" },
      { name: "bloodGroup", label: "Blood Group", type: "select", required: true, options: "bloodGroups" },
      {
        name: "currentAddress",
        label: "Current Address",
        type: "textarea",
        required: true,
        colSpan: 2,
        derive: (value, values) => values.sameAsCurrentAddress ? { permanentAddress: value } : undefined,
      },
      {
        name: "sameAsCurrentAddress",
        label: "Permanent address is the same as the current address",
        type: "checkbox",
        colSpan: 2,
        derive: (checked, values) => checked ? { permanentAddress: values.currentAddress } : undefined,
      },
      {
        name: "permanentAddress",
        label: "Permanent Address",
        type: "textarea",
        required: true,
        colSpan: 2,
        // Copied from above while the toggle is on, so the two can never disagree.
        props: (values) => ({ disabled: Boolean(values.sameAsCurrentAddress) }),
      },
      // Both tick-lists follow a full-width field, so the row is already broken and the two always
      // land side by side however many fields are added above them.
      // Required like everything else, which for a tick-list means at least one ticked: an empty
      // array reads as unanswered rather than as "none of these".
      { name: "skills", label: "Skills", type: "custom", required: true },
      { name: "languagesKnown", label: "Languages Known", type: "custom", required: true },
    ],
  },
  {
    id: "qualification",
    title: "Qualification & Experience",
    // Two lists rather than two boxes: somebody has a school *and* a degree, and has worked at more
    // than one company. Each is a row of its own so the parts stay separate and answerable \u2014
    // a college, a branch, a year; a company, where it was, how long, and the letter to prove it.
    fields: [
      // At least one row, counted as rows somebody actually filled in rather than rows an "Add"
      // click left behind: everybody has been to school, so a blank list is an unanswered question.
      { name: "qualifications", label: "Qualification Details", type: "custom", required: true, colSpan: 2 },
      // The one list on the form that stays optional, and deliberately: a fresher has no job to
      // list, and asking for one would make this form the reason they cannot be taken on.
      { name: "experiences", label: "Experience Details", type: "custom", colSpan: 2 },
    ],
  },
  {
    id: "family",
    title: "Family Details",
    fields: [
      { name: "fatherName", label: "Father’s Name", required: true },
      { name: "fatherOccupation", label: "Father’s Occupation", required: true },
      { name: "motherName", label: "Mother’s Name", required: true },
      { name: "motherOccupation", label: "Mother’s Occupation", required: true },
      // Asked before the two it decides, and clearing it takes their answers with it so a spouse
      // cannot be left behind on someone who has since said they are single.
      { name: "maritalStatus", label: "Marital Status", type: "select", required: true, options: "maritalStatuses", clears: ["spouseName", "weddingAnniversary", "children"] },
      // Required like the rest of the family, but only of somebody the marital status shows them for.
      { name: "spouseName", label: "Spouse Name", required: true, when: isMarried },
      { name: "weddingAnniversary", label: "Wedding Anniversary", type: "date", required: true, when: isMarried, props: { restriction: "future" } },
      // Asked of a married candidate, never required: plenty of married people have no children,
      // which is why the list opens empty and says so rather than starting with a blank row.
      { name: "children", label: "Children Details", type: "custom", when: isMarried, colSpan: 2 },
    ],
  },
  {
    id: "identity",
    title: "Identity Details",
    fields: [
      { name: "aadharCardNumber", label: "Aadhar Card Number", required: true, props: { inputMode: "numeric", maxLength: 12, placeholder: "12 digits" } },
      { name: "panCardNumber", label: "PAN Card Number", required: true, props: { maxLength: 10, placeholder: "ABCDE1234F" } },
      { name: "aadharCardImage", label: "Aadhar Card Photo", type: "image", required: true },
      { name: "panCardImage", label: "PAN Card Photo", type: "image", required: true },
    ],
  },
  {
    id: "bank",
    title: "Bank Details",
    fields: [
      { name: "bankName", label: "Bank Name", required: true },
      { name: "bankLocation", label: "Bank Location / Address", required: true },
      { name: "accountNumber", label: "Account Number", required: true, props: { inputMode: "numeric", maxLength: 18, placeholder: "9 to 18 digits" } },
      { name: "ifscCode", label: "IFSC Code", required: true, props: { maxLength: 11, placeholder: "SBIN0001234" } },
    ],
  },
  {
    id: "emergency",
    title: "Emergency Contact",
    fields: [
      { name: "emergencyContactName", label: "Emergency Contact Name", required: true },
      { name: "emergencyContactNumber", label: "Emergency Contact Number", type: "phone", required: true },
      { name: "emergencyContactRelationship", label: "Emergency Contact Relationship", type: "combobox", required: true, options: "emergencyContactRelationships" },
    ],
  },
  {
    id: "references",
    title: "References",
    fields: [
      { name: "reference1PersonName", label: "Reference-1 Person’s Name", required: true },
      { name: "reference1PersonPhone", label: "Reference-1 Person’s Phone", type: "phone", required: true },
      { name: "reference1PersonAddress", label: "Reference-1 Person’s Address", type: "textarea", required: true, colSpan: 2 },
      { name: "reference2PersonName", label: "Reference-2 Person’s Name", required: true },
      { name: "reference2PersonPhone", label: "Reference-2 Person’s Phone", type: "phone", required: true },
      { name: "reference2PersonAddress", label: "Reference-2 Person’s Address", type: "textarea", required: true, colSpan: 2 },
    ],
  },
  {
    id: "nominees",
    title: "Nominee Details",
    fields: [
      { name: "nominee1PersonName", label: "Nominee-1 Person’s Name", required: true },
      { name: "nominee1PersonPhone", label: "Nominee-1 Person’s Phone", type: "phone", required: true },
      { name: "nominee2PersonName", label: "Nominee-2 Person’s Name", required: true },
      { name: "nominee2PersonPhone", label: "Nominee-2 Person’s Phone", type: "phone", required: true },
    ],
  },
];

/** The fields the candidate never fills in, and the two the form owns rather than submits. */
export const onboardingInitialValues = {
  ...Object.fromEntries(onboardingFormSections.flatMap((section) => section.fields).map((field) => [field.name, ["toggle", "checkbox"].includes(field.type) ? false : ""])),
  skills: [],
  languagesKnown: [],
  // The three repeating lists, which start empty rather than with a blank row waiting to be filled.
  children: [],
  qualifications: [],
  experiences: [],
  profilePhoto: null,
  aadharCardImage: null,
  panCardImage: null,
  policyAgreementAccepted: false,
};

/** Every field's label, so a validation message can name the field the candidate is looking at. */
export const fieldLabels = Object.fromEntries(onboardingFormSections.flatMap((section) => section.fields).map((field) => [field.name, field.label]));

/** Everything the candidate must answer before the form will submit, in the order it is asked. */
export const requiredOnboardingFields = onboardingFormSections
  .flatMap((section) => section.fields)
  .filter((field) => field.required)
  // The `when` travels with it, so a required field that is currently hidden is not asked for.
  .map((field) => [field.name, field.label, field.when]);

/**
 * What is still unanswered, by label, in the order the form asks for it.
 *
 * Here rather than inside the form for the reason the sections are: it is the rule itself, and a
 * rule the tests can call is a rule that cannot quietly stop holding. Three kinds of answer, since
 * the form holds three kinds of value - a tick is answered when it is ticked, a list when it holds
 * something, and everything else when it is not blank.
 */
export function missingOnboardingFields(values = {}, context = undefined) {
  return requiredOnboardingFields
    /*
     * A field the form is not showing cannot be answered, so it is never counted as missing.
     *
     * `context` travels with the values because that is where the marital status list lives: which
     * answers ask for a spouse is the studio's to decide, and `when` is given both so the check
     * here and the field the form drew agree about whether it was ever on screen.
     */
    .filter(([, , when]) => !when || when(values, context))
    .filter(([name]) => {
      const value = values[name];
      /*
       * A repeating list is counted by the rows somebody actually filled in. An "Add" click leaves
       * a blank row behind and those are dropped on the way to the server, so counting the rows as
       * they stand would let a list holding nothing but a blank row pass as answered and then
       * submit an empty one.
       */
      if (Array.isArray(value)) return !(employeeDetailLists[name] ? filledDetailRows(name, value) : value).length;
      return typeof value === "boolean" ? !value : !String(value ?? "").trim();
    })
    .map(([, label]) => label);
}
