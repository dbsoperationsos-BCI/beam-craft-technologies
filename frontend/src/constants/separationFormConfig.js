/**
 * The form HR fills in to offboard an employee, described as sections of fields for the shared
 * schema-form inputs to draw.
 *
 * Separation Type is the spine: it decides both which fields are asked for and which status the
 * employee is moved to. Only a resignation or a mutual separation begins with the employee handing
 * something in, so the resignation date and letter appear for those two and nowhere else — nobody
 * submits a termination, a layoff or a death.
 */

/** Each type and the status recording it moves the employee to. Mirrors the server's own mapping. */
export const separationTypes = [
  { value: "Resignation", employmentStatus: "Relieved" },
  { value: "Termination", employmentStatus: "Fired" },
  { value: "Layoff", employmentStatus: "Relieved" },
  { value: "Retirement", employmentStatus: "Relieved" },
  { value: "Contract End", employmentStatus: "Relieved" },
  { value: "Absconding", employmentStatus: "Absconded" },
  { value: "Death", employmentStatus: "Relieved" },
  { value: "Mutual Separation", employmentStatus: "Relieved" },
];

export const separationTypeOptions = separationTypes.map((type) => type.value);

export const statusForSeparationType = (type) => separationTypes.find((item) => item.value === type)?.employmentStatus || "";

/** The two types that start with the employee, rather than with HR. */
export const typesWithEmployeeSubmission = ["Resignation", "Mutual Separation"];

const hasSubmission = (values) => typesWithEmployeeSubmission.includes(values.separationType);

/** Reasons that fit each type, so a termination is not offered "Higher Studies". */
export const separationReasonsByType = {
  Resignation: ["Better Opportunity", "Higher Studies", "Relocation", "Personal Reasons", "Health Reasons", "Family Commitments", "Compensation", "Work Environment", "Career Change", "Others"],
  Termination: ["Performance", "Misconduct", "Policy Violation", "Attendance", "Probation Not Cleared", "Others"],
  Layoff: ["Restructuring", "Cost Reduction", "Project Closure", "Client Exit", "Others"],
  Retirement: ["Superannuation", "Early Retirement", "Others"],
  "Contract End": ["Contract Completed", "Contract Not Renewed", "Project Completed", "Others"],
  Absconding: ["Unreported Absence", "Unreachable", "Others"],
  Death: ["Natural Causes", "Accident", "Illness", "Others"],
  "Mutual Separation": ["Mutual Agreement", "Role Redundant", "Health Reasons", "Relocation", "Others"],
};

export const separationFormSections = [
  {
    id: "separation",
    title: "Separation Details",
    fields: [
      {
        name: "separationType",
        label: "Separation Type",
        type: "select",
        required: true,
        options: separationTypeOptions,
        // The reason list belongs to the type, so changing the type cannot leave a reason from the
        // one before it sitting on the record.
        clears: ["separationReason"],
      },
      {
        name: "separationReason",
        label: "Separation Reason",
        type: "select",
        required: true,
        options: (values) => separationReasonsByType[values.separationType] || [],
        props: (values) => ({ disabled: !values.separationType, placeholder: values.separationType ? "Select" : "Choose a separation type first" }),
      },
      { name: "detailedReason", label: "Detailed Reason", type: "textarea", colSpan: 2, props: { rows: 3 } },
    ],
  },
  {
    id: "submission",
    title: "Employee Submission",
    when: hasSubmission,
    fields: [
      { name: "resignationDate", label: "Resignation Date", type: "date", required: true, props: { restriction: "future" } },
      { name: "resignationLetter", label: "Resignation Letter", type: "file", props: { maxFiles: 1, accept: ".pdf,.doc,.docx,.png,.jpg,.jpeg,.webp" } },
    ],
  },
  {
    id: "notice",
    title: "Notice Period",
    fields: [
      { name: "proposedLastWorkingDate", label: "Proposed Last Working Date", type: "date", required: true },
      { name: "noticePeriodRequired", label: "Notice Period Required (days)", props: { type: "number", min: 0, inputMode: "numeric" } },
      { name: "noticePeriodServed", label: "Notice Period Served (days)", props: { type: "number", min: 0, inputMode: "numeric" } },
      { name: "noticePeriodWaived", label: "Notice Period Waived (days)", props: { type: "number", min: 0, inputMode: "numeric" } },
      // Waiving notice needs a reason on the record; asking for one before any is waived does not.
      { name: "waiverReason", label: "Waiver Reason", type: "textarea", colSpan: 2, when: (values) => Number(values.noticePeriodWaived) > 0, props: { rows: 3 } },
      { name: "earlyReleaseRequested", label: "Early release requested by the employee", type: "toggle", colSpan: 2 },
      { name: "earlyReleaseReason", label: "Early Release Reason", type: "textarea", colSpan: 2, when: (values) => Boolean(values.earlyReleaseRequested), props: { rows: 3 } },
    ],
  },
  {
    id: "hr",
    title: "HR Remarks",
    fields: [
      { name: "hrRemarks", label: "HR Remarks", type: "textarea", colSpan: 2, props: { rows: 4, placeholder: "Anything HR wants kept with this separation." } },
    ],
  },
];

export const separationInitialValues = {
  separationType: "",
  separationReason: "",
  detailedReason: "",
  resignationDate: "",
  resignationLetter: [],
  proposedLastWorkingDate: "",
  noticePeriodRequired: "",
  noticePeriodServed: "",
  noticePeriodWaived: "",
  waiverReason: "",
  earlyReleaseRequested: false,
  earlyReleaseReason: "",
  hrRemarks: "",
};
