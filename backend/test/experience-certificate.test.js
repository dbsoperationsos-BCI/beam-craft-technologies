const test = require("node:test");
const assert = require("node:assert/strict");

/*
 * Settings → Employee → Certificate → Experience: the certificate's A4 document (the payslip's
 * heading, the HR's e-signature, a closing note), and the settings behind it - an administrator's alone.
 */

const dbPath = require.resolve("../src/config/db");
require(dbPath);
let ROW = null;
const writes = [];
require.cache[dbPath].exports = {
  hrmSettings: {
    findUnique: async () => ROW,
    upsert: async ({ update }) => { writes.push(update); ROW = { ...(ROW || {}), ...update }; return ROW; },
  },
};

const adminPath = require.resolve("../src/services/administrator");
require.cache[adminPath] = { id: adminPath, filename: adminPath, loaded: true, exports: { isAdministrator: async (id) => id === 1 } };
const headingPath = require.resolve("../src/services/payslipHeading");
require.cache[headingPath] = { id: headingPath, filename: headingPath, loaded: true, exports: { payslipHeading: async () => ({ companyName: "Don't Blink Studios", address: "CR7 street\nErode - 638004", logoUrl: "https://cdn.example.com/logo.png" }) } };
const storagePath = require.resolve("../src/services/imageStorage");
require.cache[storagePath] = { id: storagePath, filename: storagePath, loaded: true, exports: {
  storeImage: async (source) => (String(source).startsWith("https://") ? { url: source, key: null } : { url: "https://cdn.example.com/hrm/certificates/sig.webp", key: "hrm/certificates/sig.webp" }),
  discardUploads: async () => {},
} };

