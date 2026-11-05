const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const { PERMISSIONS, SCOPES } = require("../prisma/seeds/permission-catalogue");

/*
 * Role Management and the sidebar have to describe the same application.
 *
 * They are drawn from different places and always were: the menu from
 * `frontend/src/constants/navigation.mjs`, the role form from the `permission` rows this
 * catalogue seeds, and the join between them from `modulePermissions.js`, which says which
 * permission each *route* answers to. Nothing held the three to each other, and they drifted in
 * every way three lists can:
 *
 *   - **A screen filed under the wrong module.** CRD Documents sat under Project Management in the
 *     menu and under Sales & CRM in Role Management, because its permission still said `SALES`.
 *     Somebody granting the project screens did not grant it and was not shown that they hadn't.
 *   - **A screen with no row at all.** Contacts and Reports & Analytics both answered for
 *     `SALES / CRM Leads`, so Role Management offered one row where the menu offered three
 *     screens, and neither could be granted or withheld on its own.
 *   - **A row with no screen.** A permission that can be granted and opens nothing wastes whoever
 *     grants it. Some are legitimate - an approval verb, a data-scope permission, a screen reached
 *     from somewhere other than the menu - so those are listed in `NO_MENU_ENTRY` below with the
 *     reason, and anything else fails.
 *
 * Each assertion below is one of those. They are cheap, they read no database, and they fail on the
 * change that causes the drift rather than on the bug report weeks later.
 */

const registry = () => path.resolve(__dirname, "../../frontend/src/constants/navigation.mjs");
const routeMap = () => path.resolve(__dirname, "../../frontend/src/constants/modulePermissions.js");

/**
 * The frontend's two constants files, or null.
 *
 * The backend is deployed without the frontend package beside it, so on a server there is nothing
 * to compare and the assertions have nothing to say. In the repository - which is where drift is
 * introduced and where this test is meant to catch it - both are always there.
 */
async function frontend() {
  if (!fs.existsSync(registry()) || !fs.existsSync(routeMap())) return null;
  const { SIDEBAR_MODULES } = await import(pathToFileURL(registry()).href);
  const { permissionForRoute, ROUTE_PERMISSIONS } = await import(pathToFileURL(routeMap()).href);
  return { SIDEBAR_MODULES, permissionForRoute, ROUTE_PERMISSIONS };
}

/** Every screen the menu lists, with the module heading it sits under. */
const screens = (SIDEBAR_MODULES) => SIDEBAR_MODULES.flatMap((group) =>
  (group.items || []).flatMap((item) => (item.children || [item]).map((screen) => ({ ...screen, group: group.title, groupModule: group.module }))));

const key = (permission) => `${permission.module} / ${permission.feature}`;
const CATALOGUE = new Set(PERMISSIONS.map(key));

/*
 * The permissions that deliberately open no menu entry of their own, each with the reason.
 *
 * A permission not in the menu and not in this list is the third kind of drift above - a row
 * somebody can grant that leads nowhere - so adding one is a decision taken here rather than an
 * omission nobody notices.
 */
