"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import CalendarMonthOutlinedIcon from "@mui/icons-material/CalendarMonthOutlined";
import CameraAltRoundedIcon from "@mui/icons-material/CameraAltRounded";
import CloseRoundedIcon from "@mui/icons-material/CloseRounded";
import DeleteOutlineOutlinedIcon from "@mui/icons-material/DeleteOutlineOutlined";
import ErrorOutlineOutlinedIcon from "@mui/icons-material/ErrorOutlineOutlined";
import FileDownloadOutlinedIcon from "@mui/icons-material/FileDownloadOutlined";
import LocationOnOutlinedIcon from "@mui/icons-material/LocationOnOutlined";
import AccessTimeOutlinedIcon from "@mui/icons-material/AccessTimeOutlined";
import DataTable from "@/components/data-table/DataTable";
import useTableSelection from "@/components/data-table/useTableSelection";
import DataTableShell from "@/components/data-table/DataTableShell";
import { buildTableColumns, defaultVisibilityFor } from "@/components/data-table/tableCells";
import ModulePageHeader from "@/components/layout/ModulePageHeader";
import Button from "@/components/shared/Button";
import IconButton from "@/components/shared/IconButton";
import CheckboxGroupField from "@/components/shared/CheckboxGroupField";
import DateField from "@/components/shared/DateField";
import FloatingNotice, { useNotice } from "@/components/shared/FloatingNotice";
import TextAreaField from "@/components/shared/TextAreaField";
import TextField from "@/components/shared/TextField";
import TimeField from "@/components/shared/TimeField";
import Dialog from "@/components/ui/Dialog";
import DropdownMenu from "@/components/ui/DropdownMenu";
import OptionsMenu from "@/components/ui/OptionsMenu";
import { compressImageFile } from "@/lib/imageCompression";
import useEscapeKey from "@/components/shared/useEscapeKey";
import { getMyProfile } from "@/services/user/profile.service";
import { getMasterData } from "@/services/hrm/master-data.service";
import { branchLabel } from "@/lib/branchName";
import useBranchRegistry from "@/components/shared/useBranchRegistry";
import Dropdown from "@/components/shared/Dropdown";
import DashboardCard, { CardState } from "@/components/shared/DashboardCard";
import AttendanceRequestDialog from "@/components/hrm/AttendanceRequestDialog";
import { formatTotalMinutes } from "@/lib/attendanceTime.mjs";
import {
  approveAttendanceRequest,
  cancelAttendanceRequest,
  createAttendanceRequest,
  getAttendanceRequests,
  getAttendanceSettings,
  getAttendanceSummary,
  getTodayAttendance,
  markAttendanceLogin,
  markAttendanceLogout,
  attendanceSelfieUrl,
  getAttendanceOfficeLocations,
  getAttendanceQuotes,
  addAttendanceQuote,
  removeAttendanceQuote,
  saveAttendanceOfficeLocation,
  removeAttendanceOfficeLocation,
  rejectAttendanceRequest,
  saveAttendanceSettings,
  withdrawAttendanceRequest,
} from "@/services/hrm/attendance.service";

/**
 * Employee Attendance.
 *
 * Every record on this screen lives on the server. It used to live in `window.localStorage`, which
 * meant a login was device-specific, vanished with the site data, and could be rewritten from the
 * console by the person it judged — and that nothing was ever validated or approved by anybody.
 *
 * Two consequences shape the code below. Statuses and totals are read, not computed: whether a day
 * was late, a holiday, a weekly off or covered by approved leave is decided against the studio's
 * rules in `backend/src/modules/hrm/attendance/attendanceRules.js`, so the browser renders the
 * answer rather than inventing a second one that would disagree. And a decision is a request to the
 * server that can be refused — approving, rejecting, cancelling and re-applying all go through the
 * approver checks and land in the request's event log.
 */

const SECTION_SELF = "self-dashboard";
const SECTION_LOGIN = "login";
const SECTION_PERMISSION = "permission";
const SECTION_LEAVE = "leave";
const SECTION_APPROVALS = "approvals";
const SECTION_RULES = "rules";

const baseSections = [
  { label: "Self Dashboard", value: SECTION_SELF },
  { label: "Login", value: SECTION_LOGIN },
  { label: "Permission", value: SECTION_PERMISSION },
  { label: "Leave", value: SECTION_LEAVE },
  { label: "Approvals", value: SECTION_APPROVALS },
];

/**
 * The tabs a request list is filtered by. "Upcoming" is a reading of an approved request whose
 * dates have not arrived yet, not a status anybody sets — the server derives it per request, so
 * an approved leave moves from this tab to Approved on its own start date.
 */
const statusTabs = ["All", "Pending", "Approved", "Upcoming", "Rejected", "Cancelled"];

const requestTypeLabels = { LEAVE: "Leave", PERMISSION: "Permission", ON_DUTY: "On duty / travel" };
const requestSectionTypes = { [SECTION_LEAVE]: ["LEAVE", "ON_DUTY"], [SECTION_PERMISSION]: ["PERMISSION"] };

const tableConfig = {
  [SECTION_LEAVE]: {
    ariaLabel: "Leave requests table",
    emptyMessage: "No leave requests found.",
    noMatchMessage: "No matching leave requests found.",
    columns: [
      { id: "employeeName", header: "Employee Name", accessorKey: "employeeName" },
      { id: "employeeId", header: "Employee ID", accessorKey: "employeeId" },
      { id: "leaveType", header: "Leave Type", accessorKey: "leaveType" },
      { id: "fromDate", header: "From Date", accessorKey: "fromDate" },
      { id: "toDate", header: "To Date", accessorKey: "toDate" },
      { id: "days", header: "Days", accessorKey: "days" },
      { id: "reason", header: "Reason", accessorKey: "reason" },
      { id: "status", header: "Status", accessorKey: "status" },
      { id: "approvals", header: "Approvals", accessorKey: "approvals" },
      { id: "appliedOn", header: "Applied On", accessorKey: "appliedOn" },
      { id: "approvedBy", header: "Approved By", accessorKey: "approvedBy" },
      { id: "remarks", header: "Remarks", accessorKey: "remarks" },
    ],
  },
  [SECTION_PERMISSION]: {
    ariaLabel: "Permission requests table",
    emptyMessage: "No permission requests found.",
    noMatchMessage: "No matching permission requests found.",
    columns: [
      { id: "employeeName", header: "Employee Name", accessorKey: "employeeName" },
      { id: "employeeId", header: "Employee ID", accessorKey: "employeeId" },
      { id: "date", header: "Date", accessorKey: "date" },
      { id: "fromTime", header: "From Time", accessorKey: "fromTime" },
      { id: "toTime", header: "To Time", accessorKey: "toTime" },
      { id: "duration", header: "Duration", accessorKey: "duration" },
      { id: "reason", header: "Reason", accessorKey: "reason" },
      { id: "status", header: "Status", accessorKey: "status" },
      { id: "approvals", header: "Approvals", accessorKey: "approvals" },
      { id: "appliedOn", header: "Applied On", accessorKey: "appliedOn" },
      { id: "approvedBy", header: "Approved By", accessorKey: "approvedBy" },
      { id: "remarks", header: "Remarks", accessorKey: "remarks" },
    ],
  },
  [SECTION_APPROVALS]: {
    ariaLabel: "Attendance approvals table",
    emptyMessage: "Nothing is waiting for your approval.",
    noMatchMessage: "No matching requests found.",
    columns: [
      { id: "employeeName", header: "Employee Name", accessorKey: "employeeName" },
      { id: "employeeId", header: "Employee ID", accessorKey: "employeeId" },
      { id: "requestType", header: "Request", accessorKey: "requestType" },
      { id: "period", header: "Period", accessorKey: "period" },
      { id: "duration", header: "Duration", accessorKey: "duration" },
      { id: "reason", header: "Reason", accessorKey: "reason" },
      { id: "status", header: "Status", accessorKey: "status" },
      { id: "approvals", header: "Approvals", accessorKey: "approvals" },
      { id: "appliedOn", header: "Applied On", accessorKey: "appliedOn" },
      { id: "approvedBy", header: "Decided By", accessorKey: "approvedBy" },
      { id: "remarks", header: "Remarks", accessorKey: "remarks" },
    ],
  },
};

const workModes = [
  { id: "office", title: "Office" },
  { id: "work-from-home", title: "Work from home" },
  { id: "client-site", title: "Client site" },
];
const rangeOptions = ["This week", "Last week", "This month", "Last month", "Last 6 months", "This Year", "Last Year", "Lifetime", "Custom"];

/*
 * The ranges the Self Dashboard offers, which is a shorter list than the Login Summary's.
 *
 * A dashboard is read at a few useful scales rather than at every possible one; "Last week" and
 * "Last month" are questions somebody asks of a table, not of a set of headline figures.
 */
const dashboardRangeOptions = ["This week", "This month", "Last 6 months", "This Year", "Lifetime"];

/*
 * Beyond this many days the dashboard asks for figures only.
 *
 * A day row per date stops being readable long before it stops being possible: three months is
 * ninety rows nobody scrolls to answer "how has this year gone". Ninety-two days is a quarter, which
 * is the longest range where a calendar of it is still worth drawing.
 */
const TOTALS_ONLY_ABOVE_DAYS = 92;
const weekdayOptions = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
  .map((label, value) => ({ value, label }));

/** Every status the server can send back, and the dot each is painted with in a table. */
const attendanceStatusStyles = {
  Absent: "bg-red-500",
  Approved: "bg-emerald-500",
  Cancelled: "bg-slate-400",
  "Early exit": "bg-amber-500",
  "Half day": "bg-amber-500",
  Holiday: "bg-slate-400",
  Late: "bg-amber-500",
  // A past day that was never closed. Same red as an absence: both are days the register cannot
  // report on until somebody does something about them.
  "Missed checkout": "bg-red-500",
  "Not logged out": "bg-red-500",
  "On leave": "bg-blue-500",
  "On time": "bg-emerald-500",
  Pending: "bg-amber-500",
  Permitted: "bg-blue-500",
  Rejected: "bg-red-500",
  Upcoming: "bg-blue-500",
  "Weekly off": "bg-slate-400",
};

/** `[key, header, kind, width, minWidth]`, which is also where the CSV export takes its header from. */
const loginSummaryFields = [
  ["day", "Date", undefined, 190, 130],
  ["in", "Login", undefined, 150, 110],
  ["out", "Logout", undefined, 150, 110],
  ["net", "Total Hours", undefined, 170, 130],
  ["mode", "Work Mode", undefined, 190, 140],
  ["status", "Status", "status", 170, 130],
];
const loginSummaryVisibility = attendanceVisibility(loginSummaryFields);

function formatTimestamp(value) {
  if (!value) return "Not captured";
  return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "medium" }).format(new Date(value));
}

/**
 * The headline for a captured position: the address where one has been resolved, the coordinates
 * where it has not.
 *
 * The address is filled in a moment after the capture rather than during it, so a check-in that has
 * just happened shows coordinates and picks up its address on the next load. Coordinates are never
 * lost — they are what the distance was actually measured from, and an address is a convenience
 * written on top of them.
 */
function locationLabel(location, address) {
  if (address) return address;
  if (!location) return "Not captured";
  return `${location.latitude.toFixed(6)}, ${location.longitude.toFixed(6)}`;
}

/**
 * The line under it: how far from which office, and how precise the reading was.
 *
 * This is the part that answers the question the geofence exists for. A distance with no office to
 * measure it against is meaningless, so both are named or neither is.
 */
function locationDetail({ location, distanceMeters, officeName, verified }) {
  const parts = [];
  if (officeName && Number.isFinite(Number(distanceMeters))) {
    parts.push(`${formatDistance(distanceMeters)} from ${officeName}`);
  } else if (officeName) {
    parts.push(`Measured against ${officeName}`);
  }
  if (location?.accuracy != null) parts.push(`± ${Math.round(location.accuracy)} m`);
  if (verified === false && officeName) parts.push("not verified");
  return parts.join(" · ");
}

const startOfDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
const endOfDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
const isoDate = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};
const workModeLabel = (value) => workModes.find((mode) => mode.id === value)?.title || "";

