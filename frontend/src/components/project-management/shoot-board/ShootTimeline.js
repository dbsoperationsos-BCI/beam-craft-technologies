"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import ChevronLeftRounded from "@mui/icons-material/ChevronLeftRounded";
import ChevronRightRounded from "@mui/icons-material/ChevronRightRounded";
import EventBusyOutlined from "@mui/icons-material/EventBusyOutlined";
import AddRounded from "@mui/icons-material/AddRounded";
import RemoveRounded from "@mui/icons-material/RemoveRounded";
import Button from "@/components/shared/Button";
import ControlGroup from "@/components/shared/ControlGroup";
import IconButton from "@/components/shared/IconButton";
import { boardColumns, dayKey, dayRangeOfColumns, dayWidthStyle, headerDetail, isAtFloor, levelThatFits, monthName, rangeLabel, rowsInView, SEAM_REM, shootTimeLabel, shortDate, weekdayInitial, weekdayName, wholeRangeFits, ZOOM_FLOOR_REM, ZOOM_LEVELS, zoomStep } from "@/lib/shootBoard.mjs";

/** A bar's words: its shoots by name, and how many days it runs when more than one. */
function runLabel(run) {
  const names = [...new Set(run.shoots.map((shoot) => shoot.shoot))].join(" · ");
  const days = run.endIndex - run.startIndex + 1;
  return { names, detail: days > 1 ? `${days} days · ${run.shoots.length} shoot${run.shoots.length === 1 ? "" : "s"}` : shootTimeLabel(run.shoots[0]) || run.shoots[0].shootPlace || "" };
}

/**
 * The timeline: a project per row down the left, a day per column across the top, and each
 * project's shoots as bars along its row - shoots on the same day or on days one after another
 * joined into one bar (`projectRows`).
 *
 * **It scrolls sideways through the range**, a set width per day, and the project column lists only
 * the projects with a bar in the days on screen (`rowsInView`) - scroll on and the projects change
 * with the days. ‹ › scroll a day, Today brings today's column to the front, and − / + change how
 * wide a day is: the range filter decides which days are loaded, zoom how many are on screen at
 * once. **Only the day columns scale** - the project column, the dates and the bars are left alone,
 * because this is the width of a day and not the browser's zoom. The project column and
 * the day row are sticky; a line runs between every day all the way down (a filler row takes the
 * height the projects leave), and today's column is tinted. No lines between projects.
 */
/*
 * How long after the last scroll event the board counts as still, and the empty state may speak.
 *
 * Long enough that the pauses inside one gesture - a trackpad flick, a drag that hesitates - do not
 * read as the end of it, and short enough that landing on an empty stretch answers at once rather
 * than leaving the reader looking at empty days wondering whether that is all there is.
 */
const IDLE_MS = 220;

