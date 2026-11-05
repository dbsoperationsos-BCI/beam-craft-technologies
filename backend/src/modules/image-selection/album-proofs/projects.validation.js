const { z } = require("zod");
const { normalizePhoneNumber } = require("../../../services/phoneNumber");

/**
 * What the Album Proofing sidebar's own project forms may send.
 *
 * Album Proofing projects are created, listed and edited here, under this module's permission,
 * rather than through Image Selection's project routes. The shapes are deliberately narrower than
 * Image Selection's: an album project has no workspace tabs, no gallery settings and no selection
 * expiry, so none of that is accepted.
 */

const id = z.string().trim().min(1).max(191);
const projectIdSchema = z.object({ projectId: id });

// Stored exactly as SalesProject.clientMainNumber stores it — "+91 9876543210" — so a manual
// project's number reaches the proof-link sender looking like a linked one. Absent stays undefined
// so Prisma leaves the saved value alone; an empty string clears it; a malformed one is refused.
const clientMainNumberSchema = z
  .string()
  .trim()
  .max(30)
  .nullish()
  .superRefine((value, ctx) => {
    if (value == null || value === "") return;
    if (!normalizePhoneNumber(value))
      ctx.addIssue({ code: "custom", message: "Client Main Number must include a country code and exactly 10 digits." });
  })
  .transform((value) => (value == null ? value : value === "" ? null : normalizePhoneNumber(value)));
const clientNameSchema = z.string().trim().max(191).nullish().transform((value) => (value == null ? value : value || null));

// A manually named project records its own client, because there is no Sales Manager project to
// read one from — and the proof link has to be sent to somebody, so both are required. A project
// from a saved group name sends neither; the service refuses a second copy that could drift.
const createProjectSchema = z
  .object({
    projectName: z.string().trim().min(1).max(500),
    salesProjectId: id.nullable().optional(),
    clientName: clientNameSchema,
    clientMainNumber: clientMainNumberSchema,
  })
  .superRefine((value, ctx) => {
    if (value.salesProjectId) return;
    if (!value.clientName) ctx.addIssue({ code: "custom", path: ["clientName"], message: "A manually named project needs the client's name." });
    if (!value.clientMainNumber) ctx.addIssue({ code: "custom", path: ["clientMainNumber"], message: "A manually named project needs the client's WhatsApp number." });
  });

// Editing re-opens the manual creation form, so it carries the name always and the client details
// when the form sends them. What is sent must still be whole: a manual project cannot lose its
// client. Anything else the shared form happens to send is ignored.
const editProjectSchema = z
  .object({
    projectName: z.string().trim().min(1).max(500),
    clientName: clientNameSchema,
    clientMainNumber: clientMainNumberSchema,
  })
  .superRefine((value, ctx) => {
    if (value.clientName === null) ctx.addIssue({ code: "custom", path: ["clientName"], message: "A manually named project needs the client's name." });
    if (value.clientMainNumber === null) ctx.addIssue({ code: "custom", path: ["clientMainNumber"], message: "A manually named project needs the client's WhatsApp number." });
  });

const listProjectsSchema = z.object({
  search: z.string().trim().max(500).optional().default(""),
  sort: z.enum(["name", "dateLastOpened", "dateAdded", "dateModified", "dateCreated", "size"]).optional().default("dateAdded"),
  order: z.enum(["asc", "desc"]).optional().default("desc"),
  archived: z.enum(["true", "false"]).optional().default("false"),
});

module.exports = { projectIdSchema, createProjectSchema, editProjectSchema, listProjectsSchema };
