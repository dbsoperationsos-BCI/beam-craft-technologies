const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const pdfService = require("../src/services/payslipPdfService");

const { SAMPLE_PAYSLIP, amountInWords, payslipHtml } = pdfService;

/*
 * The payslip printed as a PDF: the template's heading over the sample employee and figures, written
 * as HTML and printed by the quotation PDF's headless browser.
 */

const NOKIA = {
  companyName: "Nokia Solutions and Networks India Private Limited",
  address: "1507, Regus Business Centre,\nEros Corporate Towers Level 15\nNehru Place New Delhi 110019",
  logoUrl: "https://cdn.example/logo.png",
};

test("the heading is the template's - logo at the left, then the name, the address a line to a row, and the month", () => {
  const html = payslipHtml({ heading: NOKIA });
  assert.match(html, /<img src="https:\/\/cdn\.example\/logo\.png" alt="">/);
  assert.match(html, /<p class="name">Nokia Solutions and Networks India Private Limited<\/p>\s*<p>1507, Regus Business Centre,<\/p><p>Eros Corporate Towers Level 15<\/p><p>Nehru Place New Delhi 110019<\/p>\s*<p class="month">Payslip for the month of October 2026<\/p>/);
  // Nothing set: the sample company, and the app's default mark - its dark-lettered file - for the logo.
  const empty = payslipHtml({ heading: {} });
  assert.ok(empty.includes(SAMPLE_PAYSLIP.company.name));
  assert.match(empty, /<img src="https?:\/\/[^"]+\/brand\/beam-craft-black-text\.svg" alt="">/);
});

test("the body is the sample payslip: details, Earnings beside Deductions, totals, Net Pay in figures and words", () => {
  const html = payslipHtml({ heading: NOKIA });
  assert.match(html, /<th>Emp Code<\/th><td>DBS-104<\/td><th>Emp Name<\/th><td>Kavya R<\/td><th>PF No\.<\/th>/);
  assert.match(html, /<th>Total Earnings<\/th><th class="num">32,000\.00<\/th>/);
  assert.match(html, /<th>Total Deductions<\/th><th class="num">1,500\.00<\/th>/);
  assert.match(html, /<b>Net Pay : Rs\. <\/b>30,500\.00/);
  assert.match(html, /<b>In Words: <\/b>Rupees Thirty Thousand Five Hundred Only/);
  assert.equal(amountInWords(1234567.5), "Rupees Twelve Lakh Thirty Four Thousand Five Hundred Sixty Seven and Fifty Paise Only");
  assert.match(html, /@page \{ size: A4; margin: 12mm; \}/);
});

test("what the studio typed is printed as text, and only a saved picture is ever loaded as the logo", () => {
  const html = payslipHtml({ heading: { companyName: "<script>alert(1)</script> & Co", address: "<img src=x onerror=alert(1)>", logoUrl: "javascript:alert(1)" } });
  assert.ok(!html.includes("<script>") && !html.includes("<img src=x"));
  assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt; &amp; Co"));
  assert.ok(!html.includes("javascript:"), "a javascript: logo is never a source");
  assert.ok(!payslipHtml({ heading: { logoUrl: "http://plain.example/logo.png" } }).includes("plain.example"), "only https or a data image - otherwise the default mark");
  assert.ok(payslipHtml({ heading: { logoUrl: "data:image/png;base64,AAAA" } }).includes("<img src=\"data:image/png;base64,AAAA\""));
  // Printed with no script running on the page.
  assert.match(fs.readFileSync(path.join(__dirname, "..", "src", "services", "payslipPdfService.js"), "utf8"), /await page\.setJavaScriptEnabled\(false\);/);
});

