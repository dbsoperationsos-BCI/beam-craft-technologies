"use client";

import Check from "@mui/icons-material/Check";
import ChevronLeft from "@mui/icons-material/ChevronLeft";
import ChevronRight from "@mui/icons-material/ChevronRight";
import InfoOutlined from "@mui/icons-material/InfoOutlined";
import MoreVert from "@mui/icons-material/MoreVert";
import { useEffect, useRef, useState } from "react";
import PublicGalleryLazyImage from "./PublicGalleryLazyImage";
import useEscapeKey from "@/components/shared/useEscapeKey";

// Breathing room the flyout needs against the viewport edge.
const GUTTER = 8;

export function selectionFor(item, selectionCounts) {
  return selectionCounts[item.id] || 0;
}

function DeliverableRow({ item, assigned, selectionCounts, onSelect, size }) {
  const compact = size === "compact";
  return (
    <button type="button" onClick={onSelect} className={`flex w-full items-center text-left hover:bg-slate-50 ${compact ? "gap-1.5 px-2 py-1.5" : "gap-3 px-4 py-3"}`}>
      <span className={`grid shrink-0 place-items-center rounded-full border leading-none ${compact ? "h-3 w-3 text-[7px]" : "h-5 w-5 text-[11px]"} ${assigned ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300 text-transparent"}`}><Check style={{ fontSize: "1.3em" }} /></span>
      <span className="min-w-0 flex-1 truncate">{item.name}</span>
      <span className={`shrink-0 text-slate-400 ${compact ? "text-[9px]" : "text-xs"}`}>{selectionFor(item, selectionCounts)}/{item.selectionLimit}</span>
    </button>
  );
}

// Below `sm` a thumbnail is only about a third of the screen wide, so an anchored popover with
// a side flyout has nowhere to go. Touch layouts get a bottom sheet instead: full-width rows,
// no drill-down, and everything about the photo visible at once.
function PhotoActionsSheet({ image, assigned, deliverables, menuDeliverables, selectionCounts, onAdd, onClose }) {
  useEffect(() => {
    const narrow = window.matchMedia("(max-width: 639px)");
    if (!narrow.matches) return undefined;
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = overflow; };
  }, []);
  return (
    <div className="fixed inset-0 z-50 sm:hidden" role="dialog" aria-modal="true" aria-label={`Actions for ${image.fileName}`}>
      {/* No blur and only a light dim: the grid has to stay legible so the blue ring on the
          photo this sheet belongs to is visible while the sheet is open. */}
      <button type="button" aria-label="Close photo actions" onClick={onClose} className="absolute inset-0 bg-slate-900/20" />
      <div className="absolute inset-x-0 bottom-0 max-h-[80vh] overflow-y-auto overscroll-contain rounded-t-2xl bg-white pb-[max(0.5rem,env(safe-area-inset-bottom))] text-sm text-slate-800 shadow-2xl">
        <div className="sticky top-0 bg-white pb-1 pt-2">
          <div className="mx-auto h-1 w-10 rounded-full bg-slate-300" />
        </div>
        <p className="px-4 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Add to</p>
        {menuDeliverables.length
          ? menuDeliverables.map((item) => <DeliverableRow key={item.id} item={item} assigned={assigned.includes(item.id)} selectionCounts={selectionCounts} onSelect={() => onAdd(item)} />)
          : <p className="px-4 py-3 text-slate-500">No selection items for this shoot.</p>}
        <p className="border-t border-slate-100 px-4 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Selection info</p>
        {assigned.length
          ? assigned.map((id) => <p key={id} className="truncate px-4 py-1.5">{deliverables.find((item) => item.id === id)?.name || "Unknown selection item"}</p>)
          : <p className="px-4 py-1.5 text-slate-500">Not selected</p>}
        <button type="button" onClick={onClose} className="mt-3 h-11 w-full border-t border-slate-100 text-sm font-medium text-slate-600">Close</button>
      </div>
    </div>
  );
}

/**
 * The client-facing photo grid: a square thumbnail carrying its own selection tick and an actions
 * menu for filing the photo under another selection item. Shared by the in-folder grid and the
 * home page's Selected tab so a photo behaves the same wherever the client meets it — unpicking
 * from the Selected tab leaves the tile in place, unticked, rather than making it vanish
 * mid-click.
 *
 * `items` arrive already scoped to the selection item on screen, each carrying `selected` for the
 * tick; `menuDeliverables` is what "Add to" may offer, and `deliverables` names every item so
 * "Selection info" can read back assignments made elsewhere.
 */
