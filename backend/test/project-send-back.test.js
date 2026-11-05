const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const iamService = require("../src/services/iam.service");
const router = require("../src/modules/sales/projects/routes");

/*
 * Send Back: Projects returns a project to Bookings & Converted to be corrected. The project itself is
 * marked (`sent_back_at`, by whom) - never copied - and listed under Bookings & Converted's Sent Back
 * tab and left off the Projects page, until its sale details are next edited and saved there, which
 * clears it in the same write. Whoever may write PROJECT / Projects may send one back (the studio's
 * choice); no reason is asked.
 */

const LEVELS = { READ: ["READ", "READ_WRITE"], READ_WRITE: ["READ_WRITE"] };
const read = (...parts) => fs.readFileSync(path.join(__dirname, "..", ...parts), "utf8");
const CONTROLLER = read("src", "modules", "sales", "projects", "controller.js");

async function reaches(grants) {
  const layer = router.stack.find((entry) => entry.route?.path === "/projects/:id/send-back" && entry.route.methods.post);
  assert.ok(layer, "the route exists");
  const held = new Set(grants);
  const original = iamService.hasPermission;
  iamService.hasPermission = async (_userId, module, feature, level) => LEVELS[level || "READ"].some((wanted) => held.has(`${module}/${feature}/${wanted}`));
  try {
    for (const handler of layer.route.stack.map((entry) => entry.handle).slice(0, -1)) {
      const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json() { return this; } };
      let passed = false;
      await handler({ user: { id: 1 }, params: { id: "p1" } }, res, (error) => { passed = !error; });
      if (!passed) return res.statusCode;
    }
    return "allowed";
  } finally {
    iamService.hasPermission = original;
  }
}

test("only whoever may write PROJECT / Projects may send a project back", async () => {
  assert.equal(await reaches(["PROJECT/Projects/READ_WRITE"]), "allowed");
  assert.equal(await reaches(["PROJECT/Projects/READ"]), 403, "reading projects is not enough");
  assert.equal(await reaches(["SALES/Sales Manager/READ_WRITE"]), 403, "the sale's own permission does not send back");
  assert.equal(await reaches(["PROJECT/Production/READ_WRITE", "PROJECT/Pre Production/READ_WRITE"]), 403);
  assert.equal(await reaches([]), 403);
});

