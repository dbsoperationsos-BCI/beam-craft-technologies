"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import DataTable from "@/components/data-table/DataTable";
import useTableSelection from "@/components/data-table/useTableSelection";
import { TableCellValue } from "@/components/data-table/tableCells";
import DataTableShell from "@/components/data-table/DataTableShell";
import KanbanBoard from "@/components/data-table/KanbanBoard";
import TableBoardSwitch, { useTableBoardLayout } from "@/components/data-table/TableBoardSwitch";
import DataTableInfoPanel from "@/components/data-table/DataTableInfoPanel";
import TableFooter from "@/components/data-table/TableFooter";
import ModulePageHeader from "@/components/layout/ModulePageHeader";
import { clientGiftsInfoSections } from "@/constants/infoPanelConfig";
import { useRouteAccess } from "@/components/auth/PermissionsProvider";
import FloatingNotice, { useNotice } from "@/components/shared/FloatingNotice";
import OptionsMenu from "@/components/ui/OptionsMenu";
import DropdownMenu from "@/components/ui/DropdownMenu";
import useCompactView from "@/components/shared/useCompactView";
import { verticalLabel } from "@/components/sales/whatsappGroupNameUtils";
import { getClientGifts, updateClientGiftStatus } from "@/services/project-management/client-gifts.service";
import { CLIENT_GIFT_STATUSES } from "@/constants/clientGifts";
import { columnCount, daysSince } from "@/lib/kanbanSummary.mjs";


/*
 * The two gifts the studio owes a client, each tracked the same way.
 *
 * One screen rather than two, because a gift is a gift: the same columns, the same three states,
 * and usually the same person walking rows along. Which gift is being looked at is the dropdown
 * beside the heading — the same idiom CRD Documents uses for its vertical — and the tabs beneath
 * count within it, so the numbers always describe what is actually on screen. The keys here are
 * the ones the backend knows a gift by.
 *
 * Listed in the order a gift is owed rather than alphabetically — the welcome gift goes out when the
 * client books, the second when their shoot is done — which is why the dropdown is given
 * `sorted={false}`.
 */
const gifts = [
  { value: "welcome", label: "Welcome Gift" },
  { value: "shoot-completed", label: "Shoot Completed Gift" },
];

/*
 * The gift's journey, in order. "Yet To Sent" is where a gift lands the moment the project marks it
 * Applicable; the other two are stamped with the date they were reached.
 *
 * It read "Yet To Receive", which named the wrong end: a gift in this state has not been *sent* yet,
 * and "yet to receive" reads as the studio waiting on something rather than owing something. The old
 * spelling is still in the database on rows written before the rename and is folded to this one when
 * the server reads them, so nothing here has to know about it. The list itself lives in
 * `constants/clientGifts.js`, shared with Pre Production's General panel.
 */
const statuses = CLIENT_GIFT_STATUSES;
const clientGiftsTabs = ["All", ...statuses];

const clientGiftsColumns = [
  { id: "eventId", label: "Event ID" },
  { id: "enquiryId", label: "Enquiry ID" },
  { id: "clientName", label: "Client Name" },
  { id: "clientMainNumber", label: "Contact Number" },
  { id: "sourceBranch", label: "Source Branch" },
  { id: "vertical", label: "Vertical" },
  // Who is taking care of this gift — the whole reason the project form asks for a name.
  { id: "assignee", label: "Assigned To" },
  { id: "projectManager", label: "Project Manager" },
  { id: "sentAt", label: "Sent At", type: "date" },
  { id: "receivedAt", label: "Received At", type: "date" },
  { id: "status", label: "Status" },
  { id: "actions", label: "Actions", fixed: true, sortable: false, filterable: false },
];

const dateFormat = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" });
const updatedFormat = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" });

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : dateFormat.format(date);
}

function displayValue(row, column) {
  const value = row[column.id];
  if (column.type === "date") return formatDate(value);
  // Stored as WED / QQ / CORP; read as Dum Dum / Qua Qua / Corp.
  if (column.id === "vertical") return verticalLabel(value) || "-";
  return value || "-";
}

// The same dot-and-label status cell every other table in the OS reads a status through.
const statusStyles = { "Yet To Sent": "bg-amber-500", Sent: "bg-blue-500", "Received by Client": "bg-emerald-500" };

/*
 * The Board: a column per state, in the gift's order and colours. A card shows the gift in the panel
 * beside it, as a click on its row does; dropping it on another column is that row's own "Mark as",
 * which moves the gift straight away - for whoever may write, as the ⋮ is.
 */
