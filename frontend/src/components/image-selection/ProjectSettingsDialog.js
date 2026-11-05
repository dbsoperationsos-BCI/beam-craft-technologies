"use client";

import Dialog from "@/components/ui/Dialog";

// Settings popup: a nav column on the left and the panel body on the right. The dialog itself —
// backdrop, Escape, the locked page behind — comes from the shared Dialog; this only lays out the
// two columns. Both sides are empty until callers pass `sidebar` / `children`.
export default function ProjectSettingsDialog({ title = "Settings", sidebar = null, children = null, onClose }) {
  return (
    <Dialog title={title} size="full" onClose={onClose} bodyClassName="px-0 pt-0 sm:px-0">
      <div className="grid min-h-[60vh] grid-cols-1 border-t border-slate-200 md:grid-cols-[230px_minmax(0,1fr)]">
        <aside className="overflow-y-auto border-b border-slate-200 p-3 md:border-b-0 md:border-r" aria-label="Settings sections">
          {sidebar}
        </aside>
        <section className="min-w-0 overflow-y-auto p-6">{children}</section>
      </div>
    </Dialog>
  );
}
