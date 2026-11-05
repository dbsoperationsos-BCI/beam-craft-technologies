const { z } = require("zod");
const { phonesMatch } = require("../../hrm/onboarding-invites/controller");

/** Beam Craft's products, each with its own page under SUBSCRIBE and its own list of companies. */
const PRODUCTS = Object.freeze({
  MEDIA_STUDIO_OPERATIONS: "Orbyt",
  ACCOUNT_MANAGER: "Nilo",
});

const isProduct = (value) => Object.prototype.hasOwnProperty.call(PRODUCTS, value);

const GST_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const PAN_PATTERN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

// A client's logo and favicon: any common image, kept as uploaded (a PNG keeps its transparency).
const IMAGE_TYPES = Object.freeze({ "image/png": "png", "image/jpeg": "jpg", "image/jpg": "jpg", "image/svg+xml": "svg", "image/webp": "webp", "image/gif": "gif", "image/x-icon": "ico", "image/vnd.microsoft.icon": "ico", "image/avif": "avif" });
const LOGO_RULE = Object.freeze({ types: Object.keys(IMAGE_TYPES), extensions: IMAGE_TYPES, maxBytes: 10 * 1024 * 1024, label: "Logo must be an image (PNG, JPG, SVG, WebP, GIF, ICO or AVIF)" });
const FAVICON_RULE = Object.freeze({ types: Object.keys(IMAGE_TYPES), extensions: IMAGE_TYPES, maxBytes: 5 * 1024 * 1024, label: "Favicon must be an image (PNG, JPG, SVG, WebP, GIF, ICO or AVIF)" });

/**
 * Where an invite stands. Only Created/Verified/Submitted/Cancelled are stored; Expired is read off the
 * date, so a link stops working at its expiry without anything having to run.
 */
function inviteState(invite, now = new Date()) {
  if (invite?.submittedAt) return "Submitted";
  if (invite?.cancelledAt) return "Cancelled";
  if (!invite?.expiresAt || new Date(invite.expiresAt) < now) return "Expired";
  return "Pending";
}

const required = (label, max) => z.string({ error: `${label} is required.` }).trim().min(1, `${label} is required.`).max(max, `${label} is too long.`);
const code = (label, pattern, example) => z.string({ error: `${label} is required.` })
  .transform((value) => value.trim().toUpperCase())
  .pipe(z.string().regex(pattern, `Enter a valid ${label} (e.g. ${example}).`));

const submissionSchema = z.object({
  companyName: required("Company name", 150),
  address: required("Address", 500),
  gstNumber: code("GST number", GST_PATTERN, "33ABCDE1234F1Z5"),
  panNumber: code("PAN number", PAN_PATTERN, "ABCDE1234F"),
  // Data URIs: base64 is 4/3 of the file, so room for a 10 MB logo and a 5 MB favicon.
  logo: required("Logo", 14 * 1024 * 1024),
  favicon: required("Favicon", 7 * 1024 * 1024),
  usersNeeded: z.coerce.number({ error: "Number of users is required." }).int("Number of users must be a whole number.").min(1, "Number of users must be at least 1."),
  mainContactName: required("Main contact name", 150),
  mainContactPhone: required("Main contact number", 30),
  mainContactDesignation: required("Main contact designation", 150),
  secondaryContactName: required("Secondary contact name", 150),
  secondaryContactPhone: required("Secondary contact number", 30),
  secondaryContactDesignation: required("Secondary contact designation", 150),
});

/**
 * The invite as the team creates it: only the company's details, each optional - whatever is filled in
 * appears already filled on the client's form, where every field is required.
 */
const prefillSchema = z.preprocess(
  (value) => Object.fromEntries(Object.entries(value && typeof value === "object" ? value : {})
    .filter(([, field]) => field !== null && field !== undefined && String(field).trim() !== "")),
  submissionSchema.partial(),
);
/**
 * Create Onboarding Invite, as the employee invite asks it: who the link is for and until when. Every
 * field is required; the company's own details are the client's to fill in on the form.
 */
const contactSchema = z.object({
  contactName: required("Company name", 150),
  contactEmail: z.string({ error: "Company email ID is required." }).trim().toLowerCase().email("Enter a valid company email ID.").max(191, "Company email ID is too long."),
  contactPhone: required("Company phone number", 30),
  expiresAt: z.string({ error: "Choose the expiry date." }).regex(/^\d{4}-\d{2}-\d{2}$/, "Choose the expiry date."),
});
const clientInviteSchema = contactSchema.extend({ company: prefillSchema.default({}) });

/** Why an uploaded data URI is not acceptable under `rule`, or null when it is. */
function checkUpload(dataUri, { types, maxBytes, label }) {
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUri || ""));
  const kinds = types.map((type) => type.split("/")[1].replace("+xml", "").toUpperCase()).join(" or ");
  if (!match || !types.includes(match[1])) return `${label || `File must be a ${kinds} file`}.`;
  const base64 = match[2];
  const bytes = Math.floor((base64.length * 3) / 4) - (base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0);
  if (bytes > maxBytes) return `File must be ${Math.round(maxBytes / (1024 * 1024))} MB or smaller.`;
  return null;
}

/**
 * Client Details → Import: one company per row, as its onboarding form would file it, without the
 * logo and favicon (added later in Edit). Product is optional and read by its name (Orbyt, Nilo) or key;
 * an unknown name is an error rather than a silent blank.
 */
const productFromName = (value) => {
  const text = String(value ?? "").trim();
  if (!text) return undefined;
  const key = Object.keys(PRODUCTS).find((product) => product === text.toUpperCase() || PRODUCTS[product].toLowerCase() === text.toLowerCase());
  return key ?? `?${text}`;
};
const importClientSchema = submissionSchema.omit({ logo: true, favicon: true }).extend({
  contactEmail: z.string().trim().toLowerCase().email("Enter a valid email.").max(191).optional(),
  product: z.string().optional().transform(productFromName)
    .refine((value) => value === undefined || isProduct(value), { message: `Choose ${Object.values(PRODUCTS).join(" or ")}.` }),
});

module.exports = { importClientSchema, PRODUCTS, isProduct, inviteState, contactSchema, clientInviteSchema, submissionSchema, checkUpload, phonesMatch, LOGO_RULE, FAVICON_RULE };
