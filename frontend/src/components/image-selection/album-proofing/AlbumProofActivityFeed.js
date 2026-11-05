"use client";

import { useCallback, useEffect, useState } from "react";
import { listAlbumProofActivity } from "@/services/image-selection/album-proofs.service";

const EVENT_LABELS = {
  ALBUM_CREATED: "Album created", ALBUM_EDITED: "Album settings changed", ALBUM_ARCHIVED: "Album archived",
  ALBUM_RESTORED: "Album restored", ALBUM_DELETED: "Album deleted",
  FOLDER_CREATED: "Folder created", FOLDER_RENAMED: "Folder renamed", FOLDER_DELETED: "Folder deleted",
  PAGES_IMPORTED: "Pages imported", PROCESSING_STARTED: "Processing started", PROCESSING_COMPLETED: "Processing completed",
  PROCESSING_FAILED: "Processing failed", PROCESSING_RETRIED: "Failed pages retried",
  VERSION_CREATED: "Version created", VERSION_FROZEN: "Version frozen",
  SENT_TO_QC: "Sent to QC Lead", QC_CORRECTION_ADDED: "QC correction added", QC_CORRECTION_EDITED: "QC correction edited", QC_CORRECTION_REMOVED: "QC correction removed", QC_CHANGES_REQUESTED: "QC requested corrections",
  QC_APPROVED: "QC approved", CORRECTION_STARTED: "Correction started", CORRECTION_RESOLVED: "Correction resolved",
  CORRECTION_REOPENED: "Correction reopened", RESUBMITTED_TO_QC: "Resubmitted to QC",
  PUBLISHED_TO_CLIENT: "Sent to client", CLIENT_OPENED: "Client opened the proof", CLIENT_PIN_VERIFIED: "Client PIN verified",
  CLIENT_CORRECTION_ADDED: "Client correction added", CLIENT_CORRECTIONS_SUBMITTED: "Client submitted corrections",
  CLIENT_APPROVED: "Client approved the album", REVISION_CREATED: "Revision created", REVISION_GRANTED: "Extra revision granted",
  ALBUM_COMPLETED: "Album completed", ALBUM_REOPENED: "Approved album reopened", ORIGINALS_DOWNLOADED: "Final originals copied",
  PUBLICATION_REVOKED: "Client link revoked", CLIENT_PIN_RESET: "Client PIN reset", CLIENT_EXPIRY_CHANGED: "Client link expiry changed",
};
const EVENT_TONES = {
  QC_APPROVED: "bg-emerald-500", CLIENT_APPROVED: "bg-emerald-500", ALBUM_COMPLETED: "bg-emerald-600",
  QC_CHANGES_REQUESTED: "bg-rose-400", CLIENT_CORRECTIONS_SUBMITTED: "bg-rose-500", PROCESSING_FAILED: "bg-rose-500",
  SENT_TO_QC: "bg-violet-400", PUBLISHED_TO_CLIENT: "bg-blue-500", CLIENT_OPENED: "bg-blue-400",
  QC_CORRECTION_ADDED: "bg-amber-400", CLIENT_CORRECTION_ADDED: "bg-amber-400", ALBUM_REOPENED: "bg-amber-500",
};

/** The audit timeline — per album when `albumId` is given, module-wide otherwise. No secrets ever land here. */
export default function AlbumProofActivityFeed({ albumId }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await listAlbumProofActivity({ albumId });
      setRows(response.data || []);
      setNotice("");
    } catch (error) {
      setNotice(error.message || "Unable to load the activity.");
    } finally {
      setLoading(false);
    }
  }, [albumId]);

  useEffect(() => {
    const timer = window.setTimeout(() => { load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  if (loading) return <p className="py-10 text-center text-xs text-slate-500">Loading activity...</p>;
  if (notice) return <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{notice}</p>;
  if (!rows.length) return <p className="py-10 text-center text-xs text-slate-500">No activity yet.</p>;

  return <ol className="relative space-y-0 border-l border-slate-200 pl-4">
    {rows.map((row) => <li key={row.id} className="relative pb-4">
      <span aria-hidden="true" className={`absolute -left-[21.5px] top-1 h-2.5 w-2.5 rounded-full ring-2 ring-white ${EVENT_TONES[row.event] || "bg-slate-300"}`} />
      <p className="text-xs text-slate-800">
        <span className="font-semibold">{row.actorLabel || (row.actorType === "CLIENT" ? "Client" : row.actorType === "QC" ? "QC" : "Studio")}</span>
        {" "}<span>{EVENT_LABELS[row.event] || row.event}</span>
        {!albumId && row.albumName && <span className="text-slate-500"> · {row.albumName}{row.projectName ? ` (${row.projectName})` : ""}</span>}
      </p>
      {row.detail && <p className="mt-0.5 text-[11px] text-slate-500">{row.detail}</p>}
      <p className="mt-0.5 text-[10px] text-slate-400">{new Date(row.createdAt).toLocaleString()}</p>
    </li>)}
  </ol>;
}
