"use client";

import DashboardCard, { CardState } from "@/components/shared/DashboardCard";
import DashboardFigureList from "@/components/shared/DashboardFigureList";
import DashboardMetricCards from "@/components/shared/DashboardMetricCards";
import DashboardProgressList from "@/components/shared/DashboardProgressList";
import ProofingStatusChip from "@/components/image-selection/album-proofing/ProofingStatusChip";
import { PROGRESS_COLORS } from "@/lib/progressStatus.mjs";
import { number, relativeTime } from "@/lib/dashboardRange.mjs";
import { ALBUM_SUMMARY_CARDS, CORRECTIONS_EMPTY, CORRECTIONS_NOTE, resolvedText, sameView, versionText } from "@/lib/albumProofingDashboard.mjs";

/**
 * The Album Proofing dashboard's cards: the ten headline figures, the correction-work list and
 * the proofing & link panel — the Image Selection dashboard's three parts, drawn with the same
 * shared pieces, over this module's own figures. Every number is read from the one dashboard
 * response; the figures are filters on the Recent Albums table, never links, and a row of the
 * correction list is the one thing here that opens an album.
 */

/** The ten headline figures, each a filter on the Recent Albums table. */
export function AlbumSummaryCards({ summary, trend, rangeKey, loading, view, onViewChange }) {
  return <DashboardMetricCards cards={ALBUM_SUMMARY_CARDS} summary={summary} trend={trend} rangeKey={rangeKey} loading={loading} view={view} onViewChange={onViewChange} sameView={sameView} />;
}

const correctionColor = (row) => (row.readyForRevisedVersion ? PROGRESS_COLORS.completed : row.correctionResolved > 0 ? PROGRESS_COLORS.partiallyCompleted : PROGRESS_COLORS.notStarted);

/**
 * The albums in a correction round — QC's or the client's — and how far each has come: the panel
 * of what the designer has to fix today. The server decides which albums are here and whether
 * the revised upload is unlocked (the same gate the workspace's button reads); the words here
 * only say what is on screen.
 */
export function CorrectionWorkCard({ rows = [], loading, error, onRetry, onOpen, now }) {
  const items = rows.map((row) => ({
    key: row.id, item: row, title: row.name, chip: <ProofingStatusChip status={row.status} />,
    meta: [
      row.projectName && { text: row.projectName, className: "max-w-[12rem] truncate" },
      { text: versionText(row), className: "tabular-nums" },
      { text: resolvedText(row), className: "tabular-nums" },
      row.readyForRevisedVersion && { text: "ready for revised upload", className: "font-medium text-emerald-700" },
      { text: relativeTime(row.lastActivityAt, now), className: "text-slate-400" },
    ],
    percent: row.correctionPercent, color: correctionColor(row), emptyText: "No corrections raised",
  }));
  return <DashboardCard title="QC & Correction Progress" note={CORRECTIONS_NOTE} bodyClassName="p-1.5">
    <CardState loading={loading} error={error} onRetry={onRetry} empty={!rows.length} emptyMessage={CORRECTIONS_EMPTY} rows={5}>
      <DashboardProgressList rows={items} onOpen={onOpen} />
    </CardState>
  </DashboardCard>;
}

/**
 * The client side of proofing and the state of every link — from the rows, as of now. A link
 * that stops within ten days is amber because it asks for a hand (extend it from the
 * publication card); an expired one is red because the client can no longer open it.
 */
export function ProofingLinkCard({ data, loading, error, onRetry }) {
  const links = data?.links; const corrections = data?.corrections; const processing = data?.processing;
  const inReview = links?.inClientReview || [];
  const rows = data ? [
    ["Active client links", number(links?.active), "open to the client, more than ten days left"],
    ["Expiring soon", number(links?.expiringSoon), links?.expiringSoon ? "stop within ten days · extend from the publication card" : "as of now · none", links?.expiringSoon ? "text-amber-700" : ""],
    ["Expired", number(links?.expired), links?.expired ? "the client can no longer open these" : "as of now · none", links?.expired ? "text-red-600" : ""],
    ["Revoked", number(links?.revoked), "withdrawn by the studio"],
    ["In client review", number(inReview.length), inReview.length ? inReview.slice(0, 4).map((album) => `${album.name}${album.versionNumber ? ` · V${album.versionNumber}` : ""}`).join(", ") + (inReview.length > 4 ? ` +${inReview.length - 4} more` : "") : "no album is with a client right now"],
    ["Client approved", number(data?.clientApproved), data?.clientApproved ? "waiting to be completed and downloaded" : "as of now · none"],
    ["Open corrections", number((corrections?.open || 0) + (corrections?.inProgress || 0) + (corrections?.reopened || 0)), `${number(corrections?.open)} open · ${number(corrections?.inProgress)} in progress · ${number(corrections?.reopened)} reopened`],
    ["Processing", number(processing?.processing), processing?.failed ? `${number(processing.failed)} failed · retry from the album` : "as of now · nothing failed", processing?.failed ? "text-red-600" : ""],
    ["Archived", number(data?.archived), "kept, out of the way"],
  ] : [];
  return <DashboardCard title="Proofing & Link Status" note="Every client link and where the client side stands, as of now" bodyClassName="p-1.5">
    <CardState loading={loading} error={error} onRetry={onRetry} empty={!data} emptyMessage="Link statistics are unavailable right now." rows={8}>
      <DashboardFigureList rows={rows} />
    </CardState>
  </DashboardCard>;
}
