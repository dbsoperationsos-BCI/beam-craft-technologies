"use client";

import { useEffect, useMemo, useState } from "react";
import Button from "@/components/shared/Button";
import EmailChipsField from "@/components/shared/EmailChipsField";
import SchemaFormField, { visibleFields } from "@/components/schema-form/SchemaFormFields";
import Dialog from "@/components/ui/Dialog";
import { localTimeZone } from "@/lib/meetings";
import { getMeetGuests, scheduleInterview } from "@/services/hrm/interview.service";
import {
  DEFAULT_MEET_DURATION,
  GOOGLE_MEET_MODE,
  INTERVIEW_MODES,
  MEET_DURATIONS,
  candidateScheduleSections,
  isMeetRound,
} from "@/constants/interviewConfig";

/**
 * **Schedule Interview** - a round put in the diary, as one act.
 *
 * It was a form that wrote fields: HR typed a date, chose a mode, pasted a Meet link somebody had
 * created elsewhere, and then remembered to move the stage to Interview Scheduled. Three of those
 * four were the application asking a person to do its own work, and the one most often missed - the
 * stage - is the one the whole register is read by, so a candidate with an interview on Thursday sat
 * in the Form Submitted tab until somebody noticed. There is **no Meet Link box at any mode** now:
 * a video round's link is Google's answer, and an in-person round has none to give.
 *
 * Saving now does all of it, on the server, in one call (`POST /candidates/:id/schedule`):
 *
 *   * the round is appended, or the one being edited is rewritten in place;
 *   * the candidate **moves to Interview Scheduled**, with the reason recorded - so there is no
 *     Status picker here at all, and nothing to forget;
 *   * a round whose mode is **Google Meet** gets a real Google Calendar event on the scheduler's own
 *     calendar, with the candidate, the interviewer and any guests invited, and Google's link is
 *     written onto the round.
 *
 * Editing a round **patches** the event rather than replacing it, so moving an interview by an hour
 * moves the entry everybody already has and keeps the link the candidate was sent; Google sends its
 * own "this has moved" mail. Changing a round from a Meet to a phone call cancels the event, because
 * an invite to a conference nobody will join is worse than no invite.
 *
 * ── Why editing does not move the stage ──
 *
 * Moving a date is not a decision about a person. A candidate already **Selected** whose final round
 * is moved by an hour is still Selected, and pulling them back to Interview Scheduled would read
 * afterwards as the studio having changed its mind about them.
 */
/** What the dialog is for, which decides its title, its starting values and what a save writes. */
export const SCHEDULE_MODES = { first: "first", next: "next", edit: "edit" };

const TITLES = {
  [SCHEDULE_MODES.first]: "Schedule Interview",
  [SCHEDULE_MODES.next]: "Schedule Next Round",
  [SCHEDULE_MODES.edit]: "Edit Schedule",
};

/** The rounds a candidate holds, with a row built for one written before the column existed. */
function roundsOf(candidate) {
  const stored = Array.isArray(candidate?.interviewRounds) ? candidate.interviewRounds : [];
  if (stored.length) return stored;
  // A candidate scheduled before rounds were kept has their one interview in the flat columns, and
  // it is round one. Read as a round here so a *next* round is numbered two rather than one again.
  if (candidate?.interviewDate || candidate?.interviewTime || candidate?.meetLink) {
    return [{
      round: 1,
      interviewDate: candidate.interviewDate || "",
      interviewTime: candidate.interviewTime || "",
      interviewMode: candidate.interviewMode || "",
      meetLink: candidate.meetLink || "",
    }];
  }
  return [];
}

/** A list with the blanks and the repeats gone, keeping the order the addresses were added in. */
function uniqueEmails(values) {
  const seen = new Set();
  const list = [];
  for (const value of values) {
    const email = String(value || "").trim();
    const key = email.toLowerCase();
    if (!email || seen.has(key)) continue;
    seen.add(key);
    list.push(email);
  }
  return list;
}