/**
 * The longest range the summary endpoint will build day rows for. Kept in step with the server's
 * own limit so "Maximum" for somebody who joined years ago comes back with data rather than a 400.
 */
const MAX_RANGE_DAYS = 730;

function rangeForOption(option, customRange, joiningDate) {
  const now = new Date();
  const day = now.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const thisWeekStart = startOfDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() + mondayOffset));
  if (option === "Last week") return { start: new Date(thisWeekStart.getFullYear(), thisWeekStart.getMonth(), thisWeekStart.getDate() - 7), end: endOfDay(new Date(thisWeekStart.getFullYear(), thisWeekStart.getMonth(), thisWeekStart.getDate() - 1)) };
  if (option === "This month") return { start: new Date(now.getFullYear(), now.getMonth(), 1), end: endOfDay(now) };
  if (option === "Last month") return { start: new Date(now.getFullYear(), now.getMonth() - 1, 1), end: endOfDay(new Date(now.getFullYear(), now.getMonth(), 0)) };
  if (option === "This Year") return { start: new Date(now.getFullYear(), 0, 1), end: endOfDay(now) };
  if (option === "Last Year") return { start: new Date(now.getFullYear() - 1, 0, 1), end: endOfDay(new Date(now.getFullYear() - 1, 11, 31)) };
  if (option === "Last 6 months") return { start: startOfDay(new Date(now.getFullYear(), now.getMonth() - 6, now.getDate())), end: endOfDay(now) };
  /*
   * Lifetime is the joining date, and it means it now.
   *
   * It used to be "Maximum" and was clamped to two years back, because the summary endpoint built a
   * row per day and refused anything longer. It answers with figures alone for a range this long, so
   * there is nothing left to clamp — somebody five years in gets five years. `MAX_RANGE_DAYS` stays
   * the floor for a record with no joining date on it, where there is nothing better to start from.
   */
  if (option === "Lifetime" || option === "Maximum") {
    const fallback = startOfDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - MAX_RANGE_DAYS));
    return { start: joiningDate ? startOfDay(new Date(joiningDate)) : fallback, end: endOfDay(now) };
  }
  if (option === "Custom") return { start: startOfDay(new Date(customRange.start || isoDate(now))), end: endOfDay(new Date(customRange.end || isoDate(now))) };
  return { start: thisWeekStart, end: endOfDay(now) };
}

function rangeLabel(option, range) {
  const formatter = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" });
  return `${option}: ${formatter.format(range.start)} - ${formatter.format(range.end)}`;
}

function formatMinutes(minutes) {
  if (!minutes) return "-";
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function timeOnly(value) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
}

function dayLabel(value) {
  return new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short" }).format(new Date(value));
}

function dateDisplay(value) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" }).format(new Date(value));
}

/** The summary table's rows. Every field is what the server decided; nothing is recomputed here. */
function rowsFromDays(days) {
  return (days || []).map((day) => ({
    key: day.date,
    day: dayLabel(day.date),
    in: timeOnly(day.loginAt),
    out: timeOnly(day.logoutAt),
    net: day.logoutAt ? formatMinutes(day.minutes) : "-",
    mode: workModeLabel(day.workMode) || "-",
    status: day.status,
    minutes: day.minutes,
  }));
}

/** The days somebody actually turned up, which is what the activity tiles count. */
const attendedDays = (days) => (days || []).filter((day) => day.loginAt);

function fieldsForColumns(columns) {
  return columns.map((column) => [column.accessorKey, column.header, column.accessorKey === "status" ? "status" : undefined, 190, 130]);
}

/*
 * A status here is drawn by `TableCellValue`, the same as a status in every other module's table.
 *
 * This used to override the status cell with a coloured pill of its own, which made attendance the
 * one screen in the app where a status did not look like a status - the shared cell is a coloured
 * dot beside the label, and `statusStyles` below is already the per-module colour map it expects.
 * The override was all that stood between the two, so removing it is the whole change.
 */
function attendanceColumns(fields, rows, renderActions) {
  return buildTableColumns({ fields, statusStyles: attendanceStatusStyles, renderActions })
    .filter((column) => column.id !== "serial");
}

function attendanceVisibility(fields, includeActions = false) {
  const visibility = defaultVisibilityFor(fields);
  delete visibility.serial;
  if (!includeActions) delete visibility.actions;
  return visibility;
}

/** Turns whatever the API threw into the one sentence worth showing. */
const errorMessage = (error, fallback) => error?.data?.message || error?.message || fallback;

/** Yesterday as `YYYY-MM-DD`, for the one banner that gets to say "yesterday" rather than a date. */
const yesterdayIso = () => {
  const date = new Date();
  date.setDate(date.getDate() - 1);
  return isoDate(date);
};

/** `2026-09-11` as "Thu 11 Sep", which is how a person refers to a day last week. */
const formatDayLabel = (iso) => {
  const parsed = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return iso;
  return new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short" }).format(parsed);
};

/**
 * The sentence for a capture the geofence refused.
 *
 * A 422 carrying `OUTSIDE_LOCATION` is not a bad request — the submission was perfectly well formed
 * and the server understood it; what failed is a rule about where the person was standing. It reads
 * differently on screen for that reason, and it names the distance, because "you are 1.4km away" is
 * the one fact that makes the refusal make sense.
 */
const outsideLocationMessage = (error) => {
  const payload = error?.data || error || {};
  if (payload.code !== "OUTSIDE_LOCATION") return "";
  const away = Number.isFinite(Number(payload.distanceMeters)) ? ` You are about ${formatDistance(payload.distanceMeters)} from your branch office.` : "";
  return `Outside the allowed attendance location.${away} Raise an on-duty request if you are working away today.`;
};

/** Metres under a kilometre, kilometres to one decimal above it. */
const formatDistance = (metres) => {
  const value = Number(metres);
  if (!Number.isFinite(value)) return "";
  return value < 1000 ? `${Math.round(value)} m` : `${(value / 1000).toFixed(1)} km`;
};

function RangePicker({ open, value, range, customRange, onSelect, onCustomChange, onClose }) {
  if (!open) return null;
  return <div className="absolute right-0 top-[calc(100%+0.5rem)] z-50 max-h-[calc(100dvh-9rem)] w-[min(42rem,calc(100vw-1.5rem))] overflow-y-auto rounded-lg border border-slate-200 bg-white text-left shadow-2xl max-sm:right-1/2 max-sm:translate-x-1/2">
    <div className="grid sm:grid-cols-[13rem_minmax(0,1fr)]">
      <div className="border-b border-slate-200 p-3 sm:border-b-0 sm:border-r sm:p-4">
        <p className="mb-3 text-sm font-semibold text-slate-950">Date range</p>
        <div className="space-y-1">
          {rangeOptions.map((option) => <button key={option} type="button" onClick={() => onSelect(option)} className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm font-medium ${value === option ? "bg-blue-50 text-blue-700" : "text-slate-700 hover:bg-slate-50"}`}>
            <span className={`h-4 w-4 rounded-full border ${value === option ? "border-blue-600 bg-blue-600" : "border-slate-300"}`} />
            {option}
          </button>)}
        </div>
      </div>
      <div className="p-4">
        <p className="text-sm font-semibold text-slate-950">{rangeLabel(value, range)}</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <DateField label="Start date" value={value === "Custom" ? customRange.start : isoDate(range.start)} onChange={(next) => onCustomChange({ ...customRange, start: next })} />
          <DateField label="End date" value={value === "Custom" ? customRange.end : isoDate(range.end)} onChange={(next) => onCustomChange({ ...customRange, end: next })} />
        </div>
        <div className="mt-16 flex justify-end max-sm:mt-5">
          <Button type="button" variant="primary" size="lg" onClick={onClose} className="font-semibold">Update</Button>
        </div>
      </div>
    </div>
  </div>;
}

/**
 * The CSV takes its header from the same field list the table draws from, so a renamed column
 * cannot leave the download saying something else. It used to carry "Day, In, Out, Mode" long
 * after the table had been relabelled.
 */
function downloadAttendanceCsv(rows, label) {
  const escape = (value) => `"${String(value ?? "").replaceAll("\"", "\"\"")}"`;
  const csv = [
    loginSummaryFields.map(([, header]) => escape(header)).join(","),
    ...rows.map((row) => loginSummaryFields.map(([key]) => escape(row[key])).join(",")),
  ].join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `attendance-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

/** The policy text, written from the rules in force rather than from numbers typed into the copy. */
function policyLines(settings) {
  if (!settings) return ["Attendance rules are still loading."];
  const cutoff = addMinutesToClock(settings.shiftStart, settings.lateGraceMinutes);
  const offDays = (settings.weeklyOffDays || []).map((day) => weekdayOptions[day]?.label).filter(Boolean);
  return [
    `The shift runs ${settings.shiftStart} to ${settings.shiftEnd}. A login up to ${cutoff} counts as on time; after that the day is marked Late unless an approved permission covers the arrival.`,
    `A full working day is ${formatTotalMinutes(settings.dailyTargetMinutes)}. A range's target is that for every working day it contains, with weekly offs and holidays taken out.`,
    offDays.length ? `Weekly off: ${offDays.join(", ")}.` : "There is no weekly off configured.",
    `A permission cannot run longer than ${formatTotalMinutes(settings.maxPermissionMinutes)}. Beyond that, apply for leave.`,
    "Selfie, timestamp and location are captured for every work mode. The timestamp is the server's, not the device's.",
    "Leave and permission are decided by any one of the approvers named on your employee record. Every decision is kept in the request's history.",
  ];
}

