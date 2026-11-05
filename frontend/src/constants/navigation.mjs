/**
 * The application's navigation, and the one place its names, its ids and its shape are written.
 *
 * This is the **canonical sidebar registry**. Everything that draws or reasons about the nav reads
 * it: the hamburger drawer, Settings → User Preference → Sidebar Layout, Role Management's labels,
 * and — through a test rather than an import — the backend's validation of a saved layout. There is
 * no second sidebar configuration anywhere; a screen added here appears in all of them at once.
 *
 * What each field is for:
 *
 * - `id`      A stable slug, and the only thing a saved layout ever stores. Routes move — Sales'
 *             CRD Documents became Project Management's — and a preference keyed on the URL would
 *             have been silently orphaned by that move. Ids do not change; if one ever must, the
 *             old one simply stops matching and the item falls back to its default position.
 * - `label`   What a person reads, here and nowhere else. Two names for one screen is how the
 *             sidebar and Role Management drifted apart before this file existed.
 * - `href` / `activePath`  Where the entry goes, and what counts as being on it.
 * - `icon`    A `@mui/icons-material` export name, shown beside a module while it is being dragged
 *             in the Sidebar Layout editor. A name rather than a component because this file is
 *             data only (see below); the editor maps it.
 * - `module`  The permission module a group belongs to, which is what lets Role Management title
 *             its blocks with these headings.
 *
 * **Order in this file is the default order**, for modules and for the screens inside each. A user
 * who has never rearranged anything gets exactly this; a user who has gets their own arrangement,
 * with anything added here later slotted in at its position among the new arrivals. See
 * `@/lib/sidebarLayout.mjs`.
 *
 * **Permissions are deliberately absent.** Which permission opens a screen is decided once, by
 * route, in `modulePermissions.js` — the same table the route guard and the landing resolver read.
 * Naming it again here would be a second answer to one question, and the two would drift. Readers
 * of this registry ask that table what an `href` needs.
 *
 * This file holds data only — no JSX, no imports — so the sidebar, the permission constants and a
 * plain `node --test` can all read it without any of them depending on the others. `.mjs` so that
 * the backend's drift test can import it directly from the other package.
 */

/**
 * Every module in the nav, in default order, each with its screens in default order.
 *
 * Administration is deliberately absent: Users and Roles are reached from the control beside the
 * Employee Repository heading, which is the only place that names those screens and shows which of
 * them you are on. A second way in from here listed the same destinations twice. Employee Referral
 * joined them there and is `hidden` below for the same reason.
 */
/**
 * `hidden: true` keeps a screen in the registry but off the menu.
 *
 * This list is not only the sidebar. It is where the Roles screen reads a permission's friendly
 * name from, where Field Settings gets its screen picker, and where the topbar reads a page's
 * title - so a screen the studio does not want in the menu still has to be *listed* here or those
 * three quietly lose it. `resolveSidebarLayout` is the one place that honours the flag, which is
 * also what keeps such a screen out of the Sidebar Layout editor: there is nothing to reorder.
 *
 * The page itself stays reachable by its own route, behind whatever `modulePermissions.js` says
 * guards it. This hides an entry; it does not close a screen. To close one, take away the
 * permission.
 */
