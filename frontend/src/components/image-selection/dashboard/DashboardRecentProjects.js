"use client";

import { useMemo, useState } from "react";
import DataTable from "@/components/data-table/DataTable";
import DataTableShell from "@/components/data-table/DataTableShell";
import TableFooter from "@/components/data-table/TableFooter";
import { ACTIONS_COLUMN } from "@/components/data-table/tableCells";
import OptionsMenu from "@/components/ui/OptionsMenu";
import { relativeTime, rowsForView, selectionText, stageChip, viewLabel } from "@/lib/imageSelectionDashboard.mjs";
import { CardState } from "@/components/shared/DashboardCard";
import DashboardTableHeading from "@/components/shared/DashboardTableHeading";
import { SelectionProgressBar, StageChip } from "./DashboardCards";

const number = (value) => Number(value || 0).toLocaleString("en-IN");

// Whether a project counts in the reader's Expand view: a green Enabled, a grey Disabled - a word
// beside the dot, so the state never rests on colour alone.
function ExpandStateChip({ enabled }) {
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${enabled ? "bg-green-50 text-green-700" : "bg-slate-100 text-slate-500"}`}>
    <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${enabled ? "bg-green-600" : "bg-slate-400"}`} />{enabled ? "Enabled" : "Disabled"}
  </span>;
}

/**
 * Recent Projects: every Image Selection project, most recently active first, in the same
 * `DataTable` every module's tables use — the per-column filter row, sorting, the Table Options
 * menu and its Compact view included, fifteen rows tall and scrolled for the rest.
 *
 * Two narrowings, one after the other, and they answer different questions. The cards above ask
 * what state a project is in: `view` is whichever card, stage or attention row is pressed, and
 * with none pressed the table is every project. The filter row asks which project — a name, a
 * client, a status typed rather than looked for — and the table applies that to what the card
 * left. Both happen here, on rows the page already holds, so either is instant and asks the
 * server for nothing.
 *
 * A click picks a row out and leaves the page where it is; a double click opens that project in
 * the Projects workspace. It is the gesture every other table in the application answers to —
 * Projects, Accounts, Role and User Management — so a row here behaves as a row does anywhere
 * else, and a reader running down the list cannot leave the dashboard by accident.
 *
 * In the Expand popup (`expand`, from `useExpandToggle`) two columns follow Last Activity: Activity,
 * whether the project is Enabled or Disabled in the reader's own Expand view, and a ⋮ holding
 * a switch: Enabled, on until the reader turns it off. Both are absent where no `expand` is passed -
 * the Dashboard page's table is unchanged. `title`, `ariaLabel` and `emptyMessage` let the popup
 * name its copy of the table, and `menuZIndexClassName` lifts the row ⋮ and the header's Table
 * Options above the popup the table is drawn in.
 */
