"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import CakeRoundedIcon from "@mui/icons-material/CakeRounded";
import FavoriteRoundedIcon from "@mui/icons-material/FavoriteRounded";
import ModulePageHeader from "@/components/layout/ModulePageHeader";
import DataTable from "@/components/data-table/DataTable";
import DataTableShell from "@/components/data-table/DataTableShell";
import TableFooter from "@/components/data-table/TableFooter";
import KanbanBoard, { columnsFromRows, groupValue } from "@/components/data-table/KanbanBoard";
import { columnCount } from "@/lib/kanbanSummary.mjs";
import TableBoardSwitch, { useTableBoardLayout } from "@/components/data-table/TableBoardSwitch";
import AuthImage from "@/components/shared/AuthImage";
import Button from "@/components/shared/Button";
import EmployeeAvatar from "@/components/shared/EmployeeAvatar";
import FloatingNotice, { useNotice } from "@/components/shared/FloatingNotice";
import ShareableMessage from "@/components/shared/ShareableMessage";
import useMessageTemplate from "@/components/shared/useMessageTemplate";
import Dialog from "@/components/ui/Dialog";
import { ATTENDANCE_REPORT_TEMPLATE_KEY, DEFAULT_ATTENDANCE_REPORT, attendanceReportValues } from "@/lib/attendanceReport.mjs";
import { branchLabel } from "@/lib/branchName";
import { awaitsMe } from "@/lib/attendanceRequestStatus.mjs";
import RegisterAttentionCards from "./RegisterAttentionCards";
import { renderMessageOr, renderTemplate } from "@/lib/messageTemplate.mjs";
import {
  attendanceSelfiePath,
  getAttendanceRegister,
  getAttendanceRequests,
} from "@/services/hrm/attendance.service";

/**
 * The studio's attendance for one day.
 *
 * A **roster**, not a list of sessions: one row per active employee whether or not they marked
 * anything, because "who has not checked in today" is the first question anybody opens this screen
 * to ask and a list of what happened can never answer it. Somebody with no session gets the row the
 * calendar gives them — a holiday, their weekly off, approved leave, or an absence nobody explained.
 *
 * Every status here comes from the server, decided by the same rules the employee's own screen
 * reads, so the two can never disagree about what a day was. Nothing on this page recomputes one.
 *
 * Guarded by `HRM / Attendance Approval` rather than `HRM / Employee Attendance`: everybody holds
 * the second, because everybody marks their own day, and reading two hundred colleagues' mornings
 * is a different question.
 *
 * Laid out the way Image Selection → Dashboard is: the header keeps what acts on the page (Send); a
 * the headline cards are **filters**, not
 * figures to read and leave - pressing Present narrows the table below to the people present,
 * pressing it again (or Employees) lets go; and the table - Today's Attendance, one row per person
 * with the filter row, sorting and a footer count every table has - sits directly under them, because
 * a filter whose result is a screen further down is a filter nobody sees work. The birthdays notice
 * keeps its place between the two.
 */

const isoDate = (date) => {
  const local = new Date(date);
  return `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, "0")}-${String(local.getDate()).padStart(2, "0")}`;
};

const errorMessage = (error, fallback) => error?.data?.message || error?.message || fallback;

/*
 * The Send button - the day's report, as a WhatsApp message - is hidden for now. The report itself
 * is kept whole (`AttendanceReportDialog`, the template in Settings → Templates); setting this back
 * to `true` puts the button back in the header.
 */
const SHOW_SEND = false;

/*
 * The headline cards, and the view each one presses: what Today's Attendance is narrowed to.
 * **Leave** is everybody away - on approved leave (a comp-off included) or not in without one - so
 * there is no separate On leave or Absent card. **Available** is everybody working at this moment -
 * logged in and not out, not on a break and not away on a permission (the server's `available`).
 * **Permissions** is everybody away on an approved
 * permission at this moment - one already over or still to come does not count - and **Break** everybody on a break at this moment - a break taken and already
 * over does not count - each on top of whether they are present, so somebody can be under Present
 * and Break at once. No Employees
 * card: pressing a pressed card again, or the chip's × above the table, is how a filter is let go of,
 * and the table is everybody then. `matches` is the one test each card counts and narrows by.
 *
 * **Irregularities** is the fixed-shift people Absent that day - away with no approved leave,
 * comp-off or permission - the same people as the Irregularities card's Today tab below; it is part
 * of Leave as well. A flexible shift's absence is judged the day after, so it is on that card's
 * Yesterday tab and not here. Counted off the rows, since the server's summary has no such figure.
 *
 * `phone` places the card on a phone: Present across the row, then Available and Break, then
 * Permissions and Leave, then Irregularities across the row. From a tablet up the cards keep this
 * list's order.
 */
