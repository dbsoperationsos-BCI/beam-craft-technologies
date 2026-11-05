/**
 * Which permission decides each screen.
 *
 * One map, read by everything that has to answer "may this person be here": the sidebar when it
 * decides what to list, the route guard when a page is opened directly, and the landing resolver
 * when somebody signs in. Keeping the three in one table is the point - a screen added to the nav
 * and forgotten in the guard is exactly the hole this is meant to close.
 *
 * The `{ module, feature }` pairs must exist as rows in the backend's permission catalogue
 * (`backend/prisma/seeds/permission-catalogue.js`, written by a migration as well - IAM.md step
 * 10), or the permission cannot be granted to anyone and the screen is unreachable for everybody
 * but a super admin. See CLAUDE.md Rule 4.
 *
 * Each pair is the permission the **API** enforces on the data that screen reads, which is not
 * always the tidiest name for the screen. Several screens share an endpoint - the sales project
 * register feeds five of them - and a route given a finer permission than its endpoint has would
 * show somebody a page the server then refuses the records to. Splitting those endpoints is what
 * finer control needs; until then this table follows the server.
 */

// Relative, not aliased: this file is read by tests under `node --test`, which resolves no aliases.
import { MENU_GROUPS } from "./navigation.mjs";

// Longest path first: `permissionForRoute` takes the first row whose path is the route or a prefix
// of it, so /admin/roles has to sit above /admin or the shorter row would answer for it. The three
// pre-production boards have no rows of their own and are meant to match the
// /project-management/pre-production prefix - one permission for the board and its verticals.
//
// Two pages under (app) deliberately have no row and are open to any signed-in session: `/profile`,
// the viewer's own record, and `/sales/meetings`, explained beside its neighbours below. Both are
// listed in `backend/test/permission-catalogue-sidebar.test.js`, which fails on a third that is not.
export const ROUTE_PERMISSIONS = [
  ["/admin/roles", { module: "ADMIN", feature: "Role Management" }],
  ["/admin/users", { module: "ADMIN", feature: "User Management" }],
  // Read-only, and its own permission: the log says what every person did, which is a wider read
  // than managing their accounts. The `/api/admin/activity-logs` router guards on the same pair.
  ["/admin/activity-logs", { module: "ADMIN", feature: "User Activity Logs" }],
  ["/admin", { module: "ADMIN", feature: "User Management" }],

  // The HRM master data lists are read by Admin, Accounts, Assets and the employee forms as well as
  // by their own screen, so they answer to the permission that governs the endpoint serving them.
  // HRM -> Client Details: Beam Craft's client companies, every product together. Ahead of `/hrm`.
  ["/hrm/client-details", { module: "SUBSCRIBE", feature: "Client Onboarding" }],
  ["/employees", { module: "HRM", feature: "Employee Management" }],
  // Attendance answers to its own permission, not Employee Management: everybody marks their own
  // day, and almost nobody edits employee records. Following the endpoint here is what keeps the
  // sidebar, the route guard and the API from disagreeing about who may open this screen -
  // `backend/src/modules/hrm/attendance/routes.js` guards on `HRM / Employee Attendance`, so this
  // row has to name the same pair.
  ["/hrm/employee-attendance", { module: "HRM", feature: "Employee Attendance" }],
  /*
   * The studio-wide register, which is a different question from marking your own day and so
   * answers to a different permission. Above the bare `/hrm` prefix below, like Tasks, and above
   * nothing else it could be confused with — `/hrm/employee-attendance` does not start with this.
   */
  ["/hrm/attendance", { module: "HRM", feature: "Attendance Approval" }],
  /*
   * Leave, permission and comp-off requests - raising one's own and answering the ones this login is
   * named an approver on. Its own permission, since every screen in the menu is granted apart; the
   * request endpoints accept it or `HRM / Employee Attendance`, so the screen never opens onto
   * refusals. Who may *decide* a request is the approver slots on the requester's record, checked by
   * the server per request. Above the bare `/hrm` prefix below.
   */
  ["/hrm/requests", { module: "HRM", feature: "Requests" }],
  // HRM → Events: Read to see them, Read / Write to post. `backend/src/modules/hrm/events/routes.js`
  // guards on the same pair. Above the bare `/hrm` prefix below.
  ["/hrm/events", { module: "HRM", feature: "Events" }],
  /*
   * Tasks is its own permission and must stay above the bare `/hrm` prefix below, which would
   * otherwise claim it for Employee Management — and Tasks is meant to be held by everybody while
   * the employee records are not.
   *
   * `Task Management` rather than `All Tasks`: this row decides whether the screen may be *opened*,
   * and My Tasks is what it opens on. Reading the whole studio's list is the wider permission, asked
   * for again by the All Tasks tab and by its own endpoint behind it.
   */
  ["/hrm/tasks", { module: "HRM", feature: "Task Management" }],
  /*
   * The referral register. Its own permission, and above the bare `/hrm` prefix for the same reason
   * Tasks is: Employee Management would otherwise claim it, and reading the employee repository is
   * not the same question as reading what the studio owes for a referral.
   *
   * `backend/src/modules/hrm/referrals/routes.js` guards on this exact pair, which is what keeps
   * the sidebar, the route guard and the API from disagreeing about who may open it.
   */
  ["/hrm/employee-referrals", { module: "HRM", feature: "Employee Referral" }],
  /*
   * The candidate register. Its own permission, above the bare `/hrm` prefix for the same reason the
   * three rows above it are: reading the employee repository is not the same question as reading who
   * the studio is interviewing. `backend/src/modules/hrm/interview/routes.js` and the two integration
   * routers beside it guard on this exact pair, and Settings → Integrations → Interview asks for it
   * by name before offering to link a sheet.
   */
  ["/hrm/interview", { module: "HRM", feature: "Interview" }],
  // HRM → Payslip: the signed-in employee's own payslips. Above `/hrm`, like Payroll below.
  ["/hrm/payslip", { module: "HRM", feature: "My Payslip" }],
  // HRM → Payroll. Above `/hrm`, which would otherwise answer for it as Employee Management.
  ["/hrm/payroll", { module: "HRM", feature: "Payroll" }],
  ["/hrm", { module: "HRM", feature: "Employee Management" }],

  // Resource Management → Recycling Bin: deleted projects, restored or deleted permanently.
  ["/asset-management/recycling-bin", { module: "ASSET", feature: "Recycling Bin" }],
  ["/asset-management/client-storage", { module: "ASSET", feature: "Client Storage" }],
  ["/asset-management/vendors", { module: "ASSET", feature: "Vendor Management" }],
  ["/asset-management/assets", { module: "ASSET", feature: "Asset Management" }],

  // CRD documents keep a permission of their own - sending a client a link and asking them to fill
  // a form is a different act from planning a shoot - but it is a `PROJECT` permission, because
  // this is where the screen lives. It said `SALES` while sitting in the Project Management menu,
  // so Role Management listed it under Sales & CRM and somebody granting the project screens left
  // it behind without being shown that they had. Moved by migration 20260909130000.
  ["/project-management/crd-documents", { module: "PROJECT", feature: "CRD Documents" }],
  // The two client gifts and where each has got to. Its own permission, not the projects one:
  // whoever chases a welcome gift is not necessarily somebody who may re-plan the project.
  ["/project-management/client-gifts", { module: "PROJECT", feature: "Client Gifts" }],
  // Project Management → Feedback, its own permission from the start (migration 20261001130000) so
  // the screen is closed to everybody not given it, however little it shows yet.
  ["/project-management/feedback", { module: "PROJECT", feature: "Feedback" }],
  // Keep old bookmarks working while the screen moves out of Sales. Same permission as the row
  // above - a bookmark is not a second screen.
  ["/sales/crd-documents", { module: "PROJECT", feature: "CRD Documents" }],
  ["/sales/quotation", { module: "SALES", feature: "Quotation Management" }],
  // Client Management -> Client Offers: the offers on the Home page of the clients' app. The route
  // stays under /sales, where it began, so bookmarks and notification links keep working.
  ["/sales/client-offers", { module: "CLIENT", feature: "Client Offers" }],
  // Client Management -> Client Chats: the chats clients start from their app.
  ["/sales/client-chats", { module: "CLIENT", feature: "Client Chats" }],
  // Client Management -> Invitation Cards: the designs and songs clients make their invitations from.
  ["/client-management/invitation-cards", { module: "CLIENT", feature: "Invitation Cards" }],
  // Client Management -> Client Requests: what clients ask about their services and deliverables.
  ["/client-management/client-requests", { module: "CLIENT", feature: "Client Requests" }],
  /*
   * The Quotation Calculator, on the same permission as the generator it hands its figures to.
   *
   * Not a permission of its own: pricing a quotation and raising one are the same job, and a feature
   * key nobody has ticked reaches only a Super Admin - so a new one would have taken the calculator
   * away from the people already using it inside the lead popup, which is where it was until it
   * became a page of its own.
   *
   * **And therefore not in the sidebar.** Two menu screens may not share a permission - Role
   * Management would have no way to grant one without the other, which `permission-catalogue-sidebar`
   * holds the application to. So this is a route with a guard and no menu entry, like
   * `/sales/crd-documents` above: reached from a lead's own Quotation Calculator button, which is
   * where it was reached from when it was a dialog.
   */
  ["/sales/quotation-calculator", { module: "SALES", feature: "Quotation Management" }],
  /*
   * `/sales/meetings` - the studio calendar - is deliberately absent from this table.
   *
   * It answered for SALES / CRM Leads, which described the folder the page sits in rather than
   * what it holds. The calendar is the diary the whole studio reads, reached from the Calendar
   * icon on the topbar rather than from the Sales menu, and the studio's declared holidays on it
   * are the same fact for everybody - so an employee being unable to open it meant they could not
   * see that the office is shut.
   *
   * A path no row matches is open to anybody signed in, which is exactly what is wanted here, and
   * it is safe *because of where the real guard is*: `/api/schedule` decides source by source
   * against each module's own Read permission, so the grid shows a viewer only what they could
   * read elsewhere, and the page asks `useModuleAccess("SALES", "CRM Leads")` by name before it
   * offers to schedule anything. This is the one screen meant to be reached by everybody; adding
   * a new page and forgetting a row here is still the hole this table exists to close.
   */
  ["/sales/manager", { module: "SALES", feature: "Sales Manager" }],
  /*
   * The Sales & CRM screens, one permission each, because each is its own entry in the menu and a
   * screen the menu lists has to be grantable on its own. The reports, the dashboard over them and
   * the contact directory all answered for `CRM Leads` until then: Role Management showed one row
   * where the menu showed three screens, so the only way to give somebody the reports was to give
   * them the board of leads with it.
   *
   * The dashboard is the reports' own summary, drawn from the same endpoint, so it shares their
   * permission rather than taking a fourth - it is one screen's two views, not two screens.
   *
   * Contacts is the odd one, and deliberately so. It reads a phone number wherever the application
   * keeps one - HR, projects, galleries, accounts, vendors - so this entry governs only whether
   * the screen may be *opened*. What is in it is decided again on the server, source by source,
   * against each module's own permission: a viewer sees a module's numbers only if they may read
   * that module elsewhere. Opening Contacts is never a way around another module's guard.
   *
   * Each needs its own entry because each is its own path; a route no entry matches is an
   * ungoverned one, since `useRouteAccess` answers "allowed" for a path it cannot place.
   */
  ["/sales/dashboard", { module: "SALES", feature: "Reports & Analytics" }],
  ["/sales/reports", { module: "SALES", feature: "Reports & Analytics" }],
  ["/sales/contacts", { module: "SALES", feature: "Contacts" }],
  ["/sales/crm", { module: "SALES", feature: "CRM Leads" }],

  // Production is its own module: once a sale becomes a project it stops being Sales' business, and
  // the three boards are read by the people running the shoot rather than by the person who sold
  // it. All four read the same project register - the API shares that read across them - while only
  // Projects may change what is planned.
  ["/project-management/pre-production", { module: "PROJECT", feature: "Pre Production" }],
  ["/project-management/post-production", { module: "PROJECT", feature: "Post Production" }],
  ["/project-management/production", { module: "PROJECT", feature: "Production" }],
  // The week of shoots the viewer and their team are named on. Its own permission, because it is
  // read by everybody on a shoot - Project Managers and coordinators as much as Production.
  ["/project-management/shoot-board", { module: "PROJECT", feature: "Shoot Board" }],
  ["/project-management/projects", { module: "PROJECT", feature: "Projects" }],

  /*
   * Two rows for one permission, because this table answers two questions and Image Selection has
   * no page at its own root — only `/image-selection/dashboard` and `/image-selection/projects`.
   *
   * The dashboard comes first, so `firstPermittedRoute` sends somebody signing in to a page that
   * exists. The bare prefix follows it to go on guarding both children, which is what the prefix
   * match is for. Ordered this way round the landing answer is never the prefix: the finder takes
   * the first row whose permission is held, and both rows name the same one.
   */
  // The AI Feature lives under its own prefix rather than under /image-selection, so it can never
  // fall through to that module's rows: one row guards the overview, the events list and every
  // event workspace beneath it. `backend/src/modules/ai-feature/` guards on this exact pair; the
  // People tabs and the defaults panel ask for their own permissions by name inside the screen.
  // Photo Selling's route sits under the AI Feature's prefix, beside it in the sidebar, and
  // answers to its own permission - the one `backend/src/modules/photo-selling/` guards on. Ahead of
  // the prefix row so the longest match wins.
  ["/visual-curation/ai/photo-selling", { module: "IMAGE_SELECTION", feature: "Photo Selling" }],
  ["/visual-curation/ai", { module: "IMAGE_SELECTION", feature: "AI Feature" }],
  // Album Proofing is its own job with its own grant and its own API; it sits under the Image
  // Selection prefix only because that is where the studio finds it. Ahead of the prefix rows so
  // the longest match wins.
  // Its dashboard first, so `firstPermittedRoute` lands on it as Image Selection's does; the prefix
  // row follows to go on guarding the Projects page and both name the same permission.
  ["/image-selection/album-proofing/dashboard", { module: "IMAGE_SELECTION", feature: "Album Proofing" }],
  ["/image-selection/album-proofing", { module: "IMAGE_SELECTION", feature: "Album Proofing" }],
  // AI Culling, AI Editing and Signature Album, each a module of its own with a Dashboard and a
  // Projects page, each on its own permission - the one its dashboard summary is guarded by
  // (`backend/src/modules/image-selection/stage-dashboards/routes.js`). Dashboard first, so
  // `firstPermittedRoute` lands on a page that exists; the prefix row guards Projects. Ahead of
  // the /image-selection rows so the longest match wins. The Projects page also reads the project
  // list, folders and the culling API, which stay `Project Management`'s - it asks for that itself.
  ["/image-selection/ai-culling/dashboard", { module: "IMAGE_SELECTION", feature: "AI Culling" }],
  ["/image-selection/ai-culling", { module: "IMAGE_SELECTION", feature: "AI Culling" }],
  ["/image-selection/ai-editing/dashboard", { module: "IMAGE_SELECTION", feature: "AI Editing" }],
  ["/image-selection/ai-editing", { module: "IMAGE_SELECTION", feature: "AI Editing" }],
  ["/image-selection/signature-album/dashboard", { module: "IMAGE_SELECTION", feature: "Signature Album" }],
  ["/image-selection/signature-album", { module: "IMAGE_SELECTION", feature: "Signature Album" }],
  ["/image-selection/dashboard", { module: "IMAGE_SELECTION", feature: "Project Management" }],
  ["/image-selection", { module: "IMAGE_SELECTION", feature: "Project Management" }],

  // Two Accounts screens, two permissions: keeping the cash book and deciding what the studio pays
  // out are different jobs, even though both are the accountant's.
  ["/accounts/payment-requests", { module: "ACCOUNTS", feature: "Payment Request" }],
  ["/accounts/manager", { module: "ACCOUNTS", feature: "Cash Management" }],
  // Subscribe: the client companies onboarded for each of Beam Craft's products.
  ["/subscribe/media-studio-operations", { module: "SUBSCRIBE", feature: "Client Onboarding" }],
  ["/subscribe/account-manager", { module: "SUBSCRIBE", feature: "Client Onboarding" }],
];

