const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

/*
 * The advance a project is booked with, under the permission that booked it.
 *
 * ── The question that was being asked, and the one that should have been ─────────────────────
 *
 * The advance is a cash entry, so Create Project showed Payment Received only to somebody holding
 * `ACCOUNTS / Cash Management`. That is the right guard for the cash book - being able to record any
 * entry against any project is being trusted with the studio's books - but it is not the question
 * this form asks. The person booking a project is typing what the client just handed over, against
 * the project they are creating. Holding that behind the whole cash book left two bad options:
 * give project creators the books, or book projects with the advance left off for somebody else to
 * type in later.
 *
 * So the act keeps a guard of its own rather than losing one. `POST /api/sales/projects/:id/advance`
 * answers to `SALES / Sales Manager` - the same permission that just created the project - and
 * writes through the Accounts module's own `recordCashEntry`, so the row, its validation and its
 * branch check are the ones Accounts applies to everything else. `hrm/payment-requests` already
 * writes a cash entry this way under its own permission; this is that pattern, not a new one.
 *
 * What this file holds is the narrowness. A route that lets somebody without `ACCOUNTS` write to the
 * cash book has to be able to write *only* this: money in, on a project they can reach, in a branch
 * they can reach.
 */

const read = (...parts) => fs.readFileSync(path.join(__dirname, "..", "src", "modules", "sales", "projects", ...parts), "utf8");
const ROUTES = read("routes.js");
const CONTROLLER = read("controller.js");

const handler = (() => {
  const start = CONTROLLER.indexOf("async function recordProjectAdvance(req, res)");
  assert.notEqual(start, -1, "recordProjectAdvance was not found");
  const end = CONTROLLER.indexOf("\nasync function createProject(", start);
  assert.notEqual(end, -1, "the end of recordProjectAdvance was not found");
  return CONTROLLER.slice(start, end);
})();

test("it is guarded by the permission that books a project", () => {
  assert.match(ROUTES, /router\.post\("\/projects\/:id\/advance", salesManager, recordProjectAdvance\);/);
  // The same guard the create beside it uses, so the two cannot drift apart.
  assert.match(ROUTES, /router\.post\("\/projects", salesManager, createProject\);/);
  assert.match(ROUTES, /const salesManager = requireModule\("SALES", "Sales Manager"\);/);
});

test("nothing about the cash book's own guard moved", () => {
  /*
   * The point of putting this route here is that `ACCOUNTS / Cash Management` goes on meaning what
   * it meant: every other way of writing a cash entry still asks for it.
   */
  const cashRoutes = fs.readFileSync(
    path.join(__dirname, "..", "src", "modules", "accounts", "cash-entries", "routes.js"),
    "utf8",
  );
  assert.match(cashRoutes, /router\.use\(requireModule\("ACCOUNTS", "Cash Management"\)\);/);
});

