const { z } = require("zod");
const { ATTENTION_KINDS } = require("../dashboard/classify");
const { normalizePhoneNumber } = require("../../../services/phoneNumber");

const projectIdSchema = z.object({ projectId: z.string().trim().min(1).max(191) });

// Stored in exactly the shape SalesProject.clientMainNumber uses — "+91 9876543210" — so a
// manual project's number reaches the WhatsApp sender looking like a linked one.
const normalizeClientMainNumber = (value) => normalizePhoneNumber(value);
// Absent stays undefined so Prisma leaves the saved value alone; an empty string clears it.
// A malformed number is rejected rather than normalized to null, which would silently wipe a
// number the studio meant to correct.
const clientMainNumberSchema = z
  .string()
  .trim()
  .max(30)
  .nullish()
  .superRefine((value, ctx) => {
    if (value == null || value === "") return;
    if (!normalizeClientMainNumber(value))
      ctx.addIssue({ code: "custom", message: "Client Main Number must include a country code and exactly 10 digits." });
  })
  .transform((value) => (value == null ? value : value === "" ? null : normalizeClientMainNumber(value)));
const clientNameSchema = z.string().trim().max(191).nullish().transform((value) => (value == null ? value : value || null));
const workspaceTabsSchema = z
  .object({
    photoSelection: z.boolean(),
    photoCulling: z.boolean(),
    signatureAlbum: z.boolean(),
  })
  .nullish();

// Editing re-opens the manual creation form, so it carries everything that form holds: the name
// always, and — when the form sends them — the client details and the workspace-tab choice.
// Absent fields leave the stored values alone, so a rename on its own keeps working. What is
// sent must still be whole: a manual project cannot lose its client or every tab.
const editProjectSchema = z
  .object({
    projectName: z.string().trim().min(1).max(500),
    clientName: clientNameSchema,
    clientMainNumber: clientMainNumberSchema,
    workspaceTabs: workspaceTabsSchema,
  })
  .superRefine((value, ctx) => {
    if (value.clientName === null) ctx.addIssue({ code: "custom", path: ["clientName"], message: "A manually named project needs the client's name." });
    if (value.clientMainNumber === null) ctx.addIssue({ code: "custom", path: ["clientMainNumber"], message: "A manually named project needs the client's WhatsApp number." });
    if (value.workspaceTabs && !value.workspaceTabs.photoSelection && !value.workspaceTabs.photoCulling && !value.workspaceTabs.signatureAlbum)
      ctx.addIssue({ code: "custom", path: ["workspaceTabs"], message: "Choose at least one workspace tab." });
  });

// A manually named project is where the studio records its own client, because there is no Sales
// Manager project to read one from. Creating it is also the only place that asks, so both answers
// are required rather than optional: a manual project without a number is one whose gallery can
// never be shared. A project created from a saved group name must send neither — the service
// refuses client details alongside a `salesProjectId` rather than keeping a second copy that
// could drift from the Sales Manager record.
const createProjectSchema = z
  .object({
    projectName: z.string().trim().min(1).max(500),
    salesProjectId: z.string().trim().min(1).max(191).nullable().optional(),
    clientName: clientNameSchema,
    clientMainNumber: clientMainNumberSchema,
    // Which workspace tabs a manual project starts with. Absent keeps the default a manual
    // project always had — Photo Selection alone. A linked project must not send this at all:
    // its tabs are earned from the allocation and the Deliverables table.
    workspaceTabs: workspaceTabsSchema,
  })
  .superRefine((value, ctx) => {
    if (value.salesProjectId) return;
    if (!value.clientName) ctx.addIssue({ code: "custom", path: ["clientName"], message: "A manually named project needs the client's name." });
    if (!value.clientMainNumber) ctx.addIssue({ code: "custom", path: ["clientMainNumber"], message: "A manually named project needs the client's WhatsApp number." });
    if (value.workspaceTabs && !value.workspaceTabs.photoSelection && !value.workspaceTabs.photoCulling && !value.workspaceTabs.signatureAlbum)
      ctx.addIssue({ code: "custom", path: ["workspaceTabs"], message: "Choose at least one workspace tab." });
  });
// The day the client's link stops working, as the calendar field sends it — "2026-08-15". Absent
// leaves the stored date alone, because publish-share saves pending settings without it; an empty
// string clears it, which hands the gallery back to the studio-wide validity window.
const selectionValidUntilSchema = z
  .string()
  .trim()
  .nullish()
  .superRefine((value, ctx) => {
    if (value == null || value === "") return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`)))
      ctx.addIssue({ code: "custom", message: "Enter the expiry date as YYYY-MM-DD." });
  })
  // Stored as the last instant of the chosen day, so a gallery is usable for the whole of the day
  // the studio picked rather than expiring at midnight as it begins.
  .transform((value) => (value == null ? value : value === "" ? null : new Date(`${value}T23:59:59.999Z`)));

const settingsSchema = z.object({
  selectionValidityEnabled: z.boolean(),
  allowPhotoSelection: z.boolean(),
  selectionValidUntil: selectionValidUntilSchema,
  clientName: clientNameSchema,
  clientMainNumber: clientMainNumberSchema,
});
const listProjectsSchema = z.object({
  search: z.string().trim().max(500).optional().default(""),
  sort: z.enum(["name", "dateLastOpened", "dateAdded", "dateModified", "dateCreated", "size"]).optional().default("dateAdded"),
  order: z.enum(["asc", "desc"]).optional().default("desc"),
  archived: z.enum(["true", "false"]).optional().default("false"),
  // One of the dashboard's views - a Needs Attention row or a summary card; the list is narrowed
  // to the projects on it. The names come from the classifier so the two can never disagree.
  attention: z.enum(ATTENTION_KINDS).optional(),
});

module.exports = { projectIdSchema, createProjectSchema, editProjectSchema, settingsSchema, listProjectsSchema, normalizeClientMainNumber };
