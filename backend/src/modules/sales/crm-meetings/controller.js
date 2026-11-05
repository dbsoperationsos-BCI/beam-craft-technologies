const { z } = require("zod");
const { listAllMeetings, searchLeads } = require("./service");

// Both bounds are optional: no window at all means every meeting ever booked, which is what
// the Meetings page asks for when it first opens.
const listSchema = z.object({
  from: z.string().trim().optional().default(""),
  to: z.string().trim().optional().default(""),
  includeCancelled: z.string().trim().optional().default(""),
});

function sendError(res, error, fallback) {
  console.error(fallback, error.message);
  return res.status(error.status || 500).json({ message: error.status ? error.message : fallback });
}

function parseDate(value) {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

async function list(req, res) {
  const parsed = listSchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ message: "Invalid meeting window." });
  try {
    const data = await listAllMeetings({
      from: parseDate(parsed.data.from),
      to: parseDate(parsed.data.to),
      includeCancelled: parsed.data.includeCancelled !== "false",
      reader: { userId: Number(req.user.id), permissions: req.permission },
    });
    return res.json({ data });
  } catch (error) {
    return sendError(res, error, "Unable to load meetings.");
  }
}

const leadSearchSchema = z.object({
  q: z.string().trim().max(120).optional().default(""),
  limit: z.coerce.number().int().min(1).max(50).optional().default(20),
});

async function leads(req, res) {
  const parsed = leadSearchSchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ message: "Invalid lead search." });
  try {
    return res.json({ data: await searchLeads({ query: parsed.data.q, limit: parsed.data.limit }) });
  } catch (error) {
    return sendError(res, error, "Unable to search leads.");
  }
}

module.exports = { leads, list };
