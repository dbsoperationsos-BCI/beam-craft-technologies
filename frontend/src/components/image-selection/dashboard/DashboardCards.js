"use client";

import ArrowForward from "@mui/icons-material/ArrowForward";
import Remove from "@mui/icons-material/Remove";
import TrendingDown from "@mui/icons-material/TrendingDown";
import TrendingUp from "@mui/icons-material/TrendingUp";
import { PROGRESS_CHIP_CLASS, progressChipStyle } from "@/lib/progressStatus.mjs";
import { NEARLY_DONE_EMPTY, NEARLY_DONE_NOTE, SUMMARY_CARDS, formatBytes, formatCompact, periodPhrase, previousLabel, previousPhrase, relativeTime, sameView, selectionText, stageChip, trendOf, unitLabel } from "@/lib/imageSelectionDashboard.mjs";
import DashboardCard, { CardState } from "@/components/shared/DashboardCard";

/**
 * The Image Selection dashboard's cards: the ten headline figures, the client-selection progress
 * list and the storage panel. Every number is read from the one dashboard response.
 *
 * The figures are *filters*, not links. Pressing one narrows the Recent Projects table below to
 * the projects it counted, pressing it again lets go, and the page stays where it is. The only two
 * things on this page that open a project are a double click on a row of that table and a press on
 * a row of the progress list — the reader chose a project, not a category.
 */

const number = (value) => Number(value || 0).toLocaleString("en-IN");

/** A status chip in the product-wide progress palette, sized for a row. */
function StageChip({ stage, className = "" }) {
  const chip = stageChip(stage);
  return <span className={`${PROGRESS_CHIP_CLASS} inline-block shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${className}`} style={progressChipStyle(chip.color)}>{chip.label}</span>;
}

/**
 * How far a selection has come against its limit. A project with no limit gets the words rather
 * than a bar filled against a number it has not got.
 */
export function SelectionProgressBar({ percent, color }) {
  if (percent === null || percent === undefined) return <span className="text-[11px] text-slate-400">No limit</span>;
  const width = Math.min(100, Math.max(0, Number(percent) || 0));
  return <span className="flex items-center gap-2">
    <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-slate-100"><span className="block h-full rounded-full" style={{ width: `${width}%`, backgroundColor: color }} /></span>
    <span className="w-9 shrink-0 text-right text-[11px] tabular-nums text-slate-600">{width}%</span>
  </span>;
}

// The look of a pressed card: what the Recent Projects table is showing.
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
 * arrived, not work done. What the change is measured against is not repeated here; the card says
 * that once, in the corner below. With nothing to compare against — Lifetime, or a response from
 * before trends — there is no mark at all, rather than a zero that would read as "unchanged".
 */
function TrendBadge({ trend, phrase }) {
  if (!trend || !phrase) return null;
  const { direction, text } = trendOf(trend.delta);
  const { Icon, tone } = TREND[direction];
  return <span className={`flex shrink-0 items-center gap-0.5 text-sm font-bold tabular-nums ${tone}`} title={`${number(trend.before)} ${phrase.replace(/^vs /, "at the end of ")}`}>
    <Icon style={{ fontSize: 18 }} aria-hidden="true" />{text}
  </span>;
}

/**
 * The bottom right corner: what the arrow above it is measured against.
 *
 * Two lines, the small grey word over the period itself, so the period is what the eye picks up
 * and the card still reads as one figure rather than as a sentence. Lifetime is measured against
 * nothing, and says so where the period would be.
 */
function ComparedTo({ label }) {
  if (!label) return <span className="shrink-0 text-right text-[10px] leading-3 text-slate-400">as of<br />now</span>;
  return <span className="shrink-0 text-right text-[10px] leading-3 text-slate-400">
    vs<br /><span className="font-semibold text-slate-500">{label}</span>
  </span>;
}

/**
 * The ten headline figures, each a filter on the Recent Projects table.
 *
 * Five to a row from a tablet up, so the ten fill two rows exactly; two to a row on a phone. The labels
 * are allowed a second line rather than cut short, because "Client Sending Not Done" is the whole
 * of what the card means.
 *
 * Each card is read in two glances, which is what its two rows are: the name and which way it has
 * moved, then the figure itself and the period that move is against. The unit is spelled out
 * beside the number — "4 Projects" rather than a bare 4 — and follows the count, so a card showing
 * one does not say "1 Projects".
 */
export function SummaryCards({ summary, trend, rangeKey, loading, view, onViewChange }) {
  const phrase = previousPhrase(rangeKey);
  const label = previousLabel(rangeKey);
  return <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
    {SUMMARY_CARDS.map((card) => {
      const value = summary?.[card.key];
      const unit = unitLabel(value, card.unit);
      // Total Projects is the table unfiltered, so it reads as pressed whenever nothing else is,
      // and pressing it is how any other filter is let go of.
      const pressed = sameView(view, card.view);
      return <button key={card.key} type="button" aria-pressed={pressed} onClick={() => onViewChange(pressed && card.view ? null : card.view)} className={`flex min-w-0 flex-col gap-4 rounded-xl border bg-white px-4 py-4 text-left shadow-md transition hover:border-blue-300 hover:shadow-lg ${pressed ? PRESSED : "border-slate-200"}`}>
        <span className="flex items-start justify-between gap-2">
          <span className="min-w-0 text-[13px] font-medium leading-4 text-slate-600">{card.label}</span>
          {!loading && <TrendBadge trend={trend?.[card.key]} phrase={phrase} />}
        </span>
        <span className="flex items-end justify-between gap-2">
          {loading
            ? <span aria-hidden="true" className="h-7 w-20 animate-pulse rounded bg-slate-100" />
            : <span className="min-w-0 truncate text-2xl font-bold leading-none tabular-nums text-slate-900">
              {card.compact ? formatCompact(value) : number(value)}{unit && <span className="text-sm font-normal text-slate-500"> {unit}</span>}
            </span>}
          {!loading && <ComparedTo label={label} />}
        </span>
      </button>;
    })}
  </div>;
}

