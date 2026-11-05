"use client";
import Close from "@mui/icons-material/Close";
import Menu from "@mui/icons-material/Menu";
import { useEffect } from "react";
import useEscapeKey from "@/components/shared/useEscapeKey";

// The gallery sidebar carries the selection items and the folder list, so it cannot simply be
// hidden on small screens the way a decorative rail could. Below `lg` it moves into an
// off-canvas drawer opened from the header hamburger; from `lg` up it is a static column.
export default function GallerySidebarShell({ open, onClose, label = "Gallery menu", children }) {
  // Escape closes the drawer, and only the drawer.
  useEscapeKey(onClose, open);

  useEffect(() => {
    if (!open) return undefined;
    // Growing past `lg` swaps the drawer for the static column. Closing on that transition keeps
    // the drawer state honest and, more importantly, releases the body scroll lock.
    const wide = window.matchMedia("(min-width: 1024px)");
    function closeWhenWide(event) { if (event.matches) onClose(); }
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    wide.addEventListener("change", closeWhenWide);
    return () => { document.body.style.overflow = overflow; wide.removeEventListener("change", closeWhenWide); };
  }, [open, onClose]);

  return (
    <>
      <aside className="hidden min-h-0 overflow-y-auto border-r border-slate-200 bg-white lg:block">{children}</aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label={label}>
          <button type="button" aria-label="Close menu" onClick={onClose} className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" />
          <aside className="absolute inset-y-0 left-0 flex w-[86%] max-w-xs flex-col overflow-y-auto overscroll-contain border-r border-slate-200 bg-white shadow-xl">
            <button type="button" onClick={onClose} aria-label="Close menu" className="absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-full text-slate-500 hover:bg-slate-100"><Close style={{ fontSize: 18 }} /></button>
            {children}
          </aside>
        </div>
      )}
    </>
  );
}

export function SidebarToggle({ onClick, className = "" }) {
  return (
    <button type="button" onClick={onClick} aria-label="Open gallery menu" className={`grid h-9 w-9 shrink-0 place-items-center rounded-md text-slate-600 hover:bg-slate-100 lg:hidden ${className}`}>
      <span className="sr-only">Open gallery menu</span>
      <Menu style={{ fontSize: 18 }} aria-hidden="true" />
    </button>
  );
}