export default function InterviewScheduleDialog({ candidate, mode = SCHEDULE_MODES.first, options = {}, canWrite = true, onClose, onSaved }) {
  const rounds = useMemo(() => roundsOf(candidate), [candidate]);
  const editing = mode === SCHEDULE_MODES.edit;
  const nextRound = editing ? Math.max(rounds.length, 1) : rounds.length + 1;
  /** The round being moved, which is what Edit Schedule opens on. */
  const editingRound = editing ? rounds[rounds.length - 1] || null : null;

  /*
   * The employees a Meet can be sent to, read from the module's own narrow route rather than from
   * the CRM's guest list - that one answers to `SALES`, and an HR role holding only Interview would
   * be refused by it while the dialog sat there offering nothing (CLAUDE.md Rule 4).
   *
   * A failed read costs only the suggestions: a guest is still typed straight in, and the
   * interviewer picker falls back to whatever the candidate already holds.
   */
  const [guestBook, setGuestBook] = useState([]);
  useEffect(() => {
    if (!canWrite) return undefined;
    let active = true;
    void getMeetGuests()
      .then((response) => { if (active) setGuestBook(Array.isArray(response?.data) ? response.data : []); })
      .catch(() => { if (active) setGuestBook([]); });
    return () => { active = false; };
  }, [canWrite]);

  const [values, setValues] = useState(() => {
    /*
     * A **next round** opens empty rather than on the last one's details.
     *
     * Those are a conversation that has already happened; leaving them in the boxes invites a second
     * round accidentally scheduled for the first one's date, which reads afterwards as a studio that
     * forgot to move the appointment. Editing opens on the round being moved, guests and all - a
     * guest list that reopened empty would drop everybody from the event on the next save.
     */
    const base = {
      interviewerEmployeeId: candidate?.interviewerEmployeeId || "",
      nextFollowUpDate: candidate?.nextFollowUpDate || "",
      remarks: candidate?.remarks || "",
      durationMinutes: DEFAULT_MEET_DURATION,
      // The candidate is a guest at their own interview, seeded rather than forced: it is the
      // address the invite obviously belongs to, and it can be taken out again.
      attendees: uniqueEmails([candidate?.email || ""]),
    };
    if (!editing || !editingRound) return { ...base, interviewDate: "", interviewTime: "", interviewMode: "" };
    return {
      ...base,
      interviewDate: editingRound.interviewDate || "",
      interviewTime: editingRound.interviewTime || "",
      interviewMode: editingRound.interviewMode || "",
      durationMinutes: editingRound.durationMinutes || DEFAULT_MEET_DURATION,
      attendees: uniqueEmails([...(editingRound.attendees || []), candidate?.email || ""]),
    };
  });
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  const meetRound = isMeetRound(values);

  /*
   * The pickers, with whatever this candidate already holds added back - a mode since renamed in
   * Field Settings, an interviewer no longer on the roster. None of it may be silently dropped by a
   * save, which is the same rule the record's own panel follows.
   */
  const context = useMemo(() => {
    const modes = options.modes?.length ? options.modes : INTERVIEW_MODES;
    const interviewers = guestBook.map((person) => ({
      value: person.id,
      label: [person.name, person.designation].filter(Boolean).join(" · "),
    }));
    const held = candidate?.interviewerEmployeeId;
    if (held && !interviewers.some((person) => person.value === held)) {
      interviewers.push({ value: held, label: candidate?.interviewer || "Interviewer on this record" });
    }
    return {
      options: {
        modes: candidate?.interviewMode && !modes.includes(candidate.interviewMode) ? [...modes, candidate.interviewMode] : modes,
        durations: MEET_DURATIONS,
        interviewers,
      },
      /*
       * The guest list draws itself, through the renderer the schema names - `type: "custom"` with
       * no `render` on the field, so the JSX stays out of the field list and the field list stays
       * data. Guests are not limited to the Employee Repository: a client, a second interviewer or
       * somebody's personal address is typed straight in.
       */
      renderers: {
        attendees: ({ values: current, onChange }) => <EmailChipsField
          label="Guests"
          values={Array.isArray(current.attendees) ? current.attendees : []}
          onChange={(next) => onChange(uniqueEmails(next))}
          options={guestBook.map((person) => ({ value: person.email, label: [person.name, person.designation].filter(Boolean).join(" · ") }))}
          optionsLabel="Employees"
        />,
      },
    };
  }, [candidate, guestBook, options]);

  function change(name, value) {
    setValues((current) => {
      const next = { ...current, [name]: value };
      /*
       * Choosing an interviewer does two things, because the register stores two: the employee it
       * is, and their name as the table and the linked sheets read it. Their work address joins the
       * guest list at the same moment - somebody named as taking the round and not invited to it is
       * the mistake this picker exists to prevent.
       */
      if (name === "interviewerEmployeeId") {
        const person = guestBook.find((row) => row.id === value) || null;
        next.interviewer = person?.name || (value ? current.interviewer : "");
        if (person?.email) next.attendees = uniqueEmails([...(current.attendees || []), person.email]);
      }
      return next;
    });
    setErrors((current) => (current[name] ? { ...current, [name]: "" } : current));
  }

  async function submit(event) {
    event.preventDefault();
    if (!canWrite || saving) return;
    /*
     * A round has to say **when**.
     *
     * Schedule Next Round opens on empty date and time by design, so saving without touching either
     * would append a round that says nothing - the count would advance to Round 2 and, worse, the
     * flat columns the table and the linked sheets read follow the latest round, so it would erase
     * the interview already in the diary.
     */
    if (!String(values.interviewDate || "").trim()) {
      setErrors({ interviewDate: "Choose the day this round is on." });
      return;
    }
    if (!String(values.interviewMode || "").trim()) {
      setErrors({ interviewMode: "Choose how this round is happening." });
      return;
    }
    // A Meet is an event on a calendar, and an event starts at an hour. The server refuses without
    // one; this asks for it where the answer can be given.
    if (meetRound && !String(values.interviewTime || "").trim()) {
      setErrors({ interviewTime: "A Google Meet has to start at a time." });
      return;
    }

    setSaving(true);
    setErrors({});
    try {
      const response = await scheduleInterview(candidate.id, {
        mode,
        interviewDate: values.interviewDate || "",
        interviewTime: values.interviewTime || "",
        interviewMode: values.interviewMode || "",
        /*
         * **No `meetLink`.** The dialog asks for one at no mode - a Meet's link is Google's answer,
         * and an in-person round has none to give - so none is sent. That is not the same as sending
         * an empty one: the server reads a missing link as "leave whatever this round already
         * carries", which is what keeps a link a sheet or an earlier booking wrote from being blanked
         * by an edit that was only moving a date.
         */
        durationMinutes: meetRound ? Number(values.durationMinutes) || DEFAULT_MEET_DURATION : undefined,
        attendees: meetRound ? (values.attendees || []) : [],
        interviewerEmployeeId: values.interviewerEmployeeId || null,
        interviewer: values.interviewer ?? candidate?.interviewer ?? null,
        nextFollowUpDate: values.nextFollowUpDate || null,
        remarks: values.remarks || null,
        // The scheduler's own zone, so an interview booked at half past ten shows as half past ten
        // in their calendar. The server reads the day and the hour as a clock face, never as an
        // instant, which is what these two columns have always held.
        timeZone: localTimeZone(),
      });
      const saved = response?.data;
      const who = saved?.candidateCode || candidate?.name || "The candidate";
      /*
       * Whose calendar it landed on, said only when it is **not** the person who booked it.
       *
       * One linked Google account serves the studio, so somebody who has not connected their own
       * schedules through the studio's - the event is real and the guests are really invited, but it
       * sits in that account's diary and the invite carries its name. Left unsaid, the first thing
       * that happens is somebody opening their own calendar, not finding the interview, and booking
       * it a second time.
       */
      const organiser = response?.meet?.borrowed ? response.meet.organizerEmail : "";
      const message = meetRound
        ? `${who} is booked for Round ${nextRound}, and the Google Meet has been sent to the guests.${organiser ? ` It is on the studio's calendar (${organiser}), not yours.` : ""}`
        : `${who} is booked for Round ${nextRound}.`;
      onSaved?.(saved, message);
    } catch (error) {
      /*
       * Google's two refusals read as instructions rather than as faults: the account is not
       * connected, or it was connected before Calendar was part of the consent. Both name the one
       * screen that fixes them, and both leave the register untouched - the event is created before
       * anything is written, so a refused calendar records no interview at all.
       */
      setErrors({ form: error?.data?.message || error?.message || "Unable to schedule that interview." });
    } finally {
      setSaving(false);
    }
  }

  return <Dialog
    title={TITLES[mode] || TITLES[SCHEDULE_MODES.first]}
    // Whose interview, and which round of it - the one thing the title cannot say twice over.
    description={[candidate?.name || candidate?.candidateCode, `Round ${nextRound}`].filter(Boolean).join(" · ")}
    size="lg"
    onClose={onClose}
    onSubmit={submit}
    busy={saving}
    footer={<>
      <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
      <Button type="submit" variant="primary" disabled={saving || !canWrite}>
        {saving ? (meetRound ? "Creating the Meet…" : "Saving…") : (meetRound ? "Schedule & Create Meet" : "Schedule")}
      </Button>
    </>}
  >
    {errors.form && <p role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-normal text-red-700 sm:text-sm">{errors.form}</p>}
    {/* The register's own section description, drawn by the renderer every other form here uses,
        so a field added to Interview appears here without this component being touched. */}
    {candidateScheduleSections.map((section) => <div key={section.id} className="grid gap-4 md:grid-cols-2">
      {visibleFields(section.fields, values, context).map((field) => <SchemaFormField
        key={field.name}
        field={field}
        values={values}
        onChange={change}
        errors={errors}
        context={context}
      />)}
    </div>)}
    {/*
      * What saving is about to do, said before it happens rather than discovered afterwards.
      *
      * Two things this dialog does that the fields above do not show: the stage moves, and - for a
      * Meet - a real calendar event is created and mailed to the guests. Both are the point of the
      * change, and both are the kind of thing somebody should be told is coming.
      */}
    <p className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] font-normal leading-5 text-slate-600 sm:text-xs">
      {meetRound
        ? <>A Google Meet is created and invited to the guests above, and its link is saved on this round. It goes on your own Google calendar if you have connected one under Settings → Integrations → Interview, and on the studio&apos;s linked account otherwise. {editing ? "The event already in everybody's calendar is moved rather than replaced, so the link they were sent keeps working." : `${candidate?.name || "The candidate"} moves to Interview Scheduled.`}</>
        : <>{editing ? "The round is updated; the stage is left as it is, because moving a date is not a decision about a person." : `${candidate?.name || "The candidate"} moves to Interview Scheduled.`}</>}
    </p>
  </Dialog>;
}
