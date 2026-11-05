const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

/*
 * Settings → Employee → Certificate → Offer Letter: an A4 letter whose heading is laid out as the
 * payslip's - logo left, the studio's name and the head office's address right - every value escaped.
 */

const { offerFromEmployee, offerLetterHtml } = require("../src/services/offerLetter");

test("the heading is the payslip's: logo left, the name and the address a line to a row on the right", () => {
  const html = offerLetterHtml({ heading: { companyName: "Don't Blink Studios", address: "No. 12, Perundurai Road\nErode - 638011\nTamil Nadu", logoUrl: "https://cdn.example/brand.png" } });
  assert.match(html, /\.head \{ display: grid; grid-template-columns: 2fr 3fr;/);
  assert.match(html, /<div><img src="https:\/\/cdn\.example\/brand\.png" alt=""><\/div>/);
  assert.match(html, /<p class="name">Don&#39;t Blink Studios<\/p>\s*<p>No\. 12, Perundurai Road<\/p><p>Erode - 638011<\/p><p>Tamil Nadu<\/p>/);
  assert.match(html, /<h1>OFFER LETTER<\/h1>/);
  // The title under the heading, above From and the date - and not underlined.
  const title = html.indexOf("<h1>OFFER LETTER</h1>");
  assert.ok(html.indexOf('<div class="head">') < title && title < html.indexOf('<div class="parties">'));
  assert.doesNotMatch(html, /text-decoration: underline/);
  assert.match(html, /@page \{ size: A4; margin: 12mm; \}/);
});

test("no Global Logo prints the app's own mark; typed text never becomes markup", () => {
  const html = offerLetterHtml({ heading: { companyName: "<script>x</script>", address: "" } });
  assert.doesNotMatch(html, /<script>x/);
  assert.match(html, /<img src="[^"]+" alt="">/);
});

test("served to administrators under Certificate settings: its timing, and its sign-off as the `offer` kind", () => {
  const ROUTES = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "settings", "certificates", "routes.js"), "utf8");
  const guard = ROUTES.indexOf("router.use(controller.requireAdministrator);");
  assert.ok(guard < ROUTES.indexOf('router.get("/offer-letter/timing", controller.getOfferLetterTiming);'));
  assert.ok(guard < ROUTES.indexOf('router.put("/offer-letter/timing", controller.saveOfferLetterTiming);'));
  const { SETTINGS_KINDS } = require("../src/modules/settings/certificates/controller");
  const { CERTIFICATE_KINDS } = require("../src/services/experienceCertificate");
  assert.deepEqual(Object.keys(SETTINGS_KINDS), ["experience", "employment", "offer"]);
  // Employee Repository → Generate still draws the two certificates only.
  assert.deepEqual(Object.keys(CERTIFICATE_KINDS), ["experience", "employment"]);
});

test("the sign-off as the certificates', without their note: the e-signature above the signatory, no signing line", () => {
  const signed = offerLetterHtml({ heading: { companyName: "DBS" }, signatureUrl: "https://cdn.example/sign.png", signatoryName: "Priya Raman", signatoryDesignation: "HR Manager", note: "Bring <ID> proof." });
  assert.match(signed, /<p>Sincerely,<\/p>\s*<img src="https:\/\/cdn\.example\/sign\.png" alt="Signature">\s*<p><b>Priya Raman<\/b><\/p>\s*<p>HR Manager<\/p>/);
  // No note on the offer letter, whatever is passed.
  assert.doesNotMatch(signed, /class="note"|Bring/);
  const { SETTINGS_KINDS } = require("../src/modules/settings/certificates/controller");
  assert.equal(SETTINGS_KINDS.offer.columns.note, undefined);
  const blank = offerLetterHtml({ heading: {} });
  assert.doesNotMatch(blank, /alt="Signature"/);
  // No line to sign on; without an e-signature, room to sign by hand.
  assert.doesNotMatch(signed + blank, /class="rule"/);
  assert.match(blank, /<p>Sincerely,<\/p>\s*<div class="space"><\/div>\s*<p><b>\[Authorized Signatory Name\]<\/b><\/p>/);
  assert.match(blank, /\[Authorized Signatory Name\]/);
});

