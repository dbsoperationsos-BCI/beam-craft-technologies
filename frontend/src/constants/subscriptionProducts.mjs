/** Beam Craft's products, each a page under SUBSCRIBE. The keys match the backend's. */
export const PRODUCTS = Object.freeze({
  MEDIA_STUDIO_OPERATIONS: "Orbyt",
  ACCOUNT_MANAGER: "Nilo",
});

export const CLIENT_TABS = ["All", "Form Pending", "Submitted", "Active", "Update Pending", "Expired", "Link Expired/Cancelled"];

/**
 * Where a row stands: the invite's link (Form Pending, or a link that expired or was cancelled), then,
 * once the company submitted, its account - Submitted until it is set up, then Active or Expired.
 */
const TAB_BY_STATE = { Pending: "Form Pending", Expired: "Link Expired/Cancelled", Cancelled: "Link Expired/Cancelled" };
// A live client with a change saved and not yet published is Update Pending until Update site.
function tabFor(invite) {
  if (invite.state !== "Submitted") return TAB_BY_STATE[invite.state];
  const subscription = invite.client?.subscription;
  if (subscription === "Active" && invite.client?.pendingChanges) return "Update Pending";
  return subscription || "Submitted";
}

export const inTab = (row, tab) => tab === "All" || row.tab === tab;

const checkedAt = (value) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" }).format(new Date(value));

/** A live site's health as the table shows it: status, speed, when last checked, uptime over a day. */
function healthFields(health) {
  return {
    healthStatus: health?.status || "Not checked yet",
    responseLabel: health?.responseMs != null ? `${health.responseMs} ms` : "",
    lastCheckedLabel: health?.lastCheckedAt ? checkedAt(health.lastCheckedAt) : "",
    uptimeLabel: health?.uptime24h != null ? `${health.uptime24h}%` : "",
    siteVersion: health?.siteVersion || "",
    healthError: health?.error || "",
  };
}

/**
 * A product's page under SUBSCRIBE shows what is live: only clients whose account is set up, as Active
 * or Expired. The steps before and between - Form Pending, Submitted, Update Pending - belong to
 * Client Details, so a client with a change waiting is still Active here, on the version it runs.
 */
export const LIVE_TABS = ["All", "Active", "Expired"];
export function liveRow(row) {
  const live = row.client?.subscription;
  return live ? { ...row, tab: live, status: live } : null;
}

export const clientStatusStyles = { "Form Pending": "bg-amber-500", Submitted: "bg-blue-500", Active: "bg-emerald-500", "Update Pending": "bg-violet-500", Expired: "bg-red-500", "Link Expired/Cancelled": "bg-slate-400", Up: "bg-emerald-500", Down: "bg-red-500", "Not checked yet": "bg-slate-300" };

/**
 * What each product can be given: modules and their screens, the same keys and labels as the server's
 * `MODULES_BY_PRODUCT`: Orbyt offers DBS-Operations-OS's sidebar, Nilo its own three screens. Stored as
 * "module/screen".
 */
const ALL_MODULES = {
  hrm: { label: "Human Resource Management (HRM)", screens: { "employee-repository": "User Management", "employee-attendance": "Attendance", tasks: "Tasks", interview: "Interview", payroll: "Payroll" } },
  "sales-crm": { label: "Sales & CRM", screens: { "leads-followups": "Leads & Followups", "reports-analytics": "Reports & Analytics", contacts: "Contacts", "bookings-converted": "Bookings & Converted", quotations: "Quotations" } },
  "client-management": { label: "Client Management", screens: { "client-offers": "Client Offers", "client-chats": "Client Chats", "invitation-cards": "Invitation Cards", "client-requests": "Client Requests" } },
  "project-management": { label: "Project Management", screens: { projects: "Projects", "pre-production": "Pre Production", production: "Production", "shoot-board": "Shoot Board", "crd-documents": "CRD Documents", "client-gifts": "Client Gifts", feedback: "Customer Issues and Feedback" } },
  "visual-curation": { label: "Visual Curation", screens: { "ai-feature": "AI Feature", "photo-selling": "Photo Selling", "image-selection": "Photo Selection", "album-proofing": "Album Proofing" } },
  accounts: { label: "Accounts", screens: { "accounts-manager": "Accounts Manager", "payment-requests": "Payment Requests" } },
  "resource-management": { label: "Resource Management", screens: { assets: "Assets", vendors: "Vendors", "client-storage": "Client Storage", "recycling-bin": "Project Vault" } },
};

// Nilo (the Account Manager app, e.g. Velava) has three screens. The keys are the ones the app reads
// (`hrm/employee-repository` is its Users screen), so a saved setup keeps working.
const NILO_MODULES = {
  hrm: { label: "User Management", screens: { "employee-repository": "Users" } },
  accounts: { label: "Accounts", screens: { "accounts-manager": "Accounts Manager" } },
  "resource-management": { label: "Resource Management", screens: { vendors: "Vendors" } },
};

export const MODULES_BY_PRODUCT = { ACCOUNT_MANAGER: NILO_MODULES, MEDIA_STUDIO_OPERATIONS: ALL_MODULES };

// Account Manager's own keys from before it offered the full list, as the screens they became.
const RENAMED_SCREENS = { "user-management/users": "hrm/employee-repository", "user-management": "hrm/employee-repository" };

/**
 * A saved selection as "module/screen" keys of `product`, in the catalogue's order. A bare module key -
 * how accounts set up before screens existed were saved - stands for every screen of that module.
 */
