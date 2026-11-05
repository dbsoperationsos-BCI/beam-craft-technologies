const { z } = require("zod");
const service = require("./service");
const { reachFor } = require("../payroll-register/service");

const createSchema = z.object({
  section: z.enum(service.SECTIONS, { message: "Choose Personal details or PF details." }),
  label: z.string().trim().min(1, "Name the detail.").max(60, "Keep the name to 60 characters."),
  inputType: z.enum(service.INPUT_TYPES, { message: "Choose what is typed into it." }),
  // A Dropdown's choices; for no other input type.
  options: z.array(z.string().trim().max(60, "Keep each option to 60 characters.")).max(service.MAX_OPTIONS, `Up to ${service.MAX_OPTIONS} options.`).optional(),
}).strict()
  .refine((value) => value.inputType === "DROPDOWN" || value.options === undefined, { message: "Only a dropdown takes options.", path: ["options"] });
const updateSchema = z.object({
  label: z.string().trim().min(1, "Name the detail.").max(60, "Keep the name to 60 characters.").optional(),
  archived: z.boolean().optional(),
  shownOnPayslip: z.boolean().optional(),
}).strict();
const builtInSchema = z.object({
  label: z.string().trim().min(1).max(60),
  shown: z.boolean().optional(),
  deleted: z.boolean().optional(),
  // Edit Payslip's rename - what the payslip prints in its place.
  name: z.string().trim().min(1, "Name the item.").max(60, "Keep the name to 60 characters.").optional(),
}).strict()
  .refine((value) => value.shown !== undefined || value.deleted !== undefined || value.name !== undefined, "Nothing to change.");

const idOf = (req) => {
  const id = Number(req.params.id);
  return Number.isInteger(id) && id > 0 ? id : null;
};
const respond = (handler, fallback) => async (req, res) => {
  try {
    return await handler(req, res);
  } catch (error) {
    if (error?.status) return res.status(error.status).json({ message: error.message });
    console.error(`${fallback}:`, error.message);
    return res.status(500).json({ message: `${fallback}.` });
  }
};

/** Every detail added - `?active=true` for only those still asked for (Edit Employee). */
const listFields = respond(async (req, res) => res.json({ data: await service.listFields({ active: req.query.active === "true" }) }), "Unable to load the payslip's details");

const createField = respond(async (req, res) => {
  const parsed = createSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0]?.message });
  return res.status(201).json({ data: await service.createField(parsed.data, Number(req.user.id), await reachFor(req.user.id)) });
}, "Unable to add this detail");

const updateField = respond(async (req, res) => {
  const id = idOf(req);
  if (!id) return res.status(404).json({ message: "This detail could not be found." });
  const parsed = updateSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0]?.message });
  return res.json({ data: await service.updateField(id, parsed.data, await reachFor(req.user.id)) });
}, "Unable to change this detail");

const removeField = respond(async (req, res) => {
  const id = idOf(req);
  if (!id) return res.status(404).json({ message: "This detail could not be found." });
  return res.json({ data: await service.removeField(id, await reachFor(req.user.id)) });
}, "Unable to remove this detail");

/** The payslip's original items, each with whether it is on, or deleted. */
const listBuiltIns = respond(async (req, res) => res.json({ data: await service.builtInItems() }), "Unable to load the payslip's items");

const setBuiltIn = respond(async (req, res) => {
  const parsed = builtInSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0]?.message });
  return res.json({ data: await service.setBuiltInItem(parsed.data.label, parsed.data, await reachFor(req.user.id)) });
}, "Unable to change this item");

module.exports = { createSchema, listFields, createField, updateField, removeField, listBuiltIns, setBuiltIn };
