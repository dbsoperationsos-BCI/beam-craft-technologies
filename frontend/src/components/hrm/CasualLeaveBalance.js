"use client";

import { useEffect, useState } from "react";
import { getMyLeaveBalance } from "@/services/hrm/attendance.service";

/**
 * What a leave over `fromDate`-`toDate` comes to, said under its Leave Type before it is raised:
 *
 * - **Leave days** - its working days only: a weekly off or a holiday the studio declared in the range
 *   is no day of leave, and is named ("Leave days: 2 days - Sun 11 Oct (weekly off) not counted").
 * - **Available CL** - the Casual Leave balance, and the leave already waiting for approval that will
 *   take from it (Settings → Employee → Attendance Rules; nothing while there is no Casual Leave).
 * - For a **Casual Leave**, how many of these days go past the balance and will be Loss of Pay - a
 *   warning, not a refusal; for a **Loss of Pay** leave, that every day of it is unpaid.
 *
 * The server's answer, so the days are counted on the studio's own calendar. Nothing until it has been
 * read once; a read that fails keeps the last. `excludeRequestId` is the request being edited, which is
 * not counted against itself.
 */
const number = (value) => Number(value).toLocaleString("en-IN", { maximumFractionDigits: 1 });
const days = (value) => `${number(value)} ${Number(value) === 1 ? "day" : "days"}`;
const shortDay = new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const dayName = (iso) => shortDay.format(new Date(`${iso}T00:00:00Z`));

/** "2 of these 4 days are ...", "This day is ...", "Half of this day is ..." - what the Loss of Pay covers. */
function lossOfPaySentence(lossOfPay, asked) {
  const tail = "beyond your balance and will be Loss of Pay (deducted from your pay).";
  if (asked === 1) return lossOfPay >= 1 ? `This day is ${tail}` : `Half of this day is ${tail}`;
  if (lossOfPay >= asked) return `All ${number(asked)} days are ${tail}`;
  return `${number(lossOfPay)} of these ${number(asked)} days ${lossOfPay === 1 ? "is" : "are"} ${tail}`;
}

export default function CasualLeaveBalance({ fromDate, toDate, leaveType = "", excludeRequestId = null }) {
  const [reading, setReading] = useState(null);

  useEffect(() => {
    let live = true;
    // Dates still being chosen are not asked about.
    const ready = /^\d{4}-\d{2}-\d{2}$/.test(fromDate || "") && /^\d{4}-\d{2}-\d{2}$/.test(toDate || "") && toDate >= fromDate;
    const timer = setTimeout(() => {
      getMyLeaveBalance(ready ? { from: fromDate, to: toDate, excludeRequestId } : { excludeRequestId })
        .then((response) => { if (live) setReading(response?.data || null); })
        // A read that fails keeps the last one, so a Loss of Pay warning does not vanish on a blip.
        .catch(() => {});
    }, 250);
    return () => { live = false; clearTimeout(timer); };
  }, [excludeRequestId, fromDate, toDate]);

  const preview = reading?.preview || null;
  const skipped = preview?.skipped || [];
  const lossOfPay = Number(preview?.lossOfPayDays) || 0;
  const said = Boolean(preview || reading?.enabled || leaveType === "LOP");
  // Always in the page, empty until there is something to say, so a screen reader hears it arrive.
  return <div role="status" aria-live="polite" className={said ? "space-y-1.5" : "contents"}>
    {preview && <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700 sm:text-sm">
      Leave days: <span className="font-semibold">{days(preview.days)}</span>
      {skipped.length > 0 && <> - {skipped.map((day) => `${dayName(day.date)} (${day.reason === "Weekly off" ? "weekly off" : day.reason})`).join(", ")} not counted</>}
    </p>}
    {reading?.enabled && <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700 sm:text-sm">
      Available CL: <span className="font-semibold">{days(reading.balance)}</span>
      {reading.pendingDays > 0 && <> · {days(reading.pendingDays)} of leave waiting for approval will also take from it</>}
    </p>}
    {leaveType === "CL" && lossOfPay > 0 && <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800 sm:text-sm">
      {lossOfPaySentence(lossOfPay, Number(preview.days) || 0)}
    </p>}
    {leaveType === "LOP" && <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800 sm:text-sm">
      Loss of Pay: every day of this leave is unpaid, and your Casual Leave balance is not used.
    </p>}
  </div>;
}