/** "09:30" plus a number of minutes, as "09:45". Used only for the policy copy. */
function addMinutesToClock(clock, minutes) {
  const [hours, mins] = String(clock || "00:00").split(":").map(Number);
  const total = (hours * 60 + mins + (Number(minutes) || 0) + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function PolicyDialog({ settings, onClose }) {
  return <Dialog title="Attendance policy" size="lg" onClose={onClose} footer={<Button type="button" variant="primary" size="lg" onClick={onClose} className="font-semibold">Close</Button>}>
    <div className="space-y-4 pb-2 text-sm leading-6 text-slate-700">
      {policyLines(settings).map((line) => <p key={line}>{line}</p>)}
    </div>
  </Dialog>;
}

function LocationEnableDialog({ message, onClose, onRetry }) {
  return <Dialog
    title="Enable location"
    onClose={onClose}
    footer={<>
      <Button type="button" size="lg" onClick={onClose} className="font-semibold">Close</Button>
      <Button type="button" variant="primary" size="lg" onClick={onRetry} className="font-semibold">Try again</Button>
    </>}
  >
    <div className="space-y-3 pb-2 text-sm leading-6 text-slate-700">
      <p>{message || "Location is required for office and client-site login."}</p>
      <p>Please turn on Location Services on your mobile, computer, or laptop, then allow location access for this browser/site.</p>
    </div>
  </Dialog>;
}

/**
 * Whether there is a face in the frame, and whether anything was actually able to look.
 *
 * The browser's own `FaceDetector` is the only real detector available here, and most browsers do
 * not ship it. What stood in for it was a skin-tone-and-edge heuristic that accepted a photograph of
 * a wall in warm light and rejected a real face in a dim room — a check that is wrong in both
 * directions is worse than none, because it is believed. So where nothing can look, nothing claims
 * to have looked: the selfie is captured, stored with `faceVerified` false, and left for HR to see
 * against the timestamp and location beside it.
 */
async function detectFace(canvas) {
  if (!("FaceDetector" in window)) return { supported: false, verified: false };
  try {
    const detector = new window.FaceDetector({ fastMode: true, maxDetectedFaces: 1 });
    const faces = await detector.detect(canvas);
    return { supported: true, verified: faces.length > 0 };
  } catch {
    // The browser exposes the constructor but refuses to run it, which is the same as not having it.
    return { supported: false, verified: false };
  }
}

function CameraSelfieField({ disabled = false, value, onChange }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [error, setError] = useState("");
  const [capturing, setCapturing] = useState(false);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!cameraOpen) return undefined;
    setError("");
    setStarting(true);
    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: "user" } })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
        setStarting(false);
      })
      .catch(() => {
        if (!cancelled) {
          setStarting(false);
          setError("No camera available, or permission was refused.");
        }
      });
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      setStarting(false);
    };
  }, [cameraOpen]);

  function openCamera() {
    if (disabled) return;
    setError("");
    setStarting(true);
    setCameraOpen(true);
  }

  async function capture() {
    const video = videoRef.current;
    if (!video?.videoWidth) return;
    setCapturing(true);
    setError("");
    try {
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext("2d").drawImage(video, 0, 0);
      const face = await detectFace(canvas);
      // Only a detector that actually ran may refuse the shot. Where none could, the capture goes
      // through unverified rather than being blocked by a guess.
      if (face.supported && !face.verified) {
        setError("Face not detected. Please align your face inside the oval.");
        return;
      }
      const blob = await new Promise((resolve, reject) => {
        canvas.toBlob((result) => (result ? resolve(result) : reject(new Error("Unable to capture selfie."))), "image/jpeg", 0.9);
      });
      const compressed = await compressImageFile(new File([blob], `daily-login-selfie-${Date.now()}.jpg`, { type: "image/jpeg" }), { maxBytes: 36 * 1024, maxDimension: 480 });
      onChange({ dataUrl: compressed.dataUrl, faceVerified: face.verified });
      setCameraOpen(false);
    } catch {
      setError("Unable to capture selfie. Please try again.");
    } finally {
      setCapturing(false);
    }
  }

  return <div className="flex h-full flex-col items-center justify-center p-4 text-center sm:p-5">
    {cameraOpen && <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-950/50 p-3 sm:p-6" onMouseDown={(event) => { if (event.target === event.currentTarget) setCameraOpen(false); }}>
      <section role="dialog" aria-modal="true" aria-label="Login selfie" className="flex max-h-[calc(100dvh-2rem)] w-full max-w-4xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
        <header className="flex items-center justify-between border-b border-slate-200 px-4 py-4 sm:px-6">
          <h2 className="text-xl font-semibold text-slate-950">Login selfie</h2>
          <IconButton size="sm" ariaLabel="Close camera" onClick={() => setCameraOpen(false)} className="text-slate-500">
            <CloseRoundedIcon sx={{ fontSize: 22 }} />
          </IconButton>
        </header>
        <div className="space-y-4 overflow-y-auto p-4 sm:p-6">
          <div className="relative overflow-hidden rounded-lg bg-slate-900 bg-[repeating-linear-gradient(135deg,#111827_0,#111827_16px,#172238_16px,#172238_32px)]">
          {error ? (
            <p className="flex min-h-72 items-center justify-center p-6 text-center text-sm font-medium text-white">{error}</p>
          ) : (
            <>
              <video ref={videoRef} autoPlay playsInline muted className="max-h-[58dvh] min-h-72 w-full object-contain" />
              {starting && <div className="absolute inset-0 grid place-items-center bg-slate-950/35 text-sm font-semibold text-white">Opening camera...</div>}
              <span aria-hidden="true" className="pointer-events-none absolute left-1/2 top-[47%] h-[72%] w-[38%] -translate-x-1/2 -translate-y-1/2 rounded-[48%_48%_44%_44%/38%_38%_56%_56%] border-2 border-dashed border-white/55 max-sm:w-[58%]" />
              <span className="absolute bottom-5 left-5 font-mono text-xs lowercase tracking-wide text-white/75 sm:text-sm">live camera feed · align face in oval</span>
            </>
          )}
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
            <Button type="button" size="none" onClick={() => setCameraOpen(false)} className="min-h-12 px-6 py-2 text-base font-semibold text-slate-900 sm:order-1">
              Cancel
            </Button>
            <Button type="button" variant="primary" size="none" onClick={capture} disabled={Boolean(error) || capturing} className="min-h-12 px-7 py-2 text-base font-semibold disabled:opacity-60 sm:order-2">
              {capturing ? "Capturing..." : "Capture selfie"}
            </Button>
          </div>
        </div>
      </section>
    </div>}
    <div className="relative">
      {value ? (
        <Image src={value} alt="Captured login selfie" width={160} height={160} unoptimized className="h-40 w-40 rounded-full border border-slate-200 object-cover" />
      ) : (
        <div className="flex h-40 w-40 items-center justify-center rounded-full border border-slate-200 bg-[repeating-linear-gradient(135deg,#eef3fb_0,#eef3fb_10px,#e7edf7_10px,#e7edf7_20px)] text-center font-mono text-xs font-normal lowercase text-slate-500">
          no photo yet
        </div>
      )}
      <IconButton size="md" shape="circle" variant="primary" onClick={openCamera} ariaLabel="Open camera" disabled={disabled} className="absolute bottom-1 right-1">
        <CameraAltRoundedIcon sx={{ fontSize: 20 }} />
      </IconButton>
    </div>
    <p className="mt-4 text-sm font-semibold text-slate-950">Login selfie <span aria-hidden="true" className="text-rose-500">*</span></p>
    <p className="mt-1 text-xs text-slate-500">{value ? "Captured for today" : "Required before login"}</p>
    <button type="button" onClick={openCamera} disabled={disabled} className="mt-4 min-h-10 rounded-md border border-blue-600 bg-white px-5 py-2 text-sm font-semibold text-blue-600 hover:bg-blue-50 disabled:cursor-not-allowed disabled:border-slate-300 disabled:text-slate-400 disabled:hover:bg-white">
      {value ? "Retake selfie" : "Open camera"}
    </button>
    {error && !cameraOpen && <p className="mt-2 text-xs font-medium text-red-600">{error}</p>}
  </div>;
}

/**
 * Raising a leave, permission or on-duty request.
 *
 * The two checks here are the ones the browser-only version never had: a To date earlier than the
 * From date was quietly recorded as a one-day leave, and a To time earlier than the From time
 * showed a duration of "-" and was raised anyway. The server refuses both as well — this is the
 * sentence in front of the refusal, not the protection.
 */
/** Approving or rejecting somebody else's request. A rejection has to say why; an approval need not. */
function DecisionDialog({ decision, request, busy, onClose, onConfirm }) {
  const [remarks, setRemarks] = useState("");
  const isReject = decision === "reject";
  const canSubmit = (!isReject || remarks.trim().length > 0) && !busy;
  return <Dialog
    title={isReject ? "Reject request" : "Approve request"}
    description={`${request.requestType} for ${request.employeeName} — ${request.period}`}
    onClose={onClose}
    busy={busy}
    onSubmit={(event) => { event.preventDefault(); if (canSubmit) onConfirm(remarks.trim()); }}
    footer={<>
      <Button type="button" size="lg" onClick={onClose} className="font-semibold">Cancel</Button>
      <Button type="submit" variant={isReject ? "danger" : "primary"} size="lg" disabled={!canSubmit} className="font-semibold disabled:bg-slate-300">
        {busy ? "Saving..." : isReject ? "Reject" : "Approve"}
      </Button>
    </>}
  >
    <div className="space-y-3 pb-2">
      <p className="text-sm text-slate-700">{request.reason}</p>
      <TextAreaField
        label={isReject ? "Reason for rejection" : "Remarks"}
        required={isReject}
        rows={3}
        value={remarks}
        onChange={(event) => setRemarks(event.target.value)}
        placeholder={isReject ? "Say why this is being rejected" : "Optional"}
      />
    </div>
  </Dialog>;
}

/**
 * The Login Summary table and its totals.
 *
 * Both come from the server for the chosen range: the rows include days nobody logged in — a
 * holiday, a weekly off, approved leave, or an absence with no explanation — and the target is a
 * full day's hours for every working day the range actually contains, rather than the fixed 42h30
 * and 170h that used to be assumed whatever month it was.
 */
/** `hideTotals` is for the Self Dashboard, which shows the same strip above this section and
  * would otherwise print every figure twice on one screen. The Login tab passes nothing and
  * keeps them, because nothing else there states them. */
