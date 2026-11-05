"use client";

import { useEffect, useState } from "react";
import { getMyPermissionUsage } from "@/services/hrm/attendance.service";

/**
 * How many of their permissions somebody has used in the month - or pay cycle - the chosen date falls
 * in, against Attendance Rules' Permissions limit, said on the Permission form before it is raised:
 * "Permissions in October 2026: 1 of 2 used". At the limit it says so in amber, since the server will
 * refuse another there. Nothing while there is no limit, or until it has been read once.
 * `excludeRequestId` is the request being edited, which is not counted against itself.
 */
export default function PermissionAllowance({ date, excludeRequestId = null }) {
  const [usage, setUsage] = useState(null);

  useEffect(() => {
    let live = true;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "")) return undefined;
    const timer = setTimeout(() => {
      getMyPermissionUsage({ date, excludeRequestId })
        .then((response) => { if (live) setUsage(response?.data || null); })
        // A read that fails keeps the last one.
        .catch(() => {});
    }, 250);
    return () => { live = false; clearTimeout(timer); };
  }, [date, excludeRequestId]);

  const limited = Number(usage?.limit) > 0;
  const full = limited && usage.used >= usage.limit;
  // Always in the page, empty until there is something to say, so a screen reader hears it arrive.
  return <div role="status" aria-live="polite" className={limited ? "" : "contents"}>
    {limited && <p className={`rounded-md border px-3 py-2 text-xs sm:text-sm ${full ? "border-amber-200 bg-amber-50 font-medium text-amber-800" : "border-slate-200 bg-slate-50 text-slate-700"}`}>
      {full
        ? `You have used all ${usage.limit} ${usage.limit === 1 ? "permission" : "permissions"} allowed in ${usage.label}. Choose a day in another period, or apply for leave instead.`
        : <>Permissions in {usage.label}: <span className="font-semibold">{usage.used} of {usage.limit}</span> used</>}
    </p>}
  </div>;
}