test("the studio's offer letter follows: From and To, the subject, its two fixed sections and the signatory - blanks bracketed", () => {
  const html = offerLetterHtml({ heading: { companyName: "Don't Blink Studios", address: "No. 12, Perundurai Road\nErode - 638011" } });
  // From is the studio as known - its name and address, no phone or email; To and the date are the template's blanks.
  assert.match(html, /<b>From:<\/b><br>Don&#39;t Blink Studios<br>No\. 12, Perundurai Road<br>Erode - 638011<\/p>/);
  assert.doesNotMatch(html, /\[Phone Number\]/);
  assert.match(html, /<b>To:<\/b><br>\[Candidate Full Name\]<br>\[Candidate Address\]<br>\[City, State, PIN Code\]<br>\[Email Address\]/);
  assert.match(html, /<b>Date :<\/b> \[DD\/MM\/YYYY\]/);
  assert.match(html, /<span class="label">Subject<\/span>Offer of Employment for the Position of <b>\[Job Title\]<\/b>/);
  const sections = [...html.matchAll(/<li><b>([^<]+)<\/b>/g)].map((match) => match[1]);
  assert.deepEqual(sections, ["Employment Details", "Compensation"]);
  assert.doesNotMatch(html, /detailed salary structure/);
  assert.doesNotMatch(html, /Working Hours/);
  for (const label of ["Designation", "Department", "Employment Type", "Work Location", "Reporting To", "Date of Joining", "Monthly Gross Salary", "Annual CTC", "Salary Payment Date", "Deductions"]) {
    assert.ok(html.includes(`<td class="label">${label}</td><td class="colon">:</td>`), label);
  }
  assert.match(html, /We welcome you to <b>Don&#39;t Blink Studios<\/b>/);
  assert.match(html, /<p><b>\[Authorized Signatory Name\]<\/b><\/p>\s*<p>\[Designation\]<\/p>\s*<p>Don&#39;t Blink Studios<\/p>/);
  // A candidate's own values fill the blanks, escaped.
  const filled = offerLetterHtml({ heading: {}, offer: { candidateName: "Kavya <R>", jobTitle: "Photographer" } });
  assert.match(filled, /Kavya &lt;R&gt;/);
  assert.match(filled, /the position of <b>Photographer<\/b> at <b>\[Company Name\]<\/b>/);
});

test("To is the chosen employee: name, address a line to a row, own email - a gap keeps its blank", () => {
  const offer = offerFromEmployee({ employeeName: "Kavya <R>", currentAddress: "No. 4, Main Road\nErode - 638001", permanentAddress: "elsewhere", emailId: "", workEmailId: "kavya@studio.in" });
  const html = offerLetterHtml({ heading: {}, offer });
  assert.match(html, /<b>To:<\/b><br>Kavya &lt;R&gt;<br>No\. 4, Main Road<br>Erode - 638001<br>kavya@studio\.in<\/p>/);
  const bare = offerLetterHtml({ heading: {}, offer: offerFromEmployee({ employeeName: "Ravi", currentAddress: null, permanentAddress: "", emailId: null }) });
  assert.match(bare, /<b>To:<\/b><br>Ravi<br>\[Candidate Address\]<br>\[City, State, PIN Code\]<br>\[Email Address\]/);
  assert.deepEqual(offerFromEmployee(null), {});
});

test("when to generate: whole days after joining, 0 to 365, nothing else accepted", () => {
  const { offerTimingSchema } = require("../src/modules/settings/certificates/controller");
  assert.equal(offerTimingSchema.safeParse({ generateAfterDays: 45 }).success, true);
  assert.equal(offerTimingSchema.safeParse({ generateAfterDays: 0 }).success, true);
  for (const bad of [{ generateAfterDays: -1 }, { generateAfterDays: 366 }, { generateAfterDays: 4.5 }, { generateAfterDays: "45" }, {}, { generateAfterDays: 45, extra: 1 }]) {
    assert.equal(offerTimingSchema.safeParse(bad).success, false, JSON.stringify(bad));
  }
});

test("Employment Details and the greeting come from the employee's record, as Edit Employee holds it", () => {
  const employee = {
    employeeName: "Kavya Raman", currentAddress: null, permanentAddress: null, emailId: "kavya@mail.in",
    designation: "Old title", designationRef: { name: "Senior Photographer" },
    department: "Production, Editing", workType: "Full Time",
    currentWorkLocation: "Erode Studio", workBaseLocation: "Coimbatore", currentWorkLocationRef: null,
    dateOfJoining: new Date("2026-08-03T00:00:00Z"), reportsTo: { employeeName: "Mukesh K" },
  };
  const html = offerLetterHtml({ heading: { companyName: "DBS" }, offer: offerFromEmployee(employee) });
  assert.match(html, /<span class="label">Subject<\/span>Offer of Employment for the Position of <b>Senior Photographer<\/b>/);
  assert.match(html, /<b>Dear Kavya,<\/b>/);
  const row = (label, value) => assert.ok(html.includes(`<td class="label">${label}</td><td class="colon">:</td><td>${value}</td>`), label);
  row("Designation", "Senior Photographer");
  row("Department", "Production, Editing");
  row("Employment Type", "Full Time");
  row("Work Location", "Erode Studio");
  row("Reporting To", "Mukesh K");
  row("Date of Joining", "03/08/2026");
  // The letter's own date is the date of joining; without one, the blank stays.
  assert.match(html, /<b>Date :<\/b> 03\/08\/2026<\/p>/);
  assert.match(offerLetterHtml({ heading: {}, offer: offerFromEmployee({ employeeName: "Ravi" }) }), /<b>Date :<\/b> \[DD\/MM\/YYYY\]/);
  // Nothing on the record: the blank stays.
  const bare = offerLetterHtml({ heading: {}, offer: offerFromEmployee({ employeeName: "Ravi" }) });
  assert.ok(bare.includes('<td class="label">Reporting To</td><td class="colon">:</td><td>[Manager / Supervisor Name]</td>'));
  assert.ok(bare.includes('<td class="label">Work Location</td><td class="colon">:</td><td>[Office Address]</td>'));
});

test("the select reads every field the letter fills, through its links", async () => {
  const { OFFER_EMPLOYEE_SELECT } = require("../src/services/offerLetter");
  const prisma = require("../src/config/db");
  // Prisma refuses an unknown field, so this proves every name is a real column or relation.
  await prisma.employee.findFirst({ select: OFFER_EMPLOYEE_SELECT });
  await prisma.$disconnect();
});

test("the studio's own sections follow Compensation, numbered on, each its title and its text - escaped, blanks dropped", () => {
  const html = offerLetterHtml({ heading: {}, sections: [
    { title: "Probation", content: "Six months.\nReviewed <monthly>." },
    { title: "  ", content: "no title" },
    { title: "Leave", content: "As per policy." },
  ] });
  const titles = [...html.matchAll(/<li><b>([^<]+)<\/b>/g)].map((match) => match[1]);
  assert.deepEqual(titles, ["Employment Details", "Compensation", "Probation", "Leave"]);
  assert.match(html, /<li><b>Probation<\/b><span class="text">Six months\.\nReviewed &lt;monthly&gt;\.<\/span><\/li>/);
  assert.doesNotMatch(html, /Termination and Notice Period|Probation Period/);
});

test("sections are saved whole and checked: a title and content each, 15 at most, nothing else", () => {
  const { offerSectionsSchema } = require("../src/modules/settings/certificates/controller");
  assert.equal(offerSectionsSchema.safeParse({ sections: [] }).success, true);
  assert.equal(offerSectionsSchema.safeParse({ sections: [{ title: "Leave", content: "As per policy." }] }).success, true);
  for (const bad of [{ sections: [{ title: "", content: "x" }] }, { sections: [{ title: "x", content: " " }] }, { sections: [{ title: "x", content: "y", extra: 1 }] }, { sections: Array.from({ length: 16 }, () => ({ title: "x", content: "y" })) }, {}]) {
    assert.equal(offerSectionsSchema.safeParse(bad).success, false, JSON.stringify(bad).slice(0, 60));
  }
  const ROUTES = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "settings", "certificates", "routes.js"), "utf8");
  assert.ok(ROUTES.indexOf("router.use(controller.requireAdministrator);") < ROUTES.indexOf('router.put("/offer-letter/sections", controller.saveOfferLetterSections);'));
});

test("Compensation prints the lines switched on: salary and CTC from the employee, the payroll's payable day, the summary typed", () => {
  const { offerCompensation, paymentDayText, STANDARD_STATUTORY_SUMMARY } = require("../src/services/offerLetter");
  const row = (html, label) => [...html.matchAll(/<td class="label">([^<]+)<\/td><td class="colon">:<\/td><td>([^]*?)<\/td>/g)].find((match) => match[1] === label)?.[2];
  // Nothing stored: all four, the standard summary.
  assert.deepEqual(offerCompensation(null), { monthlyGross: true, annualCtc: true, paymentDate: true, statutory: true, statutorySummary: STANDARD_STATUTORY_SUMMARY });
  const offer = offerFromEmployee({ employeeName: "Kavya", totalSalary: "25000.00" });
  const full = offerLetterHtml({ heading: {}, offer, paybackDay: 10 });
  assert.equal(row(full, "Monthly Gross Salary"), "₹25,000");
  assert.equal(row(full, "Annual CTC"), "₹3,00,000");
  assert.equal(row(full, "Salary Payment Date"), "10th of every month");
  assert.match(row(full, "Deductions"), /including PF/);
  // Some switched off: those lines are gone; the summary is the one typed.
  const some = offerLetterHtml({ heading: {}, offer, paybackDay: 1, compensation: { monthlyGross: true, annualCtc: false, paymentDate: true, statutory: true, statutorySummary: "PF & ESI <as applicable>." } });
  assert.equal(row(some, "Annual CTC"), undefined);
  assert.equal(row(some, "Salary Payment Date"), "1st of every month");
  assert.equal(row(some, "Deductions"), '<span class="text">PF &amp; ESI &lt;as applicable&gt;.</span>');
  // All off: no Compensation section at all, and the studio's own sections follow Employment Details.
  const none = offerLetterHtml({ heading: {}, compensation: { monthlyGross: false, annualCtc: false, paymentDate: false, statutory: false, statutorySummary: "" }, sections: [{ title: "Leave", content: "As per policy." }] });
  assert.deepEqual([...none.matchAll(/<li><b>([^<]+)<\/b>/g)].map((match) => match[1]), ["Employment Details", "Leave"]);
  // No salary on the record: the blank stays.
  assert.equal(row(offerLetterHtml({ heading: {}, offer: offerFromEmployee({ employeeName: "Ravi", totalSalary: null }) }), "Monthly Gross Salary"), "₹[Amount]");
  assert.equal(paymentDayText(22), "22nd of every month");
  assert.equal(paymentDayText(12), "12th of every month");
});

test("the Compensation switches are saved whole: Deductions on needs its summary", () => {
  const { offerCompensationSchema } = require("../src/modules/settings/certificates/controller");
  const all = { monthlyGross: true, annualCtc: true, paymentDate: true, statutory: true, statutorySummary: "PF as applicable." };
  assert.equal(offerCompensationSchema.safeParse(all).success, true);
  assert.equal(offerCompensationSchema.safeParse({ ...all, statutory: false, statutorySummary: "" }).success, true);
  assert.equal(offerCompensationSchema.safeParse({ ...all, statutorySummary: " " }).success, false);
  assert.equal(offerCompensationSchema.safeParse({ ...all, extra: 1 }).success, false);
  assert.equal(offerCompensationSchema.safeParse({ monthlyGross: true }).success, false);
  const ROUTES = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "settings", "certificates", "routes.js"), "utf8");
  assert.ok(ROUTES.indexOf("router.use(controller.requireAdministrator);") < ROUTES.indexOf('router.put("/offer-letter/compensation", controller.saveOfferLetterCompensation);'));
});

