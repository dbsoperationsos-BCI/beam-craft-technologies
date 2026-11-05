"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import ChevronLeft from "@mui/icons-material/ChevronLeft";
import ChevronRight from "@mui/icons-material/ChevronRight";
import Close from "@mui/icons-material/Close";
import Download from "@mui/icons-material/Download";
import IosShare from "@mui/icons-material/IosShare";
import PersonOff from "@mui/icons-material/PersonOff";
import Loader from "@/components/shared/Loader";
import useEscapeKey from "@/components/shared/useEscapeKey";
import useFocusTrap from "@/components/shared/useFocusTrap";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { layers } from "@/constants/layers";
import { downloadGuestPhoto, photoBaseName, shareGuestLink } from "./guestActions";

/**
 * The guest's photo viewer: one picture on a near-black canvas that hides the gallery entirely,
 * a muted counter and a 44px Close along the top, Previous / Next at the edges when there is
 * anywhere to go, and a small floating dock of the things a guest may do to the picture -
 * Download and Share, and on My Photos, set apart, This is not me.
 *
 * The staff media grid keeps the shared `Lightbox`; this is the guest's own presentation of the
 * same list. What it does is what the old viewer did, on the same handlers: paging runs through
 * the list it was opened from and reaching its end asks the list for more; Download, Share and
 * "not me" call the same functions with the same arguments. "Not me" now asks first - a tap on
 * the wrong button removed a photo from a guest's collection at once.
 *
 * The picture is shown at its own ratio, never cropped, at most about nine tenths of the width
 * and four fifths of the height on a desktop and nearly the full width on a phone. The tile's
 * thumbnail is drawn under the preview while it loads, so the canvas never flashes; a preview
 * that fails says so and offers Retry. A phone pages by swipe, a keyboard by the arrows, and
 * Escape closes. The gallery behind is not scrolled or moved: the viewer is a layer over it,
 * and closing simply lifts the layer, focus going back to the tile that opened it.
 */
const DOCK_BUTTON = "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full px-4 text-sm font-medium text-white/90 transition hover:bg-white/10 active:bg-white/15 disabled:opacity-50 md:min-h-10";
const EDGE_BUTTON = "absolute top-1/2 hidden h-12 w-12 -translate-y-1/2 place-items-center rounded-full bg-white/10 text-white/80 backdrop-blur transition hover:bg-white/20 md:grid";

/** Where a swipe has to travel before it counts as one; a move more vertical than sideways is a scroll, not a page. */
const SWIPE_DISTANCE = 48;