export default function ShootTimeline({ days, rows, todayKey, onOpenRun, freeShooters, onOpenFree, fitToSelection = false }) {
  const scrollRef = useRef(null);
  const headRefs = useRef([]);
  // The columns as they are now, for `measure` - which must not be rebuilt when they change, since
  // the scroll listener holds the one it was given.
  const axisRef = useRef([]);
  const [measured, setMeasured] = useState({ first: 0, last: 6, fits: false, dayWidth: 0, rem: 0, shownWidth: 0 });
  /*
   * How wide a day is, as a level in `ZOOM_LEVELS`. It stays put when the range changes: how close
   * somebody wants to look is theirs, not a property of the dates they are looking at.
   */
  const [zoom, setZoom] = useState(0);
  // The day a zoom is taken around, so the scroll position can be put back on it afterwards.
  const anchorRef = useRef(null);
  /*
   * The zoom the **reader** chose, kept while the board is holding a different one to fit a
   * selection - and given back the moment that selection no longer needs it.
   *
   * Without it, picking a project that needed zooming out and then clearing the filter left the
   * board zoomed out over everything: the board had changed a setting of the reader's and had no
   * way to know what it had been. `null` means the zoom on screen is already theirs.
   */
  const readersZoom = useRef(null);
  // The day row's height, so the empty state sits under it rather than over the dates.
  const [headHeight, setHeadHeight] = useState(0);
  /*
   * The days on screen, held inside the range. What was measured belongs to the range it was measured
   * on: switching from 30 days to This week rendered once with the old window - day 9 of a week that
   * has 7 - before the new range was measured, and read a day that is not there.
   */
  /*
   * The board's columns, which are days until projects are picked in the filter and then the days
   * those projects shoot on, with the empty stretches between them collapsed into dotted seams
   * (`boardColumns`). Everything below counts in **columns**; a shoot still knows only its day, so
   * `columnOfDay` is how the two meet.
   */
  /*
   * **Zooming out comes first; the dotted marks are what is left when it is not enough.**
   *
   * A 30-day range with one shoot in it needs no marks at all - the days are drawn narrower until
   * the month is on screen, which is what the zoom is for. Collapsing it instead answered a question
   * nobody asked: four dates and a dotted band over three weeks of a range that would have fitted
   * whole. So the dates give way only where even the narrowest day cannot fit them - a quarter, a
   * long custom range - and until then the filter changes nothing about the axis.
   */
  /*
   * What has to fit is the **selection's own span** - its first shoot to its last - and not the
   * range the board happens to have loaded.
   *
   * Measured against the range, picking any project at all zoomed the board out, because Next 30
   * days does not fit at the full day width however near together the shoots are. A project with two
   * shoots in the same week needs nothing done to it: it is already on screen, and moving the board
   * for it is an answer to a question nobody asked.
   */
  const span = useMemo(() => {
    const starts = rows.flatMap((row) => row.runs.map((run) => run.startIndex));
    const ends = rows.flatMap((row) => row.runs.map((run) => run.endIndex));
    if (!starts.length) return null;
    const from = Math.min(...starts);
    return { from, to: Math.max(...ends), days: Math.max(...ends) - from + 1 };
  }, [rows]);
  const floorPx = ZOOM_FLOOR_REM * (measured.rem || 16);
  const fitsAtFloor = Boolean(span) && measured.shownWidth > 0 && span.days * floorPx <= measured.shownWidth;
  const collapsing = fitToSelection && Boolean(span) && measured.shownWidth > 0 && !fitsAtFloor;
  const { columns: axis, columnOfDay, seams } = useMemo(
    () => boardColumns(days, rows, {
      collapse: collapsing,
      // The room the days have, and what a day and a seam take in it: the axis keeps every date
      // until they do not fit, and only then gives up its longest empty stretches.
      available: measured.shownWidth,
      dayPx: measured.dayWidth,
      seamPx: measured.rem * SEAM_REM,
    }),
    [collapsing, days, measured.dayWidth, measured.rem, measured.shownWidth, rows],
  );
  const lastIndex = Math.max(axis.length - 1, 0);
  const view = useMemo(() => {
    const first = Math.min(measured.first, lastIndex);
    return { first, last: Math.min(Math.max(measured.last, first), lastIndex) };
  }, [lastIndex, measured]);
  // What the window covers in days, which is what the rows and the empty state ask in: a seam on
  // screen brings every day it stands for with it.
  const visible = useMemo(() => dayRangeOfColumns(axis, view.first, view.last), [axis, view]);
  const todayDay = days.findIndex((day) => dayKey(day) === todayKey);
  // Today is never collapsed, so this is a day column of its own wherever today is in the range.
  const todayIndex = todayDay < 0 ? -1 : columnOfDay[todayDay];
  // Whether the board is moving right now. Only the empty state reads it (see the scroll listener).
  const [scrolling, setScrolling] = useState(false);

  /*
   * Which days are on screen, as one window that moves a whole day at a time: the first day more
   * than half in view past the sticky project column, and as many days after it as fit. Asked of
   * each end separately, the two ends crossed their half-way marks at different moments and the
   * label and the rows changed twice for every day scrolled.
   */
  const measure = useCallback(() => {
    const box = scrollRef.current;
    const heads = headRefs.current;
    if (!box || !heads[0]?.offsetWidth) return;
    const labelWidth = heads[0].offsetLeft;
    const shownWidth = box.clientWidth - labelWidth;
    /*
     * Measured off the header cells themselves rather than worked out as `scrollLeft ÷ day width`.
     *
     * The arithmetic was right while every column was a day wide, and a collapsed axis has two
     * widths - a day, and the narrow seam standing for a stretch of them. The cells are on the page
     * and know where they are, so the window is found by walking them: the first column more than
     * half past the project column, and as many after it as fit. A dotted seam counts as a column
     * like any other, which is what keeps ‹ › moving one column at a time.
     */
    const cells = heads.filter(Boolean).map((cell) => ({ left: cell.offsetLeft - labelWidth, width: cell.offsetWidth }));
    const count = cells.length;
    if (!count) return;
    const x = box.scrollLeft;
    let first = cells.findIndex((cell) => cell.left + cell.width / 2 > x);
    if (first < 0) first = count - 1;
    let last = first;
    while (last + 1 < count && cells[last + 1].left + cells[last + 1].width <= x + shownWidth) last += 1;
    /*
     * And what the zoom controls need: whether the whole range is already on screen, how wide a day
     * actually came out, and what a rem is in this browser - the floor is 4rem, and somebody reading
     * at 20px has a wider one. The width is a **day's**, not a seam's, since that is what the floor
     * and the zoom ladder are about.
     */
    const dayCell = heads.find((cell, index) => cell && axisRef.current[index]?.kind === "day");
    const width = dayCell?.offsetWidth || cells[0].width;
    // The seams are not days and do not scale, so they come off the width the days must fit in.
    const seams = cells.reduce((total, cell, index) => (axisRef.current[index]?.kind === "gap" ? total + cell.width : total), 0);
    const dayColumns = axisRef.current.filter((column) => column.kind === "day").length || count;
    const whole = wholeRangeFits(dayColumns, width, shownWidth, seams);
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    setMeasured((current) => (current.first === first && current.last === last && current.fits === whole
      && current.dayWidth === width && current.rem === rem && current.shownWidth === shownWidth
      ? current
      : { first, last, fits: whole, dayWidth: width, rem, shownWidth }));
    setHeadHeight(heads[0].offsetHeight);
  }, []);

  useLayoutEffect(() => { axisRef.current = axis; measure(); }, [measure, axis, zoom]);
  useEffect(() => {
    const box = scrollRef.current;
    if (!box) return undefined;
    let frame = 0;
    let idle = 0;
    /*
     * `scrolling` is only for the empty state, which is why it is a flag and not part of `measured`.
     *
     * Scrolling through a long range crosses whatever empty stretches it has, and the wash was
     * appearing and going again on the way past - a wait-for-it over days the reader was only
     * travelling through. It says nothing worth reading mid-gesture, so it waits for the scroll to
     * settle; `IDLE_MS` after the last scroll event the board is still again and it can speak.
     *
     * React bails out of a set that does not change the value, so the `true` on every frame of a
     * gesture costs one render for the gesture rather than one per frame.
     */
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
      setScrolling(true);
      clearTimeout(idle);
      idle = setTimeout(() => setScrolling(false), IDLE_MS);
    };
    box.addEventListener("scroll", onScroll, { passive: true });
    const resize = new ResizeObserver(onScroll);
    resize.observe(box);
    return () => {
      box.removeEventListener("scroll", onScroll);
      resize.disconnect();
      cancelAnimationFrame(frame);
      clearTimeout(idle);
    };
  }, [measure]);

  // A new range starts at its first day.
  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollLeft = 0; }, [days]);

  /** A column to the left edge, by its own place on the page - so a seam lands as squarely as a day. */
  const scrollToColumn = (index, behavior = "smooth") => {
    const cell = headRefs.current[index];
    const box = scrollRef.current;
    if (!cell || !box) return;
    box.scrollTo({ left: cell.offsetLeft - (headRefs.current[0]?.offsetLeft || 0), behavior });
  };
  const scrollByColumns = (count) => scrollToColumn(Math.min(Math.max(view.first + count, 0), lastIndex));
  /** The column a **day** is drawn in - the day itself, or the seam standing for it. */
  const scrollToDay = (dayIndex, behavior = "smooth") => scrollToColumn(columnOfDay[dayIndex] ?? 0, behavior);

  /*
   * A filter that leaves nothing on screen takes the board to what it left.
   *
   * The board scrolls sideways through a range that is usually wider than the screen, so picking a
   * project whose shoots sit further along answered with the empty state - "No shoots from 27 Oct to
   * 9 Nov. The nearest shoot is on 11 Nov." - and a button to go there. That is the right answer for
   * somebody who scrolled into an empty stretch themselves, and the wrong one for somebody who has
   * just said which project they want to look at: they asked for that project, and the board can
   * simply show it.
   *
   * So on the **selection changing** - not on the view being empty, which is also what the user's own
   * scrolling produces - the board goes to the first day the selection has a shoot on. `jumpedFor`
   * is what tells the two apart: once the board has answered a selection, scrolling away from it is
   * the reader's business and the empty state is left to say so.
   */
  const selectionKey = useMemo(() => rows.map((row) => row.projectId).join("|"), [rows]);
  const jumpedFor = useRef(selectionKey);
  useEffect(() => {
    if (jumpedFor.current === selectionKey) return;
    jumpedFor.current = selectionKey;
    if (!rows.length) return;
    /*
     * Nothing picked: the board gives the reader their own zoom back and leaves the view alone.
     *
     * Clearing the filter used to run the fit over every project on the board - whose span is the
     * whole range, which fits at no ordinary width - so the board zoomed out over everything the
     * moment a selection was cleared. There is nothing to fit to when nothing is picked.
     */
    if (!fitToSelection || !span) {
      if (readersZoom.current !== null) { setZoom(readersZoom.current); readersZoom.current = null; }
      return;
    }
    /*
     * Out only where the selection does not already fit at the zoom the reader has.
     *
     * The zoom says how closely they want to look, and a board that changed it every time a project
     * was named would be taking that away. So it is touched for one reason - the first shoot and the
     * last are further apart than the screen - and handed straight back when the next selection
     * fits without it. `levelThatFits` answers which level, or nothing where even the narrowest will
     * not, and the axis gives up its empty stretches instead (`collapsing`).
     */
    const theirs = readersZoom.current ?? zoom;
    const theirWidth = (measured.dayWidth / ZOOM_LEVELS[zoom]) * ZOOM_LEVELS[theirs];
    if (span.days * theirWidth <= measured.shownWidth) {
      if (readersZoom.current !== null) { anchorRef.current = span.from; setZoom(theirs); readersZoom.current = null; }
    } else {
      const level = levelThatFits(span.days, measured.dayWidth, zoom, measured.shownWidth);
      if (level !== null && level !== zoom) {
        if (readersZoom.current === null) readersZoom.current = zoom;
        anchorRef.current = span.from;
        setZoom(level);
      }
    }
    /*
     * And then to the shoot itself, in view already or not. Somebody who has just named a project is
     * looking for **its** shoot, not for whatever the board happened to be scrolled to - which, on a
     * board that opens on today, is today.
     */
    scrollToDay(span.from);
    // `view` is read as it stands rather than depended on: the key is what decides, and listing the
    // view here would run this again on every scroll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, selectionKey]);

  /*
   * A zoom lands on the day it was taken from.
   *
   * Scroll position is pixels and a zoom changes what a pixel means, so without this, zooming out on
   * the 20th left the board somewhere in the previous week. Done after the layout, with no
   * animation: the days have just changed width, and sliding as well reads as a glitch.
   */
  useLayoutEffect(() => {
    if (anchorRef.current === null) return;
    scrollToDay(anchorRef.current, "auto");
    anchorRef.current = null;
  });

  /** One press of − or +, keeping the day on screen. Nothing to anchor if nothing moves. */
  function changeZoom(direction) {
    const next = zoomStep(zoom, direction);
    if (next === zoom) return;
    // Pressing − or + makes this the reader's own zoom, so there is nothing of theirs left to hand
    // back when the filter is cleared.
    readersZoom.current = null;
    anchorRef.current = view.first;
    setZoom(next);
  }

  const shown = useMemo(() => rowsInView(rows, visible.from, visible.to), [rows, visible]);
  const rowCount = Math.max(shown.length, 1);
  /*
   * A day column scales with the zoom; a seam is a fixed narrow strip, because what it says - "days
   * pass here" - is the same width whatever the zoom is, and a seam that grew with the days would
   * undo the fitting it exists for.
   *
   * **And once there is a seam, a date keeps its own width rather than sharing out the spare room.**
   * The `1fr` is what lets a short range fill the pane, which is right when the axis is all dates;
   * applied to the handful of dates left beside a seam it drew each of them a hand's width across -
   * a broad view of five dates where the point was to see more of them.
   */
  /*
   * The dates share whatever room is left, always.
   *
   * Fixing them while a mark was on the board left the grid short of its pane and a bare white strip
   * down the right. They were fixed because, when only a handful of dates survived, `1fr` drew each
   * one a hand's width across - but the axis grows its dates outwards now until the next will not
   * fit, so what is left to share is less than a day and the stretch is not seen.
   */
  const dayTrack = "minmax(var(--day-width), 1fr)";
  /*
   * A mark stays the narrow thing it is.
   *
   * Letting it take the spare room turned one shoot today into a single date beside a dotted band
   * stretched across the whole board - a lot of screen saying "nothing here". The room is spent on
   * **dates** instead: `boardColumns` grows the days around each shoot outwards until the next one
   * would not fit, and with projects picked a date is drawn narrower so more of them do.
   */
  const seamTrack = "var(--seam-width)";
  const columns = `var(--label-width) ${axis.map((column) => (column.kind === "day" ? dayTrack : seamTrack)).join(" ")}`;
  const dayCount = axis.filter((column) => column.kind === "day").length;
  const seamCount = axis.length - dayCount;
  const atStart = view.first <= 0;
  const atEnd = view.last >= days.length - 1;
  /*
   * Zooming out is spent once the whole range is on screen, or once a day is as narrow as the floor
   * allows - whichever comes first. The width is the question and not the level: on a 7rem phone most
   * of the ladder lands on the floor, and a `−` counting levels was enabled for presses that changed
   * nothing on screen.
   */
  const canZoomOut = !measured.fits && !isAtFloor(measured.dayWidth, measured.rem) && zoom < ZOOM_LEVELS.length - 1;
  /*
   * How much of a day's header the width allows. Zooming out past 4rem is what makes a month fit on
   * one screen, and a header that simply shrank would be cut off mid-word - so the weekday shortens
   * to a letter, then the circle goes, then the date stands alone.
   */
  const detail = headerDetail(measured.dayWidth);

  // The nearest shoots either side of the days on screen, for the empty view's way out.
  const starts = rows.flatMap((row) => row.runs.map((run) => run.startIndex));
  const ends = rows.flatMap((row) => row.runs.map((run) => run.endIndex));
  const nextIndex = starts.filter((index) => index > visible.to).sort((a, b) => a - b)[0];
  const previousIndex = ends.filter((index) => index < visible.from).sort((a, b) => b - a)[0];

  return <div className="flex min-h-0 flex-1 flex-col gap-2">
    {/*
      * Today at the left where the eye starts, the board's state beside it, and at the right two
      * groups - how wide a day is, and which days are shown - each a `ControlGroup`, because a zoom
      * pair and a pager are each one control with parts rather than loose icons in a line.
      */}
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-3 sm:px-4 lg:px-5">
      <div className="flex min-w-0 items-center gap-2">
        {/* Disabled rather than hidden, as ‹ and › are at the ends of the range: at the left of the
            row a button that came and went would shove the line about under the pointer. */}
        <Button type="button" size="md" className="shrink-0 disabled:text-slate-400 disabled:bg-slate-50" disabled={todayIndex < 0 || view.first === todayIndex} onClick={() => scrollToDay(todayIndex)}>Today</Button>
        {/*
          * What is true of the board as it stands, which is also why `−` has stopped: the whole
          * range is on screen, or the days are at their narrowest, or there are more days to the
          * side. Silence here read as a broken button on a long range.
          *
          * Truncated only from `md`, where there is room for the sentence; on a phone it wraps
          * instead, since what truncation cuts off is the half saying what to do about it.
          */}
        <span className="min-w-0 text-xs text-slate-500 md:truncate">
          {seams
            ? `Dates with nothing on are shown as ··· - ${seams === 1 ? "one stretch" : `${seams} stretches`} of them`
            : measured.fits
              ? "Every day in the range is on screen"
              : isAtFloor(measured.dayWidth, measured.rem)
                ? "Days are at their narrowest - scroll for more"
                : "Scroll sideways for more days"}
        </span>
      </div>
      <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
        <ControlGroup label="Zoom">
          <IconButton label="Zoom out" variant="plain" size="md" className="text-slate-600" disabled={!canZoomOut} onClick={() => changeZoom(1)}><RemoveRounded fontSize="small" /></IconButton>
          <IconButton label="Zoom in" variant="plain" size="md" className="text-slate-600" disabled={zoom === 0} onClick={() => changeZoom(-1)}><AddRounded fontSize="small" /></IconButton>
        </ControlGroup>
        <ControlGroup label="Days shown">
          <IconButton label="Previous day" variant="plain" size="md" className="text-slate-600" disabled={atStart} onClick={() => scrollByColumns(-1)}><ChevronLeftRounded /></IconButton>
          <span aria-live="polite" className="min-w-[8rem] px-2 text-center text-sm font-semibold text-slate-900 sm:min-w-[9rem]">{days.length ? rangeLabel(days[visible.from], days[visible.to]) : ""}</span>
          <IconButton label="Next day" variant="plain" size="md" className="text-slate-600" disabled={atEnd} onClick={() => scrollByColumns(1)}><ChevronRightRounded /></IconButton>
        </ControlGroup>
      </div>
    </div>

    {/* The base width is the breakpoint's, and the zoom level scales it; `--label-width` is not
        scaled, which is what keeps the project column the size it was. */}
    <div className="relative flex min-h-0 flex-1 flex-col [--day-base:7rem] [--label-width:8.5rem] sm:[--day-base:11rem] sm:[--label-width:13rem]" /*
       * With projects picked, a date is drawn **narrower**: the reader is looking for when, across
       * weeks, and at the full 11rem the board fits eight dates on a laptop - a handful of columns
       * and a long dotted mark where a dozen dates would have answered the question. A ceiling
       * rather than a replacement: zooming in still comes down from it.
       */
      style={{ "--day-width": dayWidthStyle(zoom), "--seam-width": `${SEAM_REM}rem` }}>
    {/*
      * Nothing in the days on screen: an empty state over the empty days - not a box on top of the
      * lines, a wash across them - clear of the day row and the project column, which stay as they
      * are. It says which days, where the nearest shoots are, and goes to them.
      */}
    {/* Not while the board is moving: a wash that comes and goes over the gaps a long scroll passes
        through is a wait-for-it over days the reader is only travelling past. */}
    {!shown.length && !scrolling && <div className="absolute bottom-0 right-0 z-40 flex items-center justify-center shoot-empty-wash px-4 backdrop-blur-[1px]" style={{ top: headHeight, left: "var(--label-width)" }}>
      <div role="status" className="flex max-w-sm flex-col items-center text-center">
        <span aria-hidden="true" className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-500"><EventBusyOutlined /></span>
        <p className="mt-3 text-base font-semibold text-slate-900">
          {rows.length ? `No shoots from ${shortDate(days[visible.from])} to ${shortDate(days[visible.to])}` : "No shoots in this range"}
        </p>
        <p className="mt-1 text-sm text-slate-500">
          {!rows.length
            ? "Try a wider date range, or clear the project filter."
            : previousIndex !== undefined && nextIndex !== undefined
              ? `The nearest shoots are on ${shortDate(days[previousIndex])} and ${shortDate(days[nextIndex])}.`
              : `The nearest shoot is on ${shortDate(days[nextIndex ?? previousIndex])}.`}
        </p>
        {rows.length > 0 && <div className="mt-4 flex flex-wrap justify-center gap-2">
          {previousIndex !== undefined && <Button type="button" size="sm" onClick={() => scrollToDay(previousIndex)}>‹ {shortDate(days[previousIndex])}</Button>}
          {nextIndex !== undefined && <Button type="button" size="sm" variant="primary" onClick={() => scrollToDay(nextIndex)}>{shortDate(days[nextIndex])} ›</Button>}
        </div>}
      </div>
    </div>}
    <div ref={scrollRef} className="min-h-0 flex-1 snap-x snap-proximity overflow-auto overscroll-x-contain scroll-pl-[var(--label-width)] border-t border-slate-300 bg-white">
      {/*
        * A set width - the box's, and never less than the project column plus a day's width per day -
        * so the bars' text cannot widen the days. Sized to its content (`min-w-max`), the days grew to
        * fit the longest bar in the rows on screen; scrolling changed the rows, the rows changed the
        * widths, the widths changed the days on screen, and the board flickered between the two.
        */}
      <div role="grid" aria-label="Shoots by project and day" className="grid min-h-full w-full" style={{ minWidth: `calc(var(--label-width) + ${dayCount} * var(--day-width) + ${seamCount} * var(--seam-width))`, gridTemplateColumns: columns, gridTemplateRows: `auto repeat(${rowCount}, minmax(3.5rem, auto)) 1fr` }}>
        {/* The corner and the day row stay put while the grid scrolls under them. */}
        <div role="columnheader" className="sticky left-0 top-0 z-30 flex items-end border-b border-r border-slate-300 bg-slate-50 px-3 py-2.5 text-sm font-semibold text-slate-600" style={{ gridColumn: 1, gridRow: 1 }}>
          Project{shown.length ? ` (${shown.length})` : ""}
        </div>
        {axis.map((column, index) => {
          /*
           * A collapsed stretch, in the date row where it belongs: dots and the number of days it
           * stands for. Nothing about the shoots is drawn differently - this is the **date axis**
           * saying nothing is on between the dates either side of it.
           */
          if (column.kind === "gap") {
            const from = days[column.from];
            const to = days[column.to];
            return <div
              key={`gap-${column.from}`}
              ref={(node) => { headRefs.current[index] = node; }}
              role="columnheader"
              aria-label={`${column.days} days with no shoot, ${shortDate(from)} to ${shortDate(to)}`}
              title={`${column.days} days with no shoot: ${shortDate(from)} to ${shortDate(to)}`}
              className="sticky top-0 z-20 flex snap-start flex-col items-center justify-center gap-0.5 border-b border-l border-dashed border-slate-300 bg-slate-50/60 px-0 py-2.5"
              style={{ gridColumn: index + 2, gridRow: 1 }}
            >
              <span aria-hidden="true" className="text-sm font-semibold tracking-[0.2em] text-slate-400">···</span>
              <span className="text-[10px] font-medium text-slate-500">{column.days}d</span>
            </div>;
          }
          const { day } = column;
          const isToday = index === todayIndex;
          // The first day on screen and the first of each month carry the month's name at every
          // width: zoomed out, it is the only thing saying where one month ends.
          // The month's name on the first date, on the 1st - and on the first date after a seam,
          // where the reader has just crossed weeks and has nothing else to say which month this is.
          const named = index === 0 || day.getDate() === 1 || axis[index - 1]?.kind === "gap";
          return <div key={dayKey(day)} ref={(node) => { headRefs.current[index] = node; }} role="columnheader" className={`sticky top-0 z-20 flex snap-start flex-col items-center border-b border-slate-300 ${detail === "minimal" ? "px-0 py-1.5" : "px-1 py-2.5"} ${index ? "border-l" : ""} ${isToday ? "shoot-today-head" : "bg-slate-50"}`} style={{ gridColumn: index + 2, gridRow: 1 }}>
            {/* The weekday: the word, then its first letter, then nothing. Today keeps its name
                wherever the word fits, and its colour and tint where it does not. */}
            {detail !== "minimal" && <span className={`${detail === "full" ? "text-xs" : "text-[11px]"} ${isToday ? "font-semibold text-blue-700" : "font-medium text-slate-500"}`}>
              {detail === "full" ? (isToday ? "Today" : weekdayName(day)) : weekdayInitial(day)}
            </span>}
            {/* The date, which every width keeps. The 2.5rem circle is the first thing that cannot
                fit, so below `full` the number stands on its own and today's blue carries it. */}
            <span className={detail === "full"
              ? `mt-0.5 flex h-10 w-10 items-center justify-center rounded-full text-lg font-semibold ${isToday ? "bg-blue-600 text-white" : "text-slate-900"}`
              : `${detail === "compact" ? "mt-0.5 text-sm" : "text-[11px]"} font-semibold ${isToday ? "text-blue-700" : "text-slate-900"}`}>
              {day.getDate()}
            </span>
            {/* Kept in place at the wider widths so the dates line up whether a month starts there
                or not; at the narrowest the row is dropped rather than held empty, because the
                height is worth more than the alignment. */}
            {(detail !== "minimal" || named) && <span className={`${detail === "minimal" ? "text-[9px]" : "text-[11px]"} ${named ? "font-medium text-slate-600" : "invisible"}`}>{monthName(day)}</span>}
            {/* How many shooters have no shoot this date; a tap lists them. The word goes where the
                column is narrow, the number never does. */}
            {freeShooters && <Button
              type="button"
              variant="plain"
              size="none"
              onClick={() => onOpenFree?.(day)}
              aria-label={`${(freeShooters[dayKey(day)] || []).length} shooters free on ${weekdayName(day)} ${shortDate(day)}`}
              className={`mt-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${(freeShooters[dayKey(day)] || []).length ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}
            >
              {(freeShooters[dayKey(day)] || []).length}{detail === "full" ? " free" : ""}
            </Button>}
          </div>;
        })}

        {shown.map((row, rowIndex) => {
          const gridRow = rowIndex + 2;
          return [
            <div key={`${row.projectId}-label`} role="rowheader" className="sticky left-0 z-10 flex min-w-0 items-center gap-2 border-r border-slate-300 bg-white px-3 py-2" style={{ gridColumn: 1, gridRow }}>
              <span aria-hidden="true" className={`h-2.5 w-2.5 shrink-0 rounded-full ${row.colour.bar}`} />
              <span className="min-w-0">
                <span className="block truncate text-xs font-semibold text-slate-900 sm:text-sm">{row.label}</span>
                {row.eventId && row.eventId !== row.label && <span className="block truncate text-[11px] text-slate-500">{row.eventId}</span>}
              </span>
            </div>,
            // The cells behind the bars: the lines between columns, today's tint, and a dotted
            // edge where a stretch of days was collapsed into a seam.
            ...axis.map((column, index) => <div
              key={`${row.projectId}-${column.kind === "day" ? dayKey(column.day) : `gap-${column.from}`}`}
              aria-hidden="true"
              className={`${index ? `border-l ${column.kind === "gap" ? "border-dashed" : ""} border-slate-300` : ""} ${index === todayIndex ? "shoot-today" : ""} ${column.kind === "gap" ? "bg-slate-50/40" : ""}`}
              style={{ gridColumn: index + 2, gridRow }}
            />),
            ...row.runs.map((run) => {
              const { names, detail } = runLabel(run);
              // Placed by the **columns** its first and last day are drawn in. A run is contiguous
              // and `boardColumns` never collapses a day a bar covers, so a bar never spans a seam.
              return <div key={`${row.projectId}-${run.startIndex}`} className="relative z-[5] flex min-w-0 items-center px-1 py-1.5" style={{ gridColumn: `${columnOfDay[run.startIndex] + 2} / ${columnOfDay[run.endIndex] + 3}`, gridRow }}>
                <Button
                  type="button"
                  variant="plain"
                  size="none"
                  onClick={() => onOpenRun(run, row)}
                  aria-label={`${row.label}: ${names}${detail ? `, ${detail}` : ""}`}
                  className={`h-full min-h-10 w-full min-w-0 overflow-hidden rounded-lg !justify-start text-left shadow-sm ring-1 transition hover:shadow-md ${row.colour.chip}`}
                >
                  <span aria-hidden="true" className={`w-1.5 self-stretch ${row.colour.bar}`} />
                  <span className="min-w-0 flex-1 px-2 py-1">
                    <span className="block truncate text-xs font-semibold">{names}</span>
                    {detail && <span className="block truncate text-[11px] opacity-80">{detail}</span>}
                  </span>
                </Button>
              </div>;
            }),
          ];
        })}

        {/*
          * The filler row: the lines and today's tint carried down to the bottom.
          *
          * Over the **columns**, like every other row. Drawn per day it placed every date past the
          * last column into an implicit track of its own - a field of lines across the empty half of
          * the board, and a grid wider than the dates it was showing.
          */}
        <div aria-hidden="true" className="sticky left-0 z-10 border-r border-slate-300 bg-white" style={{ gridColumn: 1, gridRow: rowCount + 2 }} />
        {axis.map((column, index) => <div
          key={`filler-${column.kind === "day" ? dayKey(column.day) : `gap-${column.from}`}`}
          aria-hidden="true"
          className={`${index ? `border-l ${column.kind === "gap" ? "border-dashed" : ""} border-slate-300` : ""} ${index === todayIndex ? "shoot-today" : ""}`}
          style={{ gridColumn: index + 2, gridRow: rowCount + 2 }}
        />)}

        {/* Nothing in the days on screen: an empty row, the day lines still running through it; what
            to do about it is said over the grid, below. */}
        {!shown.length && <>
          <div aria-hidden="true" className="sticky left-0 z-10 border-r border-slate-300 bg-white" style={{ gridColumn: 1, gridRow: 2 }} />
          {axis.map((column, index) => <div
            key={`empty-${column.kind === "day" ? dayKey(column.day) : `gap-${column.from}`}`}
            aria-hidden="true"
            className={`${index ? `border-l ${column.kind === "gap" ? "border-dashed" : ""} border-slate-300` : ""} ${index === todayIndex ? "shoot-today" : ""}`}
            style={{ gridColumn: index + 2, gridRow: 2 }}
          />)}
        </>}
      </div>
    </div>
    </div>
  </div>;
}
