const { z } = require("zod");
const prisma = require("../../../config/db");
const { placeholdersIn } = require("../../../services/messageTemplate");
const switches = require("../../../services/messageTemplateSwitches");

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
  /*
   * Whether this message is sent at all. Optional, so a save that only changes the wording leaves the
   * switch where it was rather than turning it back on - two different answers, saved from the same
   * screen, and one must not carry the other.
   */
  enabled: z.boolean().optional(),
});

/** The switch on its own, for the toggle - which saves the moment it is pressed, with no wording. */
const enabledSchema = z.object({ enabled: z.boolean() });

const serialize = (row) => ({
  key: row.key,
  name: row.name,
  body: row.body,
  // What this wording actually uses, so the editor can show it back and a caller can see at a
  // glance whether a placeholder it does not fill has crept in.
  placeholders: placeholdersIn(row.body),
  // On unless the studio has switched it off. A message nobody has written yet reads as on, because
  // its sender has its own wording and goes on sending it - see `isMessageEnabled`.
  enabled: row.enabled !== false,
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
      update: {
        body: parsed.data.body,
        ...(parsed.data.enabled === undefined ? {} : { enabled: parsed.data.enabled }),
        updatedByUserId: Number(req.user?.id) || null,
      },
      create: { key, name: parsed.data.name || key, body: parsed.data.body, enabled: parsed.data.enabled ?? true, updatedByUserId: Number(req.user?.id) || null },
    });
    return res.json({ data: serialize(row) });
  } catch (error) {
    console.error("Unable to save message template:", error);
    return res.status(500).json({ message: "Unable to save that message template." });
  }
}

/**
 * **The switch alone**, for a toggle that saves the moment it is pressed.
 *
 * Its own endpoint rather than part of saving the wording: a studio switches a message off without
 * meaning to publish a half-edited body, and a toggle that first demanded a valid wording would
 * refuse to turn off exactly the messages nobody has written yet - which are the ones sending a
 * built-in default and therefore the ones somebody most wants stopped. So this takes no body, and a
 * message with no wording of its own can still be switched off.
 */
async function setTemplateEnabled(req, res) {
  const key = String(req.params.key || "").trim();
  if (!/^[A-Z][A-Z0-9_]{1,59}$/.test(key)) return res.status(400).json({ message: "That is not a message template key." });
  const parsed = enabledSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ message: "Say whether the message is on or off." });
  try {
    const row = await prisma.messageTemplate.upsert({
      where: { key },
      update: { enabled: parsed.data.enabled, updatedByUserId: Number(req.user?.id) || null },
      // Switched off before anybody wrote it: the row exists to hold the switch, and the sender's own
      // wording is what it was going to send.
      create: { key, name: key, body: "", enabled: parsed.data.enabled, updatedByUserId: Number(req.user?.id) || null },
    });
    /*
     * Switching a message off answers the sends of it that are still waiting: a failed one is on
     * somebody's screen asking to be retried, and the studio has just said it does not want the
     * message at all. They are closed rather than left to reappear if the switch is ever turned
     * back on (`production/messages.closeOpenMessages`). Required lazily - this is the only thing
     * Settings asks of the production module.
     */
    if (!parsed.data.enabled) await require("../../project-management/production/messages").closeOpenMessages(key);
    return res.json({ data: serialize(row) });
  } catch (error) {
    console.error("Unable to switch message template:", error);
    return res.status(500).json({ message: "Unable to switch that message on or off." });
  }
}

/**
 * The verticals New Lead Welcome can be worded for, each with the keys of its two templates - office
 * time and after hours (`newLeadWelcome.verticalTemplateKey`) - and whether each is written, so the
 * editor can say where a lead would get New Lead Welcome instead. With the attendance shift, which is
 * what office time means. The working verticals only; a lead in a retired one is still sent its
 * vertical's wording where one was written.
 */
const VERTICAL_ORDER = ["DUM_DUM", "QUA_QUA", "CORP"];
const verticalRank = (code) => (VERTICAL_ORDER.includes(code) ? VERTICAL_ORDER.indexOf(code) : VERTICAL_ORDER.length);

async function listLeadWelcomeVerticals(req, res) {
  try {
    const { SLOTS, UNWORDED_VERTICAL_CODES, verticalTemplateKey } = require("../automatic-whatsapp/newLeadWelcome");
    const [rows, settings] = await Promise.all([
      // General and Team 33 are not worded on their own (`UNWORDED_VERTICAL_CODES`).
      prisma.vertical.findMany({ where: { isActive: true, code: { notIn: UNWORDED_VERTICAL_CODES } }, orderBy: { name: "asc" }, select: { id: true, name: true, code: true } }),
      require("../../hrm/attendance/service").readSettings(),
    ]);
    // The studio's own order - Dum Dum, Qua Qua, Corp - by code, as every database has them; any other
    // vertical after them, by name.
    rows.sort((a, b) => verticalRank(a.code) - verticalRank(b.code));
    const keyed = rows.map((row) => ({ row, officeKey: verticalTemplateKey(row.id, SLOTS.OFFICE), afterHoursKey: verticalTemplateKey(row.id, SLOTS.AFTER_HOURS) }));
    const written = new Set((await prisma.messageTemplate.findMany({
      where: { key: { in: keyed.flatMap((entry) => [entry.officeKey, entry.afterHoursKey]) } },
      select: { key: true, body: true },
    })).filter((template) => template.body?.trim()).map((template) => template.key));
    return res.json({ data: {
      shift: { start: settings?.shiftStart || null, end: settings?.shiftEnd || null },
      verticals: keyed.map(({ row, officeKey, afterHoursKey }) => ({
        id: row.id,
        name: row.name,
        officeKey,
        afterHoursKey,
        officeWritten: written.has(officeKey),
        afterHoursWritten: written.has(afterHoursKey),
      })),
    } });
  } catch (error) {
    console.error("Unable to load the verticals for New Lead Welcome:", error);
    return res.status(500).json({ message: "Unable to load the verticals." });
  }
}

/** Every message's ON / OFF: `{ KEY: true|false }` - a message nobody has switched is ON. */
async function listSwitches(req, res) {
  try {
    return res.json({ data: await switches.listSwitches() });
  } catch (error) {
    console.error("Unable to load the message switches:", error);
    return res.status(500).json({ message: "Unable to load which messages are switched on." });
  }
}

/** Switches one message ON or OFF; answers every switch as it now stands. */
async function setSwitch(req, res) {
  try {
    return res.json({ data: await switches.setEnabled(String(req.params.key || "").trim(), req.body?.enabled, req.user?.id) });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ message: error.message });
    console.error("Unable to switch the message:", error);
    return res.status(500).json({ message: "Unable to switch that message." });
  }
}

/*
 * **Two switch stores live here for now**, and that is deliberate rather than overlooked.
 *
 * `setTemplateEnabled` is this branch's switch - a column on the template row. `listSwitches` /
 * `setSwitch` are develop's - a row per message in `message_template_switch`, which develop's own
 * route guards and its Wishes panel already read. The branch keeps its own for the Templates panel
 * and keeps develop's answering, so neither screen breaks; the two are reconciled in a change of
 * their own, not inside a merge.
 */
module.exports = {
  setTemplateEnabled, listTemplates, getTemplate, saveTemplate, listLeadWelcomeVerticals, listSwitches, setSwitch };
