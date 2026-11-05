"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import RefreshRounded from "@mui/icons-material/RefreshRounded";
import DataTable from "@/components/data-table/DataTable";
import DataTableShell from "@/components/data-table/DataTableShell";
import DataTableInfoPanel from "@/components/data-table/DataTableInfoPanel";
import { TableCellValue } from "@/components/data-table/tableCells";
import KanbanBoard, { columnsFromRows, groupValue } from "@/components/data-table/KanbanBoard";
import TableBoardSwitch, { useTableBoardLayout } from "@/components/data-table/TableBoardSwitch";
import { columnCount } from "@/lib/kanbanSummary.mjs";
import ModulePageHeader from "@/components/layout/ModulePageHeader";
import AdministrationSwitch from "@/components/shared/AdministrationSwitch";
import DateRangeSwitch from "@/components/shared/DateRangeSwitch";
import Button from "@/components/shared/Button";
import IconButton from "@/components/shared/IconButton";
import useCompactView from "@/components/shared/useCompactView";
import { activityLogInfoSections } from "@/constants/infoPanelConfig";
import {
  ACTIVITY_PERIOD_OPTIONS,
  ALL_AVAILABLE,
  CUSTOM_PERIOD,
  DEFAULT_ACTIVITY_SORT,
  activityLogQuery,
  customRangeError,
  dateFieldToLogTime,
  LOG_TIME_RANGE_PLACEHOLDER,
  logTimeToDateField,
  parseLogTimeRange,
  formatLogTime,
  resolveActivityPeriod,
  statusTone,
} from "@/lib/activityLogs.mjs";
import { downloadActivityLogs, getActivityLog, getActivityLogOptions, getActivityLogs } from "@/services/admin/activityLogs.service";
import FloatingNotice, { useNotice } from "@/components/shared/FloatingNotice";
import { createExportFileName } from "@/lib/tableExport";
import { saveProjectFile } from "@/lib/projectStorage.mjs";

/*
 * Who did what in the application, and when: every request a signed-in person made, as the server
 * logged it.
 *
 * One of the User Management family of screens, reached from the switch beside its heading
 * rather than from the sidebar, because it is read about the same people the repository holds -
 * "what has this person been doing" is a question asked from their record, not from a menu.
 *
 * Read-only by nature. The log is written by the server as requests happen and nobody may change
 * it, so the screen offers nothing to create, edit or delete whatever the reader's level - READ on
 * `ADMIN / User Activity Logs` is the whole of what it needs, and `RouteGuard` has already asked.
 *
 * Read a page at a time, because the log is the one table in the application that grows with every
 * click anybody makes. The period, the column filters and the sort are all sent to the server, so a
 * filter finds a row that has not been scrolled to; scrolling near the bottom fetches the next page.
 * No footer: the grid runs to the bottom of the screen.
 */

const PAGE_SIZE = 100;

/** How long typing into a column filter waits before the log is asked again. */
const FILTER_DEBOUNCE_MS = 300;

/*
 * The dot beside a response: green for success, a quiet blue for a redirect, amber for a refusal,
 * red for a fault. Subtle on purpose - most of the log is 200s, and the eye should land on the rest.
 */
const TONE_STYLES = {
  success: "bg-emerald-500",
  redirect: "bg-sky-500",
  client: "bg-amber-500",
  server: "bg-rose-500",
  unknown: "bg-slate-400",
};

// A request refused or failed (a response of 400 or above): the board's tag, and what each column counts.
const logFlag = (row) => (Number(row.statusCode) >= 400 ? `Failed (${row.statusCode})` : "");
const statusLabel = (row) => row?.statusText || (row?.statusCode ? String(row.statusCode) : "-");