test("Employment Details prints the lines switched on; with none, the sections after it number on from 1", () => {
  const { offerEmployment } = require("../src/services/offerLetter");
  const { offerEmploymentSchema } = require("../src/modules/settings/certificates/controller");
  const labels = (html) => [...html.matchAll(/<td class="label">([^<]+)<\/td>/g)].map((match) => match[1]);
  // Nothing stored: all six.
  assert.deepEqual(Object.values(offerEmployment(null)), [true, true, true, true, true, true]);
  const some = offerLetterHtml({ heading: {}, employment: { designation: true, department: false, employmentType: false, workLocation: true, reportingTo: false, dateOfJoining: true }, compensation: { monthlyGross: false, annualCtc: false, paymentDate: false, statutory: false, statutorySummary: "" } });
  assert.deepEqual(labels(some), ["Designation", "Work Location", "Date of Joining"]);
  const none = offerLetterHtml({ heading: {}, employment: Object.fromEntries(Object.keys(offerEmployment(null)).map((key) => [key, false])), sections: [{ title: "Leave", content: "As per policy." }] });
  assert.deepEqual([...none.matchAll(/<li><b>([^<]+)<\/b>/g)].map((match) => match[1]), ["Compensation", "Leave"]);
  assert.equal(offerEmploymentSchema.safeParse(offerEmployment(null)).success, true);
  assert.equal(offerEmploymentSchema.safeParse({ designation: true }).success, false);
  assert.equal(offerEmploymentSchema.safeParse({ ...offerEmployment(null), salary: true }).success, false);
  const ROUTES = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "settings", "certificates", "routes.js"), "utf8");
  assert.ok(ROUTES.indexOf("router.use(controller.requireAdministrator);") < ROUTES.indexOf('router.put("/offer-letter/employment", controller.saveOfferLetterEmployment);'));
});

