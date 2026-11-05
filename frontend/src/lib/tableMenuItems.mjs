/**
 * What the table's ⋮ menu offers, as data.
 *
 * Split out of `DataTableMoreMenu` so it can be tested without rendering anything. The component
 * around it is a `<OptionsMenu items={…}>` and nothing else; everything that decides *what is in the
 * menu* is here, which is the part worth holding to account - an item that quietly stops being
 * offered looks identical to a feature nobody wired.
 *
 * ── The order ──
 *
 * Import leads, alone in its own group. It is the one item that **writes**: everything below it
 * reads the table or redraws it, and an action that changes records sitting among view settings is
 * one people press by accident. Then what leaves the table, then the columns, then how it is drawn.
 */
export function tableMenuItems({
  onImport,
  onExportCsv,
  onExportExcel,
  onManageColumns,
  onResetColumnOrder,
  onToggleCompact,
  supportsFreezeColumns = false,
  freezeCount,
  onFreezeColumns,
  compact = false,
  disableExport = false,
  excelEnabled = false,
} = {}) {
  // Only where the table has wired one: a table with no importer shows no Import, rather than one
  // that opens a dialog and then refuses.
  const importItems = onImport ? [{ label: "Import", onSelect: onImport }] : [];

  const exportItems = [
    ...(onExportCsv ? [{ label: "Export CSV", disabled: disableExport, onSelect: onExportCsv }] : []),
    {
      label: "Export Excel",
      disabled: !excelEnabled,
      title: excelEnabled ? "Export Excel" : "Excel export will be added next.",
      onSelect: onExportExcel,
    },
  ];

  const columnItems = [
    ...(supportsFreezeColumns ? [{
      label: "Freeze Columns",
      submenu: [0, 1, 2, 3, 4, 5].map((count) => ({
        label: count === 0 ? "None" : `First ${count}`,
        selected: freezeCount === count,
        onSelect: () => onFreezeColumns?.(count),
      })),
    }] : []),
    ...(onManageColumns ? [{ label: "Manage Columns", onSelect: onManageColumns }] : []),
    // Only offered once the table has actually been arranged: one nobody has touched has nothing
    // to reset, and the item would sit there doing nothing.
    //
    // "Layout" rather than "Column Order" because that is what it now undoes - the order columns
    // were dragged into, the ones hidden, how many were frozen and how wide they were pulled are
    // remembered together, and this puts all four back.
    ...(onResetColumnOrder ? [{ label: "Reset Table Layout", onSelect: onResetColumnOrder }] : []),
  ];

  // How the table is drawn, kept last: it changes the view rather than the data or the columns.
  // Compact view is the application's one density setting, reachable from every table's menu; the
  // tick shows where it stands, and choosing it moves every table at once.
  const viewItems = onToggleCompact ? [{ label: "Compact view", selected: compact, onSelect: onToggleCompact }] : [];

  const groups = [importItems, exportItems, columnItems, viewItems].filter((group) => group.length);
  return groups.flatMap((group, index) => (index === 0 ? group : [{ separator: true }, ...group]));
}