test("the project itself is marked once - in the sender's reach, a second Send Back refused", () => {
  const handler = CONTROLLER.slice(CONTROLLER.indexOf("async function sendBackProject("), CONTROLLER.indexOf("async function returnToProjects("));
  assert.match(handler, /projectAccessWhere\(\{ userId: Number\(req\.user\.id\), forWrite: true \}\)/, "only a project in reach");
  // One conditional write: a project already sent back is not written again.
  assert.match(handler, /updateMany\(\{\s*where: \{ id: project\.id, deletedAt: null, sentBackAt: null \},\s*data: \{ sentBackAt: new Date\(\), sentBackByUserId:/);
  assert.match(handler, /if \(!count\) return res\.status\(409\)/);
  assert.match(handler, /action: "SENT_BACK"/);
  assert.doesNotMatch(handler, /salesProject\.create|projectStatus/, "no copy, and its status is left alone");
});

test("Update to Project clears it and puts it under Yet to Start, in the same write, and says so", () => {
  const update = CONTROLLER.slice(CONTROLLER.indexOf("async function updateProject("), CONTROLLER.indexOf("async function updateProject(") + 9000);
  assert.match(CONTROLLER, /const RETURNED_TO_PROJECTS = \{ sentBackAt: null, sentBackByUserId: null, projectStatus: "Yet to Start" \};/);
  // After the form's own fields, so a status the form sent cannot outlive the return.
  assert.match(update, /\.\.\.projectData,[\s\S]*?\.\.\.\(returnedFromSendBack \? RETURNED_TO_PROJECTS : \{\}\),/);
  assert.match(update, /if \(returnedFromSendBack\) await logProjectActivity\(\{[^}]*action: "SEND_BACK_RESOLVED"/);
});

test("Save Draft saves the sale and leaves it sent back - and only a sent-back project has a draft", () => {
  const update = CONTROLLER.slice(CONTROLLER.indexOf("async function updateProject("), CONTROLLER.indexOf("async function updateProject(") + 9000);
  assert.match(update, /const savesDraft = req\.query\.draft === "true";/);
  assert.match(update, /if \(savesDraft && !existing\.sentBackAt\) \{[\s\S]*?error\.status = 409;/);
  assert.match(update, /returnedFromSendBack = Boolean\(existing\.sentBackAt\) && !savesDraft;/);
  /*
   * The Activity line is built from the fields the save actually changed, so a draft says it is a
   * draft **and** then says what changed; "Sale details saved" is the fallback when nothing did.
   */
  assert.match(update, /savesDraft \? "Saved as a draft - still under Sent Back" : null/);
  assert.match(update, /\.\.\.\(saleChanges\.length \? saleChanges : \["Sale details saved"\]\)/);
});

test("Update to Project with nothing changed returns it alone, guarded as the edit is, once", () => {
  const routes = read("src", "modules", "sales", "projects", "routes.js");
  assert.match(routes, /router\.post\("\/projects\/:id\/return-to-projects", answersForAProject, requireProjectEditor, returnToProjects\);/);
  assert.match(routes, /router\.patch\("\/projects\/:id", answersForAProject, requireProjectEditor, updateProject\);/);
  const handler = CONTROLLER.slice(CONTROLLER.indexOf("async function returnToProjects("), CONTROLLER.indexOf("async function listProjectPayments("));
  assert.match(handler, /projectAccessWhere\(\{ userId: Number\(req\.user\.id\), forWrite: true \}\)/, "only a project in reach");
  assert.match(handler, /updateMany\(\{ where: \{ id: project\.id, deletedAt: null, sentBackAt: \{ not: null \} \}, data: RETURNED_TO_PROJECTS \}\)/);
  assert.match(handler, /if \(!count\) return res\.status\(409\)/);
  assert.match(handler, /action: "SEND_BACK_RESOLVED"/);
});

test("the migration adds two empty columns, their indexes and a key - no existing value changes", () => {
  const sql = read("prisma", "migrations", "20261029120000_project_send_back", "migration.sql");
  const statements = sql.split("\n").filter((line) => line.trim() && !line.startsWith("--"));
  assert.equal(statements.length, 4);
  assert.match(statements[0], /^ALTER TABLE `sales_project` ADD COLUMN `sent_back_at` DATETIME\(3\) NULL, ADD COLUMN `sent_back_by_user_id` INT NULL;$/);
  assert.match(statements[3], /FOREIGN KEY \(`sent_back_by_user_id`\) REFERENCES `user`\(`id`\) ON DELETE SET NULL/);
  // No statement changes or removes data: every one adds (the key's own ON DELETE / ON UPDATE aside).
  assert.ok(statements.every((line) => /^(ALTER TABLE|CREATE INDEX)/.test(line)) && !statements.some((line) => /^(UPDATE|DELETE|DROP)/.test(line)));
  assert.doesNotMatch(sql, /DROP /);
});

test("only the CRM side waits for Send Back; everybody else who may edit a project edits it as before", () => {
  const update = CONTROLLER.slice(CONTROLLER.indexOf("async function updateProject("), CONTROLLER.indexOf("async function updateProject(") + 4000);
  assert.match(update, /if \(!existing\.sentBackAt && !\(await mayEditOutsideSendBack\(existing, req\.user\)\)\) \{[\s\S]*?error\.status = 403;/);
  // Every way into `mayEditProject` but Booking Edit - staffed, branch administrator, whoever works
  // every project - and planning projects, edits whether or not the project was sent back.
  const outside = CONTROLLER.slice(CONTROLLER.indexOf("async function mayEditOutsideSendBack("), CONTROLLER.indexOf("async function mayPlanProjects("));
  assert.match(outside, /staffedOn\(project, PROJECT_STAFF_FIELDS, Number\(user\?\.linkedEmployeeId\) \|\| null\)/);
  assert.match(outside, /"ADMIN", "Branch Administration", "READ"/);
  assert.match(outside, /worksEveryProject\(user\)/);
  assert.match(outside, /return mayPlanProjects\(user\.id\);/);
  assert.doesNotMatch(outside, /mayEditBookings|Booking Edit/, "Booking Edit alone is the CRM side, held to Send Back");
  const helper = CONTROLLER.slice(CONTROLLER.indexOf("async function mayPlanProjects("), CONTROLLER.indexOf("async function updateProject("));
  assert.match(helper, /module: "PROJECT", feature: "Projects", level: "READ_WRITE" \}, SHOW_ALL_PROJECTS_WRITE\]/);
});
