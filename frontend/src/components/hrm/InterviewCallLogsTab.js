"use client";

import { useEffect, useState } from "react";
import SimpleTable from "@/components/data-table/SimpleTable";
import { getCandidateCallLogs } from "@/services/hrm/interview.service";

/**
 * Whether anybody has actually rung this candidate, and when.
 *
 * The studio's call log is one table fed by the handset integration and keyed by the number dialled, so
 * a recruiter's call to a candidate lands in it exactly as a salesperson's call to a client does. It had
 * only ever been read from the CRM's lead popup, where the same tab answers the same question - and it is
 * the question the **Follow Up** stage exists to ask: a candidate nobody has reached and a candidate who
 * has not answered are different rows, and until now the register could not tell them apart except by
 * whatever somebody had written in a remark.
 *
 * **What it shows, and whose question that is.** The row carries the CRM's own reading of the call -
 * the note whoever took it typed, the status at the time, and the recording itself. All of it arrives
 * here: each module answers for its own permission, so the register's call tab answers for
 * `HRM / Interview` exactly as the board's answers for `SALES / CRM Leads`. The server's own comment
 * sets out what that admits, since a number that is a candidate here may be a client there.
 *
 * Read on its own, when the tab is opened, rather than with the candidate: most candidates are never
 * looked at this way, and the popup should not wait on the handset integration to draw a record.
 */
export default function InterviewCallLogsTab({ candidate }) {
  // `null` is "not read yet" rather than "none" - the same distinction the CRM's own tabs make, and what
  // lets this say "Reading the calls..." instead of "No calls" while it is still asking.
  const [calls, setCalls] = useState(null);

  useEffect(() => {
    if (!candidate?.id) return undefined;
    let cancelled = false;
    void (async () => {
      try {
        const response = await getCandidateCallLogs(candidate.id);
        if (!cancelled) setCalls(Array.isArray(response?.data) ? response.data : []);
      } catch {
        /*
         * An empty tab rather than a message. The call history is something extra the popup shows about
         * a candidate: a handset integration having a moment is not a reason to put an error in front of
         * somebody who came here to read a record.
         */
        if (!cancelled) setCalls([]);
      }
    })();
    return () => { cancelled = true; };
  }, [candidate?.id]);

  const number = candidate?.whatsappNumber || candidate?.phone || "";
  // Said before the reading, because there is nothing to read: the log is keyed by the number, so a
  // candidate without one cannot have a call against them.
  if (!number) return <p className="text-xs text-slate-500 sm:text-sm">No number on this record yet, so there are no calls to show against it.</p>;

  /*
   * `SimpleTable`, which is what the CRM's own Call Logs tab is drawn with - a read-only list inside a
   * card, not the module table with its import, selection and column menu.
   */
  return <SimpleTable
    columns={[
      { key: "when", label: "When", cellClassName: "whitespace-nowrap text-slate-500", render: (call) => callWhen(call) },
      { key: "callType", label: "Type", cellClassName: "whitespace-nowrap", render: (call) => call.callType || call.callMode || "—" },
      { key: "durationSeconds", label: "Duration", cellClassName: "whitespace-nowrap", render: (call) => duration(call.durationSeconds) },
      { key: "employeeName", label: "By", render: (call) => call.employeeName || "—" },
      // What the caller typed, and where the CRM had them at the time. Wrapping, because a note is a
      // sentence somebody wrote rather than a field - clipping it to one line loses the half worth
      // reading.
      {
        key: "note",
        label: "Note",
        headerClassName: "!whitespace-normal",
        cellClassName: "!whitespace-normal align-top text-slate-600",
        render: (call) => (call.note ? <span className="whitespace-pre-line">{call.note}</span> : <span className="text-slate-400">—</span>),
      },
      { key: "crmStatus", label: "Status", cellClassName: "whitespace-nowrap text-slate-600", render: (call) => call.crmStatus || "—" },
      /*
       * Streamed from the handset integration, which is where the file lives. `preload="none"` so
       * opening the tab does not fetch every recording at once - a candidate rung twenty times would
       * otherwise pull twenty files nobody asked to hear.
       */
      {
        key: "recording",
        label: "Recording",
        render: (call) => (call.recordingUrl
          ? <audio controls preload="none" src={call.recordingUrl} className="h-9 w-56 max-w-full">
            <a href={call.recordingUrl} target="_blank" rel="noreferrer">Open recording</a>
          </audio>
          : <span className="text-slate-400">—</span>),
      },
    ]}
    rows={calls || []}
    rowKey={(call) => call.id}
    /*
     * The table's own loading and empty states rather than a paragraph in place of the table: the
     * headings stay put, so the tab does not change shape as the answer arrives. Both name the number,
     * because "no calls" is only an answer once you know which number it is an answer about.
     */
    loading={calls === null}
    loadingMessage={`Reading the calls on ${number}…`}
    emptyMessage={`No calls recorded on ${number}.`}
  />;
}

/** The stamp the integration recorded, or the day and time it sent where there is no stamp. */
function callWhen(call) {
  if (call.calledAt) {
    const date = new Date(call.calledAt);
    if (!Number.isNaN(date.getTime())) {
      return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(date);
    }
  }
  return `${call.callDate || ""} ${call.callTime || ""}`.trim() || "—";
}

/**
 * A duration as minutes and seconds. Nothing is **"0s"** rather than a dash: a call that connected for
 * no time is a call that was cut off, which is a different fact from a row with no duration recorded.
 */
function duration(seconds) {
  const total = Number(seconds) || 0;
  if (total < 60) return `${total}s`;
  return `${Math.floor(total / 60)}m ${String(total % 60).padStart(2, "0")}s`;
}