const isIrregular = (row) => row.status === "Absent" && !row.flexible;
// The tag on a card a column's figure counts: Late under Present, Irregular under Leave, nothing elsewhere.
const registerFlag = (row, column) => (column.value === "Present" ? (row.status === "Late" ? "Late" : "")
  : column.value === "Leave" ? (isIrregular(row) ? "Irregular" : "")
  : "");
const VIEWS = [
  { view: "present", label: "Present", count: (summary) => summary.present, dot: "bg-emerald-500", matches: (row) => groupOf(row) === "present", phone: "max-sm:col-span-2" },
  { view: "available", label: "Available", count: (summary) => summary.available, dot: "bg-indigo-500", matches: (row) => Boolean(row.available), phone: "max-sm:order-1" },
  { view: "absent", label: "Leave", count: (summary) => Number(summary.absent || 0) + Number(summary.onLeave || 0), dot: "bg-red-500", matches: (row) => groupOf(row) === "absent", phone: "max-sm:order-4" },
  { view: "permission", label: "Permissions", count: (summary) => summary.onPermission, dot: "bg-amber-500", matches: (row) => Boolean(row.onPermission), phone: "max-sm:order-3" },
  { view: "break", label: "Break", count: (summary) => summary.onBreak, dot: "bg-sky-500", matches: (row) => Boolean(row.onBreak), phone: "max-sm:order-2" },
  { view: "irregular", label: "Irregularities", count: (summary, rows) => rows.filter(isIrregular).length, dot: "bg-orange-500", matches: isIrregular, phone: "max-sm:order-5 max-sm:col-span-2" },
];
const inView = (row, view) => !view || Boolean(VIEWS.find((entry) => entry.view === view)?.matches(row));

/**
 * Which of the day's groups a person is in - by the day's status, the same test the headline cards
 * count by, so a card's figure and the list it narrows to always agree. A login alone is not
 * Present: a day too short for a half day reads as Absent, and so does a day on leave. Holidays and
 * weekly offs are "other".
 */
const groupOf = (row) => (row.attended ? "present" : row.status === "Absent" || row.status === "On leave" ? "absent" : "other");
const GROUP_ORDER = { present: 0, absent: 1, other: 2 };
const viewLabel = (view) => VIEWS.find((entry) => entry.view === view)?.label || "Everybody";

/**
 * The headline cards, each a filter on Today's Attendance - the Image Selection dashboard's cards,
 * read the same way: the name at the top, the figure and its unit at the bottom. On a phone each is
 * compact - less padding, a smaller figure, no unit - so two fit abreast on a 300px screen and the
 * table is not pushed down; from a tablet up they take the Image Selection size.
 */
