const { escapeHtml } = require("./emailTemplates");
const { fallbackLogo, logoSource } = require("./payslipPdfService");

/**
 * The offer letter as one printable A4 HTML document - what Settings → Employee → Certificate →
 * Offer Letter previews on its A4 sheet.
 *
 * Its heading is laid out as the payslip's: the Global Logo on the left; the studio's name and the
 * head office's address on the right, a line to a row; a rule under them (`payslipHeading` supplies
 * all three, so a change in Branding or Branches reaches it). Then the studio's offer letter: From /
 * To, the subject, and its numbered sections - Employment Details and Compensation each with the
 * lines Settings switches on (`employment`, `compensation`; a section with none is left out), then the studio's own (`sections`, each a title and
 * its text, typed in Settings) - closing with the signatory.
 *
 * `offer` fills the letter; left out, it reads as the template, its blanks in brackets - which is what
 * the Settings preview shows. The company's name and address come from the heading wherever known;
 * From is those alone. To and Employment Details are the employee's, when a letter is generated
 * (`offerFromEmployee`). Every value is escaped.
 */
const TEMPLATE_OFFER = {
  date: "[DD/MM/YYYY]",
  candidateName: "[Candidate Full Name]",
  candidateAddress: ["[Candidate Address]", "[City, State, PIN Code]"],
  candidateEmail: "[Email Address]",
  salutationName: "[Candidate Name]",
  jobTitle: "[Job Title]",
  department: "[Department Name]",
  employmentType: "[Full-time / Part-time / Contract]",
  workLocation: "[Office Address]",
  reportingTo: "[Manager / Supervisor Name]",
  dateOfJoining: "[DD/MM/YYYY]",
  monthlyGross: "₹[Amount]",
  annualCtc: "₹[Amount]",
  signatoryName: "[Authorized Signatory Name]",
  signatoryDesignation: "[Designation]",
};

const STANDARD_STATUTORY_SUMMARY = "Applicable deductions, including PF and other statutory deductions, will be made in accordance with applicable laws.";

/**
 * Compensation's lines as stored - which print, and the Deductions summary. Nothing stored
 * yet: all four, with the standard summary.
 */
function offerCompensation(value) {
  if (!value || typeof value !== "object") {
    return { monthlyGross: true, annualCtc: true, paymentDate: true, statutory: true, statutorySummary: STANDARD_STATUTORY_SUMMARY };
  }
  return {
    monthlyGross: Boolean(value.monthlyGross),
    annualCtc: Boolean(value.annualCtc),
    paymentDate: Boolean(value.paymentDate),
    statutory: Boolean(value.statutory),
    statutorySummary: String(value.statutorySummary || "").trim(),
  };
}

/** Employment Details' lines, in the letter's order: the switch, the label, and what fills it. */
const EMPLOYMENT_LINES = [
  ["designation", "Designation", "jobTitle"],
  ["department", "Department", "department"],
  ["employmentType", "Employment Type", "employmentType"],
  ["workLocation", "Work Location", "workLocation"],
  ["reportingTo", "Reporting To", "reportingTo"],
  ["dateOfJoining", "Date of Joining", "dateOfJoining"],
];

/** Which of Employment Details' lines print. Nothing stored yet: all six. */
function offerEmployment(value) {
  const stored = value && typeof value === "object";
  return Object.fromEntries(EMPLOYMENT_LINES.map(([key]) => [key, stored ? Boolean(value[key]) : true]));
}

/** "10th of every month": the payroll's payable day, as the letter says it. */
function paymentDayText(day) {
  const n = Number(day);
  if (!Number.isInteger(n) || n < 1 || n > 31) return "[Payment Date]";
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" }[n % 10] || "th");
  return `${n}${suffix} of every month`;
}

/**
 * The studio's own sections as stored, blanks dropped: `{ title, format, content, points }` - a
 * PARAGRAPH is its `content`, line breaks kept; POINTS is its `points`, a bulleted list; NUMBERED the
 * same points numbered 1, 2, 3. A section saved before there was a choice has no format, and is a
 * paragraph.
 */
function offerSections(value) {
  return (Array.isArray(value) ? value : [])
    .filter((section) => !section?.builtin)
    .map((section) => {
      const title = String(section?.title || "").trim();
      if (section?.format === "POINTS" || section?.format === "NUMBERED") {
        const points = (Array.isArray(section.points) ? section.points : []).map((point) => String(point || "").trim()).filter(Boolean);
        return { title, format: section.format, content: "", points };
      }
      return { title, format: "PARAGRAPH", content: String(section?.content || "").trim(), points: [] };
    })
    .filter((section) => section.title && (section.format === "PARAGRAPH" ? section.content : section.points.length));
}