/** The permission governing `pathname`, or null for a page no permission names. */
export function permissionForRoute(pathname) {
  if (!pathname) return null;
  const match = ROUTE_PERMISSIONS.find(([prefix]) => pathname === prefix || pathname.startsWith(`${prefix}/`));
  return match ? match[1] : null;
}

/**
 * Where to send somebody who has just signed in: the first screen in this list they may open.
 * Returns null when they hold nothing, which is a different answer from "send them to /employees" -
 * the caller shows them why rather than bouncing them into a wall.
 */
export function firstPermittedRoute(hasPermission) {
  const match = ROUTE_PERMISSIONS.find(([, permission]) => hasPermission(permission.module, permission.feature, "READ"));
  return match ? match[0] : null;
}

/**
 * What each permission module is called on screen.
 *
 * The keys are the backend's, which are shouted (`PROJECT`, `IMAGE_SELECTION`) because they are
 * identifiers rather than names. Everywhere a person reads one — the Roles dialog, the modules
 * column of the roles table — it goes through here first, so the Roles screens call a module what
 * the sidebar calls it.
 *
 * It lives here, beside the route table, because it has the same failure: a module added to the
 * backend catalogue and forgotten here is not an error, it just reads as its own key. `PROJECT` and
 * `ACCOUNTS` did exactly that, in two copies of this map, for as long as they had existed. One copy
 * is the point of moving it.
 */
