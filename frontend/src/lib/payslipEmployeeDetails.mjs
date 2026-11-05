/**
 * Edit Employee → Payslip Details → Personal Details: what a payslip prints about the employee, typed
 * here by HR and printed as typed - nothing is read off the rest of the record. Stored on the employee
 * as one `payslipPersonalDetails` object, each answer held on the form under `payslipPersonalKey(name)`.
 * Free of React so `node --test` can read it.
 *
 * The payslip's other details are not here: PF No., ESI No., EPS No. and UAN are typed by HR in PF
 * Details, Cost Centre is chosen per month on the payroll row, and Residential Status is its own column
 * (`RESIDENTIAL_STATUSES`).
 */

export const RESIDENTIAL_STATUSES = ["Resident", "Non-Resident"];

/** `[name, label, input type]`, in the payslip's own words and order. */
export const PAYSLIP_PERSONAL_FIELDS = [
  ["empCode", "Emp Code", "text"], ["empName", "Emp Name", "text"], ["department", "Department", "text"],
  ["designation", "Designation", "text"], ["location", "Location", "text"], ["dateOfBirth", "Date Of Birth", "date"],
  ["dateOfJoining", "Date of Joining", "date"], ["pan", "PAN", "pan"], ["bankAccount", "Bank A/c No.", "accountNumber"],
];

export const payslipPersonalKey = (name) => `payslipPersonal_${name}`;

/** The stored answers as form values - `""` where nothing has been typed yet. */
export function payslipPersonalForm(stored) {
  return Object.fromEntries(PAYSLIP_PERSONAL_FIELDS.map(([name]) => [payslipPersonalKey(name), stored?.[name] ?? ""]));
}

/** The form's answers in the shape the record stores - null where one is left empty. */
export function payslipPersonalPayload(form = {}) {
  return Object.fromEntries(PAYSLIP_PERSONAL_FIELDS.map(([name]) => [name, String(form[payslipPersonalKey(name)] ?? "").trim() || null]));
}

// Where each of the payslip's own items is kept on the employee record, by the item's own label.
const BUILT_IN_SOURCES = {
  ...Object.fromEntries(PAYSLIP_PERSONAL_FIELDS.map(([name, label]) => [label, (employee) => employee?.payslipPersonalDetails?.[name]])),
  "Residential Status": (employee) => employee?.residentialStatus,
  "PF No.": (employee) => employee?.pfNumber,
  UAN: (employee) => employee?.uanNumber,
  "EPS No.": (employee) => employee?.epsNumber,
  "ESI No.": (employee) => employee?.esiNumber,
};
const PF_ITEMS = new Set(["PF No.", "UAN", "EPS No.", "ESI No."]);
const isEmpty = (value) => value === null || value === undefined || String(value).trim() === "";

/**
 * What Payslip Info still lacks for one employee, by label - every item Settings → Payroll rules →
 * Edit Payslip lists and has on (`listed`, the payslip's own by label; `fields`, the added ones) left
 * empty, the PF ones only while the payslip carries them (`withPf`). Empty when nothing is missing.
 * The Employee Repository's Incomplete Profiles tab lists whoever has any.
 */
export function missingPayslipInfo(employee, { listed = new Set(), fields = [], withPf = true } = {}) {
  const ownItems = Object.entries(BUILT_IN_SOURCES)
    .filter(([label]) => listed.has(label) && (withPf || !PF_ITEMS.has(label)))
    .filter(([, read]) => isEmpty(read(employee)))
    .map(([label]) => label);
  const answers = new Map((employee?.payslipValues || []).map((answer) => [answer.fieldId, answer.value]));
  const added = fields
    .filter((field) => field.shownOnPayslip !== false && (withPf || field.section !== "PF"))
    .filter((field) => isEmpty(answers.get(field.id)))
    .map((field) => field.label);
  return [...ownItems, ...added];
}
