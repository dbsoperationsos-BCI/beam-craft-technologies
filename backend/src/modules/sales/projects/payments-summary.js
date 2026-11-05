const { z } = require("zod");
const prisma = require("../../../config/db");
const { projectAccessWhere } = require("../../../services/projectScope");
const { projectMoneySummary } = require("../../../services/projectMoney");

/*
 * `GET /api/sales/projects/payments-summary?ids=a,b,c` - received, spent and still to receive for
 * the projects a Board is showing, so its columns can total them (Projects, Bookings, Pre
 * Production, Production, Post Production). Money, so it sits behind the same guards as one
 * project's Payments tab (see routes.js), and only projects the reader can reach answer: an id
 * outside their reach is left out, never reported.
 */
// 200 ids is about 5 KB of query string - inside nginx's 8 KB header buffers on the VPS, where 500
// (about 13 KB) would be refused before it reached the app. The Boards ask in chunks of this size.
const MAX_IDS = 200;
const idsSchema = z.string().trim().min(1).max(MAX_IDS * 64)
  .transform((value) => [...new Set(value.split(",").map((id) => id.trim()).filter(Boolean))])
  .refine((ids) => ids.length <= MAX_IDS, `Ask for at most ${MAX_IDS} projects at once.`)
  .refine((ids) => ids.every((id) => /^[A-Za-z0-9_-]{1,64}$/.test(id)), "Those are not project ids.");

async function projectsPaymentsSummary(req, res) {
  const parsed = idsSchema.safeParse(typeof req.query.ids === "string" ? req.query.ids : "");
  if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0]?.message || "Name the projects to total." });
  try {
    const reachable = await prisma.salesProject.findMany({
      where: { id: { in: parsed.data }, deletedAt: null, AND: [await projectAccessWhere({ userId: Number(req.user.id) })] },
      select: { id: true },
    });
    return res.json({ data: await projectMoneySummary(reachable.map((project) => project.id)) });
  } catch (error) {
    console.error("Unable to total the projects' payments:", error.message);
    return res.status(500).json({ message: "Unable to total the projects' payments." });
  }
}

module.exports = { projectsPaymentsSummary, MAX_IDS };
