"use client";

import Close from "@mui/icons-material/Close";
import Pause from "@mui/icons-material/Pause";
import PlayArrow from "@mui/icons-material/PlayArrow";

function formatEta(seconds) {
  if (seconds == null) return "Calculating...";
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}
function statusLabel(session) {
  if (session.paused) return "PAUSED";
  if (session.batch?.status === "COMPLETED") return "COMPLETED";
  if (session.batch?.status === "COMPLETED_WITH_ERRORS") return "COMPLETED WITH ERRORS";
  return (session.batch?.status || "PREPARING").replaceAll("_", " ");
}

/*
 * `retryAfterFinish` keeps Retry on the card once the batch is over - for a queue whose failures are
 * only known when it ends (the Signature Album's, which sends every photo from this browser).
 * Photo Selection passes none and its card is exactly as it was.
 */
export default function UploadBatchProgress({ session, title = "Event Upload Progress", onPause, onResume, onCancel, onDone, onOpen, onRetryFailed, retryAfterFinish = false, compact = false, className = "" }) {
  const batch = session?.batch;
  if (!session || !batch) return null;
  const finished = session.finished;
  // Pause and Cancel only govern what this browser still has to send. Once every photo
  // has been sent, the server keeps compressing on its own and there is nothing to stop.
  const sending = session.pendingLocalFiles > 0;
  const barColor = finished ? "bg-emerald-500" : session.paused ? "bg-amber-500" : "bg-blue-600";
  // Only offered once photos have actually given up, so it never competes with the automatic
  // attempts still in flight.
  const retry = session.failedLocalFiles > 0 && onRetryFailed
    ? <button type="button" onClick={onRetryFailed} className="rounded-md border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100">
      Retry {session.failedLocalFiles} failed
    </button>
    : null;
  const failedAtEnd = finished && retryAfterFinish && session.failedLocalFiles > 0;

  // The floating dock only needs to say which project is uploading and how far along it
  // is — the full counters live on the project page where there is room for them.
  if (compact) {
    return (
      <div className={`flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-2 ${className}`} aria-label="Overall upload progress">
        {/* The name and bar double as the link back to the folder that is uploading. The
            icon buttons stay outside it so they are not nested inside another button. */}
        <button
          type="button"
          onClick={onOpen}
          disabled={!onOpen}
          title={onOpen ? "Open upload progress" : undefined}
          className="min-w-0 flex-1 rounded text-left enabled:cursor-pointer enabled:hover:bg-slate-50"
        >
          <p className="truncate text-xs font-medium text-slate-800">{title}</p>
          <div className="mt-1.5 flex items-center gap-2">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
              <div className={`h-full rounded-full transition-[width] ${barColor}`} style={{ width: `${batch.overallProgress}%` }} />
            </div>
            <span className={`shrink-0 text-[11px] font-semibold tabular-nums ${finished ? "text-emerald-600" : "text-blue-700"}`}>
              {batch.overallProgress}%
            </span>
          </div>
        </button>
        {!finished && sending && (
          <button
            type="button"
            onClick={session.paused ? onResume : onPause}
            title={session.paused ? "Resume" : "Pause"}
            aria-label={session.paused ? "Resume uploads" : "Pause uploads"}
            className="shrink-0 rounded p-1 text-slate-600 hover:bg-slate-100"
          >
            {session.paused ? <PlayArrow style={{ fontSize: 14 }} /> : <Pause style={{ fontSize: 14 }} />}
          </button>
        )}
        <button
          type="button"
          onClick={sending && !finished ? onCancel : onDone}
          title={sending && !finished ? "Cancel uploads" : "Hide"}
          aria-label={sending && !finished ? "Cancel uploads" : "Hide upload"}
          className="shrink-0 rounded p-1 text-slate-500 hover:bg-red-50 hover:text-red-600"
        >
          <Close style={{ fontSize: 14 }} />
        </button>
      </div>
    );
  }

  return (
    <section className={`rounded-lg border border-blue-100 bg-blue-50/60 p-4 ${className}`} aria-label="Overall upload progress">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-xs font-semibold text-slate-800">{title}</h3>
          <p className="mt-1 text-[10px] text-slate-500">{statusLabel(session)}</p>
        </div>
        <span className={`text-lg font-semibold ${finished ? "text-emerald-600" : "text-blue-700"}`}>{batch.overallProgress}%</span>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-white">
        <div
          className={`h-full rounded-full transition-[width] ${barColor}`}
          style={{ width: `${batch.overallProgress}%` }}
        />
      </div>
      <dl className="mt-3 grid grid-cols-3 gap-2 text-center sm:grid-cols-6">
        <div>
          <dt className="text-[9px] uppercase text-slate-500">Total</dt>
          <dd className="text-xs font-semibold">{batch.totalFiles}</dd>
        </div>
        <div>
          <dt className="text-[9px] uppercase text-slate-500">Uploaded</dt>
          <dd className="text-xs font-semibold text-blue-700">{batch.uploadedFiles}</dd>
        </div>
        <div>
          <dt className="text-[9px] uppercase text-slate-500">Compressed</dt>
          <dd className="text-xs font-semibold text-emerald-700">{batch.compressedFiles}</dd>
        </div>
        <div>
          <dt className="text-[9px] uppercase text-slate-500">Failed</dt>
          <dd className="text-xs font-semibold text-red-600">{batch.failedFiles}</dd>
        </div>
        <div>
          <dt className="text-[9px] uppercase text-slate-500">Queue</dt>
          <dd className="text-xs font-semibold">{batch.remainingQueue}</dd>
        </div>
        <div>
          <dt className="text-[9px] uppercase text-slate-500">ETA</dt>
          <dd className="text-xs font-semibold">{finished ? "Done" : session.paused ? "Paused" : formatEta(batch.etaSeconds)}</dd>
        </div>
      </dl>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {sending && !finished ? (
          <>
            <button
              type="button"
              onClick={session.paused ? onResume : onPause}
              className={`rounded-md px-4 py-1.5 text-xs font-semibold text-white ${session.paused ? "bg-blue-600 hover:bg-blue-700" : "bg-amber-500 hover:bg-amber-600"}`}
            >
              {session.paused ? "Resume" : "Pause"}
            </button>
            {retry}
            <button type="button" onClick={onCancel} className="ml-auto rounded-md border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50">
              Cancel uploads
            </button>
          </>
        ) : (
          // Everything has left the browser and cancelling can no longer stop anything, so Done is
          // the only action left. It stays available even while the server is still finishing:
          // dismissing the card stops nothing — compression carries on without the page — and a
          // card that could only be dismissed once the batch reported itself complete left the user
          // with no way out of a batch that never did.
          <>
          {failedAtEnd && retry}
          <button
            type="button"
            onClick={onDone}
            title={finished ? undefined : "Hide this card — the server keeps processing without it"}
            className="ml-auto rounded-md bg-emerald-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
          >
            {finished ? "Done" : "Hide"}
          </button>
          </>
        )}
      </div>
      <p className="mt-2 text-[10px] text-slate-500">
        {failedAtEnd
          ? `${session.failedLocalFiles} photo${session.failedLocalFiles === 1 ? "" : "s"} could not be uploaded. Retry them, or add them again.`
          : finished
          ? "All photos finished processing."
          : session.paused
            ? `Sending paused — ${session.pendingLocalFiles} photo${session.pendingLocalFiles === 1 ? "" : "s"} left to send. Photos already uploaded keep processing on the server.`
            : sending
              ? `${session.pendingLocalFiles} photo${session.pendingLocalFiles === 1 ? "" : "s"} left to send from this browser.`
              : "All photos have been sent. The server is finishing compression — this continues even if you close the page."}
      </p>
      {/* Cleared as soon as the stream delivers again or a photo gets through, so this only
          stands while something is actually wrong. */}
      {session.streamError && <p role="alert" className="mt-1 text-[10px] text-red-600">{session.streamError}</p>}
    </section>
  );
}
