"use client";

import { PROGRESS_CHIP_CLASS, progressChipStyle } from "@/lib/progressStatus.mjs";
import { EXPAND_CARDS, NEARLY_DONE_EMPTY, NEARLY_DONE_NOTE, SUMMARY_CARDS, expandCounts, expandTrend, formatBytes, periodPhrase, relativeTime, sameView, selectionText, stageChip } from "@/lib/imageSelectionDashboard.mjs";
import DashboardCard, { CardState } from "@/components/shared/DashboardCard";
import DashboardFigureList from "@/components/shared/DashboardFigureList";
import DashboardMetricCards from "@/components/shared/DashboardMetricCards";
import DashboardProgressBar from "@/components/shared/DashboardProgressBar";
import DashboardProgressList from "@/components/shared/DashboardProgressList";

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
 * How far a selection has come against its limit — the shared bar, with the words a project with
 * no limit gets rather than a bar filled against a number it has not got.
 */
export function SelectionProgressBar({ percent, color }) {
  return <DashboardProgressBar percent={percent} color={color} emptyText="No limit" />;
}

/**
 * The ten headline figures, each a filter on the Recent Projects table — the shared metric cards
 * over this module's own list, so the card is the one every Visual Curation dashboard draws.
 */
/**
 * Expand's twelve cards in one grid, six to a row: Enabled and Disabled first - every project by its
 * switch now, with the arrow against the start of the range (`expandTrend`) - then the ten summary
 * cards, over the enabled projects and the range picked. All press the same way, each narrowing the
 * table to what it counts.
 */
export const EXPAND_GRID = "grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6";
export function ExpandCards({ rows, summary, trend, comparedAt, rangeKey, loading, view, onViewChange }) {
  return <DashboardMetricCards cards={[...EXPAND_CARDS, ...SUMMARY_CARDS]} summary={{ ...summary, ...expandCounts(rows) }} trend={trend && { ...trend, ...expandTrend(rows, comparedAt) }} rangeKey={rangeKey} loading={loading} view={view} onViewChange={onViewChange} sameView={sameView} gridClassName={EXPAND_GRID} />;
}

export function SummaryCards({ summary, trend, rangeKey, loading, view, onViewChange }) {
  return <DashboardMetricCards cards={SUMMARY_CARDS} summary={summary} trend={trend} rangeKey={rangeKey} loading={loading} view={view} onViewChange={onViewChange} sameView={sameView} />;
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
  const items = rows.map((row) => ({
    key: row.id, item: row, title: row.projectName, chip: <StageChip stage={row.stage} className="!px-1.5 !text-[9px]" />,
    meta: [
      row.clientName && { text: row.clientName, className: "max-w-[12rem] truncate" },
      { text: selectionText(row), className: "tabular-nums" },
      { text: relativeTime(row.lastClientActivityAt || row.lastActivityAt, now), className: "text-slate-400" },
    ],
    percent: row.percent, color: stageChip(row.stage).color, emptyText: "No limit",
  }));
  return <DashboardCard title="Client Selection Progress" note={NEARLY_DONE_NOTE} bodyClassName="p-1.5">
    <CardState loading={loading} error={error} onRetry={onRetry} empty={!rows.length} emptyMessage={NEARLY_DONE_EMPTY} rows={5}>
      <DashboardProgressList rows={items} onOpen={onOpen} />
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
      <DashboardFigureList rows={rows} />
    </CardState>
  </DashboardCard>;
}

export { StageChip };
