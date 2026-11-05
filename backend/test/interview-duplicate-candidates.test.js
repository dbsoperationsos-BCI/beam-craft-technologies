const test = require("node:test");
const { mock } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const service = require("../src/modules/hrm/interview/service");
const { findDuplicateCandidate, createCandidate } = service;
const { batchCandidateClashes } = require("../src/modules/hrm/interview/controller");

/*
 * One person, one row on the Interview register.
 *
 * Three of the four ways into the register used to allow the same candidate twice: **Add
 * Application**, **Bulk Entry** and the **CSV import** wrote whatever they were given. Only the
 * Google Sheet importer checked, because it classifies every row against the register before
 * writing any of them. So a candidate who applied twice, or a file imported twice, became two
 * records — two stages, two sets of remarks, and an interview booked against the copy nobody is
 * reading.
 *
 * The check lives in `createCandidate`, which is where all three of those meet. That placement is
 * the point: written at the routes it would be three copies and absent from the fourth way in
 * somebody adds later.
 *
 * Matched on **phone or email**, on the sheet importer's own normalised keys, so the register has
 * one idea of what "the same person" means rather than one per way in. Names are deliberately not
 * matched: two Priya Sharmas are two people.
 *
 * The matcher takes its database client, so everything below is the real function against a stub -
 * real behaviour, no database, and it fails on the edit rather than on the report.
 */

const read = (...parts) => fs.readFileSync(path.join(__dirname, "..", ...parts), "utf8");
const SERVICE = read("src", "modules", "hrm", "interview", "service.js");
const CONTROLLER = read("src", "modules", "hrm", "interview", "controller.js");
const INVITES = read("src", "modules", "hrm", "interview", "invites.js");

/** A stand-in register: whatever rows are given, and a note of what it was asked. */
function registerOf(rows) {
  const asked = [];
  return {
    asked,
    hrmInterviewCandidate: {
      findMany: async (query) => { asked.push(query); return rows; },
      create: async () => { throw new Error("nothing should have been written"); },
    },
  };
}

const RANI = { id: "c1", candidateCode: "DBS-INTV-005866", name: "Rani Samuel", phone: "7386003130", email: "rani@example.com" };

test("the same number in a different shape is the same person", async () => {
  // How a number is typed is not who it belongs to: a sheet gives ten bare digits, the form stores
  // "+91 7386003130", and somebody typing it in puts a space in the middle.
  for (const typed of ["7386003130", "73860 03130", "+91 7386003130", "+917386003130", "073860 03130"]) {
    const found = await findDuplicateCandidate({ phone: typed }, registerOf([RANI]));
    assert.equal(found?.candidate?.candidateCode, "DBS-INTV-005866", `${typed} was not recognised`);
    assert.equal(found.matchedBy, "phone number");
  }
});

test("the same address in a different case is the same person", async () => {
  for (const typed of ["rani@example.com", "Rani@Example.COM", "  RANI@EXAMPLE.COM  "]) {
    const found = await findDuplicateCandidate({ email: typed }, registerOf([RANI]));
    assert.equal(found?.candidate?.candidateCode, "DBS-INTV-005866", `${typed} was not recognised`);
    assert.equal(found.matchedBy, "email");
  }
});

test("the last ten digits narrow the search, and the comparison settles it", () => {
  /*
   * The stored shape is not the match key, so this is read in two steps. The database can only find
   * the last ten digits inside a formatted number; the proper comparison is made afterwards in code.
   * Without that second step a +1 number and a +91 number ending the same way would be one person.
   */
  return findDuplicateCandidate({ phone: "+1 7386003130" }, registerOf([RANI])).then((found) => {
    assert.equal(found, null, "two different countries' numbers were treated as one person");
  });
});

test("an address is believed before a number", async () => {
  // A number can be a household's or an agency's; an address is typed once and belongs to one
  // person. The screening invite resolves a candidate in this order too, and now literally so.
  const other = { ...RANI, id: "c2", candidateCode: "DBS-INTV-000002", email: "someone.else@example.com" };
  const found = await findDuplicateCandidate({ phone: "7386003130", email: "rani@example.com" }, registerOf([other, RANI]));
  assert.equal(found.candidate.candidateCode, "DBS-INTV-005866");
  assert.equal(found.matchedBy, "email");
});

test("a candidate with neither a number nor an address is not refused", async () => {
  // A referral often arrives as a name and nothing else. There is nothing to match on, so there is
  // nothing to refuse - and the register must not start rejecting real records.
  const register = registerOf([RANI]);
  assert.equal(await findDuplicateCandidate({ name: "Someone New" }, register), null);
  assert.equal(await findDuplicateCandidate({ phone: "", email: "  " }, register), null);
  // And not even asked: a query with no clause would match the first row of the whole register.
  assert.equal(register.asked.length, 0);
});

