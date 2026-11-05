"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import ZoomIn from "@mui/icons-material/ZoomIn";
import Button from "@/components/shared/Button";
import IconButton from "@/components/shared/IconButton";
import ImagePreviewDialog from "../ImagePreviewDialog";
import EditingMaskCanvas from "./EditingMaskCanvas";
import { fetchProtectedImage } from "@/services/image-selection/image-selection.service";
import isRemoteImage from "@/lib/isRemoteImage";
import { approximateCssFilter } from "@/lib/aiEditingRecipe.mjs";
import { EDITING_VIEWER_MAX_HEIGHT, editingViewerFrame, editingViewerRoom } from "@/lib/imageSelectionEditing.mjs";

/**
 * The photo being edited - the workspace's one large thing. Three ways to compare: Before / After
 * (one frame, toggled), Split (one frame with a divider dragged across it) and Side by side. "After"
 * is the rendered output when there is one; while the sliders have moved since (or nothing has
 * rendered yet) it shows the photo under a CSS approximation of the basic sliders, labelled as such.
 * The Remove Object painter draws over the Before view. The zoom opens the one large viewer the
 * workspace keeps.
 */
function useImageSource(url) {
  const [fetched, setFetched] = useState({ url: "", objectUrl: "" });
  const remote = isRemoteImage(url);
  useEffect(() => {
    if (!url || remote) return undefined;
    const controller = new AbortController();
    let objectUrl = "";
    fetchProtectedImage(url, controller.signal).then((blob) => { objectUrl = URL.createObjectURL(blob); setFetched({ url, objectUrl }); }).catch(() => {});
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [url, remote]);
  if (!url) return "";
  if (remote) return url;
  return fetched.url === url ? fetched.objectUrl : "";
}

const MODES = [["toggle", "Before / After"], ["split", "Split"], ["side", "Side by side"]];

/**
 * The room the frame may take, measured from the layout rather than guessed: from the frame
 * area's own top to the bottom of the pane it scrolls in (the app shell's main pane, or the
 * viewport), less the action bar's reserve - written to the CSS variable the frame's width is
 * computed from (`editingViewerFrame`). The pane's scroll offset is taken out, so a photo opened
 * from a scrolled bay measures the same room. Measured on mount and when the window is resized;
 * a DOM write only, nothing re-renders for it.
 * Every mode and orientation fills the same box: the area under the toolbar is exactly the
 * measured room tall, the frame centred in it, so the navigation row and the action bar below never
 * move when the mode, the photo or its orientation changes.
 */
function useViewerRoom(ref) {
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    const remeasure = () => {
      let pane = element.parentElement;
      while (pane && pane !== document.body && !/(auto|scroll)/.test(getComputedStyle(pane).overflowY)) pane = pane.parentElement;
      const inPane = pane && pane !== document.body;
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      const frameTop = element.getBoundingClientRect().top - (inPane ? pane.getBoundingClientRect().top - pane.scrollTop : -window.scrollY);
      const paneHeight = inPane ? pane.clientHeight : window.innerHeight;
      element.style.setProperty("--editing-viewer-max", `${editingViewerRoom({ paneHeight, frameTop, rem })}px`);
    };
    remeasure();
    window.addEventListener("resize", remeasure);
    return () => window.removeEventListener("resize", remeasure);
  }, [ref]);
}

