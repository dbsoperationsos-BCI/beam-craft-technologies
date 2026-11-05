"use client";

import { useMemo, useState } from "react";
import Button from "@/components/shared/Button";
import TextField from "@/components/shared/TextField";
import Dialog from "@/components/ui/Dialog";
import { matchesWordChunks } from "@/lib/wordChunks.mjs";

export default function ManageColumnsDialog({ open, columns, visibility, defaultVisibility, onClose, onApply }) {
  const [draft, setDraft] = useState(() => ({ ...visibility }));
  const [query, setQuery] = useState("");
  const filteredColumns = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return normalizedQuery ? columns.filter((column) => matchesWordChunks(column.label, normalizedQuery)) : columns;
  }, [columns, query]);
  if (!open) return null;

  return <Dialog
    title="Manage Columns"
    onClose={onClose}
    // The search stays above the list rather than scrolling away with it.
    toolbar={<TextField type="search" label="" aria-label="Search columns" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search columns..." />}
    footer={<>
      <Button className="max-sm:flex-1" type="button" variant="ghost" onClick={() => setDraft({ ...defaultVisibility })}>Reset to Default</Button>
      <Button className="max-sm:flex-1" type="button" onClick={onClose}>Cancel</Button>
      <Button className="max-sm:flex-1" type="button" variant="primary" onClick={() => { onApply(draft); onClose(); }}>Apply</Button>
    </>}
  >
    {filteredColumns.map((column) => <label key={column.id} className="flex cursor-pointer items-center gap-3 border-b border-slate-100 py-2 text-sm text-slate-700 last:border-b-0">
      <input type="checkbox" checked={draft[column.id] !== false} onChange={(event) => setDraft((current) => ({ ...current, [column.id]: event.target.checked }))} className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
      {column.label}
    </label>)}
    {filteredColumns.length === 0 && <p className="px-1 py-5 text-sm text-slate-500">No columns found.</p>}
  </Dialog>;
}
