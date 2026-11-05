"use client";

import Dialog from "@/components/ui/Dialog";
import Button from "@/components/shared/Button";

/**
 * Every original a "Download Selected" could not find, by name and where its record says it lives.
 * Everything else was saved; this is the list to put right before downloading again. `items`:
 * [{ fileName, path }]. `onLocate`, when the photo folder can be chosen again, is the remedy offered
 * beside the list.
 */
export default function MissingOriginalsDialog({ items, onClose, onLocate = null }) {
  const count = items.length;
  return (
    <Dialog
      title={`${count} original${count === 1 ? "" : "s"} not found`}
      description="Every other photo was saved. Put these back where they were, or locate the photo folder again, then download once more."
      onClose={onClose}
      footer={<>{onLocate && <Button variant="primary" onClick={onLocate}>Locate Photo Folder</Button>}<Button variant={onLocate ? "secondary" : "primary"} onClick={onClose}>Close</Button></>}
    >
      <ul className="divide-y divide-slate-100 text-xs">
        {items.map((item, index) => (
          <li key={`${index}:${item.path}`} className="py-2">
            <p className="font-medium text-slate-800">Original file missing: {item.fileName}</p>
            <p className="break-all text-[11px] text-slate-500 select-text">Expected at {item.path}</p>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
