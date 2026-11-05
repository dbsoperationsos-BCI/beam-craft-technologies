/**
 * How shoot names are matched across Image Selection: case, spacing and punctuation ignored, so
 * "Pre Wedding", "pre-wedding" and "PreWedding" are one shoot. One definition on purpose — the
 * Selection Items table and the Shoots & Selection Items status section sit in the same rail and
 * must agree about which folder names collapse into which saved shoots.
 */
export const normalizedShootName = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * The root folders - `{ id, name }` - that no saved shoot group answers to yet, each standing as its
 * own (empty) group beside the saved ones. A saved group answers to a folder BY ID: a manual item
 * filed under a folder carries `shoot.folderId`, so a renamed folder is still the same group. Only
 * a typed group no folder is linked to yet (`folderId` null) still answers by name - the server
 * links it to the folder the moment one of that name exists.
 */
export function unmatchedFolderShoots(savedShoots, rootFolders) {
  const linked = new Set(savedShoots.map((shoot) => shoot?.folderId).filter(Boolean));
  const named = new Set(savedShoots.filter((shoot) => shoot && !shoot.folderId).map((shoot) => normalizedShootName(shoot.shoot)));
  const seen = new Set();
  return (rootFolders || []).filter((folder) => {
    const key = normalizedShootName(folder.name);
    if (!folder?.id || linked.has(folder.id) || (key && named.has(key)) || seen.has(folder.id)) return false;
    seen.add(folder.id);
    return true;
  });
}

/**
 * The selection items with each linked shoot named by its folder's current name. The items are
 * loaded once with the rail, so a folder renamed since would otherwise still head its group under
 * the old name until the page reloads; the folder tree is the live copy.
 */
export function withFolderNames(deliverables, rootFolders) {
  const names = new Map((rootFolders || []).map((folder) => [folder.id, folder.name]));
  return (deliverables || []).map((item) => {
    const name = item?.shoot?.folderId ? names.get(item.shoot.folderId) : undefined;
    return name && name !== item.shoot.shoot ? { ...item, shoot: { ...item.shoot, shoot: name } } : item;
  });
}

/** The empty group a root folder stands as - keyed `folder:<id>`, the key its first saved item will carry. */
export const folderShootGroup = (folder) => ({ id: `folder:${folder.id}`, shoot: { id: `folder:${folder.id}`, shootId: null, shoot: folder.name, folderId: folder.id } });
