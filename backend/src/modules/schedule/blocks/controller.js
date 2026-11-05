const { z } = require("zod");
const service = require("./service");

/* Calendar → Block Period's requests: each checked here, then answered by `service`. */

// A real day: 2026-02-31 is refused, not rolled on to 3 March.
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date.")
  .refine((value) => { const day = new Date(`${value}T00:00:00Z`); return !Number.isNaN(day.getTime()) && day.toISOString().slice(0, 10) === value; }, "Choose a date.");
// A time of day as the time field gives it, "09:30".
const clock = (what) => z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, `Choose the ${what} time.`);

const createSchema = z.object({
  branchId: z.number({ message: "Choose the branch." }).int().positive("Choose the branch."),
  date: isoDate,
  startTime: clock("from"),
  endTime: clock("to"),
  reason: z.string().trim().min(1, "Say why the period is blocked.").max(300, "Keep the reason to 300 characters."),
}).strict().refine((value) => value.endTime > value.startTime, { message: "The block must end after it starts.", path: ["endTime"] });
const idSchema = z.coerce.number().int().positive();

const userIdOf = (req) => Number(req.user?.id) || null;
const respond = (handler, fallback) => async (req, res) => {
  try {
    return await handler(req, res);
  } catch (error) {
    if (error.status) return res.status(error.status).json({ message: error.message });
    console.error(`${fallback}:`, error.message);
    return res.status(500).json({ message: `${fallback}.` });
  }
};

const branches = respond(async (req, res) => {
  res.json({ data: await service.branchesFor(userIdOf(req)) });
}, "Unable to load the branches");

const create = respond(async (req, res) => {
  const parsed = createSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0]?.message || "Check the details." });
  const block = await service.createBlock({ userId: userIdOf(req), ...parsed.data });
  return res.status(201).json({ data: block });
}, "Unable to block the period");

const remove = respond(async (req, res) => {
  const parsed = idSchema.safeParse(req.params.id);
  if (!parsed.success) return res.status(400).json({ message: "That block is not one this calendar knows." });
  return res.json({ data: await service.removeBlock({ userId: userIdOf(req), id: parsed.data }) });
}, "Unable to remove the block");

module.exports = { branches, create, remove };
