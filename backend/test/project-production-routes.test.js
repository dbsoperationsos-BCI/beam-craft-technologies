const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROUTES = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "project-management", "production", "routes.js"), "utf8");
const SERVER = fs.readFileSync(path.join(__dirname, "..", "src", "server.js"), "utf8");

test("the production router is signed-in and guarded by PROJECT / Production before any route but the shoot day's", () => {
  const protectAt = ROUTES.indexOf("router.use(protect)");
  const guardAt = ROUTES.indexOf('router.use(requireModule("PROJECT", "Production"))');
  assert.ok(protectAt > -1 && guardAt > protectAt);
  // Above the guard, only the shoot day's writes - each behind Production or Production Execution at Read / Write.
  const above = [...ROUTES.slice(protectAt, guardAt).matchAll(/router\.(get|post|patch|delete)\(("[^"]+"),\s*([A-Za-z]+)/g)];
  assert.deepEqual(above.map((match) => match[2]), ['"/shoots/:shootId/files"', '"/shoots/:shootId/files/:fileId"', '"/shoots/:shootId/footage"', '"/shoots/:shootId/steps/:step"', '"/shoots/:shootId/pause"']);
  assert.ok(above.every((match) => match[3] === "runsExecution"));
  assert.match(ROUTES, /const runsExecution = checkAnyPermission\(\[\n\s*\{ module: "PROJECT", feature: "Production", level: "READ_WRITE" \},\n\s*\{ module: "PROJECT", feature: "Production Execution", level: "READ_WRITE" \},\n\]\);/);
  // No role check decides access in this module (CLAUDE.md Rule 4).
  assert.doesNotMatch(ROUTES, /req\.user\.role/);
});

test("the router is mounted under /api/project-management/production", () => {
  assert.match(SERVER, /app\.use\("\/api\/project-management\/production", projectProductionRoutes\)/);
});

test("the controller never reads req.user.role", () => {
  const controller = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "project-management", "production", "controller.js"), "utf8");
  assert.doesNotMatch(controller, /req\.user\.role/);
});

test("the plan body is strict: an unknown key is refused rather than written", () => {
  const { planSchema } = require("../src/modules/project-management/production/controller");
  assert.equal(planSchema.safeParse({ remarks: "x", planSubmittedAt: "2026-01-01" }).success, false);
  assert.equal(planSchema.safeParse({ travelMode: "Rocket" }).success, false);
  assert.ok(planSchema.safeParse({ submit: true, productionCoordinatorEmployeeId: 9, travelMode: "Train" }).success);
  // No Production Team on the plan: the team is the coordinator and each service's people.
  assert.equal(planSchema.safeParse({ teamEmployeeIds: [1, 2] }).success, false);
});

test("POST /shoots/:shootId/files is rate-limited", () => {
  assert.match(ROUTES, /router\.post\("\/shoots\/:shootId\/files",\s*runsExecution,\s*fileUploadLimiter,\s*controller\.addFiles\)/);
  assert.match(ROUTES, /createRateLimiter\(\{/);
});

test("POST /shoots/:shootId/messages/:step/retry is rate-limited, per user - the studio's WhatsApp number is bannable", () => {
  assert.match(ROUTES, /router\.post\("\/shoots\/:shootId\/messages\/:step\/retry",\s*messageRetryLimiter,\s*controller\.retryMessage\)/);
  assert.match(ROUTES, /messageRetryLimiter = createRateLimiter\(\{/);
});

test("the files body is capped well under the server's JSON body limit", () => {
  const { filesSchema } = require("../src/modules/project-management/production/controller");
  const oneFile = { data: "data:image/png;base64," + "A".repeat(10) };
  // More than 5 files in one request is refused.
  assert.equal(filesSchema.safeParse({ kind: "HAPPENING_NOW", files: Array.from({ length: 6 }, () => oneFile) }).success, false);
  assert.ok(filesSchema.safeParse({ kind: "HAPPENING_NOW", files: Array.from({ length: 5 }, () => oneFile) }).success);
  // One file over the per-file ceiling is refused with a clean 400-shaped zod error, not left to
  // the server's raw 413.
  const hugeFile = { data: "data:image/png;base64," + "A".repeat(7_500_001) };
  assert.equal(filesSchema.safeParse({ kind: "HAPPENING_NOW", files: [hugeFile] }).success, false);
  // Several files, each under its own ceiling, whose total is still too much for one request.
  const bigFile = { data: "data:image/png;base64," + "A".repeat(5_000_000) };
  const overBatch = filesSchema.safeParse({ kind: "HAPPENING_NOW", files: [bigFile, bigFile, bigFile, bigFile, bigFile] });
  assert.equal(overBatch.success, false);
});

test("a ticket upload may carry the travel mode it is picking, only as Bus, Train or Flight", () => {
  const { filesSchema } = require("../src/modules/project-management/production/controller");
  const oneFile = { data: "data:application/pdf;base64,JVBERi0xLjQ=" };
  assert.ok(filesSchema.safeParse({ kind: "TICKET", files: [oneFile], travelMode: "Train" }).success);
  // Not a ticket mode.
  assert.equal(filesSchema.safeParse({ kind: "TICKET", files: [oneFile], travelMode: "Car" }).success, false);
  // travelMode only makes sense for a ticket upload.
  assert.equal(filesSchema.safeParse({ kind: "HAPPENING_NOW", files: [oneFile], travelMode: "Train" }).success, false);
  // Still optional.
  assert.ok(filesSchema.safeParse({ kind: "TICKET", files: [oneFile] }).success);
});

test("pre-production and production routes load in either order without a require cycle", () => {
  // `pre-production/controller.js` requires `production/http.js` for `respond` - a shared,
  // dependency-free module, not `production/controller.js` itself - and production requires nothing
  // of pre production (its travel modes live in `production/travel.js`), so the two controllers
  // never require each other and neither can see the other's exports still empty mid-load.
  delete require.cache[require.resolve("../src/modules/project-management/pre-production/routes")];
  delete require.cache[require.resolve("../src/modules/project-management/production/routes")];
  delete require.cache[require.resolve("../src/modules/project-management/pre-production/controller")];
  delete require.cache[require.resolve("../src/modules/project-management/production/controller")];
  for (const file of ["controller", "read", "plan", "execution", "service"]) {
    const source = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "project-management", "production", `${file}.js`), "utf8");
    assert.doesNotMatch(source, /require\("\.\.\/pre-production/, `production/${file}.js requires nothing of pre production`);
  }
  assert.doesNotThrow(() => require("../src/modules/project-management/pre-production/routes"));
  assert.doesNotThrow(() => require("../src/modules/project-management/production/routes"));
});

test("Footage Location is plain text: a link, a disk or a shelf all save; only an empty one is refused", () => {
  const { stepSchema } = require("../src/modules/project-management/production/controller");
  const entry = (footageUrl) => ({ footage: [{ serviceDefinitionId: null, footageUrl, backedUpByEmployeeId: 1, fileCount: 1, size: "1 GB", firstFileName: "a", lastFileName: "b", remarks: "r" }] });
  // Footage goes to Drive, to the NAS, and onto a disk that lives on a shelf; all three are answers.
  for (const where of ["https://drive.google.com/drive/folders/abc", "drive.google.com/drive/folders/abc", "Seagate HDD 3, Reception shelf"]) {
    assert.equal(stepSchema.parse(entry(where)).footage[0].footageUrl, where, where);
  }
  const blank = stepSchema.safeParse(entry("  "));
  assert.equal(blank.success, false);
  assert.equal(blank.error.issues[0].message, "Enter the footage location.");
});

test("a failed check answers with its own reason, not \"Validation failed\"", () => {
  const { invalid } = require("../src/modules/project-management/production/http");
  const { stepSchema } = require("../src/modules/project-management/production/controller");
  let body;
  invalid({ status: () => ({ json: (value) => { body = value; } }) }, stepSchema.safeParse({ footage: [{ serviceDefinitionId: null, footageUrl: "", backedUpByEmployeeId: 1, fileCount: 1, size: "1 GB", firstFileName: "a", lastFileName: "b", remarks: "r" }] }));
  assert.equal(body.message, "Enter the footage location.");
});
