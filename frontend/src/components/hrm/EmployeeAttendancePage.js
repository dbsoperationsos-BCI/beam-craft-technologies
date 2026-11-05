"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { facesUser } from "@/lib/cameraFacing.mjs";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import CalendarMonthOutlinedIcon from "@mui/icons-material/CalendarMonthOutlined";
import CameraAltRoundedIcon from "@mui/icons-material/CameraAltRounded";
import FileDownloadOutlinedIcon from "@mui/icons-material/FileDownloadOutlined";
import DataTable from "@/components/data-table/DataTable";
import KanbanBoard, { columnsFromRows, groupValue } from "@/components/data-table/KanbanBoard";
import { columnSumText } from "@/lib/kanbanSummary.mjs";
import TableBoardSwitch, { useTableBoardLayout } from "@/components/data-table/TableBoardSwitch";
import useTableSelection from "@/components/data-table/useTableSelection";
import { usePermissions } from "@/components/auth/PermissionsProvider";
import ModulePageHeader from "@/components/layout/ModulePageHeader";
import Button from "@/components/shared/Button";
import IconButton from "@/components/shared/IconButton";
import DateField from "@/components/shared/DateField";
import FloatingNotice, { useNotice } from "@/components/shared/FloatingNotice";
import Dialog from "@/components/ui/Dialog";
import TextAreaField from "@/components/shared/TextAreaField";
import DropdownMenu from "@/components/ui/DropdownMenu";
import { compressImageFile } from "@/lib/imageCompression";
import useEscapeKey from "@/components/shared/useEscapeKey";
import useFormErrors from "@/components/shared/useFormErrors";
import { getMyProfile } from "@/services/user/profile.service";
import Dropdown from "@/components/shared/Dropdown";
import DashboardCard, { CardState } from "@/components/shared/DashboardCard";
import AttendanceBalancesCard from "@/components/hrm/AttendanceBalancesCard";
import StatTile from "@/components/shared/StatTile";
import AttendanceRequestDialog from "@/components/hrm/AttendanceRequestDialog";
import ExtraTimeDialog from "@/components/hrm/ExtraTimeDialog";
import AttendanceRequestFormPanel from "@/components/hrm/AttendanceRequestFormPanel";
import AttendanceRegisterPage from "@/components/hrm/AttendanceRegisterPage";
import AttendanceRequestsPage from "@/components/hrm/AttendanceRequestsPage";
import AdminAttendanceDashboard from "@/components/hrm/AdminAttendanceDashboard";
import Loader from "@/components/shared/Loader";
import EventsPage from "@/components/hrm/EventsPage";
import SpeakUpPanel from "@/components/hrm/SpeakUpPanel";
import SpeakUpReviewPanel from "@/components/hrm/SpeakUpReviewPanel";
import {
  attendanceColumns,
  attendanceStatusStyles,
  attendanceVisibility,
  errorMessage,
} from "@/components/hrm/attendanceRequests";
import { formatTotalMinutes, payCycleRange, PAY_CYCLE_OPTION, SESSION_VALID_HOURS } from "@/lib/attendanceTime.mjs";
import { logoutOutcome } from "@/lib/logoutMessage.mjs";
import { ViewableImage } from "@/components/shared/ImageViewer";
import {
  createAttendanceRequest,
  getAttendanceSettings,
  getAttendanceSummary,
  getAttendanceBreaks,
  getTodayAttendance,
  getLogoutPreview,
  markAttendanceLogin,
  markAttendanceLogout,
  startAttendanceBreak,
  endAttendanceBreak,
  startAttendanceCapture,
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
 * answer rather than inventing a second one that would disagree. And every mark - a login, a
 * logout, a break - is a request to the server that can be refused, stamped by the server's clock.
 *
 * Requests - leave, permission, comp-off - are raised, approved and rejected on HRM → Request. The
 * Login dialog raises on-duty and outside attendance, and the dashboard a correction for a day left
 * open; each lands there too.
 */

const SECTION_SELF = "self-dashboard";
const SECTION_REQUEST = "request";
const SECTION_REGISTER = "register";
const SECTION_EVENTS = "events";
const SECTION_SPEAK_UP = "speak-up";
const SECTION_SPEAK_UP_REVIEW = "speak-up-review";

/*
 * The Self Dashboard, the Requests, the Attendance Register and the Events. The Rules are Settings →
 * Employee → Attendance Rules now, an administrator's alone: they are the studio's, not one person's
 * attendance.
 *
 * No Login entry: marking the day is the Login / Logout button in the header, which opens its
 * capture in a dialog over the dashboard, as Break In does. Request is the whole Request screen - leave,
 * permission and comp-off; one's own, the ones waiting on this login, and everybody's for an
 * administrator - brought in here rather than kept as a separate HRM entry.
 *
 * The Attendance Register and Events are whole screens brought in the same way, and off the HRM menu
 * for it. Each keeps its own permission - `HRM / Attendance Approval` and `HRM / Events`, the ones
 * their routes and endpoints check - and is offered here only to somebody holding it; their own
 * routes still open them alone, so a bookmark or the event notification's link still works.
 */
// In this order on the switch: the dashboard first, the leave and comp-off requests last.
const SECTIONS = [
  { label: "Self Dashboard", value: SECTION_SELF },
  { label: "Attendance Register", value: SECTION_REGISTER, permission: ["HRM", "Attendance Approval", "READ"] },
  { label: "Events", value: SECTION_EVENTS, permission: ["HRM", "Events", "READ"] },
  { label: "Leave or Comp-Off Request", value: SECTION_REQUEST },
  // READ sees your own past submissions; READ_WRITE also lets you raise a new one, gated
  // separately inside `SpeakUpPanel` on `canWrite` (Rule 4: a control the viewer may not use is
  // absent, not disabled). Review is confidential to HR, so it is its own permission, never
  // widened by holding Speak-up itself.
  { label: "Speak-up", value: SECTION_SPEAK_UP, permission: ["HRM", "Speak-up", "READ"] },
  { label: "Speak-up Review", value: SECTION_SPEAK_UP_REVIEW, permission: ["HRM", "Speak-up Review", "READ"] },
];
const DEEP_LINK_SECTIONS = new Set([SECTION_REQUEST, SECTION_REGISTER, SECTION_EVENTS, SECTION_SPEAK_UP, SECTION_SPEAK_UP_REVIEW]);

const workModes = [
  { id: "office", title: "Office" },
  { id: "work-from-home", title: "Work from home" },
  { id: "client-site", title: "Client site" },
];
/*
 * Log in at any hour: the day is judged on its hours from this login to the logout, never Late or
 * Early exit. Offered only to somebody HR has ticked Allow Flexible Shift for - and refused by the
 * server for anybody else - so it is kept apart from the modes everybody has.
 */
const flexibleWorkMode = { id: "flexible", title: "Flexible Shift" };
const rangeOptions = ["This week", "Last week", "This month", "Last month", "Last 6 months", "This Year", "Last Year", "Lifetime", "Custom"];

/*
 * The Self Dashboard's Login Summary and Break Summary are switched off for everybody for now -
 * administrators included - while they are reworked. Setting this back to `true` shows them again
 * to administrators alone: the server still answers `canSeeLogs` for them, and still refuses the
 * Break Summary's endpoint to anybody else.
 */
const SHOW_ATTENDANCE_LOGS = false;

/*
 * The ranges the Self Dashboard offers, which is a shorter list than the Login Summary's.
 *
 * A dashboard is read at a few useful scales rather than at every possible one; "Last week" and
 * "Last month" are questions somebody asks of a table, not of a set of headline figures.
 */
/*
 * The Self Dashboard's ranges, opening on the **pay cycle**.
 *
 * Payroll counts from the cycle day to the day before the next one, so a dashboard opening on the
 * calendar month answered a different question from the payslip beside it. The month is still
 * offered - a question somebody asks deliberately - but it is no longer what the screen assumes.
 */
const dashboardRangeOptions = ["This week", PAY_CYCLE_OPTION, "This month", "Last 6 months", "This Year", "Lifetime"];

/*
 * Beyond this many days the dashboard asks for figures only.
 *
 * A day row per date stops being readable long before it stops being possible: three months is
 * ninety rows nobody scrolls to answer "how has this year gone". Ninety-two days is a quarter, which
 * is the longest range where a calendar of it is still worth drawing.
 */
const TOTALS_ONLY_ABOVE_DAYS = 92;


/** `[key, header, kind, width, minWidth]`, which is also where the CSV export takes its header from. */
const loginSummaryFields = [
  ["day", "Date", undefined, 190, 130],
  ["in", "Login", undefined, 150, 110],
  ["out", "Logout", undefined, 150, 110],
  ["net", "Total Hours", undefined, 170, 130],
  // How many breaks, and how long in all - beside the hours, not taken off them.
  ["breaks", "Breaks", undefined, 150, 110],
  ["mode", "Work Mode", undefined, 190, 140],
  ["status", "Status", "status", 170, 130],
];
const loginSummaryVisibility = attendanceVisibility(loginSummaryFields);

function formatTimestamp(value) {
  if (!value) return "Not captured";
  return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "medium" }).format(new Date(value));
}

const startOfDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
const endOfDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
const isoDate = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};
const workModeLabel = (value) => [...workModes, flexibleWorkMode].find((mode) => mode.id === value)?.title || "";

/**
 * The longest range the summary endpoint will build day rows for. Kept in step with the server's
 * own limit so "Maximum" for somebody who joined years ago comes back with data rather than a 400.
 */
const MAX_RANGE_DAYS = 730;

function rangeForOption(option, customRange, joiningDate, payCycleDay = null) {
  const now = new Date();
  /*
   * The cycle holding today, from the day the studio set (`payCycleRange`), **clipped at today**
   * while it is still running - as every other "to date" range here is. A working day that has not
   * happened yet reads as Absent, so asking for the rest of the cycle would count days nobody could
   * have attended. The calendar options below are unchanged: "This month" still means the month.
   */
  if (option === PAY_CYCLE_OPTION) {
    const cycle = payCycleRange(payCycleDay, now);
    return { start: cycle.start, end: cycle.end < now ? cycle.end : endOfDay(now) };
  }
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


/** The summary table's rows. Every field is what the server decided; nothing is recomputed here. */
/**
 * The Board's columns for the Login and Break Summaries: one per status the rows hold, headed in the
 * colour `attendanceStatusStyles` gives that status everywhere else. Both boards are views only - a
 * marked day or a break is corrected through Attendance Approval, never moved here.
 */
// A good day first, then a late or short one, then a day away, then one gone wrong; a break running, then over.
const ATTENDANCE_BOARD_ORDER = ["On time", "Present", "Late", "Early exit", "Half day", "Permitted", "On leave", "Holiday", "Not required", "Not logged out", "Absent", "On break", "Completed", "Cancelled"];
const statusBoardColumns = (rows) => columnsFromRows(rows, (row) => row.status, { order: ATTENDANCE_BOARD_ORDER })
  .map((column) => (attendanceStatusStyles[column.value] ? { ...column, className: `${attendanceStatusStyles[column.value]} text-white` } : column));
const statusOfRow = (row) => groupValue(row.status);
// A board column's hours from its cards' `minutes`, at most one decimal: "Worked 42 h", "Break 3.5 h".
const columnHours = (rows, label) => columnSumText(rows, (row) => (Number(row.minutes) || 0) / 60, label, (hours) => `${Math.round(hours * 10) / 10} h`);
// A day nobody was expected to work, or did not, has no hours worth a figure.
const NO_WORK_STATUSES = ["Absent", "Holiday", "On leave", "Not required"];
// Both boards' trend counts a card by the day it is for (`date`, YYYY-MM-DD, read as a local day).
const dayOfRow = (row) => {
  const time = new Date(`${row.date || ""}T00:00:00`).getTime();
  return Number.isNaN(time) ? null : time;
};

function rowsFromDays(days) {
  return (days || []).map((day) => ({
    key: day.date,
    date: day.date,
    day: dayLabel(day.date),
    in: timeOnly(day.loginAt),
    out: timeOnly(day.logoutAt),
    net: day.logoutAt ? formatMinutes(day.minutes) : "-",
    breaks: day.breakCount ? `${day.breakCount} · ${breakLength(day.breakMinutes)}` : "-",
    mode: workModeLabel(day.workMode) || "-",
    status: day.status,
    minutes: day.minutes,
  }));
}

/** The days somebody actually turned up, which is what the activity tiles count. */


/** Yesterday as `YYYY-MM-DD`, for the one banner that gets to say "yesterday" rather than a date. */
const todayIso = () => isoDate(new Date());
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
          <DateField label="Start date" helperText="Choosing a date switches the range to Custom, starting here." value={value === "Custom" ? customRange.start : isoDate(range.start)} onChange={(next) => onCustomChange({ ...customRange, start: next })} />
          <DateField label="End date" helperText="Choosing a date switches the range to Custom, ending here." value={value === "Custom" ? customRange.end : isoDate(range.end)} onChange={(next) => onCustomChange({ ...customRange, end: next })} />
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

/**
 * The live selfie for one check-in or check-out (`captureType`).
 *
 * The camera opens in the circle itself the moment the field appears - pressing Login is the ask -
 * and the circle's camera button takes the picture from that feed. There is no second window and
 * no "Open camera" step. Once a photo is taken it fills the circle, and the same button retakes it.
 *
 * Opening the camera also asks the server to start the capture, and the token it hands back leaves
 * with the photograph: the server refuses a check-in whose token has expired or was never issued, so
 * the picture has to be taken from this feed, now, rather than kept from earlier. There is no file
 * input anywhere in this field - a gallery is not a way in.
 */
/** The volume buttons, by name and by the older key codes some browsers still send instead. */
const VOLUME_KEYS = new Set(["AudioVolumeUp", "AudioVolumeDown", "VolumeUp", "VolumeDown"]);
const VOLUME_KEY_CODES = new Set([174, 175, 24, 25]);

function CameraSelfieField({ disabled = false, value, captured = Boolean(value), onChange, captureType = "CHECK_IN", invalid = "" }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const captureTokenRef = useRef("");
  // Which opening of the camera a token answers: a slow reply to an earlier opening must not
  // overwrite the token of the current one.
  const captureRequestRef = useRef(0);
  const [tokenReady, setTokenReady] = useState(false);
  // Open from the start unless there is already a photo to show.
  const [cameraOpen, setCameraOpen] = useState(() => !value && !disabled);
  // Bumped by every opening, so trying again after a refusal starts the camera afresh.
  const [attempt, setAttempt] = useState(0);
  // `error` is a camera that cannot be used; `notice` is one shot that failed, with the feed still live.
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [capturing, setCapturing] = useState(false);
  const [starting, setStarting] = useState(cameraOpen);
  // Whether the camera in use faces the person (`facesUser`) - its preview then reads like a mirror.
  const [mirrored, setMirrored] = useState(false);
  const title = { CHECK_OUT: "Logout selfie", BREAK_START: "Break In selfie", BREAK_END: "Break Off selfie" }[captureType] || "Login selfie";
  const live = cameraOpen && !error;

  useEffect(() => {
    let cancelled = false;
    if (!cameraOpen) return undefined;
    // No camera API at all - an insecure page or some in-app browsers - is said at once, rather than
    // leaving "Opening camera..." on screen for ever, and asks the server for no token.
    const supported = Boolean(navigator.mediaDevices?.getUserMedia);
    captureTokenRef.current = "";
    const request = ++captureRequestRef.current;
    if (supported) {
      startAttendanceCapture(captureType)
        .then((response) => {
          if (request !== captureRequestRef.current) return;
          captureTokenRef.current = response?.data?.captureToken || "";
          setTokenReady(Boolean(captureTokenRef.current));
        })
        .catch((failure) => {
          if (request !== captureRequestRef.current) return;
          // Nothing can be taken without a token, so the camera is not left running behind "camera off".
          cancelled = true;
          streamRef.current?.getTracks().forEach((track) => track.stop());
          streamRef.current = null;
          setError(errorMessage(failure, "Unable to start the capture. Please try again."));
        });
    }
    (supported ? navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } }) : Promise.reject(new Error("unsupported")))
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
        // A selfie camera's preview reads like a mirror - and the photo taken is kept the same way (`capture`).
        setMirrored(facesUser(stream));
        setStarting(false);
      })
      .catch(() => {
        if (!cancelled) {
          setStarting(false);
          setError(supported ? "No camera available, or permission was refused." : "This browser cannot open the camera here. Open the app in Chrome or Safari and try again.");
        }
      });
    return () => {
      cancelled = true;
      // Any reply still on its way belongs to an opening that is over.
      captureRequestRef.current += 1;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, [cameraOpen, attempt, captureType]);

  function openCamera() {
    if (disabled) return;
    // A retake lets go of the photo it replaces, so Login cannot send a picture no longer on screen.
    if (value) onChange(null);
    setError("");
    setNotice("");
    setStarting(true);
    setTokenReady(false);
    setCameraOpen(true);
    setAttempt((current) => current + 1);
  }

  async function capture() {
    const video = videoRef.current;
    if (!video?.videoWidth || !tokenReady) return;
    setCapturing(true);
    setNotice("");
    try {
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const context = canvas.getContext("2d");
      // The selfie as the person saw it: a front camera's preview is a mirror, so the photo is drawn
      // mirrored too, rather than coming out flipped from what they lined up.
      if (mirrored) { context.translate(canvas.width, 0); context.scale(-1, 1); }
      context.drawImage(video, 0, 0);
      const face = await detectFace(canvas);
      // Only a detector that actually ran may refuse the shot. Where none could, the capture goes
      // through unverified rather than being blocked by a guess.
      if (face.supported && !face.verified) {
        setNotice("Face not detected. Please centre your face in the circle.");
        return;
      }
      const blob = await new Promise((resolve, reject) => {
        canvas.toBlob((result) => (result ? resolve(result) : reject(new Error("Unable to capture selfie."))), "image/jpeg", 0.9);
      });
      const compressed = await compressImageFile(new File([blob], `daily-login-selfie-${Date.now()}.jpg`, { type: "image/jpeg" }), { maxBytes: 36 * 1024, maxDimension: 480 });
      onChange({ dataUrl: compressed.dataUrl, faceVerified: face.verified, captureToken: captureTokenRef.current });
      setCameraOpen(false);
    } catch {
      setNotice("Unable to capture selfie. Please try again.");
    } finally {
      setCapturing(false);
    }
  }

  const waiting = live && (starting || !tokenReady);

  /*
   * A volume button takes the picture too, the way a phone's own camera does - while the feed is live
   * and ready, and only where the browser hands the press to the page at all. Most phones keep their
   * volume buttons for the volume (iPhone always; Android Chrome usually), so this is an extra and
   * never the way in: the camera button still does the same. A Bluetooth selfie remote, which presses
   * volume up, is the case it reliably serves. A held button fires once.
   */
  const captureRef = useRef(capture);
  useEffect(() => { captureRef.current = capture; });
  useEffect(() => {
    if (!live || waiting || capturing || disabled) return undefined;
    const onKey = (event) => {
      if (!VOLUME_KEYS.has(event.key) && !VOLUME_KEY_CODES.has(event.keyCode)) return;
      event.preventDefault();
      if (!event.repeat) void captureRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [live, waiting, capturing, disabled]);
  // While the camera starts, the circle itself says so; the line below keeps what is required.
  const hint = live && !waiting ? "Centre your face in the circle, then tap the camera"
    : captured ? "Captured just now"
      : disabled && value ? "Captured for today"
        : ({ CHECK_OUT: "Required before logout", BREAK_START: "Required to start the break", BREAK_END: "Required to end the break" }[captureType] || "Required before login");

  // `invalid` is the dialog's own message - a press with no selfie - said under the circle.
  return <div data-invalid={invalid ? true : undefined} className="flex h-full flex-col items-center justify-center p-4 text-center sm:p-5">
    <div className="relative">
      <div className="relative h-48 w-48 overflow-hidden rounded-full border border-slate-200 bg-[repeating-linear-gradient(135deg,#eef3fb_0,#eef3fb_10px,#e7edf7_10px,#e7edf7_20px)] sm:h-56 sm:w-56">
        {live ? <>
          <video ref={videoRef} autoPlay playsInline muted aria-label={`Live camera for the ${title.toLowerCase()}`} className={`h-full w-full bg-slate-900 object-cover ${mirrored ? "-scale-x-100" : ""}`} />
          {waiting && <span className="absolute inset-0 grid place-items-center bg-slate-950/40 px-6 text-xs font-semibold text-white">{starting ? "Opening camera..." : "Starting capture..."}</span>}
        </> : value ? (
          <ViewableImage images={[value]} label={`View ${title.toLowerCase()}`} className="h-full w-full"><Image src={value} alt={`Captured ${title.toLowerCase()}`} width={224} height={224} unoptimized className="h-full w-full object-cover" /></ViewableImage>
        ) : (
          <span className="grid h-full place-items-center font-mono text-xs font-normal lowercase text-slate-500">{error ? "camera off" : "no photo yet"}</span>
        )}
      </div>
      <IconButton
        size="md"
        shape="circle"
        variant="primary"
        onClick={live ? capture : openCamera}
        ariaLabel={live ? "Take selfie" : value ? "Retake selfie" : "Open camera"}
        disabled={disabled || (live && (waiting || capturing))}
        className="absolute bottom-1 right-1 sm:bottom-2 sm:right-2"
      >
        <CameraAltRoundedIcon sx={{ fontSize: 20 }} />
      </IconButton>
    </div>
    <p className="mt-4 text-sm font-semibold text-slate-950">{title} <span aria-hidden="true" className="text-rose-500">*</span></p>
    <p className="mt-1 text-xs text-slate-500" aria-live="polite">{capturing ? "Capturing..." : hint}</p>
    {invalid && <p role="alert" className="mt-1.5 text-xs font-normal text-red-600">{invalid}</p>}
    {(error || notice) && <p role="alert" className="mt-2 text-xs font-medium text-red-600">
      {error || notice}{error && " Tap the camera to try again."}
    </p>}
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
  const [layout, setLayout] = useTableBoardLayout("attendance-login-summary");

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
        <TableBoardSwitch value={layout} onChange={setLayout} />
        <IconButton size="sm" onClick={() => downloadAttendanceCsv(attendanceRows, rangeOption)} ariaLabel="Download attendance" className="border border-slate-200 text-slate-600">
          <FileDownloadOutlinedIcon sx={{ fontSize: 20 }} />
        </IconButton>
      </div>
    </div>
    {layout === "board" ? <div className="flex h-110 min-h-0 min-w-0">
      <KanbanBoard
        rows={attendanceRows}
        columns={statusBoardColumns(attendanceRows)}
        statusOf={statusOfRow}
        // Under each column: the hours its days were worked (`minutes`) - nothing under a day not worked.
        columnAmount={(rows, column) => (NO_WORK_STATUSES.includes(column.value) ? null : columnHours(rows, "Worked"))}
        dateOf={dayOfRow}
        card={{ title: (row) => row.day, subtitle: (row) => `In ${row.in} · Out ${row.out}`, meta: (row) => [row.mode, row.net].filter((value) => value && value !== "-").join(" · ") }}
        getRowId={(row) => row.key}
        viewOnly="Attendance is worked out from check-ins. Raise an attendance request to correct a day."
        loading={loading}
        noun="days"
        ariaLabel="Login summary board"
      />
    </div> : <DataTable
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
    />}
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
    ["Present", totals.present, "text-emerald-700"],
    ["Late", totals.late, "text-amber-700"],
    ["Half day", totals.halfDay, "text-amber-700"],
    ["Early exit", totals.earlyExit, "text-amber-700"],
    // Absent includes the logins nobody logged out of within its hours on days that were owed - they
    // read Absent until a correction says otherwise.
    ["Absent", totals.absent, "text-red-700"],
    ["On leave", totals.onLeave, "text-blue-700"],
  ];
  /*
   * "Your attendance", not "How the range went".
   *
   * The old title said nothing about what was in the card - every card on this screen is about the
   * range - and read as a verdict on the range rather than as the reader's own record. This is the
   * employee's own dashboard, so the plainest true name is theirs: the days the range owed and how
   * each of them went.
   *
   * The note names both figures as well. "Worked 157h 17m of 127h 30m" left the second one to be
   * guessed at, and a figure larger than what it is "of" reads as a mistake until you know the
   * second is what the range expected.
   */
  return <DashboardCard
    title="Your attendance"
    note={`${formatTotalMinutes(totals.workedMinutes)} worked of ${formatTotalMinutes(totals.targetMinutes)} expected`}
  >
    {/* Seven small figures rather than seven cards: they are one set read across, and giving each
        its own bordered box would make seven objects out of one row. All seven in one row on a wide
        screen, four then three on a laptop, three to a row on a tablet, two on a phone. */}
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
      {tiles.map(([label, value, tone]) => <StatTile key={label} label={label} value={value ?? 0} tone={tone} />)}
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
/**
 * Login / Logout, in the page header beside Break In / Break Off, and opened the same way: pressing it
 * opens the capture straight away - a live selfie, the location read right after it, and the time
 * the server stamps - rather than a separate login screen.
 *
 * A day can be logged in and out more than once: after a logout it says Login again, and a login
 * then re-opens the day - the time logged out in between is not counted as worked. A login with no
 * employee behind it cannot mark a day at all; the button says why.
 */
/**
 * On a phone the header's action row spans the screen (`stretchActionsOnPhone`), and Break In and
 * Login split it evenly; from `sm` up they are ordinary buttons again.
 */
const SHARE_ROW_ON_PHONE = "max-sm:flex-1";

function DashboardLoginButton({ today, loaded = true, unavailable = "", onLogin, onLogout }) {
  const session = today?.session || null;
  // Until today is known the button cannot know whether it is Login or Logout, and offering Login to
  // somebody already logged in sends them through the camera to be told so.
  if (!loaded) return <Button type="button" variant="primary" disabled className={`shrink-0 ${SHARE_ROW_ON_PHONE}`}>Loading...</Button>;
  if (unavailable) return <Button type="button" variant="primary" disabled title={unavailable} className={`shrink-0 ${SHARE_ROW_ON_PHONE}`}>Login</Button>;
  // Logged in now: Logout. Not yet today, or logged out since: Login - which logs in again after a logout.
  const loggedIn = Boolean(session && !session.logoutAt);
  return <Button type="button" variant="primary" onClick={loggedIn ? onLogout : onLogin} title={session?.logoutAt ? "Log in again - the time you were logged out is not counted as worked." : undefined} className={`shrink-0 ${SHARE_ROW_ON_PHONE}`}>{loggedIn ? "Logout" : "Login"}</Button>;
}

const breakClock = new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit", hour12: true });
const breakTime = (value) => (value ? breakClock.format(new Date(value)).toLowerCase() : "");
/** A break's length as "12m" or "1h 5m" - and "Under a minute" rather than a dash for a quick one. */
const breakLength = (minutes) => {
  const total = Math.max(0, Math.round(Number(minutes) || 0));
  if (!total) return "Under a minute";
  const hours = Math.floor(total / 60);
  return hours ? `${hours}h ${total % 60}m` : `${total}m`;
};

/**
 * Break In / Break Off, beside Login / Logout in the header.
 *
 * A break is inside a logged-in day, so it is offered only while the server says today is logged in:
 * before the login - and while today is still loading - the header offers Login alone, and once the
 * day is logged out it goes again. While a break runs it reads Break Off.
 */
function BreakButton({ today, busy, onStart, onEnd }) {
  const session = today?.session || null;
  if (!session || session.logoutAt) return null;
  const onBreak = Boolean(today?.breaks?.onBreak);
  return onBreak
    ? <Button type="button" variant="secondary" disabled={busy} onClick={onEnd} title={`On break since ${breakTime(today.breaks.current?.startedAt)}`} className={`!border-amber-300 !bg-amber-50 !text-amber-800 ${SHARE_ROW_ON_PHONE}`}>{busy ? "Ending..." : "Break Off"}</Button>
    : <Button type="button" disabled={busy} onClick={onStart} className={SHARE_ROW_ON_PHONE}>{busy ? "Starting..." : "Break In"}</Button>;
}

/**
 * Said on the dashboard when today's login was measured outside the office, with the ask that
 * explains it - the check-in card offered it once, and this keeps it there for the rest of the day.
 * Not for a login that could not be measured (no office recorded): that is not somebody being
 * somewhere else, and every login reads that way until the offices are set.
 */
function OutsideLoginNotice({ today, onRequestOutside }) {
  const session = today?.session;
  if (!session || !onRequestOutside || session.loginLocationVerified !== false || session.loginDistanceMeters == null) return null;
  return <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 sm:text-sm">
    Today&rsquo;s login was about {formatDistance(session.loginDistanceMeters)} from your branch office, so it is flagged for HR.{" "}
    <button type="button" onClick={onRequestOutside} className="inline-flex min-h-8 items-center font-semibold underline underline-offset-2">Request outside attendance</button>
  </div>;
}

/** Said on the dashboard while a break is running, so nobody forgets to end it. */
function OnBreakNotice({ today }) {
  const current = today?.breaks?.onBreak ? today.breaks.current : null;
  if (!current) return null;
  return <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 sm:text-sm">
    You are on a break since {breakTime(current.startedAt)}. Press <span className="font-semibold">Break Off</span> when you are back.
  </div>;
}

/**
 * What Break Off answers with: this break - when it started and ended, and how long - and the day's
 * breaks so far, one line each with the total under them.
 */
function BreakSummaryDialog({ summary, onClose }) {
  const { ended, today } = summary || {};
  return <Dialog
    title="Break summary"
    size="sm"
    onClose={onClose}
    footer={<Button type="button" variant="primary" onClick={onClose}>Done</Button>}
  >
    <div className="space-y-4 pb-2">
      {ended && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-emerald-700">This break</p>
        <p className="mt-1 text-2xl font-semibold tabular-nums text-emerald-900">{breakLength(ended.minutes)}</p>
        <p className="text-sm text-emerald-800">{breakTime(ended.startedAt)} - {breakTime(ended.endedAt)}</p>
      </div>}
      {today && <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Today</p>
        <p className="mt-1 text-sm text-slate-700">
          {today.count} break{today.count === 1 ? "" : "s"}, <span className="font-semibold text-slate-900">{breakLength(today.totalMinutes)}</span> in total
        </p>
        <ol className="mt-2 divide-y divide-slate-100 rounded-md border border-slate-200">
          {today.breaks.map((entry, index) => <li key={entry.id} className="flex items-center justify-between px-3 py-2 text-sm">
            <span className="text-slate-600">{index + 1}. {breakTime(entry.startedAt)} - {entry.endedAt ? breakTime(entry.endedAt) : "now"}</span>
            <span className="font-medium tabular-nums text-slate-900">{breakLength(entry.minutes)}</span>
          </li>)}
        </ol>
      </div>}
    </div>
  </Dialog>;
}

/** What each capture is called, what its button says, and what a failure says. */
const CAPTURE_STEPS = {
  CHECK_IN: { title: "Login", submit: "Log in", busy: "Logging in...", failed: "Unable to mark your login." },
  CHECK_OUT: { title: "Logout", submit: "Log out", busy: "Logging out...", failed: "Unable to mark your logout." },
  BREAK_START: { title: "Break In", submit: "Start break", busy: "Starting...", failed: "Unable to start the break." },
  BREAK_END: { title: "Break Off", submit: "End break", busy: "Ending...", failed: "Unable to end the break." },
};

/**
 * The evidence a login, a logout or a break carries, taken before it is sent: a live selfie through
 * the camera field (its own capture token for the step - `CHECK_IN`, `CHECK_OUT`, `BREAK_START` or
 * `BREAK_END`), then a fresh position read once the photo is in. The server stamps the time with its
 * own clock, because a clock the person being judged can set is not evidence of when they arrived.
 * Nothing is sent until both are there; a refused or stale capture is retaken.
 *
 * A login also says where the day is worked from. Somebody working away today is offered the two
 * asks for that - on-duty, and outside attendance - on the login itself, which is where a login
 * refused for being outside the office leaves them.
 */
function AttendanceCaptureDialog({ step, busy, attendanceOptional = false, flexibleShiftAllowed = false, dayWorkMode = null, onClose, onSubmit, onRaise }) {
  const [capture, setCapture] = useState(null);
  const [location, setLocation] = useState(null);
  const [locationStatus, setLocationStatus] = useState("idle");
  const [problem, setProblem] = useState("");
  const [workMode, setWorkMode] = useState(workModes[0].id);
  const locationRequestRef = useRef(0);
  const fields = useFormErrors();
  const config = CAPTURE_STEPS[step];
  const checkingIn = step === "CHECK_IN";
  /*
   * Logging out early: what the day will be marked as if they log out now - Absent, Half day, Early
   * exit - said before they confirm, so they can cancel and stay. Read from the server, by the rules
   * the register judges by; nothing is said for a day fine to leave, an approved permission included.
   */
  const [logoutPreview, setLogoutPreview] = useState(() => (step === "CHECK_OUT" ? { state: "loading" } : null));
  useEffect(() => {
    if (step !== "CHECK_OUT") return undefined;
    let live = true;
    getLogoutPreview()
      .then((response) => {
        if (!live) return;
        const answer = response?.data || null;
        setLogoutPreview({
          state: "ready",
          outcome: logoutOutcome(answer?.status),
          // Past the login's 18 hours: the logout is still taken, and sends the hours worked past
          // them to this person for approval. The box asks why before it goes.
          late: Boolean(answer?.late),
          approverName: answer?.approverName || "",
        });
      })
      // Not knowing is said, never read as "fine to leave"; the logout itself is still allowed.
      .catch(() => { if (live) setLogoutPreview({ state: "failed" }); });
    return () => { live = false; };
  }, [step]);
  const logoutWarning = logoutPreview?.outcome || null;
  const late = Boolean(logoutPreview?.late);
  // Asked for only on a late logout: the approver reads it before deciding.
  const [lateReason, setLateReason] = useState("");

  function readLocation() {
    setProblem("");
    if (!navigator.geolocation) {
      setLocationStatus("error");
      setProblem("Location is not available on this device, so this cannot be recorded here.");
      return;
    }
    setLocationStatus("loading");
    // Only the newest reading may land, so a retake cannot be answered by an older position.
    const request = ++locationRequestRef.current;
    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (request !== locationRequestRef.current) return;
        setLocation({ latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy: position.coords.accuracy });
        setLocationStatus("ready");
      },
      (error) => {
        if (request !== locationRequestRef.current) return;
        setLocationStatus("error");
        setProblem(`${error.message || "Location permission was denied."} Allow location for this site and try again.`);
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 },
    );
  }

  const ready = Boolean(capture?.dataUrl && capture?.captureToken && location);

  async function submit() {
    if (busy || !fields.check({
      selfie: capture?.dataUrl ? "" : "Take a selfie first.",
      ...(late ? { lateReason: lateReason.trim() ? "" : "Say why you are logging out late." } : {}),
    })) return;
    // The location is read straight after the selfie, and its line below says how that is going.
    if (!ready) return;
    // The last refusal is not this attempt's answer.
    setProblem("");
    try {
      await onSubmit({
        ...(checkingIn ? { workMode } : {}),
        selfie: capture.dataUrl,
        faceVerified: capture.faceVerified,
        captureToken: capture.captureToken,
        latitude: location.latitude,
        longitude: location.longitude,
        accuracy: location.accuracy,
        ...(late ? { reason: lateReason.trim() } : {}),
      });
    } catch (error) {
      // A spent or expired token cannot be sent again: the photo is thrown away and retaken.
      if ((error?.data || error)?.code === "CAPTURE_EXPIRED") {
        setCapture(null);
        setLocation(null);
        setLocationStatus("idle");
      } else if ((error?.data || error)?.code === "OUTSIDE_LOCATION") {
        // Refused for where it was taken: read the position again, so a retry after walking in is
        // judged on where they are now rather than on the reading that was refused.
        readLocation();
      }
      setProblem(outsideLocationMessage(error) || errorMessage(error, config.failed));
    }
  }

  return <Dialog
    title={config.title}
    description="Take a live selfie; your location is read straight after it. The time is recorded by the server."
    size="md"
    busy={busy}
    // Not closable while it is sending: the × would unmount it, and the server's answer - a refusal
    // to retake, most of all - would arrive with nothing left on screen to say it.
    onClose={busy ? undefined : onClose}
    footer={<>
      <Button type="button" onClick={onClose} disabled={busy}>Cancel</Button>
      <Button type="button" variant="primary" onClick={() => void submit()} disabled={busy}>
        {busy ? config.busy : config.submit}
      </Button>
    </>}
  >
    <div className="space-y-3 pb-2">
      {logoutPreview?.state === "loading" && <p className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">Checking how this logout will be recorded...</p>}
      {logoutPreview?.state === "failed" && <p className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">We could not check how this logout will be recorded. You can still log out.</p>}
      {logoutWarning && !late && <p role="alert" className={`rounded-md px-3 py-2 text-sm font-medium ${logoutWarning.className}`}>
        <span aria-hidden="true" className="mr-1.5 font-bold">!</span>{logoutWarning.before} Cancel to stay logged in.
      </p>}
      {/* Past 18 hours: what pressing Logout will do, in the order it happens, and why it is asked. */}
      {late && <>
        <p role="alert" className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900 sm:text-sm">
          Your login has passed {SESSION_VALID_HOURS} hours. You will be logged out, and the extra time you worked goes
          to {logoutPreview?.approverName ? <span className="font-semibold">{logoutPreview.approverName}</span> : "your Permission Approver"} for approval.
          This day stays <span className="font-semibold">Absent</span> until it is approved, and then reads <span className="font-semibold">Present</span>.
        </p>
        {logoutPreview?.state === "ready" && !logoutPreview?.approverName && <p className="text-xs text-amber-700">
          No Permission Approver is set on your record, so the extra time cannot be sent. You will still be logged out - ask HR to set one.
        </p>}
        <TextAreaField
          label="Why are you logging out late?"
          required
          rows={3}
          value={lateReason}
          onChange={(event) => { setLateReason(event.target.value); fields.clear("lateReason"); }}
          error={fields.errors.lateReason}
          helperText="Your approver reads this before deciding."
          disabled={busy}
        />
      </>}
      {checkingIn && attendanceOptional && <p className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">
        As a Super Admin, logging in and out is not compulsory for you. A day you do not mark is shown as Not required, never as Absent.
      </p>}
      <CameraSelfieField
        captureType={step}
        value={capture?.dataUrl || ""}
        captured={Boolean(capture?.dataUrl)}
        disabled={busy}
        invalid={fields.errors.selfie}
        onChange={(next) => {
          setCapture(next?.dataUrl ? next : null);
          if (next?.dataUrl) fields.clear("selfie");
          locationRequestRef.current += 1;
          setLocation(null);
          if (next?.dataUrl) readLocation();
          else setLocationStatus("idle");
        }}
      />
      <p className={`rounded-md px-3 py-2 text-xs ${locationStatus === "ready" ? "bg-emerald-50 text-emerald-800" : locationStatus === "error" ? "bg-red-50 text-red-700" : "bg-slate-50 text-slate-600"}`}>
        {locationStatus === "ready" && location
          ? `Live location captured: ${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)} (± ${Math.round(location.accuracy)} m)`
          : locationStatus === "loading" ? "Reading your live location..."
            : locationStatus === "error" ? "Location not captured."
              : "Your live location is read once the selfie is taken."}
        {locationStatus === "error" && <button type="button" onClick={readLocation} className="ml-2 font-semibold underline underline-offset-2">Try again</button>}
      </p>
      {checkingIn && <div>
        <p className="text-xs font-semibold text-slate-600">Work mode</p>
        <div className="mt-1.5 grid grid-cols-2 gap-2">
          {/* A login again after a logout re-opens the day, which keeps its first login's work mode -
              so the mode is said, not offered as a choice that would change nothing. */}
          {dayWorkMode ? <p className="col-span-2 rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-700">
            {workModeLabel(dayWorkMode) || "Office"}, kept from your first login today.
          </p> : workModes.map((mode) => <Button
            key={mode.id}
            type="button"
            variant={workMode === mode.id ? "primary" : "secondary"}
            aria-pressed={workMode === mode.id}
            disabled={busy}
            onClick={() => setWorkMode(mode.id)}
          >
            {mode.title}
          </Button>)}
          {/* On-duty / travel sits with the work modes but is not one: it is the on-duty request,
              raised for approval instead of a login, so it leaves this capture for the request form
              as the separate link under the modes used to. Never shown as selected -
              it is an action, not a mode. On-duty only: an outside-attendance request is about a
              day already marked, and the server refuses one with no login behind it. */}
          {onRaise && <Button type="button" variant="secondary" disabled={busy} onClick={() => onRaise("ON_DUTY")}>
            On-duty / Travel
          </Button>}
          {flexibleShiftAllowed && !dayWorkMode && <Button
            type="button"
            className="col-span-2"
            variant={workMode === flexibleWorkMode.id ? "primary" : "secondary"}
            aria-pressed={workMode === flexibleWorkMode.id}
            aria-describedby={workMode === flexibleWorkMode.id ? "flexible-shift-note" : undefined}
            disabled={busy}
            onClick={() => setWorkMode(flexibleWorkMode.id)}
          >
            {flexibleWorkMode.title}
          </Button>}
        </div>
        {workMode === flexibleWorkMode.id && !dayWorkMode && <p id="flexible-shift-note" className="mt-2 space-y-0.5 rounded-md bg-blue-50 px-3 py-2 text-xs text-blue-800">
          <span className="block font-semibold">Log in at any time.</span>
          <span className="block">Your day counts from this login until you log out, by the Half day and Full day hours. It is never marked Late or Early exit.</span>
        </p>}
      </div>}
      {problem && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-xs font-medium text-red-700">{problem}</p>}
    </div>
  </Dialog>;
}

/**
 * A day whose login passed its 18 hours, and the two ways out of it.
 *
 * **Log out late** is offered on **today's** day only. It is what the person was trying to do: it
 * takes the logout at the time they press it and sends the extra time to their Permission Approver
 * by itself (`ExtraTimeDialog`), rather than leaving them to fill in a request form about their own
 * day. A day that has already rolled over is not something anybody is still working, so logging out
 * of it is not what it needs - it keeps the regularization alone, as it always had.
 *
 * Raising a regularization stays on every day, for one whose right answer is not "I worked on" - a
 * Half day, or a day that was leave after all.
 */
function NeedsAttentionNotice({ today, onRequestCorrection, onLogOutLate }) {
  const needsAttention = today?.needsAttention || [];
  if (!needsAttention.length) return null;
  return <div className="mb-3 space-y-1 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 sm:text-sm">
    {needsAttention.map((day) => <p key={day.date}>
      {day.date === todayIso() ? "Today's attendance" : day.date === yesterdayIso() ? "Yesterday's attendance" : `Attendance for ${formatDayLabel(day.date)}`} is marked Absent: you logged in at {formatTimestamp(day.loginAt)} and did not log out within {SESSION_VALID_HOURS} hours.{" "}
      {onLogOutLate && day.date === todayIso() && <><button type="button" onClick={() => onLogOutLate(day)} className="font-semibold underline underline-offset-2">Log out late</button>{" or "}</>}
      <button type="button" onClick={() => onRequestCorrection(day)} className="font-semibold underline underline-offset-2">raise attendance regularization</button>
    </p>)}
  </div>;
}

/** The Break Summary's columns, `[key, header, kind, width, minWidth]` like the Login Summary's. */
const breakSummaryFields = [
  ["day", "Date", undefined, 190, 130],
  ["breakIn", "Break In", undefined, 150, 110],
  ["breakOff", "Break Off", undefined, 150, 110],
  ["duration", "Duration", undefined, 150, 110],
  ["inLocation", "Break In Location", undefined, 190, 140],
  ["offLocation", "Break Off Location", undefined, 190, 140],
  ["status", "Status", "status", 170, 130],
];
const breakSummaryVisibility = attendanceVisibility(breakSummaryFields);

/**
 * Where a break's end was captured, as a table cell: the address it resolved to, with the office
 * check beside it only where a distance was measured. With no office point recorded there is
 * nothing to check against, and "Unverified" on every break would say nothing.
 */
function breakLocationLabel(location) {
  if (!location) return "-";
  const place = location.address || "Captured";
  if (location.distanceMeters == null) return place;
  const distance = location.distanceMeters < 1000 ? `${location.distanceMeters} m` : `${(location.distanceMeters / 1000).toFixed(1)} km`;
  return `${place} · ${location.verified ? `Verified, ${distance} from office` : `${distance} away`}`;
}

function rowsFromBreaks(breaks) {
  return (breaks || []).map((entry) => ({
    key: String(entry.id),
    date: entry.date,
    day: dayLabel(entry.date),
    breakIn: timeOnly(entry.startedAt),
    breakOff: entry.endedAt ? timeOnly(entry.endedAt) : "-",
    duration: breakLength(entry.minutes),
    // The figure under a Board column adds these up.
    minutes: entry.minutes,
    inLocation: breakLocationLabel(entry.startLocation),
    offLocation: entry.closedByLogout ? "Ended at logout" : breakLocationLabel(entry.endLocation),
    // "On time" draws green and "Not logged out" amber in `attendanceStatusStyles`; a break reads the same way.
    status: entry.running ? "On break" : "Completed",
  }));
}

function downloadBreaksCsv(rows, label) {
  const escape = (value) => `"${String(value ?? "").replaceAll("\"", "\"\"")}"`;
  const csv = [
    breakSummaryFields.map(([, header]) => escape(header)).join(","),
    ...rows.map((row) => breakSummaryFields.map(([key]) => escape(row[key])).join(",")),
  ].join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `breaks-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * Break Summary - the Login Summary's counterpart, below it on the Self Dashboard and built the same
 * way: This week / Month or any range from the same picker, the range's total on the right, a CSV
 * download, and one row per break with its Break In and Break Off, its length, and what the
 * location check said at each end. `refreshToken` re-reads it after a break is taken.
 */
function BreakSummarySection({ joiningDate, refreshToken, onError }) {
  const rangePickerRef = useRef(null);
  const [rangeOption, setRangeOption] = useState("This week");
  const [customRange, setCustomRange] = useState(() => ({ start: isoDate(new Date()), end: isoDate(new Date()) }));
  const [rangeOpen, setRangeOpen] = useState(false);
  const [result, setResult] = useState(null);
  const selectedRange = rangeForOption(rangeOption, customRange, joiningDate);
  const from = isoDate(selectedRange.start);
  const to = isoDate(selectedRange.end);
  const rangeKey = `${from}|${to}|${refreshToken}`;
  const loading = result?.key !== rangeKey;
  const breakRows = rowsFromBreaks(result?.breaks);
  const columns = attendanceColumns(breakSummaryFields, breakRows);
  const totals = result?.totals;
  const [layout, setLayout] = useTableBoardLayout("attendance-break-summary");

  useEffect(() => {
    let cancelled = false;
    getAttendanceBreaks({ from, to })
      .then((response) => { if (!cancelled) setResult({ key: rangeKey, ...(response?.data || {}) }); })
      .catch((error) => {
        if (cancelled) return;
        setResult({ key: rangeKey });
        const message = errorMessage(error, "Unable to load your breaks.");
        // An unlinked login is already told so above; not a second time here.
        if (error?.status === 400 && /not linked to an employee record/i.test(message)) return;
        onError?.(message);
      });
    return () => { cancelled = true; };
  }, [from, to, rangeKey, onError]);

  useEscapeKey(() => setRangeOpen(false), rangeOpen);

  useEffect(() => {
    if (!rangeOpen) return undefined;
    const close = (event) => {
      if (!rangePickerRef.current?.contains(event.target)) setRangeOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [rangeOpen]);

  return <section className="relative mt-3 rounded-lg border border-slate-200 bg-white shadow-sm">
    <div className="flex flex-col gap-3 border-b border-slate-100 px-3 py-2 sm:px-4 xl:flex-row xl:items-center">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-sm font-medium text-slate-700">Break Summary</h2>
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
          Total Break Time: {totals?.count ? `${breakLength(totals.minutes)} across ${totals.count} break${totals.count === 1 ? "" : "s"}` : "No breaks"}
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
        <TableBoardSwitch value={layout} onChange={setLayout} />
        <IconButton size="sm" onClick={() => downloadBreaksCsv(breakRows, rangeOption)} ariaLabel="Download breaks" className="border border-slate-200 text-slate-600">
          <FileDownloadOutlinedIcon sx={{ fontSize: 20 }} />
        </IconButton>
      </div>
    </div>
    {layout === "board" ? <div className="flex h-110 min-h-0 min-w-0">
      <KanbanBoard
        rows={breakRows}
        columns={statusBoardColumns(breakRows)}
        statusOf={statusOfRow}
        // Under each column: the hours of break its cards add up to (`minutes`).
        columnAmount={(rows) => columnHours(rows, "Break")}
        dateOf={dayOfRow}
        card={{ title: (row) => row.day, subtitle: (row) => `${row.breakIn} – ${row.breakOff}`, meta: (row) => row.duration }}
        getRowId={(row) => row.key}
        viewOnly="Attendance is worked out from check-ins. Raise an attendance request to correct a day."
        loading={loading}
        noun="breaks"
        ariaLabel="Break summary board"
      />
    </div> : <DataTable
      columns={columns}
      data={breakRows}
      loading={loading}
      emptyMessage="No breaks taken in this range."
      noMatchMessage="No matching breaks found."
      ariaLabel="Break summary table"
      getRowId={(row) => row.key}
      defaultColumnVisibility={breakSummaryVisibility}
      tableClassName="min-w-full"
      features={{ filtering: true, sorting: true, columnVisibility: true }}
    />}
  </section>;
}

/**
 * `showLogs` - the Login Summary and the Break Summary - is the server's answer (`canSeeLogs` on the
 * attendance settings, administrators only), and only while `SHOW_ATTENDANCE_LOGS` is on - it is off
 * for now, so nobody sees them. Everybody gets the KPI cards and the notices they have to act on.
 */
function SelfDashboardPanel({ joiningDate, refreshToken, onError, today, onRequestCorrection, onLogOutLate, onRequestOutside, payCycleDay = null, showLogs = false }) {
  const [range, setRange] = useState(PAY_CYCLE_OPTION);
  const [summary, setSummary] = useState(null);

  const selected = rangeForOption(range, { start: "", end: "" }, joiningDate, payCycleDay);
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
  /*
   * The cycle day arrives with the settings, so until it does there is no pay cycle to ask about.
   * Counting on the default meanwhile showed a studio on another day one window of figures and then
   * swapped it for a different one without a word - the worst thing that can happen to a number
   * whose whole purpose is to agree with the payslip. The dashboard waits instead.
   */
  const waitingForCycleDay = range === PAY_CYCLE_OPTION && !payCycleDay;

  useEffect(() => {
    if (waitingForCycleDay) return undefined;
    let cancelled = false;
    getAttendanceSummary({ from, to, totals: figuresOnly })
      .then((response) => {
        if (!cancelled) setSummary(response?.data || null);
      })
      .catch((error) => {
        if (cancelled) return;
        // A login with no employee has no attendance: the header already says so, once, rather than
        // an error on every visit.
        const message = errorMessage(error, "Unable to load your attendance dashboard.");
        if (error?.status === 400 && /not linked to an employee record/i.test(message)) return;
        onError?.(message);
      });
    return () => { cancelled = true; };
  }, [from, to, figuresOnly, refreshToken, onError, waitingForCycleDay]);

  const totals = summary?.totals;
  const caption = [
    `${rangeLabel(range, selected)}`,
    totals ? `${totals.workingDays ?? 0} working days` : null,
    totals ? `${formatTotalMinutes(totals.workedMinutes)} of ${formatTotalMinutes(totals.targetMinutes)} worked` : null,
    totals?.attendanceRate != null ? `${totals.attendanceRate}% attended` : null,
  ].filter(Boolean).join(" · ");

  return <div className="dashboard-canvas min-h-0 flex-1 overflow-y-auto px-3 py-3 sm:px-4">
    {/* The caption says what is being shown and the picker changes it, on one line, the way the
        Image Selection dashboard reads. On a phone the two stack and the picker keeps the right.
        Always drawn: this panel is now the employee's own dashboard alone - an administrator gets
        `AdminAttendanceDashboard` instead, and never reaches this. */}
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

    {onRequestCorrection && <NeedsAttentionNotice today={today} onRequestCorrection={onRequestCorrection} onLogOutLate={onLogOutLate} />}
    <OnBreakNotice today={today} />
    <OutsideLoginNotice today={today} onRequestOutside={onRequestOutside} />
    <AttendanceTotals totals={totals} />
    {/* What is left to take - Casual Leave, permissions, comp-offs - under the range's figures. */}
    <div className="mt-3"><AttendanceBalancesCard /></div>

    {/*
      * The day table and the calendar are for a range somebody can actually read day by day. Past a
      * quarter they are replaced by a line saying so, rather than by 365 rows nobody scrolls — and
      * for Lifetime the server never sent the days in the first place.
      */}
    {showLogs && <>
      {figuresOnly
        ? <div className="mt-3 rounded-lg border border-slate-200 bg-white px-4 py-3 text-xs text-slate-500 shadow-sm">
          Showing figures only for a range this long. Choose <span className="font-medium text-slate-700">This month</span> or
          shorter to see the calendar and the day-by-day list.
        </div>
        : <div className="mt-3">
          <AttendanceSummarySection joiningDate={joiningDate} refreshToken={refreshToken} onError={onError} hideTotals />
        </div>}

      {/* Below the Login Summary, and read the same way: one row per break over the chosen range. */}
      <BreakSummarySection joiningDate={joiningDate} refreshToken={refreshToken} onError={onError} />
    </>}
  </div>;
}

export default function EmployeeAttendancePage() {
  // Opens on the Self Dashboard - how the month is going - with Login a press away in the header.
  /*
   * Which section is open lives in the address - `?section=request`, `register` or `events`, and no
   * query for the Self Dashboard - so a refresh, the Back button or a bookmark opens the same section
   * rather than dropping back to the dashboard. It used to be held in the page's memory alone, which
   * a reload wiped. The bell's link for a request waiting on this person is the same query.
   */
  const router = useRouter();
  const requestedSection = useSearchParams().get("section");
  const section = DEEP_LINK_SECTIONS.has(requestedSection) ? requestedSection : SECTION_SELF;
  const setSection = useCallback((next) => {
    router.replace(next && next !== SECTION_SELF ? `/hrm/employee-attendance?section=${next}` : "/hrm/employee-attendance", { scroll: false });
  }, [router]);
  // The sections this login may open: the register and the events only with their own permissions.
  const { hasPermission, isAdministrator, loading: permissionsLoading } = usePermissions();
  /*
   * An administrator does not mark their own day here - no Break In, no Login / Logout in the header.
   * Held back while the permissions load, so the buttons never flash up for an administrator and then
   * vanish; everybody else has both as before.
   */
  const showDayButtons = !permissionsLoading && !isAdministrator;
  /*
   * An administrator gets the studio's Dashboard where everybody else gets their own Self
   * Dashboard - a different screen, so it is named differently on the switch. Held back while the
   * permissions load, like the buttons above, so neither name flashes up and is replaced.
   */
  const showAdminDashboard = !permissionsLoading && isAdministrator;
  const sections = SECTIONS
    .filter((entry) => !entry.permission || hasPermission(...entry.permission))
    .map((entry) => (entry.value === SECTION_SELF && showAdminDashboard ? { ...entry, label: "Dashboard" } : entry));
  // A section somebody cannot open - a link followed without the permission - reads as the dashboard.
  // While the permissions are still loading the asked-for section stands, so a refresh does not
  // flash the dashboard before putting the reader back where they were.
  const shownSection = permissionsLoading || sections.some((entry) => entry.value === section) ? section : SECTION_SELF;
  /*
   * Today's attendance, read here so the header can say Login or Logout, Break In or
   * Break Off, and so the dashboard can mention a day left open.
   */
  const [today, setToday] = useState(null);
  /** Why this login cannot mark attendance at all - it has no employee behind it - or "". */
  const [unlinked, setUnlinked] = useState("");
  /** Whether today has been read once, so the header does not offer Login before it knows. */
  const [todayLoaded, setTodayLoaded] = useState(false);
  const [dashboardRefresh, setDashboardRefresh] = useState(0);
  const loadTodayForDashboard = useCallback(() => {
    getTodayAttendance()
      .then((response) => { setUnlinked(""); setToday(response?.data || null); })
      // Settled either way: a read that failed falls back to offering Login, and the server still
      // refuses a second login for the day.
      .finally(() => setTodayLoaded(true))
      .catch((error) => {
        // The answer rather than a failure, and the same on every reload: said on the Login
        // button, which cannot be pressed, instead of as an error behind a camera.
        const message = errorMessage(error, "");
        setUnlinked(error?.status === 400 && /not linked to an employee record/i.test(message) ? message : "");
        setToday(null);
      });
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(loadTodayForDashboard, 0);
    return () => window.clearTimeout(timer);
  }, [loadTodayForDashboard]);
  /*
   * Login, Logout, Break In and Break Off all open the same capture - `capture` is its step - and
   * each lands on the dashboard behind it: the check-in card after a login, the summary after a
   * break ends, a notice otherwise.
   */
  const [capture, setCapture] = useState(null);
  const [captureBusy, setCaptureBusy] = useState(false);
  const [checkedIn, setCheckedIn] = useState(null);
  // The logout just recorded, while the box after it is open: `{ logoutAt, day }`.
  const [loggedOut, setLoggedOut] = useState(null);
  const [breakSummary, setBreakSummary] = useState(null);
  // The asks raised from here: a Correction for a day left open, and on-duty or outside attendance
  // from the login.
  const [correction, setCorrection] = useState(null);
  // The day a "Log out late" is being sent for - the logout raises its own Extra Time request.
  const [lateLogout, setLateLogout] = useState(null);
  const [quickAction, setQuickAction] = useState("");
  // The capture an on-duty ask was raised from (Login), so closing the ask without raising it goes
  // back to that capture rather than out of the login altogether. Null when it was not.
  const [quickActionFrom, setQuickActionFrom] = useState(null);
  const [requestBusy, setRequestBusy] = useState(false);
  const [settings, setSettings] = useState(null);
  const [joiningDate, setJoiningDate] = useState("");
  const { notice, showNotice, showError, clearNotice } = useNotice();

  const onError = useCallback((message) => showError(message), [showError]);
  const onNotice = useCallback((message) => showNotice(message, "success"), [showNotice]);

  /*
   * Sends one capture. A refusal is thrown back to the dialog, which stays open and says it there
   * for a retake - not in a notice behind it.
   */
  async function submitCapture(evidence) {
    if (captureBusy) return;
    setCaptureBusy(true);
    try {
      if (capture === "CHECK_IN") {
        const response = await markAttendanceLogin(evidence);
        setCapture(null);
        setCheckedIn({ loginAt: response?.data?.loginAt, location: response?.data?.location || null, relogin: Boolean(response?.data?.relogin) });
      } else if (capture === "CHECK_OUT") {
        const response = await markAttendanceLogout(evidence);
        setCapture(null);
        setLoggedOut({ logoutAt: response?.data?.logoutAt, day: response?.data?.day || null });
        // A late logout says where its extra time went - the server's own words, which name whether
        // it reached an approver at all.
        if (response?.data?.extraTime && response?.message) onNotice(response.message);
      } else if (capture === "BREAK_START") {
        const response = await startAttendanceBreak(evidence);
        setCapture(null);
        setToday((current) => (current ? { ...current, breaks: response?.data || current.breaks } : current));
        onNotice(`Break started at ${breakTime(response?.data?.current?.startedAt)}. Press Break Off when you are back.`);
      } else {
        const response = await endAttendanceBreak(evidence);
        setCapture(null);
        setBreakSummary(response?.data || null);
        setToday((current) => (current ? { ...current, breaks: response?.data?.today || current.breaks } : current));
      }
    } finally {
      setCaptureBusy(false);
      loadTodayForDashboard();
      // The dashboard's figures count the day and its breaks.
      setDashboardRefresh((value) => value + 1);
    }
  }

  /**
   * A Correction, raised on the Raise Request form: a refusal is thrown back to the form, which says
   * it there, rather than in a notice behind a full-screen panel.
   */
  async function raiseIncorrectLogin(payload) {
    if (requestBusy) return;
    setRequestBusy(true);
    try {
      await createAttendanceRequest(payload);
      setCorrection(null);
      onNotice("Request raised. Your approvers can now see it.");
      loadTodayForDashboard();
    } finally {
      setRequestBusy(false);
    }
  }

  /** An on-duty or an outside-attendance ask. Refused, it is said as a notice. */
  async function raiseRequest(payload) {
    if (requestBusy) return;
    setRequestBusy(true);
    try {
      await createAttendanceRequest(payload);
      setQuickAction("");
      // Raised: the ask replaced the login, so there is nothing to go back to.
      setQuickActionFrom(null);
      onNotice("Request raised. Your approvers can now see it.");
      loadTodayForDashboard();
    } catch (error) {
      onError(errorMessage(error, "Unable to raise this request."));
    } finally {
      setRequestBusy(false);
    }
  }

  const loadSettings = useCallback(() => getAttendanceSettings()
    .then((response) => setSettings(response?.data || null))
    .catch((error) => onError(errorMessage(error, "Unable to load the attendance settings."))), [onError]);

  useEffect(() => {
    loadSettings();
    let cancelled = false;
    // Only for the "Maximum" range option, which starts at the day this person joined. A profile
    // that will not load is not worth an error here — the range simply falls back to its own cap.
    getMyProfile()
      .then((response) => { if (!cancelled) setJoiningDate(response?.data?.employment?.dateOfJoining || ""); })
      .catch(() => { if (!cancelled) setJoiningDate(""); });
    return () => { cancelled = true; };
  }, [loadSettings]);

  const sectionSwitch = <DropdownMenu ariaLabel="Employee attendance section" items={sections} value={shownSection} onChange={setSection} sorted={false} />;

  // The Request screen whole, under this page's heading and switch - its own tabs, buttons and
  // dialogs, which are the ones HRM → Request always had. The register and the events likewise.
  if (shownSection === SECTION_REQUEST) {
    return <AttendanceRequestsPage title="Attendance" leadingAccessory={sectionSwitch} />;
  }
  if (shownSection === SECTION_REGISTER) {
    // The Request card's Open goes to Leave or Comp-Off Request, which opens on "Waiting for me".
    return <AttendanceRegisterPage title="Attendance" leadingAccessory={sectionSwitch} onOpenRequests={() => setSection(SECTION_REQUEST)} />;
  }
  if (shownSection === SECTION_EVENTS) {
    return <EventsPage title="Attendance" leadingAccessory={sectionSwitch} />;
  }
  // READ sees your own past submissions; READ_WRITE also lets you raise a new one - gated
  // separately inside `SpeakUpPanel` on `canWrite` (Rule 4: a control the viewer may not use is
  // absent, not disabled).
  if (shownSection === SECTION_SPEAK_UP) {
    return <section className="flex h-full min-h-0 w-full min-w-0 flex-col">
      <ModulePageHeader title="Attendance" titleAccessory={<div className="min-w-0 sm:border-l sm:border-slate-200 sm:pl-3">{sectionSwitch}</div>} />
      <SpeakUpPanel onNotice={onNotice} onError={onError} canWrite={hasPermission("HRM", "Speak-up", "READ_WRITE")} />
      <FloatingNotice notice={notice} onClose={clearNotice} />
    </section>;
  }
  // Confidential to HR: `HRM / Speak-up Review` is its own permission, never widened by holding
  // Speak-up (submit) itself.
  if (shownSection === SECTION_SPEAK_UP_REVIEW) {
    return <section className="flex h-full min-h-0 w-full min-w-0 flex-col">
      <ModulePageHeader title="Attendance" titleAccessory={<div className="min-w-0 sm:border-l sm:border-slate-200 sm:pl-3">{sectionSwitch}</div>} />
      <SpeakUpReviewPanel onError={onError} onNotice={onNotice} canDecide={hasPermission("HRM", "Speak-up Review", "READ_WRITE")} />
      <FloatingNotice notice={notice} onClose={clearNotice} />
    </section>;
  }

  return <section className="flex h-full min-h-0 w-full min-w-0 flex-col">
    <ModulePageHeader
      title="Attendance"
      // The divider only where the switch sits beside the title; on a phone it wraps under it, and
      // a rule down its left side there is a line beside nothing.
      titleAccessory={<div className="min-w-0 sm:border-l sm:border-slate-200 sm:pl-3">
        {sectionSwitch}
      </div>}
      // In the header, where every module keeps its primary button (Raise Request, Send, Upload
      // Event): Break In / Break Off and Login / Logout, each opening its capture.
      stretchActionsOnPhone
      // Ticking rows in the Login Summary adds its own buttons beside these rather than replacing
      // them: nobody should have to clear a selection to log out or end a break.
      ownsSelectionActions
      actions={showDayButtons ? <>
        <BreakButton today={today} busy={captureBusy} onStart={() => setCapture("BREAK_START")} onEnd={() => setCapture("BREAK_END")} />
        <DashboardLoginButton today={today} loaded={todayLoaded} unavailable={unlinked} onLogin={() => setCapture("CHECK_IN")} onLogout={() => setCapture("CHECK_OUT")} />
      </> : null}
    />
    {/*
      * An administrator reads the studio's attendance here; everybody else reads their own. Held
      * back while the permissions load rather than showing one and replacing it with the other -
      * which would also have asked the server for an administrator's own summary, a range they
      * never marked a day in.
      */}
    {permissionsLoading
      ? <div className="dashboard-canvas flex min-h-0 flex-1 items-center justify-center"><Loader label="Loading dashboard..." /></div>
      : showAdminDashboard
        ? <AdminAttendanceDashboard onError={onError} />
        : <SelfDashboardPanel
          joiningDate={joiningDate}
          refreshToken={dashboardRefresh}
          onError={onError}
          today={today}
          onRequestCorrection={setCorrection}
          onLogOutLate={setLateLogout}
          onRequestOutside={() => setQuickAction("OUTSIDE_LOCATION")}
          // The day the pay cycle turns over, which the dashboard counts by; `payCycleRange` falls
          // back to the studio's own default while the settings are still loading.
          payCycleDay={settings?.payCycleDay}
          // Off for everybody for now (`SHOW_ATTENDANCE_LOGS`); when it is on, hidden until the settings
          // say otherwise, so the logs never flash up for somebody not shown them.
          showLogs={SHOW_ATTENDANCE_LOGS && Boolean(settings?.canSeeLogs)}
        />}
    {capture && <AttendanceCaptureDialog
      key={capture}
      step={capture}
      busy={captureBusy}
      attendanceOptional={Boolean(today?.attendanceOptional)}
      flexibleShiftAllowed={Boolean(today?.flexibleShiftAllowed)}
      // Set when this login re-opens a day already logged out of, which keeps that day's work mode.
      dayWorkMode={capture === "CHECK_IN" && today?.session?.logoutAt ? today.session.workMode || "office" : null}
      onClose={() => setCapture(null)}
      onSubmit={submitCapture}
      onRaise={(action) => { setQuickActionFrom(capture); setCapture(null); setQuickAction(action); }}
    />}
    {checkedIn && <CheckedInDialog
      checkedIn={checkedIn}
      employeeName={today?.employee?.name || ""}
      onClose={() => setCheckedIn(null)}
      onRequestOutside={() => { setCheckedIn(null); setQuickAction("OUTSIDE_LOCATION"); }}
    />}
    {loggedOut && <LoggedOutDialog loggedOut={loggedOut} employeeName={today?.employee?.name || ""} onClose={() => setLoggedOut(null)} />}
    {breakSummary && <BreakSummaryDialog summary={breakSummary} onClose={() => setBreakSummary(null)} />}
    {/* The banner's day, on the one Raise Request form - Correction chosen and the day filled in. */}
    {lateLogout && <ExtraTimeDialog
      day={lateLogout}
      dayLabel={formatDayLabel(lateLogout.date)}
      loginLabel={formatTimestamp(lateLogout.loginAt)}
      onClose={() => setLateLogout(null)}
      onError={onError}
      onSent={(message) => {
        onNotice(message);
        // The day stays Absent until it is approved, but the banner has been answered and goes.
        loadTodayForDashboard();
        setDashboardRefresh((value) => value + 1);
      }}
    />}
    {correction && <AttendanceRequestFormPanel
      initialType="INCORRECT_LOGIN"
      prefill={{ type: "INCORRECT_LOGIN", fromDate: correction.date, toDate: correction.date }}
      settings={settings}
      busy={requestBusy}
      onClose={() => setCorrection(null)}
      onSubmit={raiseIncorrectLogin}
    />}
    {quickAction && <AttendanceRequestDialog action={quickAction} settings={settings} busy={requestBusy} onClose={() => {
      // Closed without raising it: back to the login it was opened from, if it was.
      setQuickAction("");
      if (quickActionFrom) setCapture(quickActionFrom);
      setQuickActionFrom(null);
    }} onSubmit={raiseRequest} />}
    <FloatingNotice notice={notice} onClose={clearNotice} />
  </section>;
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
/**
 * After a logout, the box the login has: who, and when. Then what the day was marked as - Absent or a
 * Half day (or an Early exit) said plainly, by the server's reading of the day it closed; otherwise,
 * an approved permission's early departure included, the logout was simply successful.
 */
function LoggedOutDialog({ loggedOut, employeeName, onClose }) {
  const outcome = logoutOutcome(loggedOut.day?.status);
  return <Dialog
    title="You're logged out"
    size="sm"
    onClose={onClose}
    footer={<Button type="button" variant="primary" onClick={onClose}>Done</Button>}
  >
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <span className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-2xl font-semibold ${outcome ? outcome.className : "bg-emerald-50 text-emerald-700"}`} aria-hidden="true">{outcome ? "!" : <>&#10003;</>}</span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-950">{employeeName || "Attendance recorded"}</p>
          <p className="mt-0.5 text-sm text-slate-600">Logged out at {formatTimestamp(loggedOut.logoutAt)}</p>
        </div>
      </div>
      {/* What the day was marked as. "Successfully logged out" only when the server said the day is
          fine to leave - with no reading at all, nothing is claimed beyond the time above. */}
      {outcome
        ? <p role="alert" className={`rounded-md px-3 py-2 text-sm font-medium ${outcome.className}`}>{outcome.after}</p>
        : loggedOut.day?.status && <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800">Successfully logged out. Your day is recorded.</p>}
    </div>
  </Dialog>;
}

function CheckedInDialog({ checkedIn, employeeName, onClose, onRequestOutside }) {
  const outside = checkedIn.location && checkedIn.location.verified === false;
  // A distance actually measured. `Number(null)` is 0, which read as "0 m from your branch office"
  // for a login that could not be measured at all.
  const measured = checkedIn.location?.distanceMeters != null && Number.isFinite(Number(checkedIn.location.distanceMeters));

  return <Dialog
    title={checkedIn.relogin ? "You're logged in again" : "You're checked in"}
    size="sm"
    onClose={onClose}
    footer={<Button type="button" variant="primary" onClick={onClose}>Done</Button>}
  >
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-2xl font-semibold text-emerald-700" aria-hidden="true">&#10003;</span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-950">{employeeName || "Attendance recorded"}</p>
          <p className="mt-0.5 text-sm text-slate-600">{checkedIn.relogin ? "Logged in again at" : "Checked in at"} {formatTimestamp(checkedIn.loginAt)}</p>
        </div>
      </div>

      {/*
        * Said here rather than left to the register, because a login measured outside the office is
        * something the person can still do something about this morning. Only when it was actually
        * measured: with no office point recorded there is nothing to be outside of.
        */}
      {outside && measured && <p className="rounded-md bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
        You are about {formatDistance(checkedIn.location.distanceMeters)} from your branch office, so the day is recorded and HR will see it flagged.
      </p>}

      {/*
        * The ask that turns a flagged day into one an approver has looked at, offered where the flag
        * is raised. Only for a login measured and found outside - not for one that could not be
        * measured at all (no office recorded), which every login is until offices are set.
        */}
      {outside && measured && onRequestOutside && <Button type="button" onClick={onRequestOutside} className="self-start">Request outside attendance</Button>}

      <p className="text-xs text-slate-500">Have a good day. Remember to check out before you leave.</p>
    </div>
  </Dialog>;
}
