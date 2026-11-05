const { z } = require("zod");
const prisma = require("../../../config/db");
const { isAdministrator } = require("../../../services/administrator");
const { storeImage, discardUploads } = require("../../../services/imageStorage");
const { payslipHeading } = require("../../../services/payslipHeading");
const { CERTIFICATE_KINDS, certificateHtml, settingsFromColumns } = require("../../../services/experienceCertificate");
const { EMPLOYMENT_LINES, offerLetterHtml } = require("../../../services/offerLetter");
const { importOfferSections } = require("../../../services/offerLetterImport");
const {
  OFFER_SIGNOFF_COLUMNS, draftOfferLetterHtml, offerLetterAfterDays, offerTemplateOptions, readOfferCompensation, readOfferEmployment, readOfferSections,
} = require("../../../services/offerLetterDocument");

/**
 * Settings → Employee → Certificate → Experience and Employment: each certificate's e-signature,
 * signatory and note, and its A4 preview. `:kind` is `experience` or `employment`. An
 * administrator's alone, like the rest of the Certificate group - the server's `isAdministrator`,
 * enforced on the router.
 */
/*
 * Every document with these settings: the two certificates, and the Offer Letter (`offer`) - the same
 * sign-off without the note, kept in its own columns and printed on its own letter. Only here:
 * Employee Repository → Generate draws the two certificates, never the offer letter.
 */
const SETTINGS_KINDS = {
  ...CERTIFICATE_KINDS,
  offer: { label: "Offer Letter", columns: OFFER_SIGNOFF_COLUMNS },
};
const readSettings = (kind) => settingsFromColumns(SETTINGS_KINDS[kind].columns);
// The document as the settings print it - the offer letter, with its sections, its lines and the
// payroll's payable day (`services/offerLetterDocument`), as the template every employee's is drawn from.
const documentHtml = async (kind, options) => (kind === "offer"
  ? offerLetterHtml({ ...options, ...(await offerTemplateOptions()) })
  : certificateHtml(kind, options));

async function preview(kind) {
  const [settings, heading] = await Promise.all([readSettings(kind), payslipHeading()]);
  return { ...settings, html: await documentHtml(kind, { heading, ...settings }) };
}

/** The certificate the path names, or a 404 for one that does not exist. */
function kindOf(req, res) {
  const kind = String(req.params?.kind || "");
  if (Object.hasOwn(SETTINGS_KINDS, kind)) return kind;
  res.status(404).json({ message: "There is no such certificate." });
  return null;
}

/** Admits administrators only; everybody else is refused before anything is read. */
async function requireAdministrator(req, res, next) {
  try {
    if (await isAdministrator(req.user?.id)) return next();
    return res.status(403).json({ message: "Only an administrator can manage the certificate settings." });
  } catch (error) {
    console.error("Unable to check the certificate settings access", error);
    return res.status(500).json({ message: "Unable to check your access to the certificate settings." });
  }
}

async function getCertificate(req, res) {
  const kind = kindOf(req, res);
  if (!kind) return undefined;
  try {
    return res.json({ data: await preview(kind) });
  } catch (error) {
    console.error(`Unable to load the ${kind} certificate settings`, error);
    return res.status(500).json({ message: "Unable to load the certificate settings." });
  }
}

/*
 * `signature`: a data image to store, the stored URL sent back unchanged, or null to remove it; left
 * out, it is left as it is. `note`: the text printed at the end, "" or null to remove it.
 */
const certificateSchema = z.object({
  signature: z.string().trim().max(10_000_000).nullish(),
  note: z.string().max(2000, "Keep the note under 2,000 characters.").nullish(),
  signatoryName: z.string().max(191, "Keep the signatory's name under 191 characters.").nullish(),
  signatoryDesignation: z.string().max(191, "Keep the designation under 191 characters.").nullish(),
  // The line it closes with, above the signature - "Sincerely," while empty.
  closing: z.string().max(100, "Keep the closing to 100 characters.").nullish(),
}).strict();