function HeadlineCards({ summary, rows, loading, view, onViewChange }) {
  // On a phone Present and Irregularities take a row each and the rest go two abreast (each card's
  // `phone`); three on a tablet, all six in one row from a laptop up.
  return <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3 lg:grid-cols-6">
    {VIEWS.map((card) => {
      const value = Number((summary && card.count(summary, rows)) || 0);
      const pressed = view === card.view;
      return <button
        key={card.label}
        type="button"
        aria-pressed={pressed}
        onClick={() => onViewChange(pressed && card.view ? null : card.view)}
        className={`flex min-w-0 flex-col gap-1.5 rounded-lg border bg-white px-2.5 py-2 text-left shadow-sm transition hover:border-blue-300 hover:shadow-md sm:gap-4 sm:rounded-xl sm:px-4 sm:py-4 sm:shadow-md sm:hover:shadow-lg ${card.phone} ${pressed ? "border-blue-400 ring-2 ring-blue-100" : "border-slate-200"}`}
      >
        <span className="flex min-w-0 items-center gap-1.5 text-[11px] font-medium leading-4 text-slate-600 sm:gap-2 sm:text-[13px]">
          {card.dot && <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${card.dot}`} />}
          <span className="min-w-0 truncate">{card.label}</span>
        </span>
        <span className="flex items-end justify-between gap-2">
          {loading && !summary
            ? <span aria-hidden="true" className="h-5 w-10 animate-pulse rounded bg-slate-100 sm:h-7 sm:w-16" />
            : <span className="min-w-0 truncate text-lg font-bold leading-none tabular-nums text-slate-900 sm:text-2xl">
              {value.toLocaleString("en-IN")}<span className="hidden text-sm font-normal text-slate-500 sm:inline"> {value === 1 ? "person" : "people"}</span>
            </span>}
        </span>
      </button>;
    })}
  </div>;
}

/**
 * Where somebody logged in, as the table shows it: the district and the state - "Erode, Tamil Nadu"
 * out of "Kumalankuttai, Periyasemur, Erode, Tamil Nadu, 638001". The street and the locality are
 * the same handful of places for everybody and say little at a glance; the whole address stays on
 * hover.
 *
 * The server writes addresses as road, town, district, state, PIN code (`formatAddress` in
 * services/geocoding.js, repeats dropped), so the district and state are the two parts before the
 * PIN code - "India" is dropped as well, for an address that fell back to Nominatim's own line.
 * Coordinates, shown until the address is looked up, stay whole: cut at their comma they would be a
 * latitude and nothing else.
 */
const COORDINATES = /^-?\d+(\.\d+)?,\s*-?\d+(\.\d+)?$/;
const districtAndState = (place) => {
  const text = String(place || "").trim();
  if (!text || COORDINATES.test(text)) return text;
  const parts = text.split(",").map((part) => part.trim()).filter(Boolean);
  while (parts.length > 1 && (/^\d[\d\s]*$/.test(parts[parts.length - 1]) || /^india$/i.test(parts[parts.length - 1]))) parts.pop();
  return parts.slice(-2).join(", ") || text;
};

/**
 * Today's Attendance: everybody on the register, one row each, in the shared `DataTable` - the table
 * in the place Recent Projects has on Image Selection's dashboard, with its filter row, sorting,
 * Table Options and footer. Present first, then absent (on leave included), then anybody not
 * expected today, each by name, until a column is sorted.
 *
 * Two narrowings, one after the other: `view` is the headline card pressed above, and the filter
 * row asks which person. Both run on rows the page already holds. The footer counts what is left
 * after both, as the table reports it.
 *
 * Display only: a click picks a row out, and there is nothing behind a row to open.
 */
function TodaysAttendance({ rows, view, onClearView, loading, dayOff }) {
  const label = viewLabel(view);
  const [selectedId, setSelectedId] = useState(null);
  // How many rows survived the table's own filter row, which only the table can say. The setter is
  // passed straight in: a fresh callback each render would have the table report on every render.
  const [stats, setStats] = useState(null);
  // Table or Board. The board stands people under the Status column's word - Present, Leave, then a
  // holiday or weekly off - a view only, as the table is.
  const [layout, setLayout] = useTableBoardLayout("attendance-register-today");
  const onBoard = layout === "board";
  const shown = useMemo(() => rows
    .filter((row) => inView(row, view))
    .sort((a, b) => GROUP_ORDER[groupOf(a)] - GROUP_ORDER[groupOf(b)] || String(a.employeeName).localeCompare(String(b.employeeName))), [rows, view]);

  // The default order; anybody can drag the columns into their own, which the table remembers.
  const columns = useMemo(() => [
    { id: "employee", header: "Employee", accessorFn: (row) => row.employeeName, width: 220, cell: ({ row }) => <span className="flex min-w-0 items-center gap-2">
      <RegisterFace row={row.original} />
      <span className="truncate font-medium text-slate-800">{row.original.employeeName}</span>
    </span> },
    { id: "location", header: "Login location", accessorFn: (row) => districtAndState(row.loginPlace), width: 190, cell: ({ row }) => row.original.loginPlace
      ? <span title={row.original.loginPlace} className="block truncate">{districtAndState(row.original.loginPlace)}</span>
      : "—" },
    { id: "status", header: "Status", accessorFn: (row) => statusLabel(row), width: 110, cell: ({ row }) => <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${GROUP_PILL[groupOf(row.original)]}`}>{statusLabel(row.original)}</span> },
    { id: "branch", header: "Branch", accessorFn: (row) => branchLabel(row.branchName) || "", width: 130, cell: ({ row }) => branchLabel(row.original.branchName) || "—" },
    { id: "login", header: "Login", accessorFn: (row) => row.checkInAt || "", width: 100, cell: ({ row }) => clockOf(row.original.checkInAt) },
    { id: "logout", header: "Logout", accessorFn: (row) => row.checkOutAt || "", width: 100, cell: ({ row }) => clockOf(row.original.checkOutAt) },
    // A day too short to count is in red, so an Absent with a login time explains itself.
    { id: "worked", header: "Worked", accessorFn: (row) => row.workedMinutes || 0, width: 110, cell: ({ row }) => <span className={!row.original.attended && row.original.checkInAt ? "font-medium text-red-700" : ""}>{row.original.workedLabel || "—"}</span> },
    // The day's approved permissions, each as its time window, and said when one is running now.
    { id: "permission", header: "Permission", accessorFn: (row) => permissionText(row), width: 190, cell: ({ row }) => (permissionText(row.original)
      ? <span>{permissionText(row.original)}{row.original.onPermission && <span className="ml-1.5 rounded-full bg-amber-50 px-1.5 py-0.5 text-[11px] font-semibold text-amber-700">On permission</span>}</span>
      : "—") },
    // The day's breaks in all, and said when one is running now.
    { id: "break", header: "Break", accessorFn: (row) => row.breakMinutes || 0, width: 130, cell: ({ row }) => (row.original.breakCount
      ? <span>{row.original.breakLabel}{row.original.onBreak && <span className="ml-1.5 rounded-full bg-sky-50 px-1.5 py-0.5 text-[11px] font-semibold text-sky-700">On break</span>}</span>
      : "—") },
  ], []);

  const matched = Math.min(stats?.total ?? shown.length, shown.length);
  const narrowed = matched !== rows.length;
  const footerText = loading && !rows.length
    ? "Loading..."
    : narrowed
      ? `${matched} of ${rows.length} employees${view ? ` · ${label}` : ""}`
      : `${rows.length} employees, present first`;
  const emptyText = {
    present: "Nobody has checked in today.",
    absent: dayOff ? `Today is ${dayOff} - nobody is expected.` : "Nobody is on leave today.",
    available: "Nobody is available right now - everybody is on a break, on a permission, logged out or not in yet.",
    permission: "Nobody is on a permission right now.",
    break: "Nobody is on a break right now.",
  }[view] || "Nobody is on the register today.";

  return <section className="flex min-w-0 flex-col">
    <div className="flex flex-wrap items-center justify-between gap-2 pb-2">
      <h2 className="min-w-0 text-sm font-medium text-slate-700">
        Today&rsquo;s Attendance
        {/* What the table is narrowed to, and the one place to let it go from down here. */}
        {view && <span className="ml-2 inline-flex items-center gap-1 rounded-full border border-blue-300 bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700">
          {label}
          <button type="button" onClick={onClearView} aria-label={`Show all employees instead of ${label}`} className="rounded px-0.5 leading-none hover:bg-blue-100">×</button>
        </span>}
      </h2>
      <TableBoardSwitch value={layout} onChange={setLayout} />
    </div>
    {onBoard ? <div className="flex h-110 min-h-0 min-w-0 rounded-xl border border-slate-200 bg-white shadow-sm">
      <KanbanBoard
        rows={shown}
        columns={columnsFromRows(shown, statusLabel, { order: ["Present", "Leave"] }).map((column) => ({ ...column, className: BOARD_COLUMN_COLOURS[column.value] }))}
        statusOf={(row) => groupValue(statusLabel(row))}
        // Under Present: how many came in Late (a Late day is attended, so it sits here); under Leave: the
        // Irregularities among them (`isIrregular`); nothing under a holiday or weekly off.
        columnAmount={(rows, column) => (column.value === "Present" ? columnCount(rows, (row) => Boolean(registerFlag(row, column)), "Late")
          : column.value === "Leave" ? columnCount(rows, (row) => Boolean(registerFlag(row, column)), "Irregular")
          : null)}
        cardFlag={registerFlag}
        card={{
          title: (row) => row.employeeName,
          subtitle: (row) => [row.employeeCode, branchLabel(row.branchName)].filter(Boolean).join(" · "),
          meta: (row) => [row.checkInAt ? `In ${clockOf(row.checkInAt)}` : "", row.checkOutAt ? `Out ${clockOf(row.checkOutAt)}` : "", row.workedLabel || ""].filter(Boolean).join(" · "),
        }}
        getRowId={(row) => String(row.employeeId)}
        viewOnly="Attendance is worked out from check-ins. Raise an attendance request to correct a day."
        loading={loading && !rows.length}
        noun="employees"
        ariaLabel="Today's attendance board"
      />
    </div> : <DataTableShell className="shadow-sm" footer={<TableFooter><span className="text-xs">{footerText}</span></TableFooter>}>
      <DataTable
        columns={columns}
        data={shown}
        loading={loading && !rows.length}
        loadingMessage="Loading today's attendance..."
        emptyMessage={emptyText}
        noMatchMessage="Nobody matches that search."
        getRowId={(row) => String(row.employeeId)}
        selectedRowId={selectedId || undefined}
        onRowClick={(row) => setSelectedId(String(row.employeeId))}
        ariaLabel="Today's attendance"
        // Fifteen rows tall at most, scrolling for the rest - Recent Projects' cap, and for its reason.
        className="max-h-110"
        onVisibleRowsChange={setStats}
        features={{ filtering: true, sorting: true, infiniteScroll: { pageSize: 15 } }}
      />
    </DataTableShell>}
  </section>;
}

