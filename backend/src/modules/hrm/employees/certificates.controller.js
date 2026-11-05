const { z } = require("zod");
const { scopedEmployee, parseId, handleError } = require("./controller");
const { payslipHeading } = require("../../../services/payslipHeading");
const { workingEmployeeStatuses } = require("../../../services/employeeOptionLists");
const {
  CERTIFICATE_KINDS,
  certificateHtml,
  certificateSettings,
  companyLocation,
  employeeDetails,
  renderCertificatePdf,
} = require("../../../services/experienceCertificate");

/**
 * Employee Repository → Administration → ⋮ → Generate → Experience Certificate or Employment
 * Certificate, at `/employees/:id/certificates/:kind`.
 *
 * - **Experience** - for somebody who has left or is leaving: **InActive** (Relieved, Absconded, Long
 *   Leave, Fired) or **Serving Notice** (still working, with a last working date set). Asks for the
 *   brief summary of their duties - optional; without one, that line is left out.
 * - **Employment** - for somebody **Active**: working (Active, in Training, PIP) and not serving
 *   notice, as the Active tab counts them. Asks for nothing.
 *
 * Both fill their details from the record - Mr. or Ms. by gender, name, the city of their branch,
 * designation, department,
 * joining (and for experience, last working) date - and take the heading, e-signature, signatory and
 * note from that certificate's own Settings → Employee → Certificate section. Nothing is stored: the
 * certificate is drawn when it is asked for, for the preview and again for the PDF.
 *
 * Behind `HRM / Employee Management` Read / Write (the router's guard on every POST), and only for an
 * employee the caller may change (`scopedEmployee` at write level) - the same reach as the rest of
 * that row's ⋮.
 */
const INACTIVE_STATUSES = ["Relieved", "Absconded", "Long Leave", "Fired"];

const RULES = {
  experience: {
    body: z.object({
      // Optional: without it, the certificate leaves the duties line out.
      duties: z.string().trim().max(2000, "Keep the summary under 2,000 characters.").optional(),
    }).strict(),
    refusal: "An experience certificate is generated only for somebody InActive or serving notice.",
    async eligible(employee) {
      if (INACTIVE_STATUSES.includes(employee.employmentStatus)) return true;
      const working = await workingEmployeeStatuses();
      return working.includes(employee.employmentStatus) && Boolean(employee.dateOfRelieving);
    },
  },
  employment: {
    body: z.object({}).strict(),
    refusal: "An employment certificate is generated only for somebody Active - not serving notice, and not somebody who has left.",
    async eligible(employee) {
      const working = await workingEmployeeStatuses();
      return working.includes(employee.employmentStatus) && !employee.dateOfRelieving;
    },
  },
};

const SELECT = { employeeName: true, gender: true, designation: true, department: true, dateOfJoining: true, dateOfRelieving: true };

/** The filled certificate, or null once the refusal has been answered. */
async function certificateFor(req, res) {
  const kind = String(req.params?.kind || "");
  const rules = Object.hasOwn(RULES, kind) ? RULES[kind] : null;
  if (!rules) {
    res.status(404).json({ message: "There is no such certificate." });
    return null;
  }
  const id = parseId(req, res);
  if (id === null) return null;
  const parsed = rules.body.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ message: parsed.error.issues[0]?.message || "Check what was sent." });
    return null;
  }
  const employee = await scopedEmployee(req, id, SELECT, { level: "READ_WRITE" });
  if (!employee) {
    res.status(404).json({ message: "Employee not found" });
    return null;
  }
  if (!(await rules.eligible(employee))) {
    res.status(409).json({ message: rules.refusal });
    return null;
  }
  const [heading, settings, location] = await Promise.all([payslipHeading(), certificateSettings(kind), companyLocation(employee)]);
  // What that certificate's Settings section has not been given yet - said with the preview, so a
  // certificate is not downloaded unsigned without anybody noticing.
  const missing = [
    ...(settings.signatureUrl ? [] : ["E-Signature"]),
    ...(settings.signatoryName ? [] : ["Authorized Signatory Name"]),
    ...(settings.signatoryDesignation ? [] : ["Designation"]),
  ];
  return {
    kind,
    employee,
    missing,
    html: certificateHtml(kind, { heading, ...settings, employee: employeeDetails(employee, parsed.data.duties, location) }),
  };
}

/** The filled certificate as HTML, for the preview. */
async function previewCertificate(req, res) {
  try {
    const result = await certificateFor(req, res);
    if (result) return res.json({ data: { html: result.html, missing: result.missing } });
    return undefined;
  } catch (error) {
    return handleError(res, error, "Unable to generate the certificate");
  }
}

/** The filled certificate as an A4 PDF, named after the certificate and the employee. */
async function downloadCertificate(req, res) {
  try {
    const result = await certificateFor(req, res);
    if (!result) return undefined;
    let pdf;
    try {
      pdf = await renderCertificatePdf(result.html);
    } catch (error) {
      console.error(`Unable to print the ${result.kind} certificate`, error);
      return res.status(500).json({ message: "The PDF could not be prepared. Try again in a moment." });
    }
    const name = String(result.employee.employeeName || "employee").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "employee";
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${CERTIFICATE_KINDS[result.kind].label}-Certificate-${name}.pdf"`);
    return res.end(pdf);
  } catch (error) {
    return handleError(res, error, "Unable to generate the certificate");
  }
}

module.exports = { INACTIVE_STATUSES, RULES, previewCertificate, downloadCertificate };
