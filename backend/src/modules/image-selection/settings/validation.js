const { z } = require("zod");
const { MIN_VALIDITY_MONTHS, MAX_VALIDITY_MONTHS, MAX_ROOT_PATH_LENGTH } = require("./service");
const { rootPathError } = require("../originals/paths");
const { MIN_SELECTION_LIMIT, MAX_SELECTION_LIMIT } = require("../deliverables/service");

/** How many pictures the login page will turn through - the same ceiling the Settings panel draws. */
const MAX_LOGIN_SLIDES = 5;

// A path on the machine running this backend: a drive letter or a UNC share, absolute, with no
// traversal in it. Blank clears the setting, which turns the feature off rather than half-on.
const serverPathSchema = (example) => z.string().trim().max(MAX_ROOT_PATH_LENGTH).nullish()
  .transform((value) => (value == null || value === "" ? null : value))
  .superRefine((value, ctx) => {
    if (value === null) return;
    const failure = rootPathError(value);
    if (failure) ctx.addIssue({ code: "custom", message: `${failure} For example ${example}.` });
  });

// The studio-wide default is bounded by the same range a single project's limit is, so a default
// can never be a number no project is allowed to hold.
//
// No *browser* download location appears here. Where a browser saves a file is the folder it was
// granted through the picker, which lives in that browser rather than on this record — a path typed
// into a form could never grant the access that writing one needs. The two paths below are
// different: they are resolved on this server, which does have the access.
// Every field here is optional at the schema level: the settings record is edited a section at a
// time -- Global Logo saves the name and logo, Login Slide saves the pictures, Project Settings
// saves the numbers and paths -- and none of those requests carries every other section's fields.
// Which of the parsed keys actually reach the database is decided in the controller, from which
// keys the request body itself held; see saveSettings.
const settingsSchema = z.object({
  galleryValidityMonths: z.coerce.number().int().min(MIN_VALIDITY_MONTHS).max(MAX_VALIDITY_MONTHS).optional(),
  defaultSelectionLimit: z.coerce.number().int().min(MIN_SELECTION_LIMIT).max(MAX_SELECTION_LIMIT).optional(),
  // The two server-side roots — absolute, no traversal — and a UNC share is explicitly allowed,
  // because the studio's masters usually sit on the NAS rather than a local drive.
  originalStoragePath: serverPathSchema("D:\\DBS-Originals"),
  selectedOutputPath: serverPathSchema("D:\\DBS-Selections"),
  // Optional, and a blank is an answer rather than a mistake: emptying the field clears the name,
  // and every surface that shows it - the top bar, the sign-in page, the client gallery - already
  // draws nothing when there is nothing to draw. It is only an install that has never saved these
  // settings at all that reads the default, which the service supplies and the column agrees with.
  studioName: z.string().trim().max(191).nullish().transform((value) => value ?? ""),
  // What the credentials email calls this system. Blank clears it, and the template then falls
  // back to the name it ships with rather than sending somebody an empty subject line.
  loginCredentialName: z.string().trim().max(120).nullish().transform((value) => (value == null || value === "" ? null : value)),
  // Either an existing https link, which is echoed back untouched, or a freshly picked image as a
  // data URI — which is why the ceiling is generous. The controller compresses and uploads it, and
  // only the resulting short public URL reaches the 500-character column.
  galleryLogoUrl: z.string().trim().max(10_000_000).nullish().transform((value) => (value == null || value === "" ? null : value)),
  // The same mark for the dark themes, travelling the same way. Null means "wear the light one".
  galleryLogoDarkUrl: z.string().trim().max(10_000_000).nullish().transform((value) => (value == null || value === "" ? null : value)),
  // The tab mark. Same shape as the logo: a data URI on the way in, a stored URL on the way back,
  // and null for "use the bundled pair".
  // A 5 MB file arrives base64-encoded, which is about a third longer again.
  faviconUrl: z.string().trim().max(8_000_000).nullish().transform((value) => (value == null || value === "" ? null : value)),
  // The tab mark for a dark browser strip, on the same terms.
  faviconDarkUrl: z.string().trim().max(8_000_000).nullish().transform((value) => (value == null || value === "" ? null : value)),
  // The login page's pictures, in order: each an existing https link or a freshly picked image as
  // a data URI, at most MAX_LOGIN_SLIDES of them. Left out of a request, the stored list stands.
  loginSlides: z.array(z.string().trim().min(1).max(10_000_000)).max(MAX_LOGIN_SLIDES).optional(),
});

/*
 * Settings → Project Management → Client page images: the client sign-in page's pictures, in order,
 * each an existing https link or a freshly picked image as a data URI. Its own schema and its own
 * permission, so the Organization form above cannot write them and this one cannot write anything
 * else - `strict` refuses any other key rather than quietly dropping it.
 */
const MAX_CLIENT_PAGE_IMAGES = 8;
// A 5 MB picture, base64-encoded, is about a third longer again - the most the field picks.
const MAX_CLIENT_PAGE_IMAGE_LENGTH = 7_000_000;
const clientPageImagesSchema = z.object({
  clientLoginSlides: z.array(z.string().trim().min(1).max(MAX_CLIENT_PAGE_IMAGE_LENGTH)).max(MAX_CLIENT_PAGE_IMAGES),
}).strict();

module.exports = { settingsSchema, MAX_LOGIN_SLIDES, clientPageImagesSchema, MAX_CLIENT_PAGE_IMAGES };
