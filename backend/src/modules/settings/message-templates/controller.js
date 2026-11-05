const { z } = require("zod");
const prisma = require("../../../config/db");
const { placeholdersIn } = require("../../../services/messageTemplate");

/**
 * The messages the studio sends, as Settings edits them.
 *
 * Validation and status codes only; what a placeholder means and how one is filled in belongs to
 * `services/messageTemplate.js`, which the modules holding the records read.
 */

const bodySchema = z.object({
  // Long enough for a letter and capped so a paste of something else is refused rather than stored.
  body: z.string().trim().min(1).max(5000),
  name: z.string().trim().min(1).max(120).optional(),
});

const serialize = (row) => ({
  key: row.key,
  name: row.name,
  body: row.body,
  // What this wording actually uses, so the editor can show it back and a caller can see at a
  // glance whether a placeholder it does not fill has crept in.
  placeholders: placeholdersIn(row.body),
  updatedAt: row.updatedAt,
});

/** Every message the studio has, for the Settings rail. */
async function listTemplates(req, res) {
  try {
    const rows = await prisma.messageTemplate.findMany({ orderBy: { name: "asc" } });
    return res.json({ data: rows.map(serialize) });
  } catch (error) {
    console.error("Unable to load message templates:", error);
    return res.status(500).json({ message: "Unable to load message templates." });
  }
}

async function getTemplate(req, res) {
  try {
    const row = await prisma.messageTemplate.findUnique({ where: { key: String(req.params.key || "").trim() } });
    if (!row) return res.status(404).json({ message: "That message template could not be found." });
    return res.json({ data: serialize(row) });
  } catch (error) {
    console.error("Unable to load message template:", error);
    return res.status(500).json({ message: "Unable to load that message template." });
  }
}

/**
 * Writes one template's wording, creating it if the studio has not written that message yet.
 *
 * An upsert rather than separate create and edit routes: a key either has a wording or does not, and
 * the Settings screen is the same screen either way. `name` is only taken on the way in - it is what
 * the rail calls it, and renaming an existing message is not what saving a body means.
 */
async function saveTemplate(req, res) {
  const key = String(req.params.key || "").trim();
  if (!/^[A-Z][A-Z0-9_]{1,59}$/.test(key)) return res.status(400).json({ message: "That is not a message template key." });
  const parsed = bodySchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ message: "A message needs some wording.", errors: parsed.error.flatten() });
  try {
    const row = await prisma.messageTemplate.upsert({
      where: { key },
      update: { body: parsed.data.body, updatedByUserId: Number(req.user?.id) || null },
      create: { key, name: parsed.data.name || key, body: parsed.data.body, updatedByUserId: Number(req.user?.id) || null },
    });
    return res.json({ data: serialize(row) });
  } catch (error) {
    console.error("Unable to save message template:", error);
    return res.status(500).json({ message: "Unable to save that message template." });
  }
}

module.exports = { listTemplates, getTemplate, saveTemplate };