/*
 * A signature is a picture uploaded here - a PNG, JPEG or WebP data image - or the one already saved,
 * sent back unchanged. Never a link to somewhere else: a signature that pointed off-site could be
 * swapped by whoever owns that site, and a PDF printer would fetch it from the server.
 */
const SIGNATURE_IMAGE = /^data:image\/(png|jpe?g|webp);base64,[a-z0-9+/=\s]+$/i;
const signatureProblem = (value, savedUrl) => (
  value == null || value === "" || value === savedUrl || SIGNATURE_IMAGE.test(value)
    ? ""
    : "Upload the signature as a PNG, JPEG or WebP image."
);

async function saveCertificate(req, res) {
  const kind = kindOf(req, res);
  if (!kind) return undefined;
  const { columns } = SETTINGS_KINDS[kind];
  const parsed = certificateSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0]?.message || "Check the certificate settings." });
  const input = parsed.data;
  const uploads = [];
  try {
    const saved = await readSettings(kind);
    const problem = signatureProblem(input.signature, saved.signatureUrl);
    if (problem) return res.status(400).json({ message: problem });
    const data = { updatedByUserId: req.user?.id || null };
    if (input.signature !== undefined && input.signature !== saved.signatureUrl) {
      let stored = null;
      if (input.signature) {
        try {
          stored = await storeImage(input.signature, { folder: "hrm/certificates" });
        } catch (error) {
          console.error("Unable to store the certificate signature", error);
          return res.status(400).json({ message: "That signature image could not be read. Choose another PNG, JPEG or WebP image." });
        }
      }
      if (stored?.key) uploads.push(stored);
      data[columns.signatureUrl] = stored ? stored.url : null;
    }
    for (const key of ["note", "closing", "signatoryName", "signatoryDesignation"]) {
      // A document without that setting (the offer letter's note) has nowhere to keep it.
      if (input[key] !== undefined && columns[key]) data[columns[key]] = String(input[key] || "").trim() || null;
    }
    await prisma.hrmSettings.upsert({ where: { id: "default" }, update: data, create: { id: "default", ...data } });
    return res.json({ data: await preview(kind) });
  } catch (error) {
    await discardUploads(uploads);
    console.error(`Unable to save the ${kind} certificate settings`, error);
    return res.status(500).json({ message: "Unable to save the certificate settings." });
  }
}

/**
 * The preview for what is on screen and not saved yet - a signature just picked (a data image) and a
 * note being typed - so the A4 sheet follows the edit before Save. Nothing is stored.
 */
async function previewCertificate(req, res) {
  const kind = kindOf(req, res);
  if (!kind) return undefined;
  const parsed = certificateSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0]?.message || "Check the certificate settings." });
  try {
    const [saved, heading] = await Promise.all([readSettings(kind), payslipHeading()]);
    const problem = signatureProblem(parsed.data.signature, saved.signatureUrl);
    if (problem) return res.status(400).json({ message: problem });
    const signatureUrl = parsed.data.signature === undefined ? saved.signatureUrl : parsed.data.signature;
    const draft = (key) => (parsed.data[key] === undefined ? saved[key] : parsed.data[key]);
    return res.json({ data: { html: await documentHtml(kind, {
      heading, signatureUrl, note: draft("note"), closing: draft("closing"), signatoryName: draft("signatoryName"), signatoryDesignation: draft("signatoryDesignation"),
    }) } });
  } catch (error) {
    console.error(`Unable to preview the ${kind} certificate`, error);
    return res.status(500).json({ message: "Unable to preview the certificate." });
  }
}

/**
 * Settings → Employee → Certificate → Offer Letter → When to generate: `{ generateAfterDays }`. The
 * letter's sign-off and preview are `/offer`, as each certificate's are `/:kind`.
 */
async function getOfferLetterTiming(req, res) {
  try {
    return res.json({ data: { generateAfterDays: await offerLetterAfterDays() } });
  } catch (error) {
    console.error("Unable to load the offer letter", error);
    return res.status(500).json({ message: "Unable to load the offer letter." });
  }
}

const offerTimingSchema = z.object({
  generateAfterDays: z.number({ message: "Enter the number of days after joining." })
    .int("Use whole days.").min(0, "Use 0 or more days.").max(365, "Keep it within a year - 365 days at most."),
}).strict();

