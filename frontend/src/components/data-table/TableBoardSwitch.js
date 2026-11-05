"use client";

import Dropdown from "@/components/shared/Dropdown";
import useStickyTab from "@/components/shared/useStickyTab";

/**
 * Table or Board - how a screen's rows are shown - as the same small dropdown the CRM has always
 * used for it, remembered per screen so a reload keeps the one the reader picked.
 *
 *   const [layout, setLayout] = useTableBoardLayout("hrm-tasks");
 *   <TableBoardSwitch value={layout} onChange={setLayout} />
 *   {layout === "board" ? <KanbanBoard ... /> : <DataTable ... />}
 */

export const LAYOUT_OPTIONS = [{ value: "table", label: "Table" }, { value: "board", label: "Board" }];

/** The layout a screen opens on: the table, unless this reader last picked the board here. */
export function useTableBoardLayout(screenKey) {
  return useStickyTab(`${screenKey}-layout`, "table", LAYOUT_OPTIONS.map((option) => option.value));
}

export default function TableBoardSwitch({ value, onChange, className = "" }) {
  return <Dropdown
    mode="switch"
    ariaLabel="How the rows are shown"
    value={value}
    onChange={onChange}
    options={LAYOUT_OPTIONS}
    searchable={false}
    sorted={false}
    placeholder="Select"
    // Fixed width, so switching between the two does not shift the header beside it.
    className={`w-[6.5rem] shrink-0 ${className}`}
  />;
}
