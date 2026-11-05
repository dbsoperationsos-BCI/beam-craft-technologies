/**
 * How shoot names are matched across Image Selection: case, spacing and punctuation ignored, so
 * "Pre Wedding", "pre-wedding" and "PreWedding" are one shoot. One definition on purpose — the
 * Selection Items table and the Shoots & Selection Items status section sit in the same rail and
 * must agree about which folder names collapse into which saved shoots.
 */
export const normalizedShootName = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * The root folders that no saved shoot group answers to yet, deduped by normalized name — each
 * one stands as its own (empty) group beside the saved ones.
 */
export function unmatchedFolderShoots(savedNames, folderShoots) {
  const savedKeys = new Set(savedNames.map((name) => normalizedShootName(name)));
  return [...new Map(
    folderShoots.map((name) => [normalizedShootName(name), name]).filter(([key]) => key && !savedKeys.has(key)),
  ).values()];
}