const BOARD_COLUMNS = statuses.map((status) => ({ value: status, label: status, className: `${statusStyles[status] || "bg-slate-400"} text-white` }));
const boardStatusOf = (row) => row.status;
// One rule for the tag and the count: more than 7 days waiting - Sent from the send date, Yet To Sent
// from the project's creation; Received is done.
const WAITING_DAYS = 7;
const giftFlag = (row, column) => {
  if (column.value === "Received by Client") return "";
  const days = daysSince(column.value === "Sent" ? row.sentAt : row.createdAt);
  return days !== null && days > WAITING_DAYS ? `Waiting ${days} days` : "";
};
const giftColumnFigure = (rows, column) => (column.value === "Received by Client" ? null
  : columnCount(rows, (row) => Boolean(giftFlag(row, column)), `Waiting ${WAITING_DAYS}+ days`, `Cards in this column waiting more than ${WAITING_DAYS} days`));
const BOARD_CARD = {
  title: (row) => row.clientName || row.eventId || "Gift",
  subtitle: (row) => [row.eventId || row.enquiryId, row.assignee].filter(Boolean).join(" · "),
  meta: (row) => (row.receivedAt ? `Received ${formatDate(row.receivedAt)}` : row.sentAt ? `Sent ${formatDate(row.sentAt)}` : ""),
};

