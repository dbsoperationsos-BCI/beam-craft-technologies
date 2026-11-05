const { z } = require("zod");
const { renderPayslipPdf } = require("../../../services/payslipPdfService");
const { payslipDetails, payslipHeading } = require("../../../services/payslipHeading");
const service = require("./service");

const monthSchema = z.object({ year: z.coerce.number().int().min(2000).max(2100), month: z.coerce.number().int().min(1).max(12) });

const noEmployee = (res) => res.status(404).json({ message: "This login has no employee record, so there are no payslips to show." });

/**
 * The months this employee has a payslip for - `[{ year, month, label, periodFrom, periodTo,
 * paymentStatus, generatedOn, paidDays, lopDays, netPay }]` - and `upcoming`, the month being paid now
 * with the day its payslip is generated (null once it is out).
 */
async function listMyPayslips(req, res) {
  try {
    const employee = await service.employeeOf(req.user.id);
    if (!employee) return noEmployee(res);
    const [data, upcoming] = await Promise.all([service.payslipSummaries(employee), service.upcomingPayslip()]);
    return res.json({ data, upcoming });
  } catch (error) {
    console.error("Unable to list the payslips:", error.message);
    return res.status(500).json({ message: "Unable to load your payslips." });
  }
}

/**
 * One month's payslip as a PDF: this employee's own row, laid out by Template Settings - the heading
 * from Branding and the Head Office, and the details it carries (personal only, or with PF).
 */
async function downloadMyPayslip(req, res) {
  const parsed = monthSchema.safeParse(req.params);
  if (!parsed.success) return res.status(400).json({ message: "Choose a month." });
  try {
    const employee = await service.employeeOf(req.user.id);
    if (!employee) return noEmployee(res);
    const payslip = await service.payslipOf(employee, parsed.data.year, parsed.data.month);
    if (!payslip) return res.status(404).json({ message: "There is no payslip for that month." });
    const items = require("../payslip-fields/service");
    const [heading, details, hiddenItems, renamedItems] = await Promise.all([payslipHeading(), payslipDetails(), items.hiddenPayslipItems(), items.renamedPayslipItems()]);
    const pdf = await renderPayslipPdf({ heading: { ...heading, details, hiddenItems, renamedItems }, payslip });
    // Named for the payslip's month - the one before the payroll month the request names.
    const fileName = service.payslipFileName(parsed.data.year, parsed.data.month);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    res.setHeader("Content-Length", pdf.length);
    return res.end(pdf);
  } catch (error) {
    console.error("Unable to print the payslip:", error.message);
    return res.status(500).json({ message: "The payslip could not be prepared. Try again in a moment." });
  }
}

module.exports = { listMyPayslips, downloadMyPayslip };
