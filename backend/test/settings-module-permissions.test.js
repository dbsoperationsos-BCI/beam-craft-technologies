const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { PERMISSIONS } = require("../prisma/seeds/permission-catalogue");

/*
 * Settings is a module of its own, one permission per entry on its rail.
 *
 * `ADMIN / System Settings` was the whole overlay behind a single tick - branding, branches,
 * templates, quotation brands, the login slide, the holidays, the monitoring - so a studio wanting
 * somebody to keep the message wording had to hand them the branding logo the sign-in page, every
 * quotation and the client gallery all read.
 *
 * Three things have to stay true for that split to mean anything, and each is cheap to check:
 * the rows exist, every guard that named the old permission names a new one, and the old row is
 * gone from the catalogue so nothing can quietly go on answering for it.
 */

const root = (...parts) => path.join(__dirname, "..", ...parts);
const read = (...parts) => fs.readFileSync(root(...parts), "utf8");

const SETTINGS = PERMISSIONS.filter((perm) => perm.module === "SETTINGS");

/** The rail, in the order the overlay draws it. User Preference is deliberately absent - see below. */
const RAIL = [
  "User Settings", "Table Settings", "Field Settings", "Project Settings", "Exclude Phone Numbers",
  "Integrations", "Quotation Settings", "Employee Referral", "Message Template", "Organization",
  "Holidays", "Login Slide", "Application Monitoring",
];

test("every entry on the Settings rail is a permission of its own", () => {
  assert.deepEqual(SETTINGS.map((perm) => perm.feature), RAIL);
  const levels = SETTINGS.map((perm) => perm.level);
  assert.equal(new Set(levels).size, levels.length, "two Settings rows share a level, so the seed's upsert would make one of them");
  for (const perm of SETTINGS) assert.ok(perm.displayName && perm.description, `${perm.feature} has no name or description for whoever grants it`);
});

test("User Preference is not among them, and must not become one", () => {
  /*
   * The sidebar order and the appearance are one person's own, stored against their account and
   * read by nothing else. A role that could be refused the right to arrange its own screen is not
   * a permission anybody wants to be able to grant - the same reasoning that keeps
   * `/api/user/preferences` behind `protect` alone.
   */
  assert.ok(!SETTINGS.some((perm) => perm.feature === "User Preference"));
  const overlay = fs.readFileSync(path.join(__dirname, "..", "..", "frontend", "src", "components", "settings", "SettingsOverlay.js"), "utf8");
  assert.doesNotMatch(overlay, /useModuleAccess\("SETTINGS", "User Preference"\)/);
});

test("the permission that used to open all of it is gone from the catalogue", () => {
  // A guard naming a permission the catalogue does not hold refuses everybody but a Super Admin and
  // says so to nobody, so the row going and the guards moving have to be the same change.
  assert.ok(!PERMISSIONS.some((perm) => perm.feature === "System Settings"), "ADMIN / System Settings is still grantable");
  for (const file of [
    ["src", "server.js"],
    ["src", "modules", "settings", "holidays", "routes.js"],
    ["src", "modules", "settings", "message-templates", "routes.js"],
    ["src", "modules", "sales", "quotation-brands", "routes.js"],
    ["src", "modules", "sales", "quotation-settings", "routes.js"],
    ["src", "modules", "usage", "settings", "routes.js"],
    ["src", "modules", "usage", "settings", "controller.js"],
    ["src", "modules", "admin", "branches", "routes.js"],
    ["src", "modules", "image-selection", "settings", "routes.js"],
  ]) {
    assert.doesNotMatch(read(...file), /"System Settings"/, `${file.join("/")} still names the retired permission`);
  }
});

test("each re-pointed guard names the rail entry its screen is", () => {
  assert.match(read("src", "modules", "settings", "holidays", "routes.js"), /requireModule\("SETTINGS", "Holidays"\)/);
  assert.match(read("src", "modules", "settings", "message-templates", "routes.js"), /"SETTINGS", "Message Template"/);
  assert.match(read("src", "modules", "sales", "quotation-brands", "routes.js"), /requireModule\("SETTINGS", "Quotation Settings"\)/);
  assert.match(read("src", "modules", "sales", "quotation-settings", "routes.js"), /feature: "Quotation Settings"/);
  assert.match(read("src", "modules", "usage", "settings", "routes.js"), /checkPermission\("SETTINGS", "Application Monitoring", "READ_WRITE"\)/);
  // Branding and branches are what Organization holds, and Image Selection's own settings panel
  // edits the same studio name and logo - so both answer for the same row.
  assert.match(read("src", "modules", "admin", "branches", "routes.js"), /requireModule\("SETTINGS", "Organization"\)/);
  assert.match(read("src", "modules", "image-selection", "settings", "routes.js"), /requireModule\("SETTINGS", "Organization"\)/);
  assert.match(read("src", "server.js"), /checkPermission\("SETTINGS", "Application Monitoring", "READ"\)/);
});

