"use client";

import ChevronLeftRounded from "@mui/icons-material/ChevronLeftRounded";
import ChevronRightRounded from "@mui/icons-material/ChevronRightRounded";

/**
 * Back and forward through the spreads, in the middle of the footer — between the count of
 * corrections on the left and the ruling on the right.
 *
 * It used to be two arrows floating over the left and right edges of the proof, and only on a wide
 * screen: a phone had the swipe and nothing else, which is no help to anybody reviewing with one
 * hand or with a keyboard. In the footer they are always there, at a size a thumb can hit, next to
 * the position they move — and they no longer sit on top of the photograph being judged.
 *
 * Both proofing rooms use this: paging through an album is the same act whoever is doing it, and
 * two copies of it would be two places for the ends of the album to be handled differently.
 */
export default function ProofSpreadNav({ index, count, onGo, className = "" }) {
  const button = "grid h-8 w-8 place-items-center rounded-full border border-slate-200 text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 disabled:opacity-30 disabled:hover:bg-transparent";
  return (
    <div className={`flex shrink-0 items-center gap-1.5 ${className}`}>
      <button type="button" aria-label="Previous spread" onClick={() => onGo(-1)} disabled={index <= 0} className={button}>
        <ChevronLeftRounded style={{ fontSize: 20 }} />
      </button>
      {/* Where you are, so the arrows are not the only thing telling you the album moved. Shown at
          every width: it hid on the narrowest screens while the bar at the top of the page carried
          the same count, and that bar no longer does — hiding it now would leave a phone paging an
          album with nothing saying where in it you are. */}
      <span className="text-[11px] font-semibold tabular-nums text-slate-500">
        {count ? index + 1 : 0} / {count}
      </span>
      <button type="button" aria-label="Next spread" onClick={() => onGo(1)} disabled={index >= count - 1} className={button}>
        <ChevronRightRounded style={{ fontSize: 20 }} />
      </button>
    </div>
  );
}
