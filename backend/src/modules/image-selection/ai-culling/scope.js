/**
 * A culling scope is null (the whole project) or the ids of one folder and everything nested
 * under it. Pure helpers over plain folder rows, shared by the service (overlap refusals) and
 * the repository (scoped queries), so "which photos does this run cover" is spelled once.
 */

/** One folder and its whole subtree as ids, or null when the folder is not in the list. */
function subtreeIds(folders, folderId) {
  if (!folders.some((folder) => folder.id === folderId)) return null;
  const ids = [folderId];
  const seen = new Set(ids);
  for (let index = 0; index < ids.length; index += 1) {
    for (const folder of folders) {
      if (folder.parentId === ids[index] && !seen.has(folder.id)) { seen.add(folder.id); ids.push(folder.id); }
    }
  }
  return ids;
}

/** Whether two scopes share a photo: the whole project touches everything, folders touch when their subtrees meet. */
function scopesOverlap(a, b) {
  if (a === null || b === null) return true;
  const set = new Set(a);
  return b.some((id) => set.has(id));
}

module.exports = { subtreeIds, scopesOverlap };