test("each document closes with its own line above the signature - Sincerely, while none is typed", () => {
  const { certificateHtml, closingLine } = require("../src/services/experienceCertificate");
  const { certificateSchema } = require("../src/modules/settings/certificates/controller");
  assert.match(offerLetterHtml({ heading: {} }), /<p>Sincerely,<\/p>/);
  assert.match(offerLetterHtml({ heading: {}, closing: "Warm regards & welcome," }), /<p>Warm regards &amp; welcome,<\/p>/);
  assert.match(certificateHtml("experience", { heading: {}, closing: "Yours faithfully," }), /<p>Yours faithfully,<\/p>/);
  assert.match(certificateHtml("employment", { heading: {} }), /<p>Sincerely,<\/p>/);
  assert.equal(closingLine("  "), "Sincerely,");
  assert.equal(certificateSchema.safeParse({ closing: "x".repeat(101) }).success, false);
  assert.equal(certificateSchema.safeParse({ closing: "Regards," }).success, true);
});

test("a section is written as a paragraph or as points - points print as a bulleted list", () => {
  const { offerSectionsSchema } = require("../src/modules/settings/certificates/controller");
  const html = offerLetterHtml({ heading: {}, sections: [
    { title: "Probation", format: "PARAGRAPH", content: "Six months." },
    { title: "Leave", format: "POINTS", points: ["12 casual leaves <a year>", " ", "Holidays as declared"] },
    { title: "Old", content: "Saved before the choice." },
  ] });
  assert.match(html, /<li><b>Probation<\/b><span class="text">Six months\.<\/span><\/li>/);
  assert.match(html, /<li><b>Leave<\/b><ul class="points"><li>12 casual leaves &lt;a year&gt;<\/li><li>Holidays as declared<\/li><\/ul><\/li>/);
  assert.match(html, /<li><b>Old<\/b><span class="text">Saved before the choice\.<\/span><\/li>/);
  // Saved as written: points need one at least, blanks dropped; a paragraph needs its content.
  const saved = offerSectionsSchema.parse({ sections: [{ title: "Leave", format: "POINTS", points: ["A", "", "B"] }, { title: "P", content: "Text" }] });
  assert.deepEqual(saved.sections, [{ title: "Leave", format: "POINTS", points: ["A", "B"] }, { title: "P", format: "PARAGRAPH", content: "Text" }]);
  assert.equal(offerSectionsSchema.safeParse({ sections: [{ title: "Leave", format: "POINTS", points: [" "] }] }).success, false);
  assert.equal(offerSectionsSchema.safeParse({ sections: [{ title: "P", format: "PARAGRAPH", content: "" }] }).success, false);
  assert.equal(offerSectionsSchema.safeParse({ sections: [{ title: "L", format: "POINTS", points: Array.from({ length: 31 }, () => "x") }] }).success, false);
  // Numbered points print 1, 2, 3 - an ordered list.
  assert.match(offerLetterHtml({ heading: {}, sections: [{ title: "Duties", format: "NUMBERED", points: ["Shoot", "Edit"] }] }), /<li><b>Duties<\/b><ol class="points numbered"><li>Shoot<\/li><li>Edit<\/li><\/ol><\/li>/);
  assert.deepEqual(offerSectionsSchema.parse({ sections: [{ title: "Duties", format: "NUMBERED", points: ["Shoot", " "] }] }).sections, [{ title: "Duties", format: "NUMBERED", points: ["Shoot"] }]);
});

