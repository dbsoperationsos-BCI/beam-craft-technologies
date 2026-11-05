const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { shootStatusSchema } = require("../src/modules/project-management/pre-production/controller");
const { projectHoldSources } = require("../src/services/projectHolds");

/*
 * A shoot's pre production status set by hand: WCR (with its next follow-up), Hold and Rejected (with
 * their remarks), or null - automatic. And where a project is held, by department.
 */
const tomorrow = () => { const date = new Date(); date.setDate(date.getDate() + 1); return date.toISOString().slice(0, 10); };

test("Hold and Rejected need remarks, WCR needs a next follow-up that is not past, null goes back to automatic", () => {
  assert.equal(shootStatusSchema.safeParse({ status: "HOLD" }).success, false);
  assert.equal(shootStatusSchema.safeParse({ status: "HOLD", remarks: "Client travelling" }).success, true);
  assert.equal(shootStatusSchema.safeParse({ status: "REJECTED", remarks: "  " }).success, false);
  assert.equal(shootStatusSchema.safeParse({ status: "WCR" }).success, false);
  assert.equal(shootStatusSchema.safeParse({ status: "WCR", followupDate: "2020-01-01" }).success, false, "not in the past");
  assert.equal(shootStatusSchema.safeParse({ status: "WCR", followupDate: tomorrow() }).success, true, "remarks optional for WCR");
  assert.equal(shootStatusSchema.safeParse({ status: null }).success, true);
  assert.equal(shootStatusSchema.safeParse({ status: "COMPLETED" }).success, false);
  assert.equal(shootStatusSchema.safeParse({ status: "HOLD", remarks: "x", projectId: "p" }).success, false, "nothing else is written");
});

test("the route sits above the row's own save, and WCR adds its follow-up in the same write", () => {
  const routes = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "project-management", "pre-production", "routes.js"), "utf8");
  assert.ok(routes.indexOf('"/:shootId/status"') > -1 && routes.indexOf('"/:shootId/status"') < routes.indexOf('router.patch("/:shootId", controller.updateRow)'));
  const controller = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "project-management", "pre-production", "controller.js"), "utf8");
  const handler = controller.slice(controller.indexOf("async function setShootStatus("), controller.indexOf("/**\n * The started, live project a follow-up request names"));
  assert.match(handler, /if \(status === "WCR"\) \{\s*await transaction\.projectPreProductionFollowupEntry\.create/);
  assert.match(handler, /shoot\.project\.projectStatus === "Yet to Start"/);
});

test("a project is held by each department with a live shoot on Hold; Rejected is not carried up", async () => {
  const client = {
    projectPreProduction: { findMany: async ({ where }) => (where.shootStatus === "HOLD" ? [{ projectId: "p1" }] : []) },
    // The shoot day's Hold or the plan's.
    projectProduction: { findMany: async ({ where }) => (where.OR.every((clause) => Object.values(clause)[0] === "HOLD") ? [{ salesProjectId: "p1" }, { salesProjectId: "p3" }] : []) },
    // A scheduled payment held in Accounts.
    projectPaymentSchedule: { findMany: async ({ where }) => (where.holdAt?.not === null && where.deletedAt === null ? [{ projectId: "p3" }] : []) },
  };
  assert.deepEqual(await projectHoldSources(["p1", "p2", "p3"], { client }), { p1: ["Pre-Production", "Production"], p3: ["Production", "Accounts"] });
  assert.deepEqual(await projectHoldSources([], { client }), {});
});
