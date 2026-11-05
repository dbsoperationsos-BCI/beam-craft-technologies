import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import * as template from "../src/lib/payslipTemplate.mjs";

const { payslipAmount } = template;
const read = (...parts) => fs.readFileSync(path.join(process.cwd(), "src", ...parts), "utf8");
const SHEET = read("components", "shared", "A4DocumentPreview.js");
const PANEL = read("components", "settings", "PayslipTemplatePanel.js");
const OVERLAY = read("components", "settings", "SettingsOverlay.js");
const SERVICE = read("services", "hrm", "payrollRegister.service.js");

test("the payslip's money is written in Indian figures, to the paisa", () => {
  assert.equal(payslipAmount(30500), "30,500.00");
  // Net Pay in words and the totals are the server's, printed with the payslip - payslip-pdf.test.js covers them.
  for (const name of ["amountInWords", "SAMPLE_PAYSLIP", "payslipTotals", "withAddedItems", "payslipEmployeeDetails"]) assert.equal(template[name], undefined, name);
});
test("Payroll rules previews the payslip below Edit Payslip on an A4 sheet - the very document the PDF prints", () => {
  // Template Settings is gone from Settings; the preview is Payroll rules', read again after every Edit Payslip change.
  assert.doesNotMatch(OVERLAY, /id: "template-settings"|PayslipTemplatePanel|canReadTemplateSettings/);
  assert.ok(!fs.existsSync(path.join(process.cwd(), "src", "services", "settings", "template-settings.service.js")));
  const RULES = read("components", "settings", "PayrollRulesPanel.js");
  assert.ok(RULES.indexOf("<EditPayslipPanel") < RULES.indexOf("<PayslipTemplatePanel key={previewKey}"), "below Edit Payslip");
  assert.match(RULES, /\{canReadRules && <section aria-labelledby="payroll-rules-payslip-template"/);
  assert.match(RULES, /const payslipChanged = useCallback\(\(message\) => \{ setPreviewKey\(\(key\) => key \+ 1\); onNotice\?\.\(message\); \}, \[onNotice\]\);/);
  assert.match(SERVICE, /apiRequest\(`\$\{base\}\/payslip-template`\)/);
  // The server's own HTML - the one the PDF is printed from - so preview and download cannot differ.
  assert.match(PANEL, /setHtml\(\(await getPayslipTemplate\(\)\)\?\.data\?\.html \|\| ""\);/);
  assert.match(PANEL, /<A4DocumentPreview html=\{html\} title="Payslip template preview" \/>/);
  assert.ok(!fs.existsSync(path.join(process.cwd(), "src", "components", "settings", "PayslipTemplatePreview.js")));
  // An A4 sheet with the PDF's 12mm margin, scaled down to the width it has and never up; nothing in it runs.
  assert.match(SHEET, /const SHEET_WIDTH = 794;\s+const SHEET_HEIGHT = 1123;\s+const MARGIN = 45;/);
  assert.match(SHEET, /setScale\(Math\.min\(1, entry\.contentRect\.width \/ SHEET_WIDTH\)\)/);
  // Every sheet runs nothing; the one hidden copy the pages are counted on may be read, and still runs nothing.
  assert.match(SHEET, /sandbox=""\s+srcDoc=\{document\}/);
  assert.match(SHEET, /sandbox="allow-same-origin" srcDoc=\{document\} onLoad=\{measure\}/);
  assert.doesNotMatch(SHEET, /allow-scripts/);
  // Longer than a sheet, it goes on to more sheets - laid out in page-sized columns, one sheet a column - never a scroll.
  assert.match(SHEET, /body \{ column-width: \$\{PAGE_WIDTH\}px; column-gap: \$\{PAGE_GAP\}px; column-fill: auto; \}/);
  // A gap between the pages, so a sheet slid a fraction off shows blank rather than the page before's edge.
  assert.match(SHEET, /const PAGE_STEP = PAGE_WIDTH \+ PAGE_GAP;/);
  assert.match(SHEET, /Array\.from\(\{ length: pages \}/);
  assert.match(SHEET, /transform: `translateX\(-\$\{page \* PAGE_STEP\}px\)`/);
  // The sheet is paper white whatever the theme - inline, not a class the dark theme repaints.
  assert.match(SHEET, /backgroundColor: "#ffffff", colorScheme: "light"/);
  assert.doesNotMatch(SHEET, /bg-white/);
});
test("the heading comes from Branding Logo and the Head Office - nothing typed, and no notes about it here", () => {
  assert.doesNotMatch(PANEL, /ImageUploadField|TextAreaField|Financial year|The logo is the Global Logo|No Global Logo is uploaded yet|No branch is marked Head Office/);
});
test("nothing is chosen on the payslip template - the details choice and the generation day are not there", () => {
  assert.doesNotMatch(PANEL, /RadioGroupField|Employee details on the payslip|PAYSLIP_DETAIL_OPTIONS|<Dropdown|Generate payslips on|savePayslipTemplate|>Save</);
  assert.doesNotMatch(SERVICE, /savePayslipTemplate/);
  assert.doesNotMatch(OVERLAY, /templateSettingsUnsavedRef/);
});
test("Download sample PDF prints the saved template with the session's token", () => {
  assert.match(PANEL, /<Button type="button" busy=\{downloading\} busyLabel="Preparing PDF\.\.\." onClick=\{downloadSample\}>Download sample PDF<\/Button>/);
  assert.match(SERVICE, /return downloadPdf\(`\$\{base\}\/payslip-template\/sample\.pdf`, fileName/);
  // The shared download sends the session's token, since a plain link carries none.
  // The session's token on every download; a GET unless a body is sent (a certificate's typed details).
  const download = read("services", "api", "downloadPdf.js");
  assert.match(download, /const headers = \{ \.\.\.\(token \? \{ Authorization: `Bearer \$\{token\}` \} : \{\}\)/);
  assert.match(download, /fetch\(`\$\{API_URL\}\$\{path\}`, body !== undefined\s+\? \{ method: "POST", headers, body: JSON\.stringify\(body\) \}\s+: \{ headers \}\)/);
});

test("Edit Payslip: every item an on/off and a three-dot menu of Edit and Delete - no type, no Built-in tag", () => {
  const EDIT = read("components", "settings", "EditPayslipPanel.js");
  assert.match(EDIT, /<ToggleSwitch\s+ariaLabel=\{`Show \$\{item\.name\} on the payslip`\}\s+checked=\{item\.shown\}/);
  // Its ⋮: Edit (a new name) and Delete, for Read / Write alone.
  assert.match(EDIT, /\{canWrite && <OptionsMenu\s+ariaLabel=\{`Actions for \$\{item\.name\}`\}\s+menuZIndexClassName=\{layers\.menuOverPanel\}/);
  assert.match(EDIT, /\{ label: "Edit", onSelect: \(\) => setRenaming\(\{ item, name: item\.name, error: "" \}\) \}/);
  assert.doesNotMatch(EDIT, /IconButton|DeleteOutlineIcon/);
  // Personal and PF details under one Payslip Info, personal first - as Edit Employee asks for them.
  assert.match(EDIT, /\{ value: "INFO", members: \["PERSONAL", "PF"\], label: "Payslip Info"/);
  assert.match(EDIT, /\.\.\.\(item\.deletable === false \? \[\] : \[\{ label: "Delete", tone: "danger", onSelect: \(\) => setDeleting\(item\) \}\]\),/);
  // A rename goes where the item lives: a built-in by its own label, a detail as its label, a column as its name.
  assert.match(EDIT, /if \(item\.kind === "builtIn"\) await setBuiltInPayslipItem\(item\.label, \{ name \}\);\s+else if \(item\.kind === "field"\) await updatePayslipField\(item\.id, \{ label: name \}\);\s+else await updatePayrollComponent\(item\.id, \{ name \}\);/);
  assert.doesNotMatch(EDIT, /Built-in<\/span>|TYPE_LABEL/);
  // The payslip's own items come from the server; a deleted one is not listed, and there is no Restore.
  assert.match(EDIT, /getBuiltInPayslipItems\(\)/);
  assert.match(EDIT, /group\.members\.flatMap\(\(member\) => items\.filter\(\(item\) => item\.group === member && !item\.deleted\)\)/);
  assert.doesNotMatch(EDIT, /Restore|deletedBuiltIns/);
  // It starts with the four; one of the payslip's own items is added back by its name, anything else is new.
  assert.match(EDIT, /if \(own\) await setBuiltInPayslipItem\(own\.label, \{ deleted: false \}\);\s+else if \(isColumnGroup\(value\)\) await createPayrollComponent/);
});
test("an added detail takes Text, Number, Text and number, a Date, or a Dropdown of its own options", () => {
  assert.deepEqual(template.PAYSLIP_INPUT_TYPES.map(({ value, label, input }) => [value, label, input]), [["TEXT", "Text", "text"], ["NUMBER", "Number", "number"], ["ALNUM", "Text and number", "text"], ["ANY", "Any character", "text"], ["DATE", "Date", "date"], ["DROPDOWN", "Dropdown", "select"]]);
  const ITEM = read("components", "settings", "PayslipItemDialog.js");
  assert.match(ITEM, /const INPUT_TYPES = PAYSLIP_INPUT_TYPES\.map/);
  // The options are asked for only when Dropdown is chosen, one to a box, at least two.
  assert.match(ITEM, /const dropdown = !columns && values\.inputType === "DROPDOWN";/);
  assert.match(ITEM, /\{dropdown && <RepeatableTextList/);
  assert.match(ITEM, /options: dropdown && options\.length < 2 \? "Give the dropdown at least two options\." : ""/);
  assert.match(ITEM, /error=\{fields\.errors\.options\}/);
  // Edit Employee offers them as its dropdown.
  const FORM = read("components", "employees", "EmployeeFormPanel.js");
  assert.equal((FORM.match(/type=\{PAYSLIP_INPUT_TYPES\[field\.inputType\] \|\| "text"\} options=\{field\.options\}/g) || []).length, 2);
  assert.match(read("services", "hrm", "payslipFields.service.js"), /\.\.\.\(inputType === "DROPDOWN" \? \{ options \} : \{\}\)/);
});

test("Generate payslips on sits in Payroll rules, above Edit Payslip, on the register's own permission", () => {
  const RULES = read("components", "settings", "PayrollRulesPanel.js");
  const GENERATION = read("components", "settings", "PayslipGenerationPanel.js");
  const PAYROLL_SERVICE = read("services", "hrm", "payrollRegister.service.js");
  assert.ok(RULES.indexOf("<PayslipGenerationPanel canWrite={canWrite}") < RULES.indexOf("<EditPayslipPanel"), "above Edit Payslip");
  assert.match(RULES, /\{canReadRules && <section aria-label="Payslip generation"/);
  // Counted from the payable date: on it, or 1 to 30 days after; or as soon as the cycle ends.
  assert.deepEqual(template.PAYSLIP_GENERATE_DAY_OPTIONS.slice(0, 3).map((option) => option.label), ["As soon as the pay cycle ends", "On the payable date", "1 day after the payable date"]);
  assert.equal(template.PAYSLIP_GENERATE_DAY_OPTIONS.length, 32);
  assert.match(GENERATION, /label="Generate payslips on"[\s\S]{0,120}options=\{PAYSLIP_GENERATE_DAY_OPTIONS\}/);
  // Read shows it as a value; Save is Read / Write's alone, and only once something changed.
  assert.match(GENERATION, /readOnly=\{!canWrite\}/);
  assert.match(GENERATION, /\{canWrite && <Button type="button" variant="primary" busy=\{busy\}[^>]*disabled=\{value === saved\}/);
  assert.match(PAYROLL_SERVICE, /apiRequest\(`\$\{base\}\/payslip-generation`, \{ method: "PUT", body: JSON\.stringify\(\{ generateDaysAfter \}\) \}\)/);
  assert.doesNotMatch(GENERATION, /<select|<button|apiRequest|fetch\(/);
});
