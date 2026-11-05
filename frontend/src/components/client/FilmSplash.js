"use client";

import { useEffect, useRef } from "react";
import ClientBackdrop from "./ClientBackdrop";

// The opening's beats, in milliseconds from its start: the roll rests a moment where the page's
// track starts, unrolls along it, and the dark lifts off the page as it finishes.
const AT_REST = 300;
const UNROLLED = 2000;
const LIFT_FROM = 1600;
const TOTAL = 2300;
// The roll, seen from above, is a little wider than the film is tall, and thins as the film comes
// off it to this much of its width by the time it is spent.
const ROLL_WIDTH = 1.15;
const SPENT = 0.5;
// One easing for the roll and the film it lays, so the film's edge stays under the roll.
const UNROLL_EASING = "cubic-bezier(0.45, 0, 0.25, 1)";
const MODIFIERS = new Set(["Shift", "Control", "Alt", "Meta"]);

/**
 * The client sign-in's opening: the film starts rolled up, and unrolls into its place on the page.
 *
 * Over a dark screen in the studio's colours, a roll of film - seen from above, a cylinder lying
 * across the track, its sprocket holes turning as it goes - rests, rolled up, exactly where the
 * sign-in page's own strip starts, and rolls along that strip's track, on its tilt, laying the film
 * out behind it.
 * The frames develop as they are uncovered and the roll thins as the film comes off it, until it is
 * spent past the strip's end; then the dark lifts off the page around the strip and the page's own
 * strip, in exactly that place, drifts on from that frame. About two and a quarter seconds.
 *
 * `children` is the strip itself - the same reel the page shows, so the two are the same film. The
 * track is the page's strip as it is, read from the page (`targetRef`): its middle, its untilted
 * width, its tilt - and read again whenever the page scrolls under the opening, which a browser
 * bringing a focused field into view can do.
 *
 * For the eye only (`aria-hidden`): a screen reader has the page beneath. A key ends it at once,
 * and a device asking for less motion never sees it - CSS hides it before any script runs, and the
 * script hands straight over. `onDone` is called exactly once, however it ends.
 */
