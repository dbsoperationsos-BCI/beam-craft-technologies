"use client";

import { usePathname, useRouter } from "next/navigation";
import Dropdown from "@/components/shared/Dropdown";
import { useTableBoardLayout } from "@/components/data-table/TableBoardSwitch";

/*
 * Production's three views in one dropdown at the right end of its header: the Table - one row per
 * project, its shoots under ▸ - the Board - the projects under their status - and the Schedule -
 * every shoot by date with who works each service.
 *
 * Table and Board are one page, told apart by the remembered layout (`useTableBoardLayout`, a shared
 * preference, so the page's own copy follows a change made here); the Schedule is its own address
 * under /project-management/production. Both answer to the board's one permission, the sidebar keeps
 * Production lit on either, and a view can be linked to. Choosing Table or Board from the Schedule
 * sets the layout, then goes back to the page that draws it.
 */
const TABLE_PATH = "/project-management/production";
const SCHEDULE_PATH = "/project-management/production/schedule";
const VIEWS = [
  { value: "table", label: "Table" },
  { value: "board", label: "Board" },
  { value: "schedule", label: "Schedule" },
];

export default function ProductionViewSwitch() {
  const pathname = usePathname();
  const router = useRouter();
  const [layout, setLayout] = useTableBoardLayout("production-board");
  const onSchedule = pathname === SCHEDULE_PATH;

  function choose(next) {
    if (next === "schedule") {
      if (!onSchedule) router.push(SCHEDULE_PATH);
      return;
    }
    setLayout(next);
    if (onSchedule) router.push(TABLE_PATH);
  }

  return <Dropdown
    mode="switch"
    ariaLabel="Production view"
    value={onSchedule ? "schedule" : layout}
    onChange={choose}
    options={VIEWS}
    searchable={false}
    sorted={false}
    // Fixed width, so switching views does not shift the header beside it.
    className="w-[7.5rem] shrink-0"
  />;
}