export const MODULE_LABELS = {
  // Read off the sidebar rather than written again here, so the two cannot drift - which they had:
  // the menu said "Resource Management" and "Visual Curation" while this map said "Asset Management"
  // and "Image Selection", for the same screens.
  ...Object.fromEntries(MENU_GROUPS.filter((group) => group.module).map((group) => [group.module, group.title])),
  // Administration has no sidebar group to take a name from - it is reached from the control beside
  // the Employee Repository heading - so it is named here, after the derived entries so nothing
  // above can overwrite it.
  ADMIN: "Administration",
  // Settings has no sidebar group either - the overlay is reached from the top bar - and it is
  // deliberately not Administration: its thirteen rows are the entries on the Settings rail, granted
  // one at a time, while Administration is the two user and role screens.
  SETTINGS: "Settings",
};

/** A module's name for a reader; an unmapped key at least loses its underscores. */
export const moduleLabel = (key) => MODULE_LABELS[key] || String(key || "").replace(/_/g, " ");

/*
 * A feature's name, taken from the menu entry that opens it.
 *
 * Built by walking the sidebar and asking this file's own route table which permission each entry
 * answers to, so "Manage Sales Projects" is shown as **Bookings & Converted** - the thing the person
 * granting it will actually see in the menu afterwards.
 *
 * Several entries can share one permission: Employee Repository and Employee Attendance are both
 * `HRM / Employee Management`, and three CRM screens are all `SALES / CRM Leads`. The first entry
 * wins, being the one the permission is normally thought of as opening.
 */
