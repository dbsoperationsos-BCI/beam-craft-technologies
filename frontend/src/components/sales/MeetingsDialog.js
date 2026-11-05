"use client";

import { avatarOf } from "@/lib/employeeAvatar.mjs";
import SimpleTable from "@/components/data-table/SimpleTable";

import { createPortal } from "react-dom";
import { useCallback, useEffect, useMemo, useState } from "react";
import Button from "@/components/shared/Button";
import DateField from "@/components/shared/DateField";
import Dropdown from "@/components/shared/Dropdown";
import IconButton from "@/components/shared/IconButton";
import TextField from "@/components/shared/TextField";
import TimeField from "@/components/shared/TimeField";
import EmailChipsField from "@/components/shared/EmailChipsField";
import CloseButton from "@/components/shared/CloseButton";
import DeleteOutlineRoundedIcon from "@mui/icons-material/DeleteOutlineRounded";
import { apiRequest } from "@/lib/apiClient";
import useEscapeKey from "@/components/shared/useEscapeKey";
import useFormErrors from "@/components/shared/useFormErrors";
import { copyToClipboard } from "@/lib/clipboard";

/**
 * The meetings booked against one lead, and the form that books another.
 *
 * A Google Meet link cannot be created on its own - Google issues one only as part of a
 * calendar event - so scheduling here writes an event to the signed-in user's Google
 * Calendar and keeps the link it returns. The Join button opens that link, which is the
 * same meeting the organiser and every invited guest see in their own calendar.
 *
 * This reuses the Google account already connected for the Sheets integration. Nothing here
 * changes that connection; if it was made before Meet scheduling existed it simply lacks the
 * calendar grant, and the panel offers Reconnect rather than a button that cannot work.
 */

const DURATION_OPTIONS = [
  { value: "15", label: "15 minutes" },
  { value: "30", label: "30 minutes" },
  { value: "45", label: "45 minutes" },
  { value: "60", label: "1 hour" },
  { value: "90", label: "1 hour 30 minutes" },
  { value: "120", label: "2 hours" },
];

const MEETING_TIME_ZONE = "Asia/Kolkata";

function formatMeetingWhen(startAt, endAt) {
  const start = new Date(startAt);
  const end = new Date(endAt);
  if (Number.isNaN(start.getTime())) return "—";
  const date = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(start);
  const time = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h12" }).format(start);
  if (Number.isNaN(end.getTime())) return `${date} ${time.toLowerCase()}`;
  const until = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h12" }).format(end);
  return `${date} ${time.toLowerCase()} – ${until.toLowerCase()}`;
}

// The browser's own zone, so an event booked at 3pm shows as 3pm to whoever booked it. Falls
// back to the studio's zone when the browser will not say.
function localTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || MEETING_TIME_ZONE;
  } catch {
    return MEETING_TIME_ZONE;
  }
}

function emptyForm() {
  return { title: "", date: "", time: "", duration: "30", attendees: [], description: "" };
}

