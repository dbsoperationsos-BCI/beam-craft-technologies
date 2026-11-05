"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ModulePageHeader from "@/components/layout/ModulePageHeader";
import { useModuleAccess, usePermissions } from "@/components/auth/PermissionsProvider";
import { useRouter } from "next/navigation";
import DataTableShell from "@/components/data-table/DataTableShell";
import DataTable from "@/components/data-table/DataTable";
import { ACTIONS_COLUMN } from "@/components/data-table/tableCells";
import TableFooter from "@/components/data-table/TableFooter";
import InfoPanelShell from "@/components/data-table/InfoPanelShell";
import OptionsMenu from "@/components/ui/OptionsMenu";
import Button from "@/components/shared/Button";
import IconButton from "@/components/shared/IconButton";
import Dropdown from "@/components/shared/Dropdown";
import ScheduleMeetDialog from "@/components/sales/ScheduleMeetDialog";
import MeetingReminders from "@/components/sales/MeetingReminders";
import FloatingNotice, { useNotice } from "@/components/shared/FloatingNotice";
import useStickyTab from "@/components/shared/useStickyTab";
import ChevronLeftRoundedIcon from "@mui/icons-material/ChevronLeftRounded";
import ChevronRightRoundedIcon from "@mui/icons-material/ChevronRightRounded";
import { apiRequest } from "@/lib/apiClient";
import { resolveVertical } from "@/lib/crmOptions";
import {
  DEFAULT_MEETING_TAB,
  MEETING_TABS,
  MEETING_TAB_IDS,
  dayKey,
  formatMeetingDate,
  formatMeetingTime,
  formatMeetingWhen,
  inMeetingTab,
  isCancelled,
  meetingLeadName,
  meetingRange,
  meetingTabEmptyMessage,
  meetingTabSortDirection,
  meetingTitle,
} from "@/lib/meetings";
// What the list is a list of: the sources the header switch offers, the rows each one holds and the
// columns that say something about them. Kept out of the page so `node --test` can hold the rules
// to account without rendering a table.
import {
  DEFAULT_MEETING_SOURCE,
  PROJECT_SOURCES,
  formatDuration,
  guestList,
  meetingSourceLabel,
  meetingStatusLabel,
  permittedSources,
  rowDateText,
  rowTitle,
  sourceColumns,
  sourceEmptyMessage,
  sourceRows,
  sourceScheduleEntries,
} from "@/lib/meetingSources";
import { monthGrid, scheduleByDay, scheduleEntryCell, scheduleEntryLead, scheduleKind, SCHEDULE_WEEKDAYS } from "@/lib/schedule";
import { getSchedule } from "@/services/schedule/schedule.service";
import { getSalesProjects } from "@/services/sales/projects.service";
// The one place that knows how a shoot's length reads - "2h 0m", "10-12 Hours (Full)" - so the
// calendar says it exactly as the shoot list and the project info panel do.
import { formatSessionTiming } from "@/components/project-management/AddShootDialog";
import { applyFiltersAndSort, buildFilterOptions, columnValue } from "@/lib/tableColumns";
import { createExportFileName, exportToCsv } from "@/lib/tableExport";
import useEscapeKey from "@/components/shared/useEscapeKey";

/**
 * Meetings: the studio's diary, in one place.
 *
 * The CRM books meetings a lead at a time, which answers "what is booked for this lead" but
 * never "what is booked this week". This page is the second question - the whole schedule,
 * read either as a month at a glance or as a table that can be filtered and exported.
 *
 * Two views, one diary. Calendar draws every kind of booking as a month; List is the CRM's own
 * table - the same sortable headers, column filters, pinned actions column, footer and info panel
 * the lead table uses - read through two switches in the header and four tabs under it:
 *
 *   * **which source**, in the header: All, Projects, either production stage, or Meetings. Only
 *     the sources this viewer's own permissions reach are offered, and each brings its own columns;
 *   * **when**, in the tabs: All, Today, Upcoming, Past, each carrying its count.
 *
 * Read only apart from two things: Add Meet books a meeting, and a row can be cancelled. Both
 * go through the lead's own meeting endpoints, which own the Google Calendar side. A project row
 * is read here and worked on in Project Management, which its actions link to.
 */

const VIEW_OPTIONS = [
  { value: "calendar", label: "Calendar view" },
  { value: "list", label: "List view" },
];

// The CRM's own status colours, so a meeting reads the same way a lead does.
const STATUS_DOTS = {
  Scheduled: "bg-[#0b60ff]",
  Cancelled: "bg-[#8f9097]",
};

/*
 * The two header switches, sized the way every other `mode="switch"` Dropdown in the app is.
 *
 * No box around either of them. `mode="switch"` is deliberately a bare label and a chevron - the
 * CRM's own vertical switch, the one this header is modelled on, draws no border at all - and the
 * outline these two briefly carried was this page inventing a control the design system does not
 * have.
 *
 * Only the width is set, and only so the control cannot resize under the reader: moving from "All"
 * to "Post Production", or from "List view" to "Calendar view", must not shift the tabs beneath or
 * nudge Add Meet sideways. The trigger keeps its own natural width inside that, so the chevron sits
 * against its label rather than being pushed to a far edge with nothing between.
 */
// Against the title, so it carries the same left divider the CRM's vertical switch does - it is
// what separates the switch from the heading it sits beside.
//
// Wide enough for the longest label, which is "Employee Attendance" rather than "Post Production".
// The menu takes its width from the control, so a control sized to the second-longest wrapped that
// entry onto two lines and left the list ragged - the one place a switch has to be easy to read
// down.
const SOURCE_SWITCH_CLASS = "w-[13.5rem] shrink-0 border-l border-slate-200 pl-3";
// In the action row, where the gap between controls already separates it from Nebula and there is
// nothing for a divider to divide.
const VIEW_SWITCH_CLASS = "w-[10rem] shrink-0";

// Monday first, the way a working week is read here and what en-GB formatting assumes.
// The headings and the grid under them are `lib/schedule`'s, so the Settings holiday calendar
// draws the same month this one does rather than a second month shaped slightly differently.
const WEEKDAY_LABELS = SCHEDULE_WEEKDAYS;

// How many bookings a day cell shows before it stops and counts the rest. Three rather than the
// four this held while a chip was one line: a chip now carries a second line for where the shoot
// is, and four of those made a busy week's row twice the height of a quiet one's.
/*
 * How many chips a day cell shows before it starts scrolling.
 *
 * A height rather than a cap on what is drawn: every booking is rendered and the cell scrolls to the
 * rest, so nothing is out of reach. This number is only what the corner count is compared against -
 * a day holding no more than fits does not need to say how many it holds.
 */
const VISIBLE_PER_DAY_CELL = 3;

/*
 * ── The Schedule's rows, drawn by `DataTable` ─────────────────────────────────────────────────
 *
 * The Schedule used to be its own `<table>`, like the CRM board: a header row, a filter row, its
 * own tick boxes and its own Manage Columns, each a second copy of what `DataTable` draws for every
 * other table. It draws through the shared table now, and what stays here is what only this screen
 * knows: what a cell says (`columnValue`), that a cancelled meeting is greyed and struck through,
 * and what the row menu offers.
 */