const FEATURE_LABELS = (() => {
  const labels = {};
  for (const group of MENU_GROUPS) {
    for (const item of group.items || []) {
      if (!item.href) continue;
      const permission = permissionForRoute(item.href);
      if (!permission) continue;
      const key = `${permission.module}::${permission.feature}`;
      if (!(key in labels)) labels[key] = item.label;
    }
  }
  return labels;
})();

/*
 * Where each module and each feature sits in the menu, so the Roles screen can be read in the same
 * order as the sidebar.
 *
 * Role Management groups by `permission.module` and lists whatever order the catalogue happens to
 * be written in, which put Resource Management above HRM and Bookings & Converted above Leads &
 * Followups - the same headings as the menu, in an order nobody navigating the app would recognise.
 * Built here rather than in the dialog because this file already knows which permission each menu
 * entry answers to; the dialog only has to ask.
 */
const MENU_ORDER = (() => {
  const modules = new Map();
  const features = new Map();
  MENU_GROUPS.forEach((group, groupIndex) => {
    if (group.module && !modules.has(group.module)) modules.set(group.module, groupIndex);
    (group.items || []).forEach((item, itemIndex) => {
      if (!item.href) return;
      const permission = permissionForRoute(item.href);
      if (!permission) return;
      const key = `${permission.module}::${permission.feature}`;
      if (!features.has(key)) features.set(key, itemIndex);
    });
  });
  return { modules, features };
})();