// `mode` / `onModeChange` - Before / After, Split or Side by side - are the bay's, so the way of
// comparing is kept while the photographer moves between photos (this panel is remade per photo);
// the Before / After `view` stays per photo (the editor sets it from whether a render exists).
export default function EditingPreview({ photo, recipe, view, onViewChange, mode = "toggle", onModeChange, masksEditable = false, onMasksChange }) {
  const edit = photo.edit;
  const rendered = Boolean(edit?.hasOutput && edit.outputPreviewUrl);
  const before = useImageSource(photo.previewUrl);
  const after = useImageSource(rendered ? edit.outputPreviewUrl : "");
  const [zoomed, setZoomed] = useState(false);
  const setMode = (next) => onModeChange?.(next);
  const [divider, setDivider] = useState(50);
  // The preview's own pixels, measured when the Before image loads: the frame's ratio comes from
  // what is drawn, not from the row's recorded dimensions (which stand in until the load, and are
  // the original's - upright for a server upload, but a workstation may record them as shot).
  const [natural, setNatural] = useState(null);
  const measure = (event) => { const { naturalWidth, naturalHeight } = event.currentTarget; if (naturalWidth && naturalHeight) setNatural({ width: naturalWidth, height: naturalHeight }); };
  const frame = editingViewerFrame(natural || { width: photo.width, height: photo.height });
  const areaRef = useRef(null);
  useViewerRoom(areaRef);
  const frameRef = useRef(null);
  const dragging = useRef(false);
  // What "After" means right now: the render, or the approximation while a change is pending.
  const approximate = !rendered || edit?.dirty;
  const filter = approximate ? approximateCssFilter(recipe) : "";
  const afterSource = rendered && !edit?.dirty ? after : before;
  const afterStyle = approximate && filter ? { filter } : undefined;
  const masks = recipe?.tools?.removeObject?.masks || [];
  const showMasks = masksEditable || masks.length > 0;
  const compare = mode !== "toggle";

  function dividerAt(event) {
    const rect = frameRef.current?.getBoundingClientRect();
    if (!rect) return;
    setDivider(Math.round(Math.min(100, Math.max(0, ((event.clientX - rect.left) / rect.width) * 100))));
  }

  const image = (source, label, style, onLoad) => (source
    // eslint-disable-next-line @next/next/no-img-element
    ? <img src={source} alt={`${label} - ${photo.fileName}`} decoding="async" draggable={false} style={style} onLoad={onLoad} className="absolute inset-0 h-full w-full object-contain transition-[filter] duration-150" />
    : <div role="img" aria-label="Loading photo" className="absolute inset-0 animate-pulse bg-slate-800" />);
  const tag = (text, side) => <span className={`pointer-events-none absolute top-2 ${side === "left" ? "left-2" : "right-2"} rounded bg-slate-900/70 px-2 py-0.5 text-[10px] font-semibold text-white`}>{text}</span>;

  return (
    <div className="flex min-h-0 flex-col">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <div role="tablist" aria-label="Compare" className="inline-flex rounded-md border border-slate-300 bg-white p-0.5">
            {MODES.map(([id, label]) => (
              <Button key={id} role="tab" aria-selected={mode === id} size="none" variant="plain" onClick={() => setMode(id)} className={`min-h-10 rounded px-2.5 text-[11px] font-semibold sm:min-h-8 ${mode === id ? "bg-slate-800 text-white" : "text-slate-600 hover:bg-slate-100"}`}>
                {label}
              </Button>
            ))}
          </div>
          {!compare && (
            <div role="tablist" aria-label="Before or after" className="inline-flex rounded-md border border-slate-300 bg-white p-0.5">
              {[["before", "Before"], ["after", "After"]].map(([id, label]) => (
                <Button key={id} role="tab" aria-selected={view === id} size="none" variant="plain" onClick={() => onViewChange(id)} className={`min-h-10 rounded px-3 text-[11px] font-semibold sm:min-h-8 ${view === id ? "bg-slate-800 text-white" : "text-slate-600 hover:bg-slate-100"}`}>
                  {label}
                </Button>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 text-[11px] text-slate-500">
          {(compare || view === "after") && approximate && <span className="rounded bg-amber-50 px-2 py-0.5 text-amber-800">{rendered ? "Approximate until you apply" : "Approximate preview - apply to render"}</span>}
          {(compare || view === "after") && !approximate && <span className="rounded bg-emerald-50 px-2 py-0.5 text-emerald-800">Rendered</span>}
          <IconButton size="sm" ariaLabel="Open large" onClick={() => setZoomed(true)} className="border border-slate-300 text-slate-600"><ZoomIn style={{ fontSize: 16 }} aria-hidden="true" /></IconButton>
        </div>
      </div>

      {/* One frame rule for every mode (editingViewerFrame): bounded by the column and by the room
          under the toolbar (measured onto this wrapper), hugging the photo, the photo
          object-contain inside. The loading state takes the same frame, so nothing moves when
          the pixels arrive. */}
      <div ref={areaRef} className="flex w-full items-center justify-center" style={{ height: EDITING_VIEWER_MAX_HEIGHT }}>
      {mode === "side" ? (
        <div className="grid w-full items-center gap-2 sm:grid-cols-2">
          <div className="relative mx-auto max-w-full overflow-hidden rounded-lg bg-slate-900" style={frame}>{image(before, "Before", undefined, measure)}{tag("Before", "left")}</div>
          <div className="relative mx-auto max-w-full overflow-hidden rounded-lg bg-slate-900" style={frame}>{image(afterSource, "After", afterStyle)}{tag("After", "right")}</div>
        </div>
      ) : (
        <div
          ref={frameRef}
          className={`relative mx-auto max-w-full overflow-hidden rounded-lg bg-slate-900 ${mode === "split" ? "cursor-col-resize select-none touch-none" : ""}`}
          style={frame}
          onPointerDown={mode === "split" ? (event) => { dragging.current = true; frameRef.current?.setPointerCapture?.(event.pointerId); dividerAt(event); } : undefined}
          onPointerMove={mode === "split" ? (event) => { if (dragging.current) dividerAt(event); } : undefined}
          onPointerUp={mode === "split" ? () => { dragging.current = false; } : undefined}
          onPointerCancel={mode === "split" ? () => { dragging.current = false; } : undefined}
        >
          {mode === "split" ? (
            <>
              {image(afterSource, "After", afterStyle)}
              <div className="absolute inset-0" style={{ clipPath: `inset(0 ${100 - divider}% 0 0)` }}>{image(before, "Before", undefined, measure)}</div>
              <div aria-hidden="true" className="absolute inset-y-0 w-0.5 bg-white/90 shadow" style={{ left: `calc(${divider}% - 1px)` }} />
              <input type="range" min="0" max="100" value={divider} onChange={(event) => setDivider(Number(event.target.value))} aria-label="Before / after divider" className="sr-only" />
              {tag("Before", "left")}{tag("After", "right")}
            </>
          ) : (
            <>
              {image(view === "after" ? afterSource : before, view === "after" ? "After" : "Before", view === "after" ? afterStyle : undefined, view === "after" ? undefined : measure)}
              {showMasks && view === "before" && <EditingMaskCanvas masks={masks} onChange={masksEditable ? onMasksChange : undefined} />}
              {showMasks && view !== "before" && masks.length > 0 && <EditingMaskCanvas masks={masks} className="opacity-50" />}
              {masksEditable && view === "before" && <p className="pointer-events-none absolute bottom-2 left-2 rounded bg-slate-900/70 px-2 py-1 text-[10px] text-white">Drag over what to remove</p>}
            </>
          )}
        </div>
      )}
      </div>
      {zoomed && <ImagePreviewDialog image={{ previewUrl: (compare || view === "after") && rendered ? edit.outputPreviewUrl : photo.previewUrl, fileName: photo.fileName }} onClose={() => setZoomed(false)} />}
    </div>
  );
}