/** Sets when an employee's offer letter is generated: this many days after their date of joining. */
async function saveOfferLetterTiming(req, res) {
  const parsed = offerTimingSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0]?.message || "Check the number of days." });
  try {
    const data = { offerLetterAfterDays: parsed.data.generateAfterDays, updatedByUserId: req.user?.id || null };
    await prisma.hrmSettings.upsert({ where: { id: "default" }, update: data, create: { id: "default", ...data } });
    return res.json({ data: { generateAfterDays: await offerLetterAfterDays() } });
  } catch (error) {
    console.error("Unable to save when the offer letter is generated", error);
    return res.status(500).json({ message: "Unable to save when the offer letter is generated." });
  }
}

// A section is a paragraph (`content`) or points (`points`, one line each, bulleted or numbered).
const offerSectionSchema = z.object({
  title: z.string().trim().min(1, "Give every section a title.").max(120, "Keep a title to 120 characters."),
  format: z.enum(["PARAGRAPH", "POINTS", "NUMBERED"]).default("PARAGRAPH"),
  content: z.string().trim().max(3000, "Keep a section to 3,000 characters.").default(""),
  points: z.array(z.string().trim().max(500, "Keep a point to 500 characters.")).max(30, "Keep a section to 30 points.").default([]),
}).strict().superRefine((section, context) => {
  if (section.format !== "PARAGRAPH" && !section.points.some(Boolean)) context.addIssue({ code: "custom", message: "Write at least one point.", path: ["points"] });
  if (section.format === "PARAGRAPH" && !section.content) context.addIssue({ code: "custom", message: "Give every section its content.", path: ["content"] });
}).transform((section) => (section.format !== "PARAGRAPH"
  ? { title: section.title, format: section.format, points: section.points.filter(Boolean) }
  : { title: section.title, format: "PARAGRAPH", content: section.content }));

/*
 * The sections in their order: the studio's own, and `{ builtin: "EMPLOYMENT" | "COMPENSATION" }`
 * where those two were placed - each once. Read entry by entry, so a fault says what it is.
 */
const builtinSectionSchema = z.object({ builtin: z.enum(["EMPLOYMENT", "COMPENSATION"]) }).strict();
const sectionListSchema = (maxOwn) => z.array(z.unknown()).transform((entries, context) => {
  const out = [];
  const placed = new Set();
  for (const entry of entries) {
    const parsed = (entry && typeof entry === "object" && "builtin" in entry ? builtinSectionSchema : offerSectionSchema).safeParse(entry);
    if (!parsed.success) {
      context.addIssue({ code: "custom", message: parsed.error.issues[0]?.message || "Check the sections." });
      return z.NEVER;
    }
    if (parsed.data.builtin) {
      if (placed.has(parsed.data.builtin)) continue;
      placed.add(parsed.data.builtin);
    }
    out.push(parsed.data);
  }
  if (out.filter((entry) => !entry.builtin).length > maxOwn) {
    context.addIssue({ code: "custom", message: maxOwn === 15 ? "Keep the letter to 15 sections of your own." : "Too many sections to draw." });
    return z.NEVER;
  }
  return out;
});

const offerSectionsSchema = z.object({ sections: sectionListSchema(15) }).strict();

/** Settings → Offer Letter: its own sections, and which of Employment Details' and Compensation's lines print. */
async function getOfferLetterSections(req, res) {
  try {
    const [sections, employment, compensation] = await Promise.all([readOfferSections(), readOfferEmployment(), readOfferCompensation()]);
    return res.json({ data: { sections, employment, compensation } });
  } catch (error) {
    console.error("Unable to load the offer letter sections", error);
    return res.status(500).json({ message: "Unable to load the offer letter sections." });
  }
}