const NO_MENU_ENTRY = new Map([
  /*
   * Deciding a payment request, not a screen of its own: Approve, Reject and the correction an
   * approver makes before deciding, on the Payment Requests screen that `ACCOUNTS / Payment Request`
   * opens. The two are deliberately separate - one person asking for money and allowing it was a
   * single tick in Role Management - so the raiser holds Payment Request and may view and withdraw,
   * and the approver holds this beside it. Granting it alone opens nothing, which is correct.
   */
  ["ACCOUNTS / Payment Request Approver", "Approve, Reject and Edit on the Payment Requests screen, which ACCOUNTS / Payment Request opens"],
  ["ASSET / Asset Administration", "Add Asset on the Asset Management screen, and POST /api/assets behind it"],
  ["ASSET / Asset Request Approval", "Accept and reject, on the Asset Management screen"],
  ["CLIENT / Request Approval", "Review and Submit Decision on a raised request, on the Client Requests screen's Raised Requests view"],
  ["HRM / All Tasks", "The All Tasks tab of the Tasks screen"],
  ["HRM / Interview Select All", "The tick boxes on the Interview table, and the actions over a selection"],
  ["HRM / Event Download", "Download on each card and in the viewer on the Events screen"],
  ["HRM / Attendance Rules", "Changing the rules in Settings → Employee → Attendance Rules"],
  ["HRM / All Requests", "Everybody's requests on HRM → Request's status tabs"],
  ["HRM / Attendance WhatsApp Report", "The Attendance Register's WhatsApp button: linking the daily report's group, and sending it"],
  ["HRM / Payroll After Payday", "Changing a Payroll -> Main Page month after its payable date (PUT/DELETE/POST on /api/hrm/payroll-register)"],
  ["SALES / Block Period", "Block Period in a Calendar day's ⋮, the grey blocked periods on the Calendar, and /api/schedule/blocks"],
  /*
   * The tick boxes on every other table, rather than a screen of its own - the general case the two
   * `Select All` rows above are the special cases of. Granted beside whatever screens a role already
   * opens; granting it alone opens nothing, which is correct.
   */
  ["ADMIN / Table Select All", "The tick boxes on every table in the application, and the Export and Delete a selection offers"],
  /*
   * A widener on a screen that already has its own entry, not a screen of its own. Read stops the
   * Projects register narrowing to the projects this person is named on, within the branches their
   * roles reach; Read / Write lets them edit, start and delete any of those. Granting it alone opens
   * nothing, which is correct - it is given *beside* `PROJECT / Projects`, never instead of it.
   */
  ["PROJECT / Show All Projects", "Project Management → Projects: which rows it lists, and whether its Edit, Start and Delete are offered"],
  ["PROJECT / View All Feedback", "Project Management → Feedback: whether the list holds everybody's feedback or only the reader's own"],
  ["PROJECT / Production Execution", "Project Management → Production → a shoot's Execution tab: whether a person named on the shoot runs its steps"],
  ["SALES / Booking Edit", "The Edit action on a booking's row - Bookings & Converted and Projects - and the PATCH behind it"],
  ["SALES / CRM Lead Deletion", "The Delete action on the CRM board - the row menu and the selection button"],
  ["SALES / CRM Lead Select All", "The tick boxes on the Leads & Followups table, and the actions over a selection"],
  ["SALES / CRM Lead Import", "The Import entry in the Leads & Followups ⋮ menu"],
  // Two of the AI Feature's three permissions open nothing of their own: both are asked for by name
  // inside the screen `IMAGE_SELECTION / AI Feature` opens.
  ["IMAGE_SELECTION / AI Face Management", "The People and Face Recognition tabs inside an AI event, and the match reviews and retries on them"],
  ["IMAGE_SELECTION / AI Event Default Settings", "AI Feature → More → Event Default Settings"],
  ["ADMIN / User Management", "Administration, reached from the User Management heading (the Employee Repository screen)"],
  ["ADMIN / Role Management", "Administration, reached from the User Management heading (the Employee Repository screen)"],
  ["ADMIN / User Activity Logs", "Administration → User Activity Logs, reached from the User Management heading (the Employee Repository screen)"],
  // The Settings overlay is reached from the top bar rather than from the menu, so none of its
  // rail entries has a sidebar entry - and each is named here rather than the module being waved
  // through, so another one is a line somebody writes rather than one nobody sees.
  ["SETTINGS / User Settings", "Settings → User Settings"],
  ["SETTINGS / WhatsApp Activity Log", "Settings → User Settings → WhatsApp Activity Log"],
  ["SETTINGS / Automatic WhatsApp Message", "Settings → User Settings → Automatic WhatsApp Message → Photo Selection Submitted"],
  ["SETTINGS / Table Settings", "Settings → Overall → Table"],
  ["SETTINGS / Field Settings", "Settings → Overall → Fields"],
  ["SETTINGS / Project Settings", "Settings → Overall → Project"],
  ["SETTINGS / Exclude Phone Numbers", "Settings → Exclude Phone Numbers"],
  ["SETTINGS / Integrations", "Settings → Integrations"],
  ["SETTINGS / Quotation Settings", "Settings → Quotation Settings"],
  ["SETTINGS / Employee Referral", "Settings → Employee Referral, the amount behind HRM's register"],
  ["SETTINGS / Message Template", "Settings → Message Template"],
  ["SETTINGS / Template Settings", "Settings → Template Settings"],
  ["SETTINGS / Wishes", "Settings → Wishes"],
  ["SETTINGS / Organization", "Settings → Organization, and Image Selection's own settings panel"],
  ["SETTINGS / Holidays", "Settings → Holidays"],
  ["SETTINGS / Login Slide", "Settings → Login Slide"],
  ["SETTINGS / Client Page Images", "Settings → Project Management → Client page images"],
  ["SETTINGS / Payment Reminder", "Settings → Project Management → Payment reminder"],
  ["SETTINGS / Shoot Crew Notice", "Settings → Project Management → Shoot crew notice"],
  ["SETTINGS / Application Monitoring", "Settings → Application Monitoring, and the email health check"],
  ["SETTINGS / Activity Log Purge", "Settings → Activity Log Purge"],
  ["IMAGE_SELECTION / Album Proofing QC", "The QC review panel inside the Album Proofing screen"],
  ["ADMIN / Branch Administration", "Opens no screen: it decides whose records every screen shows"],
  // A board with a page and a guard that the menu deliberately does not carry yet - it is not ready
  // to be handed to the studio, and is reached by address until it is. Listed so the assertion above
  // reads it as a decision rather than as a grant that leads nowhere; the entry moves to the sidebar
  // registry when the board is ready, and this line goes. Pre Production and Production made that
  // move first.
  ["PROJECT / Post Production", "Reached by address; not in the menu until the board is ready"],
  // Both live inside Employee Attendance's own section dropdown, asked for by name there - the
  // same way `Rules` is a section of that page rather than a screen of its own.
  ["HRM / Speak-up", "The Speak-up section of the Employee Attendance page"],
  ["HRM / Speak-up Review", "The Speak-up Review section of the Employee Attendance page"],
  ["HRM / Payroll Recovery", "The Recovery section of the Payroll page, and /api/hrm/payroll-recoveries behind it"],
  ["HRM / Payroll Policy Breach", "The Policy Breach section of the Payroll page, and /api/hrm/payroll-policy-breaches behind it"],
  ["HRM / Payroll Advance", "The Advance Salary section of the Payroll page, and /api/hrm/payroll-advances behind it"],
  ["HRM / Payroll Register", "The Main Page section of the Payroll page and Settings → Payroll rules, and /api/hrm/payroll-register behind them"],
]);