// Anything the menu does not carry sorts after everything it does, keeping the order it arrived in.
// Administration is the whole of one such block; the approval verbs are rows inside others.
const LAST = Number.MAX_SAFE_INTEGER;

/** Module keys in sidebar order, with the ones no menu group names left at the end. */
export const sortModulesForMenu = (moduleKeys) =>
  [...moduleKeys].sort((a, b) => (MENU_ORDER.modules.get(a) ?? LAST) - (MENU_ORDER.modules.get(b) ?? LAST));

/** One module's permissions in the order its screens appear under it in the sidebar. */
export const sortFeaturesForMenu = (permissions) =>
  [...permissions].sort((a, b) =>
    (MENU_ORDER.features.get(`${a.module}::${a.feature}`) ?? LAST)
    - (MENU_ORDER.features.get(`${b.module}::${b.feature}`) ?? LAST));

/**
 * What to call a permission on the Roles screen.
 *
 * A permission with no menu entry of its own - All Tasks, Asset Request Approval, the production
 * boards, everything under Administration - keeps the name the server gave it. Those are real
 * permissions that open no screen by themselves, and inventing a menu name for them would say there
 * is somewhere to go.
 */
export const featureLabel = (permission) =>
  FEATURE_LABELS[`${permission?.module}::${permission?.feature}`]
  || permission?.displayName
  || permission?.feature
  || "";