export default function FilmSplash({ targetRef, onDone, children }) {
  const groundRef = useRef(null);
  const trackRef = useRef(null);
  const stripRef = useRef(null);
  const rollRef = useRef(null);
  const finishRef = useRef(() => {});

  useEffect(() => {
    let finished = false;
    let animations = [];
    // Handing over leaves everything where it stands: the overlay goes as a whole on the next
    // render, and cancelling first would show the film fully laid and the roll back at the start.
    const finish = () => {
      if (finished) return;
      finished = true;
      onDone();
    };
    finishRef.current = finish;

    const target = targetRef.current;
    const track = trackRef.current;
    const strip = stripRef.current;
    const roll = rollRef.current;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce || !target || !track || !strip || !roll || typeof strip.animate !== "function") {
      finish();
      return undefined;
    }

    // Lay the track exactly over the page's strip: its middle (a tilt does not move it), its
    // untilted width and its height; the tilt is the page's own (-2deg, about the middle).
    const pin = () => {
      const box = target.getBoundingClientRect();
      const width = target.offsetWidth;
      const height = target.offsetHeight;
      track.style.width = `${width}px`;
      track.style.height = `${height}px`;
      track.style.left = `${box.left + box.width / 2 - width / 2}px`;
      track.style.top = `${box.top + box.height / 2 - height / 2}px`;
      return { width, height };
    };
    let frame = 0;
    const repin = () => { if (!frame) frame = window.requestAnimationFrame(() => { frame = 0; pin(); }); };
    window.addEventListener("scroll", repin, { passive: true });
    window.addEventListener("resize", repin);

    // Never left standing over the form: a browser holding the animation back (a tab in the
    // background) still hands over a moment after the opening should have ended.
    const safety = window.setTimeout(finish, TOTAL + 1000);

    const raf = window.requestAnimationFrame(() => {
      const { width, height } = pin();
      const size = Math.round(height * ROLL_WIDTH);
      roll.style.width = `${size}px`;
      // The roll's middle, from the track's start to just past its end; the film is laid up to it.
      const from = size / 2;
      const to = width + (size * SPENT) / 2;
      const laidTo = (x) => `inset(0px ${width - x}px 0px 0px)`;
      const rollAt = (x, thin) => `translateX(${x - size / 2}px) scaleX(${thin})`;
      const atRest = AT_REST / UNROLLED;

      const unroll = strip.animate([
        { clipPath: laidTo(from) },
        { clipPath: laidTo(from), offset: atRest, easing: UNROLL_EASING },
        { clipPath: laidTo(to) },
      ], { duration: UNROLLED, fill: "forwards" });
      animations = [
        unroll,
        roll.animate([
          // Already there, rolled up, where the track starts - nothing brings it in.
          { opacity: 1, transform: rollAt(from, 1) },
          { opacity: 1, transform: rollAt(from, 1), offset: atRest, easing: UNROLL_EASING },
          { opacity: 1, transform: rollAt(to, SPENT), offset: 0.94 },
          { opacity: 0, transform: rollAt(to, SPENT) },
        ], { duration: UNROLLED, fill: "forwards" }),
        // The roll's own surface - its sprocket holes - turning as it rolls: the top of a rolling
        // roll runs forward, as far as the roll travels.
        ...[...roll.querySelectorAll("[data-turning]")].map((row) => row.animate([
          { backgroundPositionX: "8px" },
          { backgroundPositionX: "8px", offset: atRest, easing: UNROLL_EASING },
          { backgroundPositionX: `${8 + Math.round(to - from)}px` },
        ], { duration: UNROLLED, fill: "forwards" })),
        groundRef.current.animate([
          { opacity: 1 },
          { opacity: 1, offset: LIFT_FROM / TOTAL },
          { opacity: 0 },
        ], { duration: TOTAL, fill: "forwards", easing: "ease-in" }),
      ];
      animations.at(-1).onfinish = finish;
    });

    return () => {
      window.clearTimeout(safety);
      window.cancelAnimationFrame(raf);
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", repin);
      window.removeEventListener("resize", repin);
      animations.forEach((animation) => animation.cancel());
    };
    // Once, as the page opens: the page beneath is laid out by then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /*
   * A key ends it at once. Only a key somebody pressed: a browser filling in a saved login sends a
   * keydown of its own, with no key named, which would cut the opening short as it starts, and a
   * modifier held on its own is not a press of anything.
   */
  useEffect(() => {
    const onKey = (event) => { if (event.key && !MODIFIERS.has(event.key)) finishRef.current(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return <div aria-hidden="true" className="fixed inset-0 z-50 overflow-hidden motion-reduce:hidden">
    {/* The same ground as the page's panel, so the film is laid on what the page shows. */}
    <div ref={groundRef} className="absolute inset-0"><ClientBackdrop /></div>
    {/* The page's track: placed and tilted exactly as the page's strip is. */}
    <div ref={trackRef} className="absolute left-0 top-0 -rotate-2">
      <div ref={stripRef} className="h-full overflow-hidden [clip-path:inset(0px_100%_0px_0px)]">
        <div className="w-max">{children}</div>
      </div>
      {/*
        The roll, seen from above: the film's own width, lying across the track, its outer turn
        showing its sprocket holes, shaded round like a cylinder, with a soft shadow where it sits.
      */}
      <div ref={rollRef} className="absolute inset-y-0 left-0 opacity-0">
        <div className="absolute inset-0 flex flex-col justify-between overflow-hidden rounded-[4px] bg-[var(--client-film)] shadow-[0_12px_22px_-8px_rgba(0,0,0,0.75)]">
          <div data-turning className="film-sprockets h-3" />
          <div data-turning className="film-sprockets h-3" />
        </div>
        <div className="absolute inset-0 rounded-[4px] bg-[linear-gradient(90deg,rgba(0,0,0,0.6)_0%,rgba(0,0,0,0.15)_22%,rgba(255,255,255,0.16)_46%,rgba(255,255,255,0.05)_60%,rgba(0,0,0,0.25)_80%,rgba(0,0,0,0.65)_100%)]" />
      </div>
    </div>
  </div>;
}
