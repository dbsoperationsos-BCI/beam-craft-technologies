"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import ChevronLeftRoundedIcon from "@mui/icons-material/ChevronLeftRounded";
import ChevronRightRoundedIcon from "@mui/icons-material/ChevronRightRounded";
import Button from "@/components/shared/Button";
import DateField from "@/components/shared/DateField";
import Dropdown from "@/components/shared/Dropdown";
import HelpTip from "@/components/shared/HelpTip";
import IconButton from "@/components/shared/IconButton";
import Loader from "@/components/shared/Loader";
import MultiSelectField from "@/components/shared/MultiSelectField";
import TextField from "@/components/shared/TextField";
import useFormErrors from "@/components/shared/useFormErrors";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import Dialog from "@/components/ui/Dialog";
import { monthGrid, SCHEDULE_WEEKDAYS } from "@/lib/schedule";
import { createHoliday, deleteHoliday, getHolidayBranches, getHolidays, updateHoliday } from "@/services/settings/holidays.service";

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
 *
 * ── Whose holiday ──────────────────────────────────────────────────────────────────────────────
 *
 * A holiday is the studio's - every branch - or some branches' alone, and the dialog asks which
 * ("Holiday applies to"). The branches offered are the ones the login's role reaches for this
 * permission, read from the server rather than typed here, and the studio-wide choice is offered
 * only to somebody reaching every branch; the server refuses anything else regardless. Two branches
 * may each have a holiday on one day, so a day holds a list rather than one holiday, and the filter
 * above the calendar narrows the month to one branch's view (its own holidays and the studio's).
 */