/**
 * The clients who are nearly through their selection: the panel of who to chase today.
 *
 * The range picker does not reach this one, and deliberately. A client who stopped at 96% last
 * month is the very person the studio needs to see, and scoping the panel to what moved inside the
 * range is what would hide them. The server decides the band and the order (closest to finishing
 * first); the words here only say what is on screen.
 */
export function SelectionProgressCard({ rows = [], loading, error, onRetry, onOpen, now }) {
  return <DashboardCard title="Client Selection Progress" note={NEARLY_DONE_NOTE} bodyClassName="p-1.5">
    <CardState loading={loading} error={error} onRetry={onRetry} empty={!rows.length} emptyMessage={NEARLY_DONE_EMPTY} rows={5}>
      <ul className="divide-y divide-slate-100">
        {rows.map((row) => {
          const { color } = stageChip(row.stage);
          return <li key={row.id}>
            <button type="button" onClick={() => onOpen(row)} className="flex w-full items-start gap-3 rounded-md px-2 py-2 text-left hover:bg-slate-50">
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-xs font-medium text-slate-800">{row.projectName}</span>
                  <StageChip stage={row.stage} className="!px-1.5 !text-[9px]" />
                </span>
                <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-slate-500">
                  {row.clientName && <span className="max-w-[12rem] truncate">{row.clientName}</span>}
                  <span className="tabular-nums">{selectionText(row)}</span>
                  <span className="text-slate-400">{relativeTime(row.lastClientActivityAt || row.lastActivityAt, now)}</span>
                </span>
                <span className="mt-1.5 block"><SelectionProgressBar percent={row.percent} color={color} /></span>
              </span>
              <ArrowForward aria-hidden="true" style={{ fontSize: 16 }} className="mt-0.5 shrink-0 text-slate-300" />
            </button>
          </li>;
        })}
      </ul>
    </CardState>
  </DashboardCard>;
}

/**
 * What the photo store holds — from the rows, never from a folder scan or a bucket listing.
 *
 * The four countable rows follow the range: the figure is what the range put into the store, and
 * the grey line beneath it is what the store holds altogether. The last three are states rather
 * than quantities — what is processing, what failed, what the queue is doing — so they are always
 * as of now and say so.
 */
export function StorageCard({ storage, rangeKey, loading, error, onRetry }) {
  const queue = storage?.queue;
  const added = storage?.added;
  const phrase = periodPhrase(rangeKey);
  // Lifetime's "added" is the whole store, so repeating the total under it would say it twice.
  const total = (text) => (rangeKey === "lifetime" ? null : text);
  const rows = storage ? [
    ["Photos added", number(added ? added.photos : storage.totalPhotos), total(`${number(storage.totalPhotos)} in the store · ${number(storage.readyPhotos)} ready in galleries`) || `${number(storage.readyPhotos)} ready in galleries`],
    ["Originals on local / NAS", number(added ? added.registeredOriginals : storage.registeredOriginals), total(`${number(storage.registeredOriginals)} in the store`) || (storage.serverOriginals ? `${number(storage.serverOriginals)} older browser uploads on the server` : "tracked by path, never copied")],
    ["Original size", formatBytes(added ? added.originalBytes : storage.originalBytes), total(`${formatBytes(storage.originalBytes)} in the store`) || "from photo records"],
    ["Cloudflare R2", `${number(added ? added.r2Objects : storage.r2Objects)} previews`, total(`${number(storage.r2Objects)} in the bucket · ${formatBytes(storage.r2PreviewBytes)}`) || `${formatBytes(storage.r2PreviewBytes)} of previews · thumbnail sizes not tracked`],
    ["Processing", number(storage.processingPhotos), storage.activeBatches ? `${number(storage.activeBatches)} active upload batch${storage.activeBatches === 1 ? "" : "es"}` : "as of now · no active upload batches"],
    ["Failed processing", number(storage.failedPhotos), storage.failedPhotos ? "retry from the upload dock" : "as of now · none", storage.failedPhotos ? "text-red-600" : ""],
    ["Processing queue", queue?.available ? `${number(queue.waiting)} waiting · ${number(queue.active)} active` : "Unavailable", queue?.available ? `as of now · ${number(queue.failed)} failed, ${number(queue.delayed)} retrying` : "Redis not reachable", queue?.available ? "" : "text-red-600"],
  ] : [];
  return <DashboardCard title="Storage & Processing" note={rangeKey === "lifetime" ? "Everything the store holds, from photo records" : `Added ${phrase}; the store's own totals beneath`} bodyClassName="p-1.5">
    <CardState loading={loading} error={error} onRetry={onRetry} empty={!storage} emptyMessage="Storage statistics are unavailable right now." rows={7}>
      <dl className="divide-y divide-slate-100">
        {rows.map(([label, value, hint, tone = ""]) => <div key={label} className="flex items-baseline justify-between gap-3 px-2 py-1.5">
          <dt className="text-xs text-slate-600">{label}</dt>
          <dd className="min-w-0 text-right">
            <span className={`text-xs font-semibold tabular-nums ${tone || "text-slate-800"}`}>{value}</span>
            {hint && <span className="block text-[10px] text-slate-400">{hint}</span>}
          </dd>
        </div>)}
      </dl>
    </CardState>
  </DashboardCard>;
}

export { StageChip };
