"use client";

import StatusBadge from "@/components/shared/StatusBadge";
import { formatDay } from "@/lib/saleExtras.mjs";
import SaleExtrasItemsTable from "./SaleExtrasItemsTable";

/**
 * One shoot under one of Extras' two headings - Added or Removed (`group`) - drawn as Service Creation
 * draws a shoot: the name on top, then "Shoot ID | date | place", on a blue-bordered card, and under it
 * the table of that shoot's lines in that group, each with its own Amount and Remarks
 * (`SaleExtrasItemsTable`). A shoot that is itself an extra, or was taken off, says so beside its name.
 */
export default function SaleExtrasShootCard({ shoot, group, lines = [], ...tableProps }) {
  const meta = [shoot.shootCode, shoot.date ? formatDay(shoot.date) : "", shoot.place].filter(Boolean).join(" | ");
  return <article aria-label={`${group} - ${shoot.name}`} className="min-w-0 rounded-lg bg-white p-4 shadow-sm ring-1 ring-blue-200">
    <header className="mb-3">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="min-w-0 break-words text-lg font-semibold text-slate-800">{shoot.name}</h4>
        {shoot.status === "ADDED" && <StatusBadge tone="success">Extra Shoot</StatusBadge>}
        {shoot.status === "REMOVED" && <StatusBadge>Removed shoot</StatusBadge>}
        <span className="text-sm text-slate-500">({lines.length})</span>
      </div>
      {Boolean(meta) && <p className="mt-1 break-words text-sm text-slate-500">{meta}</p>}
    </header>
    <SaleExtrasItemsTable title={`${group} - ${shoot.name}`} hideTitle lines={lines} showShoot={false} {...tableProps} />
  </article>;
}