test("a record being edited is not its own duplicate", async () => {
  const register = registerOf([RANI]);
  await findDuplicateCandidate({ phone: "7386003130" }, register, "c1");
  assert.deepEqual(register.asked[0].where.id, { not: "c1" });
});

test("the deleted are not consulted", async () => {
  const register = registerOf([]);
  await findDuplicateCandidate({ phone: "7386003130" }, register);
  assert.equal(register.asked[0].where.deletedAt, null);
});

test("a duplicate is refused before anything is written", async () => {
  // The stub throws if `create` is reached, so this fails rather than passes if the guard is moved
  // below the write.
  await assert.rejects(
    () => createCandidate({ name: "Rani Samuel", phone: "7386003130" }, null, registerOf([RANI])),
    (error) => {
      assert.equal(error.status, 409);
      // Named, so the studio can go and look at the record rather than hunt for it.
      assert.match(error.message, /Rani Samuel — DBS-INTV-005866 is already on the register with this phone number\./);
      return true;
    },
  );
});

test("all three ways in go through the one creator, so all three are covered", () => {
  // Add Application, the CSV import, and Bulk Entry - which loops the same call. None of them may
  // write a candidate any other way, or that way is a hole.
  assert.match(CONTROLLER, /service\.createCandidate\(withSource\(parsed\.data, MANUAL_SOURCE\), req\.user\)/);
  assert.match(CONTROLLER, /create: async \(input\) => \{ await service\.createCandidate\(withSource\(input, CSV_IMPORT_SOURCE\), req\.user\); \}/);
  assert.match(SERVICE, /created\.push\(await createCandidate\(record, actor\)\)/);
  // Sequential, which is what makes two copies *within* one batch or one file catch each other:
  // the second is checked against the first, which is on the register by then.
  assert.match(SERVICE, /for \(const \[index, record\] of \(Array\.isArray\(records\) \? records : \[\]\)\.entries\(\)\)/);
});

test("the edit form cannot make a duplicate either", () => {
  // Otherwise "enter them twice" is refused and "enter them wrong, then correct it" is not.
  assert.match(SERVICE, /const clash = await findDuplicateCandidate\(changing, prisma, existing\.id\);/);
  // Only against what is being changed, so re-saving an untouched record is never refused.
  assert.match(SERVICE, /if \(changing\.phone !== undefined \|\| changing\.email !== undefined\)/);
});

test("the screening invite reuses a candidate by the very same rule", () => {
  /*
   * It has always reused an existing candidate rather than making a second one. Now that
   * `createCandidate` *refuses* a duplicate, the two had to stop being separate pieces of code: any
   * gap between "what this reuses" and "what that refuses" would be an invite that cannot be raised
   * at all.
   */
  assert.match(INVITES, /const clash = await service\.findDuplicateCandidate\(\{ email: data\.candidateEmail, phone: data\.candidatePhone \}\);/);
  assert.match(INVITES, /if \(clash\) return prisma\.hrmInterviewCandidate\.findFirst\(\{ where: \{ id: clash\.candidate\.id \} \}\);/);
});

/* ── A whole batch, answered before any of it is written ─────────────────────────────────────── */

/** Runs the batch check with the register stubbed to hold whatever rows are given. */
async function clashesFor(records, held = []) {
  const find = mock.method(service, "findDuplicateCandidate", async ({ phone }) => {
    const digits = String(phone || "").replace(/\D/g, "").slice(-10);
    const row = digits && held.find((entry) => String(entry.phone).replace(/\D/g, "").slice(-10) === digits);
    return row ? { candidate: row, matchedBy: "phone number" } : null;
  });
  try {
    return await batchCandidateClashes(records);
  } finally {
    find.mock.restore();
  }
}

test("a batch is checked against the register before any of it is written", async () => {
  const clashes = await clashesFor(
    [{ name: "New Person", phone: "9000000123" }, { name: "Already Here", phone: "73860 03130" }],
    [RANI],
  );
  assert.equal(clashes.length, 1);
  assert.equal(clashes[0].row, 2);
  assert.match(clashes[0].reason, /already on the register/);
  assert.equal(clashes[0].candidateCode, "DBS-INTV-005866");
});

test("a batch is checked against itself, not only against the register", async () => {
  /*
   * Two rows of one paste carrying the same number are both new, so neither is found by a lookup -
   * a per-row check passes both and writes the duplicate it exists to prevent. This is the case no
   * amount of checking one row at a time can catch.
   */
  const clashes = await clashesFor([
    { name: "First", phone: "+91 9000000123" },
    { name: "Filler", phone: "9000000999" },
    { name: "Same Person Again", phone: "9000000123" },
  ]);
  assert.equal(clashes.length, 1);
  assert.equal(clashes[0].row, 3);
  // The row it repeats, so the reader is sent to the pair rather than to one of them.
  assert.equal(clashes[0].duplicateOfRow, 1);
  assert.match(clashes[0].reason, /already on candidate 1 of this batch/);
});

