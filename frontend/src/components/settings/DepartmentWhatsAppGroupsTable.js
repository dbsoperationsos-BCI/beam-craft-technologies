"use client";

import { useMemo } from "react";
import DataTable from "@/components/data-table/DataTable";
import { buildTableColumns, defaultVisibilityFor } from "@/components/data-table/tableCells";
import OptionsMenu from "@/components/ui/OptionsMenu";
import { layers } from "@/constants/layers";

/*
 * Above the Settings overlay this table lives inside.
 *
 * `OptionsMenu` defaults to `layers.menu` (60), which is right for a ⋮ on a page. Settings is a form
 * panel at 110, so the menu opened *underneath* it: the ⋮ looked pressed and nothing appeared.
 * `menuOverPanel` is the layer the app already keeps for exactly this - a menu opened from inside a
 * panel - rather than a number worked out from the panel's own.
 */
const MENU_Z = Number(layers.menuOverPanel.replace(/\D/g, ""));

/*
 * Settings → Employee → WhatsApp Groups, read one row per **department**.
 *
 * The department is the thing somebody is working on - "which groups does Production have" is the
 * question, and "which departments does this group serve" is the same fact read from the less useful
 * end. So the row is the department, its groups are one comma-separated cell, and the ⋮ opens the
 * one place they are changed.
 *
 * **Every active department is a row**, including the ones claiming no group. A department missing
 * from the table is one nobody would think to add groups to, and a department with none is exactly
 * the state somebody needs to see in order to fix it.
 *
 * The ⋮ rather than inline controls: adding and removing a department's groups is several actions on
 * one row, and the row is a line of text. `items` comes from the panel, which owns the editing.
 */
const FIELDS = [
  ["departmentName", "Department", undefined, 220, 160],
  // The names, comma separated, which is also what the table's search and its CSV read. No count
  // beside them: the names are the answer, and counting what is already listed is a column of noise.
  ["groupNames", "WhatsApp Groups", undefined, 620, 220],
];

export default function DepartmentWhatsAppGroupsTable({ rows, loading, density, items, onOpen, onExported }) {
  const columns = useMemo(() => buildTableColumns({
    fields: FIELDS,
    renderActions: items
      ? (row) => <OptionsMenu ariaLabel={`Actions for ${row.departmentName}`} items={items(row)} zIndex={MENU_Z} />
      : undefined,
  }), [items]);
  const defaultVisibility = useMemo(() => defaultVisibilityFor(FIELDS), []);

  return <DataTable
    columns={columns}
    data={rows}
    density={density}
    loading={loading}
    loadingMessage="Loading the departments..."
    emptyMessage="No departments yet. Add them in Settings → Organization before giving them WhatsApp groups."
    noMatchMessage="No matching departments found."
    // A double click opens the same editor the ⋮ does, as a double click does on every table here.
    onRowDoubleClick={onOpen ? (row) => onOpen(row) : undefined}
    ariaLabel="Departments and their WhatsApp groups"
    defaultColumnVisibility={defaultVisibility}
    features={{
      /*
       * No `layout` override. `fill` looked like the answer to the blank strip down the right, but
       * it only bites when the table is laid out fixed - a resized column or a server-paged table -
       * and this is neither, so it did nothing. The strip was the **section's** `max-w-[1040px]`,
       * lifted by registering this section as `wide`; the table was already `w-full` underneath it.
       */
      filtering: true,
      sorting: true,
      columnVisibility: true,
      csvExport: { enabled: true, fileName: "department-whatsapp-groups", onResult: onExported },
    }}
  />;
}
