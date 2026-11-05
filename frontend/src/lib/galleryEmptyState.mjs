/**
 * What the client gallery says when a shoot has no photo cards to show.
 *
 * It used to say "Select a Selection Setting to view its gallery folders." whatever the reason,
 * even with the selection item already chosen - so a client looking at "Post Wedding" with nothing
 * in it was told to do something they had already done. The reason is one of four, and each gets its
 * own words, in the client's terms rather than the studio's:
 *
 *   - no selection item chosen yet (or none shared): choose one;
 *   - the item's shoot has no folder in the gallery yet: its photos are not ready;
 *   - the shoot's folders hold photos the gallery does not show yet - still uploading or processing,
 *     or waiting on a studio step (`preparing`, counted per folder by the server): being prepared;
 *   - nothing at all filed for the shoot: not added yet.
 *
 * `folders` is the gallery's own list (`folderId`, `parentId`, `preparing`); `groupFolderId` is the
 * shoot folder in view; `item` the selection item on screen.
 */
export function galleryEmptyMessage({ item = null, groupFolderId = null, folders = [], hasItems = true } = {}) {
  if (!hasItems) return "No photos have been shared with you yet. The studio will let you know when they are ready.";
  if (!item) return "Choose a selection item to see its photos.";
  const group = groupFolderId ? folders.find((folder) => folder.folderId === groupFolderId) : null;
  const shoot = String(group?.name || item.shoot?.shoot || "").trim();
  const forShoot = shoot ? ` for ${shoot}` : "";
  if (!group) return `The photos${forShoot} are not ready yet. The studio will add them soon.`;
  const preparing = folders
    .filter((folder) => folder.folderId === groupFolderId || folder.parentId === groupFolderId)
    .reduce((sum, folder) => sum + (Number(folder.preparing) || 0), 0);
  if (preparing > 0) return `Your photos${forShoot} are being prepared. They will appear here shortly.`;
  return `No photos have been added${forShoot} yet. The studio will share them here.`;
}
