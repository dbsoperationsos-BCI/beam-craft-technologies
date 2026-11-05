const { z } = require("zod");
const { eventParamsSchema } = require("../events/validation");

const phone = z.string().trim().max(30).regex(/^[+\d][\d\s()-]{5,29}$/, "Not a phone number.").nullable().optional();
const guestFields = z.object({
  name: z.string().trim().min(1).max(191),
  phone,
  email: z.string().trim().email().max(191).nullable().optional(),
  groupId: z.string().trim().min(1).max(191).nullable().optional(),
  rsvp: z.enum(["PENDING", "ACCEPTED", "DECLINED"]).optional(),
  notes: z.string().trim().max(4000).nullable().optional(),
});
const createGuestSchema = guestFields;
const updateGuestSchema = guestFields.partial().strict();
const importGuestsSchema = z.object({ guests: z.array(guestFields).min(1).max(5000), groupId: z.string().trim().min(1).max(191).nullable().optional() });
const guestParamsSchema = eventParamsSchema.extend({ guestId: z.string().trim().min(1).max(191) });
const listGuestsQuerySchema = z.object({ search: z.string().trim().max(191).optional().default(""), groupId: z.string().trim().max(191).optional(), rsvp: z.enum(["all", "PENDING", "ACCEPTED", "DECLINED"]).optional().default("all"), selfie: z.enum(["all", "NONE", "UPLOADED", "FAILED"]).optional().default("all"), page: z.coerce.number().int().min(1).optional().default(1), pageSize: z.coerce.number().int().min(1).max(200).optional().default(50) });

const groupSubEventIds = z.array(z.string().trim().min(1).max(191)).max(50);
const groupFields = z.object({ name: z.string().trim().min(1).max(120), subEventIds: groupSubEventIds.optional().default([]) });
// Built without the default: zod 4 still applies `.default([])` under `.partial()`, so a PATCH that
// leaves subEventIds out would otherwise wipe the group's restriction.
const updateGroupSchema = z.object({ name: z.string().trim().min(1).max(120), subEventIds: groupSubEventIds }).partial();
const groupParamsSchema = eventParamsSchema.extend({ groupId: z.string().trim().min(1).max(191) });

module.exports = { createGuestSchema, updateGuestSchema, importGuestsSchema, guestParamsSchema, listGuestsQuerySchema, groupFields, updateGroupSchema, groupParamsSchema };