export default function DashboardRecentProjects({ rows = [], view = null, onClearView, loading, error, onRetry, onOpen, now, expand = null, title = "Recent Projects", ariaLabel = "Recent Image Selection projects", emptyMessage = "No projects yet.", menuZIndexClassName }) {
  const shown = useMemo(() => rowsForView(rows, view), [rows, view]);
  const label = viewLabel(view);
  // Which row is picked out. Nothing but the highlight depends on it, and a card pressed above
  // may filter the chosen row away — which reads as no row being picked, and is the truth.
  const [selectedId, setSelectedId] = useState(null);
  /*
   * How many rows survived the table's own filter row, which only the table can say.
   *
   * `setStats` is passed straight in rather than wrapped: the table reports this from an effect
   * keyed on the callback, so a fresh function each render would have it report on every render.
   * A `useState` setter never changes.
   */
  const [stats, setStats] = useState(null);
  const columns = useMemo(() => [
    { id: "project", header: "Project", accessorFn: (row) => row.projectName, width: 220, cell: ({ row }) => <span className="block min-w-0">
      <span className="block truncate font-medium text-slate-800">{row.original.projectName}</span>
      {row.original.projectCode && <span className="block text-[10px] text-slate-400">{row.original.projectCode}</span>}
    </span> },
    { id: "client", header: "Client", accessorFn: (row) => row.clientName || "", width: 150, cell: ({ row }) => row.original.clientName || "—" },
    { id: "photos", header: "Total Photos", accessorFn: (row) => row.photoCount, width: 120, cell: ({ row }) => number(row.original.photoCount) },
    // The items the client has submitted sit under the count, each saying whether its picks have
    // been copied out - what Client Submitted and Yet to Download are counting by.
    { id: "selected", header: "Selected", accessorFn: (row) => row.selectedCount, width: 190, cell: ({ row }) => <span className="block min-w-0">
      <span className="block">{selectionText(row.original)}</span>
      {row.original.submittedItems?.length > 0 && <span className="block truncate text-[10px] text-slate-500" title={row.original.submittedItems.map((item) => `${item.name}: ${item.downloadedAt ? "downloaded" : "yet to download"}`).join(", ")}>
        Submitted: {row.original.submittedItems.map((item) => `${item.name}${item.downloadedAt ? " ✓" : ""}`).join(", ")}
      </span>}
    </span> },
    { id: "progress", header: "Progress", accessorFn: (row) => row.percent ?? -1, width: 160, cell: ({ row }) => <SelectionProgressBar percent={row.original.percent} color={stageChip(row.original.stage).color} /> },
    { id: "status", header: "Status", accessorFn: (row) => stageChip(row.stage).label, width: 120, cell: ({ row }) => <StageChip stage={row.original.stage} /> },
    { id: "activity", header: "Last Activity", accessorFn: (row) => row.lastActivityAt || "", width: 130, cell: ({ row }) => relativeTime(row.original.lastActivityAt, now) },
    // A row from an older response carries no `expandEnabled`; every project is enabled until disabled.
    ...(expand ? [
      { id: "expandActivity", header: "Activity", accessorFn: (row) => (row.expandEnabled === false ? "Disabled" : "Enabled"), width: 120, cell: ({ row }) => <ExpandStateChip enabled={row.original.expandEnabled !== false} /> },
      ...(expand.canToggle === false ? [] : [{ ...ACTIONS_COLUMN, cell: ({ row }) => {
        const enabled = row.original.expandEnabled !== false;
        return <OptionsMenu ariaLabel={`Expand actions for ${row.original.projectName}`} {...(menuZIndexClassName ? { menuZIndexClassName } : {})} items={[
          { label: "Enabled", switchOn: enabled, disabled: expand.busyId !== null, onSelect: () => expand.toggle(row.original, !enabled) },
        ]} />;
      } }]),
    ] : []),
  ], [now, expand, menuZIndexClassName]);

  /*
   * What the footer says, counted after both narrowings.
   *
   * `stats.total` is the table's own answer — the rows left once the filter row has had its say —
   * and it stands in for the card count whenever it is lower, so typing in a filter is reflected
   * rather than contradicted. Falls back to the card count before the table has reported, and to
   * the plain sentence when nothing is narrowing anything.
   */
  const matched = Math.min(stats?.total ?? shown.length, shown.length);
  const narrowed = matched !== rows.length;
  const footerText = loading
    ? "Loading..."
    : narrowed
      ? `${matched} of ${rows.length} projects${view ? ` · ${label}` : ""}`
      : `${rows.length} projects, most recently active first`;

  return <section className="flex min-w-0 flex-col">
    {/* What the table is narrowed to, and the one place to let it go from down here. */}
    <DashboardTableHeading title={title} label={view ? label : null} onClear={onClearView} noun="projects" />
    <DataTableShell className="shadow-sm" footer={<TableFooter><span className="text-xs">{footerText}</span></TableFooter>}>
      {error
        ? <div className="p-3"><CardState error={error} onRetry={onRetry} /></div>
        : <DataTable
          columns={columns}
          data={shown}
          loading={loading}
          loadingMessage="Loading projects..."
          emptyMessage={view ? `No projects under ${label} right now.` : emptyMessage}
          noMatchMessage="Nothing matches that search."
          getRowId={(row) => row.id}
          selectedRowId={selectedId || undefined}
          onRowClick={(row) => setSelectedId(row.id)}
          onRowDoubleClick={(row) => onOpen(row)}
          ariaLabel={ariaLabel}
          menuZIndexClassName={menuZIndexClassName}
          /*
           * Fifteen rows tall: the header and its filter row are 75px, a row 24px.
           *
           * A *maximum*, so a studio with four projects gets a panel four rows tall rather than a
           * box with a hole under it — the cap only bites once there is more than it can hold. It
           * is deliberately a shade under sixteen rows: rows load as this pane is scrolled, and a
           * pane whose content fits exactly has no scrollbar and so never fires the scroll that
           * would load the rest. Under the cap, the sixteenth row is always half in view, which is
           * both the invitation to scroll and what makes scrolling possible.
           */
          className="max-h-110"
          onVisibleRowsChange={setStats}
          /*
           * The filter row every other table has, under the headers.
           *
           * It answers a different question from the cards above: they ask what state a project is
           * in, this asks which project — a name, a client, a status typed rather than looked for.
           * The two narrow together, the cards first, and the count in the footer is whatever is
           * left after both.
           *
           * Fifteen rows, and the rest scroll inside the panel rather than paging.
           *
           * The height cap above is what makes that true: fifteen rows and the head above them fit
           * inside it, so a studio with sixteen projects sees fifteen and scrolls, and the page
           * below the table stays where it is however many there are. More load as that scroll
           * reaches the end, fifteen at a time, so a register of hundreds still paints quickly.
           */
          features={{ filtering: true, sorting: true, infiniteScroll: { pageSize: 15 } }}
        />}
    </DataTableShell>
  </section>;
}
