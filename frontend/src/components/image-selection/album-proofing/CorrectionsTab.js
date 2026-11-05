"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Button from "@/components/shared/Button";
import TextAreaField from "@/components/shared/TextAreaField";
import Dialog from "@/components/ui/Dialog";
import Tabs from "@/components/ui/Tabs";
import { getAlbumVersion, listAlbumCorrections, reopenAlbumCorrection, updateAlbumCorrection } from "@/services/image-selection/album-proofs.service";
import ProofSpreadCanvas from "./ProofSpreadCanvas";
import ProofingStatusChip from "./ProofingStatusChip";

const STATUS_FILTERS = [["", "All"], ["OPEN", "Open"], ["IN_PROGRESS", "In Progress"], ["RESOLVED", "Resolved"], ["REOPENED", "Reopened"]];
const SOURCE_FILTERS = [["", "All"], ["QC", "QC"], ["CLIENT", "Client"]];
const FIXING_STATES = ["QC_CHANGES_REQUESTED", "QC_REVISION_IN_PROGRESS", "CLIENT_CHANGES_REQUESTED", "REVISION_IN_PROGRESS"];
/*
 * The two stages where the fix round is actually open.
 *
 * `QC_CHANGES_REQUESTED` and `CLIENT_CHANGES_REQUESTED` are corrections that have been *handed
 * over* and not yet picked up: the next act is Start Fix Round / Create Revision, and that is on
 * the album, not on any one row. Until it is taken, a row has nothing to offer — offering a
 * per-correction Start Fixes there put two different acts under one label on one screen.
 */
const ROUND_STARTED_STATES = ["QC_REVISION_IN_PROGRESS", "REVISION_IN_PROGRESS"];

/**
 * The corrections center: every QC and client correction across the album's versions, filtered
 * by source and lifecycle status, worked from here (Start / Resolve with a note) and inspectable
 * on its spread with the pin highlighted. QC/client rows are visibly distinct, and each row names
 * the exact version and spread it belongs to — a correction never migrates between versions.
 */
