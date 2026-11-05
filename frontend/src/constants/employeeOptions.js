/**
 * The choices an employee record is described with, shared by the HR employee form and the public
 * onboarding form. A candidate picks a work type on the apply page and HR later edits it on the
 * employee record, so both screens have to offer exactly the same values or the two drift apart.
 */

/**
 * The lists HR maintains for itself, from Settings → Field Settings and the Employee Repository's
 * own Settings dialog. Each is an HRM master-data resource, so both screens and the employee form
 * reach them through `services/hrm/master-data.service`. The arrays further down this file are the
 * fallback - what the form offered before these lists lived in the database - and stand in only
 * where a table comes back empty, which is what keeps a database that has not been seeded working
 * exactly as it did.
 *
 * `fields` rather than one field, because one list can answer more than one question: Work Base
 * Location and Current Work Location are the same set of places, and always have been. Four lists
 * were maintained here originally; the rest were arrays in this file that no studio could
 * edit, which is what this now fixes - Blood Group and Languages Known being the last two of
 * them to come across.
 */
export const employeeOptionResources = [
  { resource: "designations", label: "Designations", singular: "Designation", fields: ["designation"] },
  { resource: "departments", label: "Departments", singular: "Department", fields: ["department"] },
  { resource: "verticals", label: "Verticals", singular: "Vertical", fields: ["vertical"] },
  { resource: "skills", label: "Skills", singular: "Skill", fields: ["skills"] },
  { resource: "work-types", label: "Work Types", singular: "Work Type", fields: ["workType"] },
  { resource: "genders", label: "Genders", singular: "Gender", fields: ["gender"] },
  { resource: "marital-statuses", label: "Marital Statuses", singular: "Marital Status", fields: ["maritalStatus"] },
  { resource: "emergency-contact-relationships", label: "Emergency Contact Relationships", singular: "Emergency Contact Relationship", fields: ["emergencyContactRelationship"] },
  // One list, both questions - which is how the form has always offered them.
  { resource: "work-locations", label: "Work Locations", singular: "Work Location", fields: ["workBaseLocation", "currentWorkLocation"] },
  { resource: "blood-groups", label: "Blood Groups", singular: "Blood Group", fields: ["bloodGroup"] },
  // Several to a record, comma separated - the field is a multi-select, and the list behind it
  // is the same one Field Settings edits.
  { resource: "languages", label: "Languages", singular: "Language", fields: ["languagesKnown"] },
];

export const genderOptions = ["Male", "Female", "Other"];

/**
 * The fallback only, like the lists below it: every screen that asks for a blood group reads the
 * `blood-groups` table through `employeeOptionResources` above, and falls back to these eight -
 * what the browser held before the studio could maintain them - when that table comes back empty.
 */
export const bloodGroupOptions = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];

export const maritalStatusOptions = ["Single", "Married", "Other"];

/** Only a married employee is asked for a spouse and a wedding anniversary. */
/**
 * Whether this answer is one that asks for a spouse name and a wedding anniversary.
 *
 * It compared against the literal `"Married"`, so a studio that renamed the option in Settings →
 * Field Settings, or added a second one that also has a spouse, quietly stopped the form asking.
 * The marital status list carries that meaning itself now (`requiresSpouseDetails`), and the second
 * argument is where the form hands it over - `context.spouseRequiringMaritalStatuses` in the schema
 * form, which is also the shape `when(values, context)` is called with.
 *
 * `SPOUSE_REQUIRING_FALLBACK` is what the code used to say, and stands in wherever the list has not
 * arrived: a caller with no context, an unseeded database, a page still loading. So the worst case
 * is the behaviour this replaces rather than a form that stops asking.
 */
export const SPOUSE_REQUIRING_FALLBACK = ["Married"];

export const spouseRequiringStatuses = (context) => {
  const listed = context?.spouseRequiringMaritalStatuses;
  return Array.isArray(listed) && listed.length ? listed : SPOUSE_REQUIRING_FALLBACK;
};

export const isMarried = (values, context) => spouseRequiringStatuses(context)
  .some((name) => String(name).toLocaleLowerCase() === String(values?.maritalStatus || "").toLocaleLowerCase());