function AttendanceSummarySection({ joiningDate, refreshToken, onError, hideTotals = false }) {
  const rangePickerRef = useRef(null);
  const [rangeOption, setRangeOption] = useState("This week");
  const [customRange, setCustomRange] = useState(() => ({ start: isoDate(new Date()), end: isoDate(new Date()) }));
  const [rangeOpen, setRangeOpen] = useState(false);
  const [summary, setSummary] = useState(null);
  const selectedRange = rangeForOption(rangeOption, customRange, joiningDate);
  const from = isoDate(selectedRange.start);
  const to = isoDate(selectedRange.end);
  // The range the loaded summary is *for*, so "still loading" is derived from what is held rather
  // than tracked in a second state that an effect would have to set synchronously to stay honest.
  const rangeKey = `${from}|${to}|${refreshToken}`;
  const loading = summary?.key !== rangeKey;
  const attendanceRows = rowsFromDays(summary?.days);
  const summaryColumns = attendanceColumns(loginSummaryFields, attendanceRows);
  /*
   * The tick boxes, for a role holding `ADMIN / Table Select All`. Export only, no `prefix`: a row
   * here is one day of somebody's attendance as it was marked, and a marked day is corrected
   * through Attendance Approval rather than deleted - the module offers no delete for one.
   */
  const bulkAttendance = useTableSelection({ rows: attendanceRows, rowId: (row) => row.key, noun: "day" });

  useEffect(() => {
    let cancelled = false;
    getAttendanceSummary({ from, to })
      .then((response) => {
        if (!cancelled) setSummary({ key: rangeKey, ...(response?.data || {}) });
      })
      .catch((error) => {
        if (cancelled) return;
        // Still stamped with the range, so the table settles on "no records" rather than spinning.
        setSummary({ key: rangeKey });
        const message = errorMessage(error, "Unable to load your attendance summary.");
        // A login with no employee behind it has no summary to show, and the panel above already
        // says so. Repeating it here would be the same sentence toasted twice on every load.
        if (error?.status === 400 && /not linked to an employee record/i.test(message)) return;
        onError?.(message);
      });
    return () => { cancelled = true; };
  }, [from, to, rangeKey, onError]);

  /*
   * Escape closes the range picker - through the shared arbiter, not a listener of its own.
   *
   * A `keydown` on `document` here hears every Escape in the application, including one meant for
   * the dialog this picker may be sitting inside: both would close on a single press. `useEscapeKey`
   * keeps a stack and gives the key to whatever opened last, so one press closes one thing.
   */
  useEscapeKey(() => setRangeOpen(false), rangeOpen);

  useEffect(() => {
    if (!rangeOpen) return undefined;
    // Clicking away is still this component's own: it is about where the pointer landed relative to
    // this picker, which nothing shared can answer for it.
    const close = (event) => {
      if (!rangePickerRef.current?.contains(event.target)) setRangeOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [rangeOpen]);

  return <div className="space-y-3">
    {!hideTotals && <AttendanceTotals totals={summary?.totals} />}
    <AttendanceCalendar days={summary?.days} from={from} to={to} loading={loading} />

    <section className="relative rounded-lg border border-slate-200 bg-white shadow-sm">
    <div className="flex flex-col gap-3 border-b border-slate-100 px-3 py-2 sm:px-4 xl:flex-row xl:items-center">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-sm font-medium text-slate-700">Login Summary</h2>
        <div className="flex rounded-lg border border-slate-200 bg-slate-50 p-1">
          {[["This week", "This week"], ["This month", "Month"]].map(([option, label]) => <button
            key={option}
            type="button"
            onClick={() => setRangeOption(option)}
            className={`rounded-md px-3 py-1.5 text-sm font-semibold ${rangeOption === option ? "bg-white text-blue-700 shadow-sm" : "text-slate-600 hover:text-slate-900"}`}
          >
            {label}
          </button>)}
        </div>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center xl:ml-auto">
        <span className="text-xs font-medium text-slate-500 sm:mr-1">
          Total Work Hours: {formatTotalMinutes(summary?.totals?.workedMinutes)} of {formatTotalMinutes(summary?.totals?.targetMinutes)}
        </span>
        <div ref={rangePickerRef} className="relative">
          <button type="button" onClick={() => setRangeOpen((current) => !current)} className="inline-flex min-h-9 w-full min-w-0 items-center gap-2 rounded-md border border-slate-200 px-3 text-left text-sm font-semibold text-slate-700 hover:bg-slate-50 sm:w-[26rem]">
            <CalendarMonthOutlinedIcon sx={{ fontSize: 18 }} />
            <span className="min-w-0 truncate">{rangeLabel(rangeOption, selectedRange)}</span>
          </button>
          <RangePicker
            open={rangeOpen}
            value={rangeOption}
            range={selectedRange}
            customRange={customRange}
            onSelect={setRangeOption}
            onCustomChange={(next) => { setCustomRange(next); setRangeOption("Custom"); }}
            onClose={() => setRangeOpen(false)}
          />
        </div>
        <IconButton size="sm" onClick={() => downloadAttendanceCsv(attendanceRows, rangeOption)} ariaLabel="Download attendance" className="border border-slate-200 text-slate-600">
          <FileDownloadOutlinedIcon sx={{ fontSize: 20 }} />
        </IconButton>
      </div>
    </div>
    <DataTable
      columns={summaryColumns}
      data={attendanceRows}
      loading={loading}
      emptyMessage="No attendance records found for this range."
      noMatchMessage="No matching attendance records found."
      ariaLabel="Login summary table"
      getRowId={(row) => row.key}
      defaultColumnVisibility={loginSummaryVisibility}
      tableClassName="min-w-full"
      features={{ filtering: true, sorting: true, columnVisibility: true, selection: bulkAttendance.selection }}
    />
    </section>
  </div>;
}

/**
 * The figures for the range, read as a strip rather than as a paragraph.
 *
 * Working days is the denominator the rest are read against — six absences in a nineteen-day month
 * and six in a four-day week are different facts — and the module could not state it before: the
 * screen had the days but not the count of what the range actually owed, weekends and holidays
 * removed.
 */
function AttendanceTotals({ totals }) {
  if (!totals) return null;
  const tiles = [
    ["Working days", totals.workingDays, "text-slate-950"],
    /*
     * The one figure that reads a long range at a glance: days attended, leave counted as attended
     * because it was agreed, over the days the range owed. Blank rather than 0% where nothing was
     * owed — a range containing only a weekend did not have a bad attendance rate.
     */
    ["Attended", totals.attendanceRate == null ? "—" : `${totals.attendanceRate}%`, "text-slate-950"],
    ["Present", totals.present, "text-emerald-700"],
    ["On time", totals.onTime, "text-emerald-700"],
    ["Late", totals.late, "text-amber-700"],
    ["Half day", totals.halfDay, "text-amber-700"],
    ["Early exit", totals.earlyExit, "text-amber-700"],
    ["Absent", totals.absent, "text-red-700"],
    ["On leave", totals.onLeave, "text-blue-700"],
  ];
  return <DashboardCard
    title="How the range went"
    note={`Worked ${formatTotalMinutes(totals.workedMinutes)} of ${formatTotalMinutes(totals.targetMinutes)}`}
  >
    {/* Eight small figures rather than eight cards: they are one set read across, and giving each
        its own bordered box would make eight objects out of one row. */}
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-9">
      {tiles.map(([label, value, tone]) => <div key={label} className="rounded-md border border-slate-100 bg-slate-50 px-3 py-2">
        <p className="text-[11px] font-medium text-slate-500">{label}</p>
        <p className={`mt-0.5 text-xl font-semibold tabular-nums ${tone}`}>{value ?? 0}</p>
      </div>)}
    </div>
  </DashboardCard>;
}

/**
 * The range as a calendar, one cell per day.
 *
 * The table below says the same thing and says it precisely; this says it at a glance. Reading a
 * month as rows means counting to find out whether the absences cluster around a weekend or fall on
 * the same weekday every time, and a grid answers that without anybody counting.
 *
 * Drawn from the same day rows the table reads, so the two can never disagree — no status is worked
 * out here. Cells before the first of the range and after the last are blanks rather than being
 * filled with days nobody asked for.
 */
function AttendanceCalendar({ days, from, to, loading }) {
  if (loading || !days?.length) return null;

  const byDate = new Map(days.map((day) => [day.date, day]));
  const first = new Date(`${from}T00:00:00`);
  const last = new Date(`${to}T00:00:00`);
  if (Number.isNaN(first.getTime()) || Number.isNaN(last.getTime())) return null;

  // A calendar starts on a Sunday, so the first row is padded back to one. The range itself is not
  // widened: those leading cells are blank, not days.
  const cells = [];
  for (let pad = 0; pad < first.getDay(); pad += 1) cells.push(null);
  for (let cursor = new Date(first); cursor <= last; cursor.setDate(cursor.getDate() + 1)) {
    cells.push(isoDate(cursor));
  }

  return <DashboardCard title="Calendar" note="Every day in the range, as the register reads it">
    <div className="grid grid-cols-7 gap-1 sm:gap-2">
      {["S", "M", "T", "W", "T", "F", "S"].map((label, index) => <div key={`${label}-${index}`} className="pb-1 text-center text-[11px] font-semibold uppercase tracking-wider text-slate-400">
        {label}
      </div>)}

      {cells.map((iso, index) => {
        if (!iso) return <div key={`pad-${index}`} aria-hidden="true" />;
        const day = byDate.get(iso);
        const dot = attendanceStatusStyles[day?.status] || "bg-slate-300";
        return <div
          key={iso}
          // The status is in the text as well as the dot: a colour alone is not a label, and this
          // grid is read by people deciding whether to query a day.
          title={day ? `${iso} — ${day.status}` : iso}
          className="min-h-16 rounded-md border border-slate-200 p-1.5 sm:p-2"
        >
          <div className="flex items-start justify-between gap-1">
            <span className="text-xs font-semibold tabular-nums text-slate-700">{Number(iso.slice(8, 10))}</span>
            <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${dot}`} aria-hidden="true" />
          </div>
          {day && <p className="mt-0.5 truncate text-[10px] font-medium leading-tight text-slate-500">{day.status}</p>}
        </div>;
      })}
    </div>
  </DashboardCard>;
}

/**
 * The Self Dashboard's own panels: how the month is going, where it was worked, and how much of it
 * was finished properly.
 *
 * Built on the shared `DashboardCard` shell so this reads as the same kind of page as Image
 * Selection's dashboard — the same border, header, padding and type scale — rather than as a second
 * house style inside one application.
 *
 * The four status counts that used to sit here (On time, Late, On leave, Absent) are gone from this
 * component: `AttendanceTotals` below owns them and shows eight rather than four, so keeping them
 * here printed the same figures twice on one screen. What is left is what only this panel says.
 */
function ActivityInsights({ totals, days, loading, figuresOnly = false }) {
  const attended = attendedDays(days);
  // The day rows are the source where there are any; where there are not, the server counted them.
  const totalSessions = figuresOnly ? (totals?.present || 0) : attended.length;
  const completed = totals?.completed || 0;
  const byMode = (mode) => attended.filter((day) => day.workMode === mode).length;
  const modes = [
    ["Office", byMode("office"), "bg-blue-600"],
    ["Work from home", byMode("work-from-home"), "bg-emerald-600"],
    ["Field work", byMode("client-site"), "bg-amber-500"],
  ];
  const completionPercent = totalSessions ? Math.round((completed / totalSessions) * 100) : 0;

  return <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
    <DashboardCard title="My month so far" note="Days you marked, and the hours they came to">
      <CardState loading={loading} empty={!loading && !totalSessions} emptyMessage="Nothing marked this month yet." rows={3}>
        <div className="grid gap-2 sm:grid-cols-3">
          {[
            ["Days marked", totalSessions],
            ["Finished properly", completed],
            ["Hours worked", formatTotalMinutes(totals?.workedMinutes)],
          ].map(([label, value]) => <div key={label} className="rounded-md border border-slate-100 bg-slate-50 px-3 py-2.5">
            <p className="text-[11px] font-medium text-slate-500">{label}</p>
            <p className="mt-1 text-xl font-semibold tabular-nums text-slate-800">{value}</p>
          </div>)}
        </div>

        {/* Where a day was worked is read off the day rows, which a figures-only range does not
            send — so the section is absent rather than showing three empty tracks. */}
        {!figuresOnly && <div className="mt-4 space-y-2.5">
          <p className="text-[11px] font-medium text-slate-500">Where you worked</p>
          {modes.map(([label, count, tone]) => <div key={label}>
            <div className="mb-1 flex items-center justify-between text-[11px] text-slate-600">
              <span>{label}</span><span className="tabular-nums">{count}</span>
            </div>
            {/* Width from the real share, floored at a sliver so a mode used once is still visible
                as a mark rather than as an empty track that reads like a rendering fault. */}
            <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
              <div className={`h-full rounded-full ${tone}`} style={{ width: `${totalSessions && count ? Math.max(4, (count / totalSessions) * 100) : 0}%` }} />
            </div>
          </div>)}
        </div>}
      </CardState>
    </DashboardCard>

    <DashboardCard title="Days finished properly" note="Marked in, and marked out again">
      <CardState loading={loading} empty={!loading && !totalSessions} emptyMessage="Nothing marked this month yet." rows={3}>
        <div className="flex items-center gap-4">
          <div
            className="grid h-24 w-24 shrink-0 place-items-center rounded-full"
            style={{ background: `conic-gradient(#2563eb ${completionPercent * 3.6}deg, #e2e8f0 0deg)` }}
            role="img"
            aria-label={`${completionPercent}% of marked days were checked out`}
          >
            <div className="grid h-[4.5rem] w-[4.5rem] place-items-center rounded-full bg-white text-lg font-semibold tabular-nums text-slate-800">{completionPercent}%</div>
          </div>
          <div className="min-w-0 space-y-1.5 text-xs text-slate-600">
            <p><span className="font-semibold tabular-nums text-slate-800">{completed}</span> of {totalSessions} days were checked out.</p>
            {totalSessions > completed && <p className="text-amber-700">
              {totalSessions - completed} left open. A past day still open needs a correction.
            </p>}
          </div>
        </div>
      </CardState>
    </DashboardCard>
  </div>;
}

/**
 * Self Dashboard.
 *
 * Laid out as the Image Selection dashboard is, and on the same parts: the tinted `dashboard-canvas`
 * ground, the shared `DashboardCard` shell, one caption line saying what the page is showing, then
 * the cards. Two dashboards in one application should not be two house styles.
 *
 * The month is this panel's own scope and is fixed — the first of the month to today — while the
 * Login Summary below carries its own range picker for the table and calendar. They are two
 * different questions ("how is this month going" and "show me these days"), so the picker stays
 * with the one it changes rather than being lifted to the top and appearing to govern both.
 */
function SelfDashboardPanel({ joiningDate, refreshToken, onError }) {
  const [range, setRange] = useState("This month");
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);

  const selected = rangeForOption(range, { start: "", end: "" }, joiningDate);
  const from = isoDate(selected.start);
  const to = isoDate(selected.end);
  /*
   * Which reading this range gets.
   *
   * Past a quarter a day row per date is neither readable nor worth transferring, so the dashboard
   * asks for figures alone — which is also the only way a range longer than two years can be
   * answered at all. Decided from the length rather than from the option's name, so a Custom range
   * of eighteen months behaves like a year rather than like a month.
   */
  const spanDays = Math.round((selected.end - selected.start) / 86400000);
  const figuresOnly = spanDays > TOTALS_ONLY_ABOVE_DAYS;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getAttendanceSummary({ from, to, totals: figuresOnly })
      .then((response) => {
        if (!cancelled) setSummary(response?.data || null);
      })
      .catch((error) => {
        if (!cancelled) onError?.(errorMessage(error, "Unable to load your attendance dashboard."));
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [from, to, figuresOnly, refreshToken, onError]);

  const totals = summary?.totals;
  const caption = [
    `${rangeLabel(range, selected)}`,
    totals ? `${totals.workingDays ?? 0} working days` : null,
    totals ? `${formatTotalMinutes(totals.workedMinutes)} of ${formatTotalMinutes(totals.targetMinutes)} worked` : null,
    totals?.attendanceRate != null ? `${totals.attendanceRate}% attended` : null,
  ].filter(Boolean).join(" · ");

  return <div className="dashboard-canvas min-h-0 flex-1 overflow-y-auto px-3 py-3 sm:px-4">
    {/* The caption says what is being shown and the picker changes it, on one line, the way the
        Image Selection dashboard reads. On a phone the two stack and the picker keeps the right. */}
    <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
      <p className="order-2 min-w-0 text-[11px] text-slate-500 sm:order-1">{caption}</p>
      <div className="order-1 w-40 shrink-0 self-end sm:order-2 sm:self-auto">
        <Dropdown
          ariaLabel="Date range"
          mode="input"
          sorted={false}
          options={dashboardRangeOptions.map((option) => ({ value: option, label: option }))}
          value={range}
          onChange={setRange}
        />
      </div>
    </div>

    <AttendanceTotals totals={totals} />
    <div className="mt-3">
      <ActivityInsights totals={totals} days={summary?.days} loading={loading} figuresOnly={figuresOnly} />
    </div>

    {/*
      * The day table and the calendar are for a range somebody can actually read day by day. Past a
      * quarter they are replaced by a line saying so, rather than by 365 rows nobody scrolls — and
      * for Lifetime the server never sent the days in the first place.
      */}
    {figuresOnly
      ? <div className="mt-3 rounded-lg border border-slate-200 bg-white px-4 py-3 text-xs text-slate-500 shadow-sm">
        Showing figures only for a range this long. Choose <span className="font-medium text-slate-700">This month</span> or
        shorter to see the calendar and the day-by-day list.
      </div>
      : <div className="mt-3">
        <AttendanceSummarySection joiningDate={joiningDate} refreshToken={refreshToken} onError={onError} hideTotals />
      </div>}
  </div>;
}

function DailyLoginPanel({ settings, joiningDate, onRequestRaised, onNotice, onError }) {
  // What the success card shows after a check-in. Held rather than derived, because it is a moment
  // being acknowledged - the card should not reappear on the next poll of today's attendance.
  const [checkedIn, setCheckedIn] = useState(null);
  const [selfie, setSelfie] = useState("");
  const [faceVerified, setFaceVerified] = useState(false);
  const [location, setLocation] = useState(null);
  const [locationStatus, setLocationStatus] = useState("idle");
  const [locationError, setLocationError] = useState("");
  const [locationDialogOpen, setLocationDialogOpen] = useState(false);
  const [workMode, setWorkMode] = useState("office");
  const [policyOpen, setPolicyOpen] = useState(false);
  const [quickAction, setQuickAction] = useState("");
  /** The open past day a correction is being raised for, or null. */
  const [correction, setCorrection] = useState(null);
  const [today, setToday] = useState(null);
  /** Why this login cannot mark attendance at all, when that is the reason. */
  const [unlinked, setUnlinked] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);

  const session = today?.session || null;
  const needsAttention = today?.needsAttention || [];
  const loggedIn = Boolean(session && !session.logoutAt);
  const dayComplete = Boolean(session?.logoutAt);
  const ready = Boolean(selfie && location);

  const loadToday = useCallback(() => {
    setLoading(true);
    return getTodayAttendance()
      .then((response) => { setUnlinked(""); setToday(response?.data || null); })
      .catch((error) => {
        /*
         * A login with no employee behind it is not a failure to load the day - it is the answer,
         * and it is the same answer on every reload. It is shown as the panel's content rather
         * than raised as a toast over a marking form that can never be submitted: a person who
         * cannot mark attendance needs to be told why and who fixes it, not handed a camera and an
         * error a second later. Every other error is still transient and still a toast.
         */
        const message = errorMessage(error, "Unable to load today's attendance.");
        if (error?.status === 400 && /not linked to an employee record/i.test(message)) {
          setUnlinked(message);
          setToday(null);
          return;
        }
        setUnlinked("");
        onError?.(message);
      })
      .finally(() => setLoading(false));
  }, [onError]);

  useEffect(() => { loadToday(); }, [loadToday]);

  function captureLocation() {
    setLocationError("");
    if (!navigator.geolocation) {
      setLocationStatus("error");
      setLocationError("Location is not available on this device.");
      setLocationDialogOpen(true);
      return;
    }
    setLocationStatus("loading");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocationStatus("ready");
        setLocation({ latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy: position.coords.accuracy });
      },
      (error) => {
        setLocationStatus("error");
        setLocationError(error.message || "Location permission was denied.");
        setLocationDialogOpen(true);
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 },
    );
  }

  async function saveLogin() {
    if (!ready || busy) return;
    setBusy(true);
    try {
      // No timestamp is sent: the server stamps the login with its own clock, because a clock the
      // person being judged can set is not evidence of when they arrived.
      const response = await markAttendanceLogin({
        workMode,
        selfie,
        faceVerified,
        latitude: location.latitude,
        longitude: location.longitude,
        accuracy: location.accuracy,
      });
      setCheckedIn({ loginAt: response?.data?.loginAt, quote: response?.data?.quote || "", location: response?.data?.location || null });
      setSelfie("");
      setFaceVerified(false);
      setLocation(null);
      setLocationStatus("idle");
      await loadToday();
      setRefreshToken((token) => token + 1);
      onNotice?.("Login recorded.");
    } catch (error) {
      onError?.(outsideLocationMessage(error) || errorMessage(error, "Unable to mark your login."));
    } finally {
      setBusy(false);
    }
  }

  /**
   * Marks the logout, with the same evidence the login carried.
   *
   * The selfie is whatever was captured for the checkout, and the position is captured fresh here
   * rather than reusing the login's - the point of a checkout location is that it is a second
   * reading. Both stay best effort at the end of the day: a denied camera or a denied location must
   * not trap somebody in an open session, which the server would then show as "Not logged out"
   * forever. What they cost is a verified location, not the ability to finish the day.
   */
  async function logout() {
    if (busy) return;
    setBusy(true);
    const position = location || await new Promise((resolve) => {
      if (!navigator.geolocation) return resolve(null);
      navigator.geolocation.getCurrentPosition(
        (result) => resolve({ latitude: result.coords.latitude, longitude: result.coords.longitude, accuracy: result.coords.accuracy }),
        () => resolve(null),
        { enableHighAccuracy: true, maximumAge: 0, timeout: 8000 },
      );
    });
    try {
      await markAttendanceLogout({
        ...(selfie ? { selfie, faceVerified } : {}),
        ...(position ? { latitude: position.latitude, longitude: position.longitude, accuracy: position.accuracy } : {}),
      });
      setSelfie("");
      setFaceVerified(false);
      setLocation(null);
      setLocationStatus("idle");
      await loadToday();
      setRefreshToken((token) => token + 1);
      onNotice?.("Logout recorded.");
    } catch (error) {
      onError?.(outsideLocationMessage(error) || errorMessage(error, "Unable to mark your logout."));
    } finally {
      setBusy(false);
    }
  }

  async function submitQuickAction(payload) {
    setBusy(true);
    try {
      await createAttendanceRequest(payload);
      setQuickAction("");
      onRequestRaised?.();
      onNotice?.("Request raised. Your approvers can now see it.");
    } catch (error) {
      onError?.(errorMessage(error, "Unable to raise this request."));
    } finally {
      setBusy(false);
    }
  }

  const statusChip = dayComplete ? { label: "Day complete", tone: "bg-slate-100 text-slate-700", dot: "bg-slate-500" }
    : loggedIn ? { label: "Logged in", tone: "bg-emerald-50 text-emerald-700", dot: "bg-emerald-600" }
      : { label: "Not logged in", tone: "bg-amber-50 text-amber-700", dot: "bg-amber-700" };

  /*
   * Nothing on this screen is this login's to use, so none of it is drawn.
   *
   * Attendance is an employee's record: a login with no employee behind it - the shared `admin`
   * account is the usual one - has nobody for a day, a leave or a permission to be about. Drawing
   * the camera, the work modes and the quick actions anyway meant every one of them failed on
   * submit, which read as the screen being broken rather than as the login being the wrong one.
   */
  if (unlinked) {
    return <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50 p-3 sm:p-4 lg:p-5">
      <section className="w-full overflow-hidden rounded-lg border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-4 py-4 sm:px-5">
          <h2 className="text-base font-semibold text-slate-950">Attendance is not available for this login</h2>
        </div>
        <div className="space-y-3 px-4 py-4 text-sm text-slate-600 sm:px-5">
          <p>{unlinked}</p>
          <p className="text-slate-500">
            Attendance is kept against an employee record, so a login has to be linked to one before it can
            mark a day or raise a leave. An administrator links it from Administration → Users: the ⋮ menu on
            the account, then Link employee.
          </p>
        </div>
      </section>
    </div>;
  }

  return <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50 p-3 sm:p-4 lg:p-5">
    <div className="w-full space-y-4">
      {/*
        * Days checked into and never checked out of. The module deliberately does not guess when
        * somebody left — it says so and offers the ask, rather than inventing a time nobody chose.
        */}
      {needsAttention.map((day) => <section key={day.date} className="rounded-lg border border-amber-300 bg-amber-50 p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-amber-900">
              {day.date === yesterdayIso() ? "Yesterday's attendance needs attention." : `Attendance for ${formatDayLabel(day.date)} needs attention.`}
            </p>
            <p className="mt-1 text-xs text-amber-800">
              You logged in at {formatTimestamp(day.loginAt)} and never logged out, so the day is still open.
            </p>
          </div>
          <Button type="button" variant="primary" className="shrink-0" onClick={() => setCorrection(day)}>
            Request correction
          </Button>
        </div>
      </section>)}

      <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-4 sm:px-5">
          <h2 className="text-base font-semibold text-slate-950">Daily login</h2>
          <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold ${statusChip.tone}`}>
            <span className={`h-2 w-2 rounded-full ${statusChip.dot}`} />
            {loading ? "Loading..." : statusChip.label}
          </span>
        </div>
        <div className="p-4 sm:p-5">
          <div className="grid overflow-hidden rounded-lg border border-slate-200 lg:grid-cols-[20rem_minmax(0,1fr)]">
            <div className="border-b border-slate-200 bg-slate-50 lg:border-b-0 lg:border-r">
              {/*
                * Live again once the day is open, because the checkout is its own capture rather
                * than a bare button. It shows the login selfie while nothing new has been taken,
                * and that picture comes from the guarded endpoint — never a link into storage.
                */}
              <CameraSelfieField
                disabled={dayComplete || busy}
                value={selfie || (session ? attendanceSelfieUrl(session.loginSelfieEventId) || session.selfieUrl : "")}
                onChange={({ dataUrl, faceVerified: verified }) => { setSelfie(dataUrl); setFaceVerified(verified); captureLocation(); }}
              />
            </div>
            <div className="flex min-h-72 flex-col">
              <div className="flex gap-4 px-4 py-4 sm:px-5">
                <div className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
                  <AccessTimeOutlinedIcon sx={{ fontSize: 24 }} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Timestamp</p>
                    {session && <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">Recorded by the server</span>}
                  </div>
                  <p className="mt-1 text-sm font-semibold text-slate-950 sm:text-base">{formatTimestamp(session?.loginAt)}</p>
                  {session?.logoutAt && <p className="mt-1 text-xs font-medium text-slate-500">Logged out {formatTimestamp(session.logoutAt)}</p>}
                  {session && !session.faceVerified && <p className="mt-1 text-xs font-medium text-amber-700">This browser could not verify a face in the selfie. HR will review it.</p>}
                </div>
              </div>
              <div className="flex gap-4 px-4 py-4 sm:px-5">
                <div className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
                  <LocationOnOutlinedIcon sx={{ fontSize: 24 }} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Location</p>
                    <div className="flex items-center gap-3">
                      {(session?.location || location) && <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">Location captured</span>}
                      {!dayComplete && <button type="button" onClick={captureLocation} className="text-xs font-semibold text-blue-600 hover:text-blue-700">Refresh</button>}
                    </div>
                  </div>
                  <p className="mt-1 text-sm font-semibold text-slate-950 sm:text-base">
                    {locationStatus === "loading" ? "Capturing..." : locationLabel(session?.location || location, session?.loginAddress)}
                  </p>
                  {locationStatus !== "loading" && <p className="mt-1 text-xs font-medium text-slate-500">
                    {locationDetail({
                      location: session?.location || location,
                      distanceMeters: session?.loginDistanceMeters,
                      officeName: today?.geofence?.office?.name,
                      verified: session ? session.loginLocationVerified : undefined,
                    })}
                  </p>}
                  {/*
                    * Kept even when an address is shown. The coordinates are what the distance was
                    * actually measured from, and somebody querying a day needs the number rather
                    * than a street name a geocoder chose.
                    */}
                  {session?.loginAddress && (session?.location || location) && <p className="mt-0.5 text-xs tabular-nums text-slate-400">
                    {(session?.location || location).latitude.toFixed(6)}, {(session?.location || location).longitude.toFixed(6)}
                  </p>}
                  {locationError && !session && <p className="mt-1 text-xs font-medium text-red-600">{locationError}</p>}
                </div>
              </div>
              <div className="px-4 pb-4 sm:px-5">
                <p className="text-sm font-semibold text-slate-950">Work mode</p>
                <div className="mt-3 grid max-w-2xl gap-4 sm:grid-cols-3">
                  {workModes.map((mode) => {
                    const active = (session?.workMode || workMode) === mode.id;
                    return <button
                      key={mode.id}
                      type="button"
                      disabled={Boolean(session) || busy}
                      onClick={() => setWorkMode(mode.id)}
                      className={`min-h-10 rounded-md border px-3 py-2 text-left text-sm font-semibold transition disabled:cursor-not-allowed ${active ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-200 bg-white text-slate-900 hover:border-blue-300"} ${session && !active ? "opacity-60" : ""}`}
                    >
                      {mode.title}
                    </button>;
                  })}
                </div>
              </div>
              <div className="mt-auto flex flex-col gap-3 border-t border-slate-200 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                <p className="text-sm text-slate-500">
                  {dayComplete ? "Today's attendance is complete." : loggedIn ? "" : ready ? "" : "Capture a selfie and location to enable Login"}
                </p>
                <button
                  type="button"
                  disabled={busy || loading || dayComplete || (!loggedIn && !ready)}
                  onClick={loggedIn ? logout : saveLogin}
                  className={`min-h-11 rounded-md px-6 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300 sm:min-w-32 ${loggedIn ? "bg-slate-900 hover:bg-slate-800" : "bg-blue-600 hover:bg-blue-700"}`}
                >
                  {busy ? "Saving..." : loggedIn ? "Logout" : "Login"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      <AttendanceSummarySection joiningDate={joiningDate} refreshToken={refreshToken} onError={onError} />

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-lg border border-slate-200 bg-white p-4 sm:p-5">
          <h2 className="text-sm font-semibold text-slate-950">Quick actions</h2>
          <div className="mt-4 space-y-2">
            {[
              ["Apply for leave", "LEAVE"],
              ["Request Permission", "PERMISSION"],
              ["Mark on-duty / travel", "ON_DUTY"],
              // For a day marked from outside the branch's radius: the ask that turns a flagged
              // capture into one an approver has actually looked at.
              ["Request outside attendance", "OUTSIDE_LOCATION"],
            ].map(([label, action]) => <button key={label} type="button" onClick={() => setQuickAction(action)} className="flex min-h-11 w-full items-center justify-between rounded-lg border border-slate-200 bg-white px-4 text-left text-sm font-semibold text-slate-950 hover:bg-slate-50">
              <span>{label}</span>
            </button>)}
          </div>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-4 sm:p-5">
          <h2 className="text-sm font-semibold text-slate-950">Attendance policy</h2>
          <div className="mt-3 space-y-3 text-sm leading-6 text-slate-700">
            {policyLines(settings).slice(0, 3).map((line) => <p key={line}>{line}</p>)}
            <button type="button" onClick={() => setPolicyOpen(true)} className="mt-3 font-semibold text-blue-600 hover:text-blue-700">Read full policy</button>
          </div>
        </section>
      </div>
    </div>
    {policyOpen && <PolicyDialog settings={settings} onClose={() => setPolicyOpen(false)} />}
    {locationDialogOpen && <LocationEnableDialog message={locationError} onClose={() => setLocationDialogOpen(false)} onRetry={() => { setLocationDialogOpen(false); captureLocation(); }} />}
    {quickAction && <AttendanceRequestDialog action={quickAction} settings={settings} busy={busy} onClose={() => setQuickAction("")} onSubmit={submitQuickAction} />}

    {checkedIn && <CheckedInDialog
      checkedIn={checkedIn}
      employeeName={today?.employee?.name || ""}
      onClose={() => setCheckedIn(null)}
    />}

    {correction && <CorrectionDialog
      day={correction}
      busy={busy}
      onClose={() => setCorrection(null)}
      onSubmit={async (payload) => {
        await submitQuickAction(payload);
        setCorrection(null);
        await loadToday();
      }}
    />}
  </div>;
}

/**
 * The working-day rules, for whoever holds HRM / Attendance Approval.
 *
 * Without this the settings row could only be changed through the API, and the numbers that decide
 * whether everybody in the studio was late would be as unreachable as the hardcoded ones they
 * replaced.
 */
function AttendanceRulesPanel({ settings, onSaved, onNotice, onError }) {
  const [form, setForm] = useState(() => ({ ...settings }));
  const [busy, setBusy] = useState(false);

  useEffect(() => { setForm({ ...settings }); }, [settings]);

  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const shiftProblem = form.shiftEnd <= form.shiftStart ? "The shift end must be later than the shift start." : "";
  /*
   * The band, checked here as well as on the server so the refusal arrives while somebody is still
   * looking at the field. A day at least this long and at most that long is half a day; below the
   * first is too short to credit and reads as an absence, above the second is a full day.
   */
  const halfDayProblem = Number(form.halfDayMinMinutes) > 0 && Number(form.halfDayMaxMinutes) < Number(form.halfDayMinMinutes)
    ? "The longest half day cannot be shorter than the shortest one."
    : "";

  async function save() {
    if (shiftProblem || halfDayProblem || busy) return;
    setBusy(true);
    try {
      await saveAttendanceSettings({
        shiftStart: form.shiftStart,
        shiftEnd: form.shiftEnd,
        lateGraceMinutes: Number(form.lateGraceMinutes),
        dailyTargetMinutes: Number(form.dailyTargetMinutes),
        weeklyOffDays: form.weeklyOffDays || [],
        maxPermissionMinutes: Number(form.maxPermissionMinutes),
        halfDayMinMinutes: Number(form.halfDayMinMinutes),
        halfDayMaxMinutes: Number(form.halfDayMaxMinutes),
        /*
         * The radius, the GPS accuracy ceiling and the enforcement flag are deliberately absent.
         *
         * They are no longer on this form, so this save has no business claiming a value for them.
         * The server's settings schema treats them as optional, so leaving them out keeps whatever
         * is stored rather than overwriting it — which is what a form that does not show a field
         * should do. Office locations below still record where each branch is, and the geofence
         * goes on measuring against the stored radius.
         */
        earlyExitGraceMinutes: Number(form.earlyExitGraceMinutes),
      });
      await onSaved?.();
      onNotice?.("Attendance rules saved.");
    } catch (error) {
      onError?.(errorMessage(error, "Unable to save the attendance rules."));
    } finally {
      setBusy(false);
    }
  }

  return <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50 p-3 sm:p-4 lg:p-5">
    <div className="w-full space-y-4">
      <section className="rounded-lg border border-slate-200 bg-white p-4 sm:p-5">
        <h2 className="text-base font-semibold text-slate-950">Working day</h2>
        <p className="mt-1 text-xs text-slate-500">Every attendance status and every hours target in this module is decided by these numbers.</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <TimeField label="Shift start" required value={form.shiftStart || ""} onChange={(event) => update("shiftStart", event.target.value)} />
          <TimeField label="Shift end" required value={form.shiftEnd || ""} onChange={(event) => update("shiftEnd", event.target.value)} />
          <TextField label="Late grace (minutes)" type="number" min={0} max={240} value={form.lateGraceMinutes ?? ""} onChange={(event) => update("lateGraceMinutes", event.target.value)} />
          <TextField label="Full day (minutes)" type="number" min={30} max={1440} value={form.dailyTargetMinutes ?? ""} onChange={(event) => update("dailyTargetMinutes", event.target.value)} />
          <TextField label="Longest permission (minutes)" type="number" min={15} max={720} value={form.maxPermissionMinutes ?? ""} onChange={(event) => update("maxPermissionMinutes", event.target.value)} />
          <TextField label="Half day from (minutes)" type="number" min={0} max={1440} value={form.halfDayMinMinutes ?? ""} onChange={(event) => update("halfDayMinMinutes", event.target.value)} />
          <TextField label="Half day up to (minutes)" type="number" min={0} max={1440} value={form.halfDayMaxMinutes ?? ""} onChange={(event) => update("halfDayMaxMinutes", event.target.value)} error={halfDayProblem} />
          <TextField label="Early exit grace (minutes)" type="number" min={0} max={240} value={form.earlyExitGraceMinutes ?? ""} onChange={(event) => update("earlyExitGraceMinutes", event.target.value)} />
        </div>
        <div className="mt-4">
          <CheckboxGroupField
            label="Weekly off"
            options={weekdayOptions}
            value={form.weeklyOffDays || []}
            onChange={(next) => update("weeklyOffDays", next)}
          />
        </div>
        {shiftProblem && <p role="alert" className="mt-3 rounded-md bg-red-50 px-3 py-2 text-xs font-medium text-red-700">{shiftProblem}</p>}
        <div className="mt-4 flex justify-end">
          <Button type="button" variant="primary" size="lg" onClick={save} disabled={busy || Boolean(shiftProblem) || Boolean(halfDayProblem)} className="font-semibold">
            {busy ? "Saving..." : "Save rules"}
          </Button>
        </div>
      </section>


      <OfficeLocationsSection busy={busy} onNotice={onNotice} onError={onError} />

      <QuotesSection busy={busy} onNotice={onNotice} onError={onError} />

      {/*
        The holiday calendar is not here any more.
        
        It was a date-and-name list on this screen, which put a *company-declared* holiday among
        the rules that judge one person's day. It is neither an attendance decision nor HR's: the
        studio deciding it is closed on the 20th is a studio setting, so it is declared on a
        calendar in Settings → Holidays, behind ADMIN / System Settings, and shows for everybody on
        the topbar Calendar. What a holiday *does* here is unchanged — a declared day is still
        taken out of every hours target and still reads as Holiday rather than as an absence.
      */}
    </div>
  </div>;
}

/**
 * "2 of 3 approved" — or the one pending name where a single person is holding it up.
 *
 * A permission has one approver, so the count is noise and the name is the useful thing. A leave has
 * up to three, where the count is what somebody actually wants.
 */
function approvalSummary(request) {
  const total = request.approvalsTotal || 0;
  if (!total) return "-";
  const approved = request.approvalsApproved || 0;
  const waiting = (request.approvers || []).filter((row) => row.decision === "PENDING").map((row) => row.approverName).filter(Boolean);

  if (total === 1) {
    // One approver: their name says more than "0 of 1".
    const only = request.approvers?.[0];
    if (!only) return `${approved} of 1`;
    return only.decision === "PENDING" ? `Waiting on ${only.approverName || "their approver"}` : `${only.decision === "APPROVED" ? "Approved" : "Rejected"} by ${only.approverName || "their approver"}`;
  }
  const counted = `${approved} of ${total} approved`;
  // Named only while somebody can still act on it, and only when it is down to one person — a list
  // of three names in a table cell is not read.
  return waiting.length === 1 ? `${counted} · waiting on ${waiting[0]}` : counted;
}

/** One request as the leave and permission tables show it. */
function requestRow(request, section) {
  const shared = {
    id: request.id,
    raw: request,
    employeeName: request.employeeName || "-",
    employeeId: request.employeeCode || "-",
    reason: request.reason || "-",
    status: request.displayStatus,
    appliedOn: dateDisplay(request.createdAt),
    approvedBy: request.decidedByName || "-",
    remarks: request.decisionRemarks || "-",
    /*
     * How far through its approvers the request is.
     *
     * A leave goes to everybody named on the record and needs all of them, so "Pending" alone does
     * not say whether it is waiting on three people or on one — which is the difference between
     * nobody having looked and one person holding it up.
     *
     * The approver names are absent on a rejected request the *requester* is reading: the server
     * withholds them, because a refusal is the studio's answer rather than one named person's. The
     * count still arrives, so this reads "Rejected · 2 of 3 had approved" without saying who said no.
     */
    approvals: approvalSummary(request),
  };
  if (section === SECTION_PERMISSION) {
    return {
      ...shared,
      date: dateDisplay(request.fromDate),
      fromTime: request.fromTime || "-",
      toTime: request.toTime || "-",
      duration: request.durationLabel || "-",
    };
  }
  if (section === SECTION_APPROVALS) {
    const period = request.type === "PERMISSION"
      ? `${dateDisplay(request.fromDate)} ${request.fromTime}-${request.toTime}`
      : request.fromDate === request.toDate ? dateDisplay(request.fromDate) : `${dateDisplay(request.fromDate)} - ${dateDisplay(request.toDate)}`;
    return {
      ...shared,
      requestType: requestTypeLabels[request.type] || request.type,
      period,
      duration: request.type === "PERMISSION" ? request.durationLabel || "-" : request.days == null ? "-" : `${request.days} day${request.days === 1 ? "" : "s"}`,
    };
  }
  return {
    ...shared,
    leaveType: requestTypeLabels[request.type] || request.type,
    fromDate: dateDisplay(request.fromDate),
    toDate: dateDisplay(request.toDate),
    // Null means the stored dates do not describe a span. The old screen clamped that to 1 and
    // showed a backwards leave as a single day.
    days: request.days == null ? "-" : request.days,
  };
}

export default function EmployeeAttendancePage() {
  const [section, setSection] = useState(SECTION_LOGIN);
  const [statusBySection, setStatusBySection] = useState({});
  const [settings, setSettings] = useState(null);
  const [joiningDate, setJoiningDate] = useState("");
  const [ownRequests, setOwnRequests] = useState([]);
  const [teamRequests, setTeamRequests] = useState([]);
  const [loadingRequests, setLoadingRequests] = useState(true);
  const [decision, setDecision] = useState(null);
  const [reapply, setReapply] = useState(null);
  const [busy, setBusy] = useState(false);
  const { notice, showNotice, showError, clearNotice } = useNotice();

  const onError = useCallback((message) => showError(message), [showError]);
  const onNotice = useCallback((message) => showNotice(message, "success"), [showNotice]);

  const activeStatus = statusBySection[section] || "All";
  const setActiveStatus = (status) => setStatusBySection((current) => ({ ...current, [section]: status }));
  const isRequestSection = Boolean(tableConfig[section]);

  const loadSettings = useCallback(() => getAttendanceSettings()
    .then((response) => setSettings(response?.data || null))
    .catch((error) => onError(errorMessage(error, "Unable to load the attendance settings."))), [onError]);

  const loadRequests = useCallback(() => {
    setLoadingRequests(true);
    return Promise.all([getAttendanceRequests({ scope: "own" }), getAttendanceRequests({ scope: "team" })])
      .then(([own, team]) => {
        setOwnRequests(own?.data || []);
        setTeamRequests(team?.data || []);
      })
      .catch((error) => onError(errorMessage(error, "Unable to load the attendance requests.")))
      .finally(() => setLoadingRequests(false));
  }, [onError]);

  useEffect(() => {
    loadSettings();
    loadRequests();
    let cancelled = false;
    // Only for the "Maximum" range option, which starts at the day this person joined. A profile
    // that will not load is not worth an error here — the range simply falls back to its own cap.
    getMyProfile()
      .then((response) => { if (!cancelled) setJoiningDate(response?.data?.employment?.dateOfJoining || ""); })
      .catch(() => { if (!cancelled) setJoiningDate(""); });
    return () => { cancelled = true; };
  }, [loadSettings, loadRequests]);

  const sections = settings?.canManage ? [...baseSections, { label: "Rules", value: SECTION_RULES }] : baseSections;

  const sourceRequests = section === SECTION_APPROVALS
    ? teamRequests
    : ownRequests.filter((request) => (requestSectionTypes[section] || []).includes(request.type));
  const filteredRequests = sourceRequests.filter((request) => activeStatus === "All" || request.displayStatus === activeStatus);
  const tableRows = isRequestSection ? filteredRequests.map((request) => requestRow(request, section)) : [];
  /*
   * The same, for the requests table beside it. Export only: a request is withdrawn or decided, and
   * either way it stays on the register as the record of what was asked.
   */
  const bulkRequests = useTableSelection({ rows: tableRows, rowId: (row) => String(row.id), noun: "request" });
  const tableFields = isRequestSection ? fieldsForColumns(tableConfig[section].columns) : [];

  async function act(work, fallback) {
    if (busy) return;
    setBusy(true);
    try {
      const message = await work();
      await loadRequests();
      if (message) onNotice(message);
    } catch (error) {
      onError(errorMessage(error, fallback));
    } finally {
      setBusy(false);
      setDecision(null);
    }
  }

  function renderRequestActions(row) {
    const request = row.raw;
    const items = [];
    if (section === SECTION_APPROVALS) {
      if (request.canDecide && request.status === "PENDING") {
        items.push({ label: "Approve", onSelect: () => setDecision({ decision: "approve", request: row }) });
        items.push({ label: "Reject", tone: "danger", onSelect: () => setDecision({ decision: "reject", request: row }) });
      }
    } else {
      if (request.status === "PENDING") {
        items.push({ label: "Withdraw", tone: "danger", onSelect: () => act(() => withdrawAttendanceRequest(request.id).then(() => "Request withdrawn."), "Unable to withdraw this request.") });
      }
      // Only an approved request that has not started can be given back. One already under way is a
      // correction for HR, not a status the employee can repaint — which is all the old screen did.
      if (request.displayStatus === "Upcoming") {
        items.push({
          label: request.type === "PERMISSION" ? "Cancel Permission" : "Cancel Leave",
          tone: "danger",
          onSelect: () => act(() => cancelAttendanceRequest(request.id).then(() => "Request cancelled."), "Unable to cancel this request."),
        });
      }
      // "Apply again" raises a *new* request pointing back at the refused one, so the rejection and
      // the second attempt both survive instead of one status being overwritten.
      if (request.status === "REJECTED") {
        items.push({ label: "Apply again", onSelect: () => setReapply(request) });
      }
    }
    if (!items.length) return null;
    return <OptionsMenu ariaLabel={`Actions for ${row.employeeName || "request"}`} items={items} />;
  }

  const tableColumns = attendanceColumns(tableFields, tableRows, isRequestSection ? renderRequestActions : undefined);
  const tableVisibility = attendanceVisibility(tableFields, isRequestSection);
  const requestTabs = isRequestSection
    ? statusTabs.map((tab) => ({ id: tab, label: tab, count: sourceRequests.filter((request) => tab === "All" || request.displayStatus === tab).length }))
    : null;

  return <section className="flex h-full min-h-0 w-full min-w-0 flex-col">
    <ModulePageHeader
      title="Employee Attendance"
      titleAccessory={<div className="min-w-0 border-l border-slate-200 pl-3">
        <DropdownMenu ariaLabel="Employee attendance section" items={sections} value={section} onChange={setSection} sorted={false} />
      </div>}
      tabs={requestTabs}
      tabValue={activeStatus}
      onTabChange={setActiveStatus}
      tabsAriaLabel={`${sections.find((item) => item.value === section)?.label || "Attendance"} filters`}
      actions={null}
    />
    {section === SECTION_LOGIN ? <DailyLoginPanel
      settings={settings}
      joiningDate={joiningDate}
      onRequestRaised={loadRequests}
      onNotice={onNotice}
      onError={onError}
    /> : section === SECTION_SELF ? <SelfDashboardPanel
      joiningDate={joiningDate}
      refreshToken={0}
      onError={onError}
    /> : section === SECTION_RULES && settings ? <AttendanceRulesPanel
      settings={settings}
      onSaved={loadSettings}
      onNotice={onNotice}
      onError={onError}
    /> : isRequestSection ? <div className="flex min-h-0 flex-1 bg-white">
      <DataTableShell className="min-h-0 flex-1 rounded-none border-0">
        <DataTable
          columns={tableColumns}
          data={tableRows}
          loading={loadingRequests}
          emptyMessage={tableConfig[section].emptyMessage}
          noMatchMessage={tableConfig[section].noMatchMessage}
          ariaLabel={tableConfig[section].ariaLabel}
          getRowId={(row) => String(row.id)}
          defaultColumnVisibility={tableVisibility}
          tableClassName="min-w-full"
          features={{ filtering: true, sorting: true, columnVisibility: true, csvExport: { enabled: true, fileName: `employee-attendance-${section}` }, selection: bulkRequests.selection }}
        />
      </DataTableShell>
    </div> : <div className="min-h-0 flex-1 bg-slate-50" />}
    {decision && <DecisionDialog
      decision={decision.decision}
      request={decision.request}
      busy={busy}
      onClose={() => setDecision(null)}
      onConfirm={(remarks) => act(
        () => (decision.decision === "approve" ? approveAttendanceRequest(decision.request.id, remarks) : rejectAttendanceRequest(decision.request.id, remarks))
          .then(() => (decision.decision === "approve" ? "Request approved." : "Request rejected.")),
        "Unable to record this decision.",
      )}
    />}
    {reapply && <AttendanceRequestDialog
      action={reapply.type}
      settings={settings}
      busy={busy}
      prefill={{ fromDate: reapply.fromDate, toDate: reapply.toDate, fromTime: reapply.fromTime, toTime: reapply.toTime, reason: reapply.reason, supersedesId: reapply.id }}
      onClose={() => setReapply(null)}
      onSubmit={(payload) => act(
        () => createAttendanceRequest(payload).then(() => { setReapply(null); return "Request raised again."; }),
        "Unable to raise this request.",
      )}
    />}
    <FloatingNotice notice={notice} onClose={clearNotice} />
  </section>;
}


/**
 * Where each branch's office is.
 *
 * This is what turns the coordinates the module has always recorded into a verdict about whether
 * somebody was at work: without a row here a branch has no geofence, and every capture from it is
 * recorded unverified. Kept out of the settings form above because it is a list that grows with the
 * studio rather than a handful of numbers, and because one branch's office moving should not make
 * anybody re-save the shift.
 *
 * Coordinates are typed rather than picked off a map: a map picker is a dependency and a licence
 * key, and the number wanted here is the one a phone standing at the door already reports. **Use
 * this device's location** fills both fields from exactly that.
 */
function OfficeLocationsSection({ busy, onNotice, onError }) {
  const [locations, setLocations] = useState([]);
  const [branches, setBranches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [locating, setLocating] = useState(false);
  const [form, setForm] = useState({ branchId: "", name: "", latitude: "", longitude: "", allowedRadiusMeters: "" });
  // The branch register announces its own changes, and this picker re-reads when it does: a branch
  // added or renamed in Settings while this tab is open would otherwise be missing from the list
  // somebody is trying to record an office for.
  const branchRegistryRevision = useBranchRegistry();

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([getAttendanceOfficeLocations(), getMasterData("branches").catch(() => null)])
      .then(([officeResponse, branchResponse]) => {
        setLocations(officeResponse?.data?.locations || []);
        setBranches(branchResponse?.data || []);
      })
      .catch((error) => onError?.(errorMessage(error, "Unable to load the office locations.")))
      .finally(() => setLoading(false));
  }, [onError]);

  useEffect(() => { load(); }, [load, branchRegistryRevision]);

  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const editing = locations.find((office) => String(office.branchId) === String(form.branchId));
  const ready = form.branchId && form.name.trim() && form.latitude !== "" && form.longitude !== "";

  function useThisDevice() {
    if (!navigator.geolocation) {
      onError?.("Location is not available on this device.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocating(false);
        // Six decimals is about a tenth of a metre, which is far finer than the reading itself.
        update("latitude", position.coords.latitude.toFixed(6));
        update("longitude", position.coords.longitude.toFixed(6));
      },
      (error) => { setLocating(false); onError?.(error.message || "Location permission was denied."); },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 },
    );
  }

  async function save() {
    if (!ready || saving) return;
    setSaving(true);
    try {
      await saveAttendanceOfficeLocation({
        branchId: Number(form.branchId),
        name: form.name.trim(),
        latitude: Number(form.latitude),
        longitude: Number(form.longitude),
        // Blank means "use the studio default", which is a real choice rather than a missing value.
        allowedRadiusMeters: form.allowedRadiusMeters === "" ? null : Number(form.allowedRadiusMeters),
      });
      setForm({ branchId: "", name: "", latitude: "", longitude: "", allowedRadiusMeters: "" });
      load();
      onNotice?.(editing ? "Office location updated." : "Office location saved.");
    } catch (error) {
      onError?.(errorMessage(error, "Unable to save this office location."));
    } finally {
      setSaving(false);
    }
  }

  async function remove(branchId) {
    setSaving(true);
    try {
      await removeAttendanceOfficeLocation(branchId);
      load();
      onNotice?.("Office location removed. That branch now has no attendance radius.");
    } catch (error) {
      onError?.(errorMessage(error, "Unable to remove this office location."));
    } finally {
      setSaving(false);
    }
  }

  const branchOptions = branches.map((branch) => ({ value: String(branch.id), label: branchLabel(branch.name) || branch.name }));

  return <section className="rounded-lg border border-slate-200 bg-white p-4 sm:p-5">
    <h2 className="text-base font-semibold text-slate-950">Office locations</h2>
    <p className="mt-1 text-xs text-slate-500">
      The point each branch&rsquo;s attendance is measured from. A branch with no office here is not checked at all,
      and its people are recorded as unverified rather than refused.
    </p>

    <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <Dropdown
        searchable
        label="Branch"
        placeholder="Select a branch"
        options={branchOptions}
        value={form.branchId}
        onChange={(value) => {
          update("branchId", value);
          const existing = locations.find((office) => String(office.branchId) === String(value));
          if (!existing) return;
          setForm({
            branchId: value,
            name: existing.name,
            latitude: String(existing.latitude),
            longitude: String(existing.longitude),
            allowedRadiusMeters: existing.allowedRadiusMeters == null ? "" : String(existing.allowedRadiusMeters),
          });
        }}
      />
      <TextField label="Office name" required value={form.name} onChange={(event) => update("name", event.target.value)} placeholder="Coimbatore Studio" />
      <TextField label="Radius (metres)" type="number" min={10} max={50000} value={form.allowedRadiusMeters} onChange={(event) => update("allowedRadiusMeters", event.target.value)} placeholder="Studio default" />
      <TextField label="Latitude" required value={form.latitude} onChange={(event) => update("latitude", event.target.value)} placeholder="11.016800" />
      <TextField label="Longitude" required value={form.longitude} onChange={(event) => update("longitude", event.target.value)} placeholder="76.955800" />
      <div className="flex items-end">
        <Button type="button" onClick={useThisDevice} disabled={locating || saving} className="w-full">
          {locating ? "Locating..." : "Use this device's location"}
        </Button>
      </div>
    </div>

    <div className="mt-4 flex justify-end">
      <Button type="button" variant="primary" size="lg" onClick={save} disabled={!ready || saving || busy} className="font-semibold">
        {saving ? "Saving..." : editing ? "Update office" : "Add office"}
      </Button>
    </div>

    <div className="mt-5 space-y-2">
      {loading ? <p className="text-sm text-slate-500">Loading office locations...</p>
        : !locations.length ? <p className="rounded-md bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">No office is recorded for any branch yet, so no attendance location is being checked.</p>
          : locations.map((office) => <div key={office.branchId} className="flex flex-col gap-2 rounded-md border border-slate-200 px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-950">{office.name}</p>
              <p className="mt-0.5 text-xs text-slate-500">
                {branchLabel(office.branchName) || `Branch ${office.branchId}`}
                {" · "}{Number(office.latitude).toFixed(5)}, {Number(office.longitude).toFixed(5)}
                {" · "}{office.allowedRadiusMeters ? `${office.allowedRadiusMeters} m` : "studio default"}
                {!office.isActive && " · switched off"}
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button type="button" onClick={() => setForm({
                branchId: String(office.branchId),
                name: office.name,
                latitude: String(office.latitude),
                longitude: String(office.longitude),
                allowedRadiusMeters: office.allowedRadiusMeters == null ? "" : String(office.allowedRadiusMeters),
              })}>Edit</Button>
              <Button type="button" variant="danger" onClick={() => remove(office.branchId)} disabled={saving}>Remove</Button>
            </div>
          </div>)}
    </div>
  </section>;
}