export default function CorrectionsTab({ album, canWrite, qcCanWrite, onChanged }) {
  const [corrections, setCorrections] = useState([]);
  const [status, setStatus] = useState("");
  const [source, setSource] = useState("");
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [resolving, setResolving] = useState(null); // correction being resolved (note dialog)
  const [viewing, setViewing] = useState(null); // { correction }
  const [resolutionNote, setResolutionNote] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await listAlbumCorrections(album.id, { status: status || undefined, source: source || undefined });
      setCorrections(response.data || []);
      setNotice("");
    } catch (error) {
      setNotice(error.message || "Unable to load the corrections.");
    } finally {
      setLoading(false);
    }
  }, [album.id, status, source]);

  useEffect(() => {
    const timer = window.setTimeout(() => { load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const grouped = useMemo(() => {
    const bySpread = new Map();
    for (const correction of corrections) {
      const key = `${correction.versionNumber}-${correction.pageNumber}`;
      const group = bySpread.get(key) || { versionNumber: correction.versionNumber, pageNumber: correction.pageNumber, items: [] };
      group.items.push(correction);
      bySpread.set(key, group);
    }
    return [...bySpread.values()].sort((a, b) => (b.versionNumber - a.versionNumber) || (a.pageNumber - b.pageNumber));
  }, [corrections]);

  const workable = canWrite && ROUND_STARTED_STATES.includes(album.status);
  // Corrections are waiting for the round to be opened. Every row stays quiet until it is.
  const roundPending = FIXING_STATES.includes(album.status) && !ROUND_STARTED_STATES.includes(album.status);
  // Raised, or raised again, and not yet picked up. Reopened is the same position as open: the work
  // has to be started before it can be resolved a second time.
  const notStarted = (correction) => ["OPEN", "REOPENED"].includes(correction.status);
  /*
   * Looking at the spread is not acting on the correction, so it is offered to a reader and in
   * every state outside a fix round — browsing an old version's corrections is exactly that. It is
   * withheld in only one case: the person who can work this correction has not started it yet, and
   * their one next step is Start Fixes.
   */
  const canViewSpread = (correction) => !roundPending && !(workable && notStarted(correction));

  async function move(correction, nextStatus, note) {
    setBusyId(correction.id);
    try {
      await updateAlbumCorrection(album.id, correction.id, { status: nextStatus, ...(note !== undefined ? { resolutionNote: note } : {}) });
      setResolving(null); setResolutionNote("");
      await load();
      onChanged?.();
    } catch (error) {
      setNotice(error.message || "Unable to update the correction.");
      setResolving(null);
    } finally {
      setBusyId(null);
    }
  }
  async function reopen(correction) {
    setBusyId(correction.id);
    try { await reopenAlbumCorrection(album.id, correction.id, null); await load(); onChanged?.(); }
    catch (error) { setNotice(error.message || "Unable to reopen the correction."); }
    finally { setBusyId(null); }
  }

  return <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
      <Tabs ariaLabel="Correction status filter" size="sm" tabs={STATUS_FILTERS.map(([id, label]) => ({ id, label }))} value={status} onChange={setStatus} />
      <Tabs ariaLabel="Correction source filter" size="sm" tabs={SOURCE_FILTERS.map(([id, label]) => ({ id, label }))} value={source} onChange={setSource} />
    </div>

    {notice && <p role="alert" className="mt-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{notice}</p>}
    {loading && <p className="py-10 text-center text-xs text-slate-500">Loading corrections...</p>}
    {!loading && grouped.length === 0 && <p className="py-10 text-center text-xs text-slate-500">{status || source ? "Nothing matches these filters." : "No corrections yet — QC and client corrections gather here."}</p>}

    <div className="mt-3 space-y-3">
      {grouped.map((group) => <section key={`${group.versionNumber}-${group.pageNumber}`} className="rounded-lg border border-slate-200 bg-white">
        <h2 className="border-b border-slate-100 px-3 py-2 text-xs font-semibold text-slate-700">V{group.versionNumber} · Spread {String(group.pageNumber).padStart(2, "0")} <span className="font-normal text-slate-400">({group.items.length})</span></h2>
        <ul className="divide-y divide-slate-100">
          {group.items.map((correction) => <li key={correction.id} className="p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2 text-xs">
                <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${correction.source === "CLIENT" ? "bg-blue-100 text-blue-700" : "bg-violet-100 text-violet-700"}`}>{correction.source}</span>
                <ProofingStatusChip status={correction.status} />
                <span className="text-[10px] text-slate-400">{correction.createdByLabel || (correction.source === "CLIENT" ? "Client" : "QC")} · {new Date(correction.createdAt).toLocaleString()}</span>
              </div>
              {/*
                * One correction, one step at a time, and the step is the STATUS the server holds —
                * never anything this screen remembers, so a reload, a second tab or another admin
                * all see the same row.
                *
                * Before the round is opened a row offers nothing at all: Start Fix Round is the
                * next act and it belongs to the album. Once the round is open, a correction waiting
                * to be picked up offers Start Fixes and nothing else — opening the spread and
                * marking it resolved are what the person doing the work does, and offering those
                * first let a correction be resolved by someone who had never looked at it.
                */}
              <div className="flex flex-wrap gap-1.5">
                {canViewSpread(correction) && <Button type="button" size="none" className="px-2.5 py-1 text-[11px]" onClick={() => setViewing({ correction })}>View Spread</Button>}
                {workable && notStarted(correction) && <Button type="button" size="none" variant="primary" className="px-2.5 py-1 text-[11px]" busy={busyId === correction.id} onClick={() => move(correction, "IN_PROGRESS")}>Start Fixes</Button>}
                {workable && correction.status === "IN_PROGRESS" && <Button type="button" size="none" variant="primary" className="px-2.5 py-1 text-[11px]" disabled={busyId === correction.id} onClick={() => { setResolving(correction); setResolutionNote(""); }}>Resolve</Button>}
                {qcCanWrite && !roundPending && correction.status === "RESOLVED" && <Button type="button" size="none" className="px-2.5 py-1 text-[11px] text-violet-700" disabled={busyId === correction.id} onClick={() => reopen(correction)}>Reopen</Button>}
              </div>
            </div>
            <p className="mt-1.5 whitespace-pre-wrap text-xs text-slate-700">{correction.comment}</p>
            {correction.resolutionNote && <p className="mt-1 rounded bg-emerald-50 px-2 py-1 text-[11px] text-emerald-800">Resolution: {correction.resolutionNote}</p>}
          </li>)}
        </ul>
      </section>)}
    </div>

    {resolving && <Dialog
      title="Resolve Correction"
      description={resolving.comment.length > 120 ? `${resolving.comment.slice(0, 120)}...` : resolving.comment}
      busy={busyId === resolving.id}
      onClose={() => setResolving(null)}
      onSubmit={(event) => { event.preventDefault(); move(resolving, "RESOLVED", resolutionNote.trim() || null); }}
      footer={<>
        <Button type="button" className="max-sm:flex-1" onClick={() => setResolving(null)}>Cancel</Button>
        <Button type="submit" variant="primary" className="max-sm:flex-1" busy={busyId === resolving.id}>Mark Resolved</Button>
      </>}
    >
      <TextAreaField label="Resolution note (optional)" placeholder='e.g. "Replaced with IMG_9021.jpg."' value={resolutionNote} maxLength={2000} onChange={(event) => setResolutionNote(event.target.value)} />
    </Dialog>}

    {viewing && <CorrectionSpreadDialog albumId={album.id} correction={viewing.correction} onClose={() => setViewing(null)} />}
  </div>;
}

/** The correction's spread with its comment open on it — the "jump to the spread" the list promises. */
function CorrectionSpreadDialog({ albumId, correction, onClose }) {
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState("");
  // Which marker is open. It starts on the one the reader asked to see, and any other pin on the
  // spread can be opened from here — the same comment bubbles the review rooms draw.
  const [openPinId, setOpenPinId] = useState(correction.id);

  useEffect(() => {
    let active = true;
    getAlbumVersion(albumId, correction.versionId)
      .then((response) => { if (active) setDetail(response.data); })
      .catch((loadError) => { if (active) setError(loadError.message || "Unable to load the spread."); });
    return () => { active = false; };
  }, [albumId, correction.versionId]);

  const page = detail?.pages?.find((candidate) => candidate.id === correction.versionPageId);
  const pins = (detail?.corrections || []).filter((candidate) => candidate.versionPageId === correction.versionPageId)
    .map((candidate, number) => ({
      id: candidate.id, x: candidate.xNormalized, y: candidate.yNormalized, radius: candidate.radiusNormalized,
      number: number + 1, status: candidate.status, source: candidate.source,
      author: candidate.createdByLabel || (candidate.source === "CLIENT" ? "Client" : "QC Lead"),
      createdAt: candidate.createdAt, comment: candidate.comment, resolutionNote: candidate.resolutionNote,
    }));

  return <Dialog title={`V${correction.versionNumber} · Spread ${String(correction.pageNumber).padStart(2, "0")}`} size="wide" onClose={onClose} footer={<Button type="button" className="max-sm:flex-1" onClick={onClose}>Close</Button>}>
    {error && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
    {!detail && !error && <p className="py-10 text-center text-xs text-slate-500">Loading spread...</p>}
    {/* The spread is fitted to the dialog rather than shown at its own size. It used to be given a
        max height that a percentage inside an auto-height box could never resolve against, so a
        tall proof was drawn full size and the dialog scrolled it a strip at a time — the picture
        was never all on screen at once, and a comment bubble could be scrolled away from its pin.
        The same fit the two review rooms use, so the pins land in the same places here. */}
    {page && <div className="flex items-center justify-center rounded-lg bg-slate-100 p-2">
      <ProofSpreadCanvas
        imageUrl={page.previewUrl}
        alt={page.fileName}
        pins={pins}
        activePinId={openPinId}
        onSelectPin={setOpenPinId}
        className="flex h-[58dvh] w-full items-center justify-center"
        imageClassName="h-full w-full rounded-none object-contain"
      />
    </div>}
  </Dialog>;
}
