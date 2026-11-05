const test = require("node:test");
const assert = require("node:assert/strict");

/*
 * Employee Repository → Administration → ⋮ → Generate → Experience Certificate: the certificate filled
 * from the employee's record and the duties HR typed - only for somebody InActive or serving notice,
 * and only one the caller may change.
 */

const dbPath = require.resolve("../src/config/db");
require(dbPath);
require.cache[dbPath].exports = {
  // Branch 1 is in Erode; branch 2 has no city recorded, so its people read as the head office's (Chennai).
  branch: {
    findUnique: async ({ where }) => ({ 1: { city: "Erode" }, 2: { city: "" } })[where.id] || null,
    findFirst: async () => ({ city: "Chennai" }),
  },
  hrmSettings: { findUnique: async () => ({ experienceCertificateSignatoryName: "Priya Raman", experienceCertificateSignatoryDesignation: "HR Manager", experienceCertificateNote: null, experienceCertificateSignatureUrl: null }) },
};

const EMPLOYEES = {
  1: { id: 1, branchId: 1, employeeName: "Divya Prakash", gender: "Female", designation: "Photographer", department: "Production", dateOfJoining: new Date("2025-06-01T00:00:00Z"), dateOfRelieving: new Date("2026-10-10T00:00:00Z"), employmentStatus: "Relieved" },
  2: { id: 2, branchId: 2, employeeName: "Sanjay Murugan", gender: "Male", designation: "Photographer", department: "Production", dateOfJoining: new Date("2025-06-01T00:00:00Z"), dateOfRelieving: new Date("2026-10-31T00:00:00Z"), employmentStatus: "Active" },
  3: { id: 3, branchId: 1, employeeName: "Karthik Selvam", gender: "Male", designation: "Photographer", department: "Production", dateOfJoining: new Date("2025-06-01T00:00:00Z"), dateOfRelieving: null, employmentStatus: "Active" },
};
const stub = (relative, exports) => {
  const resolved = require.resolve(relative);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
};
stub("../src/modules/hrm/employees/controller", {
  // Employee 9 is somebody the caller may not reach.
  scopedEmployee: async (req, id) => (id === 9 ? null : EMPLOYEES[id] || null),
  parseId: (req, res) => { const id = Number(req.params.id); if (Number.isInteger(id) && id > 0) return id; res.status(400).json({ message: "Validation failed" }); return null; },
  handleError: (res, error, fallback) => res.status(500).json({ message: fallback }),
});
stub("../src/services/payslipHeading", { payslipHeading: async () => ({ companyName: "Don't Blink Studios", address: "Erode", logoUrl: "" }) });
stub("../src/services/employeeOptionLists", { workingEmployeeStatuses: async () => ["Active", "in Training", "PIP"] });

