"use client";

import Remove from "@mui/icons-material/Remove";
import TrendingDown from "@mui/icons-material/TrendingDown";
import TrendingUp from "@mui/icons-material/TrendingUp";
import { trendOf } from "@/lib/trend.mjs";

/**
 * One headline figure on a dashboard, read in two glances: the name and which way it has moved,
 * then the figure itself and the period that move is against.
 *
 * Lifted out of the Image Selection dashboard, where it was drawn first, so the administrator's
 * attendance Dashboard is the same card rather than a copy of it that drifts the first time one of
 * them is adjusted. Neither dashboard's look changed in the move.
 *
 * `onClick` makes the card a filter on whatever table sits under it: it renders a `<button>`
 * carrying `aria-pressed`, so a screen reader hears a control and whether it is on. Without it the
 * card is a plain figure.
 */

const number = (value) => Number(value || 0).toLocaleString("en-IN");

// The look of a pressed card: what the table under the cards is showing.
const PRESSED = "border-blue-400 ring-2 ring-blue-100";

const TREND = {
  up: { Icon: TrendingUp, tone: "text-green-600" },
  down: { Icon: TrendingDown, tone: "text-red-600" },
  // Orange, not grey: "nothing has changed here" is a finding, and in a row of arrows it is the
  // one that would otherwise be read past. The mark is a plain rule rather than an arrow, because
  // an arrow pointing anywhere still reads as a direction at a glance.
  flat: { Icon: Remove, tone: "text-orange-500" },
};

/** A trend's arrow, its colour and the signed number - for a mark drawn without the badge. */
export function trendLook(trend) {
  const { direction, text } = trendOf(trend?.delta);
  return { ...TREND[direction], text };
}

/**
 * The change, in the top right corner of a card: the arrow and the signed number, nothing else.
 *
 * Up is green and down is red as a *direction*, not a verdict - more absences is a rise and reads
 * green, the same way more Yet to Download does on Image Selection. What the change is measured
 * against is not repeated here; the card says that once, in the corner below. With nothing to
 * compare against there is no mark at all, rather than a zero that would read as "unchanged".
 */
export function TrendBadge({ trend, phrase, title, higherIsWorse = false, compact = false }) {
  if (!trend || !phrase) return null;
  const { direction, text } = trendOf(trend.delta);
  const { Icon } = TREND[direction];
  /*
   * `higherIsWorse` swaps the two colours for a figure where a rise is bad news - absences, late
   * days. There a green "+12 Absent" reads as good at a glance, which is the one reading an
   * administrator scanning the arrows must not come away with. The arrow still points the way the
   * figure moved; only the colour says which way is welcome.
   */
  const tone = higherIsWorse && direction !== "flat"
    ? TREND[direction === "up" ? "down" : "up"].tone
    : TREND[direction].tone;
  /*
   * The hover says what the figure was before. Image Selection's figures are positions, so theirs
   * reads "4 at the end of last week"; a caller whose figures are totals over a period passes its
   * own `title`, since a total is not "at the end of" anything.
   */
  return <span className={`flex shrink-0 items-center gap-0.5 font-bold tabular-nums ${compact ? "text-xs" : "text-sm"} ${tone}`} title={title ?? `${number(trend.before)} ${phrase.replace(/^vs /, "at the end of ")}`}>
    <Icon style={{ fontSize: compact ? 14 : 18 }} aria-hidden="true" />{text}
  </span>;
}

/**
 * The bottom right corner: what the arrow above it is measured against.
 *
 * Two lines, the small grey word over the period itself, so the period is what the eye picks up
 * and the card still reads as one figure rather than as a sentence. With no period to measure
 * against, it says so where the period would be.
 */
export function ComparedTo({ label }) {
  if (!label) return <span className="shrink-0 text-right text-[10px] leading-3 text-slate-400">as of<br />now</span>;
  return <span className="shrink-0 text-right text-[10px] leading-3 text-slate-400">
    vs<br /><span className="font-semibold text-slate-500">{label}</span>
  </span>;
}

export default function SummaryCard({ label, value, unit, trend, phrase, trendTitle, higherIsWorse = false, compareLabel, loading = false, pressed = false, onClick }) {
  const body = <>
    <span className="flex items-start justify-between gap-2">
      <span className="min-w-0 text-[13px] font-medium leading-4 text-slate-600">{label}</span>
      {!loading && <TrendBadge trend={trend} phrase={phrase} title={trendTitle} higherIsWorse={higherIsWorse} />}
    </span>
    <span className="flex items-end justify-between gap-2">
      {loading
        ? <span aria-hidden="true" className="h-7 w-20 animate-pulse rounded bg-slate-100" />
        : <span className="min-w-0 truncate text-2xl font-bold leading-none tabular-nums text-slate-900">
          {value}{unit && <span className="text-sm font-normal text-slate-500"> {unit}</span>}
        </span>}
      {!loading && <ComparedTo label={compareLabel} />}
    </span>
  </>;
  const shell = "flex min-w-0 flex-col gap-4 rounded-xl border bg-white px-4 py-4 text-left shadow-md";

  if (!onClick) return <div className={`${shell} border-slate-200`}>{body}</div>;

  return <button type="button" aria-pressed={pressed} onClick={onClick} className={`${shell} transition hover:border-blue-300 hover:shadow-lg ${pressed ? PRESSED : "border-slate-200"}`}>
    {body}
  </button>;
}