test("the migration creates every row and carries the old grants onto them", () => {
  const sql = read("prisma", "migrations", "20260915190000_settings_module_permissions", "migration.sql");
  for (const feature of RAIL) assert.ok(sql.includes(`'${feature}'`), `the migration does not create SETTINGS / ${feature}`);
  for (const perm of SETTINGS) assert.ok(sql.includes(`'${perm.level}'`), `the migration writes a different level for ${perm.feature} than the catalogue does`);
  // Copied at the level the role already held, so a role that could open Settings yesterday opens
  // exactly as much of it today - and re-running writes nothing a second time.
  assert.match(sql, /INSERT INTO `role_permission`[\s\S]*`grant`\.`access_level`/);
  assert.match(sql, /WHERE NOT EXISTS \(\s*SELECT 1 FROM `role_permission` AS `already`/);
  // Deactivated rather than deleted, which is what the seed does with a retired permission.
  assert.match(sql, /UPDATE `permission`\s*SET `is_active` = 0/);
});

test("the sections above another module's data keep that module's permission too", () => {
  /*
   * Their endpoints belong to that module and are shared with screens outside Settings - the CRM
   * board, the Interview register, the employee forms, the project register, the referral page -
   * so narrowing them to a Settings row would take those screens with them (CLAUDE.md Rule 4).
   * The Settings row can only withhold the section, never open one the server would refuse.
   */
  const overlay = fs.readFileSync(path.join(__dirname, "..", "..", "frontend", "src", "components", "settings", "SettingsOverlay.js"), "utf8");
  assert.match(overlay, /\.\.\.\(canWrite && canWriteTableSettings \?/);
  assert.match(overlay, /\.\.\.\(canWriteEmployeeLists && canWriteFieldSettings \?/);
  assert.match(overlay, /\.\.\.\(canWrite && canWriteExcludedNumbers \?/);
  /*
   * Integrations is a group of two, one per module its sheets feed. The group needs the Settings
   * row and at least one module; each entry inside it is then gated on its own module's write -
   * Sales on `SALES / CRM Leads` (`canWrite`), Interview on `HRM / Interview` - so a reader holding
   * one module is never shown the other's sheets.
   */
  assert.match(overlay, /\.\.\.\(canWriteIntegrations && \(canWrite \|\| canWriteInterview\) \?/);
  assert.match(overlay, /\.\.\.\(canWrite \? \[\{\s*id: SALES_SHEET_INTEGRATION\.sectionId/);
  assert.match(overlay, /\.\.\.\(canWriteInterview \? \[\{\s*id: INTERVIEW_SHEET_INTEGRATION\.sectionId/);
  assert.match(overlay, /useModuleAccess\("HRM", "Interview"\)/);
  assert.match(overlay, /\.\.\.\(canWriteProjectSettings && canWriteProjectSettingsSection \?/);
  assert.match(overlay, /\.\.\.\(canReadReferrals && canReadReferralSetting \?/);
});

test("nothing decides Settings by the legacy role column", () => {
  /*
   * Two checks used to sit above the whole permission system and silently overrule it: the top
   * bar's account menu withheld the **Settings** row from `user.role === "EMPLOYEE"`, and the
   * overlay then narrowed the rail to User Preference alone for the same test.
   *
   * `user.role` is the legacy column, not a permission. Every account the studio issues through
   * onboarding carries `EMPLOYEE` in it - including one whose IAM role is SUPER_ADMIN - so both
   * checks applied to everybody except the single seeded `admin`, and granting a role its Settings
   * sections changed nothing anybody could see. That is exactly the check CLAUDE.md Rule 4 forbids:
   * it overrules the guard above it and can be granted to nobody.
   */
  const web = (...parts) => fs.readFileSync(path.join(__dirname, "..", "..", "frontend", "src", ...parts), "utf8");
  const topbar = web("components", "app-shell", "AppTopbar.js");
  const overlay = web("components", "settings", "SettingsOverlay.js");

  // The menu row is offered outright - everybody has User Preference, which is not the studio's to
  // withhold - and what is behind it is decided by the thirteen SETTINGS permissions.
  assert.doesNotMatch(topbar, /role === "EMPLOYEE" \? \[\] :/, "the Settings row is hidden by the legacy role column again");
  assert.match(topbar, /\{\s*label: "Settings",\s*\n\s*onSelect:/, "the Settings row is gone from the account menu");

  // And the rail is whatever the permission-gated sections built, with nothing filtering it after.
  assert.doesNotMatch(overlay, /isEmployee/, "the overlay narrows its rail by the legacy role column again");
  assert.match(overlay, /const visibleSections = settingsSections;/);
});