const ALL = "all";
const SCOPE_OPTIONS = [
  { value: ALL, label: "All branches" },
  { value: "branches", label: "Specific branches" },
];
/** Which holidays a branch observes: the studio's, and its own. `ALL` is every holiday there is. */
const observedBy = (holiday, branchId) => branchId === ALL || holiday.allBranches || (holiday.branchIds || []).includes(Number(branchId));
/** Whose a holiday is, in a line that fits a notice: the studio's, or up to three branches and "N more". */
function scopeWords(holiday, branchNames = new Map()) {
  if (!holiday || holiday.allBranches !== false) return "everybody";
  const names = (holiday.branches || []).map((branch) => branch.name).filter(Boolean);
  const listed = names.length ? names : (holiday.branchIds || []).map((id) => branchNames.get(String(id))).filter(Boolean);
  if (!listed.length) return holiday.scopeLabel || "the chosen branches";
  return listed.length <= 3 ? listed.join(", ") : `${listed.slice(0, 3).join(", ")} and ${listed.length - 3} more`;
}

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
   * The branches this login may declare for, and whether "All branches" is theirs to choose -
   * answered by the server from the role's reach, so the picker never offers what the save would
   * refuse. Read once with the list; a read-only viewer needs neither and is not asked.
   */
  const [branchChoices, setBranchChoices] = useState({ branches: [], viewable: [], allBranches: false, ready: false });
  // The month as one branch sees it, or every holiday there is - for whoever reads for several.
  const [viewBranch, setViewBranch] = useState(ALL);
  // A day holding several holidays, opened: which of them to edit, or another to declare.
  const [dayChooser, setDayChooser] = useState(null);
  const fields = useFormErrors();
  const closeDraft = () => { setDraft(null); fields.clearAll(); };
  // A field changed in the dialog: the draft takes it and its red clears.
  const setDraftField = (name, value) => { fields.clear(name); setDraft((current) => ({ ...current, [name]: value })); };

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
      /*
       * Read for everybody, not only writers: a reader whose roles reach several branches uses the
       * list to read the month as one of them. A failure is said, and until the answer is in no
       * holiday can be declared - the safe default is "not allowed", never "all branches".
       */
      const [response, choices] = await Promise.all([
        getHolidays(),
        getHolidayBranches().catch((error) => { onError?.(error.message || "Unable to load your branches, so holidays cannot be declared right now."); return null; }),
      ]);
      setHolidays(Array.isArray(response?.data) ? response.data : []);
      if (choices?.data) {
        setBranchChoices({
          branches: Array.isArray(choices.data.branches) ? choices.data.branches : [],
          viewable: Array.isArray(choices.data.viewable) ? choices.data.viewable : [],
          allBranches: choices.data.allBranches === true,
          ready: true,
        });
      }
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

  /** The holidays as the chosen branch sees them: its own and the studio's, or every one for `ALL`. */
  const shown = useMemo(() => holidays.filter((holiday) => observedBy(holiday, viewBranch)), [holidays, viewBranch]);
  /** The declared days, by `YYYY-MM-DD`, each holding every holiday on it - two branches may each have one. */
  const byDay = useMemo(() => {
    const map = new Map();
    for (const holiday of shown) map.set(holiday.date, [...(map.get(holiday.date) || []), holiday]);
    return map;
  }, [shown]);
  const grid = useMemo(() => monthGrid(month), [month]);
  const todayKey = dayKeyOf(new Date());

  /** This month's holidays, in date order, for the list under the grid. */
  const thisMonth = useMemo(() => {
    const prefix = `${month.getFullYear()}-${pad(month.getMonth() + 1)}`;
    return shown.filter((holiday) => String(holiday.date || "").startsWith(prefix));
  }, [shown, month]);

  // The branches a reader may narrow the month to: the ones whose holidays they may see. One
  // branch or none is nothing to choose between, so the filter is absent then.
  const viewOptions = useMemo(() => [{ value: ALL, label: "All holidays" }, ...branchChoices.viewable.map((branch) => ({ value: String(branch.id), label: branch.name }))], [branchChoices.viewable]);
  const branchOptions = useMemo(() => branchChoices.branches.map((branch) => ({ value: String(branch.id), label: branch.name })), [branchChoices.branches]);
  const branchNames = useMemo(() => new Map([...branchChoices.branches, ...branchChoices.viewable].map((branch) => [String(branch.id), branch.name])), [branchChoices]);
  // Nothing can be declared until the server has said which branches this login may declare for.
  const canDeclare = canWrite && branchChoices.ready && (branchChoices.allBranches || branchOptions.length > 0);
  /**
   * A blank holiday on `date`, scoped as the reader is looking: the branch the month is being read
   * as, where it is one this login may declare for; otherwise the studio's, where that is theirs to
   * choose; otherwise nothing chosen yet, which the form asks for before it saves.
   */
  const blankDraft = useCallback((date) => {
    const viewing = viewBranch !== ALL && branchOptions.some((option) => option.value === viewBranch) ? [viewBranch] : [];
    const allBranches = branchChoices.allBranches && !viewing.length;
    return { id: null, date, name: "", allBranches, branchIds: allBranches ? [] : viewing };
  }, [branchChoices.allBranches, branchOptions, viewBranch]);
  /** A saved holiday as the form holds it: ids as the picker's strings. */
  const draftOf = (holiday) => ({ ...holiday, allBranches: holiday.allBranches !== false, branchIds: (holiday.branchIds || []).map(String) });
  /** The picker's list for a draft: the branches this login may declare for, plus any the holiday already names. */
  const optionsFor = (current) => {
    const known = new Set(branchOptions.map((option) => option.value));
    const own = (current?.branches || []).filter((branch) => !known.has(String(branch.id))).map((branch) => ({ value: String(branch.id), label: branch.name }));
    return [...branchOptions, ...own];
  };

  const stepMonth = (offset) => setMonth((current) => new Date(current.getFullYear(), current.getMonth() + offset, 1));

  /**
   * Opening a day: its one holiday to be edited, a blank one to be declared on it, or - where it
   * already holds several - a chooser naming each of them, since a cell cannot say which one a
   * click meant.
   */
  function openDay(key) {
    if (!canDeclare) return;
    const existing = byDay.get(key) || [];
    if (existing.length > 1) return setDayChooser(key);
    setDraft(existing.length === 1 && existing[0].canEdit !== false ? draftOf(existing[0]) : blankDraft(key));
  }

  const draftScope = draft ? (draft.allBranches ? { allBranches: true, branchIds: [] } : { allBranches: false, branchIds: (draft.branchIds || []).map(Number) }) : null;

  async function saveDraft() {
    if (!draft || saving) return;
    const name = String(draft.name || "").trim();
    if (!fields.check({
      date: draft.date ? "" : "Choose the day.",
      name: name ? "" : "Enter the holiday's name.",
      branchIds: !draft.allBranches && !(draft.branchIds || []).length ? "Choose at least one branch." : "",
    })) return;
    setSaving(true);
    try {
      if (draft.id) await updateHoliday(draft.id, { date: draft.date, name, ...draftScope });
      else await createHoliday({ date: draft.date, name, ...draftScope });
      closeDraft();
      await load();
      onNotice?.(`${name} on ${formatDay(draft.date)} saved. It is now a holiday for ${scopeWords({ ...draft, allBranches: draft.allBranches, branches: [] }, branchNames)}.`);
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
      closeDraft();
      await load();
      onNotice?.(`${pendingDelete.name} removed. ${formatDay(pendingDelete.date)} is an ordinary working day again for ${scopeWords(pendingDelete, branchNames)}.`);
    } catch (error) {
      onError?.(error.message || "Unable to remove this holiday.");
    } finally {
      setDeleting(false);
    }
  }

  return <div className="space-y-3">
    {/* The month, its steppers, and the way back to today for anybody who has paged too far. */}
    <div className="flex flex-wrap items-center gap-2 rounded-t-xl border border-slate-200 bg-slate-50 px-2 py-2 sm:gap-3 sm:px-3">
      <IconButton variant="ghost" ariaLabel="Previous month" onClick={() => stepMonth(-1)}>
        <ChevronLeftRoundedIcon sx={{ fontSize: 20 }} />
      </IconButton>
      <IconButton variant="ghost" ariaLabel="Next month" onClick={() => stepMonth(1)}>
        <ChevronRightRoundedIcon sx={{ fontSize: 20 }} />
      </IconButton>
      {/* How the month below is used, beside its name; what holidays are is the page's own ⓘ. */}
      <span className="flex items-center text-xs font-semibold text-slate-800 sm:text-sm">
        {monthFormat.format(month)}
        <HelpTip text={`A holiday shows on the Calendar of the branches it applies to, and attendance counts it as a holiday, not an absence, for them.${canWrite ? " Click a day to declare a holiday, or click a holiday to change it." : " Changing them needs System Settings write access."}`} />
      </span>
      {/* The month as one branch sees it. Only where there is more than one branch to see it as. */}
      {viewOptions.length > 2 && <Dropdown
        hideLabel
        label="Show holidays for"
        sorted={false}
        searchable={false}
        // Its own row on a phone, where the month's steppers and buttons already fill the first.
        className="w-full sm:ml-auto sm:w-44"
        value={viewBranch}
        onChange={(value) => setViewBranch(value || ALL)}
        options={viewOptions}
      />}
      <Button type="button" size="sm" className={viewOptions.length > 2 ? "sm:ml-0 max-sm:ml-auto" : "ml-auto"} onClick={() => setMonth(firstOfMonth(new Date()))}>Today</Button>
      {canDeclare && <Button
        type="button"
        variant="primary"
        size="sm"
        // Starts on the month being read rather than on today, which is where somebody paging
        // forward to plan next year's holidays actually is.
        onClick={() => setDraft(blankDraft(dayKeyOf(month)))}
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
            const onDay = byDay.get(cell.key) || [];
            const holiday = onDay[0] || null;
            const isToday = cell.key === todayKey;
            /*
             * A day is a button only where it can be pressed. Without write there is nothing for a
             * click to open, so a read-only calendar is a calendar: no focus stops to tab through
             * and no hover promising something that will not happen.
             */
            const Cell = canDeclare ? "button" : "div";
            return (
              <Cell
                key={cell.key}
                {...(canDeclare ? {
                  type: "button",
                  onClick: () => openDay(cell.key),
                  "aria-label": onDay.length === 1
                    ? `${holiday.canEdit === false ? "Declare another holiday on" : `Edit ${holiday.name} on`} ${formatDay(cell.key)}`
                    : onDay.length > 1
                      ? `Choose which of the ${onDay.length} holidays on ${formatDay(cell.key)} to change`
                      : `Declare a holiday on ${formatDay(cell.key)}`,
                } : {})}
                className={`flex min-h-[4.5rem] flex-col gap-1 border-b border-r border-slate-200 p-1 text-left transition last:border-r-0 sm:min-h-[6rem] ${
                  canDeclare ? "cursor-pointer hover:bg-rose-50/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-rose-300" : ""
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
                {onDay.slice(0, 2).map((entry) => <span key={entry.id} className="block truncate rounded bg-rose-50 px-1 py-0.5 text-[10px] font-medium leading-4 text-rose-800 sm:text-[11px]" title={`${entry.name} · ${entry.scopeLabel || "All branches"}`}>
                  {entry.name}
                  {/* Whose it is, on every screen: a branch's day off reads differently from the
                      studio's, and a phone has no hover to find that out from. */}
                  {entry.allBranches === false && <span className="font-normal text-rose-600"> · {entry.scopeLabel}</span>}
                </span>)}
                {onDay.length > 2 && <span className="block text-[10px] text-slate-500">+{onDay.length - 2} more below</span>}
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
        <p className="text-slate-500">
          No holidays {viewBranch !== ALL ? `for ${branchNames.get(viewBranch) || "this branch"} ` : ""}declared in {monthFormat.format(month)}.
          {viewBranch !== ALL && <> <button type="button" className="font-medium text-blue-600 hover:text-blue-700" onClick={() => setViewBranch(ALL)}>Show all holidays</button></>}
        </p>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
          {thisMonth.map((holiday) => (
            <li key={holiday.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
              <span className="min-w-0">
                <span className="font-medium text-slate-800">{holiday.name}</span>
                <span className="block text-[11px] text-slate-500 sm:text-xs">{formatDay(holiday.date)} · {holiday.scopeLabel || "All branches"}</span>
              </span>
              {/* Absent, not disabled, where this login's reach does not cover the holiday - the
                  server would refuse the save, so the control is not offered. */}
              {canDeclare && holiday.canEdit !== false && <span className="flex shrink-0 items-center gap-2">
                <Button type="button" size="sm" onClick={() => setDraft(draftOf(holiday))}>Edit</Button>
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
        ? "Rename it, move it to another day, or change whose it is. The calendars and hours targets of everybody it applies to follow."
        : "Closed on this day for the branches chosen below. It shows on their calendars and is taken out of their hours targets."}
      // Over the Settings panel this is opened from, rather than under it.
      layer="dialogOverPanel"
      busy={saving}
      onClose={() => (saving ? null : closeDraft())}
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
          className="max-sm:flex-1"
          disabled={saving}
          onClick={() => setPendingDelete(draft)}
        >
          Remove
        </Button>}
        <Button type="button" className="max-sm:flex-1" disabled={saving} onClick={closeDraft}>Cancel</Button>
        <Button
          type="button"
          variant="primary"
          className="max-sm:flex-1"
          disabled={saving}
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
          onChange={(value) => setDraftField("date", value)}
          error={fields.errors.date}
          helperText="Attendance counts this day as a holiday, not an absence."
        />
        <TextField
          label="Name"
          value={draft.name}
          placeholder="Diwali"
          maxLength={150}
          helperText="Shown on the Calendar of every branch it applies to."
          onChange={(event) => setDraftField("name", event.target.value)}
          error={fields.errors.name}
          // What a form would have given for free; see the note on the dialog above.
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            void saveDraft();
          }}
        />
        {/* Whose holiday. "All branches" is offered only to somebody reaching every branch; the
            picker lists the branches the role reaches, from the server, never typed here. */}
        <Dropdown
          label="Holiday applies to"
          searchable={false}
          sorted={false}
          helperText="Choose every branch, or only the branches closed that day."
          value={draft.allBranches ? ALL : "branches"}
          // Flipping to Specific branches ticks nothing for the reader: a branch picked for them
          // is one they could save without noticing, and the field asks for one before it saves.
          onChange={(value) => { fields.clear("branchIds"); setDraft((current) => ({ ...current, allBranches: value === ALL, branchIds: value === ALL ? [] : current.branchIds || [] })); }}
          options={branchChoices.allBranches || draft.allBranches ? SCOPE_OPTIONS : SCOPE_OPTIONS.filter((option) => option.value !== ALL)}
        />
        {!draft.allBranches && <MultiSelectField
          label="Branches"
          required
          searchable
          placeholder="Choose the branches"
          values={draft.branchIds || []}
          options={optionsFor(draft)}
          helperText="Only these branches see the holiday; the rest work as usual."
          error={fields.errors.branchIds}
          onChange={(values) => setDraftField("branchIds", values)}
        />}
      </div>
    </Dialog>}

    {/* A day holding several holidays: which to change, or another to declare. Each is named
        with whose it is, so "Diwali · Madurai" is never mistaken for the studio's. */}
    {dayChooser && <Dialog
      title={`Holidays on ${formatDay(dayChooser)}`}
      description="Choose the holiday to change, or declare another for different branches."
      layer="dialogOverPanel"
      size="sm"
      onClose={() => setDayChooser(null)}
      footer={<>
        <Button type="button" className="max-sm:flex-1" onClick={() => setDayChooser(null)}>Close</Button>
        <Button type="button" variant="primary" className="max-sm:flex-1" onClick={() => { setDayChooser(null); setDraft(blankDraft(dayChooser)); }}>Declare another</Button>
      </>}
    >
      <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
        {(byDay.get(dayChooser) || []).map((holiday) => <li key={holiday.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
          <span className="min-w-0">
            <span className="font-medium text-slate-800">{holiday.name}</span>
            <span className="block text-[11px] text-slate-500 sm:text-xs">{holiday.scopeLabel || "All branches"}</span>
          </span>
          {holiday.canEdit !== false && <Button type="button" size="sm" onClick={() => { setDayChooser(null); setDraft(draftOf(holiday)); }}>Edit</Button>}
        </li>)}
      </ul>
    </Dialog>}

    <ConfirmDialog
      open={Boolean(pendingDelete)}
      title="Remove this holiday?"
      message={pendingDelete
        ? `${pendingDelete.name} on ${formatDay(pendingDelete.date)} becomes an ordinary working day again, for ${scopeWords(pendingDelete, branchNames)}.`
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