test("sections are titled, not numbered - numbered points inside a section keep their numbers", () => {
  const html = offerLetterHtml({ heading: {}, sections: [{ title: "Duties", format: "NUMBERED", points: ["Shoot"] }] });
  assert.match(html, /body > ol \{ list-style: none; padding-left: 0;/);
  assert.match(html, /ol > li > \.points\.numbered \{ list-style: decimal; \}/);
  // No number styled onto a section's title - only the points inside a section have markers.
  assert.doesNotMatch(html, /body > ol > li::marker/);
});

test("Employment Details and Compensation print where they were placed - and lead a list saved before they could move", () => {
  const { offerSectionOrder } = require("../src/services/offerLetter");
  const { offerSectionsSchema } = require("../src/modules/settings/certificates/controller");
  const titles = (html) => [...html.matchAll(/<li><b>([^<]+)<\/b>/g)].map((match) => match[1]);
  const leave = { title: "Leave", format: "POINTS", points: ["One"] };
  const duties = { title: "Duties", format: "PARAGRAPH", content: "Shoot." };
  assert.deepEqual(titles(offerLetterHtml({ heading: {}, sections: [leave, { builtin: "COMPENSATION" }, duties, { builtin: "EMPLOYMENT" }] })), ["Leave", "Compensation", "Duties", "Employment Details"]);
  // Saved before: the two lead, as they always did.
  assert.deepEqual(titles(offerLetterHtml({ heading: {}, sections: [leave, duties] })), ["Employment Details", "Compensation", "Leave", "Duties"]);
  assert.deepEqual(offerSectionOrder([leave, { builtin: "EMPLOYMENT" }, { builtin: "EMPLOYMENT" }]).map((entry) => entry.builtin || entry.title), ["COMPENSATION", "Leave", "EMPLOYMENT"]);
  // Saved with their places; a built-in one named twice is kept once; an unknown one is refused.
  const saved = offerSectionsSchema.parse({ sections: [leave, { builtin: "EMPLOYMENT" }, { builtin: "COMPENSATION" }, { builtin: "EMPLOYMENT" }] });
  assert.deepEqual(saved.sections.map((entry) => entry.builtin || entry.title), ["Leave", "EMPLOYMENT", "COMPENSATION"]);
  assert.equal(offerSectionsSchema.safeParse({ sections: [{ builtin: "SALARY" }] }).success, false);
  assert.match(offerSectionsSchema.safeParse({ sections: [{ title: "", format: "PARAGRAPH", content: "x" }] }).error.issues[0].message, /title/);
});

test("a letterhead's look: the studio's name and rule in navy, a bold title, black labels for the parties and the subject, an unboxed subject, quiet tables", () => {
  const html = offerLetterHtml({ heading: { companyName: "DBS", address: "Erode" }, offer: { jobTitle: "Photographer" } });
  assert.match(html, /\.head \{ display: grid; grid-template-columns: 2fr 3fr;[^}]*border-bottom: 2px solid #1e3a5f; \}/);
  assert.match(html, /h1 \{ margin: 24px 0 20px; text-align: center; font-size: 18px; font-weight: 800;/);
  // One type scale - 18px the title, 14px the studio's name, 12px what is read, 10px labels and the address - and nothing else.
  const sizes = [...new Set([...html.matchAll(/font-size: ([\d.]+)px/g)].map((match) => Number(match[1])))].sort((left, right) => left - right);
  assert.deepEqual(sizes, [10, 12, 14, 18]);
  // No bar under the title.
  assert.doesNotMatch(html, /h1::after/);
  assert.match(html, /\.parties b \+ br \{ display: none; \}/);
  // From, To and Subject in black; the subject's label on the same line as the subject.
  assert.match(html, /\.parties b \{[^}]*color: #000000; \}/);
  assert.match(html, /\.subject \.label \{ margin-right: 8px;[^}]*color: #000000; \}/);
  assert.doesNotMatch(html, /\.subject \.label \{[^}]*display: block/);
  // The subject's label as large as the subject, and no rule under it.
  assert.match(html, /\.subject \.label \{ margin-right: 8px; font-size: 12px;/);
  // The subject's line is not bold - only its SUBJECT label and the position's name are.
  assert.match(html, /\.subject \{ margin: 6px 0 16px; font-size: 12px; font-weight: 400; color: #000000; \}/);
  assert.doesNotMatch(html, /\.subject \{[^}]*border-bottom/);
  // The date on one line: "Date : 01/06/2025".
  assert.match(html, /<p class="date"><b>Date :<\/b> /);
  assert.match(html, /\.parties \.date b \{ display: inline;[^}]*text-transform: none; \}/);
  // The subject unboxed: a label over the line, a hairline under it.
  assert.match(html, /<p class="subject"><span class="label">Subject<\/span>Offer of Employment for the Position of <b>Photographer<\/b><\/p>/);
  assert.doesNotMatch(html, /\.subject \{[^}]*background/);
  // A section's title in the same type as the rest: no capitals, no spacing, no accent colour.
  assert.match(html, /body > ol > li > b \{ padding-bottom: 3px; border-bottom: 1px solid #e2e8f0; font-size: 12px; font-weight: 700; color: #111827; \}/);
  assert.match(html, /\.details td \{ padding: 3px 0; vertical-align: top; border-bottom: 1px solid #f1f5f9; \}/);
  // Still one A4 page's margins, and nothing scripted or fetched.
  assert.match(html, /@page \{ size: A4; margin: 12mm; \}/);
  assert.doesNotMatch(html, /<script|@import|url\(http/);
});
