"use client";

import { useCallback, useEffect, useState } from "react";
import DashboardCard, { CardState } from "@/components/shared/DashboardCard";
import Button from "@/components/shared/Button";
import StatTile from "@/components/shared/StatTile";
import { dayLabel, isoDate, workedDaysLabel } from "@/lib/attendanceTime.mjs";
import { getMyCompOffOptions, getMyLeaveBalance, getMyPermissionUsage } from "@/services/hrm/attendance.service";

/*
 * What somebody has left to take, on their own Attendance → Dashboard: their **Casual Leave** balance,
 * the **permissions** left in this month (or pay cycle) under Attendance Rules' limit, and the
 * **comp-offs** they can still claim, each with the last day it can be taken.
 *
 * Read from the same answers the Raise Request form reads (`leave-balance`, `permission-usage`,
 * `comp-off-options`), so the dashboard and the form never disagree. On a phone and a tablet: Casual
 * Leave and Permissions side by side, comp-offs on the row below; on a laptop and up, the three in one row.
 */

// Shown before "+N more": a long list would make the card taller than the figures it sits beside.
const COMP_OFFS_SHOWN = 3;
// A comp-off this close to its Use by date says how close, in words.
const SOON_DAYS = 7;

const days = (value) => {
  const number = Math.round((Number(value) || 0) * 100) / 100;
  return `${number} ${number === 1 ? "day" : "days"}`;
};
const daysUntil = (iso, today) => Math.round((new Date(`${iso}T00:00:00Z`) - new Date(`${today}T00:00:00Z`)) / 86400000);
const NEUTRAL = "text-slate-600";

/**
 * The odd half day, in the same words the Raise Request picker uses - it leads with what the person
 * **has** and says what completes it, because half a day granted must not read as half a day lost.
 */
const halfWaiting = (pendingHalf) => `You have half a day from ${dayLabel(pendingHalf.date)}. Another half day completes it.`;

export default function AttendanceBalancesCard() {
  const [state, setState] = useState({ loading: true, allFailed: false, failed: {}, leave: null, permission: null, compOffs: [], pendingHalf: null });
  const [reloadToken, setReloadToken] = useState(0);
  const retry = useCallback(() => {
    setState((current) => ({ ...current, loading: true, allFailed: false }));
    setReloadToken((token) => token + 1);
  }, []);

  useEffect(() => {
    let live = true;
    // Each read on its own: one that fails leaves the other two shown, its tile saying so.
    Promise.allSettled([getMyLeaveBalance(), getMyPermissionUsage({ date: isoDate(new Date()) }), getMyCompOffOptions()])
      .then(([leave, permission, compOffs]) => {
        if (!live) return;
        const failed = { leave: leave.status === "rejected", permission: permission.status === "rejected", compOffs: compOffs.status === "rejected" };
        setState({
          loading: false,
          allFailed: failed.leave && failed.permission && failed.compOffs,
          failed,
          leave: failed.leave ? null : leave.value?.data || null,
          permission: failed.permission ? null : permission.value?.data || null,
          compOffs: failed.compOffs ? [] : compOffs.value?.data?.options || [],
          // The odd half day with nothing to pair with: counted nowhere, but said, so half a day
          // granted does not read as nothing granted.
          pendingHalf: failed.compOffs ? null : compOffs.value?.data?.pendingHalf || null,
        });
      });
    return () => { live = false; };
  }, [reloadToken]);

  const { leave, permission, compOffs, pendingHalf, failed } = state;
  const today = isoDate(new Date());
  // Soonest to lapse first, the ones that never expire last.
  const claimable = [...compOffs].sort((a, b) => (a.expiresOn || "9999").localeCompare(b.expiresOn || "9999"));
  const limited = Number(permission?.limit) > 0;
  const permissionsLeft = limited ? Math.max(0, permission.limit - permission.used) : 0;
  // One tile that could not be read says so, with its own way to try again.
  const unread = <p role="alert">Couldn&apos;t load. <Button type="button" size="sm" variant="secondary" className="ml-1" onClick={retry}>Try again</Button></p>;

  return <DashboardCard title="Available to take">
    <CardState loading={state.loading} error={state.allFailed ? "Couldn't load your balances." : ""} onRetry={retry} rows={2}>
      <div className="grid grid-cols-2 items-start gap-2 lg:grid-cols-3">
        <StatTile label="Casual Leave" value={failed.leave ? "Unavailable" : leave?.enabled ? days(leave.balance) : "Not set"} tone={leave?.enabled ? "text-blue-700" : NEUTRAL}>
          {failed.leave ? unread : leave?.enabled
            ? [
              Number(leave.pendingDays) > 0 ? `${days(leave.pendingDays)} pending approval` : "",
              Number(leave.perMonth) > 0 ? `${days(leave.perMonth)} added each month` : "",
            ].filter(Boolean).join(" · ") || null
            : "The studio has not set Casual Leave."}
        </StatTile>
        <StatTile label="Permissions left" value={failed.permission ? "Unavailable" : limited ? String(permissionsLeft) : "No limit"} tone={limited ? (permissionsLeft ? "text-emerald-700" : "text-amber-700") : NEUTRAL}>
          {failed.permission ? unread : limited
            ? `${permissionsLeft ? "" : "None left - "}${permission.used} of ${permission.limit} used in ${permission.label}`
            : "The studio sets no limit."}
        </StatTile>
        <StatTile
          className="col-span-2 lg:col-span-1"
          label="Comp-offs to claim"
          value={failed.compOffs ? "Unavailable" : claimable.length ? String(claimable.length) : "None"}
          tone={claimable.length ? "text-emerald-700" : NEUTRAL}
        >
          {failed.compOffs ? unread : claimable.length
            ? <ul className="space-y-0.5">
              {claimable.slice(0, COMP_OFFS_SHOWN).map((option) => {
                const left = option.expiresOn ? daysUntil(option.expiresOn, today) : null;
                const soon = left !== null && left <= SOON_DAYS;
                // The days this one day off cost: two where its approvers granted half a day each,
                // so a day off bought with two days never reads here as though it cost one.
                const worked = option.days.map((day) => day.date);
                return <li key={worked.join("+")} className="flex flex-wrap justify-between gap-x-2">
                  {/* Say they are halves: "Worked 1 Nov and 2 Nov" alone reads as two days off. */}
                  <span>Worked {workedDaysLabel(worked)}{worked.length > 1 ? " (half a day each)" : ""}</span>
                  <span className={soon ? "font-medium text-amber-700" : ""}>
                    {option.expiresOn ? `Use by ${dayLabel(option.expiresOn)}${soon ? ` (${left === 0 ? "today" : `in ${days(left)}`})` : ""}` : "No expiry"}
                  </span>
                </li>;
              })}
              {claimable.length > COMP_OFFS_SHOWN && <li>+{claimable.length - COMP_OFFS_SHOWN} more - see them when you raise a comp-off.</li>}
              {pendingHalf && <li>{halfWaiting(pendingHalf)}</li>}
            </ul>
            : pendingHalf ? halfWaiting(pendingHalf)
            : "Work a full day on a weekly off or holiday to earn one."}
        </StatTile>
      </div>
    </CardState>
  </DashboardCard>;
}