test("every screen in the menu is governed by a permission that exists", async () => {
  const app = await frontend();
  if (!app) return;

  for (const screen of screens(app.SIDEBAR_MODULES)) {
    const permission = app.permissionForRoute(screen.href);
    assert.ok(permission,
      `"${screen.label}" (${screen.href}) is in the sidebar and no permission governs it, so anyone signed in can open it`);
    assert.ok(CATALOGUE.has(key(permission)),
      `"${screen.label}" answers for ${key(permission)}, which is not in the catalogue - it can be granted to nobody and the guard naming it refuses everybody but a Super Admin`);
  }
});

test("a screen's permission belongs to the module the menu files it under", async () => {
  const app = await frontend();
  if (!app) return;

  for (const screen of screens(app.SIDEBAR_MODULES)) {
    if (!screen.groupModule) continue;
    const permission = app.permissionForRoute(screen.href);
    if (!permission) continue;
    // The CRD Documents failure exactly: the menu said Project Management, the permission said
    // SALES, and Role Management listed the screen under a heading it does not appear in.
    assert.equal(permission.module, screen.groupModule,
      `"${screen.label}" is under ${screen.group} in the sidebar but Role Management lists it under ${permission.module}, because its permission is ${key(permission)}`);
  }
});

test("no two screens in the menu share one permission", async () => {
  const app = await frontend();
  if (!app) return;

  const owner = new Map();
  for (const screen of screens(app.SIDEBAR_MODULES)) {
    const permission = app.permissionForRoute(screen.href);
    if (!permission) continue;
    const held = owner.get(key(permission));
    // Contacts and Reports & Analytics both answered for CRM Leads: three screens, one row, and no
    // way to give somebody the reports without the board behind them.
    assert.equal(held, undefined,
      `"${screen.label}" and "${held}" both answer for ${key(permission)}, so Role Management cannot offer one without the other`);
    owner.set(key(permission), screen.label);
  }
});

