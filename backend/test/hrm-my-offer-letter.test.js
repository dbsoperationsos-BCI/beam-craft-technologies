const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

/*
 * My Profile → Offer Letter: the signed-in employee's own letter, on every employee's profile by
 * default, ready once the days Settings names have passed since their date of joining.
 */

const { offerAvailability, offerLetterFileName } = require("../src/services/offerLetterDocument");
const read = (...parts) => fs.readFileSync(path.join(__dirname, "..", ...parts), "utf8");

test("the letter comes the days after joining Settings names - counted in India's calendar", () => {
  const joined = new Date("2026-08-01T00:00:00Z");
  // 45 days after 1 August is 15 September.
  assert.deepEqual(offerAvailability(joined, 45, new Date("2026-09-14T12:00:00Z")), { status: "PENDING", availableOn: "2026-09-15" });
  assert.deepEqual(offerAvailability(joined, 45, new Date("2026-09-14T19:00:00Z")), { status: "READY", availableOn: "2026-09-15" });
  assert.equal(offerAvailability(joined, 0, new Date("2026-08-01T06:00:00Z")).status, "READY");
  assert.deepEqual(offerAvailability(joined, null), { status: "NOT_SET", availableOn: null });
  assert.deepEqual(offerAvailability(null, 45), { status: "NO_JOINING_DATE", availableOn: null });
});

test("named after the employee, nothing in the name but letters, digits and dashes", () => {
  assert.equal(offerLetterFileName({ employeeName: "Kavya R. <Raman>" }), "Offer-Letter-Kavya-R-Raman.pdf");
  assert.equal(offerLetterFileName({}), "Offer-Letter-employee.pdf");
});

test("signed in is the guard - every employee's own letter, by default - mounted, no permission to tick", () => {
  const routes = read("src", "modules", "hrm", "my-offer-letter", "routes.js");
  assert.match(routes, /router\.use\(protect\);/);
  assert.doesNotMatch(routes, /requireModule|checkPermission/);
  // No id to ask for: only the signed-in login's own employee.
  assert.doesNotMatch(routes, /:id|:employeeId/);
  assert.match(read("src", "server.js"), /app\.use\("\/api\/hrm\/my-offer-letter", hrmMyOfferLetterRoutes\);/);
  const controller = read("src", "modules", "hrm", "my-offer-letter", "controller.js");
  assert.match(controller, /offerDocument\.offerEmployeeOfUser\(userId\)/);
  assert.match(controller, /if \(letter\.status !== "READY"\) return res\.status\(409\)/);
  assert.doesNotMatch(read("prisma", "seeds", "permission-catalogue.js"), /My Offer Letter/);
});

test("Settings' preview and the employee's letter are put together in one place", () => {
  const settings = read("src", "modules", "settings", "certificates", "controller.js");
  assert.match(settings, /require\("\.\.\/\.\.\/\.\.\/services\/offerLetterDocument"\)/);
  assert.match(settings, /offer: \{ label: "Offer Letter", columns: OFFER_SIGNOFF_COLUMNS \}/);
  assert.doesNotMatch(settings, /async function readOfferSections/);
});

/** A response that records what the controller answered. */
const response = () => ({
  headers: {},
  status(code) { this.code = code; return this; },
  json(body) { this.body = body; return this; },
  setHeader(name, value) { this.headers[name] = value; },
  end(body) { this.sent = body; return this; },
});

function stubLetter(t, { employee, afterDays }) {
  const offerDocument = require("../src/services/offerLetterDocument");
  const certificates = require("../src/services/experienceCertificate");
  t.mock.method(offerDocument, "offerEmployeeOfUser", async () => employee);
  t.mock.method(offerDocument, "offerLetterAfterDays", async () => afterDays);
  t.mock.method(offerDocument, "employeeOfferLetterHtml", async () => "<html>letter</html>");
  t.mock.method(certificates, "renderCertificatePdf", async () => Buffer.from("%PDF-1.4"));
  return require("../src/modules/hrm/my-offer-letter/controller");
}

test("a login with no employee record is told so - 404, on the letter and on the PDF", async (t) => {
  const controller = stubLetter(t, { employee: null, afterDays: 45 });
  const read = response();
  await controller.getMyOfferLetter({ user: { id: 9 } }, read);
  assert.equal(read.code, 404);
  const pdf = response();
  await controller.downloadMyOfferLetter({ user: { id: 9 } }, pdf);
  assert.equal(pdf.code, 404);
  assert.equal(pdf.sent, undefined);
});

/**
 * The day after today **on the studio's calendar**, as a date-only value - which is how a joining
 * date is stored and how `offerAvailability` reads one.
 *
 * `Date.now() + 86400000` is not that. It is twenty-four hours later, read in UTC, while the letter
 * asks what today is in Asia/Kolkata - and from 18:30 UTC (midnight in the studio) the two are the
 * same day, so "a joiner tomorrow" was already a joiner today and the letter came back READY. The
 * test passed all day and failed every evening.
 */
function studioTomorrow(now = new Date()) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(now);
  const day = new Date(`${today}T00:00:00.000Z`);
  day.setUTCDate(day.getUTCDate() + 1);
  return day;
}

test("before the day, the letter says when and the PDF is refused - 409, nothing printed", async (t) => {
  const tomorrowJoiner = { employeeName: "Kavya", dateOfJoining: studioTomorrow() };
  const controller = stubLetter(t, { employee: tomorrowJoiner, afterDays: 0 });
  const read = response();
  await controller.getMyOfferLetter({ user: { id: 9 } }, read);
  assert.equal(read.body.data.status, "PENDING");
  assert.equal(read.body.data.html, null);
  const pdf = response();
  await controller.downloadMyOfferLetter({ user: { id: 9 } }, pdf);
  assert.equal(pdf.code, 409);
  assert.equal(pdf.sent, undefined);
});

test("with no days set, nobody's letter comes", async (t) => {
  const controller = stubLetter(t, { employee: { employeeName: "Kavya", dateOfJoining: new Date("2025-01-01T00:00:00Z") }, afterDays: null });
  const read = response();
  await controller.getMyOfferLetter({ user: { id: 9 } }, read);
  assert.equal(read.body.data.status, "NOT_SET");
  assert.equal(read.body.data.html, null);
});

test("once ready: the letter to read, and the PDF under the employee's name", async (t) => {
  const controller = stubLetter(t, { employee: { employeeName: "Kavya Raman", dateOfJoining: new Date("2025-01-01T00:00:00Z") }, afterDays: 45 });
  const read = response();
  await controller.getMyOfferLetter({ user: { id: 9 } }, read);
  assert.deepEqual(read.body.data, { status: "READY", availableOn: "2025-02-15", fileName: "Offer-Letter-Kavya-Raman.pdf", html: "<html>letter</html>" });
  const pdf = response();
  await controller.downloadMyOfferLetter({ user: { id: 9 } }, pdf);
  assert.equal(pdf.code, undefined);
  assert.equal(pdf.headers["Content-Type"], "application/pdf");
  assert.equal(pdf.headers["Content-Disposition"], 'attachment; filename="Offer-Letter-Kavya-Raman.pdf"');
  assert.equal(String(pdf.sent), "%PDF-1.4");
});