/**
 * Asking for a day that was never checked out of to be closed.
 *
 * Its own dialog rather than a fourth case in `QuickActionDialog`, which is built around a range of
 * dates and a permission's two times. This is one fixed day, one proposed time and a reason — and
 * the day is not editable, because it is the day the banner was about.
 *
 * The time is a proposal, not a correction anybody can make themselves. It reaches an approver as
 * an ordinary request and is written onto the day only when one agrees, which is why this is a
 * request form rather than a time field on the attendance row.
 */
function CorrectionDialog({ day, busy, onClose, onSubmit }) {
  const [toTime, setToTime] = useState("");
  const [reason, setReason] = useState("");

  const loginTime = day.loginAt ? new Date(day.loginAt) : null;
  const loginClock = loginTime && !Number.isNaN(loginTime.getTime())
    ? `${String(loginTime.getHours()).padStart(2, "0")}:${String(loginTime.getMinutes()).padStart(2, "0")}`
    : "";
  // Checked here as well as on the server, so the refusal arrives while somebody is still looking at
  // the field rather than after they press the button.
  const problem = !toTime ? "" : loginClock && toTime <= loginClock ? "The checkout has to be later than the login it closes." : "";
  const canSubmit = Boolean(toTime && reason.trim() && !problem && !busy);

  return <Dialog
    title="Request correction"
    description={`${formatDayLabel(day.date)} was never checked out. Tell your approver what time you actually finished.`}
    size="md"
    busy={busy}
    onClose={onClose}
    footer={<>
      <Button type="button" onClick={onClose}>Cancel</Button>
      <Button
        type="button"
        variant="primary"
        disabled={!canSubmit}
        onClick={() => onSubmit({ type: "CORRECTION", fromDate: day.date, toDate: day.date, toTime, reason: reason.trim() })}
      >
        {busy ? "Sending..." : "Send request"}
      </Button>
    </>}
  >
    <div className="flex flex-col gap-4">
      <p className="text-sm text-slate-600">
        Logged in at <span className="font-medium text-slate-900">{formatTimestamp(day.loginAt)}</span>.
        Nothing is changed until an approver agrees.
      </p>
      <TimeField label="Time you finished" required value={toTime} onChange={(event) => setToTime(event.target.value)} error={problem} />
      <TextAreaField label="Reason" required rows={3} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Left straight from the shoot and could not log out." />
    </div>
  </Dialog>;
}


