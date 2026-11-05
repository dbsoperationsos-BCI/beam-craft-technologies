"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Button from "@/components/shared/Button";
import FloatingNotice, { useNotice } from "@/components/shared/FloatingNotice";
import { copyToClipboard } from "@/lib/clipboard";
import OptionsMenu from "@/components/ui/OptionsMenu";
import Loader from "@/components/shared/Loader";
import useInfiniteScroll from "@/components/shared/useInfiniteScroll";
import useEscapeKey from "@/components/shared/useEscapeKey";
import { edgeScrollSpeed } from "@/lib/dragEdgeScroll.mjs";
import { ColumnAmount, ColumnSearch, ColumnTrendBar, ColumnTrendMark, useColumnPeriod } from "@/components/data-table/KanbanSummary";
import { LaneCount, LaneHeader } from "@/components/data-table/KanbanBoard";
import { initialsOf, inkOf, tint, toneOf } from "@/lib/boardTone.mjs";
import { periodRanges } from "@/lib/kanbanSummary.mjs";

/**
 * The CRM's leads, stood up in columns by status.
 *
 * A salesperson works a **pipeline**, and a table sorted by its Status column is not one - it is a list
 * you have to read before you can see the shape of the work. The board is that shape: how many are
 * waiting on a follow-up, how many are interested and untouched, what is left to convert.
 *
 * ── A view, not a second editor ──
 *
 * Nothing here writes, dragging included. A card opens the lead popup, which is where a lead has always
 * been changed, so there is one editor and one set of rules about remarks and reasons.
 *
 * **Dragging a card to a column does not move its stage.** It opens that lead's popup with the target
 * status *drafted*, and the save that follows is the ordinary one - it refuses without a remark, so the
 * register can still say why the lead moved. Moving a stage with no reason recorded is the one thing
 * this CRM refuses everywhere else, and a board that quietly allowed it would be the hole in that rule.
 *
 * ── Dumb, like the lead popup ──
 *
 * It imports no service. Everything it draws arrives through `fetchColumn`, which the page builds from
 * the same query the table runs with the column's status added - so every narrowing the table honours
 * comes free: the data scope, the branch reach, the vertical, the search box, the column filters, the
 * date range and the My Leads switch.
 *
 * @param columns     `{ value, className }` from the module's own status list, so a status reads the
 *                    same word in the same colour here, on the pills and in the table.
 * @param fetchColumn `(status, offset, limit) => Promise<{ data, total }>`.
 * @param onOpenLead  What a card's double-click opens - the lead popup the table's rows open.
 * @param leadActions `(lead) => items` - optional; the card's ⋮, the same `OptionsMenu` items as the
 *                    table row's ⋮. Nothing, or an empty list, draws no ⋮ on that card.
 */

/** Enough to fill a column on a laptop without asking for a page nobody scrolls to. */
const COLUMN_PAGE = 25;