export const SIDEBAR_MODULES = [
  {
    id: "subscribe",
    title: "Subscribe",
    module: "SUBSCRIBE",
    icon: "Subscriptions",
    items: [
      { id: "media-studio-operations", label: "Media Studio Operations", href: "/subscribe/media-studio-operations", activePath: "/subscribe/media-studio-operations" },
      { id: "subscribe-account-manager", label: "Client Domain Managing", href: "/subscribe/account-manager", activePath: "/subscribe/account-manager" },
    ],
  },
  /*
   * What the studio does for its clients through their app, on its own heading after Sales & CRM.
   * The screens kept their /sales routes when they moved here, so bookmarks and notification links
   * still open them; their permissions moved to `CLIENT` (migration 20261030100000).
   */
  {
    id: "client-management",
    title: "Client Management",
    module: "CLIENT",
    icon: "SupportAgent",
    items: [
      // Beam Craft's client companies: onboarding invites, their details and their subscriptions.
      { id: "client-details", label: "Client Details", href: "/hrm/client-details", activePath: "/hrm/client-details" },
      // DBS's studio-to-customer screens below are off Beam Craft's menu (`hidden`); routes and code are kept.
      // The offers on the Home page of the clients' app.
      { id: "client-offers", label: "Client Offers", href: "/sales/client-offers", activePath: "/sales/client-offers", hidden: true },
      // The chats clients start from their app, answered here.
      { id: "client-chats", label: "Client Chats", href: "/sales/client-chats", activePath: "/sales/client-chats", hidden: true },
      // The designs and songs clients make their animated invitations from.
      { id: "invitation-cards", label: "Invitation Cards", href: "/client-management/invitation-cards", activePath: "/client-management/invitation-cards", hidden: true },
      // What clients ask about their services and deliverables, answered here.
      { id: "client-requests", label: "Client Requests", href: "/client-management/client-requests", activePath: "/client-management/client-requests", hidden: true },
    ],
  },
  {
    id: "hrm",
    title: "Human Resource Management (HRM)",
    module: "HRM",
    icon: "Groups",
    items: [
      { id: "employee-repository", label: "User Management", href: "/employees", activePath: "/employees" },
      { id: "employee-attendance", label: "Attendance", href: "/hrm/employee-attendance", activePath: "/hrm/employee-attendance" },
      /*
       * The studio's attendance register. Off the menu: it is a section of Employee Attendance now,
       * offered there to whoever holds `HRM / Attendance Approval`. The route stays, and the
       * permission still appears on the Roles screen under this name.
       */
      { id: "attendance-register", label: "Attendance Register", href: "/hrm/attendance", activePath: "/hrm/attendance", hidden: true },
      /*
       * Leave, permission and comp-off requests. Off the menu: they are Employee Attendance's Request
       * section now, and a request waiting on this login is announced on the notification bell. The
       * route stays - a bookmark or a notification link to /hrm/requests still opens the screen -
       * and `HRM / Requests` still appears on the Roles screen under this name.
       */
      { id: "requests", label: "Leave or Comp-Off Request", href: "/hrm/requests", activePath: "/hrm/requests", hidden: true },
      /*
       * The studio's events - a photo and a description each - posted for everybody to see. Off the
       * menu: a section of Employee Attendance now, offered there to whoever holds `HRM / Events`.
       * The route stays - the event notification still links to it - and so does the permission.
       */
      { id: "events", label: "Events", href: "/hrm/events", activePath: "/hrm/events", hidden: true },
      /*
       * Off the menu, and reached from the Employee Repository's heading instead, beside Users and
       * Roles - see `constants/rbacSections.js`. It is read about the same people as the repository
       * and what a referral pays is already set from that screen's own Settings, so it sat in the
       * menu as a second HRM entry for one question the first one already answers.
       *
       * `HRM / Employee Referral` still opens it, and still appears on the Roles screen under that
       * name: hiding an entry is not taking a permission away.
       */
      { id: "employee-referral", label: "Employee Referral", href: "/hrm/employee-referrals", activePath: "/hrm/employee-referrals", hidden: true },
      { id: "tasks", label: "Tasks", href: "/hrm/tasks", activePath: "/hrm/tasks" },
      // The candidate register: HRM's counterpart of Leads & Followups, fed by hand and by the
      // Google Sheets linked under Settings → Integrations → Interview. Its own permission,
      // `HRM / Interview`, which `modulePermissions.js` names for this route.
      { id: "interview", label: "Interview", href: "/hrm/interview", activePath: "/hrm/interview" },
      // Payroll, behind its own permission, `HRM / Payroll` - on the sidebar again now that its Main
      // Page, Advance Salary and Recovery are in use.
      { id: "payroll", label: "Payroll", href: "/hrm/payroll", activePath: "/hrm/payroll" },
      // The signed-in employee's own payslips, behind `HRM / My Payslip`. Off the menu: a tab of My
      // Profile now. The route stays, and so does the permission.
      { id: "payslip", label: "Payslip", href: "/hrm/payslip", activePath: "/hrm/payslip", hidden: true },
    ],
  },
  {
    id: "sales-crm",
    title: "Sales & CRM",
    module: "SALES",
    icon: "TrendingUp",
    items: [
      { id: "leads-followups", label: "Leads & Followups", href: "/sales/crm", activePath: "/sales/crm" },
      { id: "reports-analytics", label: "Reports & Analytics", href: "/sales/reports", activePath: "/sales/reports" },
      { id: "contacts", label: "Contacts", href: "/sales/contacts", activePath: "/sales/contacts" },
      { id: "bookings-converted", label: "Bookings & Converted", href: "/sales/manager", activePath: "/sales/manager" },
      { id: "quotations", label: "Quotations", href: "/sales/quotation", activePath: "/sales/quotation" },
    ],
  },
  {
    id: "project-management",
    title: "Project Management",
    module: "PROJECT",
    icon: "AccountTree",
    items: [
      { id: "projects", label: "Projects", href: "/project-management/projects", activePath: "/project-management/projects", hidden: true },
      // `activePath` is the board's prefix, so the entry stays lit on the vertical boards beneath it
      // (`/pre-production/corp`, `/dum-dum`, `/qua-qua`), which share its one permission.
      { id: "pre-production", label: "Pre Production", href: "/project-management/pre-production", activePath: "/project-management/pre-production", hidden: true },
      { id: "production", label: "Production", href: "/project-management/production", activePath: "/project-management/production", hidden: true },
      { id: "shoot-board", label: "Shoot Board", href: "/project-management/shoot-board", activePath: "/project-management/shoot-board", hidden: true },
      { id: "crd-documents", label: "CRD Documents", href: "/project-management/crd-documents", activePath: "/project-management/crd-documents", hidden: true },
      { id: "client-gifts", label: "Client Gifts", href: "/project-management/client-gifts", activePath: "/project-management/client-gifts", hidden: true },
      { id: "feedback", label: "Customer Issues and Feedback", href: "/project-management/feedback", activePath: "/project-management/feedback", hidden: true },
    ],
  },
  {
    id: "visual-curation",
    title: "Visual Curation",
    module: "IMAGE_SELECTION",
    icon: "PhotoLibrary",
    items: [
      // The AI Feature: event galleries with face recognition, first in the section because it is the
      // newest product and the one the studio opens most while an event is running. A screen of its
      // own with its own permission, routes, tables and storage - it shares this heading with Image
      // Selection and nothing else. Overview and Events are the pair its own header switches between,
      // so neither is listed here; the entry lands on the overview and `activePath` is the module.
      { id: "ai-feature", label: "AI Feature", href: "/visual-curation/ai/overview", activePath: "/visual-curation/ai", hidden: true },
      // Photo Selling sells an event's photos to its guests: a sibling of the AI Feature, not an
      // option under it, with a permission of its own. Its route sits under the AI Feature's prefix,
      // so the sidebar lights whichever entry claims the open page most closely.
      { id: "photo-selling", label: "Photo Selling", href: "/visual-curation/ai/photo-selling", hidden: true },
      // One entry for Image Selection, and it is the only one: Dashboard and Projects are not listed
      // beneath it. They are the pair the module's own header switches between, and listing them
      // here as well put the same choice in two places. The entry lands on the dashboard, and
      // `activePath` is the module rather than that one route, so it stays lit on the Projects page.
      // Shown as "Photo Selection"; the id, routes and permission keep the Image Selection names.
      { id: "image-selection", label: "Photo Selection", href: "/image-selection/dashboard", activePath: "/image-selection", hidden: true },
      // AI Culling, AI Editing and Signature Album are modules of their own, built the way Photo
      // Selection is: a Dashboard and a Projects page each, over the same Image Selection projects,
      // a project opening on that module's own workspace. Each entry lands on its dashboard and
      // `activePath` is the module, so it stays lit on its Projects page. The routes sit under
      // /image-selection like Album Proofing's, each longer than that prefix, so the sidebar lights
      // the module rather than Photo Selection.
      { id: "ai-culling", label: "AI Culling", href: "/image-selection/ai-culling/dashboard", activePath: "/image-selection/ai-culling", hidden: true },
      { id: "ai-editing", label: "AI Editing", href: "/image-selection/ai-editing/dashboard", activePath: "/image-selection/ai-editing", hidden: true },
      { id: "signature-album", label: "Signature Album", href: "/image-selection/signature-album/dashboard", activePath: "/image-selection/signature-album", hidden: true },
      // Album Proofing is a screen of its own, not a section of Image Selection: its own permission,
      // its own page, and its own row here — which is what `sidebarStructure.js` mirrors on the
      // backend as `"visual-curation": ["image-selection", "album-proofing"]`.
      // The entry lands on its dashboard, as Image Selection's does, and `activePath` is the module
      // so it stays lit on the Projects page beside it.
      { id: "album-proofing", label: "Album Proofing", href: "/image-selection/album-proofing/dashboard", activePath: "/image-selection/album-proofing", hidden: true },
    ],
  },
  {
    id: "accounts",
    title: "Accounts",
    module: "ACCOUNTS",
    icon: "AccountBalanceWallet",
    items: [
      { id: "accounts-manager", label: "Accounts Manager", href: "/accounts/manager", activePath: "/accounts/manager" },
      { id: "payment-requests", label: "Payment Requests", href: "/accounts/payment-requests", activePath: "/accounts/payment-requests" },
    ],
  },
  // Post Production has a page and a permission of its own, and is deliberately not listed here yet:
  // the board is not ready to be handed to the studio. It is reached by address until it is, and
  // `NO_MENU_ENTRY` in `backend/test/permission-catalogue-sidebar.test.js` records that as a
  // decision rather than an omission. Pre Production and Production have moved into Project
  // Management above.
  {
    id: "resource-management",
    title: "Resource Management",
    module: "ASSET",
    icon: "Inventory2",
    items: [
      { id: "assets", label: "Assets", href: "/asset-management/assets", activePath: "/asset-management/assets" },
      { id: "vendors", label: "Vendors", href: "/asset-management/vendors", activePath: "/asset-management/vendors" },
      { id: "client-storage", label: "Client Storage", href: "/asset-management/client-storage", activePath: "/asset-management/client-storage" },
      { id: "recycling-bin", label: "Project Vault", href: "/asset-management/recycling-bin", activePath: "/asset-management/recycling-bin" },
    ],
  },
];

