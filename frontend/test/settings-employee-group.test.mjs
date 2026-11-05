import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/*
 * Settings' Employee group: Employee Referral on its own permissions, and the Attendance calculator -
 * the pay period and its payback date - for an administrator alone, inside Payroll rules.
 */

const SOURCE = fs.readFileSync(path.join(process.cwd(), "src", "components", "settings", "SettingsOverlay.js"), "utf8");
const group = SOURCE.slice(SOURCE.indexOf("const children = [\n") > -1 ? SOURCE.indexOf("const children = [\n") : SOURCE.indexOf("const children = [\r\n"), SOURCE.indexOf('return children.length ? [{ id: "employee", title: "Employee", children }] : [];'));

test("Employee Referral keeps its own permissions", () => {
  assert.match(group, /\.\.\.\(canReadReferrals && canReadReferralSetting \? \[\{\s+id: "employee-referral",/);
});

test("the calculator lives in Payroll rules, an administrator's alone; its own entry and the Payback Date page are gone", () => {
  assert.doesNotMatch(SOURCE, /"employee-attendance-calculator"|"Attendance Calculator"/);
  assert.doesNotMatch(SOURCE, /employee-payback-date|EmptySettingsSection/);
  // Payroll rules is offered to an administrator or a Payroll Register reader, each block on its own access.
  assert.match(group, /\.\.\.\(isAdministrator \|\| hasPermission\("HRM", "Payroll Register", "READ"\) \? \[\{\s+id: "employee-payroll-rules",/);
  assert.match(group, /canManagePayCycle=\{isAdministrator\}/);
  assert.match(group, /canReadRules=\{hasPermission\("HRM", "Payroll Register", "READ"\)\}/);
  const rules = fs.readFileSync(path.join(process.cwd(), "src", "components", "settings", "PayrollRulesPanel.js"), "utf8");
  assert.match(rules, /\{canManagePayCycle && <section aria-labelledby="payroll-rules-pay-cycle">/);
  assert.match(rules, /<AttendanceCalculatorPanel canWrite onNotice=\{onNotice\} onError=\{onError\} \/>/);
  assert.match(rules, /\{canReadRules && <section aria-labelledby="payroll-rules-salary" className=\{canManagePayCycle \? "border-t border-slate-200 pt-6" : ""\}>/);
  assert.ok(rules.indexOf("Attendance calculator") < rules.indexOf("Salary calculation"), "the calculator comes first");
});

test("the calculator page is two days of the month: Start Date (with End Date worked out beside it), and Payable Date (Following Month)", () => {
  const panel = fs.readFileSync(path.join(process.cwd(), "src", "components", "settings", "AttendanceCalculatorPanel.js"), "utf8");
  assert.ok(panel.indexOf('label="Start Date"') > -1 && panel.indexOf('label="Start Date"') < panel.indexOf('label="End Date"') && panel.indexOf('label="End Date"') < panel.indexOf('label="Payable Date (Following Month)"'),
    "the fields are not there, in that order");
  // End Date is never typed: read only, from Start Date.
  assert.match(panel, /<TextField label="End Date" value=\{endDayText\(shownCycle\)\} readOnly \/>/);
  assert.match(panel, /const endDayText = \(day\) => \(day === 1 \? "Last day" : String\(day - 1\)\);/);
  // Defaults, and the two lines under the boxes.
  assert.match(panel, /const DEFAULT_CYCLE_DAY = 25;/);
  assert.match(panel, /const DEFAULT_PAYBACK_DAY = 10;/);
  // The cycle ends the day before its start day - the payroll's own pay period - or is the calendar month on the 1st.
  assert.match(panel, /\{cycleText\(shownCycle\)\}/);
  assert.match(panel, /`Each pay cycle runs from the \$\{ordinal\(day\)\} of one month to the \$\{ordinal\(day - 1\)\} of the next\.`/);
  assert.match(panel, /"Each pay cycle runs from the 1st to the last day of the month\."/);
  assert.match(panel, /\{held\} \{held === 1 \? "day" : "days"\} salary will be on hold/);
  // No date pickers, employee picker, cycle buttons or results.
  assert.doesNotMatch(panel, /<DateField|<Dropdown|label="Employee"|Pay cycle:|DayTile|PayRow|getAttendanceCalculation/);
  // Saved on the server - both days together - and read-only without Write.
  assert.match(panel, /await savePayPeriod\(\{ cycleDay, paybackDay \}\)/);
  // Saved with Save, after a confirmation naming the month it starts from - never as a field is left.
  assert.doesNotMatch(panel, /onBlur=/);
  assert.match(panel, /<Button type="button" variant="primary" disabled=\{!changed\} onClick=\{\(\) => setConfirming\(true\)\}>Save<\/Button>/);
  assert.match(panel, /The new days apply from the \$\{thisMonth\} payroll on, in every branch\. Earlier months keep the days they had/);
  assert.match(panel, /layer="dialogOverPanel"/);
  assert.equal((panel.match(/readOnly=\{!canWrite\}/g) || []).length, 2);
});

test("the attendance rules are Settings → Employee → Attendance Rules, an administrator's alone - and off the account menu", () => {
  assert.match(group, /\.\.\.\(isAdministrator \? \[\{\s+id: "employee-attendance-rules",\s+title: "Attendance Rules",/);
  assert.match(group, /<AttendanceRulesSettingsPanel onNotice=\{setSectionNotice\} onError=\{setLinkError\} \/>/);
  // Whether they can be changed is still the server's answer, not the overlay's.
  const panel = fs.readFileSync(path.join(process.cwd(), "src", "components", "settings", "AttendanceRulesSettingsPanel.js"), "utf8");
  assert.match(panel, /readOnly=\{!settings\.canManage\}/);
  // The daily quotes are not edited on the rules screen any more.
  const rules = fs.readFileSync(path.join(process.cwd(), "src", "components", "hrm", "AttendanceRulesPanel.js"), "utf8");
  assert.doesNotMatch(rules, /Daily quotes|QuotesSection|addAttendanceQuote|removeAttendanceQuote/);
  const topbar = fs.readFileSync(path.join(process.cwd(), "src", "components", "app-shell", "AppTopbar.js"), "utf8");
  assert.doesNotMatch(topbar, /label: "Rules"|AttendanceRulesDialog|setRulesOpen/);
  assert.equal(fs.existsSync(path.join(process.cwd(), "src", "components", "hrm", "AttendanceRulesDialog.js")), false);
});

test("the group is offered only to somebody with something in it", () => {
  assert.match(SOURCE, /return children\.length \? \[\{ id: "employee", title: "Employee", children \}\] : \[\];/);
});

test("the days on hold run from the latest cycle's end to its payable date", () => {
  const panel = fs.readFileSync(path.join(process.cwd(), "src", "components", "settings", "AttendanceCalculatorPanel.js"), "utf8").split(String.fromCharCode(13)).join("");
  const start = panel.indexOf("const DAY_MS = ");
  const end = panel.indexOf(String.fromCharCode(10) + "}" + String.fromCharCode(10), panel.indexOf("function holdDays(")) + 3;
  const helpers = panel.slice(start, end).replace(/^const ordinal[\s\S]*?^};$/m, "").replace(/^const errorMessage.*$/m, "").replace(/^const dayOf[\s\S]*?^};$/m, "");
  const holdDays = new Function(`${helpers}; return holdDays;`)();
  const on = (iso) => new Date(`${iso}T12:00:00`);
  // The example: the 25th and the 10th - 25 Sep to 10 Oct.
  assert.equal(holdDays(25, 10, on("2026-09-29")), 15);
  // Before the 25th the latest cycle ended last month: 25 Aug to 10 Sep.
  assert.equal(holdDays(25, 10, on("2026-09-20")), 16);
  // A 31-day month in between: 25 Oct to 10 Nov.
  assert.equal(holdDays(25, 10, on("2026-10-26")), 16);
  // A day past a short month's end is its last day: the 31st in September is the 30th.
  assert.equal(holdDays(31, 10, on("2026-09-30")), 10);
});

test("the calculator opens on a Monthly tab, with Weekly, Daily and Hourly shown and disabled", () => {
  const panel = fs.readFileSync(path.join(process.cwd(), "src", "components", "settings", "AttendanceCalculatorPanel.js"), "utf8");
  assert.match(panel, /\{ id: "monthly", label: "Monthly" \}/);
  for (const label of ["Weekly", "Daily", "Hourly"]) {
    assert.match(panel, new RegExp(`\{ id: "${label.toLowerCase()}", label: "${label}", disabled: true, title: "Coming soon" \}`));
  }
  assert.match(panel, /<Tabs ariaLabel="Pay cycle" tabs=\{CYCLE_TABS\} value=\{cycle\} onChange=\{setCycle\}/);
  assert.match(panel, /\{cycle === "monthly" && <div/);
  // The shared tab bar: a disabled tab cannot be pressed.
  const tabs = fs.readFileSync(path.join(process.cwd(), "src", "components", "ui", "Tabs.js"), "utf8");
  assert.match(tabs, /disabled=\{off\}/);
  assert.match(tabs, /onClick=\{\(\) => \{ if \(!off\) onChange\(tab\.id\); \}\}/);
});

test("the WhatsApp report's page: an administrator chooses Sender or Rotation and types the group's name", () => {
  const userSettings = SOURCE.slice(SOURCE.indexOf("const userSettings = ["), SOURCE.indexOf('return userSettings.length ? [{ id: "user-settings", title: "User Settings", children: userSettings }] : [];'));
  // Under Templates, its notification above its wording: offered to an administrator, a holder of
  // its permission or the chosen sender - even without User Settings or Message Template - and the
  // notification card shown on that same gate. The Automatic WhatsApp Message group is gone, and a
  // link to the old screen id still lands here.
  const templates = SOURCE.slice(SOURCE.indexOf("const templates = ["), SOURCE.indexOf('return templates.length ? [{ id: "templates", title: "Templates", children: templates }] : [];'));
  assert.match(templates, /\.\.\.\(admittedToAttendanceReport \|\| isAttendanceReportSender \|\| canReadMessageTemplates \? \[\{\s+id: "message-attendance-report",\s+title: "Attendance WhatsApp Report",\s+render: \(\) => <NotificationTemplatePanel/);
  assert.match(templates, /notification=\{admittedToAttendanceReport \|\| isAttendanceReportSender \? <AttendanceWhatsAppReportPanel onNotice=\{setSectionNotice\} \/> : null\}/);
  assert.doesNotMatch(SOURCE, /id: "automatic-whatsapp-message"|id: "attendance-whatsapp-report"/);
  assert.match(SOURCE, /"attendance-whatsapp-report": "message-attendance-report",/);
  assert.match(SOURCE, /const admittedToAttendanceReport = isAdministrator \|\| hasPermission\("HRM", "Attendance WhatsApp Report", "READ"\);/);
  // The chosen sender reaches it too - it is the only place they connect their own WhatsApp - asked
  // of the server, only while Settings is open, and only by somebody not already let in.
  assert.match(SOURCE, /if \(!open \|\| admittedToAttendanceReport\) return undefined;/);
  assert.match(SOURCE, /setIsAttendanceReportSender\(Boolean\(response\?\.data\?\.canManage\)\)/);
  assert.match(userSettings, /\.\.\.\(canReadUserSettings \? \[\{\s+id: "whatsapp",/);
  assert.doesNotMatch(group, /Attendance WhatsApp Report"/);
  const panel = fs.readFileSync(path.join(process.cwd(), "src", "components", "settings", "AttendanceWhatsAppReportPanel.js"), "utf8");
  // Who sends it is the shared SenderOrderField - Sender with its fallback order, or Rotation -
  // changeable by an administrator only, read-only for anybody else.
  assert.ok(panel.includes("<SenderOrderField") && panel.includes("canWrite={Boolean(status.canChooseSenders)}"));
  assert.doesNotMatch(panel, /PRIORITIES|Priority 2|Priority 3|label=\{`Priority \$\{priority\}`\}/);
  // The report's own endpoints, by default - Wishes Scheduler hands in its own (`api`).
  assert.ok(panel.includes("setSenders: setAttendanceReportSenders,") && panel.includes("api.setSenders(input)"));
  assert.match(panel, /if \(next\?\.canChooseSenders\) \{\s+return api\.listCandidates\(\)/);
  // The group is a typed name, editable by an administrator only, read-only for anybody else.
  assert.ok(panel.includes('label="Group name"'));
  assert.ok(panel.includes("readOnly={!status.canChooseSenders}"));
  assert.ok(panel.includes("setGroupName: setAttendanceReportGroupName,") && panel.includes("api.setGroupName(groupName)"));
  // Connecting is offered to any chosen sender - absent, not disabled, for anybody else - and
  // nothing is picked from anyone's own WhatsApp any more.
  assert.ok(panel.includes("{status.canManage && <div"));
  assert.doesNotMatch(panel, /Link the group|View group/);
  const register = fs.readFileSync(path.join(process.cwd(), "src", "components", "hrm", "AttendanceRegisterPage.js"), "utf8");
  assert.doesNotMatch(register, /showGroupButton|ReportGroupButton/);
});

test("Sends daily at is set on the Attendance WhatsApp Report page, unless the server fixes it for testing", () => {
  const panel = fs.readFileSync(path.join(process.cwd(), "src", "components", "settings", "AttendanceWhatsAppReportPanel.js"), "utf8");
  const service = fs.readFileSync(path.join(process.cwd(), "src", "services", "hrm", "attendance.service.js"), "utf8");
  assert.match(service, /apiRequest\(`\$\{base\}\/report-group\/send-at`, \{ method: "PUT", body: JSON\.stringify\(\{ sendAt \}\) \}\)/);
  // Only whoever chooses the sender edits it, on the 12-hour clock, in India time.
  assert.match(panel, /const sendAtValue = status\.canChooseSenders && !status\.sendAtFromServer/);
  assert.match(panel, /<TimeField label="Time \(India\)" (?:helperText="[^"]*" )?twelveHour value=\{sendAtTime\}/);
  assert.match(panel, /await api\.setSendAt\(sendAtTime\)/);
  assert.ok(panel.includes("setSendAt: setAttendanceReportSendAt,"));
  assert.match(panel, /\["Sends daily at", sendAtValue\]/);
});

test("the attendance report has a switch, saved on the server, in the header of the one Notification card that holds the rest", () => {
  const panel = fs.readFileSync(path.join(process.cwd(), "src", "components", "settings", "AttendanceWhatsAppReportPanel.js"), "utf8");
  const service = fs.readFileSync(path.join(process.cwd(), "src", "services", "hrm", "attendance.service.js"), "utf8");
  assert.match(service, /apiRequest\(`\$\{base\}\/report-group\/enabled`, \{ method: "PUT", body: JSON\.stringify\(\{ enabled \}\) \}\)/);
  assert.ok(panel.includes("setEnabled: setAttendanceReportEnabled,"));
  assert.match(panel, /switchNote: "Sent daily at the time below while this is on\. Off keeps the time, the senders and the group, and sends nothing\."/);
  // The sections sit inside the card, which the wishes (no switch) do not get.
  assert.match(panel, /const switchable = typeof api\.setEnabled === "function";/);
  const wishes = fs.readFileSync(path.join(process.cwd(), "src", "components", "settings", "WishesSchedulerPanel.js"), "utf8");
  assert.doesNotMatch(wishes, /setEnabled/);
});

test("Employee has a Certificate group - Experience, Employment, Offer Letter - an administrator's alone, after Payroll rules", () => {
  assert.match(group, /\.\.\.\(isAdministrator \? \[\{\s+id: "employee-certificate",\s+title: "Certificate",\s+children: \[/);
  // Experience and Employment: the same panel - e-signature, signatory, note and the A4 preview - each
  // with its own kind and Settings' unsaved-changes guard.
  for (const [kind, label] of [["experience", "Experience"], ["employment", "Employment"]]) {
    assert.match(group, new RegExp(`id: "certificate-${kind}",\\s+title: "${label}",\\s+wide: true,[\\s\\S]{0,160}render: \\(\\) => <CertificateTemplatePanel key="${kind}" kind="${kind}" label="${label}" unsavedRef=\\{${kind}CertificateUnsavedRef\\}`));
    assert.match(SOURCE, new RegExp(`"certificate-${kind}": ${kind}CertificateUnsavedRef,`));
  }
  // Offer Letter: its A4 preview, the heading laid out as the payslip's.
  assert.match(group, /\{ id: "certificate-offer-letter", title: "Offer Letter", wide: true, render: \(\) => <OfferLetterPanel unsavedRef=\{offerLetterUnsavedRef\} onNotice=\{setSectionNotice\} onError=\{setLinkError\} \/> \}/);
  const offer = fs.readFileSync(path.join(process.cwd(), "src", "components", "settings", "OfferLetterPanel.js"), "utf8");
  // One template for everyone - no employee picked here: when each letter is generated, then the
  // certificates' own sign-off settings and A4 sheet, as the `offer` kind.
  assert.match(offer, /getOfferLetterTiming\(\)/);
  assert.doesNotMatch(offer, /employeeId|getEmployeeDirectory/);
  assert.ok(offer.indexOf("When to generate offer letter") < offer.indexOf("<CertificateTemplatePanel"));
  // Its own sections, between the timing and the sign-off; saving one redraws the sheet.
  assert.ok(offer.indexOf("When to generate offer letter") < offer.indexOf("<OfferLetterSectionsEditor"));
  assert.ok(offer.indexOf("<OfferLetterSectionsEditor") < offer.indexOf("<CertificateTemplatePanel"));
  assert.match(offer, /previewToken=\{sectionsVersion\}/);
  const sectionsEditor = fs.readFileSync(path.join(process.cwd(), "src", "components", "settings", "OfferLetterSectionsEditor.js"), "utf8");
  assert.match(sectionsEditor, /saveOfferLetterSections\(\{ sections: next \}\)/);
  // No Add Section form: sections come in by Import, and Edit opens the same document editor.
  assert.doesNotMatch(sectionsEditor, /function SectionDialog|>Add Section<|RepeatableTextField|SECTION_FORMATS/);
  assert.match(sectionsEditor, /\{ label: "Edit", onSelect: \(\) => setEditing\(row\.index\) \}/);
  assert.match(sectionsEditor, /<SectionsDocumentDialog\s+existing=\{sections\}\s+editIndex=\{editing\}/);
  // Edited in its place - a second ## title typed into it lands right after it.
  assert.match(sectionsEditor, /const compose = \(written\) => \(editing \? \[\.\.\.existing\.slice\(0, editIndex\), \.\.\.written, \.\.\.existing\.slice\(editIndex \+ 1\)\] : \[\.\.\.existing, \.\.\.written\]\);/);
  // Import Offer Letter (a .docx): read by the server, reviewed here, then added after or in place of the sections.
  assert.match(sectionsEditor, />Import Offer Letter<\/Button>/);
  assert.match(sectionsEditor, /<FileUploadField label="Word document \(\.docx\)" required accept="\.docx" maxFiles=\{1\}/);
  // Reviewed as one piece of text beside the letter it makes, then saved after or in place of the sections.
  assert.match(sectionsEditor, /setText\(sectionsToText\(data\.sections \|\| \[\]\)\)/);
  assert.match(sectionsEditor, /<TextAreaField label=\{editing \? "Section" : "Sections"\} required rows=\{22\}/);
  // The letter in a fixed-height window of its own, scrolled inside.
  assert.match(sectionsEditor, /<div className="h-\[28rem\] overflow-y-auto rounded-lg lg:h-\[34rem\]">\s+<A4DocumentPreview html=\{preview\.html\} title="The offer letter with these sections" \/>/);
  assert.match(sectionsEditor, /const textProblem = parsed\.errors\.length \? "Fix the lines listed below\."/);
  assert.match(sectionsEditor, /if \(!fields\.check\(\{ text: textProblem \}\)\) return;/);
  // Always added after the sections already there - no choice to replace them.
  assert.match(sectionsEditor, /await onSave\(compose\(parsed\.sections\), parsed\.sections\);/);
  assert.doesNotMatch(sectionsEditor, /Replace my sections|IMPORT_MODES|label="Save them"/);
  assert.match(fs.readFileSync(path.join(process.cwd(), "src", "services", "settings", "certificates.service.js"), "utf8"), /\/offer-letter\/sections\/import`, \{ method: "POST", body: form \}/);
  // Titled, not numbered - as the letter prints them.
  assert.doesNotMatch(sectionsEditor, /numbers\[row\.index\]/);
  // Every section - the built-in two too - held and dragged into order (or moved by its arrows), saved as it lands.
  assert.match(sectionsEditor, /<SortableList\s+label="Sections"/);
  // The studio's own sections ticked and deleted together, asked first; the built-in two have no tick box.
  assert.match(sectionsEditor, /\{!row\.builtin && <Checkbox ariaLabel=\{`Select \$\{row\.label\}`\}/);
  assert.match(sectionsEditor, />Delete selected \(\{selected\.size\}\)<\/Button>/);
  assert.match(sectionsEditor, /void store\(sections\.filter\(\(entry, at\) => !selected\.has\(at\)\)/);
  assert.match(sectionsEditor, /<ConfirmDialog\s+open=\{deletingSelected\}/);
  // Dragged only - no up/down arrows beside each row.
  assert.match(sectionsEditor, /moveButtons=\{false\}/);
  assert.match(sectionsEditor, /\[\{ label: "Choose lines", onSelect: \(\) => setChoosingLines\(row\.builtin\) \}\]/);
  assert.match(sectionsEditor, /onReorder=\{reorder\}/);
  assert.doesNotMatch(sectionsEditor, /label: "Move up"|label: "Move down"/);
  // 1. Employment Details and 2. Compensation in the list: a switch per line, saved together; the
  // summary while Deductions is on.
  for (const key of ["designation", "department", "employmentType", "workLocation", "reportingTo", "dateOfJoining", "monthlyGross", "annualCtc", "paymentDate", "statutory"]) assert.ok(sectionsEditor.includes(`key: "${key}"`), key);
  assert.match(sectionsEditor, /\{withSummary && draft\.statutory && <TextAreaField label="Deductions summary" required/);
  assert.match(sectionsEditor, /saveOfferLetterEmployment\(payload\)/);
  assert.match(sectionsEditor, /saveOfferLetterCompensation\(payload\)/);
  // Over the Settings panel, not under it: the document editor (import and edit), the two lines
  // dialogs, the two confirmations and the row menu.
  assert.equal(sectionsEditor.match(/layer="dialogOverPanel"/g)?.length, 5);
  assert.match(sectionsEditor, /menuZIndexClassName=\{layers\.menuOverPanel\}/);
  // The certificates' sign-off without the note.
  assert.match(offer, /<CertificateTemplatePanel kind="offer" label="Offer Letter" documentName="offer letter" withNote=\{false\} framed previewToken=\{sectionsVersion\} unsavedRef=\{unsavedRef\}/);
  assert.match(offer, /saveOfferLetterTiming\(\{ generateAfterDays: Number\(value\) \}\)/);
  const panel = fs.readFileSync(path.join(process.cwd(), "src", "components", "settings", "CertificateTemplatePanel.js"), "utf8");
  // The upload before the preview, who signs it, the note, and the Payslip's own A4 sheet - the server's document.
  assert.ok(panel.indexOf("<ImageUploadField") < panel.indexOf("<A4DocumentPreview"));
  assert.ok(panel.indexOf('label="E-Signature"') < panel.indexOf('label="Authorized Signatory Name"'));
  assert.ok(panel.indexOf('label="Authorized Signatory Name"') < panel.indexOf('label="Designation"'));
  assert.match(panel, /<TextAreaField\s+label="Note"/);
  // The closing line first, as it prints - above the signature - "Sincerely," until typed.
  assert.ok(panel.indexOf('<TextField label="Closing"') < panel.indexOf('label="E-Signature"'));
  assert.match(panel, /saveCertificateSettings\(kind, \{ signature, note: note\.trim\(\), closing: closing\.trim\(\)/);
  // No line under the fields explaining where the signature prints or where the logo comes from.
  assert.doesNotMatch(panel, /The signature prints above|change them in Settings/);
  assert.match(panel, /previewCertificateSettings\(kind, \{ signature, note, closing, signatoryName, signatoryDesignation \}\)/);
  assert.ok(group.indexOf('id: "employee-payroll-rules"') < group.indexOf('id: "employee-certificate"'));
  // Wishes Scheduler has moved to Templates, so Certificate is the Employee group's last entry.
  assert.equal(group.indexOf('id: "wishes-scheduler"'), -1);
  assert.ok(!fs.existsSync(path.join(process.cwd(), "src", "components", "settings", "CertificateSettingsPanel.js")));
});