const { experienceCertificateHtml } = require("../src/services/experienceCertificate");
const controller = require("../src/modules/settings/certificates/controller");
const response = () => {
  const res = { statusCode: 200, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  return res;
};

test("the certificate carries the payslip's heading, the template's blanks, and the signature and note when set", () => {
  const heading = { companyName: "Don't Blink Studios", address: "CR7 street\nErode - 638004", logoUrl: "https://cdn.example.com/logo.png" };
  const html = experienceCertificateHtml({ heading, date: new Date("2026-10-13T06:00:00Z") });
  assert.match(html, /@page \{ size: A4;/);
  assert.match(html, /<img src="https:\/\/cdn\.example\.com\/logo\.png"/);
  assert.match(html, /Don&#39;t Blink Studios/);
  assert.match(html, /CR7 street<br>Erode - 638004/);
  assert.match(html, /EXPERIENCE CERTIFICATE/);
  assert.match(html, /Date: 13 October 2026/);
  assert.match(html, /<b>Mr\.\/Ms\. \[Employee Name\]<\/b>/);
  assert.match(html, /was employed with <b>Don&#39;t Blink Studios<\/b>, located in <b>\[Company Location\]<\/b>, as a <b>\[Designation\]<\/b> in the <b>\[Department\]<\/b> from <b>\[Date of Joining\]<\/b> to <b>\[Last Working Date\]<\/b>\./);
  assert.match(html, /<b>\[Authorized Signatory Name\]<\/b>/);
  // The duties are bold, and the blank no longer says "if required".
  assert.match(html, /was responsible for <b>\[brief description of duties\]<\/b>\./);
  assert.doesNotMatch(html, /Signature and company seal/, "the seal line is not printed");
  assert.doesNotMatch(html, /alt="Signature"/, "no signature uploaded");
  assert.doesNotMatch(html, /class="note"/, "no note written");

  const signed = experienceCertificateHtml({ heading, signatureUrl: "https://cdn.example.com/sig.png", note: "Issued on request <for> visa." });
  assert.match(signed, /<img src="https:\/\/cdn\.example\.com\/sig\.png" alt="Signature">/);
  assert.match(signed, /<b>Note:<\/b> Issued on request &lt;for&gt; visa\./, "the note is escaped");
  // Only a stored image or a data image prints - never an arbitrary link.
  assert.doesNotMatch(experienceCertificateHtml({ heading, signatureUrl: "javascript:alert(1)" }), /alt="Signature"/);
});

test("only an administrator gets past the router", async () => {
  let passed = false;
  const res = response();
  await controller.requireAdministrator({ user: { id: 2 } }, res, () => { passed = true; });
  assert.equal(passed, false);
  assert.equal(res.statusCode, 403);
  await controller.requireAdministrator({ user: { id: 1 } }, response(), () => { passed = true; });
  assert.equal(passed, true);
});

test("saving stores the signature and the note, and the answer is the new preview", async () => {
  ROW = null;
  writes.length = 0;
  const res = response();
  await controller.saveCertificate({ params: { kind: "experience" }, user: { id: 1 }, body: { signature: "data:image/png;base64,AAAA", note: "  For official use.  " } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(writes[0], { updatedByUserId: 1, experienceCertificateSignatureUrl: "https://cdn.example.com/hrm/certificates/sig.webp", experienceCertificateNote: "For official use." });
  assert.equal(res.body.data.signatureUrl, "https://cdn.example.com/hrm/certificates/sig.webp");
  assert.match(res.body.data.html, /<b>Note:<\/b> For official use\./);

  // Removed: null clears both.
  await controller.saveCertificate({ params: { kind: "experience" }, user: { id: 1 }, body: { signature: null, note: "" } }, response());
  assert.equal(writes[1].experienceCertificateSignatureUrl, null);
  assert.equal(writes[1].experienceCertificateNote, null);
});

test("a preview of unsaved edits stores nothing", async () => {
  writes.length = 0;
  const res = response();
  await controller.previewCertificate({ params: { kind: "experience" }, user: { id: 1 }, body: { note: "Draft note" } }, res);
  assert.match(res.body.data.html, /<b>Note:<\/b> Draft note/);
  assert.equal(writes.length, 0);
});

test("a signature is an uploaded image or the saved one - never a link elsewhere - and bad input is a 400", async () => {
  ROW = { experienceCertificateSignatureUrl: "https://cdn.example.com/hrm/certificates/sig.webp", experienceCertificateNote: null };
  for (const signature of ["https://evil.example.com/sig.png", "http://cdn.example.com/a.png", "data:image/svg+xml;base64,PHN2Zz4=", "javascript:alert(1)"]) {
    const res = response();
    await controller.saveCertificate({ params: { kind: "experience" }, user: { id: 1 }, body: { signature } }, res);
    assert.equal(res.statusCode, 400, signature);
    const preview = response();
    await controller.previewCertificate({ params: { kind: "experience" }, user: { id: 1 }, body: { signature } }, preview);
    assert.equal(preview.statusCode, 400, `preview ${signature}`);
  }
  // The saved one, sent back unchanged, is kept as it is - not stored again.
  writes.length = 0;
  await controller.saveCertificate({ params: { kind: "experience" }, user: { id: 1 }, body: { signature: "https://cdn.example.com/hrm/certificates/sig.webp", note: "x" } }, response());
  assert.equal("experienceCertificateSignatureUrl" in writes[0], false);
  // An over-long note, and a field that is not one, are refused.
  const long = response();
  await controller.saveCertificate({ params: { kind: "experience" }, user: { id: 1 }, body: { note: "a".repeat(2001) } }, long);
  assert.equal(long.statusCode, 400);
  const unknown = response();
  await controller.saveCertificate({ params: { kind: "experience" }, user: { id: 1 }, body: { note: "x", updatedByUserId: 9 } }, unknown);
  assert.equal(unknown.statusCode, 400);
});

test("the authorised signatory is printed as typed, and a blank prints the bracketed blank", async () => {
  const heading = { companyName: "Don't Blink Studios", address: "", logoUrl: "" };
  const typed = experienceCertificateHtml({ heading, signatoryName: "Priya Raman", signatoryDesignation: "HR Manager" });
  assert.match(typed, /<b>Priya Raman<\/b>/);
  assert.match(typed, /<p>HR Manager<\/p>/);
  assert.doesNotMatch(typed, /\[Authorized Signatory Name\]|\[Designation \/ HR Manager\]/);
  assert.match(experienceCertificateHtml({ heading, signatoryName: "  " }), /<b>\[Authorized Signatory Name\]<\/b>/);

  ROW = null;
  writes.length = 0;
  const res = response();
  await controller.saveCertificate({ params: { kind: "experience" }, user: { id: 1 }, body: { signatoryName: " Priya Raman ", signatoryDesignation: "HR Manager" } }, res);
  assert.equal(writes[0].experienceCertificateSignatoryName, "Priya Raman");
  assert.equal(writes[0].experienceCertificateSignatoryDesignation, "HR Manager");
  assert.equal(res.body.data.signatoryName, "Priya Raman");
  assert.match(res.body.data.html, /<b>Priya Raman<\/b>/);
});

test("the employment certificate: its own title and wording, its own settings, and an unknown kind is a 404", async () => {
  const { certificateHtml } = require("../src/services/experienceCertificate");
  const heading = { companyName: "Don't Blink Studios", address: "", logoUrl: "" };
  const html = certificateHtml("employment", { heading });
  assert.match(html, /<h1>EMPLOYMENT CERTIFICATE<\/h1>/);
  assert.match(html, /<b>Mr\.\/Ms\. \[Employee Name\]<\/b> is currently employed with <b>Don&#39;t Blink Studios<\/b>, located in <b>\[Company Location\]<\/b>, as a <b>\[Designation\]<\/b> in the <b>\[Department\]<\/b> since <b>\[Date of Joining\]<\/b>\./);
  assert.match(html, /During the period of employment, <b>Mr\.\/Ms\. \[Employee Name\]<\/b> has fulfilled their duties and responsibilities effectively/);
  assert.match(html, /This certificate is issued upon the employee's request for official purposes\./);
  assert.doesNotMatch(html, /EXPERIENCE CERTIFICATE|Last Working Date/);

  ROW = null;
  writes.length = 0;
  await controller.saveCertificate({ params: { kind: "employment" }, user: { id: 1 }, body: { signatoryName: "Priya Raman", note: "For bank" } }, response());
  assert.equal(writes[0].employmentCertificateSignatoryName, "Priya Raman");
  assert.equal(writes[0].employmentCertificateNote, "For bank");
  assert.equal("experienceCertificateSignatoryName" in writes[0], false, "the experience certificate's settings are left alone");

  const unknown = response();
  await controller.getCertificate({ params: { kind: "offer-letter" }, user: { id: 1 } }, unknown);
  assert.equal(unknown.statusCode, 404);
});
