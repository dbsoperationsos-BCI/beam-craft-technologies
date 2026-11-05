"use client";

import Dropdown from "@/components/shared/Dropdown";
import useStickyTab from "@/components/shared/useStickyTab";

/**
 * Accounts Manager: whether the cash entries are read **one row per project** or one row per entry.
 *
 * The grouping itself is `lib/cashEntryGroups.mjs` and has always been there - it was simply always
 * on, on All, Received and Spent. That is the right view for reading what a project has taken and
 * spent, and the wrong one for the question the page is opened with most often, which is "what came
 * in today": a project row sits where its *first* entry would, so this morning's receipt was
 * somewhere down the page under a wedding from August.
 *
 * So it is a choice, and **Ungrouped is the default** - each entry on its own line, latest first, as
 * the server already orders them (`entryDate desc, createdAt desc`). Remembered per reader, the way
 * the Table / Board switch beside it is, so somebody who works grouped keeps it.
 *
 * Only on the tabs that have a project behind them. A transfer is the studio's own money moving
 * between its branches and carries no project at all, so there is nothing to group it by and the
 * switch is **absent** there rather than present and doing nothing.
 */

export const GROUPING_OPTIONS = [{ value: "ungrouped", label: "Ungrouped" }, { value: "grouped", label: "Grouped" }];

/** The view a reader opens on: one row per entry, unless they last chose Grouped here. */
export function useCashEntryGrouping(screenKey) {
  return useStickyTab(`${screenKey}-grouping`, "ungrouped", GROUPING_OPTIONS.map((option) => option.value));
}

export default function CashEntryGroupingSwitch({ value, onChange, className = "" }) {
  return <Dropdown
    mode="switch"
    ariaLabel="Group the entries by project, or list them one by one"
    value={value}
    onChange={onChange}
    options={GROUPING_OPTIONS}
    searchable={false}
    sorted={false}
    placeholder="Select"
    // Fixed width, so switching between the two does not shift the controls beside it.
    className={`w-[7.5rem] shrink-0 ${className}`}
  />;
}