export default function SelectionPhotoGrid({
  items, sessionToken, deliverables = [], menuDeliverables = [], selectionCounts = {},
  onToggleSelect, onOpenImage, loading = false, emptyMessage = "No photos to show.",
  // A submitted selection can no longer change, so the tiles drop their tick and ⋮ controls and
  // become view-only — the photos are still there to look at, just not to edit.
  locked = false,
}) {
  const [openMenuId, setOpenMenuId] = useState(null);
  // Which menu row has its flyout showing: "add", "info", or none.
  const [openSection, setOpenSection] = useState(null);
  const [submenuSide, setSubmenuSide] = useState("right");
  const menuRef = useRef(null);
  const menuBoxRef = useRef(null);

  function openMenu(event, imageId) { event.stopPropagation(); setOpenMenuId((current) => (current === imageId ? null : imageId)); setOpenSection(null); }
  // The menu has no dedicated close control, so a click anywhere else — or Escape — dismisses
  // it. The photo's own action button sits inside the measured element, which keeps it a toggle.
  // Escape closes the photo's own menu, not the gallery around it.
  useEscapeKey(() => setOpenMenuId(null), Boolean(openMenuId));

  useEffect(() => {
    if (!openMenuId) return undefined;
    function closeOnOutsideClick(event) { if (!menuRef.current?.contains(event.target)) setOpenMenuId(null); }
    document.addEventListener("mousedown", closeOnOutsideClick);
    return () => { document.removeEventListener("mousedown", closeOnOutsideClick); };
  }, [openMenuId]);
  // The server is the source of truth for which selection items a photo belongs to, so the menu
  // reads the assignments off the image rather than keeping its own copy.
  function assignedIds(image) { return (image.photoSelections || []).map((selection) => selection.imageSelectionDeliverableConfigId); }
  function addTo(image, deliverable) { onToggleSelect(image, deliverable.id); setOpenSection(null); setOpenMenuId(null); }
  // Flyouts open towards whichever side of the menu has room, so a photo in the last column
  // pushes them left and one in the first column pushes them right. The side is decided before
  // the flyout renders to avoid it appearing on one side and jumping.
  function showSection(name) {
    const rect = menuBoxRef.current?.getBoundingClientRect();
    if (rect) {
      // The menu and its flyouts are the same width, so the measured box is what has to fit —
      // no hard-coded pixel value to keep in step with the classes.
      const needed = rect.width + GUTTER;
      const spaceRight = window.innerWidth - rect.right;
      const fitsRight = spaceRight >= needed;
      const fitsLeft = rect.left >= needed;
      setSubmenuSide(fitsRight || (!fitsLeft && spaceRight >= rect.left) ? "right" : "left");
    }
    setOpenSection(name);
  }
  function toggleSection(name) { if (openSection === name) setOpenSection(null); else showSection(name); }

  const gridClass = "grid grid-cols-3 gap-1 sm:grid-cols-4 md:grid-cols-5 xl:grid-cols-7 2xl:grid-cols-8";

  return (
    <>
      {items.length === 0 && !loading
        ? <p className="py-16 text-center text-sm text-slate-500">{emptyMessage}</p>
        : <div className={gridClass}>{items.map((image) => { const assigned = assignedIds(image); return <div key={image.id} className={`relative ${openMenuId === image.id ? "z-20" : ""}`}><div className={`relative aspect-square overflow-visible rounded-md bg-slate-200 ${openMenuId === image.id ? "ring-2 ring-blue-600" : ""}`}><button type="button" onClick={() => onOpenImage(image)} aria-label={`Open ${image.fileName}`} className="block h-full w-full overflow-hidden rounded-md"><PublicGalleryLazyImage src={image.thumbnailUrl} alt={image.fileName} sessionToken={sessionToken} className="h-full w-full" /></button>{!locked && <button type="button" aria-label={image.selected ? "Remove from selection" : "Select photo"} onClick={() => onToggleSelect(image)} className={`absolute left-1.5 top-1.5 grid h-4 w-4 place-items-center rounded-full border ${image.selected ? "border-blue-600 bg-blue-600 text-white" : "border-white/50 bg-black/25 text-transparent backdrop-blur-md"}`}><Check style={{ fontSize: 12 }} /></button>}{!locked && <div ref={openMenuId === image.id ? menuRef : null} className="absolute right-1 top-1"><button type="button" aria-label="Photo actions" aria-haspopup="menu" aria-expanded={openMenuId === image.id} onClick={(event) => openMenu(event, image.id)} className="grid h-6 w-6 place-items-center rounded-full border border-white/40 bg-black/25 text-white shadow-sm backdrop-blur-md transition hover:bg-black/40"><MoreVert style={{ fontSize: 14 }} /></button>{openMenuId === image.id && <PhotoActionsSheet image={image} assigned={assigned} deliverables={deliverables} menuDeliverables={menuDeliverables} selectionCounts={selectionCounts} onAdd={(item) => addTo(image, item)} onClose={() => setOpenMenuId(null)} />}{openMenuId === image.id && <div ref={menuBoxRef} onMouseLeave={() => setOpenSection(null)} className="absolute right-0 top-7 hidden w-32 max-w-[calc(100vw-1rem)] rounded-md border border-slate-200 bg-white py-0.5 text-left text-[11px] text-black shadow-lg sm:block xl:w-36"><div onMouseEnter={() => showSection("add")} className="relative"><button type="button" aria-haspopup="true" aria-expanded={openSection === "add"} onClick={() => toggleSection("add")} className="flex w-full items-center justify-between gap-1 px-2 py-1.5 hover:bg-slate-50">Add to <span aria-hidden="true" className="grid place-items-center">{submenuSide === "left" ? <ChevronLeft style={{ fontSize: 13 }} /> : <ChevronRight style={{ fontSize: 13 }} />}</span></button>{openSection === "add" && <div className={`absolute top-0 z-40 max-h-44 w-28 max-w-[calc(100vw-1rem)] overflow-y-auto overscroll-contain rounded-md border border-slate-200 bg-white py-0.5 shadow-lg sm:w-32 xl:w-36 ${submenuSide === "left" ? "right-full" : "left-full"}`}>{menuDeliverables.length ? menuDeliverables.map((item) => <DeliverableRow key={item.id} item={item} assigned={assigned.includes(item.id)} selectionCounts={selectionCounts} onSelect={() => addTo(image, item)} size="compact" />) : <p className="px-2 py-1.5 text-slate-500">No selection items for this shoot.</p>}</div>}</div><div onMouseEnter={() => showSection("info")} className="relative"><button type="button" aria-haspopup="true" aria-expanded={openSection === "info"} onClick={() => toggleSection("info")} className="flex w-full items-center justify-between gap-1 px-2 py-1.5 hover:bg-slate-50">Selection info <span aria-hidden="true" className="grid place-items-center">{submenuSide === "left" ? <ChevronLeft style={{ fontSize: 13 }} /> : <ChevronRight style={{ fontSize: 13 }} />}</span></button>{openSection === "info" && <div className={`absolute top-0 z-40 max-h-44 w-28 max-w-[calc(100vw-1rem)] overflow-y-auto overscroll-contain rounded-lg border border-slate-200 bg-white px-2 py-1.5 shadow-xl sm:w-32 xl:w-36 ${submenuSide === "left" ? "right-full" : "left-full"}`}><p className="flex items-center gap-1 text-[9px] text-slate-500"><InfoOutlined style={{ fontSize: 11 }} aria-hidden="true" />Selection Info</p>{assigned.length ? assigned.map((id) => <p key={id} className="mt-1 truncate text-[11px] text-slate-900">{deliverables.find((item) => item.id === id)?.name || "Unknown selection item"}</p>) : <p className="mt-1 text-[11px] text-slate-400">Not selected</p>}</div>}</div></div>}</div>}</div><p className="mt-0.5 truncate px-0.5 text-center text-[9px] text-slate-600 sm:text-[10px]" title={image.fileName}>{image.fileName}</p></div>; })}</div>}
      {loading && <div className={`${gridClass} ${items.length ? "mt-1" : ""}`}>{Array.from({ length: 16 }, (_, index) => <div key={index} className="aspect-square animate-pulse rounded-md bg-slate-200" />)}</div>}
    </>
  );
}
