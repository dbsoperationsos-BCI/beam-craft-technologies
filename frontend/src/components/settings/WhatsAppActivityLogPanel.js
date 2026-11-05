"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DataTable from "@/components/data-table/DataTable";
import DataTableShell from "@/components/data-table/DataTableShell";
import TableFooter from "@/components/data-table/TableFooter";
import KanbanBoard from "@/components/data-table/KanbanBoard";
import TableBoardSwitch, { useTableBoardLayout } from "@/components/data-table/TableBoardSwitch";
import StatTile from "@/components/shared/StatTile";
import ProgressChip from "@/components/shared/ProgressChip";
import Button from "@/components/shared/Button";
import WhatsAppActivityDetailDialog from "@/components/settings/WhatsAppActivityDetailDialog";
import { layers } from "@/constants/layers";
import { formatDateTime } from "@/lib/formatDateTime.mjs";
import { columnCount, daysSince } from "@/lib/kanbanSummary.mjs";
import {
  ACTIVITY_FACET_FOR_COLUMN, ACTIVITY_MODULE_LABELS, ACTIVITY_STATUS_COLORS, ACTIVITY_TRIGGER_LABELS,
  activityActorLabel, activityFiltersFromColumns, activityModeLabel, activityModuleLabel, activityRecipientLabel, activityStatusLabel, activitySummaryTiles, activityTriggerLabel, hasActivityFilters,
} from "@/lib/whatsappActivity.mjs";
import { getWhatsAppActivityFacets, getWhatsAppActivityOptions, getWhatsAppActivitySummary, listWhatsAppActivity } from "@/services/settings/whatsapp-activity.service";

/*
 * Settings → User Settings → WhatsApp Activity Log.
 *
 * Every WhatsApp message the app sent or tried to send - from a staff member's button or on its own
 * - in one table, newest first, with the three tiles above it counting the same rows the filters
 * leave. The filters are the table's own boxes under its headers, as every other table here has
 * them: a multi-select for every column but Sent At, which takes a day. Each list offers only the
 * values the log actually holds (`GET /facets`, asked when the box opens and remembered until the
 * next read), labelled as the table shows them. The table cannot filter what it does not hold - it
 * is read a page at a time - so each box is reported to the server (`onColumnFilters`) and the
 * page re-reads. The server pages the history
 * (`infiniteScroll.onEndReached`), and a row opens its detail (a click anywhere on it, or Tab and
 * Enter) for whoever holds Read / Write to Resend a failed one (`canWrite`, passed down).
 *
 * Read once on open and again only when a filter box changes or a Resend has just changed a row:
 * no timer, no polling, no Refresh button. Loading, empty ("nothing yet" against "nothing matches
 * these filters") and error are all said in words on the screen, and the rows already on screen
 * stay put while a filter re-reads them.
 */

const PAGE_SIZE = 50;
const NO_FILTERS = Object.freeze({});

const chip = (status) => <ProgressChip color={ACTIVITY_STATUS_COLORS[status] || ACTIVITY_STATUS_COLORS.QUEUED}>{activityStatusLabel(status)}</ProgressChip>;
const truncated = (text, extraClass = "") => <span className={`block truncate ${extraClass}`} title={text}>{text}</span>;

/*
 * The Board: the messages loaded so far, stood under their status in the order a message moves
 * through them, headed in the pill's colour family. A status is the provider's
 * to report, so a card opens the detail, as a row does; a failed one dropped on Queued opens it too,
 * for its Resend.
 */
const BOARD_HEADS = { QUEUED: "bg-slate-500", PROCESSING: "bg-slate-500", SENT: "bg-blue-600", DELIVERED: "bg-emerald-600", READ: "bg-emerald-600", FAILED: "bg-rose-700" };
const BOARD_COLUMNS = Object.entries(BOARD_HEADS).map(([value, head]) => ({ value, label: activityStatusLabel(value), className: `${head} text-white` }));
// One rule for the tag and the count. Failed: may be sent again. Queued and Processing: waited over a day.
// A message WhatsApp has taken carries neither.
const WAITING_COLUMNS = ["QUEUED", "PROCESSING"];
const WAITING_DAYS = 1;
const activityFlag = (row, column) => {
  if (column.value === "FAILED") return row.resendable ? "Resendable" : "";
  if (!WAITING_COLUMNS.includes(column.value)) return "";
  const days = daysSince(row.createdAt);
  return days !== null && days > WAITING_DAYS ? `Waiting ${days} days` : "";
};
const activityColumnFigure = (rows, column) => {
  const counted = (row) => Boolean(activityFlag(row, column));
  if (column.value === "FAILED") return columnCount(rows, counted, "Resendable");
  return WAITING_COLUMNS.includes(column.value) ? columnCount(rows, counted, `Waiting ${WAITING_DAYS}+ days`, `Cards in this column waiting more than ${WAITING_DAYS} days`) : null;
};

