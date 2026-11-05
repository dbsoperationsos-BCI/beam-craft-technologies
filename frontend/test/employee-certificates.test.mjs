import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { canGenerateEmploymentCertificate, canGenerateExperienceCertificate } from "../src/lib/employmentStatus.mjs";

/*
 * Employee Repository → Administration → ⋮ → Generate: Employment Certificate for somebody Active,
 * Experience Certificate for somebody InActive or serving notice. Experience asks the summary of
 * duties first; Employment opens straight on the sheet.
 */
const read = (...parts) => fs.readFileSync(path.join(process.cwd(), "src", ...parts), "utf8");

test("Experience is offered for somebody InActive or serving notice, and nobody else", () => {
  for (const status of ["Relieved", "Absconded", "Long Leave", "Fired"]) {
    assert.equal(canGenerateExperienceCertificate({ employmentStatus: status }), true, status);
  }
  assert.equal(canGenerateExperienceCertificate({ employmentStatus: "Active", dateOfRelieving: "2026-10-31" }), true, "serving notice");
  assert.equal(canGenerateExperienceCertificate({ employmentStatus: "Active" }), false);
  assert.equal(canGenerateExperienceCertificate({ employmentStatus: "HR Onboarding Pending" }), false);
  assert.equal(canGenerateExperienceCertificate({ type: "invite", employmentStatus: "Relieved" }), false);
});

test("Employment is offered for somebody Active - as the Active tab counts them - and nobody else", () => {
  for (const status of ["Active", "in Training", "PIP"]) {
    assert.equal(canGenerateEmploymentCertificate({ employmentStatus: status }), true, status);
  }
  assert.equal(canGenerateEmploymentCertificate({ employmentStatus: "Active", dateOfRelieving: "2026-10-31" }), false, "serving notice");
  assert.equal(canGenerateEmploymentCertificate({ employmentStatus: "Relieved" }), false);
  assert.equal(canGenerateEmploymentCertificate({ employmentStatus: "HR Onboarding Pending" }), false);
  assert.equal(canGenerateEmploymentCertificate({ type: "invite", employmentStatus: "Active" }), false);
});

test("the row's ⋮ has Generate with the certificates the row may have, and one dialog draws either", () => {
  const table = read("components", "employees", "EmployeeTable.js");
  assert.match(table, /canGenerateEmploymentCertificate\(employee\) \? \[\{ label: "Employment Certificate", onSelect: \(\) => onGenerateCertificate\(employee, "employment"\) \}\]/);
  assert.match(table, /canGenerateExperienceCertificate\(employee\) \? \[\{ label: "Experience Certificate", onSelect: \(\) => onGenerateCertificate\(employee, "experience"\) \}\]/);
  assert.match(table, /certificates\.length \? \[\{ label: "Generate", submenu: certificates \}\]/);
  const page = read("components", "employees", "EmployeeVerificationPage.js");
  assert.match(page, /onGenerateCertificate: \(employee, kind\) => setCertificateTarget\(\{ employee, kind \}\)/);
  const dialog = read("components", "employees", "EmployeeCertificateDialog.js");
  // Experience asks the duties; Employment asks nothing and generates as it opens.
  assert.match(dialog, /experience: \{ label: "Experience Certificate", asksDuties: true \}/);
  assert.match(dialog, /employment: \{ label: "Employment Certificate", asksDuties: false \}/);
  assert.match(dialog, /if \(certificate\.asksDuties\) return undefined;[\s\S]{0,80}void preview\(\)/);
  // The summary is optional - Generate is not held back without one.
  assert.match(dialog, /label="Brief summary of their duties"/);
  assert.doesNotMatch(dialog, /label="Brief summary of their duties"\s+required/);
  assert.doesNotMatch(dialog, /disabled=\{!duties\.trim\(\)/);
  assert.match(dialog, /<A4DocumentPreview html=\{html\}/);
  assert.match(dialog, /Download PDF/);
});
