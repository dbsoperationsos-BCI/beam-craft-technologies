"use client";

import { avatarOf } from "@/lib/employeeAvatar.mjs";
import { createPortal } from "react-dom";
import { useEffect, useState } from "react";
import Button from "@/components/shared/Button";
import DateField from "@/components/shared/DateField";
import Dropdown from "@/components/shared/Dropdown";
import TextField from "@/components/shared/TextField";
import TimeField from "@/components/shared/TimeField";
import EmailChipsField from "@/components/shared/EmailChipsField";
import CloseButton from "@/components/shared/CloseButton";
import CloseIcon from "@/components/ui/CloseIcon";
import { apiRequest } from "@/lib/apiClient";
import { localTimeZone } from "@/lib/meetings";
import useEscapeKey from "@/components/shared/useEscapeKey";
import useFormErrors from "@/components/shared/useFormErrors";

/**
 * Add Meet: books a Google Meet from the Calendar, belonging to no lead.
 *
 * A meeting about a client is booked from inside that lead, by the lead's own meetings dialog.
 * This one is for everything else - an internal catch-up, a vendor, a call not yet a lead - so it
 * asks for no lead, and is seen by whoever booked it and its guests.
 *
 * It goes to `/api/sales/crm-meetings`, which books it through the same meeting service the lead's
 * endpoint uses: Google Meet links are issued only as part of a calendar event, and that path
 * already owns creating one.
 *
 * Built from the CRM's own fields throughout - the same title, date, time, duration, guests
 * and description controls the lead's meetings dialog uses.
 */

const DURATION_OPTIONS = [
  { value: "15", label: "15 minutes" },
  { value: "30", label: "30 minutes" },
  { value: "45", label: "45 minutes" },
  { value: "60", label: "1 hour" },
  { value: "90", label: "1 hour 30 minutes" },
  { value: "120", label: "2 hours" },
];

function emptyForm(date = "", time = "") {
  return { title: "", date, time, duration: "30", attendees: [], description: "" };
}

/**
 * `initialDate` is the day the calendar was clicked on, as `YYYY-MM-DD`.
 *
 * Seeded into the form rather than forced, so a day picked by mistake can still be changed in
 * the field. Opening from the Add Meet button passes nothing and the date starts empty.
 * `initialTime` ("14:00") is the hour whose ⋮ opened it on the Day view, seeded into Start time the
 * same way.
 */