const infoFormatters = {
  logTime: (value) => formatLogTime(value),
  durationMs: (value) => (Number.isFinite(Number(value)) ? `${Number(value).toLocaleString("en-IN")} ms` : "-"),
  /*
   * One change per line.
   *
   * They are stored as one string joined by " · " - one column, one value, and the table's cell wants
   * it on a single line. In the panel that reads as a paragraph of field names, which is the one
   * place somebody is reading them carefully, so it is broken back apart. A save that touched four
   * fields is four lines, as it was four changes.
   */
  changes: (value) => {
    const lines = String(value || "").split(" · ").map((line) => line.trim()).filter(Boolean);
    if (!lines.length) return "Nothing on a tracked record, or the save was refused.";
    return <ul className="space-y-1">
      {lines.map((line, at) => <li key={at} className="break-words">{line}</li>)}
    </ul>;
  },
};

const errorMessage = (error) => {
  if (error?.status === 404) return "The activity log is not available on this server yet.";
  if (error?.status === 403) return "You do not have access to the activity log.";
  return error?.data?.message || error?.message || "Unable to load the activity log.";
};

const sameFilters = (left, right) => {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) if (String(left[key] ?? "") !== String(right[key] ?? "")) return false;
  return true;
};

export default function UserActivityLogsPage() {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [period, setPeriod] = useState(ALL_AVAILABLE);
  const [customRange, setCustomRange] = useState({ from: "", to: "" });
  /*
   * The column filters as typed, and the copy the reads use. `appliedFilters` lags by a moment so a
   * word typed into Username is one request rather than one per letter.
   */
  const [columnFilters, setColumnFilters] = useState({});
  const [appliedFilters, setAppliedFilters] = useState({});
  const [sort, setSort] = useState(DEFAULT_ACTIVITY_SORT);
  const [options, setOptions] = useState({ modules: [], methods: [] });
  const [infoRow, setInfoRow] = useState(null);
  const [infoPanelState, setInfoPanelState] = useState("collapsed");
  const { density } = useCompactView();

  /*
   * Refs for the scroll handler, which fires many times a frame: a guard held in state lags by one
   * render and would start a request per event. `requestRef` numbers each first-page read, so a page
   * that arrives after the filters have changed again is dropped rather than drawn. `cappedRef` is
   * set when the server will not page further back (it stops at 10,000 lines), so scrolling stops
   * asking; a page that failed for any other reason is simply asked again on the next scroll.
   */
  const loadingMoreRef = useRef(false);
  const cappedRef = useRef(false);
  const heldRef = useRef(0);
  const requestRef = useRef(0);

  useEffect(() => {
    const timer = window.setTimeout(
      () => setAppliedFilters((current) => (sameFilters(current, columnFilters) ? current : columnFilters)),
      FILTER_DEBOUNCE_MS,
    );
    return () => window.clearTimeout(timer);
  }, [columnFilters]);

  // A custom range is only asked once both ends are set, so choosing the first day does not read
  // the whole log from that day to now on the way to the range somebody actually meant.
  // A range whose end comes before its start is refused here, under its To end, rather than asked of
  // the server and answered with nothing.
  const rangeError = period === CUSTOM_PERIOD ? customRangeError(customRange) : "";
  const customReady = period !== CUSTOM_PERIOD || Boolean(customRange.from && customRange.to && !rangeError);

  const queryFor = useCallback((page) => activityLogQuery({
    // Worked out at the moment of asking, so a refresh of "Last hour" reads the last hour now.
    period: resolveActivityPeriod(period, customRange),
    filters: appliedFilters,
    sort,
    page,
    pageSize: PAGE_SIZE,
  }), [appliedFilters, customRange, period, sort]);

  /**
   * The first page, over whatever is on screen: every change of period, filter or sort, and Refresh.
   * Only the first page carries a total (counting a six-month log on every page is the costly part);
   * it is what tells scrolling when there is nothing further to fetch.
   */
  const load = useCallback(async () => {
    const request = ++requestRef.current;
    setLoading(true);
    setError(null);
    cappedRef.current = false;
    try {
      const result = await getActivityLogs(queryFor(1));
      if (request !== requestRef.current) return;
      const page = Array.isArray(result?.rows) ? result.rows : [];
      setRows(page);
      setTotal(Number(result?.total) || page.length);
    } catch (loadError) {
      if (request !== requestRef.current) return;
      setRows([]);
      setTotal(0);
      setError(errorMessage(loadError));
    } finally {
      if (request === requestRef.current) setLoading(false);
    }
  }, [queryFor]);

  useEffect(() => { heldRef.current = rows.length; }, [rows.length]);

  /** The next page, once the reader has scrolled near the end of what is held. */
  const loadMore = useCallback(() => {
    if (loading || loadingMoreRef.current || cappedRef.current || heldRef.current >= total) return;
    loadingMoreRef.current = true;
    const request = requestRef.current;
    const page = Math.floor(heldRef.current / PAGE_SIZE) + 1;
    void getActivityLogs(queryFor(page))
      .then((result) => {
        if (request !== requestRef.current) return;
        const next = Array.isArray(result?.rows) ? result.rows : [];
        // By id, so a page asked for twice costs a wasted request rather than a duplicated row.
        setRows((current) => {
          const held = new Set(current.map((row) => row?.id));
          return [...current, ...next.filter((row) => !held.has(row?.id))];
        });
      })
      .catch((loadError) => {
        // A 400 on a later page is the server's paging limit: stop asking until the question changes.
        if (request === requestRef.current && loadError?.status === 400) cappedRef.current = true;
      })
      .finally(() => { loadingMoreRef.current = false; });
  }, [loading, queryFor, total]);

  // Deferred a tick so the first render is not the one that flips the table into loading.
  useEffect(() => {
    if (!customReady) return undefined;
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [customReady, load]);

  /*
   * What the Utility name and HTTP method filters offer, asked once. Quietly: a missing list leaves
   * those two filters as boxes to type into, which still filter, rather than an error over a log
   * that is otherwise working.
   */
  useEffect(() => {
    let cancelled = false;
    getActivityLogOptions()
      .then((result) => {
        if (cancelled) return;
        setOptions({
          modules: Array.isArray(result?.modules) ? result.modules : [],
          methods: Array.isArray(result?.methods) ? result.methods : [],
        });
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  /*
   * The list carries only what the grid draws, so a line's route, browser, names and timing are read
   * when it is opened. The panel shows the row at once and fills in as the rest arrives; a click on
   * another line before then drops the late answer.
   */
  const openRequestRef = useRef(0);

  /*
   * Export CSV / Export Excel: the whole log the screen is asking about - period, filters and sort -
   * not just the lines scrolled in, written by the server and saved where every table's export goes.
   */
  const { notice, showSuccess, showError, clearNotice } = useNotice();
  const exportLog = useCallback(async (format) => {
    try {
      const { page: _page, pageSize: _pageSize, ...params } = queryFor(1);
      const blob = await downloadActivityLogs(params, format);
      await saveProjectFile({ blob, fileName: createExportFileName("user-activity-logs", format) });
      showSuccess(`User activity logs ${format === "xlsx" ? "Excel" : "CSV"} export downloaded.`);
    } catch (exportError) {
      showError(exportError?.message || "Unable to export the activity log.");
    }
  }, [queryFor, showError, showSuccess]);
  const openLine = (row) => {
    const request = ++openRequestRef.current;
    setInfoRow(row);
    setInfoPanelState("expanded");
    getActivityLog(row.id)
      .then((full) => { if (request === openRequestRef.current && full) setInfoRow({ ...row, ...full }); })
      .catch(() => {});
  };

  const columns = useMemo(() => [
    {
      id: "createdAt",
      label: "Log time",
      accessorFn: (row) => formatLogTime(row.createdAt),
      // A span, not text: typed in the column's own format or picked, and narrowed against the
      // period above the grid - see `parseLogTimeRange` and `activityLogQuery`.
      filter: "dateTimeRange",
      filterPlaceholder: LOG_TIME_RANGE_PLACEHOLDER,
      filterFormatRangeEnd: dateFieldToLogTime,
      filterParseRangeEnd: logTimeToDateField,
      filterIsInvalid: (value) => parseLogTimeRange(value) === null,
      // Wide enough for the whole `2026/10/20 11:52:05 PM - 2026/10/20 11:59:59 PM` range filter.
      // `size` beside every `width`: a server-paged table lays its columns out by TanStack's size,
      // which is 150 for a column that names none - so without it every column here came out equal.
      width: 320, size: 320,
      minWidth: 280,
    },
    { id: "username", label: "Username", accessorFn: (row) => row.username || "-", width: 130, size: 130, minWidth: 110 },
    // The two widest by declaration, so the spare width a wide screen shares out (`layout: "fill"`)
    // goes mostly to the two columns whose values are longest.
    { id: "module", label: "Utility name", accessorFn: (row) => row.module || "-", filter: "combobox", filterOptions: options.modules, width: 190, size: 190, minWidth: 150 },
    { id: "action", label: "Action name", accessorFn: (row) => row.action || "-", width: 250, size: 250, minWidth: 170 },
    /*
     * **What the write changed**, where its handler said so - "Main Event Date: 20 Nov 2026 → 22 Nov
     * 2026 · Production Manager: — → Karthik".
     *
     * The column this log was missing: it recorded that somebody saved a project and nothing about
     * what they saved, so "he says he updated it and it is not reflecting" could not be answered from
     * here either way. A dash on every line whose handler says nothing, which is most of them -
     * nothing is captured unless a handler hands it over, which is what keeps a password or a bank
     * account out of this column by default rather than by exclusion.
     *
     * Filterable as text, because the question is usually "who touched the event date".
     */
    {
      id: "changes",
      label: "What changed",
      accessorFn: (row) => row.changes || "-",
      filter: "text",
      /*
       * Not sortable, and said so rather than left to fail quietly: the server sorts on a named list
       * of columns and would fall back to the log time, so a header offering a sort would show itself
       * sorted while the rows were in another order. Ordering a page of sentences by their first
       * letter answers nothing anybody asked.
       */
      sortable: false,
      width: 360, size: 360, minWidth: 200,
    },
    { id: "method", label: "HTTP method", accessorFn: (row) => row.method || "-", filter: "combobox", filterOptions: options.methods, width: 110, size: 110, minWidth: 100 },
    { id: "clientIp", label: "Client host", accessorFn: (row) => row.clientIp || "-", width: 130, size: 130, minWidth: 110 },
    {
      id: "statusCode",
      label: "Response status",
      accessorFn: (row) => statusLabel(row),
      cell: ({ row }) => {
        const label = statusLabel(row.original);
        return <TableCellValue value={label} type="status" statusStyles={{ [label]: TONE_STYLES[statusTone(row.original.statusCode)] }} />;
      },
      width: 150, size: 150,
      minWidth: 150,
    },
  ], [options]);

  // Table or Board. The board stands the lines already loaded under their utility (module) - a
  // log has no status to move through, so it is a view only; a card opens the line's Info panel.
  const [layout, setLayout] = useTableBoardLayout("admin-activity-logs");
  const onBoard = layout === "board";
  const shownRows = customReady ? rows : [];

  const filtered = Object.values(appliedFilters).some((value) => String(value ?? "").trim());
  const narrowed = period !== ALL_AVAILABLE;
  // Cleared at once rather than after the typing pause: this is a press, not a keystroke.
  const clearFilters = () => { setColumnFilters({}); setAppliedFilters({}); };
  const emptyMessage = error
    ? <div role="alert" className="mx-auto flex max-w-sm flex-col items-center gap-3">
      <p className="text-sm text-slate-600">{error}</p>
      <Button type="button" variant="secondary" onClick={() => void load()}>Try again</Button>
    </div>
    : rangeError
      ? "Set an end time after the start time to read the log for that range."
      : !customReady
        ? "Choose a From and a To time to read the log for that range."
        : <div className="mx-auto flex max-w-sm flex-col items-center gap-3">
          <p className="text-sm text-slate-500">{filtered ? "No activity matches these filters in this period." : "No activity in this period."}</p>
          {(filtered || narrowed) && <div className="flex flex-wrap justify-center gap-2">
            {filtered && <Button type="button" variant="secondary" size="sm" onClick={clearFilters}>Clear filters</Button>}
            {narrowed && <Button type="button" variant="secondary" size="sm" onClick={() => setPeriod(ALL_AVAILABLE)}>Show all available</Button>}
          </div>}
        </div>;

  return <section className="flex h-full min-h-0 w-full min-w-0 flex-col">
    <ModulePageHeader
      // User Management on the left, as on Users and Roles: the heading names the family, and the
      // switch beside it says which of its screens is open.
      title="User Management"
      titleAccessory={<AdministrationSwitch current="/admin/activity-logs" />}
      leadingActions={<DateRangeSwitch
        ariaLabel="Time period"
        options={ACTIVITY_PERIOD_OPTIONS}
        // All nine periods at once, rather than six and a scroll inside the menu.
        menuMaxHeight={360}
        value={period}
        onChange={setPeriod}
        custom={customRange}
        onCustomChange={setCustomRange}
        customError={rangeError}
        withTime
      />}
      actions={<><TableBoardSwitch value={layout} onChange={setLayout} /><IconButton label="Refresh activity log" onClick={() => void load()} disabled={loading || !customReady}>
        <RefreshRounded fontSize="small" aria-hidden="true" className={loading ? "animate-spin motion-reduce:animate-none" : ""} />
      </IconButton></>}
    />
    <div className="min-h-0 flex-1">
      <DataTableShell
        className="h-full min-h-0"
      >
        <div className="relative flex min-h-0 flex-1 overflow-hidden">
          <div className="flex min-h-0 min-w-0 flex-1">
            {onBoard ? <KanbanBoard
              rows={shownRows}
              columns={columnsFromRows(shownRows, (row) => row.module)}
              statusOf={(row) => groupValue(row.module)}
              // How many of the module's requests were refused or failed (a response of 400 or above).
              columnAmount={(rows) => columnCount(rows, (row) => Boolean(logFlag(row)), "Failed")}
              cardFlag={logFlag}
              card={{
                title: (row) => row.action || "-",
                subtitle: (row) => [row.username, formatLogTime(row.createdAt)].filter(Boolean).join(" · "),
                meta: (row) => [row.method, statusLabel(row)].filter(Boolean).join(" · "),
              }}
              getRowId={(row) => String(row.id)}
              onOpen={openLine}
              viewOnly="The activity log is a record of what happened, so its entries cannot be moved."
              loading={loading && customReady}
              noun="log lines"
              filtered={filtered}
              ariaLabel="User activity logs board"
            /> : <DataTable
              columns={columns}
              // Nothing under Custom range until both ends are set, rather than the previous period's
              // rows sitting under a switch that no longer describes them.
              data={shownRows}
              density={density}
              loading={loading && customReady}
              loadingMessage="Loading activity..."
              emptyMessage={emptyMessage}
              noMatchMessage={emptyMessage}
              selectedRowId={infoRow?.id}
              onRowClick={openLine}
              ariaLabel="User activity logs table"
              columnOrderKey="admin-activity-logs"
              features={{
                filtering: true,
                // Filtered and sorted by the server, over the whole period rather than the page in
                // hand - see `serverFiltered` and `controlledSort` in DataTable.
                onColumnFilters: setColumnFilters,
                filters: columnFilters,
                // A press that would leave the log unsorted goes back to newest first instead.
                sorting: { sort, onChange: (next) => setSort(next || DEFAULT_ACTIVITY_SORT) },
                columnVisibility: true,
                infiniteScroll: { onEndReached: loadMore },
                // Fixed widths, stretched to the pane on a wide screen - see `fillLayout` in DataTable.
                layout: "fill",
                // Both exports are the server's, over the whole filtered log - see `exportLog`.
                csvExport: { onExport: () => exportLog("csv") },
                excelExport: { onExport: () => exportLog("xlsx") },
              }}
            />}
          </div>
          <DataTableInfoPanel
            title="Info"
            entity={infoRow}
            sections={activityLogInfoSections}
            formatters={infoFormatters}
            emptyText="Select a log to see details"
            state={infoPanelState}
            onToggle={() => setInfoPanelState((current) => (current === "expanded" ? "collapsed" : "expanded"))}
          />
        </div>
      </DataTableShell>
    </div>
    <FloatingNotice notice={notice} onClose={clearNotice} />
  </section>;
}
