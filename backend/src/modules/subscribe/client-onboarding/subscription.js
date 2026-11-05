const crypto = require("crypto");
const { z } = require("zod");
const { isProduct } = require("./rules");

/**
 * What each product can be given: its modules and, inside each, its screens - copied from DBS-Operations-OS's
 * sidebar, so a client can be given one screen of a module (HRM with only Interview). Both products offer the
 * same list; Velava (Account Manager) reads hrm/employee-repository as its Users screen. A selection is
 * stored as "module/screen" keys, which is what the client's app reads.
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

const MODULES_BY_PRODUCT = Object.freeze({ ACCOUNT_MANAGER: NILO_MODULES, MEDIA_STUDIO_OPERATIONS: ALL_MODULES });

/** Whether "module/screen" is one of `product`'s screens. Own keys only, so "hrm/constructor" is not. */
function isProductScreen(product, key) {
  const [module, screen, ...rest] = String(key).split("/");
  const modules = MODULES_BY_PRODUCT[product];
  return !rest.length && Boolean(modules && Object.hasOwn(modules, module) && Object.hasOwn(modules[module].screens, screen));
}

const SUBDOMAIN_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;
const USERNAME_PATTERN = /^[A-Za-z0-9._-]{3,60}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
// No 0/O, 1/l/I: a password read out over the phone must not be misheard.
const PASSWORD_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

/** A typed subdomain, or the whole address it makes, as the bare subdomain. */
const toSubdomain = (value) => String(value).trim().toLowerCase()
  .replace(/^https?:\/\//, "").replace(/\/+$/, "").replace(/\.beamcraft\.tech$/, "");

const subscriptionSchema = z.object({
  product: z.string().refine(isProduct, "Choose the product."),
  // The full address is read as its subdomain: "https://Velava.beamcraft.tech/" is "velava".
  subdomain: z.string().transform(toSubdomain)
    .pipe(z.string().regex(SUBDOMAIN_PATTERN, "Subdomain: 3-40 lowercase letters, digits or hyphens, not starting or ending with a hyphen.")),
  usersAllowed: z.coerce.number().int("Number of users must be a whole number.").min(1, "Number of users must be at least 1."),
  adminUsername: z.string().trim().regex(USERNAME_PATTERN, "Admin username: 3-60 letters, digits, dots, underscores or hyphens."),
  validFrom: z.string().regex(DATE_PATTERN, "Choose the Valid From date."),
  validUntil: z.string().regex(DATE_PATTERN, "Choose the Valid Until date."),
  modules: z.array(z.string()).min(1, "Choose at least one screen.").transform((keys) => [...new Set(keys)]),
  resetPassword: z.boolean().optional(),
}).superRefine((value, ctx) => {
  if (value.validUntil < value.validFrom) ctx.addIssue({ code: "custom", path: ["validUntil"], message: "Valid Until must be on or after Valid From." });
  if (value.modules.some((key) => !isProductScreen(value.product, key))) ctx.addIssue({ code: "custom", path: ["modules"], message: "Choose screens from this product's modules." });
});

function generatePassword(length = 12) {
  return Array.from({ length }, () => PASSWORD_ALPHABET[crypto.randomInt(PASSWORD_ALPHABET.length)]).join("");
}

// Today's date in India, "YYYY-MM-DD" - the day a subscription is read against.
const todayIst = (now) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(now);
const dateOnly = (value) => new Date(value).toISOString().slice(0, 10);

/** Active through the whole of its last day (Indian time), Expired from the next; null until set up. */
function subscriptionStatus(client, now = new Date()) {
  if (!client?.activatedAt || !client.validUntil) return null;
  return todayIst(now) <= dateOnly(client.validUntil) ? "Active" : "Expired";
}

const formatDay = (value) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(value));

/** The message the team copies to the client: where to log in and with what. */
function accountMessage({ contactName, subdomain, adminUsername, password, validUntil }) {
  return [
    `Hi ${contactName || "there"},`,
    "",
    "Your Beam Craft account is ready.",
    `Login: https://${subdomain}.beamcraft.tech`,
    `Username: ${adminUsername}`,
    `Password: ${password}`,
    `Valid until: ${formatDay(validUntil)}`,
    "",
    "Please change the password after your first login and keep it to yourself.",
  ].join("\n");
}

module.exports = { MODULES_BY_PRODUCT, SUBDOMAIN_PATTERN, isProductScreen, subscriptionSchema, generatePassword, subscriptionStatus, accountMessage, dateOnly };
