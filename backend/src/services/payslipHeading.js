const prisma = require("../config/db");
const { createSettingsService } = require("../modules/image-selection/settings/service");

/**
 * A payslip's heading - the logo, the company's name and its address - taken from where the studio
 * already keeps them, rather than typed again for payslips:
 *
 * - **logo and name**: the Global Logo in Settings → Organization → Branding Logo (its light-theme
 *   file - a payslip prints on white paper) and the Studio Name beside it; with no logo uploaded the
 *   payslip prints the app's default mark;
 * - **address**: the branch marked Head Office in Settings → Organization → Branches, one line to a
 *   row as the payslip prints it - the main address line, city with PIN code, and state; the optional
 *   second address line is left off.
 *
 * Read live, so a change in either place shows on the next payslip. `""` where the studio has not
 * set one yet; `headOfficeName` is null when no branch is marked Head Office.
 */

const branding = createSettingsService();

const HEAD_OFFICE_SELECT = { name: true, addressLine1: true, city: true, state: true, postalCode: true };

/** A branch's postal address as printed lines: the main address line, "City - 638001", then the state. */
function postalLines(branch) {
  if (!branch) return [];
  const clean = (value) => String(value || "").trim();
  const cityLine = [clean(branch.city), clean(branch.postalCode)].filter(Boolean).join(" - ");
  return [clean(branch.addressLine1), cityLine, clean(branch.state)].filter(Boolean);
}

async function payslipHeading({ client = prisma, reader = branding } = {}) {
  const [settings, headOffice] = await Promise.all([
    reader.read(),
    client.branch.findFirst({ where: { isHeadOffice: true }, select: HEAD_OFFICE_SELECT }),
  ]);
  return {
    companyName: String(settings?.studioName || "").trim(),
    logoUrl: settings?.galleryLogoUrl || "",
    address: postalLines(headOffice).join("\n"),
    headOfficeName: headOffice?.name || null,
  };
}

/**
 * Which of the employee's details a payslip carries (Settings → Template Settings): `PERSONAL` - the
 * personal details alone - or `PERSONAL_AND_PF`, with PF No., ESI No., EPS No. and UAN. Both until
 * the studio says otherwise.
 */
const PAYSLIP_DETAILS = ["PERSONAL", "PERSONAL_AND_PF"];
async function payslipDetails({ client = prisma } = {}) {
  const row = await client.hrmSettings.findUnique({ where: { id: "default" }, select: { payslipDetails: true } });
  return PAYSLIP_DETAILS.includes(row?.payslipDetails) ? row.payslipDetails : "PERSONAL_AND_PF";
}

/** How many days after its payable date a payslip is generated (0-30), or null - once its pay cycle ends. */
async function payslipGenerateDaysAfter({ client = prisma } = {}) {
  const row = await client.hrmSettings.findUnique({ where: { id: "default" }, select: { payslipGenerateDaysAfter: true } });
  const raw = row?.payslipGenerateDaysAfter;
  const value = Number(raw);
  return raw !== null && raw !== undefined && Number.isInteger(value) && value >= 0 && value <= 30 ? value : null;
}

/**
 * The day a payroll month's payslip is generated, `YYYY-MM-DD`: `daysAfter` days after its payable date
 * (`YYYY-MM-DD`) - the payable date itself for 0. Null where no number of days is set.
 */
function payslipGenerateDate(payableOn, daysAfter) {
  if (daysAfter === null || daysAfter === undefined || !payableOn) return null;
  const date = new Date(`${payableOn}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + Number(daysAfter));
  return date.toISOString().slice(0, 10);
}

module.exports = { PAYSLIP_DETAILS, payslipDetails, payslipGenerateDaysAfter, payslipGenerateDate, payslipHeading, postalLines };