/** Replaces the offer letter's own sections with the list sent, in its order. */
async function saveOfferLetterSections(req, res) {
  const parsed = offerSectionsSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0]?.message || "Check the sections." });
  try {
    const data = { offerLetterSections: parsed.data.sections, updatedByUserId: req.user?.id || null };
    await prisma.hrmSettings.upsert({ where: { id: "default" }, update: data, create: { id: "default", ...data } });
    return res.json({ data: { sections: await readOfferSections() } });
  } catch (error) {
    console.error("Unable to save the offer letter sections", error);
    return res.status(500).json({ message: "Unable to save the offer letter sections." });
  }
}

const offerCompensationSchema = z.object({
  monthlyGross: z.boolean(),
  annualCtc: z.boolean(),
  paymentDate: z.boolean(),
  statutory: z.boolean(),
  statutorySummary: z.string().trim().max(1000, "Keep the summary to 1,000 characters.").default(""),
}).strict().refine((value) => !value.statutory || value.statutorySummary, { message: "Write the Deductions summary, or switch it off.", path: ["statutorySummary"] });

/** Sets which of Compensation's lines print, and the Deductions summary. */
async function saveOfferLetterCompensation(req, res) {
  const parsed = offerCompensationSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0]?.message || "Check the Compensation lines." });
  try {
    const data = { offerLetterCompensation: parsed.data, updatedByUserId: req.user?.id || null };
    await prisma.hrmSettings.upsert({ where: { id: "default" }, update: data, create: { id: "default", ...data } });
    return res.json({ data: { compensation: await readOfferCompensation() } });
  } catch (error) {
    console.error("Unable to save the offer letter compensation", error);
    return res.status(500).json({ message: "Unable to save the Compensation lines." });
  }
}

const offerEmploymentSchema = z.object(Object.fromEntries(EMPLOYMENT_LINES.map(([key]) => [key, z.boolean()]))).strict();

/** Sets which of Employment Details' lines print. */
async function saveOfferLetterEmployment(req, res) {
  const parsed = offerEmploymentSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ message: "Say for each Employment Details line whether it prints." });
  try {
    const data = { offerLetterEmployment: parsed.data, updatedByUserId: req.user?.id || null };
    await prisma.hrmSettings.upsert({ where: { id: "default" }, update: data, create: { id: "default", ...data } });
    return res.json({ data: { employment: await readOfferEmployment() } });
  } catch (error) {
    console.error("Unable to save the offer letter employment details", error);
    return res.status(500).json({ message: "Unable to save the Employment Details lines." });
  }
}

/**
 * Settings → Offer Letter → Sections → Import from .docx: the document read into sections for the
 * admin to review (`services/offerLetterImport`) - `{ sections, warnings }`. Nothing is saved here;
 * the review saves through `PUT /offer-letter/sections` as Add Section does.
 */
async function importOfferLetterSections(req, res) {
  try {
    return res.json({ data: await importOfferSections(req.file?.buffer, req.file?.originalname) });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ message: error.message });
    console.error("Unable to import the offer letter sections", error);
    return res.status(500).json({ message: "Unable to read that document." });
  }
}

// What a preview may draw: the sections being edited, checked as a save would be, a little roomier -
// an import added after sections already there may run past the save's limit while it is edited.
const offerSectionsPreviewSchema = z.object({ sections: sectionListSchema(40) }).strict();

/**
 * Settings → Offer Letter → Sections → Import: the letter drawn with the sections being edited in
 * place of the saved ones - `{ html }`. Nothing is saved.
 */
async function previewOfferLetterSections(req, res) {
  const parsed = offerSectionsPreviewSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0]?.message || "Check the sections." });
  try {
    return res.json({ data: { html: await draftOfferLetterHtml(parsed.data.sections) } });
  } catch (error) {
    console.error("Unable to preview the offer letter sections", error);
    return res.status(500).json({ message: "Unable to draw the letter." });
  }
}

module.exports = { previewOfferLetterSections, offerSectionsPreviewSchema, importOfferLetterSections, certificateSchema, offerEmploymentSchema, saveOfferLetterEmployment, offerCompensationSchema, saveOfferLetterCompensation, offerSectionsSchema, getOfferLetterSections, saveOfferLetterSections, SETTINGS_KINDS, saveOfferLetterTiming, offerTimingSchema, getOfferLetterTiming, requireAdministrator, getCertificate, saveCertificate, previewCertificate };
