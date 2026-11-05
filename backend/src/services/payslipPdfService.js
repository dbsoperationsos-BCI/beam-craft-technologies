const { getBrowser, frontendOrigin } = require("./quotationPdfService");
const { escapeHtml } = require("./emailTemplates");

/*
 * The payslip as a PDF: laid out like Settings → Template Settings' preview - the heading (the logo
 * at the left; the company's name, its address and the month at the right), the employee's details in
 * three pairs of columns, Earnings beside Deductions with their amounts, the totals, Net Pay in figures
 * and in words, the days paid, and a note - written as HTML here and printed to A4 by the same headless
 * browser the quotation PDF uses.
 *
 * For now it prints the template with sample figures (`SAMPLE_PAYSLIP`), so the studio can see how a
 * payslip will look; an employee's own payroll row is not read yet.
 */

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve",
  "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
const belowHundred = (value) => (value < 20 ? ONES[value] : [TENS[Math.floor(value / 10)], ONES[value % 10]].filter(Boolean).join(" "));
const belowThousand = (value) => [Math.floor(value / 100) ? `${ONES[Math.floor(value / 100)]} Hundred` : "", value % 100 ? belowHundred(value % 100) : ""].filter(Boolean).join(" ");

/** A whole number in words the Indian way - crore, lakh, thousand, hundred. */
function wholeInWords(value) {
  if (value === 0) return "Zero";
  const parts = [];
  const crore = Math.floor(value / 10000000);
  const lakh = Math.floor((value % 10000000) / 100000);
  const thousand = Math.floor((value % 100000) / 1000);
  if (crore) parts.push(`${wholeInWords(crore)} Crore`);
  if (lakh) parts.push(`${belowHundred(lakh)} Lakh`);
  if (thousand) parts.push(`${belowHundred(thousand)} Thousand`);
  if (value % 1000) parts.push(belowThousand(value % 1000));
  return parts.join(" ");
}

/** "Rupees Thirty Thousand Five Hundred Only" - the same words the preview writes. */
function amountInWords(amount) {
  const value = Math.max(0, Math.round((Number(amount) || 0) * 100) / 100);
  const rupees = Math.floor(value);
  const paise = Math.round((value - rupees) * 100);
  return `Rupees ${wholeInWords(rupees)}${paise ? ` and ${belowHundred(paise)} Paise` : ""} Only`;
}