test("every permission that opens no menu entry says why", async () => {
  const app = await frontend();
  if (!app) return;

  const reachable = new Set(screens(app.SIDEBAR_MODULES)
    .map((screen) => app.permissionForRoute(screen.href))
    .filter(Boolean)
    .map(key));

  for (const permission of PERMISSIONS) {
    if (reachable.has(key(permission))) continue;
    assert.ok(NO_MENU_ENTRY.has(key(permission)),
      `${key(permission)} can be granted and opens nothing: no menu entry answers for it. Add the screen to the sidebar registry, or list it in NO_MENU_ENTRY with where it is used.`);
  }

  for (const listed of NO_MENU_ENTRY.keys()) {
    assert.ok(CATALOGUE.has(listed), `NO_MENU_ENTRY names ${listed}, which the catalogue no longer has`);
    assert.ok(!reachable.has(listed), `${listed} has a menu entry now, so it should not be listed as having none`);
  }
});

test("every route in the permission map names a permission that exists", async () => {
  const app = await frontend();
  if (!app) return;

  for (const [route, permission] of app.ROUTE_PERMISSIONS) {
    assert.ok(CATALOGUE.has(key(permission)),
      `${route} is governed by ${key(permission)}, which is not in the catalogue - the page is unreachable for everybody but a Super Admin`);
  }
});

/*
 * The pages that deliberately answer to no permission, each with the reason.
 *
 * A path no row matches is open to anybody signed in - `useRouteAccess` answers `canRead: true`
 * and the guard lets it through - which is right for exactly these and a hole for anything else.
 * A page not in the map and not in this list is therefore the fourth kind of drift: a screen
 * somebody built and forgot to file, which the menu tests above cannot see because it is in the
 * menu no more than it is in the map.
 */
const OPEN_TO_EVERY_SESSION = new Map([
  ["/profile", "The viewer's own record - name, photo, password and where they sit on the chart - which no role withholds from its holder"],
  ["/sales/meetings", "The studio calendar; each source on it is gated by that module's own Read, and holidays are the same fact for everybody"],
]);

/** Every route with a page under `app/(app)`, as the router would address it. */
function appRoutes() {
  const root = path.resolve(__dirname, "../../frontend/src/app/(app)");
  if (!fs.existsSync(root)) return null;
  const routes = [];
  const walk = (dir, segments) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(path.join(dir, entry.name), [...segments, entry.name]);
      else if (entry.name === "page.js") routes.push("/" + segments.join("/"));
    }
  };
  walk(root, []);
  return routes;
}

test("every page under (app) is in the permission map, or says here why it is open to everybody", async () => {
  const app = await frontend();
  const routes = appRoutes();
  if (!app || !routes) return;

  for (const route of routes) {
    if (OPEN_TO_EVERY_SESSION.has(route)) continue;
    // A dynamic segment such as /hrm/[module] is matched by its parent's prefix row, which is
    // what the router does with it too.
    assert.ok(app.permissionForRoute(route),
      `${route} has a page and no row in modulePermissions.js, so it is open to anybody signed in - add a row, or list it in OPEN_TO_EVERY_SESSION with the reason`);
  }
  for (const [route, why] of OPEN_TO_EVERY_SESSION) {
    assert.ok(routes.includes(route), `${route} is listed as open to everybody but has no page: ${why}`);
    assert.equal(app.permissionForRoute(route), null,
      `${route} has a row in modulePermissions.js now, so it should not be listed as open to everybody`);
  }
});

test("a permission is named once, so a guard cannot match two rows", () => {
  const seen = new Set();
  for (const permission of PERMISSIONS) {
    // The database is unique on module + feature + level, but every guard, every grant lookup and
    // `seedScopes` find a permission by module + feature alone. Two rows differing only in level
    // would be a coin toss over which one answered.
    assert.ok(!seen.has(key(permission)), `${key(permission)} is in the catalogue twice`);
    seen.add(key(permission));
  }
});

test("every sub-action names a permission that exists", () => {
  for (const [module, feature, scopes] of SCOPES) {
    // `seedScopes` looks the permission up and skips the group when it finds nothing. Three groups
    // named permissions that had been merged away, so nine sub-actions were seeded to nobody and
    // no error said so.
    assert.ok(CATALOGUE.has(`${module} / ${feature}`),
      `${module} / ${feature} has ${scopes.length} sub-action(s) and is not in the catalogue, so none of them can ever be ticked`);
  }
});
