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
  {
    // Beam Craft's client companies, in their own group rather than under HRM.
    id: "client-management",
    title: "Client Management",
    module: "SUBSCRIBE",
    icon: "Business",
    items: [
      // Was Employee Repository. The id stays (saved sidebar layouts and the Administration family key
      // on it); the employee list itself is still reached from the switch beside this page's heading.
      { id: "employee-repository", label: "Client Details", href: "/hrm/client-details", activePath: "/hrm/client-details" },
    ],
  },
  {
    id: "hrm",
    title: "Human Resource Management (HRM)",
    module: "HRM",
    icon: "Groups",
    items: [
      /*
       * Kept in the registry, taken out of the menu - see `hidden` below. Removing the three rows
       * outright would also take their names off the Roles screen (`FEATURE_LABELS` is built by
       * walking this list) and their screens out of Field Settings, and would leave the pages
       * with no name of their own for the topbar to read.
       */
      { id: "employee-attendance", label: "Employee Attendance", href: "/hrm/employee-attendance", activePath: "/hrm/employee-attendance", hidden: true },
      { id: "attendance-register", label: "Attendance Register", href: "/hrm/attendance", activePath: "/hrm/attendance", hidden: true },
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
      { id: "crd-documents", label: "CRD Documents", href: "/project-management/crd-documents", activePath: "/project-management/crd-documents", hidden: true },
      { id: "client-gifts", label: "Client Gifts", href: "/project-management/client-gifts", activePath: "/project-management/client-gifts", hidden: true },
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
      // One entry for Image Selection, and it is the only one: Dashboard and Projects are not listed
      // beneath it. They are the pair the module's own header switches between, and listing them
      // here as well put the same choice in two places. The entry lands on the dashboard, and
      // `activePath` is the module rather than that one route, so it stays lit on the Projects page.
      { id: "image-selection", label: "Image Selection", href: "/image-selection/dashboard", activePath: "/image-selection", hidden: true },
      // Album Proofing is a screen of its own, not a section of Image Selection: its own permission,
      // its own page, and its own row here — which is what `sidebarStructure.js` mirrors on the
      // backend as `"visual-curation": ["image-selection", "album-proofing"]`.
      { id: "album-proofing", label: "Album Proofing", href: "/image-selection/album-proofing", activePath: "/image-selection/album-proofing", hidden: true },
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
  // Pre Production, Production and Post Production have pages and permissions of their own, and are
  // deliberately not listed here yet: the boards are not ready to be handed to the studio. They are
  // reached by address until they are, and `NO_MENU_ENTRY` in
  // `backend/test/permission-catalogue-sidebar.test.js` records that as a decision rather than an
  // omission, so the drift test does not read them as three grants that lead nowhere.
  {
    id: "resource-management",
    title: "Resource Management",
    module: "ASSET",
    icon: "Inventory2",
    items: [
      { id: "assets", label: "Assets", href: "/asset-management/assets", activePath: "/asset-management/assets" },
      { id: "vendors", label: "Vendors", href: "/asset-management/vendors", activePath: "/asset-management/vendors" },
      { id: "client-storage", label: "Client Storage", href: "/asset-management/client-storage", activePath: "/asset-management/client-storage" },
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
 * Administration and the Pre Production boards are real screens the menu does not carry, and they
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