/** The row's identity, module-level so the memoised rows are never rebuilt for a fresh arrow. */
const scheduleRowId = (row) => row.id;
/** What the tick box calls its row. */
const scheduleRowLabel = (row) => row.title || "this row";

/**
 * One Schedule cell.
 *
 * Only a meeting can be cancelled, and only a cancelled row is greyed and its title struck through
 * - a project's own status says where it stands in words. A meeting's status carries the 8px dot
 * the CRM lead table uses; a project's status is one of ten words, and a dot per word says nothing
 * the word does not already.
 */
function ScheduleCell({ column, row }) {
  const cancelled = Boolean(row.meeting) && isCancelled(row.meeting);
  const value = columnValue(column, row);
  if (column.id === "status" && row.meeting) {
    return (
      <span className={`inline-flex items-center gap-2 font-normal ${cancelled ? "text-slate-400" : ""}`}>
        <span className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOTS[value] || "bg-slate-400"}`} />
        <span>{value || "—"}</span>
      </span>
    );
  }
  if (column.id === "title" && cancelled) return <span className="text-slate-400 line-through">{value || "—"}</span>;
  return cancelled ? <span className="text-slate-400">{value || "—"}</span> : (value || "—");
}

/**
 * When a calendar entry happens, in words.
 *
 * The three kinds answer this differently and honestly. A meeting is a moment, so it reads as a
 * date and a clock range. A shoot is a day and a length - the studio books "2h 0m" or a half
 * session, not 10:00 to 12:00 - unless an event start and end have actually been fixed on it, in
 * which case those are what it runs. A main event is a date and nothing else.
 *
 * The shoot's length goes through `formatSessionTiming`, which is the one place that knows how the
 * studio words a session, so a shoot reads here exactly as it does on the shoot list.
 *
 * An interview is the fourth answer and none of those: a day *and* an hour, kept as two text
 * columns with no instant behind them, so it reads as the date and the clock time the register
 * wrote rather than being formatted back out of a `Date` that would carry a zone it never had.
 */
function entryTiming(entry) {
  if (entry.kind === "meeting") return formatMeetingWhen(entry.startAt, entry.endAt);
  const on = entry.day ? formatMeetingDate(`${entry.day}T00:00:00`) : "";
  // A main event and a holiday are both a plain day. The lines below are the shoot's, which reads
  // a session length out of `meta` - a holiday has no meta at all and would fall through them.
  if (entry.kind === "project" || entry.kind === "holiday") return on;
  if (entry.kind === "interview") return [on, entry.meta?.clock].filter(Boolean).join(" · ");
  const fixed = [entry.meta?.eventStartTime, entry.meta?.eventEndTime].filter(Boolean).join(" – ");
  const length = fixed || formatSessionTiming(entry.meta || {});
  return [on, length].filter((part) => part && part !== "—").join(" · ");
}

/** Everything about an entry that will not fit in a day cell, for its hover title. */
function entryTooltip(entry) {
  // Whose it is, in the kind's own word: a shoot has an owner, an interview has an interviewer.
  const owner = entry.owner && `${entry.kind === "interview" ? "Interviewer" : "Owner"}: ${entry.owner}`;
  return [entryTiming(entry), entry.title, entry.reference, entry.location, owner]
    .filter(Boolean)
    .join(" · ");
}

export default function MeetingsPage() {
  /*
   * What this viewer may do *with meetings*, asked for by name rather than taken from the route.
   *
   * The route has no permission any more - the calendar is open to everybody in the studio, since
   * a declared holiday is everybody's business - so `useRouteAccess` would answer "yes" to every
   * question here, and an employee would be offered an Add Meet button the CRM's own endpoint then
   * refused. The meetings on this screen still answer for SALES / CRM Leads: Read to be sent them
   * at all, Read / Write to schedule or cancel one.
   */
  const { canRead: canReadMeetings, canWrite } = useModuleAccess("SALES", "CRM Leads");
  const router = useRouter();
  // Whether a shoot or a main event on the calendar can be followed to its project. The board has
  // its own permission, and sending somebody to a screen that will refuse them is worse than
  // showing them what the calendar already knows.
  const { hasPermission } = usePermissions();
  const canOpenProjects = hasPermission("PROJECT", "Projects", "READ");
  /*
   * Which sources the List view may offer this viewer, in the header switch's own order.
   *
   * Every source is fed by an endpoint the viewer's permission already guards, so this is a
   * narrowing rather than a grant: it stops a source being offered to somebody the API would then
   * refuse. A viewer who reads nothing but the CRM is left with Meetings alone and no switch at
   * all - a control with one option is a label pretending to be a choice.
   */
  const sourceOptions = useMemo(
    () => permittedSources(({ module, feature }) => hasPermission(module, feature, "READ")),
    [hasPermission],
  );
  const sourceValues = useMemo(() => sourceOptions.map((entry) => entry.value), [sourceOptions]);
  // Whether the projects register has to be fetched at all. A viewer with no production permission
  // never asks for it and never waits on the request.
  const readsProjects = useMemo(
    () => sourceValues.some((value) => PROJECT_SOURCES.includes(value)),
    [sourceValues],
  );
  const [meetings, setMeetings] = useState([]);
  // The projects register, for the three sources read out of it. The same list the Projects, Pre
  // Production and Post Production boards read, through the same endpoint, so a project cannot say
  // one thing there and another here.
  const [projects, setProjects] = useState([]);
  const [projectsLoading, setProjectsLoading] = useState(true);
  /*
   * The whole diary, for the calendar: meetings, shoots and projects' main events together.
   *
   * Kept apart from the list's own rows on purpose. A shoot is a day's work with no record of its
   * own to open, so the grid can draw it and a table cannot sensibly hold it beside a project it
   * belongs to; the list reads whole records - a meeting, a project - and can sort, filter and
   * export them. Both take their meetings from the same table, so the two cannot disagree.
   */
  const [schedule, setSchedule] = useState([]);
  // A booking the calendar has selected that is not a meeting; meetings keep their own selection,
  // because opening one still goes to its row in the List view as it always has.
  const [selectedEntry, setSelectedEntry] = useState(null);
  const [loading, setLoading] = useState(true);
  /*
   * Whether the calendar's own read has answered yet, kept apart from the meetings' `loading`.
   *
   * Two sources are read *out of* `/api/schedule` rather than from an endpoint of their own -
   * Interviews and Employee Attendance - so before it answers they have no rows and no reason
   * given. Without this the table says "No interviews scheduled yet" for the moment the request is
   * in flight, which sends somebody to HRM to set a date that is already set.
   */
  const [scheduleLoading, setScheduleLoading] = useState(true);
  // The app's snackbar, and its tones: a failure leads with the red mark, a finished action
  // with the green tick, and anything else is said plainly.
  const { notice, showNotice, showSuccess, showError, clearNotice } = useNotice();
  const [view, setView] = useState("calendar");
  /*
   * The view actually on screen, which is not always the one chosen.
   *
   * The List view lists a *source* - meetings, the project register, a production stage - and a
   * viewer holding none of those permissions has no source to list, so its table would have no
   * columns and no rows to put in them. They keep the calendar, which still has the studio's
   * holidays on it. Everybody who can list anything is unaffected.
   */
  const canListAnything = sourceValues.length > 0;
  const activeView = canListAnything ? view : "calendar";
  /*
   * What the List view is listing, and when.
   *
   * `source` is the header switch - All, Projects, either production stage, Meetings - and `tab` is
   * the strip under it. Both are the List view's alone: the calendar draws the whole diary and has
   * the month it is on plus its own Today button, so it answers both questions already and a second
   * control saying the same thing differently is how the two come to disagree.
   *
   * The tab is remembered across a reload, the way every other filtered screen in the app remembers
   * its own; the source is not, because it decides which columns the table has and being returned
   * to somebody else's choice of those is more surprising than being returned to All.
   */
  const [source, setSource] = useState(DEFAULT_MEETING_SOURCE);
  // A remembered or defaulted source this viewer may not read falls back to the first they can,
  // rather than filtering the table by a source that is not in the switch beside it.
  const activeSource = sourceValues.includes(source) ? source : sourceValues[0] || "meetings";
  const [tab, setTab] = useStickyTab("meetings", DEFAULT_MEETING_TAB, MEETING_TAB_IDS);
  const [filters, setFilters] = useState({});
  // Sorted the way the opening tab reads: soonest first, so the top of the table is the next
  // thing to happen rather than the furthest away.
  const [sort, setSort] = useState({ id: "date", direction: meetingTabSortDirection(DEFAULT_MEETING_TAB) });
  const [selectedId, setSelectedId] = useState("");
  const [panelState, setPanelState] = useState("expanded");
  // null while closed. Open it with a `YYYY-MM-DD` to start the form on that day, or with ""
  // from the Add Meet button, which leaves the date to be picked in the dialog.
  const [addMeetDate, setAddMeetDate] = useState(null);
  const [pendingCancel, setPendingCancel] = useState(null);
  const [cancelling, setCancelling] = useState(false);
  // Escape backs out of the cancel confirmation - but not while the cancellation is being carried
  // out, which is not undone by looking away.
  useEscapeKey(() => setPendingCancel(null), Boolean(pendingCancel) && !cancelling);
  // The first of the month the calendar is showing. A date rather than a year/month pair, so
  // stepping over a year boundary is the Date constructor's problem rather than this page's.
  const [month, setMonth] = useState(() => {
    const today = new Date();
    return new Date(today.getFullYear(), today.getMonth(), 1);
  });

  /*
   * The meetings table, for the List view and for opening a meeting from a day cell.
   *
   * Not fetched at all without SALES / CRM Leads: `/api/sales/crm-meetings` answers for it, and a
   * viewer who is here for the holidays would otherwise be met by a red "Unable to load meetings"
   * the moment the calendar opened. Their meetings on the grid come from `/api/schedule`, which
   * makes the same permission check per source on the server.
   */
  const loadMeetings = useCallback(async () => {
    if (!canReadMeetings) {
      setMeetings([]);
      setLoading(false);
      return;
    }
    try {
      const response = await apiRequest("/api/sales/crm-meetings");
      setMeetings(Array.isArray(response?.data) ? response.data : []);
    } catch (error) {
      showError(error.message || "Unable to load meetings.");
    } finally {
      setLoading(false);
    }
  }, [canReadMeetings, showError]);

  /**
   * The calendar's own read: everything booked, from every module this viewer may read.
   *
   * A source that fails is named rather than silently missing - `unavailable` comes back from the
   * server - because a calendar quietly short of a day's shoots is worse than one that says it
   * could not read them.
   */
  const loadSchedule = useCallback(async () => {
    try {
      const response = await getSchedule();
      setSchedule(Array.isArray(response?.data) ? response.data : []);
      const missing = Array.isArray(response?.unavailable) ? response.unavailable : [];
      if (missing.length) {
        const names = missing.map((kind) => scheduleKind(kind).label.toLowerCase());
        showError(`The calendar could not load ${names.join(" or ")}. Everything else is shown.`);
      }
    } catch (error) {
      showError(error.message || "Unable to load the calendar.");
    } finally {
      setScheduleLoading(false);
    }
  }, [showError]);

  /** The projects register, for the sources read out of it. Only fetched where one is offered. */
  const loadProjects = useCallback(async () => {
    try {
      const response = await getSalesProjects();
      setProjects(Array.isArray(response?.data) ? response.data : []);
    } catch (error) {
      showError(error.message || "Unable to load projects.");
    } finally {
      setProjectsLoading(false);
    }
  }, [showError]);

  // Deferred a tick before they run, the way the CRM starts its own first load: a fetch started
  // straight from an effect body counts as state set during the effect.
  useEffect(() => {
    const timer = window.setTimeout(() => { void loadMeetings(); void loadSchedule(); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadMeetings, loadSchedule]);

  /*
   * The register, on its own effect and only where a source needs it.
   *
   * Apart from the two above because `readsProjects` is false until the permission set has been
   * fetched and then becomes true - and an effect carrying all three would answer that by fetching
   * the meetings and the calendar a second time.
   */
  useEffect(() => {
    if (!readsProjects) return undefined;
    const timer = window.setTimeout(() => { void loadProjects(); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadProjects, readsProjects]);

  // The columns and the rows both belong to the source on screen, so switching it swaps the whole
  // table rather than relabelling the one that was already there.
  const columns = useMemo(() => sourceColumns(activeSource), [activeSource]);

  // Unlisted columns are visible, so nothing has to be seeded for a column to appear.
  const defaultColumnVisibility = useMemo(
    () => Object.fromEntries(columns.map((column) => [column.id, true])),
    [columns],
  );

  /*
   * The attendance the calendar was already sent, for the table to read as rows.
   *
   * Off `schedule` rather than from a second request: `/api/schedule` already carries these days,
   * already scoped to what this viewer may see, and a second endpoint asked for the same range
   * would be two answers that could disagree about who was in.
   */
  const attendanceEntries = useMemo(
    () => schedule.filter((entry) => entry?.kind === "attendance"),
    [schedule],
  );

  /*
   * The interviews the calendar was already sent, for the table to read as rows.
   *
   * Off `schedule` for the reason attendance is: `/api/schedule` already carries them, already
   * scoped by `HRM / Interview`, and asking the Interview register for the same candidates would
   * be two answers that could disagree about when somebody is coming in.
   */
  const interviewEntries = useMemo(
    () => schedule.filter((entry) => entry?.kind === "interview"),
    [schedule],
  );

  // Everything the source holds, before the column filters and before the tab.
  const allRows = useMemo(
    () => sourceRows(activeSource, { meetings, projects, attendance: attendanceEntries, interviews: interviewEntries, sources: sourceValues }),
    [activeSource, meetings, projects, attendanceEntries, interviewEntries, sourceValues],
  );

  const rows = useMemo(
    () => applyFiltersAndSort(allRows, columns, filters, sort),
    [allRows, columns, filters, sort],
  );

  // Built from every row rather than the filtered ones, so a filter never narrows its own list.
  const filterOptions = useMemo(() => buildFilterOptions(columns, allRows), [columns, allRows]);

  /*
   * The source's columns as the table reads them, and the row menu after them.
   *
   * `source` keeps the column's own definition beside the table's, because the export and the cell
   * both read through `columnValue`. A choice column is a `combobox` - a list that still takes
   * typing, the control the Schedule has always put under Host, CRM and Status - and its list is
   * the one built above from every row the source holds. `sortDescFirst: false` because every press
   * here has always started at ascending.
   */
  const scheduleTableColumns = useMemo(() => [
    ...columns.map((column) => ({
      id: column.id,
      label: column.label,
      source: column,
      sortDescFirst: false,
      accessorFn: (row) => columnValue(column, row),
      ...(column.filter === "choice" ? { filter: "combobox", filterOptions: filterOptions[column.id] || [] } : {}),
      ...(column.filter === "date" ? { filter: "date" } : {}),
      cell: ({ row }) => <ScheduleCell column={column} row={row.original} />,
    })),
    { ...ACTIONS_COLUMN, label: "Actions" },
  ], [columns, filterOptions]);

  /*
   * Whether the table is still waiting on something it actually needs.
   *
   * Per source, not per request: somebody reading Pre Production should not sit in front of
   * "Loading..." because the meetings call is slow, and All is not ready until both have answered.
   */
  const listLoading =
    ((activeSource === "all" || activeSource === "meetings") && loading) ||
    ((activeSource === "all" || PROJECT_SOURCES.includes(activeSource)) && readsProjects && projectsLoading) ||
    // The two sources read out of the calendar's own request rather than an endpoint of their own.
    ((activeSource === "all" || activeSource === "interviews" || activeSource === "attendance") && scheduleLoading);

  /*
   * The calendar's bookings, narrowed to the source the header switch is on.
   *
   * The switch is the one thing both views answer to. The list's *column filters* are still its
   * own - Host, Guests, Status mean nothing to a shoot, which is why the grid does not read them -
   * but "what am I looking at" is a question about the diary rather than about a table, and having
   * to answer it twice in two places was the awkward part of this screen.
   */
  const calendarEntries = useMemo(
    () => sourceScheduleEntries(activeSource, schedule, { projects, sources: sourceValues }),
    [activeSource, schedule, projects, sourceValues],
  );

  // Filed by day and in running order inside each. What each booking is, its colour says.
  const byDay = useMemo(() => scheduleByDay(calendarEntries), [calendarEntries]);

  const grid = useMemo(() => monthGrid(month), [month]);
  const todayKey = dayKey(new Date());

  /*
   * The List view's own rows: the filtered set, narrowed to the tab. Applied here rather than
   * inside `rows` so the calendar is untouched - a month grid showing only upcoming days would
   * blank out the first half of the current month.
   */
  const listRows = useMemo(
    () => rows.filter((row) => inMeetingTab(row.day, tab, todayKey)),
    [rows, tab, todayKey],
  );

  /*
   * The tick boxes, for a role holding `ADMIN / Table Select All`.
   *
   * The table draws them and hands the header what the selection can be done with, exactly as it
   * does for every other table: the three rules in `tableSelection.js`, the count in the header,
   * Export over the ticked rows. Export and nothing else - a meeting here is read from the source
   * that holds it, and this screen has never been where one is deleted; there is no endpoint for
   * it to call, so no `onDelete` is passed and no Delete is offered.
   */
  const { canWrite: canSelectRows } = useModuleAccess("ADMIN", "Table Select All");
  const [selectedIds, setSelectedIds] = useState(() => new Set());

  /*
   * What each tab holds, for the number in its own label.
   *
   * Counted off `rows` - after the column filters, before the tab - so the number a tab wears is
   * exactly what pressing it will show. Counting the unfiltered set instead reads as a lie the
   * moment somebody filters by Host: four tabs promising rows and an empty table under each.
   */
  const tabCounts = useMemo(
    () => Object.fromEntries(MEETING_TABS.map((entry) => [
      entry.id,
      rows.filter((row) => inMeetingTab(row.day, entry.id, todayKey)).length,
    ])),
    [rows, todayKey],
  );

  const headerTabs = useMemo(
    () => MEETING_TABS.map((entry) => ({ id: entry.id, label: entry.label, count: tabCounts[entry.id] || 0 })),
    [tabCounts],
  );

  const selected = listRows.find((row) => row.id === selectedId) || null;

  /*
   * The booking the panel is about, whichever half of the screen named it.
   *
   * A chip clicked on the grid and an interview row clicked in the table are the **same record** -
   * the row is built from the calendar's own entry - so they read through one block rather than two
   * that could drift apart. A meeting and a project row keep their own, because those carry the
   * whole record rather than the calendar's reading of it.
   */
  const panelEntry = selectedEntry || selected?.interview || null;

  const monthLabel = useMemo(
    () => new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric" }).format(month),
    [month],
  );

  /**
   * Opening something from a day cell.
   *
   * Each kind goes where that kind is actually worked with, which is the whole point of putting
   * them on one calendar:
   *
   *   * a meeting goes where it always went - its row in the List view, panel open, because that
   *     is where a meeting is joined or cancelled;
   *   * a shoot and a main event belong to a project, so they open **that project's record** in
   *     Project Management. A shoot is planned, staffed and delivered from there; a calendar that
   *     could only describe it would leave the reader to go and find it by hand;
   *   * an interview opens in the panel beside the grid, which is the honest answer rather than a
   *     worse one: the Interview register has no deep link to a candidate, so following one there
   *     would land somebody on a table of everybody and leave them to find the name again. The
   *     panel already holds what the diary is asked for - when, with whom, how, and the Meet link.
   *
   * The project is named in the URL rather than handed over, so the link behaves like a link:
   * bookmarkable, reloadable, and Back returns to the calendar.
   *
   * A viewer who may see a shoot but not open the Projects board is a real case - the shoot boards
   * answer to their own permissions - so the link is only followed where it would actually arrive.
   * Anything else opens in the panel beside the calendar, which is still a real answer rather than
   * a refusal.
   */
  function openEntry(entry) {
    if (entry.kind === "meeting") {
      const meeting = meetings.find((row) => `meeting:${row.id}` === entry.id);
      if (meeting) {
        openMeeting(meeting);
        return;
      }
    }
    /*
     * By kind, not merely by "it has a subject". A meeting's subject is the client it is with, not
     * an Event ID - so a meeting that could not be matched to a row above would otherwise be
     * followed to `?project=hiee`, a project that does not exist, and land on an empty board.
     */
    if ((entry.kind === "shoot" || entry.kind === "project") && entry.subject && canOpenProjects) {
      router.push(`/project-management/projects?project=${encodeURIComponent(entry.subject)}`);
      return;
    }
    setSelectedEntry(entry);
    setPanelState("expanded");
  }

  /**
   * Moving between All, Today, Upcoming and Past.
   *
   * The Date column's sort follows, because the same direction does not read the same way in two
   * of them: soonest first is right for what is coming and wrong for what has been. Only the Date
   * column is touched - somebody who has sorted by Host keeps that sort.
   */
  function changeTab(value) {
    setTab(value);
    setSort((current) => (current?.id === "date" || !current
      ? { id: "date", direction: meetingTabSortDirection(value) }
      : current));
  }

  /**
   * Moving between the sources.
   *
   * A different source is a different table, so everything that was said about the old one is
   * dropped: a filter typed into Host - a column Projects does not have - would go on narrowing a
   * table with no control left on it to clear that filter. The selection goes too, because the row
   * it named is gone. Which columns are hidden is kept per source by the table itself, under
   * `Schedule <source>`, so a column hidden on one source is never hidden against a set that never
   * had it.
   *
   * The Date column survives on purpose. Every source has one under that id, which is what lets the
   * tabs keep sorting the table however the source is switched.
   */
  function changeSource(value) {
    setSource(value);
    setFilters({});
    setSelectedId("");
    setSelectedEntry(null);
    setSort({ id: "date", direction: meetingTabSortDirection(tab) });
  }

  /**
   * Opening a row's own record in the panel beside the table.
   *
   * `useCallback`: the table's rows are memoised and compare this, so a fresh arrow on every render
   * would redraw every row on every render. State setters only, so it never has to change.
   */
  const selectRow = useCallback((row) => {
    setSelectedId(row.id);
    // One panel, one subject: a row opening clears whatever booking the calendar had in it.
    setSelectedEntry(null);
    setPanelState("expanded");
  }, []);

  function stepMonth(offset) {
    setMonth((current) => new Date(current.getFullYear(), current.getMonth() + offset, 1));
  }

  /*
   * asc <-> desc, and a fresh column starts at asc. The table proposes asc, desc, then none; this
   * screen's cycle never rests at none, so it is told which column was pressed and answers with its
   * own next step - see `sorting` on the table.
   */
  function toggleSort(columnId) {
    setSort((current) => (current?.id === columnId
      ? { id: columnId, direction: current.direction === "asc" ? "desc" : "asc" }
      : { id: columnId, direction: "asc" }));
  }

  // The table hands over the rows and the columns it is showing - the columns that survived Manage
  // Columns, in their order - so an export is exactly what is on screen.
  function exportMeetingsCsv({ rows: only, columns: exportColumns = [] } = {}) {
    exportToCsv({
      // Named after what was exported, so two exports taken from two sources are not the same file
      // twice over in the downloads folder.
      fileName: createExportFileName(activeSource === "all" ? "schedule" : activeSource),
      columns: exportColumns
        .filter((column) => column.id !== "actions" && column.exportable !== false && column.source)
        .map((column) => ({
          key: column.id,
          label: column.label,
          value: (row) => columnValue(column.source, row),
        })),
      // What the table is showing, not everything the source holds: an export taken while looking
      // at Today's list should be today's list - or, from the selection bar, only the rows ticked
      // within it.
      rows: only || listRows,
    });
  }

  function openMeeting(meeting) {
    /*
     * Opened from the calendar, so the list has to be showing something this meeting is actually
     * in. Both switches can be pointing somewhere else - a source of Pre Production has no meetings
     * in it at all, and a tab of Upcoming does not hold last Tuesday's - and either would open the
     * details panel on a row that is not in the table.
     */
    if (activeSource !== "all" && activeSource !== "meetings") {
      changeSource(sourceValues.includes("all") ? "all" : "meetings");
    }
    setSelectedId(`meeting:${meeting.id}`);
    // One panel, one subject: a meeting opening clears whatever booking the calendar had in it.
    setSelectedEntry(null);
    setPanelState("expanded");
    const actual = meetingRange(meeting, todayKey);
    if (actual && actual !== tab) changeTab(actual);
    setView("list");
  }

  async function cancelMeeting() {
    const meeting = pendingCancel;
    if (!meeting || cancelling) return;
    setCancelling(true);
    try {
      await apiRequest(
        `/api/sales/crm-leads/${encodeURIComponent(meeting.enquiryId)}/meetings/${encodeURIComponent(meeting.id)}`,
        { method: "DELETE" },
      );
      await loadMeetings();
      setPendingCancel(null);
      showSuccess(`${meetingTitle(meeting)} cancelled.`);
    } catch (error) {
      showError(error.message || "Unable to cancel this meeting.");
    } finally {
      setCancelling(false);
    }
  }

  /**
   * What a row offers, in the terms of what the row is.
   *
   * A meeting is joined and cancelled here, because this is where a meeting lives. A project is
   * only read here - it is planned, staffed and delivered in Project Management - so its one extra
   * action is the way there, offered only to somebody the board would actually let in.
   *
   * An interview is read here too. It is worked on in HRM -> Interview, where the candidate's
   * record is, and the one thing worth doing with a booking from a diary is joining the call - so a
   * Meet interview offers its link and nothing else pretends to be an action this screen carries
   * out.
   */
  const rowActions = useCallback((row) => {
    const items = [{ label: "View details", onSelect: () => selectRow(row) }];

    if (row.interview) {
      const meetLink = row.interview.meta?.meetLink;
      if (meetLink) {
        items.push({ label: "Join Meet", onSelect: () => window.open(meetLink, "_blank", "noopener,noreferrer") });
      }
      return items;
    }

    if (row.project) {
      if (canOpenProjects && row.project.eventId) {
        items.push({
          label: "Open project",
          onSelect: () => router.push(`/project-management/projects?project=${encodeURIComponent(row.project.eventId)}`),
        });
      }
      return items;
    }

    const meeting = row.meeting;
    if (meeting.meetLink) {
      items.push({ label: "Join Meet", onSelect: () => window.open(meeting.meetLink, "_blank", "noopener,noreferrer") });
    }
    if (canWrite && !isCancelled(meeting)) {
      items.push({ label: "Cancel meeting", tone: "danger", onSelect: () => setPendingCancel(meeting) });
    }
    return items;
  }, [selectRow, canOpenProjects, canWrite, router]);

  // The row menu, as the table draws it into its actions column. Stable, or the table would rebuild
  // its columns on every render for a fresh arrow.
  const renderRowActions = useCallback(
    (row) => <OptionsMenu ariaLabel={`Actions for ${rowTitle(row)}`} menuClassName="w-52" items={rowActions(row)} />,
    [rowActions],
  );

  return (
    <section className="relative flex h-full min-h-0 w-full min-w-0 flex-col bg-white text-slate-700">
      <ModulePageHeader
        /*
         * Calendar in both views, because it is one screen read two ways.
         *
         * The page draws shoots and projects' main events as readily as meetings - the source switch
         * beside this heading says so - and a list of those is no more "Meetings" than the month grid
         * is. Naming it differently per view also meant the heading moved under the reader every time
         * they changed how they were looking at the same diary.
         */
        title="Calendar"
        /*
         * When, under the switches that decide what. The tab strip is the List view's alone: the
         * calendar answers the same question with the month it is on and its own Today button, and
         * a header carrying both would leave two controls able to disagree about which day it is.
         */
        tabs={activeView === "list" ? headerTabs : undefined}
        tabValue={tab}
        onTabChange={changeTab}
        tabsAriaLabel="Calendar schedule filters"
        /*
         * What is being shown, against the title - the same place, and the same divided switch,
         * the CRM puts its vertical in. It names what the screen below holds, which is a fact about
         * the page rather than an action taken on it, so it reads as part of the heading:
         * "Calendar — All", the way "Leads & Followups — Dum Dum" does.
         *
         * Both views, and in the same place in both. It was the List view's alone while the grid
         * drew the whole diary regardless; now that the grid answers to it too, a switch that
         * appeared and disappeared as the view changed would be the one control on this header
         * that moves.
         *
         * Offered only where there is a real choice: a viewer who may read nothing but the CRM gets
         * no switch at all rather than one holding a single option.
         *
         * `sorted={false}` because the order *is* the meaning here - All, then the register, then
         * the two stages in the order production runs, then the meetings themselves. Alphabetised
         * it would read All, Meetings, Post Production, Pre Production, Projects, which puts post
         * before pre.
         */
        titleAddon={sourceOptions.length > 1 ? (
          <div className="flex items-center gap-3">
            <Dropdown
              mode="switch"
              ariaLabel="Calendar source"
              value={activeSource}
              onChange={changeSource}
              options={sourceOptions.map((entry) => ({ value: entry.value, label: entry.label }))}
              sorted={false}
              placeholder="Select"
              className={SOURCE_SWITCH_CLASS}
            />
          </div>
        ) : null}
        /*
         * How it is being read, at the end of the row beside Add Meet.
         *
         * Apart from the source switch on purpose. This one changes the shape of the screen - a
         * month grid or a table - which is closer to an action than to a description of what is
         * listed, and it is the control somebody reaches for repeatedly while working. Add Meet
         * stays last: it is the one thing on this row that changes a record, and a primary button
         * that moved about would be one nobody could aim at.
         */
        actions={(
          <>
            {/* Offered only where both views hold something, for the same reason the source
                switch above it is: a switch between a calendar and an empty table is a control
                that can only make the screen worse. */}
            {canListAnything && <Dropdown
              mode="switch"
              ariaLabel="Calendar view"
              value={activeView}
              onChange={setView}
              options={VIEW_OPTIONS}
              placeholder="Select"
              className={VIEW_SWITCH_CLASS}
            />}
            {canWrite && (
              <Button type="button" variant="primary" onClick={() => setAddMeetDate("")}>
                Add Meet
              </Button>
            )}
          </>
        )}
      />

      <div className="min-h-0 flex-1 px-0 pt-3">
        <DataTableShell
          className="h-full min-h-[30rem]"
          footer={(
            <TableFooter contentClassName="w-full !justify-between">
              <span>
                {activeView !== "calendar"
                  ? "Scheduling and cancelling keep Google Calendar in step."
                  : canWrite
                    ? "Click a day to schedule on it, or a booking to open its details."
                    // Without the write there is nothing to start by clicking a day, so the line
                    // says what the grid *is* rather than offering an action that will not happen.
                    : "Everything booked this month, and the studio's declared holidays."}
              </span>
              {/* Each view counts what it is actually drawing, and both are now read through the
                  same source switch - so the calendar says how many of the diary's bookings that
                  source holds rather than how many the diary holds altogether. */}
              <span>
                {activeView === "calendar"
                  ? `Showing ${calendarEntries.length.toLocaleString()} of ${schedule.length.toLocaleString()} booked`
                  : `Showing ${listRows.length.toLocaleString()} of ${allRows.length.toLocaleString()}`}
              </span>
            </TableFooter>
          )}
        >
          <div className="relative flex min-h-0 flex-1 overflow-hidden">
            {activeView === "calendar" ? (
              <div className="flex min-w-0 flex-1 flex-col overflow-auto">
                {/* Month control: back, forward, and a way straight back to today, which is
                    the one place anyone who has paged too far actually wants. */}
                <div className="flex shrink-0 items-center gap-3 border-b border-slate-200 px-3 py-2">
                  <IconButton variant="ghost" ariaLabel="Previous month" onClick={() => stepMonth(-1)}>
                    <ChevronLeftRoundedIcon sx={{ fontSize: 20 }} />
                  </IconButton>
                  <IconButton variant="ghost" ariaLabel="Next month" onClick={() => stepMonth(1)}>
                    <ChevronRightRoundedIcon sx={{ fontSize: 20 }} />
                  </IconButton>
                  <span className="text-xs font-medium text-slate-800">{monthLabel}</span>
                </div>

                <div className="grid shrink-0 grid-cols-7 border-b border-slate-200 bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  {WEEKDAY_LABELS.map((label) => (
                    <div key={label} className="px-3 py-1.5 text-center">{label}</div>
                  ))}
                </div>

                <div className="grid min-h-0 flex-1 grid-cols-7 auto-rows-fr">
                  {grid.map((cell) => {
                    const dayEntries = byDay.get(cell.key) || [];
                    const isToday = cell.key === todayKey;
                    return (
                      // Any day can be booked, this month's or either neighbour's. Clicking the
                      // cell opens Add Meet already set to that day - without this the only way
                      // to schedule was the header button, which always started on no date.
                      //
                      // A div with a handler rather than a button: the meetings inside are
                      // buttons themselves, and a button cannot legally contain another.
                      // The day is only a control for somebody who may actually schedule on it.
                      // Without SALES / CRM Leads write there is nothing for a click to start, so
                      // the cell is a cell: no button role, no focus stop, no hover that promises
                      // something. The bookings inside it are still their own buttons.
                      <div
                        key={cell.key}
                        role={canWrite ? "button" : undefined}
                        tabIndex={canWrite ? 0 : undefined}
                        aria-label={canWrite ? `Schedule a meeting on ${formatMeetingDate(cell.date)}` : undefined}
                        title={dayEntries.length ? `${dayEntries.length} booked on ${formatMeetingDate(cell.date)}` : undefined}
                        onClick={canWrite ? () => setAddMeetDate(cell.key) : undefined}
                        onKeyDown={canWrite ? (event) => {
                          if (event.target !== event.currentTarget) return;
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            setAddMeetDate(cell.key);
                          }
                        } : undefined}
                        className={`group relative min-h-[6rem] border-b border-r border-slate-200 p-1 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-300 ${canWrite ? "cursor-pointer hover:bg-blue-50/40" : ""} ${cell.outside ? "bg-slate-50/60" : "bg-white"}`}
                      >
                        <div className="mb-1 flex items-center justify-between px-1">
                          {/* Today is marked on the number itself rather than by shading the
                              whole cell, which would fight with the meetings inside it. */}
                          <span
                            className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px] ${
                              isToday
                                ? "bg-blue-600 font-semibold text-white"
                                : cell.outside ? "text-slate-300" : "text-slate-500"
                            }`}
                          >
                            {cell.date.getDate()}
                          </span>
                          {/* How many the day holds, once it holds more than the cell shows at
                              rest. The list below scrolls to the rest, so this is a count rather
                              than a warning that something is out of reach. */}
                          {dayEntries.length > VISIBLE_PER_DAY_CELL ? (
                            <span className="text-[11px] text-slate-400">{dayEntries.length}</span>
                          ) : (
                            // Shown on hover only, so a month at rest stays readable while the
                            // cell still says what clicking it does - and only where clicking it
                            // does anything.
                            <span aria-hidden="true" className={`text-sm leading-none text-blue-500 opacity-0 transition ${canWrite ? "group-hover:opacity-100" : ""}`}>
                              +
                            </span>
                          )}
                        </div>
                        {/*
                          Everything booked that day, and the cell scrolls to the rest.

                          It used to draw three and print "+2 more" underneath, which named what was
                          missing and gave no way to reach it - and attendance made that intolerable,
                          since a studio of a dozen puts a dozen chips on every working day. The cap
                          is now a *height* rather than a count: the cell is the same size whether it
                          holds one booking or twenty, so the month grid keeps its shape, and the day
                          scrolls inside itself.

                          `onWheel` stops the scroll escaping to the page once the list is at its
                          end, which is what makes a short flick inside a cell move the cell rather
                          than the month behind it.
                        */}
                        <div className="max-h-[5.5rem] space-y-1 overflow-y-auto overscroll-contain pr-0.5">
                          {dayEntries.map((entry) => {
                            // The kind's own colour, except on attendance - where the chip is
                            // coloured by whether the person was there. See `scheduleEntryCell`.
                            const cell = scheduleEntryCell(entry);
                            return (
                              <button
                                key={entry.id}
                                type="button"
                                // Stopped, or opening a booking would also count as clicking the
                                // day behind it and pop the scheduler open on top.
                                onClick={(event) => {
                                  event.stopPropagation();
                                  openEntry(entry);
                                }}
                                title={entryTooltip(entry)}
                                className={`block w-full rounded px-1.5 py-1 text-left text-[11px] leading-4 transition ${cell}`}
                              >
                                {/* The identifier and the name on the first line - the id first,
                                    because "DBS-SID-DD-ERD-000003" is what a shoot is called on the floor
                                    and a meeting's time is what it is called in a diary. */}
                                <span className="block truncate">
                                  <span className="font-medium">{scheduleEntryLead(entry)}</span>{" "}
                                  {entry.title}
                                </span>
                                {/* And where, on its own line, so it is readable rather than the
                                    tail of a truncated sentence. Only when there is one: a meeting
                                    has no place, and an empty second line would make its chip a
                                    different height from the shoot beside it. */}
                                {entry.location && (
                                  <span className="block truncate text-[10px] opacity-75">{entry.location}</span>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <DataTable
                ariaLabel="Schedule table"
                // Per source: a different source is a different table, and a column hidden on
                // one must not be hidden against a set that never had it.
                columnOrderKey={`Schedule ${activeSource}`}
                columns={scheduleTableColumns}
                data={listRows}
                getRowId={scheduleRowId}
                loading={listLoading}
                loadingMessage={`Loading ${meetingSourceLabel(activeSource).toLocaleLowerCase()}...`}
                /* Three different pieces of news, and saying the wrong one sends somebody looking
                   for a filter they never set: the source holds nothing at all, nothing falls in
                   the tab being read, or the column filters have narrowed it away. */
                emptyMessage={!allRows.length
                  ? sourceEmptyMessage(activeSource)
                  : rows.length
                    ? meetingTabEmptyMessage(tab)
                    : "Nothing matched the selected filters."}
                selectedRowId={selectedId}
                onRowClick={selectRow}
                // The tint this table's rows have always taken under the pointer.
                rowHoverClassName="hover:bg-blue-50"
                renderActions={renderRowActions}
                defaultColumnVisibility={defaultColumnVisibility}
                features={{
                  // Columns sized to their contents, as this table has always been drawn.
                  layout: "auto",
                  filtering: true,
                  // The page filters and sorts its own rows - `applyFiltersAndSort` - by rules the
                  // tabs depend on; the table draws the boxes and the arrows and reports a press.
                  filters,
                  onColumnFilters: setFilters,
                  sorting: { sort, onChange: (next, columnId) => toggleSort(columnId) },
                  selection: canSelectRows ? { selectedIds, onChange: setSelectedIds, noun: "meeting", rowLabel: scheduleRowLabel } : undefined,
                  csvExport: { enabled: true, onExport: exportMeetingsCsv },
                }}
              />
            )}

            {/*
              One panel, three things it can be about.

              A meeting selected in the List view opens exactly as it always has - the Join button
              first, then its own fields. A project row opens the project's own record, in the
              register's own words, because a table of projects whose panel described a meeting
              would be a panel about the wrong thing. A shoot, a main event or an interview is read
              as the booking it is - from a day cell, or from its own row in the table, through the
              one block either way. The panel's title says which, so it is never ambiguous what is
              being read.
            */}
            <InfoPanelShell
              title={
                panelEntry
                  ? `${scheduleKind(panelEntry.kind).label.replace(/s$/, "")} details`
                  : selected?.project ? "Project details" : "Meeting details"
              }
              state={selected || selectedEntry ? panelState : "collapsed"}
              onToggle={() => setPanelState((current) => (current === "expanded" ? "collapsed" : "expanded"))}
            >
              {panelEntry ? (
                <div className="flex h-full min-h-0 flex-col">
                  <div className="border-b border-slate-200 px-4 py-3">
                    <p className="text-sm font-medium text-slate-900">{panelEntry.title}</p>
                    <p className="mt-0.5 text-xs text-slate-500">{entryTiming(panelEntry)}</p>
                  </div>
                  <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3">
                    {/* The Meet link reads first, for the same reason it does on a meeting:
                        joining is the one thing anybody opens this panel in a hurry to do. Only an
                        online interview has one - an In Person interview is a room, not a link. */}
                    {panelEntry.kind === "interview" && panelEntry.meta?.meetLink && (
                      <a
                        href={panelEntry.meta.meetLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mb-3 inline-flex items-center rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-blue-700"
                      >
                        Join Meet
                      </a>
                    )}
                    <dl className="space-y-2.5 pb-2">
                      {[
                        /*
                         * Each kind names its own identifier and its own subject. A shoot has a
                         * Shoot ID and belongs to a project; an interview has a Candidate ID and is
                         * for a position; a meeting refers to an enquiry. Calling all three
                         * "Reference" and "Project" would be the panel describing one booking in
                         * another kind's words.
                         */
                        [panelEntry.kind === "shoot" ? "Shoot ID" : panelEntry.kind === "interview" ? "Candidate ID" : "Reference", panelEntry.reference],
                        [panelEntry.kind === "meeting" ? "Enquiry" : panelEntry.kind === "interview" ? "Position" : "Project", panelEntry.subject],
                        ["Status", panelEntry.kind === "interview" ? panelEntry.meta?.status || "" : ""],
                        ["Date", panelEntry.day ? formatMeetingDate(`${panelEntry.day}T00:00:00`) : formatMeetingDate(panelEntry.startAt)],
                        // As the register wrote it: an interview has an hour but no instant, so
                        // there is no `Date` to read a clock time back out of.
                        ["Time", panelEntry.kind === "interview" ? panelEntry.meta?.clock || "" : ""],
                        ["Session Timing", panelEntry.kind === "shoot" ? formatSessionTiming(panelEntry.meta || {}) : ""],
                        ["Shoot Type", panelEntry.meta?.shootType || ""],
                        ["Main Event", panelEntry.meta?.isMainEvent ? "Yes" : ""],
                        [panelEntry.kind === "interview" ? "Mode & Branch" : "Location", panelEntry.location],
                        ["Department", panelEntry.kind === "interview" ? panelEntry.meta?.department || "" : ""],
                        [panelEntry.kind === "interview" ? "Interviewer" : "Owner", panelEntry.owner],
                        ["Phone", panelEntry.kind === "interview" ? panelEntry.meta?.phone || "" : ""],
                        ["Email", panelEntry.kind === "interview" ? panelEntry.meta?.email || "" : ""],
                        /*
                         * The link itself, under the button that opens it.
                         *
                         * Join Meet above is the thing to press and stays the thing to press; this
                         * is the link as a link - readable, selectable, and the answer to "send me
                         * the link" without opening the candidate's record in another module. It
                         * opens in a new tab like every other stored link in the application, so
                         * following it never navigates the diary away from whoever is reading it.
                         */
                        ["Meet Link", panelEntry.kind === "interview" && panelEntry.meta?.meetLink ? (
                          <a
                            href={panelEntry.meta.meetLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="break-all text-blue-600 underline-offset-2 hover:underline"
                          >
                            {panelEntry.meta.meetLink}
                          </a>
                        ) : ""],
                      ]
                        .filter(([, value]) => value && value !== "—")
                        .map(([label, value]) => (
                          <div key={label}>
                            <dt className="text-[13px] font-semibold text-slate-500">{label}</dt>
                            <dd className="mt-[3px] text-[15px] break-words text-slate-800">{value}</dd>
                          </div>
                        ))}
                    </dl>
                  </div>
                </div>
              ) : selected?.project ? (
                <div className="flex h-full min-h-0 flex-col">
                  <div className="border-b border-slate-200 px-4 py-3">
                    <p className="text-sm font-medium text-slate-900">{rowTitle(selected)}</p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {/* A project is a day, not a moment, so its heading says the day and the
                          event id rather than a clock range it does not have. */}
                      {[selected.project.eventId, rowDateText(selected)].filter(Boolean).join(" · ") || "No main event date set"}
                    </p>
                  </div>
                  <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3">
                    {/* Where the project is actually worked on. First, for the same reason Join
                        Meet is first on a meeting: it is what somebody opens this panel to reach. */}
                    {canOpenProjects && selected.project.eventId && (
                      <button
                        type="button"
                        onClick={() => router.push(`/project-management/projects?project=${encodeURIComponent(selected.project.eventId)}`)}
                        className="mb-3 inline-flex items-center rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-blue-700"
                      >
                        Open project
                      </button>
                    )}
                    {/* The register's own words, in the register's own order, so a project reads
                        here exactly as it does on the Project Management boards. */}
                    <dl className="space-y-2.5 pb-2">
                      {[
                        ["Project Status", selected.project.projectStatus || ""],
                        ["Event ID", selected.project.eventId || ""],
                        ["Enquiry ID", selected.project.enquiryId || ""],
                        ["Verticals", selected.project.vertical || ""],
                        ["Source Branch", selected.project.sourceBranch || ""],
                        ["Main Event Date", rowDateText(selected)],
                        ["Client Main Number", selected.project.clientMainNumber || ""],
                        ["Deliverables", selected.project.deliverables || ""],
                        ["Shoots", String(selected.project.shoots?.length || "")],
                        ["Project Manager", selected.project.projectManager || ""],
                        ["Pre Production Coordinator", selected.project.preProductionCoordinator || ""],
                        ["Creative Manager", selected.project.creativeManager || ""],
                        ["Post Production Coordinator", selected.project.postProductionCoordinator || ""],
                        ["CRM Name", selected.project.crmName || ""],
                      ]
                        .filter(([, value]) => value)
                        .map(([label, value]) => (
                          <div key={label}>
                            <dt className="text-[13px] font-semibold text-slate-500">{label}</dt>
                            <dd className="mt-[3px] text-[15px] break-words text-slate-800">{value}</dd>
                          </div>
                        ))}
                    </dl>
                  </div>
                </div>
              ) : selected?.meeting ? (
                <div className="flex h-full min-h-0 flex-col">
                  <div className="border-b border-slate-200 px-4 py-3">
                    <p className="text-sm font-medium text-slate-900">{meetingTitle(selected.meeting)}</p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {formatMeetingWhen(selected.meeting.startAt, selected.meeting.endAt)}
                    </p>
                  </div>
                  <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3">
                    {/* The Meet link reads first: joining is the one thing anyone opens this
                        panel in a hurry to do. */}
                    {selected.meeting.meetLink && !isCancelled(selected.meeting) && (
                      <a
                        href={selected.meeting.meetLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mb-3 inline-flex items-center rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-blue-700"
                      >
                        Join Meet
                      </a>
                    )}
                    {/* Label over value with nothing between rows - the shape the CRM's own
                        info panel uses. */}
                    <dl className="space-y-2.5 pb-2">
                      {[
                        ["Status", meetingStatusLabel(selected.meeting)],
                        ["Enquiry Name", meetingLeadName(selected.meeting)],
                        ["Enquiry ID", selected.meeting.enquiryId || ""],
                        ["Verticals", selected.meeting.lead ? resolveVertical(selected.meeting.lead.vertical) : ""],
                        ["CRM", selected.meeting.lead?.crm || ""],
                        ["Date", formatMeetingDate(selected.meeting.startAt)],
                        ["Time", formatMeetingTime(selected.meeting.startAt)],
                        ["Duration", formatDuration(selected.meeting)],
                        ["Host", selected.meeting.organizerEmail || ""],
                        ["Guests", guestList(selected.meeting).join(", ")],
                        ["Description", selected.meeting.description || ""],
                        ["Meet link", selected.meeting.meetLink || ""],
                      ]
                        .filter(([, value]) => value)
                        .map(([label, value]) => (
                          <div key={label}>
                            <dt className="text-[13px] font-semibold text-slate-500">{label}</dt>
                            <dd className="mt-[3px] text-[15px] break-words text-slate-800">{value}</dd>
                          </div>
                        ))}
                    </dl>
                  </div>
                </div>
              ) : (
                <p className="p-4 text-sm text-slate-500">
                  Select a booking to view its details.
                </p>
              )}
            </InfoPanelShell>
          </div>
        </DataTableShell>
      </div>


      {addMeetDate !== null && (
        <ScheduleMeetDialog
          initialDate={addMeetDate}
          onClose={() => setAddMeetDate(null)}
          onScheduled={(message) => {
            showNotice(message);
            void loadMeetings();
          }}
        />
      )}

      {pendingCancel && (
        <div
          className="fixed inset-0 z-[190] flex items-center justify-center bg-slate-950/55 p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !cancelling) setPendingCancel(null);
          }}
        >
          <section
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="meeting-cancel-title"
            className="w-full max-w-[440px] overflow-hidden rounded-[24px] bg-white shadow-[0_20px_60px_rgba(15,23,42,0.22)]"
          >
            <div className="px-6 pb-5 pt-6">
              <h2 id="meeting-cancel-title" className="text-[18px] font-medium tracking-[-0.02em] text-slate-800">
                Cancel this meeting?
              </h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                {meetingTitle(pendingCancel)} · {formatMeetingWhen(pendingCancel.startAt, pendingCancel.endAt)} will be
                cancelled here and removed from Google Calendar. Everyone invited is told.
              </p>
            </div>
            <footer className="flex items-center justify-end gap-3 border-t border-slate-200 px-6 py-4">
              <Button type="button" variant="secondary" onClick={() => setPendingCancel(null)} disabled={cancelling}>
                Keep it
              </Button>
              <Button type="button" variant="danger" onClick={() => void cancelMeeting()} disabled={cancelling}>
                {cancelling ? "Cancelling..." : "Cancel meeting"}
              </Button>
            </footer>
          </section>
        </div>
      )}

      <FloatingNotice notice={notice} onClose={clearNotice} />

      {/* The same reminder the CRM shows, so a meeting coming up is announced on the page
          that lists meetings as well as on the one where leads are worked. */}
      {/* Announced through this page's own snackbar, so a meeting is said the way everything
          else on the page is said - one bar, one place, one dismiss. */}
      <MeetingReminders onRemind={(message, action) => showNotice(message, "info", action)} />
    </section>
  );
}
