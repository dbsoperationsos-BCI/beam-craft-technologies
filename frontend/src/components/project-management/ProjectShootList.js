"use client";

import { useMemo } from "react";
import DataTable from "@/components/data-table/DataTable";
import { shootDisplayName } from "@/lib/shootDisplay.mjs";
import { NAME_COLUMN_MAX_WIDTH } from "@/components/data-table/tableLayout";
import OptionsMenu from "@/components/ui/OptionsMenu";
import { rowReorderColumn } from "@/components/data-table/rowReorderColumn";
import { moveInList } from "@/lib/sidebarLayout.mjs";
import { formatSessionTiming, shootTypesOf } from "./AddShootDialog";
import HelpTip from "@/components/shared/HelpTip";
import { detailHelpFor } from "@/constants/detailHelp";

/** What each line of a shoot's card means, for somebody new to it - the ⓘ beside its label. */
const SHOOT_CARD_HELP = {
  shootPlace: detailHelpFor("Shoot", "shootPlace"),
  shootType: detailHelpFor("Shoot", "shootType"),
  district: detailHelpFor("Shoot", "district"),
  state: detailHelpFor("Shoot", "state"),
  foodTakenCareBy: detailHelpFor("Shoot", "foodTakenCareBy"),
  accommodation: detailHelpFor("Shoot", "accommodationPaidBy"),
  travel: detailHelpFor("Shoot", "travelPaidBy"),
  preference: "Weddings only: whose side the crew follows - the groom, the bride or both.",
};

const formatDate = (value) => {
  // `new Date(null)` is the epoch rather than an invalid date, so an unscheduled shoot would
  // otherwise read as 1 Jan 1970. Asked first, before anything tries to parse it.
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(date);
};

// Duplicate is offered only where the screen says it can make one - see `onRequestDuplicate`.
// `onMove` is the phone cards' way to reorder - they have no grip to drag - and only they pass it.
function ShootActions({ shoot, index, count = 0, onEdit, onDuplicate, onDelete, onMove }) {
  return <div className="flex justify-center"><OptionsMenu ariaLabel={`Actions for ${shoot.shoot || "shoot"}`} items={[
    { label: "Edit", onSelect: () => onEdit(shoot, index) },
    ...(onDuplicate ? [{ label: "Duplicate", onSelect: () => onDuplicate(shoot, index) }] : []),
    ...(onMove && count > 1 ? [
      { label: "Move up", disabled: index <= 0, onSelect: () => onMove(index, index - 1) },
      { label: "Move down", disabled: index >= count - 1, onSelect: () => onMove(index, index + 1) },
    ] : []),
    { label: "Delete", tone: "danger", onSelect: () => onDelete(shoot, index) },
  ]} menuZIndexClassName="z-[140]" /></div>;
}

const shootKey = (shoot, index) => shoot.id || shoot.clientKey || `${shoot.shoot}-${index}`;

/*
 * `readOnly` is the list with nothing to press: no actions column, the same rows.
 *
 * Create Project uses it for the shoots a quotation was priced on. Those are what the client agreed
 * to pay for, so the project is planned against them rather than around them - and a row that can
 * be retyped on the way in is a project that quietly stops matching the quotation it was sold on.
 *
 * Nothing is edited in the row itself. Edit hands the shoot to `onRequestEdit`, and the caller opens
 * `AddShootDialog` on it - the same dialog that added it, so a shoot is changed through the same
 * fields, checks and Main Event question on every screen.
 *
 * `onRequestDuplicate`, where the caller passes one, adds Duplicate between Edit and Delete. The
 * caller makes the copy - its own ids, its own place in its own list - so a screen without one
 * simply offers no Duplicate.
 */
/*
 * `onReorder(keys)`, where given, lets the shoots be put in the order the person wants: a grip at
 * the front of each table row (`rowReorderColumn`, the same as the quotation's service lines), and
 * Move up / Move down in each phone card's ⋮. `keys` is every shoot's key in its new order. The
 * Quotation Generator passes it, and so does every form editing a project's shoots - Bookings &
 * Converted, Create / Edit / Start Project (`useProjectPlan`, `lib/shootOrder.mjs`); a screen passing
 * nothing shows neither.
 */