/**
 * The photograph the person checked in with, beside their name in the table's first column, fetched
 * through the guarded selfie endpoint - there is no link to storage to hand out - or their initials
 * where there is none: nobody absent checked in.
 */
function RegisterFace({ row }) {
  return row.checkInSelfieEventId
    ? <AuthImage path={attendanceSelfiePath(row.checkInSelfieEventId)} alt={`${row.employeeName} check-in photo`} className="h-7 w-7 shrink-0 rounded-full" viewable />
    : <EmployeeAvatar name={row.employeeName} seed={row.employeeId} size="xs" />;
}

/** A time of day off a timestamp, "10:10 AM", or a dash where there is none. */
/** A row's approved permissions as their time windows: "10:00–11:00, 16:00–17:00". */
const permissionText = (row) => (row.permissions || []).map((entry) => [entry.fromTime, entry.toTime].filter(Boolean).join("–")).filter(Boolean).join(", ");

const clockOf = (value) => (value
  ? new Intl.DateTimeFormat("en-GB", { hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(value)).toUpperCase()
  : "—");

/**
 * The day's status as a pill in its group's colour - the -50 / -700 pairs the dark themes remap. On
 * leave is red with the other absences.
 */
// The board's column headers, in the Status pills' colours; a holiday or weekly off keeps the default.
const BOARD_COLUMN_COLOURS = { Present: "bg-emerald-600 text-white", Leave: "bg-red-600 text-white" };

const GROUP_PILL = {
  present: "bg-emerald-50 text-emerald-700",
  absent: "bg-red-50 text-red-700",
  other: "bg-slate-100 text-slate-700",
};

/**
 * What the Status column says: Present or Leave, the headline cards' two words, rather than the
 * day's finer reading (Late, Not logged out, On leave, ...) - the register answers who is in. A
 * holiday or weekly off is neither, and keeps its own name.
 */
const statusLabel = (row) => ({ present: "Present", absent: "Leave" })[groupOf(row)] || row.status;

/**
 * The day's birthdays and wedding anniversaries among the people working here, above the boxes - a
 * reason to say something to somebody, read off the same day the register is showing.
 *
 * Names only, as the server sends them. The box is always there, so the place to look is always
 * the same: a day with neither says so in a line of its own. Says "today" for today, and the date
 * for any other day the register is turned to.
 */
function CelebrationsNotice({ celebrations, date }) {
  const birthdays = celebrations?.birthdays || [];
  const anniversaries = celebrations?.anniversaries || [];
  const none = !birthdays.length && !anniversaries.length;
  const when = date === isoDate(new Date()) ? "today" : `on ${new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`))}`;
  const names = (people) => people.map((person) => person.employeeName).join(", ");
  const line = (Icon, tone, label, people) => people.length > 0 && <p className="flex items-start gap-2">
    <Icon aria-hidden="true" fontSize="small" className={`mt-px shrink-0 ${tone}`} />
    <span className="min-w-0"><span className="font-semibold text-slate-900">{label} {when}:</span> {names(people)}</span>
  </p>;

  return <section aria-label="Birthdays and anniversaries" className="space-y-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700 sm:px-4">
    {none
      ? <p className="flex items-start gap-2 text-slate-500">
        <CakeRoundedIcon aria-hidden="true" fontSize="small" className="mt-px shrink-0 text-slate-400" />
        <span className="min-w-0">No birthdays or wedding anniversaries {when}.</span>
      </p>
      : <>
        {line(CakeRoundedIcon, "text-pink-600", birthdays.length === 1 ? "Birthday" : "Birthdays", birthdays)}
        {line(FavoriteRoundedIcon, "text-rose-600", anniversaries.length === 1 ? "Wedding anniversary" : "Wedding anniversaries", anniversaries)}
      </>}
  </section>;
}

/**
 * `title` and `leadingAccessory` let Employee Attendance show this screen under its own heading, with
 * its section switch beside it - it is one of that page's sections; its own route still opens it
 * alone. `onOpenRequests` is that page's way to its Leave or Comp-Off Request section, for the
 * Request card's Open; alone, the card lists without it.
 */
export default function AttendanceRegisterPage({ title = "Attendance Register", leadingAccessory = null, onOpenRequests = null }) {
  const { notice, showError, clearNotice } = useNotice();
  /*
   * Today, across every branch. The Date and Branch filters are gone: the register answers the one
   * question it is opened for - who is in today - and Send reports that same day for the studio.
   */
  const [date] = useState(() => isoDate(new Date()));
  const branchId = "";
  const [register, setRegister] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [sending, setSending] = useState(false);
  // Which headline card is pressed - what Today's Attendance is narrowed to. Null is everybody.
  const [view, setView] = useState(null);
  /*
   * Only the latest ask is allowed to land, so a slow earlier answer cannot overwrite a newer one. A
   * failed first load leaves the page empty and says so; a failed refresh keeps what is on screen.
   */
  const latestLoad = useRef(0);
  const load = useCallback(() => {
    const ticket = ++latestLoad.current;
    setLoading(true);
    getAttendanceRegister({ date, branchId })
      .then((response) => {
        if (ticket !== latestLoad.current) return;
        setRegister(response?.data || null);
        setLoadError("");
      })
      .catch((error) => {
        if (ticket !== latestLoad.current) return;
        setLoadError(errorMessage(error, "Unable to load the attendance register."));
        showError(errorMessage(error, "Unable to load the attendance register."));
      })
      .finally(() => { if (ticket === latestLoad.current) setLoading(false); });
  }, [date, branchId, showError]);

  /*
   * The Request card: what waits on this login's answer - the team list, narrowed the way Leave or
   * Comp-Off Request's "Waiting for me" narrows it (`awaitsMe`). Its own load, so a refusal here
   * leaves the register standing and says so in the card.
   */
  const [waitingRequests, setWaitingRequests] = useState([]);
  const [requestsLoading, setRequestsLoading] = useState(true);
  const [requestsError, setRequestsError] = useState("");
  const loadRequests = useCallback(() => {
    setRequestsLoading(true);
    setRequestsError("");
    getAttendanceRequests({ scope: "team" })
      .then((response) => setWaitingRequests((response?.data || []).filter(awaitsMe)))
      .catch((error) => setRequestsError(errorMessage(error, "Unable to load the requests waiting for you.")))
      .finally(() => setRequestsLoading(false));
  }, []);

  // Deferred a tick, this codebase's convention for a first load: a fetch started straight from an
  // effect body counts as state set during that effect.
  useEffect(() => {
    const timer = setTimeout(() => { load(); loadRequests(); }, 0);
    return () => clearTimeout(timer);
  }, [load, loadRequests]);

  const summary = register?.summary || null;
  const rows = register?.rows || [];
  // Holidays and weekly offs are studio-wide and outrank leave, so one row carrying either means the
  // whole day is one - which is what an empty Absent list then says.
  const dayOff = rows.some((row) => row.status === "Holiday") ? "a holiday"
    : rows.some((row) => row.status === "Weekly off") ? "a weekly off" : "";

  return <>
    {/* The header keeps what acts on the page - Send, hidden for now (`SHOW_SEND`). There is no Refresh:
        opening the page reads it. */}
    <ModulePageHeader
      title={title}
      // Only when shown inside another screen, which puts its own switch here.
      titleAccessory={leadingAccessory ? <div className="flex min-w-0 flex-wrap items-center gap-2 sm:border-l sm:border-slate-200 sm:pl-3">
        {leadingAccessory}
      </div> : null}
      // No WhatsApp button: the daily report's group is named from Settings → User Settings →
      // Attendance WhatsApp Report, and each sender connects their own WhatsApp there.
      actions={SHOW_SEND ? <Button type="button" variant="primary" onClick={() => setSending(true)}>Send</Button> : null}
    />

    {/* Fills what is left of the shell's column and scrolls inside it. `dashboard-canvas` is the
        tinted ground the cards sit on, defined per theme in globals.css. */}
    <div className="dashboard-canvas min-h-0 flex-1 overflow-y-auto px-3 py-3 sm:px-4">
      {/* No caption or WhatsApp status line above the cards: the page opens straight on the figures. */}
      <HeadlineCards summary={summary} rows={rows} loading={loading} view={view} onViewChange={setView} />

      <div className="mt-3">
        <CelebrationsNotice celebrations={register?.celebrations} date={register?.date || date} />
      </div>

      <div className="mt-3">
        <TodaysAttendance rows={rows} view={view} onClearView={() => setView(null)} loading={loading} dayOff={dayOff} />
      </div>

      <div className="mt-3">
        <RegisterAttentionCards
          irregularities={register?.irregularities}
          shownDate={register?.date || date}
          loading={loading && !register}
          error={register ? "" : loadError}
          onRetry={load}
          requests={waitingRequests}
          requestsLoading={requestsLoading}
          requestsError={requestsError}
          onRetryRequests={loadRequests}
          onOpenRequests={onOpenRequests}
        />
      </div>
    </div>

    {sending && <AttendanceReportDialog
      date={date}
      branchId={branchId}
      branchName=""
      onClose={() => setSending(false)}
    />}
    <FloatingNotice notice={notice} onClose={clearNotice} />
  </>;
}

/**
 * The Send message: today's attendance as it stands right now, as the studio's own
 * wording (`ATTENDANCE_DAILY_REPORT`, Settings → Templates) in the same copy box the invites and
 * the receipt end on.
 *
 * Read again when the dialog opens rather than taken from the page behind it, for two reasons: the
 * message is "up to this moment", so a register loaded ten minutes ago is not good enough, and the
 * list may be narrowed by a headline card or its search, which a report of the day must not be.
 * It still takes a branch, which the page now always leaves at every branch.
 */
function AttendanceReportDialog({ date, branchId, branchName, onClose }) {
  const template = useMessageTemplate(ATTENDANCE_REPORT_TEMPLATE_KEY);
  const [report, setReport] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const read = useCallback(() => {
    setLoading(true);
    setError("");
    getAttendanceRegister({ date, branchId })
      .then((response) => setReport({ register: response?.data || null, asOf: new Date() }))
      .catch((requestError) => setError(errorMessage(requestError, "Unable to read the register for this report.")))
      .finally(() => setLoading(false));
  }, [date, branchId]);

  useEffect(() => {
    const timer = window.setTimeout(read, 0);
    return () => window.clearTimeout(timer);
  }, [read]);

  // The studio's wording where it has written one, the seeded default where it has not.
  const values = report ? attendanceReportValues(report.register, { branchName, asOf: report.asOf }) : null;
  const message = values ? renderMessageOr(renderTemplate(DEFAULT_ATTENDANCE_REPORT, values), template, values) : "";

  return <Dialog
    title="Send Attendance"
    description="The day's attendance up to now, in your Attendance Report template. Copy it and send it on WhatsApp."
    size="md"
    onClose={onClose}
    footer={<>
      <Button type="button" disabled={loading} onClick={read}>{loading ? "Reading..." : "Refresh"}</Button>
      <Button type="button" variant="primary" onClick={onClose}>Done</Button>
    </>}
  >
    {error
      ? <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      : !report
        ? <p className="text-sm text-slate-500">Reading the register...</p>
        : <ShareableMessage label="Message to send" rows={16} message={message} />}
  </Dialog>;
}
