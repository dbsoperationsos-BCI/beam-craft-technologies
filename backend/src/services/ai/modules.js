/**
 * The modules Nebula can operate in.
 *
 * Every entry mirrors a row that exists in the `permission` table. That is the whole point of this
 * file: an AI scope named anything else - "crm", "project", "technical" - cannot be checked, because
 * `checkPermission` looks up a `module`+`feature` pair and a pair that was never seeded matches
 * nothing. A check against a name that does not exist does not fail loudly; it quietly returns
 * whatever the helper's default is, which is how an access control system ends up open.
 *
 * So the names here are the CRM's own: SALES, HRM, IMAGE_SELECTION, ASSET, ACCOUNTS. What the
 * screen calls a module and what the database calls one are the same string.
 *
 * Most entries are named for their permission module, but not all: an AI scope is *a screen you are
 * standing on*, and two screens can share a permission module while being different work. So a
 * scope may carry `permissionModule` to say which row it is checked against, and `id` stays the
 * name the screen and the session use.
 *
 * No scope needs that indirection today: `PROJECT` is checked against `PROJECT / Projects`, its own
 * module's permission. It used to point at `SALES / Project Management`, which the IAM restructure
 * removed when production became a module of its own, so the mechanism stays for the next scope
 * whose screen and permission are named differently — and the test below is what keeps any such
 * pair honest against the catalogue.
 *
 * One thing this file still does not do: register TECHNICAL. There is no such permission, no
 * backend module and no frontend route - registering it would advertise a scope with nothing
 * behind it.
 */

/*
 * GLOBAL is not a permission and never will be.
 *
 * It is the Super Admin's cross-module scope, and it is granted by `accessContext.js` after reading
 * the user's role from the database - never from a request body and never from the JWT. It is named
 * here only so the registry can answer questions about it.
 */
const GLOBAL = "GLOBAL";

const AI_MODULES = {
  SALES: {
    id: "SALES",
    label: "Sales",
    /*
     * The feature an AI session in this module answers for.
     *
     * One feature per module for now, and it is the feature whose data the tools will read. A
     * module with several features - SALES also has Project Management and Quotation Management -
     * gets those as separate scopes when tools exist for them, rather than one scope quietly
     * spanning three permissions.
     */
    feature: "CRM Leads",
    description: "Leads, follow-ups, calls, transcripts and conversations in the CRM.",
  },
  HRM: {
    id: "HRM",
    label: "HRM",
    feature: "Employee Management",
    description: "Employees, onboarding and separations.",
  },
  IMAGE_SELECTION: {
    id: "IMAGE_SELECTION",
    label: "Image Selection",
    feature: "Project Management",
    description: "Selection projects, folders, galleries and deliverables.",
  },
  ASSET: {
    id: "ASSET",
    label: "Assets",
    feature: "Asset Management",
    description: "Assets, assignments and inspections.",
  },
  ACCOUNTS: {
    id: "ACCOUNTS",
    label: "Accounts",
    feature: "Cash Management",
    description: "Cash entries and account summaries.",
  },
  PROJECT: {
    id: "PROJECT",
    label: "Project Management",
    /*
     * `PROJECT / Projects` — the permission that plans a project, and the one the four
     * project-management screens share a read of.
     *
     * It was `SALES / Project Management` until the IAM restructure made production its own module
     * ("once a sale becomes a project it is the production pipeline's"), which removed that pair
     * from the catalogue without anything here noticing. Nothing looked broken locally, because a
     * database seeded before the change still held the old row; a freshly seeded one did not, and
     * the scope was being checked against a permission that could never match.
     */
    feature: "Projects",
    description: "Projects through pre-production, production and post-production.",
  },
  ADMIN: {
    id: "ADMIN",
    label: "Administration",
    permissionModule: "ADMIN",
    feature: "User Management",
    /*
     * Registered so the assistant is present on every signed-in screen, and deliberately given no
     * tools. Role and user management is not work an assistant should be reasoning *about* - this
     * is the module that grants every other module - so it can talk here and read nothing. A scope
     * with no tools is a supported state: it says it cannot look anything up and answers from
     * experience.
     */
    description: "Users, roles and access.",
  },
};

/** Every registered module id, not including GLOBAL. */
function moduleIds() {
  return Object.keys(AI_MODULES);
}

/** A registered module, or null. Never throws: an unknown name is a request to refuse, not a crash. */
function findModule(id) {
  const key = String(id || "").trim().toUpperCase();
  return AI_MODULES[key] || null;
}

/**
 * The permission row a scope is checked against.
 *
 * The scope's own id unless it says otherwise. No scope overrides it today; the indirection stays
 * so a screen whose permission is named differently can be registered without every caller having
 * to know which scopes are which.
 */
function permissionModuleFor(registered) {
  return registered?.permissionModule || registered?.id || "";
}

/** Whether a name is the cross-module scope. */
function isGlobal(id) {
  return String(id || "").trim().toUpperCase() === GLOBAL;
}

/**
 * Whether a name is one this system will even consider.
 *
 * Separate from whether the asker may use it - that is `accessContext.js`. This only says the name
 * corresponds to something real.
 */
function isKnownScope(id) {
  return isGlobal(id) || Boolean(findModule(id));
}

module.exports = { AI_MODULES, GLOBAL, moduleIds, findModule, permissionModuleFor, isGlobal, isKnownScope };