export default function CrmKanbanBoard({ columns = [], fetchColumn, onOpenLead, leadActions, filtered = false, refreshKey = 0, canDropAt, onDropLead }) {
  /*
   * Every lead card's ⋮, as every other board's (`KanbanBoard`'s `cardMenu`): the table row's items,
   * else View, and last Copy details - the name, ID, number and next follow-up, ready to paste.
   */
  const { notice, showNotice, clearNotice } = useNotice();
  const leadMenu = useCallback((lead) => {
    const own = leadActions?.(lead);
    const items = Array.isArray(own) && own.length ? own : onOpenLead ? [{ label: "View", onSelect: () => onOpenLead(lead) }] : [];
    const copy = async () => {
      const text = [lead.name, lead.id, lead.contactNumber || lead.phone, lead.nextFollowUpDate ? `Next: ${lead.nextFollowUpDate}` : ""].filter(Boolean).join("\n");
      showNotice(await copyToClipboard(text) ? `Copied ${lead.name || "the lead's details"}.` : "Could not copy - select the text and copy it by hand.");
    };
    return [...items, ...(items.length ? [{ separator: true }] : []), { label: "Copy details", onSelect: () => void copy() }];
  }, [leadActions, onOpenLead, showNotice]);
  /*
   * ── Dragging a lead to a status ───────────────────────────────────────────────────────────────
   *
   * The board still writes nothing. A drop **opens the lead popup with the target status drafted**, so
   * what follows is the ordinary save: it refuses without a remark, and the register can still say why
   * the lead moved. The drag is a way of reaching the editor with the answer already filled in, not a
   * second way of changing a lead - which is what kept this board read-only in the first place.
   *
   * Held here rather than in each column because every column needs to know what is in the air: the
   * one it came from must not offer itself, and a column that cannot take it must not pretend it can.
   */
  const [dragging, setDragging] = useState(null);
  /*
   * Which column the pointer is actually over.
   *
   * Eligibility and hover are two different questions, and lighting every eligible column answered the
   * wrong one: six or seven lanes lit the moment a drag began, which says "any of these" when what the
   * dragger is asking is "this one?". Eligibility decides whether a drop is possible; this decides what
   * is shown.
   */
  const [hoveredColumn, setHoveredColumn] = useState(null);
  /** Whether a card is in the air at all, which is what the drag's listeners and loop live for. */
  const carrying = Boolean(dragging);
  /*
   * ── The rail moves itself while a card is in the air ──────────────────────────────────────────
   *
   * A browser does not scroll a nested scroller for a drag of its own accord, and these columns are a
   * rail wider than the screen - so the statuses off the right edge could not be reached at all. The
   * card could be held against the edge for as long as you liked and the board would not move. It is
   * also the one moment a reader cannot scroll for themselves: both hands are busy holding the card.
   *
   * **How fast is not this board's question.** `lib/dragEdgeScroll.mjs` already answers it for the data
   * table's columns and the Sidebar Layout editor's rows - the same gesture on both axes - so the board
   * asks that for the `x` axis and owns only the frame loop that moves the rail, which is the division
   * that file sets out. A third answer written here would be a third feel for one gesture.
   *
   * **Read from the document, not from the rail.** `dragover` on an element stops firing the moment the
   * pointer leaves it, and a little past the right-hand edge is exactly where somebody pushes when they
   * want more board - so a listener on the rail froze the scroll at the point the gesture was asking
   * for it hardest, which is what made it work one time and not the next. The shared rule counts
   * past-the-edge as full speed and reads the other axis to decide the pointer has genuinely left.
   */
  const railRef = useRef(null);
  const edgeScroll = useRef({ frame: 0, speed: 0 });
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
    /*
     * One loop however fast it becomes: the running one reads the new speed off the ref on its next
     * frame, and starting a second would scroll the rail at the sum of the two.
     */
    if (running) return undefined;
    const step = () => {
      const rail = railRef.current;
      if (!rail || !edgeScroll.current.speed) return stopEdgeScroll();
      const before = rail.scrollLeft;
      rail.scrollLeft = before + edgeScroll.current.speed;
      // The end of the rail. Giving up here rather than queueing frames that move nothing means a card
      // parked against the edge costs nothing once there is no more board to reveal.
      if (rail.scrollLeft === before) return stopEdgeScroll();
      edgeScroll.current.frame = window.requestAnimationFrame(step);
      return undefined;
    };
    edgeScroll.current.frame = window.requestAnimationFrame(step);
    return undefined;
  }, [stopEdgeScroll]);
  // Bound only while a card is actually in the air, and torn down with the scroll it drives, so a
  // board sitting still listens for nothing.
  useEffect(() => {
    if (!carrying) return undefined;
    /*
     * Carried out of the browser, the scroll stops.
     *
     * Outside the window no `dragover` arrives at all, and the loop reads its speed off a ref - so the
     * last speed the pointer asked for would go on being obeyed, and a card taken out over the desktop
     * would leave the rail scrolled hard against its end for no reason the reader could see. A
     * `dragleave` with no `relatedTarget` is the drag leaving the document itself, which is the one
     * moment nothing else will say so; coming back in, the next `dragover` starts the loop again.
     */
    const leaveWindow = (event) => { if (!event.relatedTarget) stopEdgeScroll(); };
    document.addEventListener("dragover", followDrag);
    document.addEventListener("dragleave", leaveWindow);
    return () => {
      document.removeEventListener("dragover", followDrag);
      document.removeEventListener("dragleave", leaveWindow);
      stopEdgeScroll();
    };
  }, [carrying, followDrag, stopEdgeScroll]);
  /*
   * ── Letting go of the card, however it is let go of ───────────────────────────────────────────
   *
   * `dragend` fires on the element the drag **started** from, and that element is not always still
   * there to hear it - a column re-reads itself, the card is re-keyed, and the event lands on nothing.
   * Esc is where that showed: the browser cancels the drag without a drop, nothing told the board, and
   * the state stayed set with no card in the air - the column under the pointer kept its ring, every
   * eligible column went on believing a drop was coming, and the rail kept scrolling itself at the
   * edge. There was nothing left to drop, so there was no way out of it either.
   *
   * The window hears the end of a drag whatever it started on and whatever became of that node since:
   * a cancel, a drop anywhere on the page, a card let go of outside the window entirely. Releasing a
   * card that is already released is the same as not releasing one.
   */
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
  /*
   * And Escape through the application's own stack, for the browsers that deliver the key press while
   * a drag is running - registered only while a card is actually in the air, so the board takes its
   * turn above whatever else is open and gives it straight back.
   */
  useEscapeKey(release, carrying);
  /*
   * ── The columns come in the order they are given ──────────────────────────────────────────────
   *
   * The board draws `columns` as handed to it, which is the pipeline's own order: nobody's leads,
   * then the ones not yet rung, then the ones being worked, then the ways a lead ends. The page
   * decides it (`pipelineColumns` in `CRMPage.js`), this being the part that knows what a status
   * means; the board knows only that they are columns.
   *
   * It used to sort them by **how many were in them**, largest first, and re-sort as the counts
   * arrived. Two things were wrong with that. A pipeline has an order of its own and reading it out
   * of sequence tells you nothing about the pipeline - "where does a lead go next" is not a question
   * the biggest column answers. And it would not keep still: seven columns answer at seven different
   * moments, so the board visibly re-sorted itself as they landed, and a column could move out from
   * under somebody reading it.
   */

  /*
   * `min-w-0` matters: a flex child defaults to `min-width: auto`, so without it the board grows past
   * its container instead of scrolling when the info panel opens beside it.
   */
  return <div ref={railRef} className="flex min-h-0 min-w-0 flex-1 gap-3 overflow-x-auto p-3">
    <FloatingNotice notice={notice} onClose={clearNotice} />
    {/* Keyed on the status, which is what a column *is*. Keyed on its position, React would reuse each
        slot for whatever status moved into it - so every column would throw away its leads, its paging
        and its scroll the moment two counts crossed, and fetch them all again. */}
    {columns.map((column) => (
      <KanbanColumn
        key={column.value}
        column={column}
        fetchColumn={fetchColumn}
        onOpenLead={onOpenLead}
        leadActions={leadMenu}
        filtered={filtered}
        refreshKey={refreshKey}
        dragging={dragging}
        onDragLead={(next) => { setDragging(next); if (!next) setHoveredColumn(null); }}
        hoveredColumn={hoveredColumn}
        onHoverColumn={setHoveredColumn}
        /* A column takes a drop when the page allows that status and it is not the one the card came
           from - dropping a lead where it already is is not a move. */
        takesDrop={Boolean(dragging) && dragging.status !== column.value && canDropAt?.(column.value)}
        onDropLead={onDropLead}
      />
    ))}
  </div>;
}