export default function ScheduleMeetDialog({ initialDate = "", initialTime = "", onClose, onScheduled }) {
  const [form, setForm] = useState(() => emptyForm(initialDate, initialTime));
  const [employeeOptions, setEmployeeOptions] = useState([]);
  const [scheduling, setScheduling] = useState(false);
  // "" while unknown, then one of the server's codes, so the dialog offers Connect or
  // Reconnect rather than a Schedule button that cannot work.
  const [googleIssue, setGoogleIssue] = useState("");
  const [message, setMessage] = useState(null);
  const fields = useFormErrors();
  // A refused press says only how many boxes are red; what is wrong is under each one.
  const shown = message || (fields.summary ? { tone: "error", text: fields.summary } : null);

  // Checked up front so the Google state is known before the form is filled in, rather than
  // after Schedule is pressed.
  useEffect(() => {
    let active = true;
    void apiRequest("/api/sales/google-oauth/connection")
      .then((response) => {
        if (!active) return;
        const connection = response?.data;
        if (!connection) setGoogleIssue("GOOGLE_NOT_CONNECTED");
        else if (!connection.hasCalendarScope) setGoogleIssue("GOOGLE_CALENDAR_SCOPE_REQUIRED");
        else setGoogleIssue("");
      })
      .catch(() => {
        if (active) setGoogleIssue("GOOGLE_NOT_CONNECTED");
      });
    return () => {
      active = false;
    };
  }, []);

  // The Employee Repository, offered as guest suggestions. Guests are not limited to it - a
  // client or a supplier is typed straight in.
  useEffect(() => {
    let active = true;
    void apiRequest("/api/sales/active-employees")
      .then((response) => {
        if (!active) return;
        const rows = Array.isArray(response?.data) ? response.data : [];
        setEmployeeOptions(rows.map((row) => ({
          // Work address first: it is the one a meeting invite belongs on.
          value: String(row.workEmailId || row.emailId || "").trim(),
          label: [row.employeeName, row.designation].filter(Boolean).join(" · ") || row.employeeId || "Employee",
          avatar: avatarOf(row),
        })));
      })
      .catch(() => {
        // A failed lookup only costs the suggestions; guests can still be typed in.
        if (active) setEmployeeOptions([]);
      });
    return () => {
      active = false;
    };
  }, []);

  // Not while it is being scheduled: that is not cancellable, so the key is not about this dialog.
  useEscapeKey(() => onClose?.(), !scheduling);

  function updateForm(key, value) {
    fields.clear(key);
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function connectGoogle() {
    try {
      const response = await apiRequest("/api/sales/google-oauth/start", { method: "POST" });
      const url = response?.data?.authUrl || response?.authUrl;
      if (url) window.location.href = url;
      else setMessage({ tone: "error", text: "Unable to start Google authorization." });
    } catch (error) {
      setMessage({ tone: "error", text: error?.message || "Unable to start Google authorization." });
    }
  }

  async function schedule() {
    if (scheduling) return;
    setMessage(null);
    // The picker gives a local date and a local time; combined they are the local instant,
    // which the browser converts to UTC on the wire.
    const startAt = new Date(`${form.date}T${form.time}`);
    const invalidStart = form.date && form.time && Number.isNaN(startAt.getTime());
    if (!fields.check({
      title: form.title.trim() ? "" : "Give the meeting a title.",
      date: !form.date ? "Pick a date." : (invalidStart ? "Pick a valid date and start time." : ""),
      time: form.time ? "" : "Pick a start time.",
    })) return;

    setScheduling(true);
    try {
      const response = await apiRequest("/api/sales/crm-meetings", {
        method: "POST",
        body: JSON.stringify({
          title: form.title.trim(),
          description: form.description.trim(),
          startAt: startAt.toISOString(),
          durationMinutes: Number(form.duration) || 30,
          attendees: form.attendees,
          timeZone: localTimeZone(),
        }),
      });
      onScheduled?.(response?.message || "Meeting scheduled.");
      onClose?.();
    } catch (error) {
      // A Google grant problem is a state the dialog can act on, not just a message.
      if (error?.data?.code) setGoogleIssue(error.data.code);
      if (fields.fromServer(error, { startAt: "date", durationMinutes: "duration" })) return;
      setMessage({ tone: "error", text: error?.message || "Unable to schedule this meeting." });
    } finally {
      setScheduling(false);
    }
  }

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[180] flex items-center justify-center bg-slate-950/55 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !scheduling) onClose?.();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-meet-title"
        className="flex max-h-[92vh] w-full max-w-[680px] flex-col overflow-hidden rounded-[24px] bg-white shadow-[0_20px_60px_rgba(15,23,42,0.22)]"
      >
        <header className="flex shrink-0 items-center justify-between gap-4 border-b border-slate-200 px-5 py-4 sm:px-6">
          <div className="min-w-0">
            <h2 id="add-meet-title" className="text-[18px] font-medium tracking-[-0.02em] text-slate-800 sm:text-[20px]">Add Meet</h2>
            <p className="mt-0.5 truncate text-xs text-slate-500">Books a Google Meet and puts it on the organiser&apos;s calendar.</p>
          </div>
          <CloseButton onClick={onClose} ariaLabel="Close Add Meet" />
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">
          {shown && (
            <div
              role={shown.tone === "success" ? "status" : "alert"}
              className={`mb-5 flex items-start gap-3 rounded-lg border px-4 py-3 text-sm ${
                shown.tone === "success"
                  ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                  : "border-rose-200 bg-rose-50 text-rose-700"
              }`}
            >
              <span className="min-w-0 flex-1 break-words">{shown.text}</span>
              {message && <button type="button" onClick={() => setMessage(null)} aria-label="Dismiss message" className="shrink-0 opacity-70 hover:opacity-100"><CloseIcon className="h-4 w-4" /></button>}
            </div>
          )}

          {googleIssue && (
            <div className="mb-5 flex flex-wrap items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
              <p className="mr-auto text-sm text-amber-800">
                {googleIssue === "GOOGLE_NOT_CONNECTED"
                  ? "Connect your Google account to create Meet links."
                  : "Your Google account was connected before Meet scheduling. Reconnect it to allow calendar access."}
              </p>
              <Button type="button" variant="primary" size="sm" onClick={() => void connectGoogle()}>
                {googleIssue === "GOOGLE_NOT_CONNECTED" ? "Connect Google" : "Reconnect Google"}
              </Button>
            </div>
          )}

          <div className="grid items-start gap-4 md:grid-cols-3">
            <div className="md:col-span-2">
              <TextField label="Title" helperText="The meeting's name, as it shows on the calendar." required value={form.title} onChange={(event) => updateForm("title", event.target.value)} placeholder="Discovery call" error={fields.errors.title} />
            </div>
            <Dropdown
              mode="input"
              label="Duration"
              helperText="How long the meeting runs; sets its end time."
              ariaLabel="Duration"
              value={form.duration}
              onChange={(value) => updateForm("duration", value)}
              options={DURATION_OPTIONS}
              error={fields.errors.duration}
              // A duration scale is ordered by length, which the alphabet would put "1 hour" ahead
              // of "15 minutes" in.
              sorted={false}
            />
            <DateField label="Date" helperText="The day the meeting takes place." required value={form.date} onChange={(value) => updateForm("date", value)} error={fields.errors.date} />
            <TimeField label="Start time" helperText="The meeting ends after the chosen duration from this time." required value={form.time} onChange={(event) => updateForm("time", event.target.value)} error={fields.errors.time} />
            <EmailChipsField
              label="Guests"
              helperText="Pick staff or type email addresses of people to invite to the meeting."
              values={form.attendees}
              onChange={(next) => updateForm("attendees", next)}
              options={employeeOptions}
              optionsLabel="Employees"
              error={fields.errors.attendees}
            />
            <div className="md:col-span-3">
              <TextField label="Description" helperText="A short note on what the meeting is about." value={form.description} onChange={(event) => updateForm("description", event.target.value)} placeholder="What is this meeting about?" error={fields.errors.description} />
            </div>
          </div>
        </div>

        <footer className="flex shrink-0 items-center justify-end gap-3 border-t border-slate-200 px-5 py-4 sm:px-6">
          <Button type="button" variant="secondary" onClick={onClose} disabled={scheduling}>Cancel</Button>
          <Button type="button" variant="primary" onClick={() => void schedule()} disabled={scheduling || Boolean(googleIssue)}>
            {scheduling ? "Scheduling..." : "Create Google Meet"}
          </Button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}
