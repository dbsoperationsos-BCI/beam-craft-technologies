const { z } = require("zod");
const { eventSettingsBodySchema } = require("../default-settings/validation");

const eventParamsSchema = z.object({ eventId: z.string().trim().min(1).max(191) });

const isoDate = z.string().trim().refine((value) => !Number.isNaN(Date.parse(value)), { message: "Not a date." });
const timeOfDay = z.string().regex(/^\d{2}:\d{2}$/).nullable().optional();

const subEventSchema = z.object({
  id: z.string().trim().min(1).max(191).optional(),
  name: z.string().trim().min(1).max(191),
  date: isoDate.nullable().optional(),
  startTime: timeOfDay,
  endTime: timeOfDay,
  location: z.string().trim().max(255).nullable().optional(),
  description: z.string().trim().max(4000).nullable().optional(),
});

const eventFieldsSchema = z.object({
  name: z.string().trim().min(1).max(191),
  eventType: z.string().trim().min(1).max(60),
  startDate: isoDate,
  endDate: isoDate.nullable().optional(),
  timezone: z.string().trim().min(1).max(64).optional(),
  location: z.string().trim().max(255).nullable().optional(),
  description: z.string().trim().max(4000).nullable().optional(),
  branch: z.string().trim().max(191).nullable().optional(),
  branchId: z.number().int().positive().nullable().optional(),
  /// A data URI, an https URL already ours, or null to remove.
  coverImage: z.string().max(12 * 1024 * 1024).nullable().optional(),
});

const createEventSchema = eventFieldsSchema.extend({
  subEvents: z.array(subEventSchema).max(50).optional().default([]),
  settings: eventSettingsBodySchema.optional().default({}),
}).refine((value) => !value.endDate || Date.parse(value.endDate) >= Date.parse(value.startDate), { message: "The end date is before the start date.", path: ["endDate"] });

const updateEventSchema = eventFieldsSchema.partial().extend({ status: z.enum(["UPCOMING", "ACTIVE", "COMPLETED"]).optional() }).strict();

const listEventsQuerySchema = z.object({
  search: z.string().trim().max(191).optional().default(""),
  status: z.enum(["all", "active", "upcoming", "completed", "archived"]).optional().default("all"),
  sort: z.enum(["newest", "oldest", "eventDate", "name"]).optional().default("newest"),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(50),
});

const duplicateEventSchema = z.object({ name: z.string().trim().min(1).max(191).optional() });
const subEventsBodySchema = z.object({ subEvents: z.array(subEventSchema).max(50) });
const subEventParamsSchema = eventParamsSchema.extend({ subEventId: z.string().trim().min(1).max(191) });
const reorderSchema = z.object({ order: z.array(z.string().trim().min(1).max(191)).max(50) });

module.exports = { eventParamsSchema, createEventSchema, updateEventSchema, listEventsQuerySchema, duplicateEventSchema, subEventSchema, subEventsBodySchema, subEventParamsSchema, reorderSchema, eventSettingsBodySchema };
