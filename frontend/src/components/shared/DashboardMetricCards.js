"use client";

import Remove from "@mui/icons-material/Remove";
import TrendingDown from "@mui/icons-material/TrendingDown";
import TrendingUp from "@mui/icons-material/TrendingUp";
import { formatCompact, number, previousLabel, previousPhrase, trendOf, unitLabel } from "@/lib/dashboardRange.mjs";

/**
 * The headline figures of a module dashboard — Image Selection's ten, the AI Feature's, Album
 * Proofing's — drawn once so the three read as one product: the same card, the same arrow in the
 * same corner, the same "vs Last Month" beneath the figure.
 *
 * The figures are *filters*, not links. Pressing one narrows the table below it to the rows it
 * counted, pressing it again lets go, and the page stays where it is. Each card is read in two
 * glances, which is what its two rows are: the name and which way it has moved, then the figure
 * itself and the period that move is against. The unit is spelled out beside the number — "4
 * Projects" rather than a bare 4 — and follows the count, so a card showing one never says
 * "1 Projects".
 *
 * `cards` is the module's own list: `{ key, label, unit, view, compact?, static? }`, where `key`
 * names the figure in `summary` (and in `trend`), `unit` is a singular word or a `[singular,
 * plural]` pair, and `view` is what the table narrows to when the card is pressed (`null` for
 * everything). A `static` card is a figure to read rather than a filter — a photo total counted
 * across every event narrows no table of events — so it is drawn as a card and not as a button,
 * and never reads as pressed. `sameView` says whether two views mean the same thing, because each
 * module shapes its own.
 *
 * `gridClassName` is how many to a row; the default fits ten in two rows of five, and a page with
 * twelve (Expand) passes six.
 */

const CARD = "flex min-w-0 flex-col gap-4 rounded-xl border bg-white px-4 py-4 text-left shadow-md";
// The look of a pressed card: what the table below is showing.
const PRESSED = "border-blue-400 ring-2 ring-blue-100";

const TREND = {
  up: { Icon: TrendingUp, tone: "text-green-600" },
  down: { Icon: TrendingDown, tone: "text-red-600" },
  // Orange, not grey: "nothing has changed here" is a finding, and in a row of arrows it is the
  // one that would otherwise be read past. The mark is a plain rule rather than an arrow, because
  // an arrow pointing anywhere still reads as a direction at a glance.
  flat: { Icon: Remove, tone: "text-orange-500" },
};

/**
 * The change, in the top right corner of a card: the arrow and the signed number, nothing else.
 *
 * Up is green and down is red as a *direction*, not a verdict — more Yet to Download is work
 * arrived, not work done. With nothing to compare against — Lifetime, a figure whose past no row
 * carries a stamp for, or a response from before trends — there is no mark at all, rather than a
 * zero that would read as "unchanged".
 */
export function TrendBadge({ trend, phrase }) {
  if (!trend || !phrase) return null;
  const { direction, text } = trendOf(trend.delta);
  const { Icon, tone } = TREND[direction];
  const from = `${number(trend.before)} ${phrase.replace(/^vs /, "at the end of ")}`;
  return <span className={`flex shrink-0 items-center gap-0.5 text-sm font-bold tabular-nums ${tone}`} title={from}>
    <Icon style={{ fontSize: 18 }} aria-hidden="true" />{text}<span className="sr-only">, {from}</span>
  </span>;
}

/**
 * The bottom right corner: what the arrow above it is measured against. Two lines, the small grey
 * word over the period itself. Lifetime is measured against nothing, and says so.
 */
export function ComparedTo({ label }) {
  if (!label) return <span className="shrink-0 text-right text-[10px] leading-3 text-slate-400">as of<br />now</span>;
  return <span className="shrink-0 text-right text-[10px] leading-3 text-slate-400">
    vs<br /><span className="font-semibold text-slate-500">{label}</span>
  </span>;
}

const sameByIdentity = (first, second) => (first || null) === (second || null);

/**
 * The card grid. Five to a row from a tablet up, so ten fill two rows exactly; two to a row on a
 * phone. Labels are allowed a second line rather than cut short.
 */
export default function DashboardMetricCards({ cards, summary, trend, rangeKey, loading, view, onViewChange, sameView = sameByIdentity, format = number, gridClassName = "grid-cols-2 sm:grid-cols-3 md:grid-cols-5" }) {
  const phrase = previousPhrase(rangeKey);
  const label = previousLabel(rangeKey);
  return <div className={`grid gap-3 ${gridClassName}`} aria-busy={loading || undefined}>
    {cards.map((card) => {
      const value = summary?.[card.key];
      const unit = unitLabel(value, card.unit);
      // The total card is the table unfiltered, so it reads as pressed whenever nothing else is,
      // and pressing it is how any other filter is let go of.
      const pressed = !card.static && sameView(view, card.view);
      const body = <>
        <span className="flex items-start justify-between gap-2">
          <span className="min-w-0 text-[13px] font-medium leading-4 text-slate-600">{card.label}</span>
          {!loading && <TrendBadge trend={trend?.[card.key]} phrase={phrase} />}
        </span>
        <span className="flex items-end justify-between gap-2">
          {loading
            ? <span aria-hidden="true" className="h-7 w-20 animate-pulse rounded bg-slate-100" />
            : <span className="min-w-0 truncate text-2xl font-bold leading-none tabular-nums text-slate-900">
              {card.compact ? formatCompact(value) : format(value)}{unit && <span className="text-sm font-normal text-slate-500"> {unit}</span>}
            </span>}
          {!loading && <ComparedTo label={label} />}
        </span>
      </>;
      if (card.static) return <div key={card.key} className={`${CARD} border-slate-200`}>{body}</div>;
      return <button key={card.key} type="button" aria-pressed={pressed} onClick={() => onViewChange(pressed && card.view ? null : card.view)} className={`${CARD} transition hover:border-blue-300 hover:shadow-lg ${pressed ? PRESSED : "border-slate-200"}`}>{body}</button>;
    })}
  </div>;
}