export default function ProjectShootList({ shoots, loading = false, onRequestEdit, onRequestDuplicate, onRequestDelete, onReorder, showShootId = true, readOnly = false }) {
  const reorderable = Boolean(onReorder) && !readOnly;
  const moveShoot = (from, to) => {
    const keys = shoots.map(shootKey);
    const next = moveInList(keys, from, to);
    if (next !== keys) onReorder(next);
  };
  const columns = useMemo(() => [
    ...(reorderable ? [rowReorderColumn({
      listOf: () => ({ key: "shoots", ids: shoots.map(shootKey) }),
      onReorder: (_key, keys) => onReorder(keys),
      labelOf: (shoot) => shoot.shoot || "shoot",
      idOf: shootKey,
    })] : []),
    ...(showShootId ? [{ id: "shootId", header: "Shoot ID", accessorFn: (shoot) => shoot.shootId || "Pending", sortable: false, filterable: false, width: 120, cell: ({ row }) => row.original.shootId || "Pending" }] : []),
    { id: "dateCreated", header: "Date", accessorFn: (shoot) => formatDate(shoot.dateCreated), sortable: false, filterable: false, width: 140, cell: ({ row }) => formatDate(row.original.dateCreated) },
    /*
     * Capped as well as sized. `width` is only a hint on a table that lays its columns out by their
     * contents - the column still grew to fit the longest value - so a shoot named for several at
     * once ("Haldi + Mehandi + Reception") stretched this list wherever it is shown, Create Project
     * included. `maxWidth` is what holds it; the cell then clips with "..." and says itself in full
     * through `title`.
     */
    /*
     * The shoot, with the Additional Text added in Add Shoot in brackets - "Rituals (Bride
     * Varatham)" - through the same `shootDisplayName` the shoot cards above this table and the
     * client's own quotation use. One rule for how a shoot is named, so the list and the card a row
     * opens cannot read differently.
     *
     * **Nothing to gate it on, and nothing to hide on a project.** Additional Text is the quotation
     * generator's own field (`allowCustomText`), kept in the quotation's payload, and it is left
     * behind when a quotation becomes a project: `quotationProjectPlan.SHOOT_FIELDS` does not carry
     * it and `project_shoot` has no column for it. So on Booking & Converted and every project
     * screen a shoot has no `customText` and this reads exactly as it did - the bare name.
     */
    { id: "shoot", header: "Shoot", accessorFn: (shoot) => shootDisplayName(shoot, "—"), sortable: false, filterable: false, width: 180, maxWidth: NAME_COLUMN_MAX_WIDTH, title: (shoot) => shootDisplayName(shoot, "—"), cell: ({ row }) => shootDisplayName(row.original, "—") },
    { id: "shootPlace", header: "Shoot Place", accessorFn: (shoot) => shoot.shootPlace || "—", sortable: false, filterable: false, width: 200, maxWidth: NAME_COLUMN_MAX_WIDTH, title: (shoot) => shoot.shootPlace || "—", cell: ({ row }) => row.original.shootPlace || "—" },
    { id: "shootType", header: "Shoot Type", accessorFn: (shoot) => shootTypesOf(shoot).join(", ") || "Studio / In-House", sortable: false, filterable: false, width: 190, cell: ({ row }) => shootTypesOf(row.original).join(", ") || "Studio / In-House" },
    { id: "district", header: "District", accessorFn: (shoot) => shoot.district || "—", sortable: false, filterable: false, width: 170, cell: ({ row }) => row.original.district || "—" },
    { id: "state", header: "State", accessorFn: (shoot) => shoot.state || "—", sortable: false, filterable: false, width: 170, cell: ({ row }) => row.original.state || "—" },
    { id: "sessionTiming", header: "Session Timing", accessorFn: formatSessionTiming, sortable: false, filterable: false, width: 180, cell: ({ row }) => formatSessionTiming(row.original) },
    { id: "isMainEvent", header: "Main Event", accessorFn: (shoot) => shoot.isMainEvent ? "Yes" : "-", sortable: false, filterable: false, width: 120, cell: ({ row }) => row.original.isMainEvent ? "Yes" : "-" },
    { id: "foodTakenCareBy", header: "Food", accessorFn: (shoot) => shoot.foodTakenCareBy || "Studio", sortable: false, filterable: false, width: 120, cell: ({ row }) => row.original.foodTakenCareBy || "Studio" },
    { id: "accommodation", header: "Accommodation", accessorFn: (shoot) => shoot.accommodation || "Studio", sortable: false, filterable: false, width: 150, cell: ({ row }) => row.original.accommodation || "Studio" },
    { id: "travel", header: "Travel", accessorFn: (shoot) => shoot.travel || "Studio", sortable: false, filterable: false, width: 120, cell: ({ row }) => row.original.travel || "Studio" },
    // A shoot booked before this was asked for has none, and a dash says "not recorded" rather
    // than inventing a side for it.
    { id: "preference", header: "Preference", accessorFn: (shoot) => shoot.preference || "", sortable: false, filterable: false, width: 120, cell: ({ row }) => row.original.preference || "—" },
    ...(readOnly ? [] : [{ id: "actions", header: "", sortable: false, filterable: false, fixed: true, width: 52, minWidth: 52, size: 52, minSize: 48, maxSize: 56, cell: ({ row }) => <ShootActions shoot={row.original} index={row.index} onEdit={onRequestEdit} onDuplicate={onRequestDuplicate} onDelete={onRequestDelete} /> }]),
  ], [onReorder, onRequestDelete, onRequestDuplicate, onRequestEdit, readOnly, reorderable, shoots, showShootId]);

  if (loading) return <p className="rounded-md border border-slate-200 bg-slate-50 px-4 py-5 text-sm text-slate-500">Loading shoots...</p>;
  if (!shoots.length) return <p className="rounded-md border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">No shoots added yet.</p>;

  return <div className="space-y-3">
    <div className="hidden h-auto overflow-x-auto rounded-lg border border-slate-200 md:block">
      <DataTable columns={columns} data={shoots} loading={false} ariaLabel="Shoot list table" /*
       * No table ⋮ on this one. Manage Columns, Export CSV and Compact view are a page-level
       * table's menu; on a handful of shoots inside a form they are a control that opens over the
       * form to offer things nobody came here for.
       */
      features={{ filtering: false, sorting: false, columnResize: true, tableOptions: false }}
      /*
       * The scrollbar's own room, on the element that actually scrolls - `DataTable` puts this on
       * its scroll container, which is the one holding the table.
       *
       * Fourteen columns is about two thousand pixels, so this list scrolls sideways wherever it is
       * read, and the scrollbar was drawn *over* the last row: on macOS an overlay scrollbar sits on
       * top of content, and the line it covered was a shoot somebody was scrolling to find.
       * `scrollbar-gutter: stable` reserves the track, and the padding keeps an overlay bar clear of
       * the final row.
       */
      className="pb-3 [scrollbar-gutter:stable]"
      getRowId={shootKey} />
    </div>
    <div className="space-y-3 md:hidden">
      {shoots.map((shoot, index) => {
        const key = shootKey(shoot, index);
        return <article key={key} className="rounded-lg border border-slate-200 bg-white p-4 text-sm shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              {/* The same name the table's own Shoot column draws, brackets and all. */}
              <p className="font-semibold text-slate-900">{shootDisplayName(shoot, "—")}</p>
              <p className="mt-1 text-xs text-slate-500">{showShootId ? `${shoot.shootId || "Pending"} · ` : ""}{formatDate(shoot.dateCreated)}</p>
            </div>
            {!readOnly && <ShootActions shoot={shoot} index={index} count={shoots.length} onEdit={onRequestEdit} onDuplicate={onRequestDuplicate} onDelete={onRequestDelete} onMove={reorderable ? moveShoot : undefined} />}
          </div>
          <dl className="mt-3 grid grid-cols-1 gap-2 text-slate-600 sm:grid-cols-2 xl:grid-cols-3">
            {[["shootPlace", "Shoot Place"], ["shootType", "Shoot Type"], ["district", "District"], ["state", "State"], ["foodTakenCareBy", "Food"], ["accommodation", "Accommodation"], ["travel", "Travel"], ["preference", "Preference"]].map(([field, label]) => <div key={field} className="grid grid-cols-[8rem_1fr] gap-2"><dt className="flex items-center font-medium text-slate-700">{label}<HelpTip text={SHOOT_CARD_HELP[field]} /></dt><dd className="min-w-0 break-words">{field === "shootType" ? (shootTypesOf(shoot).join(", ") || "Studio / In-House") : shoot[field] || (["foodTakenCareBy", "accommodation", "travel"].includes(field) ? "Studio" : "—")}</dd></div>)}<div className="grid grid-cols-[8rem_1fr] gap-2"><dt className="flex items-center font-medium text-slate-700">Session Timing<HelpTip text={detailHelpFor("Shoot", "sessionTiming")} /></dt><dd className="min-w-0 break-words">{formatSessionTiming(shoot)}</dd></div><div className="grid grid-cols-[8rem_1fr] gap-2"><dt className="flex items-center font-medium text-slate-700">Main Event<HelpTip text={detailHelpFor("Shoot", "isMainEvent")} /></dt><dd>{shoot.isMainEvent ? "Yes" : "-"}</dd></div>
          </dl>
        </article>;
      })}
    </div>
  </div>;
}
