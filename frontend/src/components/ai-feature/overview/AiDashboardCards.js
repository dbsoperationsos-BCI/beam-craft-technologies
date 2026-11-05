"use client";

import DashboardCard, { CardState } from "@/components/shared/DashboardCard";
import DashboardFigureList from "@/components/shared/DashboardFigureList";
import DashboardMetricCards from "@/components/shared/DashboardMetricCards";
import DashboardProgressList from "@/components/shared/DashboardProgressList";
import StatusChip from "@/components/ai-feature/shared/StatusChip";
import { PROGRESS_COLORS } from "@/lib/progressStatus.mjs";
import { formatBytes, number, periodPhrase, relativeTime } from "@/lib/dashboardRange.mjs";
import { AI_SUMMARY_CARDS, PROCESSING_EMPTY, PROCESSING_NOTE, detectionRows, processedText, sameView } from "@/lib/aiDashboard.mjs";

/**
 * The AI Feature dashboard's cards: the ten headline figures, the processing-progress list and
 * the detection & storage panel — the Image Selection dashboard's three parts, drawn with the
 * same shared pieces, over this module's own figures. Every number is read from the one overview
 * response; the figures are filters on the Recent Events table, never links, and a row of the
 * progress list is the one thing here that opens an event.
 */

/** The ten headline figures, each a filter on the Recent Events table. */
export function AiSummaryCards({ summary, trend, rangeKey, loading, view, onViewChange }) {
  return <DashboardMetricCards cards={AI_SUMMARY_CARDS} summary={summary} trend={trend} rangeKey={rangeKey} loading={loading} view={view} onViewChange={onViewChange} sameView={sameView} />;
}

/**
 * The events the engine is working through right now: the panel of what is happening in the
 * background. The server decides which events are here (something queued or running) and the
 * order; the words here only say what is on screen. Failures are red because they are the one
 * figure that asks for a hand — Retry failed lives inside the event.
 */
export function ProcessingProgressCard({ rows = [], loading, error, onRetry, onOpen, now }) {
  const items = rows.map((row) => ({
    key: row.id, item: row, title: row.name, chip: <StatusChip status={row.status} size="sm" />,
    meta: [
      { text: processedText(row), className: "tabular-nums" },
      { text: `${number(row.processingCount)} in queue`, className: "tabular-nums" },
      row.failedCount > 0 && { text: `${number(row.failedCount)} failed`, className: "tabular-nums text-red-600" },
      { text: relativeTime(row.lastActivityAt, now), className: "text-slate-400" },
    ],
    percent: row.percent, color: PROGRESS_COLORS.inProgress,
  }));
  return <DashboardCard title="AI Processing Progress" note={PROCESSING_NOTE} bodyClassName="p-1.5">
    <CardState loading={loading} error={error} onRetry={onRetry} empty={!rows.length} emptyMessage={PROCESSING_EMPTY} rows={5}>
      <DashboardProgressList rows={items} onOpen={onOpen} />
    </CardState>
  </DashboardCard>;
}

/**
 * What the engine has found and what the store holds — from the rows, never from a bucket
 * listing. Every figure is as of now: a face detected last month is still a face detected, so
 * none of these follow the range; the one line that does — photos uploaded in the period — is the
 * hint under Recent uploads. `scope="event"` draws one event's figures on its Project Dashboard
 * (`GET /events/:id/detection`), the same rows less the studio-only Archived events.
 */
export function DetectionStorageCard({ data, rangeKey, loading, error, onRetry, scope = "studio" }) {
  const rows = detectionRows(data, { scope, rangeKey, formatBytes, number, periodPhrase });
  const note = scope === "event" ? "Everything the engine has found and the store holds for this event, as of now" : "Everything the engine has found and the store holds, as of now";
  return <DashboardCard title="Detection & Storage" note={note} bodyClassName="p-1.5">
    <CardState loading={loading} error={error} onRetry={onRetry} empty={!data} emptyMessage="Detection statistics are unavailable right now." rows={scope === "event" ? 7 : 8}>
      <DashboardFigureList rows={rows} />
    </CardState>
  </DashboardCard>;
}
