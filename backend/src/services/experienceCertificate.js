const prisma = require("../config/db");
const { escapeHtml } = require("./emailTemplates");
const { fallbackLogo, logoSource } = require("./payslipPdfService");
const { getBrowser } = require("./quotationPdfService");

/**
 * An employee certificate - experience or employment - as one printable A4 HTML document: the same
 * document the preview in Settings → Employee → Certificate shows, so what is printed is what was
 * previewed. The two share everything but their title and their wording (`CERTIFICATE_KINDS`).
 *
 * The heading is the payslip's (`payslipHeading`): the Global Logo, the studio's name and the head
 * office's address. The HR's e-signature, when one is uploaded, prints above the authorised
 * signatory, and the note, when one is written, closes the letter. Every value is escaped.
 *
 * `employee` fills the letter; left out, it reads as the template, its blanks in brackets - which is
 * what the Settings preview shows.
 */
const TEMPLATE_EMPLOYEE = {
  // Mr. or Ms. by the employee's gender; the template, and an employee with none set, says both.
  title: "Mr./Ms.",
  name: "[Employee Name]",
  // The city of the branch the employee works in (the head office's where they have none).
  location: "[Company Location]",
  designation: "[Designation]",
  department: "[Department]",
  dateOfJoining: "[Date of Joining]",
  lastWorkingDate: "[Last Working Date]",
  duties: "[brief description of duties]",
  signatoryName: "[Authorized Signatory Name]",
  signatoryDesignation: "[Designation / HR Manager]",
};

const longDate = (date) => new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Kolkata" }).format(date);

/*
 * Each certificate's title, the settings it is printed with (columns on `hrm_settings`), and its
 * wording - paragraphs as HTML, built from `person` (the employee, or the template's blanks), the
 * company's name, and `b` / `e` (bold, and plain, both escaped).
 */
const columnsFor = (prefix) => ({
  closing: `${prefix}CertificateClosing`,
  signatureUrl: `${prefix}CertificateSignatureUrl`,
  note: `${prefix}CertificateNote`,
  signatoryName: `${prefix}CertificateSignatoryName`,
  signatoryDesignation: `${prefix}CertificateSignatoryDesignation`,
});
const CERTIFICATE_KINDS = {
  experience: {
    label: "Experience",
    title: "EXPERIENCE CERTIFICATE",
    columns: columnsFor("experience"),
    body: (person, company, b) => [
      `This is to certify that ${b(`${person.title} ${person.name}`)} was employed with ${b(company || "[Company Name]")}, located in ${b(person.location)}, as a ${b(person.designation)} in the ${b(person.department)} from ${b(person.dateOfJoining)} to ${b(person.lastWorkingDate)}.`,
      // Left out altogether when HR gave no summary of duties.
      ...(person.duties ? [`During this period, the employee was responsible for ${b(person.duties)}.`] : []),
      "We appreciate the employee's contributions to the organization and wish them success in their future endeavors.",
    ],
  },
  employment: {
    label: "Employment",
    title: "EMPLOYMENT CERTIFICATE",
    columns: columnsFor("employment"),
    body: (person, company, b) => [
      `This is to certify that ${b(`${person.title} ${person.name}`)} is currently employed with ${b(company || "[Company Name]")}, located in ${b(person.location)}, as a ${b(person.designation)} in the ${b(person.department)} since ${b(person.dateOfJoining)}.`,
      `During the period of employment, ${b(`${person.title} ${person.name}`)} has fulfilled their duties and responsibilities effectively, and their services have been of value to the company.`,
      "This certificate is issued upon the employee's request for official purposes.",
    ],
  },
};

