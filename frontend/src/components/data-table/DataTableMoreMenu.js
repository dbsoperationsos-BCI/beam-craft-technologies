"use client";

import OptionsMenu from "@/components/ui/OptionsMenu";
import { tableMenuItems } from "@/lib/tableMenuItems";

export default function DataTableMoreMenu({ onImport, onExportCsv, onExportExcel, onManageColumns, onFreezeColumnsChange, freezeCount, onResetColumnOrder, onToggleCompact, compact = false, disableExport = false, excelEnabled = false, menuZIndexClassName, ariaLabel = "Table options" }) {
  const supportsFreezeColumns = Boolean(onFreezeColumnsChange) || ariaLabel === "Employee table header options";
  const activeFreezeCount = onFreezeColumnsChange ? freezeCount : typeof window === "undefined" ? 3 : window.__dbsEmployeeFreezeCount;

  function setFreezeColumns(count) {
    if (onFreezeColumnsChange) onFreezeColumnsChange(count);
    else if (ariaLabel === "Employee table header options") window.dispatchEvent(new CustomEvent("dbs:employee-table-freeze", { detail: count }));
  }

  /*
   * What is in the menu is decided by `tableMenuItems`, which is a pure function in `lib/` so it can
   * be tested without rendering. This component is the menu around it and nothing else.
   */
  const items = tableMenuItems({
    onImport,
    onExportCsv,
    onExportExcel,
    onManageColumns,
    onResetColumnOrder,
    onToggleCompact,
    supportsFreezeColumns,
    freezeCount: activeFreezeCount,
    onFreezeColumns: setFreezeColumns,
    compact,
    disableExport,
    excelEnabled,
  });

  // The menu is portalled to `body`, so a table drawn inside a form panel has to name a layer that
  // clears it; left unset it takes the page default.
  return <OptionsMenu ariaLabel={ariaLabel} title="Table Options" items={items} menuClassName="w-48" {...(menuZIndexClassName ? { menuZIndexClassName } : {})} />;
}