export default function MeetingsDialog({ lead, onClose, onNotice }) {
  const [meetings, setMeetings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(emptyForm);
  const [scheduling, setScheduling] = useState(false);
  // "" while unknown, then one of the codes the server returns, so the panel can show
  // Connect or Reconnect instead of guessing.
  const [googleIssue, setGoogleIssue] = useState("");
  // Shown inside the dialog. The page's own toast sits at z-40 behind this overlay, so
  // anything reported only through onNotice is invisible while the dialog is open - which
  // made a refused schedule look like a button that does nothing.
  const [message, setMessage] = useState(null);
  const fields = useFormErrors();
  // A refused press says only how many boxes are red; what is wrong is under each one.
  const shown = message || (fields.summary ? { tone: "error", text: fields.summary } : null);
  // The HRM Employee Repository, offered as guest suggestions. Guests are not limited to it -
  // a client or a supplier is typed in directly - so this only ever adds to what can be
  // entered by hand.
  const [employeeOptions, setEmployeeOptions] = useState([]);
  const enquiryId = lead?.id || "";

  const report = useCallback((text, tone = "error") => {
    setMessage(text ? { text, tone } : null);
    onNotice?.(text);
  }, [onNotice]);

  const load = useCallback(async () => {
    if (!enquiryId) return;
    setLoading(true);
    try {
      const response = await apiRequest(`/api/sales/crm-leads/${encodeURIComponent(enquiryId)}/meetings`);
      setMeetings(Array.isArray(response?.data) ? response.data : []);
    } catch (error) {
      report(error?.message || "Unable to load meetings for this lead.");
    } finally {
      setLoading(false);
    }
  }, [enquiryId, report]);

  // Kicked off in a microtask rather than called straight from the effect body, so the
  // `setLoading(true)` inside it lands as its own update instead of a synchronous one
  // cascading out of render.
  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  // Checked up front so the Google state is known before the user fills the form in, rather
  // than after they press Schedule.
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

  useEscapeKey(() => onClose?.());

  const upcoming = useMemo(
    () => meetings.filter((meeting) => meeting.status !== "CANCELLED"),
    [meetings],
  );

  function updateForm(key, value) {
    fields.clear(key);
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function connectGoogle() {
    try {
      const response = await apiRequest("/api/sales/google-oauth/start", { method: "POST" });
      const url = response?.data?.authUrl || response?.authUrl;
      if (url) window.location.href = url;
      else report("Unable to start Google authorization.");
    } catch (error) {
      report(error?.message || "Unable to start Google authorization.");
    }
  }

  async function schedule() {
    if (scheduling) return;
    report("");
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
      const response = await apiRequest(`/api/sales/crm-leads/${encodeURIComponent(enquiryId)}/meetings`, {
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
      setForm(emptyForm());
      setGoogleIssue("");
      await load();
      report(response?.message || "Meeting scheduled. The Meet link is in the list below.", "success");
    } catch (error) {
      // A Google grant problem is a state the panel can act on, not just a message.
      if (error?.data?.code) setGoogleIssue(error.data.code);
      if (fields.fromServer(error, { startAt: "date", durationMinutes: "duration" })) return;
      report(error?.message || "Unable to schedule this meeting.");
    } finally {
      setScheduling(false);
    }
  }

  async function cancel(meeting) {
    try {
      await apiRequest(`/api/sales/crm-leads/${encodeURIComponent(enquiryId)}/meetings/${encodeURIComponent(meeting.id)}`, {
        method: "DELETE",
      });
      await load();
      report("Meeting cancelled.", "success");
    } catch (error) {
      report(error?.message || "Unable to cancel this meeting.");
    }
  }

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[180] flex items-center justify-center bg-slate-950/55 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose?.();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="crm-meetings-title"
        className="flex max-h-[92vh] w-full max-w-[860px] flex-col overflow-hidden rounded-[24px] bg-white shadow-[0_20px_60px_rgba(15,23,42,0.22)]"
      >
        <header className="flex shrink-0 items-center justify-between gap-4 border-b border-slate-200 px-5 py-4 sm:px-6">
          <div className="min-w-0">
            <h2 id="crm-meetings-title" className="text-[18px] font-medium tracking-[-0.02em] text-slate-800 sm:text-[20px]">Meetings</h2>
            <p className="mt-0.5 truncate text-xs text-slate-500">
              {lead?.name || "This lead"} · {enquiryId || "—"}
            </p>
          </div>
          <CloseButton onClick={onClose} ariaLabel="Close meetings" />
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
              {message && <button
                type="button"
                onClick={() => setMessage(null)}
                aria-label="Dismiss message"
                className="shrink-0 text-lg leading-none opacity-70 hover:opacity-100"
              >
                ×
              </button>}
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

          <section>
            <h3 className="text-sm font-semibold text-slate-800">Schedule a meeting</h3>
            <div className="mt-3 grid items-start gap-4 md:grid-cols-3">
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
                // A duration scale is ordered by length, which the alphabet would put "1 hour"
                // ahead of "15 minutes" in.
                sorted={false}
              />
              <DateField label="Date" helperText="The day the meeting takes place." required value={form.date} onChange={(value) => updateForm("date", value)} error={fields.errors.date} />
              <TimeField label="Start time" helperText="The meeting ends after the chosen duration from this time." value={form.time} onChange={(event) => updateForm("time", event.target.value)} error={fields.errors.time} />
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
            <div className="mt-4 flex items-center justify-end gap-3">
              <Button type="button" variant="secondary" onClick={() => { fields.clearAll(); setForm(emptyForm()); }} disabled={scheduling}>
                Clear
              </Button>
              <Button type="button" variant="primary" onClick={() => void schedule()} disabled={scheduling || Boolean(googleIssue)}>
                {scheduling ? "Scheduling..." : "Create Google Meet"}
              </Button>
            </div>
          </section>

          <section className="mt-7">
            <h3 className="text-sm font-semibold text-slate-800">
              All meetings{upcoming.length ? ` (${upcoming.length})` : ""}
            </h3>
            {/* Capped and scrolled from here rather than letting the list run on: a lead
                with a dozen meetings otherwise pushed the schedule form off the top of the
                dialog. The header stays put while the rows move under it. */}
            <SimpleTable
              variant="card"
              /* Capped and scrolled from here rather than letting the list run on: a lead with a
                 dozen meetings otherwise pushed the schedule form off the top of the dialog. The
                 header stays put while the rows move under it. */
              classNames={{ wrapper: "mt-3 max-h-[20rem] !overflow-auto", head: "sticky top-0 z-30", th: "!whitespace-normal" }}
              columns={[
                { key: "meeting", label: "Meeting" },
                { key: "when", label: "When" },
                { key: "who", label: "Who is joining" },
                { key: "meet", label: "Meet", headerClassName: "w-56" },
                { key: "cancel", label: "", headerClassName: "w-16" },
              ]}
              rows={meetings}
              loading={loading}
              loadingMessage="Loading meetings..."
              emptyMessage="No meetings booked for this lead yet."
              renderRow={(meeting) => {
                    const cancelled = meeting.status === "CANCELLED";
                    return (
                      <tr key={meeting.id} className={`align-top ${cancelled ? "text-slate-400" : "text-slate-600"}`}>
                        <td className="px-5 py-3 text-sm">
                          <span className={`block font-semibold ${cancelled ? "text-slate-400 line-through" : "text-slate-800"}`}>{meeting.title}</span>
                          {meeting.description && <span className="mt-0.5 block text-xs">{meeting.description}</span>}
                        </td>
                        <td className="whitespace-nowrap px-5 py-3 text-sm">{formatMeetingWhen(meeting.startAt, meeting.endAt)}</td>
                        {/* Everyone who can join: the host whose calendar holds the event,
                            then each invited guest. Guests were sent the invite by Google
                            when the meeting was booked. */}
                        <td className="px-5 py-3 text-sm">
                          {meeting.organizerEmail && (
                            <span className="block">
                              <span className="text-xs font-semibold text-slate-500">Host</span>{" "}
                              {meeting.organizerEmail}
                            </span>
                          )}
                          {meeting.attendees.length ? (
                            <span className="mt-1 block">
                              <span className="text-xs font-semibold text-slate-500">Guests</span>{" "}
                              {meeting.attendees.join(", ")}
                            </span>
                          ) : (
                            <span className="mt-1 block text-xs text-slate-400">No guests invited</span>
                          )}
                        </td>
                        <td className="px-5 py-3 text-sm">
                          {cancelled ? "Cancelled" : meeting.meetLink ? (
                            <span className="flex flex-wrap items-center gap-2">
                              {/* Opens in its own tab so the CRM, and the lead being worked
                                  on, stay exactly where they were. */}
                              <a
                                href={meeting.meetLink}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-blue-700"
                              >
                                Join Meet
                              </a>
                              <Button
                                type="button"
                                variant="secondary"
                                size="sm"
                                onClick={async () => {
                                  const copied = await copyToClipboard(meeting.meetLink);
                                  report(copied ? "Meet link copied to the clipboard." : `Copy failed. The link is ${meeting.meetLink}`, copied ? "success" : "error");
                                }}
                              >
                                Copy link
                              </Button>
                              {/* One line, clipped. Wrapping the full URL made every row
                                  two lines taller for something Copy link already covers. */}
                              <span className="block w-full truncate text-xs text-slate-400" title={meeting.meetLink}>{meeting.meetLink}</span>
                            </span>
                          ) : "—"}
                        </td>
                        <td className="px-5 py-3 text-right">
                          {!cancelled && (
                            <IconButton variant="ghost" ariaLabel={`Cancel ${meeting.title}`} onClick={() => void cancel(meeting)}>
                              <DeleteOutlineRoundedIcon sx={{ fontSize: 18 }} />
                            </IconButton>
                          )}
                        </td>
                      </tr>
                    );
              }}
            />
          </section>
        </div>
      </section>
    </div>,
    document.body,
  );
}