/**
 * The moment after a check-in is recorded.
 *
 * Acknowledgement, not information: everything on it is already on the card behind it. It exists
 * because marking attendance is a small daily obligation, and a screen that simply refreshes in
 * silence gives no sign that it worked — which is how people end up pressing the button twice.
 *
 * The line at the bottom comes from the server, chosen from the ones written for that weekday and
 * fixed for the day, so the studio reads the same one and it does not shuffle on reload. There is
 * no line when nobody has written one for that weekday, and the card simply omits it.
 */
function CheckedInDialog({ checkedIn, employeeName, onClose }) {
  const outside = checkedIn.location && checkedIn.location.verified === false;

  return <Dialog
    title="You're checked in"
    size="sm"
    onClose={onClose}
    footer={<Button type="button" variant="primary" onClick={onClose}>Done</Button>}
  >
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-2xl font-semibold text-emerald-700" aria-hidden="true">&#10003;</span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-950">{employeeName || "Attendance recorded"}</p>
          <p className="mt-0.5 text-sm text-slate-600">Checked in at {formatTimestamp(checkedIn.loginAt)}</p>
        </div>
      </div>

      {/*
        * Said here rather than left to the register, because an unverified capture is something the
        * person can still do something about this morning — and nothing else will tell them.
        */}
      {outside && <p className="rounded-md bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
        Your location could not be confirmed
        {Number.isFinite(Number(checkedIn.location.distanceMeters)) ? ` — you are about ${formatDistance(checkedIn.location.distanceMeters)} from your branch office` : ""}.
        The day is recorded and HR will see it flagged.
      </p>}

      {checkedIn.quote && <figure className="m-0 rounded-md border-l-2 border-blue-500 bg-slate-50 px-4 py-3">
        <blockquote className="m-0 text-sm italic text-slate-700">{checkedIn.quote}</blockquote>
      </figure>}

      <p className="text-xs text-slate-500">Have a good day. Remember to check out before you leave.</p>
    </div>
  </Dialog>;
}


