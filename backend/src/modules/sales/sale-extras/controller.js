const { z } = require("zod");
const service = require("./service");

/**
 * `/api/sales/projects/:id/sale-extras` - Edit Sale Details' Extra section. The routes carry the
 * guards Edit Sale Details is saved under; these answer 404 for a project the reader cannot reach.
 */

// An emptied box - or one holding only spaces - is "not priced yet" (null), never 0, so a cleared line
// cannot be published unpriced. Only a number or a numeric string is an amount.
const typedAmount = z.union([
  z.number().finite(),
  z.string().trim().transform((value) => (value === "" ? null : Number(value))).pipe(z.number().finite().nullable()),
]);
const entrySchema = z.object({
  id: z.string().trim().min(1).max(191),
  amount: z.preprocess((value) => (value === null ? null : value), typedAmount.nullable()).optional(),
  remarks: z.string().trim().max(2000).nullable().optional(),
});
const publishSchema = z.object({
  draftIds: z.array(z.string().trim().min(1).max(191)).max(500).default([]),
  reviewed: z.record(z.string().max(191), z.string().max(40)).refine((value) => Object.keys(value).length <= 500, "Too many lines.").default({}),
  expectedRevision: z.coerce.number().int().min(0),
  // What was typed on screen: each unpublished line's amount and remarks, and each published line's edit.
  lines: z.array(entrySchema).max(500).default([]),
  published: z.array(entrySchema).max(500).default([]),
});

function handleError(res, error, fallback) {
  if (error.status) return res.status(error.status).json({ message: error.message });
  console.error(fallback, error);
  return res.status(500).json({ message: fallback });
}

async function list(req, res) {
  try {
    const state = await service.saleExtrasState(req.params.id, { userId: Number(req.user.id) });
    if (!state) return res.status(404).json({ message: "Project not found" });
    return res.json({ data: state });
  } catch (error) { return handleError(res, error, "Unable to load the extras."); }
}

async function publish(req, res) {
  const parsed = publishSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Validation failed", errors: parsed.error.flatten() });
  try {
    const revision = await service.publish(req.params.id, parsed.data, req.user);
    if (revision.remarksOnly) return res.json({ data: revision, message: "Remarks saved. Nothing new to publish, so the client's quotation is unchanged." });
    const total = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(revision.updatedTotal);
    return res.status(201).json({ data: revision, message: `Extras R${revision.revisionNumber} published: updated total ${total} before GST. The client's quotation link shows it now; nothing was sent to the client.` });
  } catch (error) { return handleError(res, error, "Unable to publish the updated quotation."); }
}

async function restore(req, res) {
  try {
    const restored = await service.restoreRemoved(req.params.id, req.params.extraId, { userId: Number(req.user.id) });
    if (!restored) return res.status(404).json({ message: "Project not found" });
    const how = restored.afterPublishedRemoval ? " as an addition, at the value it had - publish to show the client" : restored.source === "EXTRA" ? ", at the amount it was added at" : ", as quoted";
    return res.json({ data: restored, message: `${restored.itemName} is back on the shoot${how}.` });
  } catch (error) { return handleError(res, error, "Unable to add the item back."); }
}

async function remove(req, res) {
  try {
    const removed = await service.removeAdded(req.params.id, req.params.extraId, { userId: Number(req.user.id) });
    if (!removed) return res.status(404).json({ message: "Project not found" });
    return res.json({ data: removed, message: `${removed.itemName} is off the shoot${removed.neverPublished ? " - it was never published, so nothing is left to price" : "; it is under Removed, where it can be added back"}.` });
  } catch (error) { return handleError(res, error, "Unable to remove the item."); }
}

module.exports = { list, publish, restore, remove };