/**
 * One status, and the leads at it.
 *
 * Each column asks its own question and keeps its own offset: seven columns are seven queries, a column
 * with four leads does not wait on the one with four hundred, and scrolling one does not disturb the
 * others. The count in the heading is this column's own `total`, which its first page already carried.
 */
function KanbanColumn({ column, fetchColumn, onOpenLead, leadActions, filtered, refreshKey, dragging, onDragLead, takesDrop, onDropLead, hoveredColumn, onHoverColumn }) {
  const tone = toneOf(column.className);
  // Possible *and* under the pointer. Only then does the column lift.
  const isOver = takesDrop && hoveredColumn === column.value;
  const [leads, setLeads] = useState([]);
  const [total, setTotal] = useState(0);
  // What the column's leads are worth (`values` on its first page): the Estimated Value summed, and
  // for Converted the value each lead was last converted at.
  const [worth, setWorth] = useState(null);
  // `null` is "not asked yet", which is what lets an empty column and a loading one say different
  // things - a column that reads "No leads" while it is still being fetched is a lie that settles.
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  // The offset that failed, so Try again asks for **that** page. Retrying from zero threw away every
  // page somebody had already scrolled through, which is a worse answer than the failure itself.
  const [failedAt, setFailedAt] = useState(null);
  // The element that actually scrolls. The hook observes against it rather than the window: a sentinel
  // below the fold of an inner pane is otherwise clipped away, and the next page would only be asked
  // for once the reader had already run out of column.
  const scrollerRef = useRef(null);
  /*
   * The column's own period and trend, as every other Board has (`ColumnTrendBar`). This board pages
   * its leads, so it cannot count them itself: the server is asked how many came in (by enquiry day)
   * in the period and in the one before, and a chosen period narrows the column's own reads too.
   */
  const { period, setPeriod } = useColumnPeriod("crm-board", column.value);
  const ranges = useMemo(() => periodRanges(period), [period]);
  const range = period === "all" ? null : ranges.current;
  const [trend, setTrend] = useState(null);
  // The column's own search box, asked of the server (name, number or Enquiry ID) a moment after
  // typing stops, so it searches every lead at this status and not only the pages loaded.
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(query.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [query]);
  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      Promise.all([fetchColumn(column.value, 0, 1, ranges.current), fetchColumn(column.value, 0, 1, ranges.previous)])
        .then(([now, before]) => {
          if (cancelled) return;
          const cameIn = Number(now?.total) || 0;
          const earlier = Number(before?.total) || 0;
          setTrend({ now: cameIn, before: earlier, delta: cameIn - earlier });
        })
        .catch(() => { if (!cancelled) setTrend(null); });
    }, 0);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [column.value, fetchColumn, ranges, refreshKey]);

  const load = useCallback(async (offset) => {
    setBusy(true);
    try {
      const response = await fetchColumn(column.value, offset, COLUMN_PAGE, range, search);
      const rows = Array.isArray(response?.data) ? response.data : [];
      setLeads((current) => (offset === 0 ? rows : [...current, ...rows]));
      const answered = Number(response?.total) || 0;
      // Kept by the column itself, for its own heading. It used to be told to the board as well,
      // which ordered the columns by it; the order is the pipeline's now and nothing reads it.
      setTotal(answered);
      if (offset === 0) setWorth(response?.values || null);
      setFailedAt(null);
    } catch {
      /*
       * A column that cannot be read says so and offers to try again, rather than reading as a status
       * with no leads at it. One column failing is not the board failing: the other six are perfectly
       * good answers and stay on screen.
       */
      setFailedAt(offset);
    } finally {
      setBusy(false);
      setLoaded(true);
    }
  }, [column.value, fetchColumn, range, search]);

  /*
   * Deferred by a tick, the way every other first read on this side of the app is - see
   * `CrdDocumentsPage` and `PreProductionGeneral`. `load` sets `busy` as its first act, and a state
   * write made synchronously inside an effect is the cascading render React warns about.
   */
  useEffect(() => {
    const timer = window.setTimeout(() => { void load(0); }, 0);
    return () => window.clearTimeout(timer);
    /*
     * `refreshKey` moves when a lead is written anywhere on the page, which is this column's cue to read
     * itself again - otherwise a lead whose status just changed sits in its old column while the screen
     * claims to be current. It belongs here rather than in `load`'s own dependencies, which would be a
     * value that callback never reads.
     */
  }, [load, refreshKey]);

  /*
   * The column grows by scrolling, the way every other paged list here does.
   *
   * `count` is the guard against asking twice: another page is only ever requested once more leads
   * have actually arrived, which also stops a page that comes back empty from being asked for over and
   * over. `resetKey` is the status, so one column's paging is never mistaken for another's.
   *
   * Nothing is asked for while a read has failed - the error below offers Try again instead, because
   * scrolling into a failure repeatedly is not a retry, it is a loop.
   */
  const sentinelRef = useInfiniteScroll({
    onLoadMore: () => void load(leads.length),
    hasMore: loaded && failedAt === null && leads.length < total,
    loading: busy,
    count: leads.length,
    rootRef: scrollerRef,
    resetKey: `${column.value}-${period}-${search}`,
  });

  return <section
    // Named for a screen reader, which otherwise meets seven unlabelled regions of cards.
    aria-label={`${column.value}, ${loaded ? total : "loading"} leads`}
    /*
     * `onDragOver` must cancel the event or the browser refuses the drop outright - that one line is the
     * whole of "this is a drop target" in the HTML drag API. Both handlers are left off entirely on a
     * column that will not take what is in the air, so there is nothing to drop onto rather than a
     * target that silently does nothing.
     */
    onDragOver={takesDrop ? ((event) => {
      event.preventDefault();
      onHoverColumn?.(column.value);
    }) : undefined}
    /*
     * `dragleave` fires on the way **into** a child as well, so the hover is given up only once the
     * pointer has genuinely left the column. Without the check the ring flickers off every time the
     * pointer crosses one of the cards inside it.
     */
    onDragLeave={takesDrop ? ((event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) onHoverColumn?.(null);
    }) : undefined}
    onDrop={takesDrop ? ((event) => {
      event.preventDefault();
      onDropLead?.(dragging.lead, column.value);
      onDragLead?.(null);
    }) : undefined}
    /*
     * A border, not just a fill.
     *
     * `bg-slate-50` alone was invisible in the dark tiers: they repaint it to `#0f172a` against a shell
     * ground of `#020617`, and two tones that close read as one - so the columns had no edges and a dark
     * board was a row of coloured headings floating over one surface.
     *
     * `border-slate-200` is in the theme's vocabulary, so it is a quiet grey line on white and `#334155`
     * on dark - the same line the cards inside already wear. `overflow-hidden` clips the heading, whose
     * square corners would otherwise sit proud of the rounded border beneath them.
     */
    // Only the column under the pointer lifts; every other one keeps its ordinary edge, so a drag
    // asks "this one?" rather than announcing all the places the card could go.
    // The same glass lane as every other board: the status colour as the top line, a light wash
    // and the card accents, so the heading and the pill on the lead still say the same thing.
    style={{ borderTopColor: tone, backgroundImage: `linear-gradient(${tint(tone, 0.05)}, ${tint(tone, 0.05)})` }}
    className={`flex min-h-0 w-[18rem] shrink-0 flex-col overflow-hidden rounded-xl border bg-slate-50 border-t-[3px] transition ${isOver ? "border-blue-500 ring-2 ring-blue-200" : "border-slate-200"}`}
  >
    {/* A dash until it is known. Showing 0 while seven columns are still loading reads as "no leads
        at this status", which is a wrong answer that then silently corrects itself. */}
    <LaneHeader label={column.value} mark={<span className="flex shrink-0 items-center gap-1.5">
      <ColumnTrendMark trend={trend} noun="leads" period={period} />
      <LaneCount tone={tone} count={loaded ? total : null} />
    </span>} />
    <ColumnTrendBar name={column.value} period={period} setPeriod={setPeriod} aside={loaded && worth ? <ColumnAmount
      // Converted: each lead's latest booking; every other column: the Estimated Value its leads carry.
      label={column.value === "Converted" ? "Converted" : "Est."}
      amount={column.value === "Converted" ? worth.converted : worth.estimated}
      title={column.value === "Converted" ? "Total converted value: each lead's latest booking" : "Total Estimated Value of these leads"}
    /> : null} />
    <ColumnSearch name={column.value} noun="leads" value={query} onChange={setQuery} />

    <div ref={scrollerRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
      {!loaded && <Loader label={`Reading ${column.value}…`} />}
      {failedAt !== null && <div className="space-y-2 rounded-lg border border-red-200 bg-red-50 p-3">
        {/* What went wrong and what to do about it. "Could not be read" told a reader neither. */}
        <p role="alert" className="text-xs text-red-700">
          Couldn&apos;t load {column.value} leads. Check your connection and try again.
        </p>
        <Button type="button" onClick={() => void load(failedAt)}>Try again</Button>
      </div>}
      {loaded && failedAt === null && leads.length === 0 && (
        /* Filters live above the board, so an empty column with a filter on is not the same answer as
           an empty one without - and a reader who has filtered to nothing needs telling which it is. */
        /* In the middle of the column rather than tucked under the heading, where it read as a stray
           line of text in a tall empty frame - as though something had failed to draw. */
        <p className="flex h-full items-center justify-center px-3 text-center text-xs text-slate-500">
          {search ? `No leads at this status match "${search}".` : filtered ? "No leads at this status match your filters." : "No leads at this status."}
        </p>
      )}

      {leads.map((lead) => (
        <LeadCard key={lead.id} lead={lead} tone={tone} onOpenLead={onOpenLead} actions={leadActions?.(lead)} status={column.value} onDragLead={onDragLead} />
      ))}

      {/* Only while there is another page, so a column that is complete stops observing rather than
          watching for a scroll that can never ask for anything. */}
      {loaded && failedAt === null && leads.length < total && (
        <div ref={sentinelRef} className="py-2">
          {/* Said while the next page is on its way, so a reader who has scrolled to the bottom knows
              something is happening rather than that the column has ended. */}
          {busy && <Loader label="Loading more…" />}
        </div>
      )}
    </div>
  </section>;
}

