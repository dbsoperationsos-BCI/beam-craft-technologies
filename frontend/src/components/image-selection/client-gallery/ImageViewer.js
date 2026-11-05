"use client";
import ArrowBack from "@mui/icons-material/ArrowBack";
import ArrowForward from "@mui/icons-material/ArrowForward";
import Check from "@mui/icons-material/Check";
import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { fetchGalleryImage } from "@/services/image-selection/public-gallery.service";
import isRemoteImage from "@/lib/isRemoteImage";
import useEscapeKey from "@/components/shared/useEscapeKey";
import { classifyTouch, isDoubleTap } from "@/lib/viewerGesture.mjs";

// Below Tailwind's `sm` - the breakpoint this viewer lays itself out by - a phone is holding it:
// the arrows over the picture step aside and the picture itself is swiped and tapped instead.
const PHONE_QUERY = "(max-width: 639px)";

export default function ImageViewer({ image, index, total, selectedCount, sessionToken, onClose, onPrev, onNext, onToggleSelect, hasPrev, hasNext, deliverables = [] }) {
  const [source, setSource] = useState("");
  const remote = isRemoteImage(image.previewUrl);
  // What this photo is picked for — the selection items (Retouches, Frame, …) it belongs to,
  // shown when hovering or focusing the select button so the tick can say what it means.
  const selectedFor = deliverables
    .filter((item) => (image.photoSelections || []).some((selection) => selection.imageSelectionDeliverableConfigId === item.id))
    .map((item) => item.name);

  useEffect(() => {
    if (remote) { setSource(image.previewUrl); return undefined; }
    const controller = new AbortController(); let url = "";
    setSource("");
    fetchGalleryImage(image.previewUrl, sessionToken, controller.signal).then((blob) => { url = URL.createObjectURL(blob); setSource(url); }).catch(() => setSource(""));
    return () => { controller.abort(); if (url) URL.revokeObjectURL(url); };
  }, [image.previewUrl, remote, sessionToken]);

  /*
   * The gallery is still mounted under this - that is what keeps the client's place in it - so it
   * is held still while a photo is open, or a wheel or a dragged finger would scroll it away
   * behind the picture. Put back exactly as it was found, which is how every other overlay here
   * behaves.
   */
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, []);

  /*
   * Back closes the photo rather than leaving the gallery.
   *
   * Opening one adds an entry of its own to the history, so the browser's Back - and a phone's
   * back gesture, which is the same thing and is how most clients leave a picture - pops that
   * entry and lands on the gallery exactly where it was rather than walking off the page.
   *
   * **Closing never waits on the history.** `close()` calls the caller straight away and only
   * then tidies the entry away, so the photo shuts the instant the button is pressed whatever the
   * browser does with the stack; a `popstate` that arrives afterwards finds it already closed and
   * changes nothing. The entry is pushed once, guarded by a ref, because React mounts an effect
   * twice in development - with the push in the effect and the pop in its cleanup, opening a
   * photo closed it again immediately.
   *
   * `onClose` is read through a ref so this runs once for the life of the viewer: the caller
   * passes a fresh arrow on every render. Moving between photos is deliberately not history - it
   * is one picture being looked at, and a Back per photograph is not what going back means.
   */
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; });
  const entryRef = useRef(false);
  useEffect(() => {
    if (!entryRef.current) { window.history.pushState({ imageSelectionViewer: true }, ""); entryRef.current = true; }
    const onPop = () => { entryRef.current = false; closeRef.current?.(); };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const close = () => {
    const tidy = entryRef.current;
    entryRef.current = false;
    closeRef.current?.();
    if (tidy) window.history.back();
  };

  // Escape leaves the photo, by the same door the back arrow and the browser's Back use. The
  // arrows and space stay on the viewer's own listener below - they are about moving through the
  // gallery rather than about dismissing what is open.
  useEscapeKey(close);

  useEffect(() => {
    function keydown(event) {
      if (event.key === "ArrowLeft" && hasPrev) onPrev();
      if (event.key === "ArrowRight" && hasNext) onNext();
      if (event.key === " ") { event.preventDefault(); onToggleSelect(image); }
    }
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [onClose, onPrev, onNext, onToggleSelect, image, hasPrev, hasNext]);

  /*
   * On a phone the picture answers a finger: swipe left for the next photo, right for the previous,
   * and a **double tap to pick it** - the same handlers the bottom bar and the keyboard use, with the
   * same stops at the first and last photo. `classifyTouch` decides what one touch was, so a swipe is
   * never a tap. A single tap does nothing, and a double tap only ever picks: on a photo already
   * picked it does nothing, because unpicking is the bottom tick's alone. One pick is in flight at a
   * time, so a triple tap or a quick second double tap sends nothing more. Nothing is prevented: the page is already held still while a photo is open, and
   * a second finger (a pinch) makes the gesture nobody's. Larger screens keep the arrows over the
   * picture and ignore touches here.
   */
  const touchRef = useRef(null);
  const lastTapRef = useRef(null);
  const pickingRef = useRef(false);

  /*
   * What a pick on a phone just did, shown for a moment over the photo - read off the real result,
   * never announced ahead of it. A tap (or the bottom tick) only *asks*: `asked` remembers which
   * photo and which way it stood. The selection handler flips `image.selected` when the pick is
   * allowed; the render that sees that flip turns the question into `feedback`, a check that swells
   * in for a pick or contracts away for an unpick. A pick the handler refuses - a submitted item, a
   * PIN still to be entered - flips nothing, so nothing is shown; an unanswered question lapses.
   * `feedback` is transient UI and nothing else: the selection itself is only ever `image.selected`.
   */
  const [asked, setAsked] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const [seen, setSeen] = useState({ id: image.id, selected: Boolean(image.selected) });
  if (seen.id !== image.id) {
    // Another photo: whatever was asked or shown belonged to the last one, and goes with it.
    setSeen({ id: image.id, selected: Boolean(image.selected) });
    setAsked(null);
    setFeedback(null);
  } else if (seen.selected !== Boolean(image.selected)) {
    setSeen({ id: image.id, selected: Boolean(image.selected) });
    if (asked && asked.from !== Boolean(image.selected)) {
      setFeedback({ kind: image.selected ? "selected" : "unselected", id: image.id, at: asked.at });
      setAsked(null);
    }
  }
  useEffect(() => {
    if (!asked) return undefined;
    const timer = window.setTimeout(() => setAsked(null), 1500);
    return () => window.clearTimeout(timer);
  }, [asked]);
  // A counter rather than the clock, so two taps in one millisecond still replay the animation.
  const feedbackSeq = useRef(0);
  const askFeedback = () => { feedbackSeq.current += 1; setAsked({ id: image.id, from: Boolean(image.selected), at: feedbackSeq.current }); };
  const isPhone = () => window.matchMedia(PHONE_QUERY).matches;
  function touchStart(event) {
    touchRef.current = event.touches.length === 1 ? { x: event.touches[0].clientX, y: event.touches[0].clientY, at: Date.now() } : null;
  }
  function touchEnd(event) {
    const start = touchRef.current;
    touchRef.current = null;
    if (!start || event.touches.length || !isPhone()) return;
    const point = event.changedTouches[0];
    const gesture = classifyTouch({ dx: point.clientX - start.x, dy: point.clientY - start.y, ms: Date.now() - start.at });
    // Anything but a tap - a swipe, a drift - means the next tap starts a double tap afresh.
    if (gesture !== "tap") lastTapRef.current = null;
    if (gesture === "next" && hasNext) onNext();
    else if (gesture === "prev" && hasPrev) onPrev();
    else if (gesture === "tap") {
      const tap = { at: Date.now(), x: point.clientX, y: point.clientY };
      if (!isDoubleTap(lastTapRef.current, tap)) { lastTapRef.current = tap; return; }
      lastTapRef.current = null;
      // Picks only: not on a photo already picked, not on the placeholder of one still loading, and
      // not while the last pick is still on its way.
      if (image.selected || !source || pickingRef.current) return;
      pickingRef.current = true;
      askFeedback();
      Promise.resolve(onToggleSelect(image)).finally(() => { pickingRef.current = false; });
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white" role="dialog" aria-modal="true" aria-label={`Viewing ${image.fileName}`}>
      <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-slate-100 px-3 sm:h-14 sm:px-4">
        <button type="button" onClick={close} aria-label="Back to gallery" className="grid h-9 w-9 shrink-0 place-items-center rounded-md text-slate-600 hover:bg-slate-100"><ArrowBack style={{ fontSize: 20 }} /></button>
        <p className="min-w-0 truncate text-[11px] text-slate-500 sm:text-xs">{index + 1} of {total} photos ({selectedCount} selected)</p>
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-slate-100 text-xs font-semibold text-slate-700">{selectedCount}</span>
      </header>

      <div className="relative min-h-0 flex-1 bg-slate-50 max-sm:touch-manipulation" onTouchStart={touchStart} onTouchEnd={touchEnd} onTouchCancel={() => { touchRef.current = null; }}>
        {/* Not drawn on a phone at all, so nothing sits over the picture a finger is swiping and tapping. */}
        {hasPrev && <button type="button" onClick={onPrev} aria-label="Previous photo" className="absolute left-2 top-1/2 z-10 hidden h-10 w-10 -translate-y-1/2 place-items-center rounded-full bg-white/70 shadow backdrop-blur-md sm:left-3 sm:grid"><ArrowBack style={{ fontSize: 20 }} /></button>}
        {hasNext && <button type="button" onClick={onNext} aria-label="Next photo" className="absolute right-2 top-1/2 z-10 hidden h-10 w-10 -translate-y-1/2 place-items-center rounded-full bg-white/70 shadow backdrop-blur-md sm:right-3 sm:grid"><ArrowForward style={{ fontSize: 20 }} /></button>}
        {/* Over the photo it was for only - moving on takes it away - and never in the way of a finger. */}
        {feedback?.id === image.id && <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-10 grid place-items-center">
          <span key={feedback.at} onAnimationEnd={(event) => { if (!event.pseudoElement) setFeedback(null); }} className={`relative grid h-16 w-16 place-items-center rounded-full text-white ${feedback.kind === "selected" ? "selection-feedback-in bg-emerald-500/90 shadow-lg" : "selection-feedback-out bg-slate-900/70"}`}>
            <Check style={{ fontSize: 34 }} />
          </span>
        </div>}
        {/* The photo dips by a hair on a pick. No key here: remounting would reload the picture, and the
            class coming and going with each pick is what restarts the dip. */}
        <div className={`flex h-full items-center justify-center p-2 sm:p-4 ${feedback?.kind === "selected" && feedback.id === image.id ? "selection-tap-press" : ""}`}>
          {source
            ? remote
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={source} alt={image.fileName} decoding="async" style={{ maxHeight: "100%", width: "auto", height: "auto" }} className="mx-auto max-h-full w-auto object-contain" />
              : <Image src={source} alt={image.fileName} width={image.width || 1600} height={image.height || 1200} unoptimized style={{ maxHeight: "100%", width: "auto", height: "auto" }} className="mx-auto max-h-full w-auto object-contain" />
            : <div className="h-full w-full max-w-3xl animate-pulse rounded-xl bg-slate-100" />}
        </div>
      </div>

      <footer className="flex h-16 shrink-0 items-center justify-center gap-6 border-t border-slate-100 pb-[env(safe-area-inset-bottom)] sm:h-20 sm:gap-8">
        <button type="button" onClick={onPrev} disabled={!hasPrev} aria-label="Previous" className="grid h-10 w-10 place-items-center rounded-full border border-slate-200 text-slate-500 disabled:opacity-30"><ArrowBack style={{ fontSize: 20 }} /></button>
        <span className="group relative">
          <button
            type="button"
            // The same feedback as a tap on the photo, on a phone; larger screens keep the tick as it was.
            onClick={() => { if (isPhone()) askFeedback(); onToggleSelect(image); }}
            aria-pressed={image.selected}
            aria-label={image.selected ? "Remove from selection" : "Select this photo"}
            className={`grid h-12 w-12 place-items-center rounded-full transition sm:h-14 sm:w-14 ${image.selected ? "bg-emerald-500 text-white" : "border-2 border-slate-300 text-slate-300"}`}
          >
            <Check style={{ fontSize: 28 }} />
          </button>
          {selectedFor.length > 0 && (
            <div role="tooltip" className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 w-max max-w-[70vw] -translate-x-1/2 rounded-md bg-slate-900/90 px-3 py-2 text-center opacity-0 shadow-lg transition group-focus-within:opacity-100 group-hover:opacity-100">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-300">Selected for</p>
              {selectedFor.map((name) => <p key={name} className="mt-0.5 truncate text-xs text-white">{name}</p>)}
            </div>
          )}
        </span>
        <button type="button" onClick={onNext} disabled={!hasNext} aria-label="Next" className="grid h-10 w-10 place-items-center rounded-full border border-slate-200 text-slate-500 disabled:opacity-30"><ArrowForward style={{ fontSize: 20 }} /></button>
      </footer>
    </div>
  );
}
