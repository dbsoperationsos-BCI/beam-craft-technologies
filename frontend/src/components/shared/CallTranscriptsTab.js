"use client";

import { createPortal } from "react-dom";
import { useState } from "react";
import Button from "@/components/shared/Button";
import IconButton from "@/components/shared/IconButton";
import CloseIcon from "@/components/ui/CloseIcon";
import useEscapeKey from "@/components/shared/useEscapeKey";
import { formatCallDuration, formatActivityTime } from "@/lib/callFormats.mjs";

/**
 * The recorded calls on a record, and what the model made of each - shared by the CRM lead popup
 * and the Interview candidate popup.
 *
 * It was the lead popup's own, defined inside `CRMPage`. The Interview register asks the same
 * question of a candidate - what was actually said on the calls to this person - and a second copy
 * is the one that stops being corrected: this tab already carries a careful set of statements about
 * machine translation and inferred speakers that nobody would think to repeat.
 *
 * ── What differs between the two, and what does not ───────────────────────────────────────────
 *
 * Only **where a transcript is fetched from**. A lead's are read by enquiry id, a candidate's
 * through the calls on their number, and each module guards its own route - `SALES / CRM Leads`
 * for the board, `HRM / Interview` for the register. So the caller passes `loadDetail(id)` and this
 * draws whatever comes back. Everything else - the cards, the states, the player, the wording - is
 * the same on both, which is the point of it being one component.
 */

/*
 * The Transcripts tab's own small vocabulary.
 *
 * A transcript is made after the call, by a worker, so most of what this renders is a state: queued,
 * running, done, or failed with a reason. Only the last one has a conversation to show.
 */
