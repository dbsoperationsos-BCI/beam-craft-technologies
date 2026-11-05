const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (file) => fs.readFileSync(path.join(__dirname, "..", "src", "modules", "sales", "projects", file), "utf8");
const CONTROLLER = read("controller.js");
const ROUTES = read("routes.js");

test("one project is read with the register's own shape and reach", () => {
  const getProject = CONTROLLER.slice(CONTROLLER.indexOf("async function getProject(req, res) {"), CONTROLLER.indexOf("/**\n * The quotation version a project is converting at"));
  // The same reach as the register: a project the reader could not list is not found here either.
  assert.match(getProject, /const access = await projectAccessWhere\(\{ userId: Number\(req\.user\.id\) \}\);/);
  assert.match(getProject, /where: \{ deletedAt: null, AND: \[\{ OR: \[\{ id: ref \}, \{ eventId: ref \}\] \}, access\] \}/);
  // The same include and the same decoration, so a row patched after an edit is the row the list draws.
  assert.match(getProject, /include: PROJECT_REGISTER_INCLUDE,/);
  assert.match(getProject, /const \[row\] = await registerRows\(\[project\]\);/);
  assert.match(getProject, /return res\.status\(404\)/);
  const list = CONTROLLER.slice(CONTROLLER.indexOf("async function listProjects(req, res) {"), CONTROLLER.indexOf("async function getProject(req, res) {"));
  assert.match(list, /: PROJECT_REGISTER_INCLUDE,/);
  assert.match(list, /return res\.json\(\{ data: await registerRows\(data\) \}\);/);
});

test("the single-project read is guarded like the register and mounted below the named reads", () => {
  assert.match(ROUTES, /router\.get\("\/projects\/:id", readsTheRegister, getProject\);/);
  const single = ROUTES.indexOf('router.get("/projects/:id", readsTheRegister, getProject);');
  for (const named of ['router.get("/projects/advance-options"', 'router.get("/projects/import/template"']) {
    assert.ok(ROUTES.indexOf(named) !== -1 && ROUTES.indexOf(named) < single, `${named} must stay above /projects/:id`);
  }
});

test("the register sends no attachments, and a summary read leaves out each shoot's deliverables and services", () => {
  const include = CONTROLLER.slice(CONTROLLER.indexOf("const PROJECT_REGISTER_INCLUDE = {"), CONTROLLER.indexOf("/** The register's rows as read"));
  assert.doesNotMatch(include, /attachments:/);
  assert.match(include, /const PROJECT_SUMMARY_INCLUDE = \{\n\s+shoots: \{ where: \{ deletedAt: null \}, orderBy: PROJECT_REGISTER_INCLUDE\.shoots\.orderBy \},\n\};/);
  assert.match(CONTROLLER, /include: req\.query\?\.view === "summary" \? PROJECT_SUMMARY_INCLUDE : PROJECT_REGISTER_INCLUDE,/);
});
