const { z } = require("zod");
const { MIN_SELECTION_LIMIT, MAX_SELECTION_LIMIT } = require("./service");

const projectParamsSchema = z.object({ projectId: z.string().trim().min(1).max(191) });
/**
 * One row of the Selection Items table as it is saved.
 *
 * `selectionLimit` is how many photos the studio wants the client to pick — not the override to
 * store. Whether that number becomes an override or is left to follow the Post Production Allocation
 * is the service's decision, because only it knows what the allocation would give. `selectionLimitOverride`
 * is still read as the same answer so a client posting the older field name keeps working.
 */
const overrideItemSchema = z.preprocess(
  (value) => (value && typeof value === "object" && !Array.isArray(value) && value.selectionLimit === undefined && "selectionLimitOverride" in value
    ? { ...value, selectionLimit: value.selectionLimitOverride }
    : value),
  z.object({
    configId: z.string().trim().min(1).max(191),
    enabled: z.boolean(),
    selectionLimit: z.coerce.number().int().min(MIN_SELECTION_LIMIT).max(MAX_SELECTION_LIMIT).nullable(),
  }),
);
const saveOverridesSchema = z.object({ items: z.array(overrideItemSchema).min(1).max(1000) });
// A selection item the studio types itself: what the client is choosing photos for, how many of
// them, and the shoot group it belongs to.
const manualItemSchema = z.object({
  name: z.string().trim().min(1).max(191),
  selectionLimit: z.coerce.number().int().min(MIN_SELECTION_LIMIT).max(MAX_SELECTION_LIMIT),
  // The shoot the item is filed under: `shootFolderId`, the root folder that IS the shoot, by id -
  // or, from a screen that only knows a name, `shootName` ("Pre Wedding", "Wedding"), matched to a
  // root folder of that name (none is refused: an item belongs to a folder). Neither files the item
  // under no group, where older typed items already live.
  shootFolderId: z.string().trim().min(1).max(191).nullish(),
  shootName: z.string().trim().min(1).max(191).nullish(),
});
const configParamsSchema = projectParamsSchema.extend({ configId: z.string().trim().min(1).max(191) });
module.exports = { projectParamsSchema, saveOverridesSchema, manualItemSchema, configParamsSchema };