const TRANSCRIPT_STATUS_TONES = {
  PENDING: { label: "Queued", className: "bg-slate-100 text-slate-600 ring-slate-200" },
  PROCESSING: { label: "Transcribing", className: "bg-blue-50 text-blue-700 ring-blue-200" },
  COMPLETED: { label: "Ready", className: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  FAILED: { label: "Unavailable", className: "bg-red-50 text-red-700 ring-red-200" },
};

/*
 * The language a call was held in, as a name.
 *
 * Transcripts are translated into English whatever was spoken, so this is only ever used to say
 * what it was translated *from* - which a reader needs, because a translated sentence can read
 * stiffly and that is the translation's doing, not the client's.
 */
const SPOKEN_LANGUAGES = {
  ta: "Tamil", en: "English", hi: "Hindi", te: "Telugu", ml: "Malayalam",
  kn: "Kannada", mr: "Marathi", bn: "Bengali", gu: "Gujarati", ur: "Urdu", pa: "Punjabi",
};

function spokenLanguage(code) {
  const key = String(code || "").trim().toLowerCase();
  return SPOKEN_LANGUAGES[key] || (key ? key.toUpperCase() : "");
}

// A transcript is translated when the call was held in something other than English.
function wasTranslated(transcript) {
  const code = String(transcript?.language || "").trim().toLowerCase();
  return Boolean(code) && code !== "en" && String(transcript?.provider || "").includes("translate");
}

// mm:ss against the start of the call, which is how a transcript is read - "at 00:14 they said".
function formatOffset(ms) {
  const total = Math.max(0, Math.round(Number(ms) || 0) / 1000);
  const minutes = Math.floor(total / 60);
  return `${String(minutes).padStart(2, "0")}:${String(Math.floor(total % 60)).padStart(2, "0")}`;
}

// The speaker as a person, not as an enum. UNKNOWN says "Speaker" rather than guessing a side.
function speakerLabel(speaker) {
  if (speaker === "EMPLOYEE") return "Employee";
  if (speaker === "CLIENT") return "Client";
  return "Speaker";
}

/**
 * The Transcripts tab.
 *
 * One card per recorded call: when it happened, which way it went, who took it, how long it ran,
 * and a player. Underneath, what the model made of it - a summary, the outcome, the next action -
 * and the spoken text itself behind **View Full Transcript**.
 *
 * It **reads, and writes nothing**. The model also proposed fields for the lead - a status, a
 * follow-up date, a budget - each with a tick box and an Apply button. The studio does not want a
 * machine transcript of a noisy phone call in two languages deciding what a lead says, even with a
 * press in between, so the panel is gone and so is the route behind it. What is left is the call,
 * described.
 */
export default function CallTranscriptsTab({ transcripts = [], loading = false, loadDetail, onError }) {
  const [openId, setOpenId] = useState("");
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  async function openTranscript(id) {
    setOpenId(id);
    setDetail(null);
    setDetailLoading(true);
    try {
      const response = await loadDetail(id);
      setDetail(response?.data || null);
    } catch (error) {
      onError?.(error.message || "Unable to load that transcript.");
      setOpenId("");
    } finally {
      setDetailLoading(false);
    }
  }

  if (loading) {
    return <div className="flex min-h-[20rem] items-center justify-center p-5 text-sm text-slate-500">Loading transcripts...</div>;
  }
  if (!transcripts.length) {
    return (
      <div className="flex min-h-[20rem] flex-col items-center justify-center gap-1 p-5 text-center text-sm text-slate-500">
        <p>No transcripts yet.</p>
        {/* Said plainly: an empty tab on a lead with calls otherwise reads as broken. */}
        <p className="text-xs text-slate-400">A transcript appears a few minutes after a recorded call arrives from Callyzer.</p>
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
      {transcripts.map((transcript) => {
        const tone = TRANSCRIPT_STATUS_TONES[transcript.status] || TRANSCRIPT_STATUS_TONES.PENDING;

        return (
          <section key={transcript.id} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-slate-200 px-4 py-3 sm:px-5">
              <span className="text-sm font-semibold text-slate-800">{formatActivityTime(transcript.createdAt) || "—"}</span>
              <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${tone.className}`}>
                {tone.label}
              </span>
              {transcript.durationSeconds > 0 && (
                <span className="text-xs text-slate-500">{formatCallDuration(transcript.durationSeconds)}</span>
              )}
              {wasTranslated(transcript)
                ? <span className="text-xs text-slate-500">Translated from {spokenLanguage(transcript.language)}</span>
                : transcript.language ? <span className="text-xs text-slate-500">{spokenLanguage(transcript.language)}</span> : null}
              {transcript.recordingUrl && (
                <audio controls preload="none" src={transcript.recordingUrl} className="ml-auto h-9 w-56 max-w-full" />
              )}
            </header>

            <div className="space-y-3 px-4 py-4 text-sm sm:px-5">
              {transcript.status === "FAILED" && (
                <p className="text-sm text-red-700">
                  {transcript.errorCode === "NO_RECORDING"
                    ? "This call has no recording, so there is nothing to transcribe."
                    : transcript.errorMessage || "The transcription could not be completed."}
                </p>
              )}
              {(transcript.status === "PENDING" || transcript.status === "PROCESSING") && (
                <p className="text-sm text-slate-500">The recording is being transcribed. This usually takes a few minutes.</p>
              )}

              {transcript.summary && (
                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">AI Summary</h4>
                  <p className="mt-1 whitespace-pre-line text-slate-700">{transcript.summary}</p>
                </div>
              )}
              <div className="grid gap-3 sm:grid-cols-2">
                {transcript.callOutcome && (
                  <div>
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Call Outcome</h4>
                    <p className="mt-1 text-slate-700">{transcript.callOutcome}</p>
                  </div>
                )}
                {transcript.nextAction && (
                  <div>
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Next Action</h4>
                    <p className="mt-1 text-slate-700">{transcript.nextAction}</p>
                  </div>
                )}
              </div>

              {transcript.status === "COMPLETED" && (
                <Button variant="secondary" className="rounded-md" onClick={() => openTranscript(transcript.id)}>
                  View Full Transcript
                </Button>
              )}
            </div>
          </section>
        );
      })}

      {openId && (
        <FullTranscriptDialog
          transcript={detail}
          loading={detailLoading}
          onClose={() => { setOpenId(""); setDetail(null); }}
        />
      )}
    </div>
  );
}

/**
 * The conversation, line by line.
 *
 * A dialog rather than an expanding card: a ten-minute call is a long read, and it should not push
 * the other calls off the screen. The speaker note at the top is not decoration - the labels are
 * inferred from the call's direction, and a reader who assumes otherwise will misread who promised
 * what.
 */
function FullTranscriptDialog({ transcript, loading, onClose }) {
  useEscapeKey(onClose);
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[140] flex items-center justify-center bg-slate-950/45 p-3 sm:p-4"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Full transcript"
        className="themed-surface flex max-h-[calc(100dvh-1.5rem)] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
      >
        <div className="flex shrink-0 items-center justify-between gap-4 border-b border-slate-200 px-5 py-4">
          <h2 className="text-lg font-medium text-slate-800">Full Transcript</h2>
          <IconButton label="Close transcript" onClick={onClose} className="text-slate-500 hover:bg-slate-50"><CloseIcon className="h-4 w-4" /></IconButton>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {loading && <p className="py-8 text-center text-sm text-slate-500">Loading transcript...</p>}
          {!loading && !transcript && <p className="py-8 text-center text-sm text-slate-500">That transcript could not be loaded.</p>}
          {!loading && transcript && (
            <>
              <p className="mb-4 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
                {wasTranslated(transcript)
                  ? `This call was held in ${spokenLanguage(transcript.language)} and machine-translated into English, so the wording is the translator's rather than the speaker's. `
                  : ""}
                Speaker names are inferred from the call&apos;s direction and the pauses between turns, not from the
                voices themselves. They can be the wrong way round.
              </p>
              {(transcript.segments || []).length === 0 && (
                <p className="py-8 text-center text-sm text-slate-500">No speech was detected in this recording.</p>
              )}
              <div className="space-y-3">
                {(transcript.segments || []).map((segment) => (
                  <div key={segment.id} className="grid grid-cols-[3.5rem_1fr] gap-3">
                    <span className="pt-0.5 text-xs tabular-nums text-slate-400">{formatOffset(segment.startMs)}</span>
                    <div>
                      <span className={`text-xs font-semibold ${segment.speaker === "CLIENT" ? "text-emerald-700" : segment.speaker === "EMPLOYEE" ? "text-blue-700" : "text-slate-500"}`}>
                        {speakerLabel(segment.speaker)}
                      </span>
                      <p className="text-sm text-slate-700">{segment.text}</p>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
