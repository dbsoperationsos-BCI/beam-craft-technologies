const { z } = require("zod");
const prisma = require("../../../config/db");
const { SAMPLE_PAYSLIP, payslipHtml, renderPayslipPdf, withAddedItems } = require("../../../services/payslipPdfService");
const { PAYSLIP_DETAILS, payslipDetails, payslipHeading } = require("../../../services/payslipHeading");

/*
 * Settings → Template Settings → the payslip. Its heading is not set here: the logo and the company's
 * name come from Organization → Branding Logo and the address from the Head Office branch
 * (`services/payslipHeading.js`), so each is kept in one place. What this screen decides is which of
 * the employee's details a payslip carries - the personal details alone, or with the PF details -
 * on the one HRM settings row (`payslip_details`).
 *
 * On that row, `payslip_company_name`, `payslip_address` and `payslip_logo_url` are what the heading
 * was typed into before it was taken from those places, and `payslip_financial_year_start_month`
 * what the year-to-date columns counted from before they were taken off the payslip; nothing reads or
 * writes them any more.
 */

const SETTINGS_ID = "default";


/** The template as the screen and the PDF read it: the heading where it comes from, and its details. */
async function template() {
  const items = require("../../hrm/payslip-fields/service");
  const [heading, details, hiddenItems, addedItems, renamedItems] = await Promise.all([payslipHeading(), payslipDetails(), items.hiddenPayslipItems(), items.addedPayslipItems(), items.renamedPayslipItems()]);
  return { ...heading, details, hiddenItems, addedItems, renamedItems };
}

async function getPayslipTemplate(req, res) {
  try {
    const heading = await template();
    // The sample as the PDF prints it, for the preview to show on an A4 sheet - the same document.
    const html = payslipHtml({ heading, payslip: withAddedItems(SAMPLE_PAYSLIP, heading.addedItems) });
    return res.json({ data: { ...heading, html } });
  } catch (error) {
    console.error("Unable to read the payslip template:", error.message);
    return res.status(500).json({ message: "Unable to read the payslip template." });
  }
}

/**
 * Whether the payslip carries the PF details, for Edit Employee → Payslip Details - which asks for
 * them only when it does. Behind `HRM / Employee Management` Read, as the record it is part of is.
 */
async function getPayslipDetailsForEmployees(req, res) {
  try {
    return res.json({ data: { details: await payslipDetails() } });
  } catch (error) {
    console.error("Unable to read what the payslip carries:", error.message);
    return res.status(500).json({ message: "Unable to read the payslip settings." });
  }
}

/**
 * The template as a PDF, to see how a payslip will print: the heading as it stands in Branding and
 * Branches, and the details it carries, over the sample employee and figures (`payslipPdfService`).
 */
async function downloadSamplePayslip(req, res) {
  try {
    const heading = await template();
    // The sample, with what was added in Edit Payslip in its place, so the PDF shows where each lands.
    const pdf = await renderPayslipPdf({ heading, payslip: withAddedItems(SAMPLE_PAYSLIP, heading.addedItems) });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", 'attachment; filename="payslip-sample.pdf"');
    res.setHeader("Content-Length", pdf.length);
    return res.end(pdf);
  } catch (error) {
    console.error("Unable to print the sample payslip:", error.message);
    return res.status(500).json({ message: "The sample payslip could not be prepared. Try again in a moment." });
  }
}

module.exports = { getPayslipTemplate, getPayslipDetailsForEmployees, downloadSamplePayslip };