const money = (value) => (Number(value) || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** The sample the template prints - the same employee and figures the preview shows. */
const SAMPLE_PAYSLIP = {
  company: { name: "Studio name", address: "Studio address, City - 600001" },
  month: "October 2026",
  employee: [
    ["Emp Code", "DBS-104"], ["Emp Name", "Kavya R"], ["PF No.", "TN/MAS/0012345/000/0000123"],
    ["Department", "Production"], ["Cost Centre", "Erode TN"], ["ESI No.", "3100123456"],
    ["Location", "Erode"], ["Designation", "Photographer"], ["PAN", "ABCDE1234F"],
    ["Date Of Birth", "12 Mar 1996"], ["Bank A/c No.", "50100123451234"], ["EPS No.", "-"],
    ["Date of Joining", "01 Jun 2024"], ["Residential Status", "Resident"], ["UAN", "100123456789"],
  ],
  // This month's amount on each line.
  earnings: [["Salary", 30000], ["Incentive", 2000]],
  deductions: [["LOP Deduction", 1000], ["Salary Advance", 0], ["Recovery", 0], ["Policy Breach", 0], ["Other Deductions", 500]],
  paidDays: 25,
  lopDays: 1,
  note: "This is a computer-generated payslip and does not need a signature.",
};

/** The logo as an image source, only if it is a picture the template saved - a data image or an https link. */
const logoSource = (url) => (/^(data:image\/[a-z0-9.+-]+;base64,|https:\/\/)/i.test(String(url || "")) ? url : "");
/**
 * With no Global Logo uploaded, the app's own default mark - the one every screen falls back to
 * (`BrandFallbackLogo`), its dark-lettered file, since a payslip prints on white - served by the
 * frontend like the quotation PDF's page is.
 */
const fallbackLogo = () => `${frontendOrigin()}/brand/beam-craft-black-text.svg`;

/**
 * The sample payslip with what was added in Settings → Payroll rules → Edit Payslip in its place -
 * each with a sample value - so Template Settings shows where they land. An added PF detail is marked
 * so a personal-only payslip leaves it off, as a real one does.
 */
const SAMPLE_VALUES = { TEXT: "Sample", NUMBER: "123", ALNUM: "AB123", ANY: "AB-12/3", DATE: "01 Jan 2026" };
function withAddedItems(payslip, added = {}) {
  const detail = (section) => (added?.[section] || []).map(({ label, inputType }) => [label, SAMPLE_VALUES[inputType] || "Sample", ...(section === "PF" ? ["PF"] : [])]);
  return {
    ...payslip,
    employee: [...payslip.employee, ...detail("PERSONAL"), ...detail("PF")],
    earnings: [...payslip.earnings, ...(added?.EARNING || []).map((name) => [name, 1000])],
    deductions: [...payslip.deductions, ...(added?.DEDUCTION || []).map((name) => [name, 250])],
  };
}

/** The employee's PF details on a payslip - left off when Template Settings carries the personal details alone. */
const PF_DETAILS = new Set(["PF No.", "ESI No.", "EPS No.", "UAN"]);

/** The payslip as one HTML document, every value escaped. `heading` is the template's `{ companyName, address, logoUrl }`. */
function payslipHtml({ heading = {}, payslip = SAMPLE_PAYSLIP } = {}) {
  const sum = (lines, index) => lines.reduce((total, line) => total + (Number(line[index]) || 0), 0);
  // Anything Settings → Payroll rules → Edit Payslip turned off or deleted is left off, by name.
  const hidden = new Set(heading.hiddenItems || []);
  // A line at 0 says nothing and is left off too - Salary alone always shows.
  const printed = ([name, amount]) => !hidden.has(name) && (name === "Salary" || Number(amount));
  // An original item renamed in Edit Payslip prints under its new name - hidden or not by its own.
  const named = ([name, ...rest]) => [heading.renamedItems?.[name] || name, ...rest];
  const earnings = payslip.earnings.filter(printed).map(named);
  const deductions = payslip.deductions.filter(printed).map(named);
  const totalEarnings = sum(earnings, 1);
  const totalDeductions = sum(deductions, 1);
  // An employee's own payslip states what is paid - the net salary rounded under the month's rule.
  const netPay = payslip.netPay ?? totalEarnings - totalDeductions;
  // The sample's stand-in company fills an empty heading; an employee's own payslip has none, and prints blank.
  const companyName = String(heading.companyName || "").trim() || payslip.company?.name || "";
  const addressLines = String(String(heading.address || "").trim() || payslip.company?.address || "")
    .split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const logo = logoSource(heading.logoUrl) || fallbackLogo();
  const rows = Math.max(earnings.length, deductions.length);
  const line = (entry) => (entry
    ? `<td>${escapeHtml(entry[0])}</td><td class="num">${money(entry[1])}</td>`
    : "<td>&nbsp;</td><td></td>");
  const employeeRows = [];
  // A detail added under PF details carries "PF" as its third entry; it goes with the rest of PF.
  const details = (heading.details === "PERSONAL" ? payslip.employee.filter(([name, , section]) => !PF_DETAILS.has(name) && section !== "PF") : payslip.employee)
    .filter(([name]) => !hidden.has(name)).map(named);
  for (let index = 0; index < details.length; index += 3) {
    const row = details.slice(index, index + 3);
    // A short last row is filled out with empty cells, so the table keeps its three pairs of columns.
    const blanks = "<th></th><td></td>".repeat(3 - row.length);
    employeeRows.push(`<tr>${row.map(([name, value]) => `<th>${escapeHtml(name)}</th><td>${escapeHtml(value)}</td>`).join("")}${blanks}</tr>`);
  }
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Payslip - ${escapeHtml(payslip.month)}</title>
<style>
  @page { size: A4; margin: 12mm; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #ffffff; font-family: Arial, Helvetica, sans-serif; font-size: 10.5px; color: #0f172a; }
  .slip { border: 1px solid #94a3b8; }
  .head { display: grid; grid-template-columns: 2fr 3fr; align-items: center; gap: 16px; padding: 12px 16px; border-bottom: 1px solid #94a3b8; }
  .head img { max-height: 64px; max-width: 100%; object-fit: contain; }
  .head p { margin: 2px 0; font-size: 11px; }
  .head .name { font-weight: 700; text-transform: uppercase; }
  .head .month { text-transform: uppercase; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid #cbd5e1; padding: 4px 6px; text-align: left; vertical-align: top; }
  th { font-weight: 600; white-space: nowrap; }
  .money th { background: #f1f5f9; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .line { padding: 5px 6px; border-top: 1px solid #cbd5e1; }
  .line b { font-weight: 600; }
  .split { display: grid; grid-template-columns: 1fr 1fr; }
  .split > div { padding: 5px 6px; border-top: 1px solid #cbd5e1; }
  .split > div + div { border-left: 1px solid #cbd5e1; }
  .gap { height: 14px; border-bottom: 1px solid #94a3b8; }
</style></head>
<body><div class="slip">
  <div class="head">
    <div><img src="${escapeHtml(logo)}" alt=""></div>
    <div>
      <p class="name">${escapeHtml(companyName)}</p>
      ${addressLines.map((text) => `<p>${escapeHtml(text)}</p>`).join("")}
      <p class="month">Payslip for the month of ${escapeHtml(payslip.month)}</p>
    </div>
  </div>
  <table><tbody>${employeeRows.join("")}</tbody></table>
  <div class="gap"></div>
  <table class="money">
    <thead><tr><th>Earnings</th><th class="num">Amount</th><th>Deductions</th><th class="num">Amount</th></tr></thead>
    <tbody>
      ${Array.from({ length: rows }, (_, index) => `<tr>${line(earnings[index])}${line(deductions[index])}</tr>`).join("")}
      <tr><th>Total Earnings</th><th class="num">${money(totalEarnings)}</th><th>Total Deductions</th><th class="num">${money(totalDeductions)}</th></tr>
    </tbody>
  </table>
  <div class="line"><b>Net Pay : Rs. </b>${money(netPay)}</div>
  <div class="line"><b>In Words: </b>${escapeHtml(amountInWords(netPay))}</div>
  <div class="split"><div><b>Paid Days: </b>${escapeHtml(payslip.paidDays)}</div><div><b>LOP Days: </b>${escapeHtml(payslip.lopDays)}</div></div>
  <div class="line"><b>Note: </b>${escapeHtml(payslip.note)}</div>
</div></body></html>`;
}

/** Prints the payslip to an A4 PDF and resolves to its bytes. */
async function renderPayslipPdf(options = {}) {
  const instance = await getBrowser();
  const page = await instance.newPage();
  try {
    // Nothing on the page may reach out but the logo: no script runs, and only the saved logo (or the
    // app's own default mark) loads.
    await page.setJavaScriptEnabled(false);
    await page.setContent(payslipHtml(options), { waitUntil: "load", timeout: 30_000 });
    return await page.pdf({ format: "A4", printBackground: true, preferCSSPageSize: true });
  } finally {
    await page.close().catch(() => {});
  }
}

module.exports = { SAMPLE_PAYSLIP, amountInWords, fallbackLogo, logoSource, payslipHtml, renderPayslipPdf, withAddedItems };