export function screensFrom(product, saved) {
  const modules = MODULES_BY_PRODUCT[product] || {};
  const picked = new Set((Array.isArray(saved) ? saved : []).map((key) => RENAMED_SCREENS[key] || key).flatMap((key) => (
    String(key).includes("/") ? [key] : Object.hasOwn(modules, key) ? Object.keys(modules[key].screens).map((screen) => `${key}/${screen}`) : []
  )));
  return Object.entries(modules).flatMap(([module, { screens }]) => Object.keys(screens).map((screen) => `${module}/${screen}`)).filter((key) => picked.has(key));
}

/** "Module: Screen, Screen · Module: Screen" - what the client has, for the details panel. */
export function modulesSummary(product, saved) {
  const modules = MODULES_BY_PRODUCT[product] || {};
  const keys = screensFrom(product, saved);
  return Object.entries(modules)
    .map(([module, { label, screens }]) => [label, Object.entries(screens).filter(([screen]) => keys.includes(`${module}/${screen}`)).map(([, name]) => name)])
    .filter(([, names]) => names.length)
    .map(([label, names]) => `${label}: ${names.join(", ")}`)
    .join(" · ");
}

/**
 * One table row per invite. Once the company has submitted, the row reads as the company; until then
 * the person the invite went to stands in the contact columns, so a pending row is never blank.
 */
export function clientRow(invite) {
  // Submitted: the filed company. Pending: the company as the team entered it on the invite.
  const client = invite.client || invite.company || {};
  return {
    ...client,
    ...invite,
    id: invite.id,
    companyName: client.companyName || "",
    mainContactName: client.mainContactName || invite.contactName || "",
    mainContactPhone: client.mainContactPhone || invite.contactPhone || "",
    usersNeeded: client.usersNeeded ?? null,
    tab: tabFor(invite),
    versionLabel: client.liveVersion ? `v${client.liveVersion}` : "",
    ...healthFields(client.health),
    modulesSummary: modulesSummary(invite.product, client.modules),
    status: tabFor(invite),
  };
}

/** [key, label, type, width, minWidth] - the shape `buildTableColumns` reads. The onboarding form's fields, in its order. */
export const clientTableFields = [
  ["companyName", "Name Of The Company", undefined, 220, 170],
  // Where the client stands - Form Pending, Submitted, Active, Expired - as a coloured dot, like DBS's employment status.
  ["status", "Status", "status", 190, 150],
  ["address", "Address", undefined, 260, 180],
  ["mainContactName", "Main Contact Name", undefined, 180, 140],
  ["mainContactPhone", "Main Contact Number", undefined, 170, 140],
  ["mainContactDesignation", "Main Contact Designation", undefined, 190, 150],
  ["secondaryContactName", "Secondary Contact Name", undefined, 190, 150],
  ["secondaryContactPhone", "Secondary Contact Number", undefined, 190, 150],
  ["secondaryContactDesignation", "Secondary Contact Designation", undefined, 210, 160],
  ["gstNumber", "GST Number", undefined, 170, 140],
  ["panNumber", "PAN Number", undefined, 140, 120],
  ["logoUrl", "Logo", "image", 90, 80],
  ["faviconUrl", "Favicon", "image", 90, 80],
  ["usersNeeded", "Number Of Users Needed", undefined, 180, 140],
];

// A product's own page under SUBSCRIBE lists only who the company is and how to reach it.
const productTableFields = [
  ["companyName", "Company Name", undefined, 260, 180],
  // Active or Expired - the live subscription, never the steps Client Details works through.
  ["status", "Status", "status", 140, 110],
  ["mainContactPhone", "Contact Number", undefined, 200, 150],
  // The version live on the client's site - moves when Update site publishes a change.
  ["versionLabel", "Version", undefined, 120, 100],
  // Whether the live site answers, from the monitor's checks every 5 minutes.
  ["healthStatus", "Health", "status", 160, 130],
  ["responseLabel", "Response", undefined, 130, 110],
  ["lastCheckedLabel", "Last Checked", undefined, 170, 140],
  ["uptimeLabel", "Uptime (24h)", undefined, 140, 120],
];

/** Client Details shows every field of the form; a product's page, the short list. */
export const clientTableFieldsFor = (product) => (product ? productTableFields : clientTableFields);

export const clientInfoSections = [
  { title: "Company Details", fields: [["companyName", "Name Of The Company"], ["address", "Address"], ["gstNumber", "GST Number"], ["panNumber", "PAN Number"], ["usersNeeded", "Number Of Users Needed"]] },
  { title: "Main Contact Person", fields: [["mainContactName", "Name"], ["mainContactPhone", "Contact Number"], ["mainContactDesignation", "Designation"]] },
  { title: "Secondary Contact Person", fields: [["secondaryContactName", "Name"], ["secondaryContactPhone", "Contact Number"], ["secondaryContactDesignation", "Designation"]] },
  { title: "Logo & Favicon", fields: [["logoUrl", "Logo", "gallery"], ["faviconUrl", "Favicon", "gallery"]] },
  { title: "Site Health", fields: [["healthStatus", "Health"], ["responseLabel", "Response Time"], ["lastCheckedLabel", "Last Checked"], ["uptimeLabel", "Uptime (24h)"], ["siteVersion", "App Version Reported"], ["healthError", "Last Problem"]] },
  { title: "Subscription", fields: [["subdomain", "Subdomain"], ["usersAllowed", "Number Of Users"], ["adminUsername", "Admin Username"], ["validFrom", "Valid From", "date"], ["validUntil", "Valid Until", "date"], ["modulesSummary", "Modules"]] },
];

/**
 * The last day of a term of `months` starting on `from` ("YYYY-MM-DD"): a year from 4 Nov ends 3 Nov.
 * A cleared or unreadable start has no end yet - "" rather than an error that would take the page down.
 */
export function termEnd(from, months) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(from || ""))) return "";
  const date = new Date(`${from}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return "";
  date.setUTCMonth(date.getUTCMonth() + months);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}