const { employeeDetails, honorific } = require("../src/services/experienceCertificate");
const controller = require("../src/modules/hrm/employees/certificates.controller");
const response = () => {
  const res = { statusCode: 200, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  return res;
};
const generate = async (id, duties = "Covering weddings as a lead photographer", kind = "experience") => {
  const res = response();
  await controller.previewCertificate({ params: { id: String(id), kind }, body: kind === "experience" ? { duties } : {}, user: { id: 1 } }, res);
  return res;
};

test("Mr. or Ms. by gender, and both where none is set", () => {
  assert.equal(honorific("Male"), "Mr.");
  assert.equal(honorific("female"), "Ms.");
  assert.equal(honorific(null), "Mr./Ms.");
  assert.equal(honorific("Other"), "Mr./Ms.");
});

test("the record fills the certificate, and a detail it does not hold keeps its blank", () => {
  assert.deepEqual(employeeDetails(EMPLOYEES[1], " Editing albums ", "Erode"), {
    title: "Ms.", name: "Divya Prakash", location: "Erode", designation: "Photographer", department: "Production",
    dateOfJoining: "1 June 2025", lastWorkingDate: "10 October 2026", duties: "Editing albums",
  });
  assert.equal(employeeDetails({ employeeName: "X" }, "y").lastWorkingDate, "[Last Working Date]");
  assert.equal(employeeDetails({ employeeName: "X" }, "y").location, "[Company Location]");
});

test("generated for somebody InActive: their details, their duties, and the signatory from Settings", async () => {
  const res = await generate(1);
  assert.equal(res.statusCode, 200);
  const { html } = res.body.data;
  assert.match(html, /<b>Ms\. Divya Prakash<\/b>/);
  assert.match(html, /<b>Ms\. Divya Prakash<\/b> was employed with <b>Don&#39;t Blink Studios<\/b>, located in <b>Erode<\/b>, as a <b>Photographer<\/b> in the <b>Production<\/b> from <b>1 June 2025<\/b> to <b>10 October 2026<\/b>\./);
  assert.match(html, /was responsible for <b>Covering weddings as a lead photographer<\/b>\./);
  assert.match(html, /<b>Priya Raman<\/b>/);
  assert.doesNotMatch(html, /\[Employee Name\]|\[brief description/);
});

test("generated for somebody serving notice too, Mr. for a man", async () => {
  const res = await generate(2);
  assert.equal(res.statusCode, 200);
  assert.match(res.body.data.html, /<b>Mr\. Sanjay Murugan<\/b>/);
  // His branch has no city recorded: the head office's.
  assert.match(res.body.data.html, /located in <b>Chennai<\/b>/);
});

test("refused for somebody still working, somebody out of reach, and an over-long summary", async () => {
  assert.equal((await generate(3)).statusCode, 409, "Active, no last working date");
  assert.equal((await generate(9)).statusCode, 404, "not one the caller may change");
  assert.equal((await generate(1, "x".repeat(2001))).statusCode, 400, "too long");
});

test("several departments read as a sentence, every InActive status is offered, and what Settings lacks is said", async () => {
  assert.equal(employeeDetails({ department: "Production, Editing" }).department, "Production and Editing");
  assert.equal(employeeDetails({ department: "Sales, Production, Editing" }).department, "Sales, Production and Editing");
  for (const status of ["Absconded", "Long Leave", "Fired"]) {
    EMPLOYEES[4] = { ...EMPLOYEES[1], id: 4, employmentStatus: status };
    assert.equal((await generate(4)).statusCode, 200, status);
  }
  // Settings has a signatory and designation here but no e-signature.
  assert.deepEqual((await generate(1)).body.data.missing, ["E-Signature"]);
});

test("the employment certificate: for somebody Active only, no summary asked, and their details filled in", async () => {
  // Karthik: Active, no last working date.
  const res = await generate(3, undefined, "employment");
  assert.equal(res.statusCode, 200);
  const { html } = res.body.data;
  assert.match(html, /EMPLOYMENT CERTIFICATE/);
  assert.match(html, /<b>Mr\. Karthik Selvam<\/b> is currently employed with <b>Don&#39;t Blink Studios<\/b>, located in <b>Erode<\/b>, as a <b>Photographer<\/b> in the <b>Production<\/b> since <b>1 June 2025<\/b>\./);
  // Mr. or Ms. wherever their name is said.
  assert.match(html, /During the period of employment, <b>Mr\. Karthik Selvam<\/b> has fulfilled/);
  // Not for somebody serving notice, nor somebody who has left.
  assert.equal((await generate(2, undefined, "employment")).statusCode, 409, "serving notice");
  assert.equal((await generate(1, undefined, "employment")).statusCode, 409, "Relieved");
  // It asks for nothing: a summary sent anyway is refused.
  const extra = response();
  await controller.previewCertificate({ params: { id: "3", kind: "employment" }, body: { duties: "x" }, user: { id: 1 } }, extra);
  assert.equal(extra.statusCode, 400);
  // An unknown certificate is a 404.
  assert.equal((await generate(3, undefined, "offer-letter")).statusCode, 404);
});

test("the summary of duties is optional: without one, the whole duties line is left out", async () => {
  for (const duties of ["", "   "]) {
    const res = await generate(1, duties);
    assert.equal(res.statusCode, 200, JSON.stringify(duties));
    assert.doesNotMatch(res.body.data.html, /was responsible for|brief description of duties/);
    assert.match(res.body.data.html, /We appreciate the employee/);
  }
  const none = response();
  await controller.previewCertificate({ params: { id: "1", kind: "experience" }, body: {}, user: { id: 1 } }, none);
  assert.equal(none.statusCode, 200, "no duties sent at all");
  assert.doesNotMatch(none.body.data.html, /was responsible for/);
});
