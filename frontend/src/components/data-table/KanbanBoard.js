"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import FloatingNotice, { useNotice } from "@/components/shared/FloatingNotice";
import Loader from "@/components/shared/Loader";
import { ColumnAmount, ColumnSearch, ColumnTrendBar, ColumnTrendMark, useColumnPeriod, useColumnTrend } from "./KanbanSummary";
import { matchesWordChunks } from "@/lib/wordChunks.mjs";
import { defaultDateOf, periodWhen, rowsInPeriod } from "@/lib/kanbanSummary.mjs";
import { chipsOf, initialsOf, inkOf, tint, toneOf } from "@/lib/boardTone.mjs";
import { copyToClipboard } from "@/lib/clipboard";
import useEscapeKey from "@/components/shared/useEscapeKey";
import OptionsMenu from "@/components/ui/OptionsMenu";
import useInfiniteScroll from "@/components/shared/useInfiniteScroll";
import { edgeScrollSpeed } from "@/lib/dragEdgeScroll.mjs";
import IconButton from "@/components/shared/IconButton";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";

// The column a row whose status matches none of the board's columns is shown in (see `byColumn`).
const OTHER_COLUMN = { value: "__other__", label: "Other", className: "bg-slate-400 text-white" };

/**
 * Any table's rows stood up in columns by status - the Board half of a Table / Board switch.
 *
 * The CRM's board (`sales/CrmKanbanBoard`) asks the server for each column, because the CRM pages
 * its leads. Every other table here already holds its rows, so this one is handed them - the very
 * rows the table is showing, after the page's own tabs, search and narrowing - and only sorts them
 * into columns. The look, the drag and the edge scroll are the CRM board's, so the two read as one.
 *
 * ── A view, not a second editor ──
 *
 * Nothing here writes. A card opens the record (`onOpen`), which is where it has always been
 * changed. Dragging a card to a column is offered only where the page says that move is one of the
 * record's own actions (`canDropAt`), and dropping hands it back to the page (`onDrop`) to run that
 * action exactly as its menu would - with whatever remark or confirmation it always asks for.
 *
 * @param rows       The rows to show.
 * @param columns    `[{ value, label?, className? }]` - one column per status, in order.
 * @param statusOf   `(row) => value` - which column a row stands in.
 * @param card       `{ title(row), subtitle?(row), meta?(row) }` - the lines a card shows.
 * @param canDropAt  `(row, value) => boolean` - whether this row may be dropped on that column.
 * @param onDrop     `(row, value)` - run the record's own action for that move.
 * @param canOpen    `(row) => boolean` - optional; a card it refuses is drawn as text, not a button.
 * @param cardActions `(row) => items` - optional; the card's ⋮, the same items as its table row's
 *                   ⋮ (`OptionsMenu` items). Nothing, or an empty list, draws no ⋮ on that card.
 *                   `cardMenuProps` go to that ⋮'s `OptionsMenu` - the layer that lifts it over a
 *                   dialog or panel (`menuZIndexClassName` or `zIndex`), as the row's ⋮ is lifted.
 *                   Without items a card that opens offers `openLabel` ("View"); every card ends with
 *                   Copy details, so every card has a ⋮.
 * @param cardFlag   `(row, column) => text` - optional; an amber tag on the card saying why it is
 *                   counted in the column's figure ("Not updated 15 days"). Nothing draws none.
 * @param viewOnly   A board whose columns nothing on the screen can change (a log, a report, a
 *                   status worked out elsewhere): the sentence saying so and where it is changed.
 * @param refusalFor `(row, value) => string` - optional; why this card cannot go to that column.
 * @param summary    The small dashboard in each column (`KanbanSummary`): on unless `false`.
 * @param dateOf     `(row) => ms | null` - when a card came in, for the summary's trend; by
 *                   default when the record was made.
 * @param screenKey  Names the board for the summary's remembered period.
 *
 * Every card can be carried on every board, and every column takes the drop. A column the card may
 * really go to is outlined blue while it is carried; dropping anywhere else does nothing to the
 * record and says why (`refusalFor`, else `viewOnly`, else a plain "cannot be moved there") - a
 * drop that silently snapped back read as the board being broken.
 */

const COLUMN_PAGE = 30;
const rowKey = (row, getRowId) => String(getRowId ? getRowId(row) : row?.id);

/** What a row with nothing in the grouping column stands under. */
export const NO_VALUE = "—";

