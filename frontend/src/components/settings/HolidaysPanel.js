"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import ChevronLeftRoundedIcon from "@mui/icons-material/ChevronLeftRounded";
import ChevronRightRoundedIcon from "@mui/icons-material/ChevronRightRounded";
import Button from "@/components/shared/Button";
import DateField from "@/components/shared/DateField";
import IconButton from "@/components/shared/IconButton";
import Loader from "@/components/shared/Loader";
import TextField from "@/components/shared/TextField";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import Dialog from "@/components/ui/Dialog";
import { monthGrid, SCHEDULE_WEEKDAYS } from "@/lib/schedule";
import { createHoliday, deleteHoliday, getHolidays, updateHoliday } from "@/services/settings/holidays.service";

/**
 * Settings → Holidays: the days the studio declares itself closed.
 *
 * A calendar rather than a list, because a holiday is a *date* and the question asked while
 * declaring one is almost always about the shape of the month around it — which day of the week
 * it falls on, whether it already touches a weekend, whether the studio has just had one. A list
 * of `2026-10-20 Diwali` rows answers none of that, which is what this replaces: the same list
 * used to be entered date-by-date on the HRM attendance rules screen.
 *
 * One list, read by two things that are not here. The attendance rules take a declared day out of
 * every hours target and mark it `Holiday` rather than an absence, and the studio calendar — the
 * Calendar icon on the topbar — draws it for every employee. So declaring a day here is what makes
 * it a holiday everywhere; nothing else has to be told.
 *
 * `ADMIN / System Settings`, which is what `/api/settings/holidays` enforces: Read to look, Read /
 * Write to change. With Read alone there is no Add, days are not clickable and the dialogs never
 * open — a control that would be refused is absent rather than present and disabled.
 */

const pad = (value) => String(value).padStart(2, "0");
/** A `Date` as the day it reads as locally — never `toISOString`, which would shift it by a zone. */
const dayKeyOf = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const firstOfMonth = (date) => new Date(date.getFullYear(), date.getMonth(), 1);

const monthFormat = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric" });
const dayFormat = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });

/** A `YYYY-MM-DD` read back as a local date, for formatting it in words. */
const readDay = (key) => (key ? new Date(`${key}T00:00:00`) : null);
const formatDay = (key) => {
  const date = readDay(key);
  return date && !Number.isNaN(date.getTime()) ? dayFormat.format(date) : key;
};

