"use client";

import Folder from "@mui/icons-material/Folder";

export default function FolderCard({ folder, onOpen }) {
  return <article className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm transition hover:border-blue-300 hover:shadow"><button type="button" onClick={() => onOpen(folder)} className="flex w-full items-start gap-3 text-left"><Folder aria-hidden="true" className="mt-0.5 shrink-0 text-amber-500" style={{ fontSize: 24 }} /><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-slate-800">{folder.name}</span><span className="mt-1 block text-[10px] text-slate-500">{folder.statistics.childFolderCount} subfolder{folder.statistics.childFolderCount === 1 ? "" : "s"}</span></span></button></article>;
}
