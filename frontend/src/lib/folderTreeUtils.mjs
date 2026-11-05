export function collectFolderIds(folders, ids = new Set()) {
  for (const folder of folders || []) {
    ids.add(folder.id);
    collectFolderIds(folder.children, ids);
  }
  return ids;
}

export function toggleExpandedFolder(expandedIds, folderId) {
  const next = new Set(expandedIds);
  if (next.has(folderId)) next.delete(folderId);
  else next.add(folderId);
  return next;
}
