const prisma = require("../config/db");
const { payslipHeading } = require("./payslipHeading");
const { settingsFromColumns } = require("./experienceCertificate");
const { OFFER_EMPLOYEE_SELECT, offerCompensation, offerEmployment, offerFromEmployee, offerLetterHtml, offerSectionOrder } = require("./offerLetter");
const { currentSettings: currentPayrollSettings } = require("../modules/hrm/payroll-register/settingsVersions");

/**
 * The offer letter as Settings → Employee → Certificate → Offer Letter sets it up, put together in one
 * place - so the Settings preview and the letter an employee downloads from My Profile are the same
 * document: the sign-off (`OFFER_SIGNOFF_COLUMNS`), the lines of Employment Details and Compensation
 * switched on, the studio's own sections, the payroll's payable day, and when each employee's letter
 * is generated (`offerLetterAfterDays`).
 */

// The Offer Letter's sign-off on `hrm_settings`: the certificates' less their note.
const OFFER_SIGNOFF_COLUMNS = {
  closing: "offerLetterClosing",
  signatureUrl: "offerLetterSignatureUrl",
  signatoryName: "offerLetterSignatoryName",
  signatoryDesignation: "offerLetterSignatoryDesignation",
};

const readSettingsRow = (select, client = prisma) => client.hrmSettings.findUnique({ where: { id: "default" }, select });

/** The offer letter's sections in their order, as saved - the studio's own, and `{ builtin }` where the two built-in ones sit. */
async function readOfferSections(client = prisma) {
  return offerSectionOrder((await readSettingsRow({ offerLetterSections: true }, client))?.offerLetterSections);
}

/** Which of Compensation's lines print, and the Deductions summary. */
async function readOfferCompensation(client = prisma) {
  return offerCompensation((await readSettingsRow({ offerLetterCompensation: true }, client))?.offerLetterCompensation);
}

/** Which of Employment Details' lines print. */
async function readOfferEmployment(client = prisma) {
  return offerEmployment((await readSettingsRow({ offerLetterEmployment: true }, client))?.offerLetterEmployment);
}

/** When an employee's offer letter is generated: days after joining, or null while not set. */
async function offerLetterAfterDays(client = prisma) {
  return (await readSettingsRow({ offerLetterAfterDays: true }, client))?.offerLetterAfterDays ?? null;
}

/** Everything the letter prints that is the studio's, not the employee's: sections, lines, payable day. */
async function offerTemplateOptions(client = prisma) {
  const [sections, employment, compensation, payroll] = await Promise.all([
    readOfferSections(client), readOfferEmployment(client), readOfferCompensation(client), currentPayrollSettings(client),
  ]);
  return { sections, employment, compensation, paybackDay: payroll.paybackDay };
}

const isoDay = (date) => date.toISOString().slice(0, 10);

/**
 * When an employee's letter comes - `afterDays` after their date of joining - and whether it has:
 * `{ status, availableOn }`. NOT_SET: the studio has not said when. NO_JOINING_DATE: the record has
 * none to count from. PENDING: not yet - `availableOn` says when. READY: it can be read and downloaded.
 * Days are counted in India's calendar, as the studio's are.
 */
function offerAvailability(dateOfJoining, afterDays, now = new Date()) {
  if (afterDays === null || afterDays === undefined) return { status: "NOT_SET", availableOn: null };
  if (!dateOfJoining) return { status: "NO_JOINING_DATE", availableOn: null };
  const joined = new Date(dateOfJoining);
  if (Number.isNaN(joined.getTime())) return { status: "NO_JOINING_DATE", availableOn: null };
  const start = new Date(Date.UTC(joined.getUTCFullYear(), joined.getUTCMonth(), joined.getUTCDate()));
  start.setUTCDate(start.getUTCDate() + Number(afterDays));
  const availableOn = isoDay(start);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(now);
  return { status: today >= availableOn ? "READY" : "PENDING", availableOn };
}

/** The employee linked to a login, read for their offer letter - null for a login with none. */
async function offerEmployeeOfUser(userId, client = prisma) {
  const user = await client.user.findUnique({ where: { id: Number(userId) || 0 }, select: { linkedEmployeeId: true } });
  if (!user?.linkedEmployeeId) return null;
  return client.employee.findFirst({ where: { id: user.linkedEmployeeId, archivedAt: null }, select: OFFER_EMPLOYEE_SELECT });
}

/** An employee's own offer letter, filled from their record, as one printable A4 HTML document. */
async function employeeOfferLetterHtml(employee, client = prisma) {
  const [heading, signoff, template] = await Promise.all([payslipHeading(), settingsFromColumns(OFFER_SIGNOFF_COLUMNS, client), offerTemplateOptions(client)]);
  return offerLetterHtml({ heading, ...signoff, ...template, offer: offerFromEmployee(employee) });
}

/**
 * The template as Settings shows it, but with `sections` in place of the saved ones - the letter an
 * import is being edited into, drawn before anything is saved.
 */
async function draftOfferLetterHtml(sections, client = prisma) {
  const [heading, signoff, template] = await Promise.all([payslipHeading(), settingsFromColumns(OFFER_SIGNOFF_COLUMNS, client), offerTemplateOptions(client)]);
  return offerLetterHtml({ heading, ...signoff, ...template, sections });
}

/** "Offer-Letter-Kavya-Raman.pdf". */
const offerLetterFileName = (employee) => `Offer-Letter-${String(employee?.employeeName || "employee").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "employee"}.pdf`;

module.exports = {
  OFFER_SIGNOFF_COLUMNS,
  draftOfferLetterHtml,
  employeeOfferLetterHtml,
  offerAvailability,
  offerEmployeeOfUser,
  offerLetterAfterDays,
  offerLetterFileName,
  offerTemplateOptions,
  readOfferCompensation,
  readOfferEmployment,
  readOfferSections,
};
