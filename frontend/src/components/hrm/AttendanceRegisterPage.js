"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import DataTable from "@/components/data-table/DataTable";
import useTableSelection from "@/components/data-table/useTableSelection";
import DataTableShell from "@/components/data-table/DataTableShell";
import TableFooter from "@/components/data-table/TableFooter";
import ModulePageHeader from "@/components/layout/ModulePageHeader";
import Button from "@/components/shared/Button";
import DateField from "@/components/shared/DateField";
import Dropdown from "@/components/shared/Dropdown";
import TextField from "@/components/shared/TextField";
import FloatingNotice, { useNotice } from "@/components/shared/FloatingNotice";
import useBranchRegistry from "@/components/shared/useBranchRegistry";
import Dialog from "@/components/ui/Dialog";
import { branchLabel } from "@/lib/branchName";
import { getMasterData } from "@/services/hrm/master-data.service";
import {
  attendanceSelfieUrl,
  getAttendanceDay,
  getAttendanceRegister,
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
 */

const STATUS_TONES = {
  "On time": "bg-emerald-50 text-emerald-700",
  Late: "bg-amber-50 text-amber-800",
  "Half day": "bg-amber-50 text-amber-800",
  "Early exit": "bg-amber-50 text-amber-800",
  Permitted: "bg-blue-50 text-blue-700",
  "On leave": "bg-blue-50 text-blue-700",
  Absent: "bg-red-50 text-red-700",
  "Not logged out": "bg-amber-50 text-amber-800",
  "Missed checkout": "bg-red-50 text-red-700",
  Holiday: "bg-slate-100 text-slate-700",
  "Weekly off": "bg-slate-100 text-slate-700",
};

const STATUS_OPTIONS = ["On time", "Late", "Half day", "Early exit", "Permitted", "Not logged out", "Missed checkout", "Absent", "On leave", "Holiday", "Weekly off"];

const isoDate = (date) => {
  const local = new Date(date);
  return `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, "0")}-${String(local.getDate()).padStart(2, "0")}`;
};

const formatClock = (value) => {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: true }).format(date);
};

const formatDistance = (metres) => {
  const value = Number(metres);
  if (!Number.isFinite(value)) return "";
  return value < 1000 ? `${Math.round(value)} m` : `${(value / 1000).toFixed(1)} km`;
};

const errorMessage = (error, fallback) => error?.data?.message || error?.message || fallback;

/** One figure and what it counts. Plain tiles: this row is the summary the page exists to give. */
function SummaryTile({ label, value, tone = "text-slate-950" }) {
  return <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
    <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{label}</p>
    <p className={`mt-1 text-2xl font-semibold tabular-nums ${tone}`}>{value}</p>
  </div>;
}