export const workTypeOptions = ["Full Time", "Part Time", "Trainee", "Intern"];

/**
 * Who the emergency contact is to the employee.
 *
 * A list rather than a free text box, and for the one reason this field exists: somebody rings this
 * number on the worst day of an employee's career, and "how do you know them" has to be readable at
 * a glance rather than deciphered from whatever was typed at onboarding - `Bro`, `frnd`, `dad's`,
 * blank. It is also the field a candidate fills in themselves, which is exactly where free text goes
 * furthest astray.
 *
 * Wide on purpose. An emergency contact is often not immediate family - a colleague sharing a flat,
 * a guardian, a neighbour - and a list that only offered parents and siblings would push those
 * people onto "Other", which answers nothing. `Other` is last and is the honest escape rather than
 * the common case.
 *
 * Shared by both screens that ask: HR's Employee Registration Details and the public onboarding
 * form. A candidate answers it on the apply page and HR later edits it on the record, so the two
 * have to offer the same values or the record disagrees with the form it came from - which is the
 * whole reason this file exists.
 */
export const emergencyContactRelationshipOptions = [
  "Father", "Mother", "Husband", "Wife", "Son", "Daughter", "Brother", "Sister",
  "Grandfather", "Grandmother", "Father-in-law", "Mother-in-law", "Brother-in-law", "Sister-in-law",
  "Uncle", "Aunt", "Cousin", "Nephew", "Niece",
  "Guardian", "Friend", "Colleague", "Neighbour", "Other",
];

/**
 * The fallback only. Every screen that offers a designation reads the `designation` table through
 * `employeeOptionResources` above and uses this list only when that table comes back empty - so a
 * role added here and nowhere else appears on no screen the studio actually uses. Add it to both:
 * here, and as a row (see `20260909150000_add_production_manager_and_branch_partner`).
 */
export const designationOptions = [
  "Founder", "Co-Founder", "Branch Partner", "Director Operations", "Team Leader", "Data Manager",
  "Sr. Business Development Manager", "Business Development Associate", "Accounts Coordinator",
  "Sr. Creative Specialist", "Creative Specialist", "Post Production Manager",
  "Post Production Coordinator", "Post Production Executive", "Pre Production Coordinator",
  "Production Manager", "Production Coordinator", "Customer Relationship Manager",
  "Office Assistant", "Office Assistant + Sales", "Technical", "Technical - Videographer",
  "Videographer", "Photographer", "Shoot Assist", "Editor", "Designer", "HR Executive", "Admin",
  "Others",
];

export const departmentOptions = [
  "Management", "Operations", "Human Resource", "Pre Production", "Production", "Post Production",
  "Technical", "Sales", "Accounts", "Data Management", "Administration", "Non Technical",
  "Temporary", "Training", "Others",
];

export const verticalOptions = ["Dum Dum", "Qua Qua", "Corp", "Team 33", "General"];

/** Shared by Work Base Location and Current Work Location, which pick from the same places. */
export const workLocationOptions = [
  "Erode TN", "Tiruppur TN", "Coimbatore TN", "Bangalore KA", "Hyderabad TL", "Visakhapatnam AP",
  "Remote", "Work From Home", "On Field", "Others",
];

export const skillOptions = [
  "Photography", "Videography", "Candid Photography", "Candid Videography", "Drone", "Editing",
  "Retouching", "Album Designing", "Album Printing", "Client Handling", "Sales", "CRM",
  "Pre Production Coordination", "Production Coordination", "Post Production Coordination",
  "Data Management", "Accounts", "WhatsApp Coordination", "Customer Support", "Graphic Design",
  "AI Retouch", "Studio Operations", "Outdoor Shoot", "Indoor Shoot", "Others",
];

/** The fallback only - the `languages` table is what the form actually offers. See above. */
export const languageOptions = [
  "English", "Tamil", "Telugu", "Kannada", "Malayalam", "Hindi", "Marathi", "Bengali", "Gujarati",
  "Punjabi", "Urdu", "Odia", "Assamese", "Sanskrit", "Konkani", "Manipuri", "Nepali",
];
