"use client";

import { useEffect, useState } from "react";
import CallTranscriptsTab from "@/components/shared/CallTranscriptsTab";
import { getCandidateTranscripts, getCandidateTranscriptDetail } from "@/services/hrm/interview.service";

/**
 * What was actually said on the calls to this candidate.
 *
 * The tab itself is the CRM lead popup's, shared - see `CallTranscriptsTab`. All this adds is where
 * the transcripts come from: a lead's are found by its enquiry id, and a candidate has never had
 * one, so the server finds the calls on their number and the transcripts hanging off those.
 *
 * Read when the tab is opened rather than with the candidate, exactly as the call log beside it is:
 * most candidates are never looked at this way, and the popup should not wait on a transcription
 * service to draw a record.
 */
export default function InterviewTranscriptsTab({ candidate }) {
  // `null` is "not read yet" rather than "none", which is what lets the shared tab say it is
  // loading instead of announcing that there are no transcripts before it has asked.
  const [transcripts, setTranscripts] = useState(null);

  useEffect(() => {
    if (!candidate?.id) return undefined;
    let cancelled = false;
    void (async () => {
      try {
        const response = await getCandidateTranscripts(candidate.id);
        if (!cancelled) setTranscripts(Array.isArray(response?.data) ? response.data : []);
      } catch {
        // An empty tab rather than a message, as the call log does: a transcription service having
        // a moment is not a reason to put an error in front of somebody reading a record.
        if (!cancelled) setTranscripts([]);
      }
    })();
    return () => { cancelled = true; };
  }, [candidate?.id]);

  const number = candidate?.whatsappNumber || candidate?.phone || "";
  // Said before the reading, because there is nothing to read: a transcript belongs to a call, and
  // the calls are found by the number.
  if (!number) return <p className="text-xs text-slate-500 sm:text-sm">No number on this record yet, so there are no calls to transcribe.</p>;

  return <CallTranscriptsTab
    transcripts={transcripts || []}
    loading={transcripts === null}
    // Through the candidate rather than by transcript id alone - the server checks the id is one of
    // this candidate's own, so the tab cannot be used to read somebody else's call.
    loadDetail={(transcriptId) => getCandidateTranscriptDetail(candidate.id, transcriptId)}
  />;
}
