"use client";

import Dropdown from "@/components/shared/Dropdown";
import { RANGE_OPTIONS } from "@/lib/dashboardRange.mjs";

/**
 * The top row of every module dashboard's workspace: the one line that says what the page is
 * showing on the left, the range that scopes the period figures on the right. On a phone the two
 * stack and the range stays at the right, above the line that explains it.
 *
 * The shared dropdown in its field mode, not its `switch` mode: a field sizes its menu to the
 * trigger, so the box can hug its content on the tinted canvas. The width lives here rather than
 * on the control, so the box does not resize as the selection changes.
 *
 * `options` is for a dashboard whose figures come in ranges of its own (Photo Selling's last 7 /
 * 30 / 90 days); every other dashboard keeps the shared ones.
 */
export default function DashboardRangeBar({ caption, range, onRangeChange, options = RANGE_OPTIONS }) {
  return <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
    <p className="order-2 min-w-0 text-[11px] text-slate-500 sm:order-1">{caption}</p>
    <div className="order-1 w-32 shrink-0 self-end sm:order-2 sm:self-auto">
      <Dropdown ariaLabel="Date range" className="dashboard-range-picker" mode="input" options={options} value={range} onChange={onRangeChange} sorted={false} />
    </div>
  </div>;
}
