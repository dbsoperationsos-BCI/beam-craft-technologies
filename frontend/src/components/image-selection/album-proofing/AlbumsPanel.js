"use client";

import Add from "@mui/icons-material/Add";
import { useCallback, useEffect, useState } from "react";
import Button from "@/components/shared/Button";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import OptionsMenu from "@/components/ui/OptionsMenu";
import { archiveAlbumProof, deleteAlbumProof, listAlbumProofs, restoreAlbumProof } from "@/services/image-selection/album-proofs.service";
import CreateAlbumProofDialog from "./CreateAlbumProofDialog";
import ProofingStatusChip from "./ProofingStatusChip";

// Dashboard filters, each covering the states a person means by it. Filtering happens client-side
// over the project's own handful of albums.
const FILTERS = [
  ["", "All"],
  ["DRAFT", "Draft", ["DRAFT"]],
  ["PROCESSING", "Processing", ["PROCESSING", "PROCESSING_FAILED"]],
  ["READY_FOR_QC", "Ready for QC", ["READY_FOR_QC"]],
  ["QC_REVIEW", "QC Review", ["QC_REVIEW"]],
  ["QC_CORRECTIONS", "QC Corrections", ["QC_CHANGES_REQUESTED", "QC_REVISION_IN_PROGRESS"]],
  ["QC_APPROVED", "QC Approved", ["QC_APPROVED", "READY_FOR_CLIENT"]],
  ["CLIENT_REVIEW", "Client Review", ["CLIENT_REVIEW"]],
  ["CLIENT_CORRECTIONS", "Client Corrections", ["CLIENT_CHANGES_REQUESTED", "REVISION_IN_PROGRESS", "REVISION_READY_FOR_QC"]],
  ["CLIENT_APPROVED", "Client Approved", ["CLIENT_APPROVED"]],
  ["COMPLETED", "Completed", ["COMPLETED"]],
];

/**
 * One project's albums — Main Wedding Album, Parents Album, ... — each card carrying the current
 * version, workflow status and open-corrections count. Opening one hands the pane to the album
 * workspace; the project itself supplies every client detail, asked for nowhere here.
 */
export default function AlbumsPanel({ project, canWrite, onOpen }) {
  const [albums, setAlbums] = useState([]);
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await listAlbumProofs({ projectId: project.id });
      setAlbums(response.data || []);
      setNotice("");
    } catch (error) {
      setNotice(error.message || "Unable to load the albums.");
    } finally {
      setLoading(false);
    }
  }, [project.id]);

  useEffect(() => {
    const timer = window.setTimeout(() => { load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function handleAction(action, album) {
    setBusy(true);
    try {
      if (action === "archive") await archiveAlbumProof(album.id);
      if (action === "restore") await restoreAlbumProof(album.id);
      setNotice("");
      await load();
    } catch (error) {
      setNotice(error.message || "Unable to update the album.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    setBusy(true);
    try {
      await deleteAlbumProof(deleting.album.id, { acknowledge: deleting.acknowledged });
      setDeleting(null);
      await load();
    } catch (error) {
      if (error.status === 409 && error.data?.details?.requiresAcknowledgement) setDeleting({ album: deleting.album, acknowledged: true, impact: error.data.details });
      else { setNotice(error.message || "Unable to delete the album."); setDeleting(null); }
    } finally {
      setBusy(false);
    }
  }

  const filterStates = FILTERS.find(([value]) => value === filter)?.[2];
  const visible = filterStates ? albums.filter((album) => filterStates.includes(album.status)) : albums;

  return <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <label className="text-xs font-semibold text-slate-600">
        <span className="sr-only">Filter albums</span>
        <select value={filter} onChange={(event) => setFilter(event.target.value)} className="h-9 rounded-md border border-slate-300 bg-white px-2 text-xs sm:text-sm">
          {FILTERS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      {canWrite && <Button type="button" variant="primary" size="sm" onClick={() => setCreating(true)}><Add style={{ fontSize: 16 }} className="mr-1" />Create Album</Button>}
    </div>

    {notice && <p role="alert" className="mt-4 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{notice}</p>}
    {loading && <p className="py-12 text-center text-xs text-slate-500">Loading albums...</p>}
    {!loading && visible.length === 0 && <p className="py-12 text-center text-xs text-slate-500">
      {filter ? "No albums with this status." : canWrite ? "No albums yet. Create the Main Album to start proofing." : "No albums yet."}
    </p>}

    <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
      {visible.map((album) => <div key={album.id} className="group relative rounded-lg border border-slate-200 bg-white transition hover:border-blue-300 hover:shadow-sm">
        <button type="button" onClick={() => onOpen(album)} className="block w-full p-4 text-left">
          <div className="flex items-start justify-between gap-2 pr-7">
            <div className="min-w-0">
              <h2 className="truncate text-sm font-semibold text-slate-800">{album.name}</h2>
              <p className="mt-0.5 truncate text-xs text-slate-500">{album.albumType || "Album"}{album.currentVersionNumber ? ` · V${album.currentVersionNumber}` : " · No proof yet"}</p>
            </div>
            <ProofingStatusChip status={album.status} />
          </div>
          <p className="mt-2.5 text-[11px] text-slate-500">
            {album.openCorrections ? <span className="font-semibold text-rose-600">{album.openCorrections} open correction{album.openCorrections === 1 ? "" : "s"} · </span> : ""}
            Revisions {album.revisionsUsed}{album.revisionLimit != null ? ` of ${album.revisionLimit}` : " (unlimited)"} · Added {new Date(album.createdAt).toLocaleDateString()}
          </p>
        </button>
        {canWrite && <div className="absolute right-2 top-3 opacity-100 transition-opacity md:pointer-events-none md:opacity-0 md:focus-within:pointer-events-auto md:focus-within:opacity-100 md:group-hover:pointer-events-auto md:group-hover:opacity-100">
          <OptionsMenu ariaLabel={`Album actions for ${album.name}`} items={album.archivedAt ? [
            { label: "Restore", onSelect: () => handleAction("restore", album) },
            { label: "Delete", tone: "danger", onSelect: () => setDeleting({ album, acknowledged: false }) },
          ] : [
            { label: "Open", onSelect: () => onOpen(album) },
            { label: "Archive", onSelect: () => handleAction("archive", album) },
            { label: "Delete", tone: "danger", onSelect: () => setDeleting({ album, acknowledged: false }) },
          ]} />
        </div>}
      </div>)}
    </div>

    {creating && <CreateAlbumProofDialog project={project} onClose={() => setCreating(false)} onCreated={async (album) => { setCreating(false); await load(); onOpen(album); }} />}
    {deleting && <ConfirmDialog
      title={deleting.acknowledged ? "Delete album and its proofing history?" : "Delete this album?"}
      message={deleting.acknowledged
        ? `"${deleting.album.name}" holds ${deleting.impact.correctionCount} correction(s), ${deleting.impact.qcRoundCount} QC round(s) and ${deleting.impact.submissionCount} client submission(s)${deleting.impact.clientApproved ? ", including a client approval" : ""}. Deleting removes this history permanently. The original images on your drive/NAS are never touched.`
        : `"${deleting.album.name}", its folders and its proof derivatives will be removed. The original images on your drive/NAS are never touched. This cannot be undone.`}
      confirmLabel={deleting.acknowledged ? "Delete Everything" : "Delete Album"}
      busyLabel="Deleting..."
      loading={busy}
      onCancel={() => setDeleting(null)}
      onConfirm={confirmDelete}
    />}
  </div>;
}