export default function GuestPhotoViewer({ items, index, total, onIndexChange, onClose, eventName, allowSharing, onNotMe, onNeedMore, hasMore, notify }) {
  const [busy, setBusy] = useState("");
  const [confirmNotMe, setConfirmNotMe] = useState(false);
  // Which picture's preview has painted, and which has failed, by key - so the state for the one
  // on show is read off its key rather than reset as it changes. Retry mints a new key.
  const [readyKey, setReadyKey] = useState(null);
  const [failedKey, setFailedKey] = useState(null);
  const [attempt, setAttempt] = useState(0);
  // Faded in after the first paint rather than appearing, unless the person prefers no motion.
  const [shown, setShown] = useState(false);
  // Set when Next is pressed on the last loaded picture: the list is asked for another page, and
  // the viewer steps forward the moment it arrives. A ref, so waiting is not a render of its own.
  const advance = useRef(false);
  useEffect(() => { if (advance.current && items.length > index + 1) { advance.current = false; onIndexChange(index + 1); } }, [index, items.length, onIndexChange]);
  useEffect(() => { const frame = window.requestAnimationFrame(() => setShown(true)); return () => window.cancelAnimationFrame(frame); }, []);

  const item = items[index];
  const photoKey = item ? `${item.matchId || item.id}-${attempt}` : "";
  const loadState = failedKey === photoKey ? "failed" : readyKey === photoKey ? "ready" : "loading";
  const count = total || items.length;
  const hasPrev = index > 0; const hasNext = index < items.length - 1 || hasMore;
  const prev = useCallback(() => { if (hasPrev) onIndexChange(index - 1); }, [hasPrev, index, onIndexChange]);
  const next = useCallback(() => { if (index < items.length - 1) onIndexChange(index + 1); else if (hasMore) { advance.current = true; onNeedMore?.(); } }, [hasMore, index, items.length, onIndexChange, onNeedMore]);

  // Escape closes, through the shared arbiter, so a confirmation open over this hears it first.
  useEscapeKey(onClose, !confirmNotMe);
  useEffect(() => {
    function onKey(event) { if (confirmNotMe) return; if (event.key === "ArrowLeft") prev(); if (event.key === "ArrowRight") next(); }
    window.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow; document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = previous; };
  }, [confirmNotMe, next, prev]);

  // The neighbours, fetched ahead so paging shows a picture rather than a wait.
  useEffect(() => {
    for (const neighbour of [items[index - 1], items[index + 1]]) if (neighbour?.previewUrl) { const image = new Image(); image.src = neighbour.previewUrl; }
  }, [index, items]);

  // Focus goes in, stays in, and goes back to the tile that opened this when it closes.
  const shellRef = useFocusTrap();

  // A phone pages by swipe: the start is remembered, the end compared, a mostly-sideways move of
  // enough distance is a page. Nothing more than that - no library, no momentum.
  const touch = useRef(null);
  function onTouchStart(event) { const point = event.touches[0]; touch.current = { x: point.clientX, y: point.clientY }; }
  function onTouchEnd(event) {
    const start = touch.current; touch.current = null;
    if (!start) return;
    const point = event.changedTouches[0]; const dx = point.clientX - start.x; const dy = point.clientY - start.y;
    if (Math.abs(dx) < SWIPE_DISTANCE || Math.abs(dy) > Math.abs(dx)) return;
    if (dx < 0) next(); else prev();
  }

  if (!item) return null;
  async function save() {
    setBusy("download");
    try { const outcome = await downloadGuestPhoto(item, photoBaseName(eventName, index)); if (outcome === "opened") notify?.("The photo opened in a new tab - save it from there."); }
    catch (error) { notify?.(error.message || "Could not download the photo.", "error"); }
    finally { setBusy(""); }
  }
  async function share() {
    setBusy("share");
    const outcome = await shareGuestLink(eventName);
    if (outcome === "copied") notify?.("Link copied.", "success");
    if (outcome === "failed") notify?.("Could not copy the link. Copy it from the address bar.", "error");
    setBusy("");
  }
  async function notMe() {
    setConfirmNotMe(false);
    setBusy("reject");
    // A refusal has already been said by the caller; the viewer only has to stop waiting.
    try { await onNotMe(item); } catch { /* reported by the caller */ } finally { setBusy(""); }
  }

  const src = item.previewUrl || item.thumbnailUrl;
  const viewer = <div
    ref={shellRef}
    role="dialog"
    aria-modal="true"
    aria-label={`Photo ${index + 1} of ${count}`}
    onTouchStart={onTouchStart}
    onTouchEnd={onTouchEnd}
    className={`fixed inset-0 ${layers.dialog} flex flex-col bg-[#0b0d12] text-white transition-opacity duration-200 motion-reduce:transition-none ${shown ? "opacity-100" : "opacity-0"}`}
  >
    {/* Top: the counter, muted, and Close with a 44px target, both clear of a notch. */}
    <div className="flex shrink-0 items-center justify-between px-3 pt-[env(safe-area-inset-top)] md:px-5">
      <p className="px-2 py-3 text-[13px] tabular-nums text-white/60">{index + 1} / {count}</p>
      <button type="button" onClick={onClose} aria-label="Close photo" className="my-1 grid h-11 w-11 place-items-center rounded-full text-white/80 transition hover:bg-white/10 active:bg-white/15"><Close style={{ fontSize: 24 }} aria-hidden="true" /></button>
    </div>

    {/* The stage: the picture, at its own ratio, in the room that is left. */}
    <div className="relative flex min-h-0 flex-1 items-center justify-center px-2 md:px-16">
      {hasPrev && <button type="button" onClick={prev} aria-label="Previous photo" className={`${EDGE_BUTTON} left-4`}><ChevronLeft style={{ fontSize: 28 }} aria-hidden="true" /></button>}
      <figure className="relative flex max-h-full max-w-full items-center justify-center">
        {/* The thumbnail under the preview, so the canvas holds a picture from the first frame. */}
        {item.thumbnailUrl && item.thumbnailUrl !== src && loadState === "loading" && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.thumbnailUrl} alt="" aria-hidden="true" className="absolute max-h-[80vh] max-w-full object-contain opacity-60 blur-[2px] md:max-h-[82vh] md:max-w-[90vw]" />
        )}
        {loadState !== "failed" && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={photoKey}
            src={src}
            alt={`Photo ${index + 1}`}
            onLoad={() => setReadyKey(photoKey)}
            onError={() => setFailedKey(photoKey)}
            draggable={false}
            className={`max-h-[80vh] max-w-full select-none object-contain transition-opacity duration-200 motion-reduce:transition-none md:max-h-[82vh] md:max-w-[90vw] ${loadState === "ready" ? "opacity-100" : "opacity-0"}`}
          />
        )}
        {loadState === "loading" && <div className="absolute inset-0 grid place-items-center"><Loader label="" className="text-white/70" /></div>}
        {loadState === "failed" && <div role="alert" className="flex flex-col items-center gap-3 px-6 py-10 text-center">
          <p className="text-sm text-white/80">Unable to load this photo.</p>
          <div className="flex gap-2">
            <button type="button" onClick={() => setAttempt((current) => current + 1)} className={`${DOCK_BUTTON} bg-white/10`}>Retry</button>
            <button type="button" onClick={onClose} className={DOCK_BUTTON}>Close</button>
          </div>
        </div>}
      </figure>
      {hasNext && <button type="button" onClick={next} aria-label="Next photo" className={`${EDGE_BUTTON} right-4`}><ChevronRight style={{ fontSize: 28 }} aria-hidden="true" /></button>}
    </div>

    {/* The dock: a pill of the actions, floating on a desktop, a bar across the foot of a phone
        clear of the home indicator. "Not me" sits apart, past a rule, quieter than the two. */}
    {(item.downloadUrl || allowSharing || onNotMe) && <div className="flex shrink-0 justify-center px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 md:pb-5">
      <div className="flex w-full items-center justify-around gap-1 rounded-2xl border border-white/10 bg-white/[0.07] px-2 py-1.5 backdrop-blur-md md:w-auto md:justify-center md:rounded-full md:px-2.5">
        {item.downloadUrl && <button type="button" onClick={save} disabled={Boolean(busy)} className={`${DOCK_BUTTON} flex-1 md:flex-none`}><Download style={{ fontSize: 18 }} aria-hidden="true" />{busy === "download" ? "Saving..." : "Download"}</button>}
        {allowSharing && <button type="button" onClick={share} disabled={Boolean(busy)} className={`${DOCK_BUTTON} flex-1 md:flex-none`}><IosShare style={{ fontSize: 18 }} aria-hidden="true" />Share</button>}
        {onNotMe && <>
          {(item.downloadUrl || allowSharing) && <span aria-hidden="true" className="mx-0.5 h-6 w-px bg-white/15 md:mx-1" />}
          <button type="button" onClick={() => setConfirmNotMe(true)} disabled={Boolean(busy)} aria-label="This is not me" className={`${DOCK_BUTTON} flex-1 text-white/65 md:flex-none`}><PersonOff style={{ fontSize: 18 }} aria-hidden="true" />{busy === "reject" ? "Removing..." : "Not me"}</button>
        </>}
      </div>
    </div>}

    <ConfirmDialog
      open={confirmNotMe}
      title="This photo doesn't look like you?"
      message="It will be removed from My Photos. This helps keep your collection accurate."
      cancelLabel="Cancel"
      confirmLabel="Remove from My Photos"
      layer="dialogOverPanel"
      onCancel={() => setConfirmNotMe(false)}
      onConfirm={notMe}
    />
  </div>;

  return createPortal(viewer, document.body);
}