test("the sample PDF is Payroll rules' to read, and prints the heading from Branding and the Head Office", () => {
  const routes = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "hrm", "payroll-register", "routes.js"), "utf8");
  assert.match(routes, /router\.use\(requireModule\("HRM", "Payroll Register"\)\);[\s\S]*router\.get\("\/payslip-template\/sample\.pdf", payslipTemplate\.downloadSamplePayslip\);/);
  const controller = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "settings", "template-settings", "controller.js"), "utf8");
  // The sample, with what Edit Payslip added in its place.
  assert.match(controller, /const pdf = await renderPayslipPdf\(\{ heading, payslip: withAddedItems\(SAMPLE_PAYSLIP, heading\.addedItems\) \}\);/);
  const withFood = require("../src/services/payslipPdfService").withAddedItems(SAMPLE_PAYSLIP, { DEDUCTION: ["Food"] });
  assert.ok(payslipHtml({ payslip: withFood }).includes("<td>Food</td><td class=\"num\">250.00</td>"));
  assert.match(controller, /res\.setHeader\("Content-Disposition", 'attachment; filename="payslip-sample\.pdf"'\);/);
});

test("no YTD: Earnings beside Deductions with the month's amount alone", () => {
  const html = payslipHtml({ heading: NOKIA });
  assert.match(html, /<thead><tr><th>Earnings<\/th><th class="num">Amount<\/th><th>Deductions<\/th><th class="num">Amount<\/th><\/tr><\/thead>/);
  assert.match(html, /<td>Salary<\/td><td class="num">30,000\.00<\/td><td>LOP Deduction<\/td><td class="num">1,000\.00<\/td>/);
  assert.doesNotMatch(html, /YTD|Year to date/);
  // Space between the employee's details and the money.
  assert.match(html, /<\/tbody><\/table>\s*<div class="gap"><\/div>\s*<table class="money">/);
  for (const name of ["ytdRange", "monthsIn", "withSampleYtd"]) assert.equal(pdfService[name], undefined, name);
});

test("with personal details only, the PF details are left off and the rows still have three pairs", () => {
  const both = payslipHtml({ heading: { details: "PERSONAL_AND_PF" } });
  for (const name of ["PF No.", "ESI No.", "EPS No.", "UAN"]) assert.ok(both.includes(`<th>${name}</th>`), name);
  const personal = payslipHtml({ heading: { details: "PERSONAL" } });
  for (const name of ["PF No.", "ESI No.", "EPS No.", "UAN"]) assert.ok(!personal.includes(`<th>${name}</th>`), name);
  assert.ok(personal.includes("<th>Residential Status</th>") && personal.includes("<th>PAN</th>"));
  // Eleven details: three full rows and a last one of two, filled out with an empty pair.
  assert.match(personal, /<th>Residential Status<\/th><td>Resident<\/td><th><\/th><td><\/td><\/tr>/);
});

test("a line at 0 is left off - Salary Advance and Recovery in the sample - Salary always shown", () => {
  const html = payslipHtml({ heading: {} });
  assert.ok(!html.includes("<td>Salary Advance</td>") && !html.includes("<td>Recovery</td>"));
  assert.ok(html.includes("<td>Other Deductions</td>") && html.includes("<td>Salary</td>"));
  const zeroBasic = { ...SAMPLE_PAYSLIP, earnings: [["Salary", 0], ["Incentive", 0]] };
  assert.ok(payslipHtml({ payslip: zeroBasic }).includes("<td>Salary</td>"));
});

test("what Edit Payslip turned off is left off, and a renamed item prints under its new name", () => {
  const html = payslipHtml({ heading: { hiddenItems: ["PAN"], renamedItems: { Salary: "Monthly Salary", "Emp Name": "Name" } } });
  assert.ok(!html.includes("<th>PAN</th>"));
  assert.ok(html.includes("<td>Monthly Salary</td>") && !html.includes("<td>Salary</td>"));
  assert.ok(html.includes("<th>Name</th>"));
});

test("the template answers with the very HTML its PDF prints, for the A4 preview", () => {
  const controller = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "settings", "template-settings", "controller.js"), "utf8");
  assert.match(controller, /const html = payslipHtml\(\{ heading, payslip: withAddedItems\(SAMPLE_PAYSLIP, heading\.addedItems\) \}\);\s+return res\.json\(\{ data: \{ \.\.\.heading, html \} \}\);/);
});
