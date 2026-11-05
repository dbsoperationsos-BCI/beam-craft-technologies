"use client";

import Button from "@/components/shared/Button";
import { statusPresentation, formatShortDate } from "@/lib/signatureAlbum.mjs";

const TONES = { slate: "bg-slate-100 text-slate-700", amber: "bg-amber-50 text-amber-700", emerald: "bg-emerald-50 text-emerald-700", red: "bg-red-50 text-red-700" };
export function StatusChip({ status, className = "" }) {
  const presentation = statusPresentation(status);
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${TONES[presentation.tone]} ${className}`}>{presentation.label}</span>;
}

/**
 * Where the album stands and what keeps it from going out. Publishing is refused - and says why -
 * while anything on the list is missing; nothing is published quietly.
 */
export default function PublishPanel({ album, canWrite, busy, onPublish, onUnpublish, compact = false }) {
  const published = album.status === "PUBLISHED";
  return <div className={compact ? "" : "rounded-xl border border-slate-200 bg-white p-4 sm:p-5"}>
    <div className="flex items-center justify-between gap-2">
      <div><p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Album Status</p><div className="mt-1 flex items-center gap-2"><StatusChip status={album.status} />{published && album.publishedAt && <span className="text-[10px] text-slate-500">since {formatShortDate(album.publishedAt)}</span>}</div></div>
      {canWrite && (published
        ? <Button type="button" size="sm" busy={busy} busyLabel="Unpublishing..." onClick={onUnpublish}>Unpublish</Button>
        : <Button type="button" size="sm" variant="primary" busy={busy} busyLabel="Publishing..." onClick={onPublish} disabled={album.problems.length > 0}>Publish</Button>)}
    </div>
    {album.problems.length > 0 && <ul className="mt-3 space-y-1 rounded-md bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
      <li className="font-semibold">Album cannot be published yet.</li>
      {album.problems.map((problem) => <li key={problem.code}>• {problem.message}</li>)}
    </ul>}
    {album.status === "EXPIRED" && <p className="mt-2 text-[11px] text-red-700">The link has expired. Choose a later expiry date under Client Access, then publish again.</p>}
  </div>;
}