/**
 * Columns for a table with no status of its own, grouped instead by a category it does carry -
 * vertical, branch, department, type, role. One column per value the rows actually hold, in
 * `order` where given (values not in it follow, A to Z), blanks last under "—". Use with
 * `statusOf={(row) => groupValue(valueOf(row))}` so a blank lands in that column.
 */
export const groupValue = (value) => (value === null || value === undefined || String(value).trim() === "" ? NO_VALUE : String(value));
export function columnsFromRows(rows, valueOf, { order = [], className } = {}) {
  const present = [...new Set((rows || []).map((row) => groupValue(valueOf(row))))];
  const known = order.filter((value) => present.includes(value));
  const rest = present.filter((value) => !order.includes(value) && value !== NO_VALUE).sort((a, b) => a.localeCompare(b));
  return [...known, ...rest, ...(present.includes(NO_VALUE) ? [NO_VALUE] : [])].map((value) => ({ value, className }));
}

export default function KanbanBoard({ rows = [], columns = [], statusOf, card, getRowId, onOpen, canOpen, cardActions, cardMenuProps, openLabel = "View", cardFlag, canDropAt, onDrop, viewOnly = "", refusalFor, summary = true, dateOf, screenKey, loading = false, noun = "records", filtered = false, ariaLabel = "Board", totals = null, columnAmount }) {
  const [dragging, setDragging] = useState(null);
  const { notice, showNotice, clearNotice } = useNotice();
  const refuse = useCallback((row, column) => {
    const name = card.title(row) || "This card";
    const label = column.label || column.value;
    showNotice(refusalFor?.(row, column.value) || viewOnly || `${name} cannot be moved to ${label} from here.`);
  }, [card, refusalFor, showNotice, viewOnly]);
  const [hoveredColumn, setHoveredColumn] = useState(null);
  /*
   * Every card's ⋮, on every board. The screen's own items where it gives some (`cardActions`, the
   * table row's ⋮); else, where the card opens something, that one thing (`openLabel` - View, or
   * Download, or Edit); and on every card, last, **Copy details** - its title, subtitle and chips as
   * lines, ready to paste into a message. So no card is ever without a ⋮.
   */
  const cardMenu = useCallback((row, opener) => {
    const own = cardActions?.(row);
    const items = Array.isArray(own) && own.length ? own : opener ? [{ label: openLabel, onSelect: () => opener(row) }] : [];
    const copy = async () => {
      const text = [card.title(row), card.subtitle?.(row), ...chipsOf(card.meta?.(row))].filter(Boolean).join("\n");
      showNotice(await copyToClipboard(text) ? `Copied ${card.title(row) || "the card's details"}.` : "Could not copy - select the text and copy it by hand.");
    };
    return [...items, ...(items.length ? [{ separator: true }] : []), { label: "Copy details", onSelect: () => void copy() }];
  }, [card, cardActions, openLabel, showNotice]);
  const carrying = Boolean(dragging);
  const railRef = useRef(null);
  /*
   * Which ways the rail can still scroll, for the ‹ › buttons at its edges. A board wider than the
   * screen used to hide its far columns behind a scrollbar macOS does not draw for a mouse, so with
   * no trackpad there was no visible way to reach them. Measured on scroll and on resize.
   */
  const [canScroll, setCanScroll] = useState({ left: false, right: false });
  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return undefined;
    const measure = () => {
      const left = rail.scrollLeft > 4;
      const right = rail.scrollLeft + rail.clientWidth < rail.scrollWidth - 4;
      setCanScroll((current) => (current.left === left && current.right === right ? current : { left, right }));
    };
    measure();
    rail.addEventListener("scroll", measure, { passive: true });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(rail);
    return () => { rail.removeEventListener("scroll", measure); observer?.disconnect(); };
  }, [columns.length, loading]);
  // One press moves most of a screen's worth of columns, keeping one in view for context.
  const scrollRail = (direction) => {
    const rail = railRef.current;
    rail?.scrollBy({ left: direction * Math.max(320, rail.clientWidth - 360), behavior: "smooth" });
  };
  const edgeScroll = useRef({ frame: 0, speed: 0 });

  /*
   * One pass over the rows, so every column reads from the same moment.
   *
   * A row whose status is none of the columns - a value added to a list since the board was written,
   * an old record's spelling - goes into **Other**, a column at the end drawn only while it holds
   * something. It used to be dropped, and a board that silently leaves records out reads as complete
   * when it is not.
   */
  const byColumn = useMemo(() => {
    const groups = Object.fromEntries(columns.map((column) => [column.value, []]));
    groups[OTHER_COLUMN.value] = [];
    for (const row of rows) {
      const value = statusOf(row);
      (groups[value] && value !== OTHER_COLUMN.value ? groups[value] : groups[OTHER_COLUMN.value]).push(row);
    }
    return groups;
  }, [columns, rows, statusOf]);
  const shownColumns = byColumn[OTHER_COLUMN.value].length ? [...columns, OTHER_COLUMN] : columns;
  /*
   * A board that holds only the pages read so far can be handed the server's count per status
   * (`totals`), so a column says "40 of 212" rather than a 40 that reads as the whole. Other's total
   * is every counted status no column names.
   */
  const columnTotals = useMemo(() => {
    if (!totals || typeof totals !== "object") return null;
    const named = new Set(columns.map((column) => column.value));
    const result = Object.fromEntries(columns.map((column) => [column.value, Number(totals[column.value]) || 0]));
    result[OTHER_COLUMN.value] = Object.entries(totals).reduce((sum, [value, count]) => (named.has(value) ? sum : sum + (Number(count) || 0)), 0);
    return result;
  }, [columns, totals]);

  // Each column draws its own trend, period switch and line (`ColumnSummary`) - only on a board
  // whose rows carry a date at all, so one that cannot measure a trend shows none rather than zeros.
  const readDate = dateOf || defaultDateOf;
  const showSummary = summary && !loading && rows.some((row) => readDate(row) !== null && readDate(row) !== undefined);

  // While a card is carried near the rail's left or right edge, the rail scrolls towards it.
  const stopEdgeScroll = useCallback(() => {
    if (edgeScroll.current.frame) window.cancelAnimationFrame(edgeScroll.current.frame);
    edgeScroll.current = { frame: 0, speed: 0 };
  }, []);
  const followDrag = useCallback((event) => {
    if (!railRef.current) return stopEdgeScroll();
    const speed = edgeScrollSpeed(railRef.current.getBoundingClientRect(), event.clientX, event.clientY, { axis: "x" });
    if (!speed) return stopEdgeScroll();
    const running = edgeScroll.current.speed !== 0;
    edgeScroll.current.speed = speed;
    if (running) return undefined;
    const step = () => {
      const rail = railRef.current;
      if (!rail || !edgeScroll.current.speed) return stopEdgeScroll();
      const before = rail.scrollLeft;
      rail.scrollLeft = before + edgeScroll.current.speed;
      if (rail.scrollLeft === before) return stopEdgeScroll();
      edgeScroll.current.frame = window.requestAnimationFrame(step);
      return undefined;
    };
    edgeScroll.current.frame = window.requestAnimationFrame(step);
    return undefined;
  }, [stopEdgeScroll]);
  useEffect(() => {
    if (!carrying) return undefined;
    const leaveWindow = (event) => { if (!event.relatedTarget) stopEdgeScroll(); };
    document.addEventListener("dragover", followDrag);
    document.addEventListener("dragleave", leaveWindow);
    return () => {
      document.removeEventListener("dragover", followDrag);
      document.removeEventListener("dragleave", leaveWindow);
      stopEdgeScroll();
    };
  }, [carrying, followDrag, stopEdgeScroll]);
  const release = useCallback(() => { setDragging(null); setHoveredColumn(null); }, []);
  useEffect(() => {
    if (!carrying) return undefined;
    window.addEventListener("dragend", release);
    window.addEventListener("drop", release);
    return () => {
      window.removeEventListener("dragend", release);
      window.removeEventListener("drop", release);
    };
  }, [carrying, release]);
  useEscapeKey(release, carrying);

  // Grouped by what the rows hold, a board with no rows has no columns: say so, rather than a blank.
  if (!loading && !columns.length) return <div role="region" aria-label={ariaLabel} className="flex min-h-40 flex-1 items-center justify-center p-6 text-center text-sm text-slate-500">
    {filtered ? `No ${noun} match your filters.` : `No ${noun} to show.`}
  </div>;

  return <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
    {/* A visible thin scrollbar - drawn whatever the system's setting - so the columns past the
        screen's edge are always reachable, as well as by the arrows below. */}
    <div ref={railRef} role="region" aria-label={ariaLabel} className="flex min-h-0 min-w-0 flex-1 gap-3 overflow-x-auto p-3 [&::-webkit-scrollbar]:h-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300 [&::-webkit-scrollbar-track]:bg-transparent">
    {shownColumns.map((column) => <KanbanColumn
      key={column.value}
      column={column}
      rows={byColumn[column.value] || []}
      columnAmount={columnAmount}
      card={card}
      getRowId={getRowId}
      onOpen={onOpen}
      canOpen={canOpen}
      cardMenu={cardMenu}
      cardMenuProps={cardMenuProps}
      cardFlag={cardFlag}
      loading={loading}
      noun={noun}
      filtered={filtered}
      summary={showSummary ? { dateOf: readDate, screenKey: screenKey || ariaLabel } : null}
      boardTotal={rows.length}
      total={columnTotals ? columnTotals[column.value] : null}
      dragging={dragging}
      onDrag={(next) => { setDragging(next); if (!next) setHoveredColumn(null); }}
      // Never the column it came from: dropping a card where it already is is not a move.
      // Nothing is moved into Other: it is where a record no column fits is shown, not a status.
      takesDrop={Boolean(dragging) && dragging.status !== column.value && column !== OTHER_COLUMN}
      allowsDrop={Boolean(dragging) && dragging.status !== column.value && column !== OTHER_COLUMN && Boolean(canDropAt?.(dragging.row, column.value))}
      onRefuse={refuse}
      hovered={hoveredColumn === column.value}
      onHover={setHoveredColumn}
      onDrop={onDrop}
    />)}
    </div>
    {canScroll.left && <IconButton label="Scroll to the columns on the left" shape="circle" size="md" onClick={() => scrollRail(-1)} className="absolute left-1 top-1/2 z-20 -translate-y-1/2 border border-slate-200 bg-white/95 text-slate-600 shadow-md hover:bg-white"><ChevronLeftIcon aria-hidden="true" /></IconButton>}
    {canScroll.right && <IconButton label="Scroll to the columns on the right" shape="circle" size="md" onClick={() => scrollRail(1)} className="absolute right-1 top-1/2 z-20 -translate-y-1/2 border border-slate-200 bg-white/95 text-slate-600 shadow-md hover:bg-white"><ChevronRightIcon aria-hidden="true" /></IconButton>}
    <FloatingNotice notice={notice} onClose={clearNotice} />
  </div>;
}

