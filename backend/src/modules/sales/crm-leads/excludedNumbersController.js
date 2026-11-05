const { z } = require("zod");
const {
  MAX_EXCLUDED, ExcludedNumberError,
  listExcludedNumbers, countExcludedNumbers, addExcludedNumber, updateExcludedNumber,
  removeExcludedNumbers, importExcludedNumbers,
} = require("./excludedNumbersService");

/**
 * Settings -> Exclude Phone Numbers.
 *
 * The list of numbers that must never become a lead: staff, their families, suppliers, the office
 * landline. The Callyzer webhook reads it on every delivery and sets those calls aside before a
 * lead is built.
 *
 * Deliberately its own controller rather than more handlers on the CRM leads one, which is already
 * long: this is a settings list with its own table and its own rules, and it shares nothing with a
 * lead but the number format.
 */

const entrySchema = z.object({
  name: z.string().trim().max(191).optional().default(""),
  number: z.string().trim().min(1, "Enter a phone number.").max(50),
});
const importSchema = z.object({
  // Capped at the ceiling itself: a paste of fifty thousand lines is a mistake, not an import.
  entries: z.array(entrySchema).min(1, "There is nothing to import.").max(MAX_EXCLUDED),
});
const removeSchema = z.object({ ids: z.array(z.string().trim().min(1)).min(1, "Select at least one number to remove.") });

// The service raises its own errors with a status and a message a person can act on; anything else
// is this server's fault and says so without leaking what went wrong internally.
function sendError(res, error, fallback) {
  if (error instanceof ExcludedNumberError) return res.status(error.status).json({ message: error.message });
  console.error(fallback, error?.message || error);
  return res.status(500).json({ message: fallback });
}

function firstMessage(parsed, fallback) {
  return parsed.error.issues[0]?.message || fallback;
}

async function list(_req, res) {
  try {
    const numbers = await listExcludedNumbers();
    // The cap travels with the list so the screen can say "12 of 1,500" without knowing the number
    // itself - one definition of the ceiling, on the server.
    return res.json({ data: { numbers, total: numbers.length, max: MAX_EXCLUDED } });
  } catch (error) {
    return sendError(res, error, "Unable to load the excluded phone numbers.");
  }
}

async function create(req, res) {
  const parsed = entrySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: firstMessage(parsed, "Enter a phone number.") });
  try {
    const created = await addExcludedNumber({ ...parsed.data, createdBy: req.user?.id ?? null });
    return res.status(201).json({ message: "Number excluded.", data: created });
  } catch (error) {
    return sendError(res, error, "Unable to exclude that phone number.");
  }
}

async function update(req, res) {
  const parsed = entrySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: firstMessage(parsed, "Enter a phone number.") });
  try {
    return res.json({ message: "Number updated.", data: await updateExcludedNumber(req.params.id, parsed.data) });
  } catch (error) {
    return sendError(res, error, "Unable to update that excluded number.");
  }
}

async function remove(req, res) {
  try {
    const removed = await removeExcludedNumbers([req.params.id]);
    if (!removed) return res.status(404).json({ message: "That excluded number no longer exists." });
    return res.json({ message: "Number removed from the exclude list." });
  } catch (error) {
    return sendError(res, error, "Unable to remove that excluded number.");
  }
}

async function removeBulk(req, res) {
  const parsed = removeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: firstMessage(parsed, "Select at least one number to remove.") });
  try {
    const removed = await removeExcludedNumbers(parsed.data.ids);
    return res.json({ message: `${removed.toLocaleString()} number${removed === 1 ? "" : "s"} removed from the exclude list.`, data: { removed } });
  } catch (error) {
    return sendError(res, error, "Unable to remove the selected numbers.");
  }
}

/**
 * A pasted or uploaded list.
 *
 * Answers 200 with a breakdown even when some rows failed: an import of two hundred numbers with
 * one typo in it added a hundred and ninety-nine, and reporting that as an error would have the
 * person believe none of them were saved.
 */
async function importNumbers(req, res) {
  const parsed = importSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: firstMessage(parsed, "There is nothing to import.") });
  try {
    const result = await importExcludedNumbers(parsed.data.entries, { createdBy: req.user?.id ?? null });
    const parts = [`${result.added.toLocaleString()} number${result.added === 1 ? "" : "s"} excluded`];
    if (result.skipped) parts.push(`${result.skipped.toLocaleString()} already on the list`);
    if (result.failed.length) parts.push(`${result.failed.length.toLocaleString()} could not be read`);
    return res.json({ message: `${parts.join(", ")}.`, data: { ...result, total: await countExcludedNumbers(), max: MAX_EXCLUDED } });
  } catch (error) {
    return sendError(res, error, "Unable to import those phone numbers.");
  }
}

module.exports = { list, create, update, remove, removeBulk, importNumbers };