// Employment Details and Compensation, where the sections list holds their place.
const BUILTIN_SECTIONS = ["EMPLOYMENT", "COMPENSATION"];

/**
 * The letter's sections in their printed order: the studio's own and the two built-in ones - `{
 * builtin }` - wherever they were dragged to. A list saved before the built-in ones could move holds
 * no place for them, and they lead it, as they always did; each is in the list once.
 */
function offerSectionOrder(value) {
  const list = Array.isArray(value) ? value : [];
  const custom = offerSections(list);
  const ordered = [];
  const placed = new Set();
  let next = 0;
  for (const entry of list) {
    if (entry?.builtin) {
      if (BUILTIN_SECTIONS.includes(entry.builtin) && !placed.has(entry.builtin)) { placed.add(entry.builtin); ordered.push({ builtin: entry.builtin }); }
    } else if (custom[next] && String(entry?.title || "").trim() === custom[next].title) {
      ordered.push(custom[next]);
      next += 1;
    }
  }
  ordered.push(...custom.slice(next));
  const missing = BUILTIN_SECTIONS.filter((key) => !placed.has(key)).map((builtin) => ({ builtin }));
  return [...missing, ...ordered];
}

function offerLetterHtml({ heading = {}, offer = {}, signatureUrl = "", closing = "", signatoryName = "", signatoryDesignation = "", sections = [], employment = null, compensation = null, paybackDay = null } = {}) {
  const companyName = String(heading.companyName || "").trim();
  const addressLines = String(heading.address || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const logo = logoSource(heading.logoUrl) || fallbackLogo();
  // The signatory as typed in Settings; blank prints the template's bracketed blank.
  const signatory = {
    ...(String(signatoryName || "").trim() ? { signatoryName: String(signatoryName).trim() } : {}),
    ...(String(signatoryDesignation || "").trim() ? { signatoryDesignation: String(signatoryDesignation).trim() } : {}),
  };
  const o = { ...TEMPLATE_OFFER, ...offer, ...signatory };
  const signature = logoSource(signatureUrl);
  const company = companyName || "[Company Name]";
  const e = escapeHtml;
  // Employment Details' and Compensation's lines that are switched on; a section with none is left out.
  const job = offerEmployment(employment);
  const jobRows = EMPLOYMENT_LINES.filter(([key]) => job[key]).map(([, label, field]) => [label, e(o[field])]);
  const pay = offerCompensation(compensation);
  const payRows = [
    ...(pay.monthlyGross ? [["Monthly Gross Salary", e(o.monthlyGross)]] : []),
    ...(pay.annualCtc ? [["Annual CTC", e(o.annualCtc)]] : []),
    ...(pay.paymentDate ? [["Salary Payment Date", e(paymentDayText(paybackDay))]] : []),
    ...(pay.statutory && pay.statutorySummary ? [["Deductions", `<span class="text">${e(pay.statutorySummary)}</span>`]] : []),
  ];
  const b = (value) => `<b>${e(value)}</b>`;
  const lines = (list) => list.map((line) => `${e(line)}<br>`).join("");
  // "Label : value" rows, as the letter lays its details out.
  const details = (rows) => `<table class="details">${rows.map(([label, value]) => `<tr><td class="label">${e(label)}</td><td class="colon">:</td><td>${value}</td></tr>`).join("")}</table>`;
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Offer Letter</title>
<style>
  @page { size: A4; margin: 12mm; }
  * { box-sizing: border-box; }
  /*
   * A letterhead's look: one deep navy accent (#1e3a5f) for the studio's name, the rule under the
   * letterhead, the title and each section's heading; slate greys for labels and the quieter lines;
   * everything else near-black on white. Type and spacing after the certificates', a shade tighter.
   */
  /* One type scale: 18px the title, 14px the studio's name, 12px everything read, 10px labels and the address. */
  body { margin: 0; background: #ffffff; font-family: "Helvetica Neue", Arial, Helvetica, sans-serif; font-size: 12px; line-height: 1.6; color: #1f2937; }
  b { color: #111827; }
  /* The letterhead: the logo left, the studio's name and address right, a navy rule under them. */
  .head { display: grid; grid-template-columns: 2fr 3fr; align-items: center; gap: 16px; padding: 0 0 12px; border-bottom: 2px solid #1e3a5f; }
  .head img { max-height: 56px; max-width: 100%; object-fit: contain; }
  .head > div:last-child { text-align: right; }
  .head p { margin: 1px 0; font-size: 10px; line-height: 1.45; color: #475569; }
  .head .name { margin-bottom: 3px; font-size: 14px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: #1e3a5f; }
  /* OFFER LETTER: centred, bold and a size up. */
  h1 { margin: 24px 0 20px; text-align: center; font-size: 18px; font-weight: 800; letter-spacing: 0.14em; color: #1e3a5f; }
  /* From and To on the left, the date on the right - each led by a small black label. */
  .parties { display: flex; justify-content: space-between; gap: 16px; margin-bottom: 4px; }
  .parties p { margin: 0 0 12px; }
  .parties b { display: block; margin-bottom: 2px; font-size: 10px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: #000000; }
  .parties b + br { display: none; }
  .date { white-space: nowrap; text-align: right; }
  /* The date reads on one line, "Date : 01/06/2025" - not the small stacked label the parties have. */
  .parties .date b { display: inline; margin: 0; font-size: 12px; letter-spacing: 0; text-transform: none; }
  /* The subject: its label and the line itself on one line, the same size - no box, no rule. */
  .subject { margin: 6px 0 16px; font-size: 12px; font-weight: 400; color: #000000; }
  .subject .label { margin-right: 8px; font-size: 12px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: #000000; }
  p { margin: 0 0 10px; }
  ol { margin: 0 0 10px; padding-left: 20px; }
  ol > li { margin-bottom: 14px; break-inside: avoid; }
  ol > li > b { display: block; margin-bottom: 6px; }
  /* The sections are titled, not numbered: no number in front of a section's title. Bullets and the
     numbers of numbered points inside a section keep their own. */
  body > ol { list-style: none; padding-left: 0; margin-top: 4px; }
  /* A section's title in the letter's own type - 12px bold, as "Dear ...," is - over a hairline. */
  body > ol > li > b { padding-bottom: 3px; border-bottom: 1px solid #e2e8f0; font-size: 12px; font-weight: 700; color: #111827; }
  ol > li > .text, .details .text { white-space: pre-line; }
  ol > li > .points { margin: 2px 0 0; padding-left: 18px; list-style: disc; }
  ol > li > .points.numbered { list-style: decimal; }
  ol > li > .points > li { margin-bottom: 3px; padding-left: 2px; }
  ol > li > .points > li::marker { color: #1e3a5f; font-weight: 700; }
  /* "Label : value" rows: a faint line between them, the label quieter than its value. */
  .details { width: 100%; border-collapse: collapse; margin: 4px 0 4px; }
  .details td { padding: 3px 0; vertical-align: top; border-bottom: 1px solid #f1f5f9; }
  .details tr:last-child td { border-bottom: 0; }
  .details .label { width: 170px; color: #475569; }
  .details .colon { width: 16px; color: #94a3b8; }
  .details td:last-child { color: #111827; }
  .sign { margin-top: 26px; }
  .sign .space { height: 40px; }
  .sign img { display: block; max-height: 56px; max-width: 200px; object-fit: contain; margin: 6px 0; }
  .sign p { margin: 0 0 2px; }
  .sign p:nth-last-child(2) { color: #475569; }
  .sign p:last-child { font-weight: 700; color: #1e3a5f; }
</style></head>
<body>
  <div class="head">
    <div><img src="${e(logo)}" alt=""></div>
    <div>
      <p class="name">${e(companyName)}</p>
      ${addressLines.map((text) => `<p>${e(text)}</p>`).join("")}
    </div>
  </div>

  <h1>OFFER LETTER</h1>

  <div class="parties">
    <div>
      <p><b>From:</b><br>${e(company)}<br>${addressLines.length ? lines(addressLines).replace(/<br>$/, "") : "[Company Address]<br>[City, State, PIN Code]"}</p>
      <p><b>To:</b><br>${e(o.candidateName)}<br>${lines([].concat(o.candidateAddress))}${e(o.candidateEmail)}</p>
    </div>
    <p class="date"><b>Date :</b> ${e(o.date)}</p>
  </div>

  <p class="subject"><span class="label">Subject</span>Offer of Employment for the Position of ${b(o.jobTitle)}</p>
  <p><b>Dear ${e(o.salutationName)},</b></p>
  <p>We are pleased to offer you the position of ${b(o.jobTitle)} at ${b(company)}. We believe your skills and experience will be valuable to our organization and we look forward to having you as a part of our team.</p>

  <ol>
    ${offerSectionOrder(sections).map((section) => {
      // The built-in two where they were placed - each left out with none of its lines on.
      if (section.builtin === "EMPLOYMENT") return jobRows.length ? `<li><b>Employment Details</b>${details(jobRows)}</li>` : "";
      if (section.builtin === "COMPENSATION") return payRows.length ? `<li><b>Compensation</b>Your compensation will be as follows:${details(payRows)}</li>` : "";
      const items = section.points.map((point) => `<li>${e(point)}</li>`).join("");
      const body = section.format === "POINTS" ? `<ul class="points">${items}</ul>`
        : section.format === "NUMBERED" ? `<ol class="points numbered">${items}</ol>`
          : `<span class="text">${e(section.content)}</span>`;
      return `<li><b>${e(section.title)}</b>${body}</li>`;
    }).filter(Boolean).join("\n    ")}
  </ol>

  <p>We welcome you to ${b(company)} and look forward to a successful professional relationship.</p>
  <div class="sign">
    <p>${e(String(closing || "").trim() || "Sincerely,")}</p>
    ${signature ? `<img src="${e(signature)}" alt="Signature">` : '<div class="space"></div>'}
    <p>${b(o.signatoryName)}</p>
    <p>${e(o.signatoryDesignation)}</p>
    <p>${e(company)}</p>
  </div>
</body></html>`;
}

/**
 * What an employee's letter reads from their record - Employee Repository → Edit - for a Prisma
 * `select`: the To, and Employment Details. Names through their links where there is one (Rule 5),
 * the text where there is not.
 */
const OFFER_EMPLOYEE_SELECT = {
  employeeName: true, currentAddress: true, permanentAddress: true, emailId: true, workEmailId: true,
  designation: true, designationRef: { select: { name: true } },
  department: true,
  workType: true,
  currentWorkLocation: true, workBaseLocation: true, currentWorkLocationRef: { select: { name: true } },
  dateOfJoining: true,
  reportsTo: { select: { employeeName: true } },
  totalSalary: true,
};

const rupees = (amount) => `₹${Number(amount).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

const text = (value) => String(value || "").trim();
const ddmmyyyy = (date) => {
  if (!date) return "";
  const day = new Date(date);
  if (Number.isNaN(day.getTime())) return "";
  return `${String(day.getUTCDate()).padStart(2, "0")}/${String(day.getUTCMonth() + 1).padStart(2, "0")}/${day.getUTCFullYear()}`;
};

/**
 * The letter's blanks, from an employee's record (`OFFER_EMPLOYEE_SELECT`), as Edit Employee holds
 * them: To - their name, current address (the permanent one where there is none) a line to a row,
 * and their own email (the work one where there is none); the greeting, by their first name; and
 * Employment Details - Designation (the job title too), Department, Work Type as the employment
 * type, Current Work Location (the base one where there is none), Reports To and Date of Joining - which
 * dates the letter too; and
 * Compensation - the Total Salary (the payroll's Salary) a month, and twelve of it as the CTC.
 * What the record does not hold keeps the template's blank, so a gap shows rather than vanishing.
 */
function offerFromEmployee(employee) {
  if (!employee) return {};
  const address = text(employee.currentAddress || employee.permanentAddress).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const filled = {
    candidateName: text(employee.employeeName),
    salutationName: text(employee.employeeName).split(/\s+/)[0],
    candidateEmail: text(employee.emailId || employee.workEmailId),
    jobTitle: text(employee.designationRef?.name || employee.designation),
    department: text(employee.department),
    employmentType: text(employee.workType),
    workLocation: text(employee.currentWorkLocationRef?.name || employee.currentWorkLocation || employee.workBaseLocation),
    reportingTo: text(employee.reportsTo?.employeeName),
    dateOfJoining: ddmmyyyy(employee.dateOfJoining),
    // The letter is dated the employee's date of joining.
    date: ddmmyyyy(employee.dateOfJoining),
  };
  const salary = Number(employee.totalSalary);
  if (employee.totalSalary !== null && employee.totalSalary !== undefined && Number.isFinite(salary) && salary > 0) {
    filled.monthlyGross = rupees(salary);
    filled.annualCtc = rupees(salary * 12);
  }
  return {
    ...Object.fromEntries(Object.entries(filled).filter(([, value]) => value)),
    ...(address.length ? { candidateAddress: address } : {}),
  };
}

module.exports = { EMPLOYMENT_LINES, STANDARD_STATUTORY_SUMMARY, TEMPLATE_OFFER, OFFER_EMPLOYEE_SELECT, offerCompensation, offerEmployment, offerLetterHtml, offerFromEmployee, offerSectionOrder, offerSections, paymentDayText };