export default function AttendanceRegisterPage() {
  const { notice, showError, clearNotice } = useNotice();
  const [date, setDate] = useState(() => isoDate(new Date()));
  const [branchId, setBranchId] = useState("");
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [branches, setBranches] = useState([]);
  const [register, setRegister] = useState(null);
  const [loading, setLoading] = useState(true);
  const [openDay, setOpenDay] = useState(null);
  // The branch register announces its own changes; a branch added while this is open should appear
  // in the filter rather than being missing until a reload.
  const branchRegistryRevision = useBranchRegistry();

  useEffect(() => {
    getMasterData("branches").then((response) => setBranches(response?.data || [])).catch(() => setBranches([]));
  }, [branchRegistryRevision]);

  const load = useCallback(() => {
    setLoading(true);
    getAttendanceRegister({ date, branchId, status, search })
      .then((response) => setRegister(response?.data || null))
      .catch((error) => showError(errorMessage(error, "Unable to load the attendance register.")))
      .finally(() => setLoading(false));
  }, [date, branchId, status, search, showError]);

  useEffect(() => { load(); }, [load]);

  const summary = register?.summary || {};
  const rows = register?.rows || [];
  /*
   * The tick boxes, for a role holding `ADMIN / Table Select All`. Export only, no `prefix`: a row
   * of the register is one person's day as it was marked, and a day is corrected through Attendance
   * Approval rather than removed - there is no delete for one anywhere in the module.
   */
  const bulk = useTableSelection({ rows, rowId: (row) => String(row.employeeId), noun: "row" });

  const columns = [
    { id: "employeeName", header: "Employee", accessorKey: "employeeName" },
    { id: "employeeCode", header: "Employee ID", accessorKey: "employeeCode" },
    { id: "branchName", header: "Branch", accessorFn: (row) => branchLabel(row.branchName) || "—" },
    { id: "checkInAt", header: "Check-in", accessorFn: (row) => formatClock(row.checkInAt) },
    { id: "checkOutAt", header: "Check-out", accessorFn: (row) => formatClock(row.checkOutAt) },
    { id: "workedLabel", header: "Total hours", accessorKey: "workedLabel" },
    // Its own column rather than part of the status: a day worked from home still has to be able to
    // say whether it was late, short or full.
    { id: "workModeLabel", header: "Worked from", accessorFn: (row) => row.workModeLabel || "—" },
    {
      id: "location",
      header: "Location",
      // A day with no session has nothing to say about location, which is not the same as a day
      // whose location failed — so it reads as a dash rather than as "not verified".
      accessorFn: (row) => (row.locationVerified === null ? "—"
        : row.locationVerified ? "Verified"
          : `Unverified${row.distanceMeters != null ? ` · ${formatDistance(row.distanceMeters)}` : ""}`),
    },
    {
      id: "status",
      header: "Status",
      accessorKey: "status",
      cell: ({ row }) => <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_TONES[row.original.status] || "bg-slate-100 text-slate-700"}`}>
        {row.original.status}
      </span>,
    },
  ];

  return <>
    <ModulePageHeader title="Attendance Register" />

    <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50 p-3 sm:p-4 lg:p-5">
      <div className="w-full space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
          <SummaryTile label="Employees" value={summary.total ?? "—"} />
          <SummaryTile label="Present" value={summary.present ?? "—"} tone="text-emerald-700" />
          <SummaryTile label="Late" value={summary.late ?? "—"} tone="text-amber-700" />
          <SummaryTile label="Absent" value={summary.absent ?? "—"} tone="text-red-700" />
          <SummaryTile label="On leave" value={summary.onLeave ?? "—"} tone="text-blue-700" />
          <SummaryTile label="Not checked out" value={summary.notCheckedOut ?? "—"} tone="text-amber-700" />
          <SummaryTile label="Outside location" value={summary.outsideLocation ?? "—"} tone="text-red-700" />
        </div>

        <section className="rounded-lg border border-slate-200 bg-white p-4 sm:p-5">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <DateField label="Date" value={date} onChange={(event) => setDate(event.target.value)} />
            <Dropdown
              searchable
              label="Branch"
              placeholder="All branches"
              options={[{ value: "", label: "All branches" }, ...branches.map((branch) => ({ value: String(branch.id), label: branchLabel(branch.name) || branch.name }))]}
              value={branchId}
              onChange={setBranchId}
            />
            <Dropdown
              label="Status"
              sorted={false}
              placeholder="Any status"
              options={[{ value: "", label: "Any status" }, ...STATUS_OPTIONS.map((entry) => ({ value: entry, label: entry }))]}
              value={status}
              onChange={setStatus}
            />
            <TextField label="Search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name, ID or department" />
          </div>
        </section>

        <DataTableShell
          className="rounded-lg border border-slate-200"
          footer={<TableFooter spread>
            <span className="text-xs sm:text-sm">{register?.date ? `Register for ${register.date}` : "—"}</span>
            <span className="shrink-0 text-xs sm:text-sm">Total rows: {rows.length}</span>
          </TableFooter>}
        >
          <DataTable
            columns={columns}
            data={rows}
            loading={loading}
            loadingMessage="Loading the register..."
            emptyMessage="Nobody matches these filters."
            getRowId={(row) => String(row.employeeId)}
            ariaLabel="Attendance register"
            features={{ selection: bulk.selection }}
            // Only a day that was actually marked has captures to show; an absence has nothing
            // behind it to open.
            onRowDoubleClick={(row) => row.sessionId && setOpenDay(row.sessionId)}
          />
        </DataTableShell>
      </div>
    </div>

    {openDay && <AttendanceDayDialog sessionId={openDay} onClose={() => setOpenDay(null)} onError={showError} />}
    <FloatingNotice notice={notice} onClose={clearNotice} />
  </>;
}

/**
 * One person's day, as it was actually captured.
 *
 * The photographs come from the append-only event table rather than from the day's current row, so
 * a day that was corrected still shows what the employee originally submitted alongside the
 * correction that changed it. Each one is fetched from the guarded selfie endpoint — there is no
 * link to storage to hand out.
 */
function AttendanceDayDialog({ sessionId, onClose, onError }) {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    getAttendanceDay(sessionId)
      .then((response) => { if (!cancelled) setDetail(response?.data || null); })
      .catch((error) => { if (!cancelled) onError?.(errorMessage(error, "Unable to load that attendance day.")); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [sessionId, onError]);

  return <Dialog
    title={detail ? `${detail.employee.employeeName} — ${detail.date}` : "Attendance day"}
    size="lg"
    onClose={onClose}
    footer={<Button type="button" onClick={onClose}>Close</Button>}
  >
    {loading ? <p className="text-sm text-slate-500">Loading...</p>
      : !detail ? <p className="text-sm text-slate-500">Nothing on file for that day.</p>
        : <div className="flex flex-col gap-5">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
            {[
              ["Check-in", formatClock(detail.checkInAt)],
              ["Check-out", formatClock(detail.checkOutAt)],
              ["Worked", detail.workedLabel],
              ["Work mode", detail.workMode || "—"],
            ].map(([label, value]) => <div key={label}>
              <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{label}</dt>
              <dd className="mt-0.5 text-sm font-semibold text-slate-950">{value}</dd>
            </div>)}
          </dl>

          <div className="grid gap-4 sm:grid-cols-2">
            {detail.captures.map((capture) => <div key={capture.id} className="rounded-lg border border-slate-200 p-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                {capture.type === "CHECK_IN" ? "Check-in" : capture.type === "CHECK_OUT" ? "Check-out" : "Corrected checkout"}
              </p>
              <p className="mt-1 text-sm font-semibold text-slate-950">{formatClock(capture.capturedAt)}</p>

              {capture.hasSelfie
                ? <Image
                  src={attendanceSelfieUrl(capture.id)}
                  alt={`${capture.type === "CHECK_IN" ? "Check-in" : "Check-out"} selfie`}
                  width={320}
                  height={240}
                  unoptimized
                  className="mt-2 h-40 w-full rounded-md object-cover"
                />
                : <p className="mt-2 rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-500">No photo was captured.</p>}

              <ul className="mt-2 space-y-1 text-xs text-slate-600">
                <li>{capture.faceVerified ? "A face was verified in the photo." : "This browser could not verify a face."}</li>
                {/*
                  * Address first where one was resolved, but never instead of the coordinates: the
                  * numbers are what the distance was measured from, and somebody querying a day
                  * needs those rather than a street name a geocoder picked.
                  */}
                {capture.locationAddress && <li className="font-medium text-slate-700">{capture.locationAddress}</li>}
                <li className={capture.locationAddress ? "tabular-nums text-slate-400" : ""}>
                  {capture.latitude == null ? "No position was reported."
                    : `${capture.latitude.toFixed(5)}, ${capture.longitude.toFixed(5)}${capture.accuracyM != null ? ` · ± ${capture.accuracyM} m` : ""}`}
                </li>
                <li className={capture.locationVerified ? "font-medium text-emerald-700" : "font-medium text-amber-700"}>
                  {capture.locationVerified
                    ? `Inside the allowed location${capture.distanceMeters != null ? ` · ${formatDistance(capture.distanceMeters)} from the office` : ""}`
                    : capture.locationNote || "Location not verified."}
                </li>
                {capture.deviceInfo && <li className="truncate text-slate-400" title={capture.deviceInfo}>{capture.deviceInfo}</li>}
              </ul>
            </div>)}
          </div>

          <div>
            <p className="text-sm font-semibold text-slate-950">Corrections</p>
            {!detail.corrections.length
              ? <p className="mt-1 text-xs text-slate-500">Nothing has been asked about this day.</p>
              : <ul className="mt-2 space-y-2">
                {detail.corrections.map((request) => <li key={request.id} className="rounded-md border border-slate-200 px-3 py-2 text-xs text-slate-600">
                  <span className="font-semibold text-slate-950">{request.displayStatus}</span>
                  {request.toTime ? ` · asked for ${request.toTime}` : ""}
                  {request.reason ? ` · ${request.reason}` : ""}
                </li>)}
              </ul>}
          </div>
        </div>}
  </Dialog>;
}