function certificateHtml(kind, { heading = {}, signatureUrl = "", note = "", closing = "", signatoryName = "", signatoryDesignation = "", employee = TEMPLATE_EMPLOYEE, date = new Date() } = {}) {
  const certificate = CERTIFICATE_KINDS[kind];
  if (!certificate) throw new Error(`Unknown certificate: ${kind}`);
  // The signatory as typed in Settings; blank prints the template's bracketed blank.
  const signatory = {
    ...(String(signatoryName || "").trim() ? { signatoryName: String(signatoryName).trim() } : {}),
    ...(String(signatoryDesignation || "").trim() ? { signatoryDesignation: String(signatoryDesignation).trim() } : {}),
  };
  const person = { ...TEMPLATE_EMPLOYEE, ...employee, ...signatory };
  const companyName = String(heading.companyName || "").trim();
  const addressLines = String(heading.address || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const logo = logoSource(heading.logoUrl) || fallbackLogo();
  const signature = logoSource(signatureUrl);
  const text = String(note || "").trim();
  const b = (value) => `<b>${escapeHtml(value)}</b>`;
  const paragraphs = certificate.body(person, companyName, b, escapeHtml);
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${escapeHtml(certificate.label)} Certificate</title>
<style>
  @page { size: A4; margin: 12mm; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #ffffff; font-family: Arial, Helvetica, sans-serif; font-size: 13px; line-height: 1.7; color: #0f172a; }
  .head { text-align: center; padding-bottom: 12px; border-bottom: 1px solid #94a3b8; }
  .head img { max-height: 64px; max-width: 220px; object-fit: contain; }
  .head .name { margin: 8px 0 2px; font-size: 18px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.02em; }
  .head .address { margin: 0; font-size: 11px; color: #475569; line-height: 1.5; }
  h1 { margin: 22px 0 6px; text-align: center; font-size: 15px; font-weight: 700; letter-spacing: 0.04em; }
  .date { text-align: right; margin: 0 0 18px; color: #334155; }
  p { margin: 0 0 12px; }
  .sign { margin-top: 30px; }
  .sign p { margin: 0 0 4px; }
  .sign img { display: block; max-height: 60px; max-width: 200px; object-fit: contain; margin: 6px 0; }
  .sign .space { height: 48px; }
  .note { margin-top: 28px; padding-top: 10px; border-top: 1px solid #cbd5e1; font-size: 11.5px; color: #334155; white-space: pre-line; }
</style></head>
<body>
  <div class="head">
    <img src="${escapeHtml(logo)}" alt="">
    <p class="name">${escapeHtml(companyName)}</p>
    ${addressLines.length ? `<p class="address">${addressLines.map(escapeHtml).join("<br>")}</p>` : ""}
  </div>
  <h1>${escapeHtml(certificate.title)}</h1>
  <p class="date">Date: ${escapeHtml(longDate(date))}</p>
  ${paragraphs.map((paragraph) => `<p>${paragraph}</p>`).join("\n  ")}
  <div class="sign">
    <p>${escapeHtml(closingLine(closing))}</p>
    ${signature ? `<img src="${escapeHtml(signature)}" alt="Signature">` : '<div class="space"></div>'}
    <p>${b(person.signatoryName)}</p>
    <p>${escapeHtml(person.signatoryDesignation)}</p>
    <p>${escapeHtml(companyName)}</p>
  </div>
  ${text ? `<div class="note"><b>Note:</b> ${escapeHtml(text)}</div>` : ""}
</body></html>`;
}

/**
 * Settings → Employee → Certificate → Experience or Employment, as saved: the e-signature, the
 * signatory's name and designation, and the note. Read by the Settings screen and by every
 * certificate generated.
 */
async function certificateSettings(kind, client = prisma) {
  return settingsFromColumns(CERTIFICATE_KINDS[kind].columns, client);
}

/**
 * The sign-off settings - e-signature, note, signatory's name and designation - from the
 * `hrm_settings` columns named, for any document that has them (the Offer Letter's too, which has
 * no note: a column not named reads as empty).
 */
/** The line a document closes with: what Settings typed, or "Sincerely,". */
const closingLine = (closing) => String(closing || "").trim() || "Sincerely,";

async function settingsFromColumns(columns, client = prisma) {
  const row = await client.hrmSettings.findUnique({
    where: { id: "default" },
    select: Object.fromEntries(Object.values(columns).filter(Boolean).map((column) => [column, true])),
  });
  return {
    signatureUrl: row?.[columns.signatureUrl] || null,
    note: row?.[columns.note] || "",
    signatoryName: row?.[columns.signatoryName] || "",
    signatoryDesignation: row?.[columns.signatoryDesignation] || "",
    closing: row?.[columns.closing] || "",
  };
}

// The experience certificate, as Employee Repository → Generate draws it.
const experienceCertificateHtml = (options) => certificateHtml("experience", options);
const experienceCertificateSettings = (client) => certificateSettings("experience", client);

/** Mr. for a man, Ms. for a woman - by the gender on the record - and both where none is set. */
function honorific(gender) {
  const value = String(gender || "").trim().toLowerCase();
  if (value === "male") return "Mr.";
  if (value === "female") return "Ms.";
  return "Mr./Ms.";
}

/** A date on the record (a calendar day stored at midnight UTC) as the certificate says it: "1 June 2025". */
const recordDate = (value) => {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(date);
};

/**
 * Where the employee works, as the certificate says it: the city of their branch, or of the head
 * office where they have no branch (or it has no city). "" when neither is recorded.
 */
async function companyLocation(employee = {}, client = prisma) {
  const branchCity = employee.branchId
    ? (await client.branch.findUnique({ where: { id: employee.branchId }, select: { city: true } }))?.city
    : null;
  if (String(branchCity || "").trim()) return String(branchCity).trim();
  const headOffice = await client.branch.findFirst({ where: { isHeadOffice: true }, select: { city: true } });
  return String(headOffice?.city || "").trim();
}

/**
 * The certificate's employee details from their record and the duties HR typed: name, location (the
 * branch's city, from `companyLocation`), designation,
 * department, joining date and last working date (`dateOfRelieving`). A detail the record does not
 * hold keeps its bracketed blank, so it is plain what is missing rather than printed empty.
 */
// Departments as a sentence says them: "Production", "Production and Editing", "Sales, Production and Editing".
function departmentsText(value) {
  const parts = String(value || "").split(",").map((part) => part.trim()).filter(Boolean);
  return parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : parts[0] || "";
}

function employeeDetails(employee = {}, duties = "", location = "") {
  const filled = (value, blank) => String(value || "").trim() || blank;
  return {
    title: honorific(employee.gender),
    name: filled(employee.employeeName, TEMPLATE_EMPLOYEE.name),
    location: filled(location, TEMPLATE_EMPLOYEE.location),
    designation: filled(employee.designation, TEMPLATE_EMPLOYEE.designation),
    department: filled(departmentsText(employee.department), TEMPLATE_EMPLOYEE.department),
    dateOfJoining: recordDate(employee.dateOfJoining) || TEMPLATE_EMPLOYEE.dateOfJoining,
    lastWorkingDate: recordDate(employee.dateOfRelieving) || TEMPLATE_EMPLOYEE.lastWorkingDate,
    // No blank here: a certificate generated without a summary leaves that line out.
    duties: String(duties || "").trim(),
  };
}

/** Prints a certificate's HTML to an A4 PDF, as the payslip is printed - no script runs on the page. */
async function renderCertificatePdf(html) {
  const instance = await getBrowser();
  const page = await instance.newPage();
  try {
    await page.setJavaScriptEnabled(false);
    await page.setContent(html, { waitUntil: "load", timeout: 30_000 });
    return await page.pdf({ format: "A4", printBackground: true, preferCSSPageSize: true });
  } finally {
    await page.close().catch(() => {});
  }
}

module.exports = {
  CERTIFICATE_KINDS, TEMPLATE_EMPLOYEE, certificateHtml, certificateSettings, closingLine, settingsFromColumns, companyLocation, employeeDetails,
  experienceCertificateHtml, experienceCertificateSettings, honorific, renderCertificatePdf,
};
