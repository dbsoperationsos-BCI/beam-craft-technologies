"use client";

import Link from "next/link";
import ProgressBar from "@/components/ai-feature/shared/ProgressBar";
import CloseButton from "@/components/shared/CloseButton";
import { formatCount } from "@/lib/aiFeature.mjs";
import { useAiMediaUploadSessions, useAiMediaWorkspacesOnScreen } from "../hooks/useAiMediaUpload";
import { dismissAiMediaUpload } from "../store/aiMediaUploadStore";

/**
 * An upload that has been left behind: one compact card per event whose Media workspace is not
 * on screen, mounted once by the app shell so it follows the person around the app. The card is a
 * link back to the event, where the workspace shows the full progress; the upload never stopped.
 * While the workspace itself is on screen it is the progress, so nothing is drawn here - the
 * workspace says when it is mounted, because the event page keeps its tab out of the URL and the
 * People tab of the same event is not the Media tab. A finished batch with failures cannot be
 * dismissed from here - the workspace is where Retry failed uploads lives, and the link leads to it.
 */
export default function AiMediaUploadPill() {
  const sessions = useAiMediaUploadSessions();
  const onScreen = useAiMediaWorkspacesOnScreen();
  const shown = sessions.filter((session) => !onScreen.includes(session.eventId));
  if (!shown.length) return null;

  return <div className="fixed bottom-4 left-4 z-40 flex w-[min(20rem,calc(100vw-2rem))] flex-col gap-2">
    {shown.map((session) => {
      const done = session.counts.completed + session.counts.failed + session.counts.cancelled + session.counts.skipped;
      const title = session.finished
        ? `${session.counts.failed ? "Uploaded with problems" : "Upload complete"} · ${formatCount(session.counts.completed)} of ${formatCount(session.total)}`
        : session.paused ? `Paused · ${formatCount(done)} / ${formatCount(session.total)}` : `Uploading ${formatCount(done)} / ${formatCount(session.total)}`;
      const where = `${session.eventName || "AI Feature"}${session.folderName ? ` · ${session.folderName}` : ""}`;
      return <div key={session.eventId} className="rounded-xl border border-slate-200 bg-white p-3 shadow-md">
        <div className="flex items-start justify-between gap-2">
          <Link href={session.href || "#"} className="min-w-0 flex-1 rounded text-left focus-visible:outline-2 focus-visible:outline-blue-500" aria-label={`${title}, ${where}. Open the Media workspace.`}>
            <p className="truncate text-xs font-semibold text-slate-800">{session.finished && !session.counts.failed && <span aria-hidden="true">✓ </span>}{title}</p>
            <p className="truncate text-[11px] text-slate-500">{where}</p>
          </Link>
          {session.finished && !session.counts.failed && <CloseButton size="md" ariaLabel={`Dismiss the upload summary for ${session.eventName || "this event"}`} onClick={() => dismissAiMediaUpload(session.eventId)} className="shrink-0" />}
        </div>
        <div className="mt-2 flex items-center gap-2">
          <ProgressBar percent={session.percent} tone={session.finished ? (session.counts.failed ? "bg-amber-500" : "bg-green-600") : session.paused ? "bg-amber-500" : "bg-blue-600"} className="flex-1" label="Upload progress" />
          <span className="text-[11px] font-semibold tabular-nums text-slate-700">{session.percent}%</span>
        </div>
      </div>;
    })}
  </div>;
}