export default function HolidaysPanel({ canWrite = false, onNotice, onError }) {
  const [holidays, setHolidays] = useState([]);
  const [loading, setLoading] = useState(true);
  const [month, setMonth] = useState(() => firstOfMonth(new Date()));
  /*
   * The holiday being written, or null when no dialog is open.
   *
   * One piece of state for both verbs: an edit carries the `id` of the day being changed and a new
   * one does not, which is the only difference between them. Two dialogs with two forms would be
   * the same form twice, and the second copy is where the two would drift.
   */
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

  /*
   * The whole list, once, rather than a request per month.
   *
   * A studio declares a dozen or two holidays a year, so this is a small list however many years
   * it has been kept for — and paging the month is then instant and offline, which is what makes
   * "has the studio already declared something that week" a question worth asking here.
   */
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await getHolidays();
      setHolidays(Array.isArray(response?.data) ? response.data : []);
    } catch (error) {
      onError?.(error.message || "Unable to load the holidays.");
    } finally {
      setLoading(false);
    }
  }, [onError]);

  // Deferred a tick, the way every other Settings panel starts its first load: a fetch begun in
  // the effect body counts as state set during the effect.
  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  /** The declared days, by `YYYY-MM-DD`. One holiday per day — the column itself is unique. */
  const byDay = useMemo(() => new Map(holidays.map((holiday) => [holiday.date, holiday])), [holidays]);
  const grid = useMemo(() => monthGrid(month), [month]);
  const todayKey = dayKeyOf(new Date());

  /** This month's holidays, in date order, for the list under the grid. */
  const thisMonth = useMemo(() => {
    const prefix = `${month.getFullYear()}-${pad(month.getMonth() + 1)}`;
    return holidays.filter((holiday) => String(holiday.date || "").startsWith(prefix));
  }, [holidays, month]);

  const stepMonth = (offset) => setMonth((current) => new Date(current.getFullYear(), current.getMonth() + offset, 1));

  /** Opening a day: its holiday to be edited, or a blank one to be declared on it. */
  function openDay(key) {
    if (!canWrite) return;
    const existing = byDay.get(key);
    setDraft(existing ? { ...existing } : { id: null, date: key, name: "" });
  }

  async function saveDraft() {
    if (!draft || saving) return;
    const name = String(draft.name || "").trim();
    if (!name || !draft.date) return;
    setSaving(true);
    try {
      if (draft.id) await updateHoliday(draft.id, { date: draft.date, name });
      else await createHoliday({ date: draft.date, name });
      setDraft(null);
      await load();
      onNotice?.(`${name} on ${formatDay(draft.date)} saved. It is now a holiday for everybody.`);
    } catch (error) {
      onError?.(error.message || "Unable to save this holiday.");
    } finally {
      setSaving(false);
    }
  }

  async function removeHoliday() {
    if (!pendingDelete || deleting) return;
    setDeleting(true);
    try {
      await deleteHoliday(pendingDelete.id);
      setPendingDelete(null);
      setDraft(null);
      await load();
      onNotice?.(`${pendingDelete.name} removed. ${formatDay(pendingDelete.date)} is an ordinary working day again.`);
    } catch (error) {
      onError?.(error.message || "Unable to remove this holiday.");
    } finally {
      setDeleting(false);
    }
  }

  const draftName = String(draft?.name || "").trim();

  return <div className="space-y-3">
    <p className="text-xs text-slate-500 sm:text-sm">
      The days the studio is closed. A day declared here shows as a holiday on everybody&rsquo;s{" "}
      <span className="font-medium text-slate-700">Calendar</span>, and attendance counts it as a holiday
      rather than an absence — it is taken out of the hours every employee&rsquo;s range asks for.
      {canWrite
        ? " Click a day to declare it, or an existing holiday to rename, move or remove it."
        : " Changing them needs System Settings write access."}
    </p>

    {/* The month, its steppers, and the way back to today for anybody who has paged too far. */}
    <div className="flex flex-wrap items-center gap-2 rounded-t-xl border border-slate-200 bg-slate-50 px-2 py-2 sm:gap-3 sm:px-3">
      <IconButton variant="ghost" ariaLabel="Previous month" onClick={() => stepMonth(-1)}>
        <ChevronLeftRoundedIcon sx={{ fontSize: 20 }} />
      </IconButton>
      <IconButton variant="ghost" ariaLabel="Next month" onClick={() => stepMonth(1)}>
        <ChevronRightRoundedIcon sx={{ fontSize: 20 }} />
      </IconButton>
      <span className="text-xs font-semibold text-slate-800 sm:text-sm">{monthFormat.format(month)}</span>
      <Button type="button" size="sm" className="ml-auto" onClick={() => setMonth(firstOfMonth(new Date()))}>Today</Button>
      {canWrite && <Button
        type="button"
        variant="primary"
        size="sm"
        // Starts on the month being read rather than on today, which is where somebody paging
        // forward to plan next year's holidays actually is.
        onClick={() => setDraft({ id: null, date: dayKeyOf(month), name: "" })}
      >
        Add holiday
      </Button>}
    </div>

    <div className="-mt-3 overflow-hidden rounded-b-xl border border-t-0 border-slate-200">
      <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50 text-[10px] font-semibold uppercase tracking-wide text-slate-500 sm:text-[11px]">
        {SCHEDULE_WEEKDAYS.map((label) => (
          // Only the first letter at phone width: seven three-letter headings do not fit 360px
          // without the grid scrolling sideways, and the column order is what they are for.
          <div key={label} className="px-1 py-1.5 text-center sm:px-3">
            <span className="sm:hidden">{label.slice(0, 1)}</span>
            <span className="hidden sm:inline">{label}</span>
          </div>
        ))}
      </div>

      {loading ? (
        <div className="flex min-h-[16rem] items-center justify-center"><Loader /></div>
      ) : (
        <div className="grid grid-cols-7">
          {grid.map((cell) => {
            const holiday = byDay.get(cell.key);
            const isToday = cell.key === todayKey;
            /*
             * A day is a button only where it can be pressed. Without write there is nothing for a
             * click to open, so a read-only calendar is a calendar: no focus stops to tab through
             * and no hover promising something that will not happen.
             */
            const Cell = canWrite ? "button" : "div";
            return (
              <Cell
                key={cell.key}
                {...(canWrite ? {
                  type: "button",
                  onClick: () => openDay(cell.key),
                  "aria-label": holiday
                    ? `Edit ${holiday.name} on ${formatDay(cell.key)}`
                    : `Declare a holiday on ${formatDay(cell.key)}`,
                } : {})}
                className={`flex min-h-[4.5rem] flex-col gap-1 border-b border-r border-slate-200 p-1 text-left transition last:border-r-0 sm:min-h-[6rem] ${
                  canWrite ? "cursor-pointer hover:bg-rose-50/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-rose-300" : ""
                } ${cell.outside ? "bg-slate-50/60" : "bg-white"}`}
              >
                <span
                  className={`inline-flex h-5 min-w-5 shrink-0 items-center justify-center self-start rounded-full px-1 text-[11px] ${
                    isToday ? "bg-blue-600 font-semibold text-white" : cell.outside ? "text-slate-300" : "text-slate-500"
                  }`}
                >
                  {cell.date.getDate()}
                </span>
                {/* The same rose the studio calendar draws a holiday in, so the day somebody
                    declares here is recognisably the day they will see there. */}
                {holiday && <span className="block truncate rounded bg-rose-50 px-1 py-0.5 text-[10px] font-medium leading-4 text-rose-800 sm:text-[11px]">
                  {holiday.name}
                </span>}
              </Cell>
            );
          })}
        </div>
      )}
    </div>

    {/* What the month holds, written out. The grid answers "when"; this answers "what", which is
        the reading somebody doing a year's planning actually wants — and at 360px a truncated
        chip in a cell is not a name anybody can read. */}
    <div className="text-xs text-slate-600 sm:text-sm">
      {loading ? null : thisMonth.length === 0 ? (
        <p className="text-slate-500">No holidays declared in {monthFormat.format(month)}.</p>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
          {thisMonth.map((holiday) => (
            <li key={holiday.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
              <span className="min-w-0">
                <span className="font-medium text-slate-800">{holiday.name}</span>
                <span className="block text-[11px] text-slate-500 sm:text-xs">{formatDay(holiday.date)}</span>
              </span>
              {canWrite && <span className="flex shrink-0 items-center gap-2">
                <Button type="button" size="sm" onClick={() => setDraft({ ...holiday })}>Edit</Button>
                <Button type="button" size="sm" variant="danger" onClick={() => setPendingDelete(holiday)}>Remove</Button>
              </span>}
            </li>
          ))}
        </ul>
      )}
    </div>

    {draft && <Dialog
      title={draft.id ? "Edit holiday" : "Declare a holiday"}
      description={draft.id
        ? "Rename it or move it to another day. Everybody's calendar and every hours target follow."
        : "The studio is closed on this day. It shows on everybody's calendar and is taken out of every hours target."}
      // Over the Settings panel this is opened from, rather than under it.
      layer="dialogOverPanel"
      busy={saving}
      onClose={() => (saving ? null : setDraft(null))}
      /*
       * Saved by a button rather than by submitting a form.
       *
       * `Dialog` draws itself as a <form> the moment it is given an `onSubmit`, and this dialog is
       * rendered inside the Settings overlay, which is already a form. A form inside a form is not
       * HTML a browser will honour - React refuses to hydrate it - and the submit would escape to
       * the overlay's own handler. Enter in the name field saves through `onKeyDown` instead, so
       * the keyboard still works the way a form would have made it.
       */
      footer={<>
        {draft.id && <Button
          type="button"
          variant="danger"
          className="mr-auto max-sm:flex-1"
          disabled={saving}
          onClick={() => setPendingDelete(draft)}
        >
          Remove
        </Button>}
        <Button type="button" className="max-sm:flex-1" disabled={saving} onClick={() => setDraft(null)}>Cancel</Button>
        <Button
          type="button"
          variant="primary"
          className="max-sm:flex-1"
          disabled={saving || !draftName || !draft.date}
          onClick={() => void saveDraft()}
        >
          {saving ? "Saving..." : draft.id ? "Save holiday" : "Declare holiday"}
        </Button>
      </>}
    >
      <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
        <DateField
          label="Day"
          value={draft.date}
          onChange={(value) => setDraft((current) => ({ ...current, date: value }))}
        />
        <TextField
          label="Name"
          value={draft.name}
          placeholder="Diwali"
          maxLength={150}
          onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
          // What a form would have given for free; see the note on the dialog above.
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            void saveDraft();
          }}
        />
      </div>
    </Dialog>}

    <ConfirmDialog
      open={Boolean(pendingDelete)}
      title="Remove this holiday?"
      message={pendingDelete
        ? `${pendingDelete.name} on ${formatDay(pendingDelete.date)} becomes an ordinary working day again, for everybody.`
        : ""}
      confirmLabel="Remove holiday"
      busyLabel="Removing..."
      loading={deleting}
      layer="dialogOverPanel"
      onCancel={() => (deleting ? null : setPendingDelete(null))}
      onConfirm={() => void removeHoliday()}
    />
  </div>;
}
