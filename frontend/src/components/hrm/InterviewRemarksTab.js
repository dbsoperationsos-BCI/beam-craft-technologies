"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import HelpTip from "@/components/shared/HelpTip";
import NotesComposer from "@/components/shared/NotesComposer";
import useSubmitOnce from "@/components/shared/useSubmitOnce";
import { addCandidateRemark } from "@/services/hrm/interview.service";

/**
 * What was said, written down without moving anybody's stage.
 *
 * The register could only take a note as part of a decision, because the decision dialog is what asks
 * for one - so "they said to call back after Diwali" had nowhere to go unless the recruiter also
 * pretended to change something. This is that note on its own. It appends to `statusNotes`, the same
 * log the decisions write to, so one list holds both why a stage moved and what was said.
 *
 * ── The CRM's own composer ──
 *
 * `NotesComposer`, the control the lead popup writes remarks with: collapsible entries, bullet lists,
 * Enter-to-post, the send button in the toolbar. It had been sitting unexported inside `CRMPage.js`,
 * which is how this register came to have a second, poorer answer to the same question - a textarea with
 * a button under it. A recruiter noting a call and a salesperson noting a call are doing the same thing.
 *
 * Two of its controls are switched off here, because a candidate's log cannot support them: the **pencil**
 * rewrites a remark in place, and `statusNotes` is append-only with no id per entry and no endpoint that
 * rewrites one; the **paperclip** needs somewhere to put a file, and the remark endpoint takes a body and
 * nothing else.
 *
 * ── Why it reports its draft, and why the popup can post it ──
 *
 * The popup will not update a candidate without a remark, and an **unsent** draft counts - otherwise
 * somebody types a note, presses Update, and is refused for the note on screen in front of them.
 * `onPendingChange` is what tells the popup a draft is there, and `commitRef` is how the popup posts it at
 * the save, or a reason that satisfied the gate would be accepted and then thrown away.
 */
export default function InterviewRemarksTab({ candidate, entries, canWrite = true, onAdded, onDraftChange, commitRef, missingError = "" }) {
  const [error, setError] = useState("");
  const { busy, run } = useSubmitOnce();

  /*
   * The log as the composer reads it. `statusNotes` is `{ status, note, at, by }` and an entry is
   * `{ id, createdAt, text }`, so this maps between them rather than storing the composer's shape - the
   * log is the server's, and the decision dialog and the bulk stage change write to it too.
   *
   * The id is the stamp and the position, which is what the composer builds its own from: two remarks
   * cannot be written in the same millisecond at the same position, and a value that changes on its own
   * would remount the bubble on every render.
   */
  const composerEntries = useMemo(() => (Array.isArray(entries) ? entries : [])
    .filter((entry) => entry && entry.note)
    .map((entry, index) => ({
      id: `remark-${entry.at || index}-${index}`,
      createdAt: entry.at || "",
      text: String(entry.note || ""),
      attachments: [],
    })), [entries]);

  /** The stage a remark was written at, in the bubble's own header - see `entryMeta`. */
  const stageFor = useMemo(() => {
    const stages = new Map();
    (Array.isArray(entries) ? entries : []).filter((entry) => entry && entry.note).forEach((entry, index) => {
      stages.set(`remark-${entry.at || index}-${index}`, entry.status || "");
    });
    return stages;
  }, [entries]);

  /**
   * The draft the composer is holding, kept here so the popup's save can post it. The composer reports
   * *whether* there is one; this is what it says.
   */
  const draftRef = useRef("");

  /** Post whatever the composer is holding. True when there was nothing to post or the post succeeded. */
  async function commit() {
    const text = String(draftRef.current || "").trim();
    if (!canWrite || !text) return true;
    try {
      const response = await addCandidateRemark(candidate.id, text);
      draftRef.current = "";
      onDraftChange?.(false);
      onAdded?.(response?.data);
      return true;
    } catch (addError) {
      setError(addError?.data?.message || addError?.message || "Unable to add that remark.");
      return false;
    }
  }

  // No dependency list: the ref must hold this render's `commit`, which reads this render's draft.
  useEffect(() => {
    if (!commitRef) return undefined;
    commitRef.current = commit;
    return () => { commitRef.current = null; };
  });

  /*
   * The box is unmounted when the card moves to another tab, and an unposted note goes with it. The popup
   * is told the box is empty on the way out, or it would still believe a remark was waiting and let the
   * candidate be updated without one.
   */
  const reportRef = useRef(onDraftChange);
  useEffect(() => { reportRef.current = onDraftChange; });
  useEffect(() => () => reportRef.current?.(false), []);

  return <div className="space-y-2">
    {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-normal text-red-700 sm:text-sm">{error}</p>}
    <NotesComposer
      entries={composerEntries}
      /* Append-only and the server's, so the one entry just written goes to its endpoint - never the
         whole array back. */
      onPost={(entry) => { draftRef.current = entry.text; void run(commit); }}
      onPendingChange={(pending) => onDraftChange?.(pending)}
      /* The composer reports whether a draft exists; this keeps what it says, for the popup's save. */
      onDraftTextChange={(text) => { draftRef.current = text; setError(""); }}
      canEdit={false}
      canAttach={false}
      error={missingError}
      showSendButton={canWrite}
      entryMeta={(entry) => {
        const stage = stageFor.get(entry.id);
        return stage ? <span className="ml-1.5 text-[13px] font-normal text-slate-500">· {stage}</span> : null;
      }}
      label="Remarks"
      /* The box scrolls away with the remarks rather than holding the top of the pane, as it does on
         the lead popup: a box that stays put spends the pane's height on an empty textarea. Writing a
         remark is a deliberate act - the footer refuses an update without one and says so - so the
         box does not have to be permanently in reach, and the popup scrolls it back when it asks. */
      placeholder={canWrite ? "Write what was said..." : "You can read this candidate but not write on them."}
    />
    {canWrite && <p className="text-[11px] font-normal leading-5 text-slate-500 sm:text-xs">
      Saving the record needs a remark. A note left here unsent is posted with the update.
      <HelpTip text="Write what was said or decided; it is kept in this candidate's remark history." />
      {busy ? " Adding..." : ""}
    </p>}
  </div>;
}