/**
 * One lead, as much of it as a card can hold.
 *
 * The four things somebody scanning a column is actually looking for: who, which enquiry, the number
 * they would ring, and when they said to ring it. Everything else is a press away in the popup, which
 * is where the lead is read in full and changed.
 *
 * ── A single press opens it ──
 *
 * It was double-click only, to match the table's rows, and that was wrong twice over: a `<button>`
 * fires `click` on Enter and Space, so a keyboard could focus a card and never open it, and a phone
 * has no double-click at all, so on touch the board could not open a lead. The table's convention is
 * not a precedent here - a table row is not a focusable button, and it has a row menu and a tap path
 * of its own.
 *
 * A plain `<button>` rather than `shared/Button`: that one is a pill-shaped action control sized to a
 * verb, not a container for four lines of a record.
 *
 * `actions` is the card's ⋮ - the table row's ⋮ (`leadActions` on the board). The card and its ⋮ are
 * two buttons side by side in one frame - a button cannot hold another - and the frame is what is
 * dragged. A card with no items has no ⋮.
 */
function LeadCard({ lead, tone, onOpenLead, actions, status, onDragLead }) {
  const menu = Array.isArray(actions) && actions.length > 0;
  /*
   * **Every** card is dragged, the unowned ones included.
   *
   * The unowned ones were held back at first, on the reasoning that a lead nobody owns has no status
   * to move: the board prints "Unassigned" for a lead with no CRM whatever its status, so a status
   * dropped onto one was stored and never shown. The answer was not to withhold the gesture but to
   * make the drop ask the question such a lead is actually missing - dragging one out of Unassigned
   * opens the form that can give it an owner, with the dropped status already chosen. Which column a
   * card may be dropped on is the page's to say (`canDropAt`), and the board's to show; which cards
   * may be *picked up* is no longer a question.
   */
  return <div
    /*
     * Dragging is the **second** way to reach the same editor, never the only one: a press opens the
     * lead with nothing drafted, a drag opens it with the target status drafted. Keeping the press is
     * what keeps the board usable from a keyboard and on a phone, neither of which can drag.
     *
     * The status it came from travels with it so the column it was taken from does not offer itself as
     * a destination.
     */
    draggable
    onDragStart={(event) => {
      /*
       * Some browsers refuse to start a drag with nothing on the transfer object, so it carries the
       * lead's id - under a type **only this board speaks**. As `text/plain` it was a format every
       * other application on the machine accepts, so a card taken out of the browser could be dropped
       * into a document or a chat window as a bare enquiry id. Now there is nowhere out there for it
       * to land. The drop here reads none of it: what is in the air is React state, not this.
       */
      event.dataTransfer.setData("application/x-dbs-crm-lead", lead.id || "");
      event.dataTransfer.effectAllowed = "move";
      onDragLead?.({ lead, status });
    }}
    onDragEnd={() => onDragLead?.(null)}
    style={{ borderLeftColor: tone }}
    className="flex w-full items-start rounded-xl border border-l-[3px] border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition active:scale-[0.99] hover:border-slate-300 hover:shadow-md"
  >
    <button
      type="button"
      // Said out loud, because "Priya S" alone does not tell a screen reader what pressing it does.
      aria-label={`Open lead ${lead.name || lead.id || ""}`.trim()}
      onClick={() => onOpenLead?.(lead)}
      className={`flex min-w-0 flex-1 gap-2.5 rounded-xl p-2.5 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 ${menu ? "pr-1" : ""}`}
    >
      <span aria-hidden="true" style={{ backgroundColor: tint(tone, 0.14), color: inkOf(tone) }} className="flex size-8 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold">{initialsOf(lead.name || lead.id)}</span>
      <span className="min-w-0 flex-1">
        <span className="block break-words text-sm font-medium leading-snug text-slate-800">{lead.name || "Client_Name"}</span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-slate-500">
          {lead.id && <span className="truncate">{lead.id}</span>}
          {(lead.contactNumber || lead.phone) && <span className="truncate">{lead.contactNumber || lead.phone}</span>}
        </span>
        {lead.nextFollowUpDate && <span className="mt-1.5 inline-block rounded-md bg-slate-100 px-1.5 py-0.5 text-[10.5px] font-medium text-slate-600">Next: {lead.nextFollowUpDate}</span>}
      </span>
    </button>
    {menu && <span className="shrink-0 p-1.5"><OptionsMenu ariaLabel={`Actions for ${lead.name || lead.id || "lead"}`} items={actions} compact /></span>}
  </div>;
}