/**
 * The lines shown after a check-in.
 *
 * Several per weekday, because one Monday sentence stops being read by the second week. Which one
 * shows is worked out from the date on the server, so the whole studio sees the same line on the
 * same day and it does not change on reload — nobody picks today's, and there is nothing here to
 * schedule.
 */
function QuotesSection({ busy, onNotice, onError }) {
  const [quotes, setQuotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState({ dayOfWeek: "1", quote: "" });

  const load = useCallback(() => {
    setLoading(true);
    getAttendanceQuotes()
      .then((response) => setQuotes(response?.data?.quotes || []))
      .catch((error) => onError?.(errorMessage(error, "Unable to load the attendance quotes.")))
      .finally(() => setLoading(false));
  }, [onError]);

  useEffect(() => { load(); }, [load]);

  async function add() {
    if (!draft.quote.trim() || saving) return;
    setSaving(true);
    try {
      await addAttendanceQuote({ dayOfWeek: Number(draft.dayOfWeek), quote: draft.quote.trim() });
      setDraft({ dayOfWeek: draft.dayOfWeek, quote: "" });
      load();
      onNotice?.("Quote added.");
    } catch (error) {
      onError?.(errorMessage(error, "Unable to add this quote."));
    } finally {
      setSaving(false);
    }
  }

  async function remove(id) {
    setSaving(true);
    try {
      await removeAttendanceQuote(id);
      load();
      onNotice?.("Quote removed.");
    } catch (error) {
      onError?.(errorMessage(error, "Unable to remove this quote."));
    } finally {
      setSaving(false);
    }
  }

  return <section className="rounded-lg border border-slate-200 bg-white p-4 sm:p-5">
    <h2 className="text-base font-semibold text-slate-950">Daily quotes</h2>
    <p className="mt-1 text-xs text-slate-500">
      Shown once, after somebody checks in. Keep a few for each weekday: the one that appears is worked out
      from the date, so everyone sees the same line and it does not change when the page is reloaded.
    </p>

    <div className="mt-4 grid gap-4 sm:grid-cols-[12rem_minmax(0,1fr)_auto] sm:items-end">
      <Dropdown
        label="Weekday"
        sorted={false}
        options={weekdayOptions.map((day) => ({ value: String(day.value), label: day.label }))}
        value={draft.dayOfWeek}
        onChange={(value) => setDraft((current) => ({ ...current, dayOfWeek: value }))}
      />
      <TextField label="Quote" value={draft.quote} onChange={(event) => setDraft((current) => ({ ...current, quote: event.target.value }))} placeholder="Start the week with purpose, not pressure." />
      <Button type="button" variant="primary" onClick={add} disabled={!draft.quote.trim() || saving || busy} className="font-semibold">
        {saving ? "Adding..." : "Add"}
      </Button>
    </div>

    <div className="mt-5 space-y-4">
      {loading ? <p className="text-sm text-slate-500">Loading quotes...</p>
        : weekdayOptions.map((day) => {
          const forDay = quotes.filter((quote) => quote.dayOfWeek === day.value);
          return <div key={day.value}>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{day.label}</p>
            {!forDay.length
              ? <p className="mt-1 text-xs text-amber-700">Nothing written for {day.label}, so no line is shown that day.</p>
              : <ul className="mt-2 space-y-1">
                {forDay.map((quote) => <li key={quote.id} className="flex items-start justify-between gap-3 rounded-md border border-slate-200 px-3 py-2">
                  <span className="min-w-0 text-sm text-slate-700">{quote.quote}</span>
                  <IconButton label={`Remove quote: ${quote.quote}`} onClick={() => remove(quote.id)} disabled={saving} className="shrink-0 text-slate-400 hover:bg-red-50 hover:text-red-600">
                    <DeleteOutlineOutlinedIcon sx={{ fontSize: 18 }} />
                  </IconButton>
                </li>)}
              </ul>}
          </div>;
        })}
    </div>
  </section>;
}