test("the project comes from the URL, never from the body", () => {
  /*
   * The body is the form's, and a body that could name its own project would let somebody file an
   * advance against a project they cannot reach - which is most of what the cash-book permission
   * was protecting.
   */
  assert.match(handler, /projectId: project\.id,/);
  assert.match(handler, /const id = String\(req\.params\.id \|\| ""\)\.trim\(\);/);
  // Read back and checked before anything is written, so an unknown project is a 404 rather than an
  // entry filed against nothing.
  assert.match(handler, /findFirst\(\{ where: \{ id, deletedAt: null \}/);
  assert.match(handler, /return res\.status\(404\)/);
  // The spread comes first, so neither of the two fields below can be overridden by the body.
  assert.ok(handler.indexOf("...req.body") < handler.indexOf("projectId: project.id"));
});

test("it can only ever record money coming in", () => {
  /*
   * The other half of the narrowness. Left to the body, this route would be a way to record studio
   * *spending* without the permission for it - which is a far bigger thing than a booking advance.
   */
  assert.match(handler, /entryType: "Received",/);
  assert.ok(handler.indexOf("...req.body") < handler.indexOf('entryType: "Received"'));
});

test("it is held to the same validation and branch reach as the cash book", () => {
  // The Accounts module's own recorder and its own form schema - not a second idea of what a cash
  // entry is, which would drift from the first.
  assert.match(handler, /recordCashEntry\(/);
  assert.match(handler, /schema: cashFormEntrySchema/);
  // Branch reach stays enforced: bookable here does not mean filable into any branch.
  assert.match(handler, /enforceBranchReach: true/);
  assert.match(CONTROLLER, /require\("\.\.\/\.\.\/accounts\/cash-entries\/controller"\)/);
});

test("the form no longer asks for the cash book's permission", () => {
  const panel = fs.readFileSync(
    path.join(__dirname, "..", "..", "frontend", "src", "components", "sales", "CreateProjectFormPanel.js"),
    "utf8",
  );
  assert.match(panel, /const showAdvance = mode === "create";/);
  assert.doesNotMatch(panel, /useModuleAccess\("ACCOUNTS", "Cash Management"\)/, "the section is gated on the cash book again");
});

/*
 * ── The dropdowns behind the section have to be reachable too ────────────────────────────────
 *
 * Showing Payment Received to whoever may book a project is only half the job. Its Receiver and
 * Account dropdowns were read from `GET /api/accounts/cash-entries/options`, which sits behind
 * `ACCOUNTS / Cash Management` like the rest of that router - so for exactly the people the section
 * had just been shown to, the call came back 403 and the Receiver dropdown was **empty**. A
 * required field with nothing in it, which stopped the project being created at all: worse than not
 * showing them the section in the first place.
 */
test("the advance's own options are served under the same guard as the advance", () => {
  assert.match(ROUTES, /router\.get\("\/projects\/advance-options", salesManager, projectAdvanceOptions\);/);
});

test("that route sits above the ones that read an id", () => {
  // Or "advance-options" is read as a project id and the request 404s on a project nobody named.
  const optionsAt = ROUTES.indexOf('router.get("/projects/advance-options"');
  const idAt = ROUTES.search(/router\.(get|patch|delete)\("\/projects\/:id"/);
  assert.ok(optionsAt !== -1 && idAt !== -1 && optionsAt < idAt, "the fixed segment fell below the :id routes");
});

test("it serves the two lists the advance needs, and not the studio's lookups", () => {
  /*
   * Accounts' own options also return every project and every shoot for its pickers. The advance
   * needs neither - it is filed against the project in the URL - and widening one permission is not
   * a reason to hand over everything another screen happens to read.
   */
  const handler = CONTROLLER.slice(
    CONTROLLER.indexOf("async function projectAdvanceOptions(req, res)"),
    CONTROLLER.indexOf("\nasync function recordProjectAdvance("),
  );
  assert.match(handler, /prisma\.employee\.findMany/);
  /*
   * The accounts come from the branch register through `receivedIntoOptions`, which is the one place
   * they are kept since Accounts' own bank-account list was retired - and the one place the label
   * these three screens store on their records is built.
   */
  assert.match(handler, /receivedIntoOptions\(\)/);
  assert.doesNotMatch(handler, /salesProject\.findMany|projectShoot\.findMany/, "the advance options leak the studio's project and shoot lookups");
  // Working employees only, the same rule every other employee picker follows.
  assert.match(handler, /employmentStatus: \{ in: await workingEmployeeStatuses\(\) \}/);
});

test("the form reads them from there, not from Accounts", () => {
  const panel = fs.readFileSync(
    path.join(__dirname, "..", "..", "frontend", "src", "components", "sales", "CreateProjectFormPanel.js"),
    "utf8",
  );
  assert.match(panel, /getProjectAdvanceOptions\(\)/);
  assert.doesNotMatch(panel, /getCashEntryOptions/, "the panel reads the cash book's options again");
});
