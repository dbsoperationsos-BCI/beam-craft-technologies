import DashboardCard, { CardState } from "@/components/shared/DashboardCard";
import { branchLabel } from "@/lib/branchName";
import { readableDay } from "@/lib/attendanceOverviewRange.mjs";
import { formatTotalMinutes } from "@/lib/attendanceTime.mjs";

/*
 * The administrator's Dashboard, at its foot: who used **Casual Leave**, **permissions** and
 * **comp-offs** over the range and filters applied - one card each, in the same shell and list as By
 * Branch. Read from the overview's `timeOff` (approved requests only), the most first.
 *
 * One card to a row on a phone, two on a tablet, all three in a row on a wide screen. Each row is the
 * person and their figure on one line, their branch and days under it; a long list scrolls inside its
 * card rather than stretching the page.
 */

// Days named under a person before "+N more": the figure says how many, the dates are a reminder.
const DATES_SHOWN = 3;

const plural = (value, one, many) => `${Number(value || 0).toLocaleString("en-IN")} ${Number(value) === 1 ? one : many}`;

const CARDS = [
  {
    key: "casualLeave",
    title: "Casual Leave",
    note: "Approved Casual Leave, in working days",
    empty: "Nobody took Casual Leave in this range.",
    figure: (row) => plural(row.days, "day", "days"),
    tone: "text-blue-700",
  },
  {
    key: "permissions",
    title: "Permissions",
    note: "Approved permissions, and how long in all",
    empty: "Nobody took a permission in this range.",
    figure: (row) => `${plural(row.count, "permission", "permissions")} · ${formatTotalMinutes(row.minutes)}`,
    tone: "text-amber-700",
  },
  {
    key: "compOffs",
    title: "Comp-offs",
    note: "Approved comp-off days off taken",
    empty: "Nobody took a comp-off in this range.",
    figure: (row) => plural(row.days, "day", "days"),
    tone: "text-emerald-700",
  },
];

function datesLine(dates = []) {
  const shown = dates.slice(0, DATES_SHOWN).map(readableDay).join(", ");
  return dates.length > DATES_SHOWN ? `${shown} +${dates.length - DATES_SHOWN} more` : shown;
}

export default function AdminTimeOffCards({ timeOff, loading, error, onRetry }) {
  return <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
    {CARDS.map((card) => {
      const rows = timeOff?.[card.key] || [];
      return <DashboardCard key={card.key} title={card.title} note={card.note} bodyClassName="p-1.5">
        <CardState loading={loading} error={error} onRetry={onRetry} empty={!rows.length} emptyMessage={card.empty} rows={4}>
          <ul aria-label={`${card.title} by employee`} className="max-h-72 divide-y divide-slate-100 overflow-y-auto">
            {rows.map((row) => <li key={row.employeeId} className="px-2 py-1.5">
              {/* On a phone the figure sits under the name, so a long name is not cut to make room. */}
              <div className="flex flex-col gap-x-3 sm:flex-row sm:items-baseline sm:justify-between">
                <p className="min-w-0 truncate text-xs font-medium text-slate-700">
                  {row.employeeName}{row.employeeCode ? <span className="font-normal text-slate-500"> ({row.employeeCode})</span> : null}
                </p>
                <p className={`text-xs font-semibold tabular-nums sm:shrink-0 sm:text-right ${card.tone}`}>{card.figure(row)}</p>
              </div>
              <p className="mt-0.5 text-[11px] text-slate-500">
                {[branchLabel(row.branchName) || row.branchName, datesLine(row.dates)].filter(Boolean).join(" · ")}
              </p>
            </li>)}
          </ul>
        </CardState>
      </DashboardCard>;
    })}
  </div>;
}
