"use client";

import { useMemo } from "react";
import DataTable from "@/components/data-table/DataTable";
import { buildTableColumns, defaultVisibilityFor } from "@/components/data-table/tableCells";
import OptionsMenu from "@/components/ui/OptionsMenu";
import { reviewStatusStyles, reviewTableFields, sortReviews } from "@/constants/employeeReviewConfig";

/**
 * The reviews recorded against an employee, as the application's own table.
 *
 * It was a table written by hand here, with cards underneath it for a phone. Both are gone: this is
 * `DataTable`, so the review list filters, sorts, remembers its columns and exports itself the same
 * way every other table in the studio does, and the mark each review carries is drawn by the shared
 * `status` cell rather than by a chip this file invented.
 *
 * **The ⋮ is offered here, unlike the shoot list inside the project form.** That list is a handful
 * of rows being built as part of a bigger answer, where Manage Columns and Export are controls
 * nobody came for. A review history is a record in its own right — read to answer "what has this
 * person been paid, and when" — and exporting it is exactly what somebody preparing an appraisal
 * asks for.
 *
 * `emptyText` is what an empty list says, because the caller knows which list it is: "no review is
 * scheduled" and "no reviews have been held" are different facts, and one sentence covering both
 * tells the reader neither. `preserveOrder` leaves the rows as they were handed over — Upcoming
 * reads soonest-first and Past newest-first, an order this component cannot work out for itself.
 */
export default function EmployeeReviewList({ reviews, onEdit, onDelete, emptyText = "No reviews added yet.", preserveOrder = true }) {
  const rows = useMemo(() => (preserveOrder ? reviews : sortReviews(reviews)), [preserveOrder, reviews]);

  const columns = useMemo(() => buildTableColumns({
    fields: reviewTableFields,
    startIndex: 0,
    // What puts Shine's green and Shadow's red in the cell; an unmarked review keeps the shared
    // slate dot and reads as a dash.
    statusStyles: reviewStatusStyles,
    renderActions: (review) => <OptionsMenu
      ariaLabel={`Actions for the review dated ${review.reviewDate || "—"}`}
      items={[
        { label: "Edit", onSelect: () => onEdit(review) },
        { label: "Delete", tone: "danger", onSelect: () => onDelete(review) },
      ]}
      // Above the form panel this table sits inside, which stacks at 110 — the menu's page default
      // would open behind it and pressing ⋮ would appear to do nothing.
      menuZIndexClassName="z-[140]"
    />,
  }), [onDelete, onEdit]);

  const defaultVisibility = useMemo(() => defaultVisibilityFor(reviewTableFields), []);

  if (!rows.length) return <p className="rounded-md border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">{emptyText}</p>;

  return <div className="overflow-hidden rounded-lg border border-slate-200">
    <DataTable
      columns={columns}
      data={rows}
      loading={false}
      ariaLabel="Employee review list"
      emptyMessage={emptyText}
      noMatchMessage="No reviews match that search."
      defaultColumnVisibility={defaultVisibility}
      features={{ filtering: true, sorting: true, csvExport: { enabled: true, fileName: "employee-reviews" } }}
      // The table's own ⋮ is portalled to the body, so it has to out-stack the form panel it is
      // drawn inside — see `menuZIndexClassName` on DataTable.
      menuZIndexClassName="z-[140]"
      /* The scrollbar's own room on the element that actually scrolls, so an overlay scrollbar on
         macOS does not sit on top of the last review in the list. */
      className="pb-3 [scrollbar-gutter:stable]"
      getRowId={(review, index) => review.key || `${review.reviewDate}-${index}`}
    />
  </div>;
}