function KanbanColumn({ column, rows: columnRows, card, getRowId, onOpen, canOpen, cardMenu, cardMenuProps, cardFlag, loading, noun, filtered, summary, boardTotal = 0, total = null, dragging, onDrag, takesDrop, allowsDrop, onRefuse, hovered, onHover, onDrop, columnAmount }) {
  const label = column.label || column.value;
  const tone = toneOf(column.className);
  // The column's own period (`ColumnSummary`): "All" shows every card, a period only those that
  // came in during it - the same cards its trend counts.
  const { period, setPeriod } = useColumnPeriod(summary?.screenKey, column.value);
  const narrowed = Boolean(summary) && period !== "all";
  const columnTrend = useColumnTrend({ rows: columnRows, column, dateOf: summary?.dateOf, period });
  const periodRows = useMemo(() => (narrowed ? rowsInPeriod(columnRows, period, summary.dateOf) : columnRows), [columnRows, narrowed, period, summary]);
  // The column's own search: every word typed, found anywhere in what its card shows.
  const [query, setQuery] = useState("");
  const rows = useMemo(() => (query.trim()
    ? periodRows.filter((row) => matchesWordChunks([card.title(row), card.subtitle?.(row), card.meta?.(row)].filter(Boolean).join(" "), query))
    : periodRows), [card, periodRows, query]);
  const searching = Boolean(query.trim());
  const scrollerRef = useRef(null);
  // The column draws its cards a page at a time as it is scrolled, so a status holding hundreds
  // of rows does not draw them all at once.
  const [shown, setShown] = useState(COLUMN_PAGE);
  const visible = rows.slice(0, shown);
  const sentinelRef = useInfiniteScroll({
    onLoadMore: () => setShown((count) => count + COLUMN_PAGE),
    hasMore: shown < rows.length,
    loading: false,
    count: visible.length,
    rootRef: scrollerRef,
    resetKey: `${column.value}-${period}-${query}`,
  });
  const isOver = allowsDrop && hovered;
  // A money figure over the cards the column is showing - narrowed by its period and search, as its count is.
  const amount = columnAmount ? columnAmount(rows, column) : null;
  const laneCount = <LaneCount
    tone={tone}
    // A dash until the rows are known, rather than a 0 that would read as "none here".
    count={loading ? null : rows.length}
    // Narrowed, the lane is measured against what it holds; otherwise against the server's count
    // where the board has not read every card the column has.
    of={narrowed || searching ? columnRows.length : total !== null && total > columnRows.length ? total : null}
    share={loading || !boardTotal ? 0 : columnRows.length / boardTotal}
  />;

  return <section
    aria-label={`${label}, ${loading ? "loading" : rows.length} ${noun}`}
    data-column={column.value}
    onDragOver={takesDrop ? ((event) => { event.preventDefault(); onHover(column.value); }) : undefined}
    onDragLeave={takesDrop ? ((event) => { if (!event.currentTarget.contains(event.relatedTarget)) onHover(null); }) : undefined}
    onDrop={takesDrop ? ((event) => {
      event.preventDefault();
      if (allowsDrop) onDrop?.(dragging.row, column.value);
      else onRefuse(dragging.row, column);
      onDrag(null);
    }) : undefined}
    // A glass lane: the status colour only as the line along the top and a light wash, so twenty
    // columns of cards read as cards rather than as a row of coloured bars.
    style={{ borderTopColor: tone, backgroundImage: `linear-gradient(${tint(tone, 0.05)}, ${tint(tone, 0.05)})` }}
    className={`flex min-h-0 w-[18rem] shrink-0 flex-col overflow-hidden rounded-xl border bg-slate-50 border-t-[3px] transition max-sm:w-[85vw] ${isOver ? "border-blue-500 ring-2 ring-blue-200" : allowsDrop ? "border-blue-300 border-dashed" : "border-slate-200"}`}
  >
    {/* The header's corner: the trend's arrow where there is a trend, then the count. */}
    {columnTrend
      ? <>
        <LaneHeader label={label} mark={<span className="flex shrink-0 items-center gap-1.5"><ColumnTrendMark trend={columnTrend.trend} noun={noun} period={period} />{laneCount}</span>} />
        <ColumnTrendBar name={label} period={period} setPeriod={setPeriod} aside={amount ? <ColumnAmount {...amount} /> : null} />
      </>
      : <>
        <LaneHeader label={label} mark={laneCount} />
        {amount && <div className="flex shrink-0 justify-end px-3 pb-1"><ColumnAmount {...amount} /></div>}
      </>}
    {!loading && columnRows.length > 0 && <ColumnSearch name={label} noun={noun} value={query} onChange={setQuery} />}
    <div ref={scrollerRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
      {loading && <Loader label={`Reading ${label}…`} />}
      {!loading && rows.length === 0 && <p className="flex h-full min-h-20 items-center justify-center px-3 text-center text-xs text-slate-500">
        {searching && periodRows.length ? `No ${noun} here match "${query.trim()}".` : narrowed && columnRows.length ? `No ${noun} came in here ${periodWhen(period)}.` : filtered ? `No ${noun} here match your filters.` : `No ${noun} here.`}
      </p>}
      {!loading && visible.map((row) => {
        const opener = onOpen && (!canOpen || canOpen(row)) ? onOpen : undefined;
        return <BoardCard key={rowKey(row, getRowId)} row={row} card={card} tone={tone} status={column.value} onOpen={opener} actions={cardMenu(row, opener)} menuProps={cardMenuProps} flag={cardFlag?.(row, column) || ""} onDrag={onDrag} />;
      })}
      {!loading && shown < rows.length && <div ref={sentinelRef} className="py-2"><Loader label="Loading more…" /></div>}
    </div>
  </section>;
}

/*
 * One card. `actions` is the card's ⋮ - the same items its table row's ⋮ offers (`cardActions` on
 * the board), so a card can be acted on without going back to the table. The card and its ⋮ are two
 * buttons side by side in one frame - a button cannot hold another - and the frame is what is
 * dragged. A card with no items has no ⋮. The menu is the `compact` one: a card is small, and the
 * table's full-size menu over it read as too big.
 */
function BoardCard({ row, card, tone, status, onOpen, actions, menuProps, flag = "", onDrag }) {
  const title = card.title(row);
  const subtitle = card.subtitle?.(row);
  const chips = chipsOf(card.meta?.(row));
  // A card that opens nothing is not offered as a button - it reads, and can still be carried.
  const Tag = onOpen ? "button" : "div";
  const menu = Array.isArray(actions) && actions.length > 0;
  return <div
    draggable
    onDragStart={(event) => {
      event.dataTransfer.setData("text/plain", String(row?.id ?? ""));
      event.dataTransfer.effectAllowed = "move";
      onDrag({ row, status });
    }}
    onDragEnd={() => onDrag(null)}
    style={{ borderLeftColor: tone }}
    className={`flex w-full items-start rounded-xl border border-l-[3px] border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition active:scale-[0.99] ${onOpen ? "hover:border-slate-300 hover:shadow-md" : ""}`}
  >
    <Tag
      {...(onOpen ? { type: "button", "aria-label": `Open ${title || "record"}`, onClick: () => onOpen(row) } : {})}
      className={`flex min-w-0 flex-1 gap-2.5 rounded-xl p-2.5 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 ${menu ? "pr-1" : ""}`}
    >
      {/* Who or what the card is, at a glance: initials in the column's own colour. */}
      <span aria-hidden="true" style={{ backgroundColor: tint(tone, 0.14), color: inkOf(tone) }} className="flex size-8 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold">{initialsOf(title)}</span>
      <span className="min-w-0 flex-1">
        {/* Every line wraps rather than truncating: "Employee Submission Pendi…" or "Business Developm…"
            is half a fact, and the card is where the person reads it. */}
        <span className="block break-words text-sm font-medium leading-snug text-slate-800">{title || "—"}</span>
        {subtitle && <span className="mt-0.5 block break-words text-[11px] leading-snug text-slate-500">{subtitle}</span>}
        {chips.length > 0 && <span className="mt-1.5 flex flex-wrap gap-1">
          {chips.map((chip) => <span key={chip} className="max-w-full break-words rounded-md bg-slate-100 px-1.5 py-0.5 text-[10.5px] font-medium text-slate-600">{chip}</span>)}
        </span>}
        {/* Why this card is counted in its column's figure - "Not updated 15 days" - so the figure
            always points at the cards it means. */}
        {flag && <span className="mt-1.5 inline-flex max-w-full items-start gap-1 break-words rounded-md bg-amber-50 px-1.5 py-0.5 text-[10.5px] font-medium text-amber-800 ring-1 ring-amber-200"><span aria-hidden="true">⚠</span>{flag}</span>}
      </span>
    </Tag>
    {menu && <span className="shrink-0 p-1.5"><OptionsMenu ariaLabel={`Actions for ${title || "record"}`} items={actions} compact {...menuProps} /></span>}
  </div>;
}

/** A lane's header: its name, and in the corner its `mark` - the trend's arrow where there is one, then the count. */
export function LaneHeader({ label, mark = null }) {
  // The name wraps rather than truncating: "Employee Submission Pen…" names no column.
  return <h3 className="flex shrink-0 items-start justify-between gap-2 px-3 pb-1 pt-2">
    <span className="min-w-0 break-words text-sm font-semibold leading-snug text-slate-800">{label}</span>
    {mark}
  </h3>;
}

/**
 * A lane's figure, the one that stands out on the board - how many cards stand in it, beside a
 * small ring of its share of every card on the board. While a period or a search narrows the lane
 * it reads "2 of 18", so the hidden cards are never mistaken for absent ones.
 */
export function LaneCount({ tone, count, of = null, share = null }) {
  const radius = 6.5;
  const around = 2 * Math.PI * radius;
  return <span className="flex shrink-0 items-center gap-1.5" title={of !== null ? `${count} of the ${of} in this column` : share !== null ? `${Math.round(share * 100)}% of the cards on this board` : undefined}>
      <span className="text-sm font-semibold leading-none tabular-nums text-slate-800">{count === null ? "—" : count}</span>
      {of !== null && <span className="text-[11px] font-medium text-slate-500">of {of}</span>}
      {/* The ring is left off where the board cannot know its whole (the CRM pages its leads). */}
      {share !== null && <svg aria-hidden="true" width="18" height="18" viewBox="0 0 18 18" className="-rotate-90">
        <circle cx="9" cy="9" r={radius} fill="none" stroke={tint(tone, 0.18)} strokeWidth="2.5" />
        <circle cx="9" cy="9" r={radius} fill="none" stroke={tone} strokeWidth="2.5" strokeLinecap="round" strokeDasharray={`${(share * around).toFixed(2)} ${around.toFixed(2)}`} />
      </svg>}
    </span>;
}