export default function ClientGiftsPage() {
  // PROJECT / Client Gifts. Moving a gift along is a write; without it the row is read-only and
  // the actions that would change it are absent rather than shown and refused.
  const { canWrite } = useRouteAccess();
  const [gift, setGift] = useState(gifts[0].value);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [tableStats, setTableStats] = useState({ total: 0 });
  const [activeTab, setActiveTab] = useState("All");
  const [infoRow, setInfoRow] = useState(null);
  const [infoPanelState, setInfoPanelState] = useState("collapsed");
  const { notice, showNotice, showError, clearNotice } = useNotice();
  const { density } = useCompactView();

  const giftLabel = gifts.find((option) => option.value === gift)?.label || "Gift";

  /**
   * The gift's rows, read fresh.
   *
   * `silent` is for a re-read behind a change somebody has just made: the table is already showing
   * the right thing, so putting it back into its loading state would be a flash of "Loading..."
   * under a press that has already succeeded. A failed silent re-read is also left quiet - the row
   * on screen is the server's own answer to the write, so a dropped refresh after it is nothing the
   * reader has to act on.
   */
  const loadRows = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const response = await getClientGifts(gift);
      setRows(Array.isArray(response?.data) ? response.data : []);
      setInfoRow((current) => {
        if (!current) return current;
        const next = (Array.isArray(response?.data) ? response.data : []).find((item) => item.id === current.id);
        // A row that has left this gift entirely - the project marked it Not Applicable - closes the
        // panel rather than leaving a record on screen that the table no longer holds.
        return next || null;
      });
      setLastUpdated(new Date());
    } catch (error) {
      if (!silent) {
        showError(error.message || "Unable to load client gifts.");
        setRows([]);
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, [gift, showError]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadRows(); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadRows]);

  /**
   * Moves one gift along, and then re-reads the screen.
   *
   * Two steps, and both are wanted. The row that comes back is that row as it now stands, dates
   * included, so the table is corrected from the answer rather than from a guess about what the
   * answer was - and it lands immediately, which is what a press should feel like.
   *
   * The re-read behind it is what keeps *everything else* honest. The row carries fields this screen
   * does not write - the project's manager, its status, the client's name and number, who the gift is
   * assigned to - and those are read off the project each time; a status change is very often made
   * because something else about the project has just moved, and a table that only ever corrected the
   * one cell it wrote would go on showing the rest as they were when the page was opened. The footer
   * says "Last updated" and it was saying the time of that first load however many changes had been
   * made since, which is the same staleness with a clock on it.
   *
   * Silent, so a re-read does not blank the table into its loading state under somebody who has just
   * pressed a menu item; the row is already correct by the time it runs.
   */
  const moveTo = useCallback(async (row, status) => {
    try {
      const response = await updateClientGiftStatus(gift, row.id, status);
      const updated = response?.data;
      if (updated) {
        setRows((current) => current.map((item) => item.id === updated.id ? updated : item));
        setInfoRow((current) => current?.id === updated.id ? updated : current);
      }
      showNotice(`${giftLabel} marked "${status}".`);
      await loadRows({ silent: true });
    } catch (error) {
      showError(error.message || "Unable to update the gift status.");
    }
  }, [gift, giftLabel, loadRows, showError, showNotice]);

  // A row's ⋮ - only the states this row is not already in: an action that would change nothing is
  // left out rather than offered and ignored. Nothing at all without write, as the column is dropped.
  const giftActions = useCallback((row) => (canWrite ? statuses
    .filter((status) => status !== row.status)
    .map((status) => ({ label: `Mark as ${status}`, onSelect: () => void moveTo(row, status) })) : undefined), [canWrite, moveTo]);

  const columns = useMemo(() => clientGiftsColumns.map((column) => ({
    ...column,
    header: column.label,
    accessorFn: (row) => displayValue(row, column),
    cell: column.id === "status"
      ? ({ row }) => <TableCellValue value={row.original.status} type="status" statusStyles={statusStyles} />
      : column.id === "actions"
        ? ({ row }) => <OptionsMenu ariaLabel={`Actions for ${row.original.eventId || "gift"}`} items={giftActions(row.original)} />
        : ({ row }) => displayValue(row.original, column),
    exportValue: (row) => displayValue(row, column),
    width: column.id === "actions" ? 56 : 180,
    minWidth: column.id === "actions" ? 56 : 150,
  })).filter((column) => column.id !== "actions" || canWrite), [canWrite, giftActions]);

  const tabCounts = useMemo(() => Object.fromEntries(clientGiftsTabs.map((tab) => [
    tab,
    tab === "All" ? rows.length : rows.filter((row) => row.status === tab).length,
  ])), [rows]);

  const visibleRows = useMemo(() => activeTab === "All" ? rows : rows.filter((row) => row.status === activeTab), [activeTab, rows]);

  const updatedText = lastUpdated ? updatedFormat.format(lastUpdated) : "-";
  const [layout, setLayout] = useTableBoardLayout("project-client-gifts");
  const onBoard = layout === "board";
  const canDropAt = useCallback(() => canWrite, [canWrite]);
  const dropGift = useCallback((row, status) => void moveTo(row, status), [moveTo]);
  const openGift = useCallback((row) => { setInfoRow(row); setInfoPanelState("expanded"); }, []);

  /*
   * The tick boxes, for a role holding `ADMIN / Table Select All`.
   *
   * No `prefix`, so the selection offers Export and nothing else - and that is the whole of what it
   * should offer here. A gift row is a project's gift, read from the project that owes it - there is
   * nothing here to delete that is not the project itself.
   */
  const bulk = useTableSelection({ rows: visibleRows, noun: "gift" });

  return <section className="flex h-full min-h-0 w-full min-w-0 flex-col">
    <ModulePageHeader
      title="Client Gifts"
      titleAddon={<div className="border-l border-slate-200 pl-3"><DropdownMenu ariaLabel="Gift" items={gifts} sorted={false} value={gift} onChange={(value) => { setGift(value); setInfoRow(null); }} /></div>}
      // The Board stands every gift under its state, so the status tabs step aside while it shows.
      tabs={onBoard ? undefined : clientGiftsTabs.map((tab) => ({ id: tab, label: tab, count: tabCounts[tab] || 0 }))}
      tabValue={activeTab}
      onTabChange={setActiveTab}
      tabsAriaLabel="Client gift status filters"
      actions={<TableBoardSwitch value={layout} onChange={setLayout} />}
    />
    <FloatingNotice notice={notice} onClose={clearNotice} />
    <div className="min-h-0 flex-1">
      <DataTableShell className="h-full min-h-0" footer={<TableFooter spread><span>Last updated: {updatedText}</span><span>Total rows: {onBoard ? rows.length : tableStats.total}</span></TableFooter>}>
        {/* The shell stacks its children, so the table and the panel beside it need a row of their
            own — without it the info panel lands under the table instead of next to it. */}
        <div className="relative flex min-h-0 flex-1 overflow-hidden">
          {onBoard ? <KanbanBoard
            rows={rows}
            columns={BOARD_COLUMNS}
            statusOf={boardStatusOf}
            // How many have sat 7+ days, and each of them tagged with how long.
            columnAmount={giftColumnFigure}
            cardFlag={giftFlag}
            card={BOARD_CARD}
            onOpen={openGift}
            // The card's ⋮ is the row's ⋮.
            cardActions={giftActions}
            canDropAt={canDropAt}
            onDrop={dropGift}
            loading={loading}
            noun="gifts"
            ariaLabel="Client gifts board"
          /> : <div className="flex min-h-0 min-w-0 flex-1">
            <DataTable
              columns={columns}
              data={visibleRows}
              density={density}
              loading={loading}
              loadingMessage={`Loading ${giftLabel.toLowerCase()}s...`}
              emptyMessage={`Projects with an applicable ${giftLabel} will appear here.`}
              noMatchMessage="No gifts found."
              onVisibleRowsChange={setTableStats}
              selectedRowId={infoRow?.id}
              onRowClick={(row) => { setInfoRow(row); setInfoPanelState("expanded"); }}
              ariaLabel="Client gifts table"
              features={{ filtering: true, sorting: true, columnVisibility: true, infiniteScroll: { pageSize: 50 }, csvExport: { enabled: true, fileName: `client-gifts-${gift}`, onResult: (exported) => showNotice(exported ? "Client Gifts CSV export downloaded." : "No gifts available to export.") }, selection: bulk.selection }}
            />
          </div>}
          <DataTableInfoPanel
            title={giftLabel}
            entity={infoRow}
            sections={clientGiftsInfoSections}
            emptyText="Select a row to view the gift and its project."
            state={infoPanelState}
            onToggle={() => setInfoPanelState((current) => current === "expanded" ? "collapsed" : "expanded")}
          />
        </div>
      </DataTableShell>
    </div>
  </section>;
}
