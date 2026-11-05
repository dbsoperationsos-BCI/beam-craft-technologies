"use client";

import { createPortal } from "react-dom";
import { useEffect, useMemo, useRef, useState } from "react";
import Button from "@/components/shared/Button";
import ComboBoxField from "@/components/shared/ComboBoxField";
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

/**
 * Add Meet: books a Google Meet from the Meetings page.
 *
 * The lead's own meetings dialog already books one from inside a lead, where the lead is
 * whichever one is open. Here there is no lead in hand, so the form asks for one - a meeting
 * belongs to an enquiry in the CRM, and one booked against nothing would appear on the
 * calendar with no way back to the client it was for.
 *
 * The booking itself goes to the lead's own endpoint, unchanged. Google Meet links are issued
 * only as part of a calendar event, and that path already owns creating one; this dialog only
 * decides which lead it is for and hands over the same payload.
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

function emptyForm(date = "") {
  return { lead: "", title: "", date, time: "", duration: "30", attendees: [], description: "" };
}

// How a lead reads in the picker. The enquiry id is part of the label rather than hidden
// behind it, because two clients really can share a name and the id is what tells them apart.
function leadOptionLabel(lead) {
  return [lead.name || "Unnamed lead", lead.enquiryId].filter(Boolean).join(" · ");
}

/**
 * `initialDate` is the day the calendar was clicked on, as `YYYY-MM-DD`.
 *
 * Seeded into the form rather than forced, so a day picked by mistake can still be changed in
 * the field. Opening from the Add Meet button passes nothing and the date starts empty.
 */
export default function ScheduleMeetDialog({ initialDate = "", onClose, onScheduled }) {
  const [form, setForm] = useState(() => emptyForm(initialDate));
  const [leads, setLeads] = useState([]);
  const [employeeOptions, setEmployeeOptions] = useState([]);
  const [scheduling, setScheduling] = useState(false);
  // "" while unknown, then one of the server's codes, so the dialog offers Connect or
  // Reconnect rather than a Schedule button that cannot work.
  const [googleIssue, setGoogleIssue] = useState("");
  const [message, setMessage] = useState(null);

  /*
   * Every lead this dialog has offered, keyed by the label it was offered under.
   *
   * The picked lead is resolved from here rather than from the current search results.
   * Choosing an option puts its whole label in the box - "Name · DBS-EID-DD-ERD-000123" - and that
   * text matches no lead name and no enquiry id, so searching for it returns nothing. Holding
   * on to what has already been seen means a lead stays resolvable however the list moves
   * afterwards.
   */
  const knownLeadsRef = useRef(new Map());

  /*
   * The lead list is searched on the server, not filtered in the browser.
   *
   * The CRM holds tens of thousands of leads; handing the whole list to a picker would mean a
   * multi-megabyte response before the dialog could be used at all. What is typed is sent
   * instead and only the matches come back.
   *
   * Debounced, so typing a name is one request rather than one per keystroke, and the reply
   * is dropped if the text has moved on - a slow response for "ra" must not overwrite the
   * results for "ravi".
   */
  useEffect(() => {
    const search = form.lead.trim();
    // Text that exactly matches a label already offered is a choice made, not a search. Going
    // back to the server for it would only empty the menu that was just picked from.
    if (knownLeadsRef.current.has(search)) return undefined;

    let active = true;
    const timer = window.setTimeout(() => {
      void apiRequest(`/api/sales/crm-meetings/leads?q=${encodeURIComponent(search)}`)
        .then((response) => {
          if (!active) return;
          const rows = (Array.isArray(response?.data) ? response.data : []).filter((row) => row.enquiryId);
          for (const row of rows) knownLeadsRef.current.set(leadOptionLabel(row), row.enquiryId);
          setLeads(rows);
        })
        .catch(() => {
          if (active) setLeads([]);
        });
    }, 250);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [form.lead]);

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

  // What the menu offers: the current search results. Resolution is a separate question and
  // reads knownLeadsRef, which remembers everything offered so far.
  const leadLabels = useMemo(() => leads.map(leadOptionLabel), [leads]);

  function updateForm(key, value) {
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
    // Resolved by exact lookup against everything the picker has offered, rather than by
    // parsing the id back out of the label - a client whose name contains the separator would
    // defeat any parsing.
    const enquiryId = knownLeadsRef.current.get(form.lead.trim());
    if (!enquiryId) return setMessage({ tone: "error", text: "Pick a lead from the list. A meeting belongs to an enquiry." });
    if (!form.title.trim()) return setMessage({ tone: "error", text: "Give the meeting a title." });
    if (!form.date || !form.time) return setMessage({ tone: "error", text: "Pick a date and a start time." });

    // The picker gives a local date and a local time; combined they are the local instant,
    // which the browser converts to UTC on the wire.
    const startAt = new Date(`${form.date}T${form.time}`);
    if (Number.isNaN(startAt.getTime())) return setMessage({ tone: "error", text: "Pick a valid date and start time." });

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
      onScheduled?.(response?.message || "Meeting scheduled.");
      onClose?.();
    } catch (error) {
      // A Google grant problem is a state the dialog can act on, not just a message.
      if (error?.data?.code) setGoogleIssue(error.data.code);
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
          {message && (
            <div
              role={message.tone === "success" ? "status" : "alert"}
              className={`mb-5 flex items-start gap-3 rounded-lg border px-4 py-3 text-sm ${
                message.tone === "success"
                  ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                  : "border-rose-200 bg-rose-50 text-rose-700"
              }`}
            >
              <span className="min-w-0 flex-1 break-words">{message.text}</span>
              <button type="button" onClick={() => setMessage(null)} aria-label="Dismiss message" className="shrink-0 opacity-70 hover:opacity-100"><CloseIcon className="h-4 w-4" /></button>
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
            <div className="md:col-span-3">
              <ComboBoxField
                label="Lead"
                required
                ariaLabel="Lead"
                value={form.lead}
                onChange={(value) => updateForm("lead", value)}
                options={leadLabels}
                placeholder="Search a lead by name or enquiry ID"
              />
            </div>
            <div className="md:col-span-2">
              <TextField label="Title" required value={form.title} onChange={(event) => updateForm("title", event.target.value)} placeholder="Discovery call" />
            </div>
            <Dropdown
              mode="input"
              label="Duration"
              ariaLabel="Duration"
              value={form.duration}
              onChange={(value) => updateForm("duration", value)}
              options={DURATION_OPTIONS}
              // A duration scale is ordered by length, which the alphabet would put "1 hour" ahead
              // of "15 minutes" in.
              sorted={false}
            />
            <DateField label="Date" required value={form.date} onChange={(value) => updateForm("date", value)} />
            <TimeField label="Start time" required value={form.time} onChange={(event) => updateForm("time", event.target.value)} />
            <EmailChipsField
              label="Guests"
              values={form.attendees}
              onChange={(next) => updateForm("attendees", next)}
              options={employeeOptions}
              optionsLabel="Employees"
            />
            <div className="md:col-span-3">
              <TextField label="Description" value={form.description} onChange={(event) => updateForm("description", event.target.value)} placeholder="What is this meeting about?" />
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