test("every clashing row is reported, not the first", async () => {
  // A grid is corrected in one pass. Naming one row at a time means submitting the same batch five
  // times to find five problems.
  const clashes = await clashesFor([
    { name: "A", phone: "7386003130" },
    { name: "B", phone: "9000000123" },
    { name: "C", phone: "7386003130" },
  ], [RANI]);
  assert.deepEqual(clashes.map((entry) => entry.row), [1, 3]);
});

test("a row with nothing to match on is not a clash", async () => {
  // Bulk Entry does not ask for an email, and a candidate can be entered from a referral with only
  // a name. Neither is a duplicate of anything.
  assert.deepEqual(await clashesFor([{ name: "No Contact Details" }, { name: "Blank", phone: "  " }], [RANI]), []);
});

test("the refused batch writes nothing and says what the browser needs", () => {
  const body = CONTROLLER.slice(CONTROLLER.indexOf("async function createBulk("));
  // Checked before the creator is reached, or half the batch is on the register and half is not -
  // and candidate codes are burned on rows that were never written.
  const checked = body.indexOf("batchCandidateClashes(parsed.data.records)");
  const written = body.indexOf("createCandidatesBulk(");
  assert.ok(checked !== -1 && written !== -1 && checked < written, "the batch is written before it is checked");
  // The code the browser tells this apart by, and the rows it marks the grid from.
  assert.match(body, /code: "DUPLICATE_CANDIDATE"/);
  assert.match(body, /errors: clashes/);
});

test("a refusal carries the record it is about, not just a sentence", () => {
  // A screen given only the message cannot offer to open the candidate it clashed with, which is
  // the one thing the reader wants next.
  assert.match(SERVICE, /code: "DUPLICATE_CANDIDATE"/);
  assert.match(SERVICE, /candidateCode: clash\.candidate\.candidateCode/);
  // And the controller has to pass both through, or they stop at the edge.
  assert.match(CONTROLLER, /\.\.\.\(error\.code \? \{ code: error\.code \} : \{\}\)/);
  assert.match(CONTROLLER, /\.\.\.\(error\.data \? \{ data: error\.data \} : \{\}\)/);
});

test("an edit is refused only where it actually changes the number or the address", () => {
  /*
   * The register already holds duplicates - it ran for months with nothing asking this question -
   * and `exceptId` stops a candidate clashing with itself but not with the second row that already
   * shares its number. Guarding an unchanged value would make both of those rows uneditable, so
   * nobody could open one and correct it, which is the single action that resolves the duplicate.
   */
  assert.match(SERVICE, /normalizePhone\(values\.phone\) !== normalizePhone\(existing\.phone\)/);
  assert.match(SERVICE, /normalizeEmail\(values\.email\) !== normalizeEmail\(existing\.email\)/);
});

/* ── What the forms ask while a number is being typed ────────────────────────────────────────── */

test("the register can be asked who it already holds, before anything is saved", () => {
  // A refusal that arrives after somebody has filled in a whole application arrives too late. The
  // forms ask as the number is typed, which needs a read of its own.
  assert.match(CONTROLLER, /async function duplicates\(req, res\)/);
  assert.match(CONTROLLER, /service\.matchingCandidates\(/);
  // Enough of each record to be recognised: a warning naming nothing is a warning nobody can act on.
  assert.match(CONTROLLER, /candidateCode: candidate\.candidateCode/);
  assert.match(CONTROLLER, /matchedBy,/);
});

test("the warning and the refusal answer the same question", () => {
  /*
   * They share `matchingCandidates` deliberately. Two definitions of "the same person" would be a
   * form that warns about something it then accepts, or accepts something it then refuses - and the
   * second is worse, because the studio has by then typed the whole record.
   */
  assert.match(SERVICE, /async function findDuplicateCandidate\(values, client = prisma, exceptId = ""\) \{\s*\n\s*const \[first\] = await matchingCandidates\(values, client, exceptId\);/);
});

test("the check route is declared before the one that takes an id", () => {
  // `/candidates/:id` would otherwise swallow it and answer "candidate not found" for a check.
  const routes = read("src", "modules", "hrm", "interview", "routes.js");
  const lines = routes.split("\n").map((line) => line.trim());
  const at = (needle) => lines.findIndex((line) => line.startsWith(needle));
  assert.ok(at('router.get("/candidates/duplicates"') > -1, "the check route is missing");
  assert.ok(at('router.get("/candidates/duplicates"') < at('router.get("/candidates/:id"'));
});

test("the check is a read, so the register's own permission covers it", () => {
  // It returns nothing that reading the register does not already show, so it needs no permission
  // of its own - and it must not be mounted outside the router's guard.
  const routes = read("src", "modules", "hrm", "interview", "routes.js");
  const guard = routes.indexOf('router.use(requireModule("HRM", "Interview"))');
  assert.ok(guard > -1, "the router no longer guards itself on HRM / Interview");
  assert.ok(guard < routes.indexOf('router.get("/candidates/duplicates"'), "the check route is mounted above the guard");
});
