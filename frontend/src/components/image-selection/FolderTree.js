"use client";

import Add from "@mui/icons-material/Add";
import ExpandLess from "@mui/icons-material/ExpandLess";
import ExpandMore from "@mui/icons-material/ExpandMore";
import Folder from "@mui/icons-material/Folder";
import MoreVert from "@mui/icons-material/MoreVert";
import { useEffect, useRef, useState } from "react";
import { collectFolderIds, toggleExpandedFolder } from "@/lib/folderTreeUtils.mjs";
import useMenuDismiss from "@/components/shared/useMenuDismiss";

function FolderMenu({ folder, onAction, panelRef }) {
  // Subfolders are only created one level deep, so Add Sub Folder is offered on root folders
  // alone. A shoot folder comes from Project Management and cannot be renamed or deleted here,
  // so its menu carries nothing else.
  return <div ref={panelRef} role="menu" aria-label={`Actions for ${folder.name}`} className="absolute right-1 top-7 z-30 w-40 rounded-md border border-slate-200 bg-white py-1 shadow-lg">
    {!folder.parentId && <button type="button" role="menuitem" onClick={() => onAction("create", folder)} className="block w-full px-3 py-2 text-left text-xs text-slate-700 hover:bg-slate-50">Add Sub Folder</button>}
    {!folder.projectShootId && <>
      <button type="button" role="menuitem" onClick={() => onAction("rename", folder)} className="block w-full px-3 py-2 text-left text-xs text-slate-700 hover:bg-slate-50">Rename</button>
      <button type="button" role="menuitem" onClick={() => onAction("delete", folder)} className="block w-full px-3 py-2 text-left text-xs text-red-600 hover:bg-red-50">Delete</button>
    </>}
  </div>;
}

function Branch({ folder, selectedId, expandedIds, menuFolderId, onToggle, onSelect, onOpenMenu, onAction, depth, canWrite, menuRef, triggerRef }) {
  const hasChildren = folder.children?.length > 0;
  const expanded = expandedIds.has(folder.id);
  return <li>
    <div className={`group relative flex items-center rounded-md py-1 text-xs ${selectedId === folder.id ? "bg-blue-50 text-blue-700" : "text-slate-700 hover:bg-slate-50"}`} style={{ paddingLeft: `${depth * 14 + 4}px` }}>
      <button type="button" aria-label={`${expanded ? "Collapse" : "Expand"} ${folder.name}`} disabled={!hasChildren} onClick={() => onToggle(folder.id)} className="inline-flex h-6 w-5 items-center justify-center text-slate-400 disabled:opacity-0">
        {/* Down to open, up to close, as everywhere else a row opens out. */}
        {expanded ? <ExpandLess style={{ fontSize: 14 }} aria-hidden="true" /> : <ExpandMore style={{ fontSize: 14 }} aria-hidden="true" />}
      </button>
      <button type="button" onClick={() => onSelect(folder)} className="flex min-w-0 flex-1 items-center gap-2 py-1 text-left"><Folder style={{ fontSize: 15 }} aria-hidden="true" className={selectedId === folder.id ? "text-blue-600" : "text-amber-500"} /><span className="truncate">{folder.name}</span></button>
      {/* Every entry in this menu creates, renames or deletes a folder, so a viewer holding READ
          alone gets no menu rather than one that opens onto refusals. Expanding and selecting a
          folder stay - they are how the tree is read. */}
      {/* The ⋮ - Rename and Delete - is always shown, not only on hover, so a folder's actions are
          plain to see (and reachable by touch); the desktop folder tree does the same. */}
      {canWrite && <button type="button" ref={menuFolderId === folder.id ? triggerRef : null} aria-label={`Folder actions for ${folder.name}`} aria-expanded={menuFolderId === folder.id} onClick={() => onOpenMenu(menuFolderId === folder.id ? null : folder.id)} className="mr-1 inline-flex h-6 w-6 items-center justify-center rounded text-slate-500 hover:bg-slate-200/70"><MoreVert style={{ fontSize: 15 }} aria-hidden="true" /></button>}
      {menuFolderId === folder.id && <FolderMenu folder={folder} onAction={onAction} panelRef={menuRef} />}
    </div>
    {expanded && hasChildren && <ul>{folder.children.map((child) => <Branch key={child.id} folder={child} selectedId={selectedId} expandedIds={expandedIds} menuFolderId={menuFolderId} onToggle={onToggle} onSelect={onSelect} onOpenMenu={onOpenMenu} onAction={onAction} depth={depth + 1} canWrite={canWrite} menuRef={menuRef} triggerRef={triggerRef} />)}</ul>}
  </li>;
}

export default function FolderTree({ folders, currentFolder, onSelect, onRoot, onCreateRoot, onAction, canWrite = true }) {
  const [expandedIds, setExpandedIds] = useState(() => collectFolderIds(folders));
  const [menuFolderId, setMenuFolderId] = useState(null);
  // One folder menu is open at a time, so one pair of refs — the open panel and its ⋮ button —
  // is enough. Dismissal is scoped to those, not the whole tree: clicking another folder, the
  // gallery, or anywhere else closes the menu.
  const menuRef = useRef(null);
  const triggerRef = useRef(null);
  const initializedRef = useRef(folders.length > 0);

  useEffect(() => {
    if (initializedRef.current || folders.length === 0) return undefined;
    initializedRef.current = true;
    const timer = window.setTimeout(() => setExpandedIds(collectFolderIds(folders)), 0);
    return () => window.clearTimeout(timer);
  }, [folders]);

  useMenuDismiss([menuRef, triggerRef], () => setMenuFolderId(null), menuFolderId !== null);

  function act(action, folder) { setMenuFolderId(null); onAction(action, folder); }

  return <nav aria-label="Folder tree">
    {canWrite && <button type="button" onClick={onCreateRoot} className="mb-2 inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-md bg-blue-600 px-3 text-xs font-semibold text-white hover:bg-blue-700"><Add style={{ fontSize: 15 }} aria-hidden="true" />New Folder</button>}
    <ul>{folders.map((folder) => <Branch key={folder.id} folder={folder} selectedId={currentFolder?.id} expandedIds={expandedIds} menuFolderId={menuFolderId} onToggle={(folderId) => setExpandedIds((current) => toggleExpandedFolder(current, folderId))} onSelect={onSelect} onOpenMenu={setMenuFolderId} onAction={act} depth={0} canWrite={canWrite} menuRef={menuRef} triggerRef={triggerRef} />)}</ul>
  </nav>;
}