export default function WhatsAppActivityLogPanel({ canWrite = false }) {
  const [columnFilters, setColumnFilters] = useState(NO_FILTERS);
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState(null);
  const [options, setOptions] = useState({ modules: [], triggers: [] });
  const [loaded, setLoaded] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [openId, setOpenId] = useState(null);
  // What each filter box may offer, asked of the server when the box opens: `{ [columnId]: [{ value, label }] }`.
  const [facets, setFacets] = useState({});
  const [loadingFacet, setLoadingFacet] = useState("");
  const requestSeq = useRef(0);
  const [layout, setLayout] = useTableBoardLayout("whatsapp-activity-log");

  // What the boxes say, as the API takes it - one object, so a change to any box is one re-read.
  const filters = useMemo(() => activityFiltersFromColumns(columnFilters), [columnFilters]);

  useEffect(() => {
    let cancelled = false;
    getWhatsAppActivityOptions()
      .then((response) => { if (!cancelled && response?.data) setOptions(response.data); })
      .catch(() => { /* The lists have a copy in lib/whatsappActivity.mjs; the table reads fine without this call. */ });
    return () => { cancelled = true; };
  }, []);

  const load = useCallback(async () => {
    const seq = ++requestSeq.current;
    setUpdating(true);
    setError("");
    try {
      const [page, counts] = await Promise.all([
        listWhatsAppActivity(filters, { offset: 0, limit: PAGE_SIZE }),
        getWhatsAppActivitySummary(filters),
      ]);
      if (seq !== requestSeq.current) return;
      setRows(page?.data || []);
      setTotal(Number(page?.total) || 0);
      setSummary(counts?.data || null);
      setLoaded(true);
      // A fresh read may hold values the boxes have not seen; they ask again when next opened.
      setFacets({});
    } catch (loadError) {
      if (seq !== requestSeq.current) return;
      setError(loadError?.message || "Unable to load the WhatsApp activity log.");
      setLoaded(true);
    } finally {
      if (seq === requestSeq.current) setUpdating(false);
    }
  }, [filters]);

  // Deferred a tick, as the overlay defers its own fetches: a fetch kicked off inside the effect body
  // would set state during it.
  useEffect(() => { const timer = setTimeout(() => { void load(); }, 0); return () => clearTimeout(timer); }, [load]);

  const loadMore = useCallback(async () => {
    if (updating || loadingMore || rows.length >= total) return;
    setLoadingMore(true);
    const seq = requestSeq.current;
    try {
      const page = await listWhatsAppActivity(filters, { offset: rows.length, limit: PAGE_SIZE });
      if (seq !== requestSeq.current) return;
      const known = new Set(rows.map((row) => row.id));
      setRows((current) => [...current, ...(page?.data || []).filter((row) => !known.has(row.id))]);
      setTotal(Number(page?.total) || total);
    } catch (moreError) {
      if (seq === requestSeq.current) setError(moreError?.message || "Unable to load more of the log.");
    } finally {
      setLoadingMore(false);
    }
  }, [filters, loadingMore, rows, total, updating]);

  const triggerLabels = useMemo(() => ({ ...ACTIVITY_TRIGGER_LABELS, ...Object.fromEntries((options.triggers || []).map((trigger) => [trigger.value, trigger.label])) }), [options.triggers]);
  const moduleLabels = useMemo(() => ({ ...ACTIVITY_MODULE_LABELS, ...Object.fromEntries((options.modules || []).map((module) => [module.value, module.label])) }), [options.modules]);
  const filtered = hasActivityFilters(filters);

  /*
   * The lists the boxes offer, in the shape the table asks for them (`features.filterValues`):
   * `has` says which columns get a list at all, `get` answers from what has been fetched, `onOpen`
   * fetches a column's values the first time its box opens. Only values the log holds are offered -
   * not the catalogue - with the labels the table shows for them.
   */
  const filterValues = useMemo(() => ({
    has: (column) => Boolean(ACTIVITY_FACET_FOR_COLUMN[column]),
    get: (column) => facets[column] || null,
    loading: loadingFacet,
    onOpen: (column) => {
      const facet = ACTIVITY_FACET_FOR_COLUMN[column];
      if (!facet || facets[column]) return;
      setLoadingFacet(column);
      void getWhatsAppActivityFacets(facet)
        .then((response) => setFacets((current) => ({ ...current, [column]: Array.isArray(response?.data) ? response.data : [] })))
        .catch(() => setFacets((current) => ({ ...current, [column]: [] })))
        .finally(() => setLoadingFacet((current) => (current === column ? "" : current)));
    },
  }), [facets, loadingFacet]);

  /*
   * Action, Module, To, Sent, Sent By, Status, Sent At - in that order, as the studio asked for
   * the table. Each is a field the row records at send time (the trigger, its module, its mode, the
   * login that pressed Send, the provider-reported status, the moment WhatsApp accepted it), never
   * something read out of the message text. Sent At is `sentAt` and nothing else: a message that
   * never went shows a dash, not the time it was tried. What the message was about, how many tries
   * it took and why it failed are the detail's, one click (or Enter) away.
   *
   * Each column carries a `minWidth` as well as a `width`: under the table's auto layout a column
   * with only a width is squeezed when the row runs out of room, and Sent At - the last one - lost
   * its time under the ⋮ column. With a floor, the row keeps its widths and the table scrolls
   * sideways inside its own scroller instead, which is the app's pattern for a wide table.
   *
   * Every column but Sent At filters by a multi-select whose values come from the log itself
   * (`filterValues` above); Sent At takes a day. The box's answer goes to the server by the
   * column's id (`activityFiltersFromColumns`), so the ids here are part of the contract.
   */
  const columns = useMemo(() => [
    { id: "trigger", accessorKey: "trigger", header: "Action", width: 230, minWidth: 190, cell: ({ row }) => truncated(activityTriggerLabel(row.original.trigger, triggerLabels)), sortable: false },
    { id: "module", accessorKey: "sourceModule", header: "Module", width: 160, minWidth: 130, cell: ({ row }) => activityModuleLabel(row.original.sourceModule, moduleLabels), sortable: false },
    // `value` gives To and Sent By an accessor: the table draws a filter box only for a column that
    // has one, and these two read their text from several fields rather than one.
    { id: "recipient", header: "To", width: 230, minWidth: 200, value: (row) => activityRecipientLabel(row), cell: ({ row }) => truncated(activityRecipientLabel(row.original)), sortable: false },
    { id: "mode", accessorKey: "mode", header: "Sent", width: 110, minWidth: 100, cell: ({ row }) => activityModeLabel(row.original), sortable: false },
    { id: "actor", header: "Sent By", width: 170, minWidth: 150, value: (row) => activityActorLabel(row), cell: ({ row }) => truncated(activityActorLabel(row.original)), sortable: false },
    { id: "status", accessorKey: "status", header: "Status", width: 120, minWidth: 120, cell: ({ row }) => chip(row.original.status), sortable: false },
    {
      id: "sentAt", accessorKey: "sentAt", header: "Sent At", width: 190, minWidth: 190, filter: "date", sortable: false,
      cell: ({ row }) => (row.original.sentAt
        ? <span className="whitespace-nowrap tabular-nums">{formatDateTime(row.original.sentAt)}</span>
        : <span className="text-slate-500" title={row.original.status === "FAILED" ? "Not sent" : "Not sent yet"}>—</span>),
    },
  ], [moduleLabels, triggerLabels]);

  const onRowChanged = useCallback(() => { void load(); }, [load]);
  const firstLoad = !loaded && updating;

  return <div className="space-y-4">
    <div role="group" aria-label="Message counts" aria-busy={firstLoad} className="grid grid-cols-1 gap-2 sm:grid-cols-3">
      {activitySummaryTiles(summary).map((tile) => <StatTile key={tile.key} label={tile.label} value={firstLoad ? <span className="text-slate-400"><span className="sr-only">Loading</span>…</span> : tile.value.toLocaleString()} tone={tile.tone} />)}
    </div>

    {error && <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
      <span>{error}</span>
      <Button type="button" onClick={() => load()}>Try again</Button>
    </div>}

    <div className="flex justify-end"><TableBoardSwitch value={layout} onChange={setLayout} /></div>

    {layout === "board" ? <div className="flex h-[32rem] min-h-0 min-w-0 rounded-xl border border-slate-200 bg-white">
      <KanbanBoard
        rows={rows}
        columns={BOARD_COLUMNS}
        statusOf={(row) => row.status}
        // Failed: how many may be sent again. Queued and Processing: how many have waited over a day.
        columnAmount={activityColumnFigure}
        cardFlag={activityFlag}
        card={{
          title: (row) => activityTriggerLabel(row.trigger, triggerLabels),
          subtitle: (row) => [activityRecipientLabel(row), activityActorLabel(row)].filter(Boolean).join(" · "),
          meta: (row) => [activityModuleLabel(row.sourceModule, moduleLabels), row.sentAt ? formatDateTime(row.sentAt) : ""].filter(Boolean).join(" · "),
        }}
        getRowId={(row) => String(row.id)}
        onOpen={(row) => setOpenId(row.id)}
        // A failed message carried back to Queued opens its detail, where Resend is - the server
        // decides there whether this one may go again. Every other status is WhatsApp's to report.
        canDropAt={(row, to) => canWrite && row.status === "FAILED" && to === "QUEUED"}
        onDrop={(row) => setOpenId(row.id)}
        viewOnly={canWrite ? "Only a failed message can be moved - drag it to Queued to resend it. Every other status is reported by WhatsApp." : "A message's status is reported by WhatsApp."}
        loading={firstLoad}
        noun="messages"
        filtered={filtered}
        ariaLabel="WhatsApp message history board"
      />
    </div> : <DataTableShell footer={<TableFooter>
      <span role="status">
        {firstLoad ? "Loading..." : `Showing ${rows.length.toLocaleString()} of ${total.toLocaleString()} message${total === 1 ? "" : "s"}`}
        {!firstLoad && updating ? " · updating..." : ""}
        {loadingMore ? " · loading more..." : ""}
      </span>
      {filtered && <Button type="button" size="sm" variant="ghost" onClick={() => setColumnFilters(NO_FILTERS)}>Clear filters</Button>}
    </TableFooter>}>
      <DataTable
        columns={columns}
        data={rows}
        loading={firstLoad}
        loadingMessage="Loading the activity log..."
        emptyMessage={error ? "" : filtered ? "No messages match these filters." : "No WhatsApp messages have been sent through the app yet. Messages appear here after somebody sends one from a project, lead, candidate or employee screen, or when the app sends one on its own."}
        noMatchMessage="No messages match these filters."
        getRowId={(row) => row.id}
        ariaLabel="WhatsApp message history"
        // The row is the way in: a click anywhere on it, or Tab to it and Enter. No View button -
        // a button in every row of a clickable row is a nested control, and the row already says
        // (cursor, hover, focus ring) that it opens.
        onRowClick={(row) => setOpenId(row.id)}
        focusableRows
        selectedRowId={openId}
        menuZIndexClassName={layers.menuOverPanel}
        // Capped on the table's own scroller, as the Excluded Numbers table is: the section body has
        // no definite height for a percentage to resolve against, so the table would grow the panel.
        className="max-h-[32rem]"
        features={{ filtering: true, filters: columnFilters, onColumnFilters: setColumnFilters, filterValues, infiniteScroll: { onEndReached: loadMore }, layout: "auto" }}
      />
    </DataTableShell>}

    {openId && <WhatsAppActivityDetailDialog
      activityId={openId}
      canWrite={canWrite}
      triggerLabels={triggerLabels}
      moduleLabels={moduleLabels}
      onClose={() => setOpenId(null)}
      onChanged={onRowChanged}
    />}
  </div>;
}
