"use client";

export default function FolderContextMenu({ onCreate, onRename, onDelete }) {
  return <div className="absolute right-2 top-9 z-20 w-36 rounded-md border border-slate-200 bg-white py-1 text-xs shadow-lg" role="menu"><button type="button" onClick={onCreate} className="block w-full px-3 py-2 text-left text-slate-700 hover:bg-slate-50">New subfolder</button><button type="button" onClick={onRename} className="block w-full px-3 py-2 text-left text-slate-700 hover:bg-slate-50">Rename</button><button type="button" onClick={onDelete} className="block w-full px-3 py-2 text-left text-red-600 hover:bg-red-50">Delete</button></div>;
}