/**
 * The registry as the nav's older readers know it.
 *
 * Identical in shape to what this file exported before ids existed, so `modulePermissions.js`, the
 * role-label test and anything else reading `MENU_GROUPS` are untouched by the registry growing
 * fields. It is the same objects, not a copy: there is one list.
 */
export const MENU_GROUPS = SIDEBAR_MODULES;

/** Every module id, in default order. */
export const SIDEBAR_MODULE_IDS = SIDEBAR_MODULES.map((group) => group.id);

/**
 * Which module each screen belongs to: `{ "quotations": "sales-crm", ... }`.
 *
 * This is the relationship a saved layout may never redefine — a screen is reordered inside its own
 * module and can be nowhere else — and it is what both the browser and the server check a layout
 * against.
 */
export const SIDEBAR_PARENT_BY_ITEM = Object.fromEntries(
  SIDEBAR_MODULES.flatMap((group) => (group.items || []).map((item) => [item.id, group.id]))
);

/** One module's screen ids, in default order. */
export const sidebarItemIds = (moduleId) =>
  (SIDEBAR_MODULES.find((group) => group.id === moduleId)?.items || []).map((item) => item.id);

/** A path with its query, its hash and any trailing slash taken off, so two spellings match. */
const normalizeRoute = (pathname) => {
  const path = String(pathname || "").split(/[?#]/)[0].trim();
  return path.length > 1 ? path.replace(/\/+$/, "") : path;
};

/**
 * The sidebar's own name for a screen, by route — `"Quotations"` for `/sales/quotation`.
 *
 * This is what stops a page's heading and the menu entry that opens it from calling one screen two
 * things, which is the same drift `MODULE_LABELS` and `FEATURE_LABELS` in `modulePermissions.js`
 * close for the Roles screen: the label is written here, once, and everything that has to say the
 * screen's name reads it from here rather than repeating it.
 *
 * Matched exactly rather than by prefix, and that is the point of it. A screen the sidebar lists is
 * the page at that route; anything deeper — a project's own workspace under
 * `/image-selection/projects/…`, a record opened from a table — is a different page with a name of
 * its own, and a prefix match would rename all of them after the menu entry above them.
 *
 * Answers `""` for a route the sidebar does not list, which is not a failure: My Profile,
 * Administration and the Pre Production vertical boards are real screens the menu does not carry, and they
 * keep the titles they set for themselves.
 */
export function sidebarLabelForRoute(pathname) {
  const route = normalizeRoute(pathname);
  if (!route) return "";
  for (const group of SIDEBAR_MODULES) {
    for (const item of group.items || []) {
      if (normalizeRoute(item.href) === route || normalizeRoute(item.activePath) === route) return item.label;
    }
  }
  return "";
}
