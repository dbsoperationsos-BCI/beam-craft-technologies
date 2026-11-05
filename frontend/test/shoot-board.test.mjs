import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { addDays, clockTime, customRangeProblem, dayKey, presetRange, projectLegend, projectRows, rowsInView, PROJECT_COLOURS, rangeLabel, shootDayKey, shootTimeLabel, sortByTime, startOfDay, windowDays } from "../src/lib/shootBoard.mjs";

const read = (path) => fs.readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");

test("the board shows seven days from the day asked, and moves a day at a time", () => {
  const today = startOfDay(new Date(2026, 9, 8, 15, 30));
  assert.equal(dayKey(today), "2026-10-08");
  assert.deepEqual(windowDays(today).map(dayKey), ["2026-10-08", "2026-10-09", "2026-10-10", "2026-10-11", "2026-10-12", "2026-10-13", "2026-10-14"]);
  assert.equal(dayKey(addDays(today, 1)), "2026-10-09");
  assert.equal(dayKey(addDays(new Date(2026, 9, 1), -1)), "2026-09-30");
});

test("the days read as a range, naming the month and year only where they change", () => {
  assert.equal(rangeLabel(new Date(2026, 9, 5), new Date(2026, 9, 11)), "5 – 11 Oct 2026");
  assert.equal(rangeLabel(new Date(2026, 8, 28), new Date(2026, 9, 4)), "28 Sep – 4 Oct 2026");
  assert.equal(rangeLabel(new Date(2025, 11, 29), new Date(2026, 0, 4)), "29 Dec 2025 – 4 Jan 2026");
});

test("a shoot's time reads as the clock, falls back to its session, and orders the day", () => {
  assert.equal(clockTime("18:30"), "6:30 pm");
  assert.equal(clockTime("00:05"), "12:05 am");
  assert.equal(clockTime("25:00"), null);
  assert.equal(shootTimeLabel({ startTime: "09:00", endTime: "13:00" }), "9:00 am – 1:00 pm");
  assert.equal(shootTimeLabel({ startTime: null, session: "Evening" }), "Evening");
  assert.equal(shootTimeLabel({}), null);
  assert.deepEqual(sortByTime([{ id: "a" }, { id: "b", startTime: "18:00" }, { id: "c", startTime: "07:30" }]).map((shoot) => shoot.id), ["c", "b", "a"]);
});

test("a shoot's day is its date as the server sent it, never moved by the time zone", () => {
  assert.equal(shootDayKey("2026-10-06T00:00:00.000Z"), "2026-10-06");
  assert.equal(shootDayKey(null), "");
});

test("each project in the week gets its own colour, in the order it first appears", () => {
  const legend = projectLegend([
    { projectId: "b", clientName: "Bala", eventId: "EV-B" },
    { projectId: "a", clientName: "", eventId: "EV-A" },
    { projectId: "b", clientName: "Bala", eventId: "EV-B" },
  ]);
  assert.deepEqual(legend.map((entry) => [entry.projectId, entry.label]), [["b", "Bala"], ["a", "EV-A"]]);
  assert.equal(legend[0].colour, PROJECT_COLOURS[0]);
  assert.equal(legend[1].colour, PROJECT_COLOURS[1]);
  assert.equal(new Set(PROJECT_COLOURS.map((colour) => colour.bar)).size, PROJECT_COLOURS.length);
});

test("Shoot Board is a Project Management sub-module behind its own permission", () => {
  assert.match(read("constants/modulePermissions.js"), /\["\/project-management\/shoot-board", \{ module: "PROJECT", feature: "Shoot Board" \}\]/);
  assert.match(read("constants/navigation.mjs"), /\{ id: "shoot-board", label: "Shoot Board", href: "\/project-management\/shoot-board"/);
  assert.match(read("app/(app)/project-management/shoot-board/page.js"), /<ShootBoardPage \/>/);
  assert.match(read("services/project-management/shoot-board.service.js"), /\/api\/project-management\/shoot-board\/shoots\?from=/);
});

test("a project with no shoot inside the days is not a row at all", () => {
  /*
   * It used to be one, with an empty `runs` - the rows are built from a legend of **every** project
   * in the shoots handed in, and only then are each project's shoots narrowed to the days on screen.
   *
   * That row could never be drawn: `rowsInView` excludes it and the project column lists only what is
   * in view. What it did instead was crash the board. The empty state reads "there are rows, so there
   * is a shoot somewhere either side" and names the nearest day - and the nearest day is worked out
   * from the rows' own runs, of which a run-less row has none. `days[undefined].getDate()`.
   *
   * It is reached by **narrowing the range**: picking "This week" sets the days at once, while the
   * shoots for that week are still being fetched, so for one render the new days are held against the
   * old range's shoots. Every project whose shoots fall outside this week then has no run in it.
   */
  const days = windowDays(new Date(2026, 9, 5), 7);
  const shoot = (id, projectId, day) => ({ id, projectId, clientName: projectId.toUpperCase(), shootDate: `2026-10-${day}T00:00:00.000Z` });

  // The 20th is outside these seven days, so project "b" has nothing to draw and is not a row.
  const rows = projectRows([shoot(1, "a", "06"), shoot(2, "b", "20")], days);
  assert.deepEqual(rows.map((row) => row.projectId), ["a"]);

  // And when nothing lands in the days at all, there are no rows - which is what the empty state
  // needs in order to say "no shoots in this range" rather than hunt for a nearest day.
  const none = projectRows([shoot(1, "a", "20"), shoot(2, "b", "21")], days);
  assert.deepEqual(none, []);
  assert.deepEqual(rowsInView(none, 0, 6), []);
});

test("consecutive days of a project's shoots join into one bar; a gap starts a new one", () => {
  const days = windowDays(new Date(2026, 9, 5), 7);
  const at = (id, projectId, day, startTime) => ({ id, projectId, clientName: projectId.toUpperCase(), shootDate: `2026-10-${day}T00:00:00.000Z`, startTime });
  const rows = projectRows([at(1, "a", "05"), at(2, "a", "06", "18:00"), at(3, "a", "09"), at(4, "b", "06"), at(5, "a", "06", "07:00"), at(6, "a", "20")], days);
  assert.deepEqual(rows.map((row) => [row.projectId, row.runs.map((run) => [run.startIndex, run.endIndex, run.shoots.map((shoot) => shoot.id)])]), [
    // 5th and 6th run together, the 6th in time order; the 9th stands alone; the 20th is off the range.
    ["a", [[0, 1, [1, 5, 2]], [4, 4, [3]]]],
    ["b", [[1, 1, [4]]]],
  ]);
});

test("the date presets look ahead from today, and a custom range is checked before it is used", () => {
  const today = new Date(2026, 9, 8);
  const keys = (range) => [dayKey(range.from), dayKey(range.to)];
  assert.deepEqual(keys(presetRange("next30", today)), ["2026-10-08", "2026-11-06"]);
  assert.deepEqual(keys(presetRange("next90", today)), ["2026-10-08", "2027-01-07"]);
  assert.deepEqual(keys(presetRange("week", today)), ["2026-10-05", "2026-10-11"]);
  assert.deepEqual(keys(presetRange("month", today)), ["2026-10-01", "2026-10-31"]);
  assert.deepEqual(keys(presetRange("nextMonth", today)), ["2026-11-01", "2026-11-30"]);
  assert.equal(presetRange("custom", today), null);
  assert.equal(customRangeProblem(new Date(2026, 9, 1), new Date(2026, 9, 31)), "");
  assert.equal(customRangeProblem(new Date(2026, 9, 9), new Date(2026, 9, 1)), "The last day comes before the first.");
  assert.equal(customRangeProblem(new Date(2026, 0, 1), new Date(2026, 3, 3)), "Pick at most 92 days.");
  assert.equal(customRangeProblem(new Date(2026, 0, 1), ""), "Pick both days.");
});

test("the project column lists only the projects with a bar in the days on screen", () => {
  const rows = [
    { projectId: "a", runs: [{ startIndex: 0, endIndex: 2 }] },
    { projectId: "b", runs: [{ startIndex: 9, endIndex: 9 }] },
    { projectId: "c", runs: [{ startIndex: 4, endIndex: 12 }] },
  ];
  assert.deepEqual(rowsInView(rows, 0, 6).map((row) => row.projectId), ["a", "c"]);
  assert.deepEqual(rowsInView(rows, 7, 13).map((row) => row.projectId), ["b", "c"]);
  assert.deepEqual(rowsInView(rows, 20, 26), []);
});

test("every bar - one shoot or several - lists its shoots as cards first; a card opens the shoot", () => {
  const page = read("components/project-management/shoot-board/ShootBoardPage.js");
  assert.match(page, /const canOpen = production\.canRead;/);
  assert.match(page, /const onOpenRun = \(run, row\) => setOpenRun\(\{ run, row \}\);/);
  /*
   * Whether a card can be opened is the caller's answer, not the dialog's: the Shoot Board passes
   * no `canOpen` and so keeps the rule it always had - a production record to open - while the
   * calendar opens the Projects board for a viewer holding Projects, which needs no such record.
   */
  const runDialog = read("components/project-management/shoot-board/ShootRunDialog.js");
  assert.match(runDialog, /canOpen = \(shoot\) => Boolean\(shoot\.productionShootId\)/);
  assert.match(runDialog, /onOpen=\{onOpen && canOpen\(shoot\) \? onOpen : undefined\}/);
  const card = read("components/project-management/shoot-board/ShootBoardCard.js");
  assert.match(card, /const card = !onOpen \? <div className=\{frame\}>\{body\}<\/div> : <Button/);
  assert.doesNotMatch(card, /<button/);
});

test("filters: a date preset or a checked From / To, projects from the range, and Clear; the timeline scrolls sideways and keeps its headers in view", () => {
  const page = read("components/project-management/shoot-board/ShootBoardPage.js");
  // Dates, Projects and Clear on one line straight under the title bar; From / To only while Custom is picked.
  assert.match(page, /<ModulePageHeader title="Shoot Board" \/>/);
  // The Dates filter is one component the Shoot Board and the Production Schedule share.
  assert.match(page, /<ShootDateRangeFilter dates=\{dates\} \/>/);
  const filter = read("components/project-management/shoot-board/ShootDateRangeFilter.js");
  assert.match(filter, /<Dropdown hideLabel label="Dates"/);
  assert.match(page, /<MultiSelectField hideLabel /);
  assert.match(filter, /\{preset === "custom" && <div/);
  // Custom dates: one group on the same line, no label above, read as dates ("5 Oct 2026").
  assert.match(filter, /<DateField hideLabel label="From" placeholder="From" formatValue=\{dateLabel\}/);
  /*
   * **Every day is pickable on both boxes.** `To` used to carry `minDate={custom.from}` and a
   * `maxDate` of From + 91 days, which greyed out everything before From and everything past the
   * 92nd day - with a From in the past, most of the calendar. The rule is said in words instead
   * (`customRangeProblem`, on the field), and an invalid pair simply leaves the board on the range
   * it is already showing.
   */
  assert.match(filter, /<DateField hideLabel label="To" placeholder="To" formatValue=\{dateLabel\} className="min-w-0 flex-1 sm:w-40 sm:flex-none" value=\{custom\.to\}/);
  const dates = filter.slice(filter.indexOf('role="group" aria-label="Custom dates"'));
  assert.equal(/minDate=|maxDate=|restriction=/.test(dates), false, "no day is greyed out; the rule is a sentence");
  // Both refusals reach a field: the reversed pair on To, everything else on From.
  assert.match(filter, /error=\{customProblem && customProblem !== REVERSED \? customProblem : ""\}/);
  assert.match(filter, /error=\{customProblem === REVERSED \? customProblem : ""\}/);
  assert.match(read("components/shared/DateField.js"), /<span className=\{hideLabel \? "sr-only" : labelClassName\}>/);
  assert.match(read("components/shared/Dropdown.js"), /<span className=\{hideLabel \? "sr-only" : undefined\}>/);
  assert.match(filter, /if \(!customRangeProblem\(/);
  assert.match(page, /const activeFilter = useMemo\(\(\) => projectFilter\.filter/);
  assert.match(page, /onClick=\{clearFilters\}>Clear<\/Button>/);
  assert.match(read("components/shared/MultiSelectField.js"), /<span className=\{hideLabel \? "sr-only" : undefined\}>/);
  const timeline = read("components/project-management/shoot-board/ShootTimeline.js");
  assert.match(timeline, /const shown = useMemo\(\(\) => rowsInView\(rows, visible\.from, visible\.to\)/);
  assert.match(timeline, /box\.addEventListener\("scroll", onScroll, \{ passive: true \}\)/);
  assert.match(timeline, /label="Previous day"/);
  assert.match(timeline, /sticky left-0 top-0 z-30/);
  assert.match(timeline, /role="rowheader" className="sticky left-0/);
});

test("an empty stretch of days offers a way out: jump to the previous or next shoot", () => {
  const timeline = read("components/project-management/shoot-board/ShootTimeline.js");
  assert.match(timeline, /const nextIndex = starts\.filter\(\(index\) => index > visible\.to\)/);
  assert.match(timeline, /onClick=\{\(\) => scrollToDay\(nextIndex\)\}/);
  assert.match(timeline, /onClick=\{\(\) => scrollToDay\(previousIndex\)\}/);
  // The empty row's project cell is opaque, so day lines scrolling under it do not show through.
  assert.match(timeline, /className="sticky left-0 z-10 border-r border-slate-300 bg-white" style=\{\{ gridColumn: 1, gridRow: 2 \}\}/);
});

test("every day is one fixed width, and the window on screen moves a whole day at a time", () => {
  const timeline = read("components/project-management/shoot-board/ShootTimeline.js");
  // The grid has a set width, so the bars' text cannot widen the days (the cause of the flicker).
  assert.match(timeline, /className="grid min-h-full w-full" style=\{\{ minWidth: `calc\(var\(--label-width\) \+ \$\{dayCount\} \* var\(--day-width\) \+ \$\{seamCount\} \* var\(--seam-width\)\)`/);
  assert.doesNotMatch(timeline, /className="grid[^"]*min-w-max/);
  /*
   * The window is **measured off the header cells**, not worked out as `scrollLeft ÷ day width`.
   *
   * The arithmetic was right while every column was a day wide. With projects picked in the filter
   * the axis has two widths - a day, and the narrow dotted seam standing for a stretch of empty days
   * (`boardColumns`) - and dividing by one of them lands on the wrong column. The cells are on the
   * page and know where they are: the first more than half past the project column, then as many
   * after it as fit.
   */
  assert.match(timeline, /const cells = heads\.filter\(Boolean\)\.map\(\(cell\) => \(\{ left: cell\.offsetLeft - labelWidth, width: cell\.offsetWidth \}\)\);/);
  assert.match(timeline, /let first = cells\.findIndex\(\(cell\) => cell\.left \+ cell\.width \/ 2 > x\);/);
  assert.match(timeline, /while \(last \+ 1 < count && cells\[last \+ 1\]\.left \+ cells\[last \+ 1\]\.width <= x \+ shownWidth\) last \+= 1;/);
  assert.doesNotMatch(timeline, /Math\.round\(box\.scrollLeft \/ width\)/);
  // A shorter range never renders with the longer one's window (This week after 30 days crashed).
  assert.match(timeline, /const first = Math\.min\(measured\.first, lastIndex\);/);
  assert.match(timeline, /snap-x snap-proximity/);
});

test("the date choices run from the shortest span to the longest, Custom last", async () => {
  const { RANGE_PRESETS } = await import("../src/lib/shootBoard.mjs");
  assert.deepEqual(RANGE_PRESETS.map((preset) => preset.label), ["This week", "This month", "Next 30 days", "Next month", "Next 3 months", "Custom dates"]);
});

test("the board's colours are defined for light, dark and enhanced dark, not left to the theme's class list", async () => {
  const { PROJECT_COLOURS } = await import("../src/lib/shootBoard.mjs");
  const css = fs.readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");
  for (const { chip } of PROJECT_COLOURS) {
    const hue = chip.match(/shoot-hue-(\w+)/)[1];
    assert.match(css, new RegExp(`\\.shoot-hue-${hue} \\{ --shoot-chip-bg`), `light ${hue}`);
    assert.match(css, new RegExp(`:is\\(\\[data-theme="dark"\\], \\[data-theme="enhanced-dark"\\]\\) \\.shoot-hue-${hue} \\{`), `dark ${hue}`);
  }
  for (const surface of ["shoot-today", "shoot-today-head", "shoot-empty-wash"]) {
    assert.match(css, new RegExp(`\\[data-theme="dark"\\] \\.${surface} \\{`));
    assert.match(css, new RegExp(`\\[data-theme="enhanced-dark"\\] \\.${surface} \\{`));
  }
  assert.match(css, /:is\(\[data-theme="dark"\], \[data-theme="enhanced-dark"\]\) \.shoot-card \{ border-color/);
});

test("each day shows how many shooters are free, a tap lists them; a shoot's card shows who is on it", () => {
  const read = (file) => fs.readFileSync(new URL(`../src/components/project-management/shoot-board/${file}`, import.meta.url), "utf8");
  const timeline = read("ShootTimeline.js");
  assert.match(timeline, /onClick=\{\(\) => onOpenFree\?\.\(day\)\}/);
  assert.match(timeline, /\{\(freeShooters\[dayKey\(day\)\] \|\| \[\]\)\.length\}\{detail === "full" \? " free" : ""\}/);
  const page = read("ShootBoardPage.js");
  assert.match(page, /freeShooters=\{board\?\.freeShooters\} onOpenFree=\{setFreeDay\}/);
  assert.match(page, /<ShootFreeShootersDialog day=\{freeDay\}/);
  // The shoot overview no longer carries the free list; it shows the team instead.
  assert.doesNotMatch(read("ShootRunDialog.js"), /freeShooters/);
  const card = read("ShootBoardCard.js");
  assert.match(card, /<Meta wrap icon=\{GroupsOutlined\}>\{shoot\.team\.join\(", "\)\}<\/Meta>/);
  assert.match(card, /\{entry\.service\}: \{\[entry\.person, \.\.\.entry\.assistants\]\.filter\(Boolean\)\.join\(", "\)\}/);
});

test("the board filters branch wise, several at once, over the branch each shoot's project belongs to", () => {
  /*
   * A shoot holds no branch of its own: its branch is the booking's, which is what "branch wise"
   * means on every other board, so the server sends the project's `branchId` with the name read
   * through the relation (`shoot-board/read.js`, Rule 5 - the row's own `sourceBranch` only where
   * nothing is linked).
   *
   * The picker then behaves exactly as the Projects one beside it: the branches this range holds, a
   * branch picked earlier and not in the range set aside rather than emptying the board, and the two
   * narrowing together. A shoot whose project has no branch is offered under **No branch** instead
   * of being unfilterable.
   */
  const page = read("components/project-management/shoot-board/ShootBoardPage.js");
  assert.match(page, /<MultiSelectField hideLabel className="w-full sm:w-56" label="Branches" options=\{branchOptions\} values=\{activeBranches\} onChange=\{setBranchFilter\}/);
  assert.match(page, /placeholder=\{branchOptions\.length \? "All branches" : "No branches in this range"\} searchable disabled=\{!branchOptions\.length\}/);
  assert.match(page, /const activeBranches = useMemo\(\(\) => branchFilter\.filter\(\(value\) => branchOptions\.some\(\(option\) => option\.value === value\)\)/);
  // Both filters in one pass, so Projects and Branches narrow together rather than one winning.
  assert.match(page, /if \(activeFilter\.length && !activeFilter\.includes\(shoot\.projectId\)\) return false;\n\s+return !activeBranches\.length \|\| activeBranches\.includes\(shoot\.branchId \? String\(shoot\.branchId\) : NO_BRANCH\);/);
  // Clear puts all three back, and the Clear button knows a branch counts as filtered.
  assert.match(page, /const filtered = dates\.changed \|\| activeFilter\.length > 0 \|\| activeBranches\.length > 0;/);
  assert.match(page, /setProjectFilter\(\[\]\);\n\s+setBranchFilter\(\[\]\);/);
  // By id, with the name beside it: two branches once typed the same way are still two branches.
  const board = fs.readFileSync(new URL("../../backend/src/modules/project-management/shoot-board/read.js", import.meta.url), "utf8");
  assert.match(board, /branchId: project\.branchId \?\? null,/);
  assert.match(board, /branch: project\.branch\?\.name \|\| project\.sourceBranch \|\| null,/);
  assert.match(board, /branchId: true, sourceBranch: true, branch: \{ select: \{ name: true \} \}/);
});

test("picking a project takes the board to it, instead of answering with the empty state", () => {
  /*
   * The board scrolls sideways through a range wider than the screen, so a project whose shoots sit
   * further along was answered with "No shoots from 27 Oct to 9 Nov - the nearest shoot is on 11
   * Nov" and a button to go there. That is right for somebody who scrolled into an empty stretch,
   * and wrong for somebody who has just said which project they want: they asked for it, so the
   * board shows it.
   *
   * On the **selection changing**, not on the view being empty - which the reader's own scrolling
   * also produces - and only where nothing of the selection is on screen already. `jumpedFor` is
   * what tells a new selection from a reader who has scrolled away from one.
   */
  const timeline = read("components/project-management/shoot-board/ShootTimeline.js");
  assert.match(timeline, /const selectionKey = useMemo\(\(\) => rows\.map\(\(row\) => row\.projectId\)\.join\("\|"\), \[rows\]\);/);
  assert.match(timeline, /const jumpedFor = useRef\(selectionKey\);/);
  assert.match(timeline, /if \(jumpedFor\.current === selectionKey\) return;\n\s+jumpedFor\.current = selectionKey;/);
  /*
   * Picking a project now **zooms out to the range where a level can hold it**, and then goes to the
   * project's own first shoot whether or not something of it was already on screen. Somebody who has
   * just named a project is looking for its shoot, not for whatever the board was scrolled to -
   * which, on a board that opens on today, is today.
   */
  /*
   * And it is the **selection's own span** that has to fit - its first shoot to its last - not the
   * range the board has loaded. Measured against the range, picking any project at all zoomed the
   * board out, because Next 30 days does not fit at the full day width however near together the
   * shoots are. A project with two shoots in one week needs nothing done to it.
   */
  assert.match(timeline, /if \(span\.days \* theirWidth <= measured\.shownWidth\) \{/);
  /*
   * And the zoom the **reader** chose is kept while the board holds a different one, then handed
   * back. Clearing the filter used to run the fit over every project - whose span is the whole
   * range, which fits at no ordinary width - so the board zoomed out over everything the moment a
   * selection was cleared, and had no way to know what the zoom had been before it meddled.
   */
  assert.match(timeline, /const readersZoom = useRef\(null\);/);
  assert.match(timeline, /if \(!fitToSelection \|\| !span\) \{\s*\n\s*if \(readersZoom\.current !== null\) \{ setZoom\(readersZoom\.current\); readersZoom\.current = null; \}\s*\n\s*return;/);
  assert.match(timeline, /if \(readersZoom\.current === null\) readersZoom\.current = zoom;/);
  // Pressing − or + makes that zoom theirs, so there is nothing left to give back.
  const changeZoom = timeline.slice(timeline.indexOf("function changeZoom"), timeline.indexOf("const shown = useMemo"));
  assert.match(changeZoom, /readersZoom\.current = null;/);
  assert.match(timeline, /const level = levelThatFits\(span\.days, measured\.dayWidth, zoom, measured\.shownWidth\);/);
  assert.match(timeline, /if \(level !== null && level !== zoom\) \{\s*\n\s*if \(readersZoom\.current === null\) readersZoom\.current = zoom;\s*\n\s*anchorRef\.current = span\.from;\s*\n\s*setZoom\(level\);/);
  assert.match(timeline, /scrollToDay\(span\.from\);/);
  assert.doesNotMatch(timeline, /if \(rowsInView\(rows, visible\.from, visible\.to\)\.length\) return;/);
  // The span is read off the rows once, rather than the first day being dug out of them again here.
  assert.match(timeline, /const starts = rows\.flatMap\(\(row\) => row\.runs\.map\(\(run\) => run\.startIndex\)\);/);

  // The empty state stays for the case it is right for - an empty stretch the reader has come to
  // rest in - and says nothing while the board is still moving.
  assert.match(timeline, /No shoots from \$\{shortDate\(days\[visible\.from\]\)\} to \$\{shortDate\(days\[visible\.to\]\)\}/);
  assert.match(timeline, /\{!shown\.length && !scrolling && <div className="absolute bottom-0 right-0 z-40/);
  assert.match(timeline, /setScrolling\(true\);\n\s+clearTimeout\(idle\);\n\s+idle = setTimeout\(\(\) => setScrolling\(false\), IDLE_MS\);/);
  assert.match(timeline, /const IDLE_MS = 220;/);
  // The timer is cleared with the listener, so a board left mid-scroll sets no state after unmount.
  assert.match(timeline, /box\.removeEventListener\("scroll", onScroll\);\n\s+resize\.disconnect\(\);\n\s+cancelAnimationFrame\(frame\);\n\s+clearTimeout\(idle\);/);
  // The day it goes to is the selection's own first shoot, which `rowsInView` then has on screen.
  const rows = projectRows([
    { id: "s1", projectId: "p1", shootDate: "2026-11-11", shoot: "Reception" },
    { id: "s2", projectId: "p2", shootDate: "2026-10-28", shoot: "Mehendi" },
  ], windowDays(startOfDay(new Date(2026, 9, 27)), 20));
  const picked = rows.filter((row) => row.projectId === "p1");
  const firstDay = Math.min(...picked.flatMap((row) => row.runs.map((run) => run.startIndex)));
  assert.equal(firstDay, 15, "11 Nov is the sixteenth day of a range opening on 27 Oct");
  assert.equal(rowsInView(picked, 0, 13).length, 0, "nothing of it on a screen of the first fortnight");
  assert.equal(rowsInView(picked, firstDay, firstDay + 6).length, 1, "and there once the board has gone to it");
});

test("the dates collapse only as far as the room forces, longest stretch first", async () => {
  /*
   * The studio's rule, and it is about **space**, not about the filter.
   *
   * Picking a project asks "when is this shooting", and the honest answer shows as many real dates
   * as the screen can hold: a fortnight with two shoots in it needs no dots at all. Collapsing
   * regardless turned a board with room to spare into five dates and a row of dots - less
   * information in more space. So dates are kept until they do not fit, and then the longest empty
   * stretch goes first (the most room for the fewest dates lost), and the next, only as far as it
   * takes.
   */
  const { boardColumns, SEAM_REM } = await import("../src/lib/shootBoard.mjs");
  const days = Array.from({ length: 30 }, (_, index) => new Date(Date.UTC(2026, 10, 1 + index)));
  // Shoots on the 2nd-3rd and the 26th: two long empty stretches, one short one at the front.
  const rows = [{ runs: [{ startIndex: 1, endIndex: 2 }, { startIndex: 25, endIndex: 25 }] }];
  const axis = (available) => boardColumns(days, rows, { collapse: true, available, dayPx: 176, seamPx: SEAM_REM * 16 });
  const shape = (result) => result.columns.map((column) => (column.kind === "day" ? column.day.getUTCDate() : `${column.days}d`));

  // Room for the whole month: every date, no dots.
  assert.equal(axis(6000).seams, 0);
  assert.deepEqual(shape(axis(6000)).length, 30);
  /*
   * Enough for most of it: each shoot keeps **three dates either side** and the stretch between the
   * two islands collapses. A bar with no dates around it is a thing floating between two seams - the
   * reader cannot see what day comes before it or after, which is half of what a timeline is for.
   */
  assert.deepEqual(shape(axis(2000)), [1, 2, 3, 4, 5, "18d", 24, 25, 26, 27, 28, "2d"]);
  // Less room: the context narrows before any shoot loses its own date - here to none, and the
  // stretches either side of the islands go too.
  assert.deepEqual(shape(axis(1200)), [1, 2, 3, "22d", 26, "4d"]);
  // And no further: that is the tightest shape there is, and the board scrolls through it.
  assert.deepEqual(shape(axis(400)), [1, 2, 3, "22d", 26, "4d"]);
  // Nothing measured yet: every date, rather than a row of dots that lays itself out again a frame
  // later and reads as a glitch.
  assert.equal(boardColumns(days, rows, { collapse: true }).seams, 0);
});

test("a collapsed stretch is a dotted column in the date row, and the dates beside it keep their width", async () => {
  /*
   * A project's first and last shoot can be six weeks apart, and on an axis that gives every day the
   * same width they cannot both be on screen - which is what "show the selected project's shoots"
   * asks for. So the **dates** give way, not the shoots: a stretch of days nobody on the board is
   * shooting on stops taking a column each and becomes one narrow dotted seam. Every bar is still a
   * bar, in the row it was in, on the day it was on.
   */
  const { boardColumns, dayRangeOfColumns, dayKey } = await import("../src/lib/shootBoard.mjs");
  const days = Array.from({ length: 14 }, (_, index) => new Date(Date.UTC(2026, 10, 6 + index)));
  const rows = [{ projectId: 1, runs: [{ startIndex: 0, endIndex: 1 }, { startIndex: 11, endIndex: 11 }] }];

  const room = { available: 400, dayPx: 176, seamPx: 48 };
  // Without a selection nothing changes: every day is its own column, exactly as before.
  const plain = boardColumns(days, rows);
  assert.equal(plain.columns.length, days.length);
  assert.ok(plain.columns.every((column) => column.kind === "day"));
  assert.deepEqual(plain.columnOfDay, days.map((_, index) => index));

  // With one: the shoot days keep their columns, the stretches between them become seams.
  const tight = boardColumns(days, rows, { collapse: true, ...room });
  assert.deepEqual(tight.columns.map((column) => (column.kind === "day" ? column.day.getUTCDate() : `${column.days}d`)), [6, 7, "9d", 17, "2d"]);
  // A day inside a seam points at the seam, so anything asking where a day went lands on something
  // real rather than off the end of the axis.
  assert.equal(tight.columnOfDay[5], 2);
  assert.equal(tight.columnOfDay[11], 3);
  // No day a bar covers is ever collapsed, so a bar never has to span a seam.
  for (const run of rows[0].runs) {
    for (let index = run.startIndex; index <= run.endIndex; index += 1) {
      assert.equal(tight.columns[tight.columnOfDay[index]].kind, "day", `day ${index}`);
    }
  }

  // Today is **not** held out of a mark: a reader who has named a project is looking at that
  // project's dates, and holding today open put a column of nothing in the middle of them.
  assert.doesNotMatch(read("components/project-management/shoot-board/ShootTimeline.js"), /todayKey \}\)/);
  assert.doesNotMatch(read("lib/shootBoard.mjs"), /todayKey/);

  // One empty day is left alone - a seam is about as wide as the day it would replace, so collapsing
  // it saves nothing and costs the dates their even spacing.
  const single = boardColumns(days, [{ runs: [{ startIndex: 0, endIndex: 0 }, { startIndex: 2, endIndex: 2 }] }], { collapse: true, ...room });
  assert.deepEqual(single.columns.slice(0, 3).map((column) => column.kind), ["day", "day", "day"]);

  // What is on screen is still asked in days, because that is what a shoot has: a seam on screen
  // brings every day it stands for with it.
  assert.deepEqual(dayRangeOfColumns(tight.columns, 0, 1), { from: 0, to: 1 });
  assert.deepEqual(dayRangeOfColumns(tight.columns, 2, 3), { from: 2, to: 11 });
  assert.deepEqual(dayRangeOfColumns([], 0, 3), { from: 0, to: 0 });
});

test("the seam is the date axis's, and only while a project filter is on", () => {
  const timeline = read("components/project-management/shoot-board/ShootTimeline.js");
  const page = read("components/project-management/shoot-board/ShootBoardPage.js");
  /*
   * Only once the board has been narrowed to something - and a **branch** is as much a selection as
   * a project is, the reader asking the same question of it: when are these shooting. Unnarrowed,
   * the board is scanned date by date and neither the fitting nor the dotted marks belong.
   */
  assert.match(page, /fitToSelection=\{activeFilter\.length > 0 \|\| activeBranches\.length > 0\}/);
  assert.match(timeline, /available: measured\.shownWidth,/);
  assert.match(timeline, /dayPx: measured\.dayWidth,/);
  assert.match(timeline, /seamPx: measured\.rem \* SEAM_REM,/);
  // Once a seam is on the board a date keeps its own width: the `1fr` that lets a short range fill
  // the pane drew the few dates left beside a seam a hand's width across.
  /*
   * The dates share whatever is left over, always: fixing them while a mark was on the board left
   * the grid short of its pane and a bare white strip down the right. They were fixed because a
   * handful of surviving dates each came out a hand's width across - but the axis grows its dates
   * outwards now until the next will not fit, so what is left to share is less than a day.
   */
  assert.match(timeline, /const dayTrack = "minmax\(var\(--day-width\), 1fr\)";/);
  /*
   * And a mark stays the narrow thing it is. Letting it take the spare room turned one shoot today
   * into a single date beside a dotted band across the whole board - a lot of screen saying "nothing
   * here". The room is spent on dates instead (`boardColumns` grows them outwards), and with
   * projects picked a date is drawn narrower so more of them fit.
   */
  assert.match(timeline, /const seamTrack = "var\(--seam-width\)";/);
  // And the dates are not drawn narrower by the filter any more: the zoom is what decides a date's
  // width, and the board zooms out to the range before it gives any date up.
  assert.match(timeline, /const collapsing = fitToSelection && Boolean\(span\) && measured\.shownWidth > 0 && !fitsAtFloor;/);
  assert.match(timeline, /const fitsAtFloor = Boolean\(span\) && measured\.shownWidth > 0 && span\.days \* floorPx <= measured\.shownWidth;/);
  /*
   * **Every** row of the grid is drawn over the columns - the dates, the project rows, the filler
   * under them and the empty row. Drawn per day, the filler placed every date past the last column
   * into an implicit track of its own: a field of stray lines across the empty half of the board.
   */
  assert.doesNotMatch(timeline, /days\.map\(/);
  assert.equal((timeline.match(/axis\.map\(\(column, index\)/g) || []).length, 4, "the dates, the row cells, the filler and the empty row");
  // The month is named again after a seam: the reader has just crossed weeks with nothing to say
  // which month they have landed in.
  assert.match(timeline, /axis\[index - 1\]\?\.kind === "gap"/);
  // The dots are in the date row, with the number of days they stand for; the bars are untouched.
  assert.match(timeline, /if \(column\.kind === "gap"\) \{/);
  assert.match(timeline, /aria-label=\{`\$\{column\.days\} days with no shoot/);
  assert.match(timeline, /<span className="text-\[10px\] font-medium text-slate-500">\{column\.days\}d<\/span>/);
  // A bar is placed by the columns its own days are drawn in - nothing about it changed otherwise.
  assert.match(timeline, /gridColumn: `\$\{columnOfDay\[run\.startIndex\] \+ 2\} \/ \$\{columnOfDay\[run\.endIndex\] \+ 3\}`/);
  // A seam does not scale with the zoom: what it says is the same width at any zoom, and a seam that
  // grew with the days would undo the fitting it is there for.
  assert.match(timeline, /column\.kind === "day" \? dayTrack : seamTrack/);
  // And the seams come off the width the days have to fit in, so zooming out still stops in the
  // right place.
  assert.match(timeline, /const whole = wholeRangeFits\(dayColumns, width, shownWidth, seams\);/);
});

test("three shoots a month apart read as three islands of dates, not two bars and a scroll", async () => {
  /*
   * The studio's own case: a project shooting today, in thirty days, and twenty days after that.
   * Each of the three gets its own dates around it, with dots standing for the weeks between - so
   * the board answers "when is this shooting" in one screen, three moments at a time, instead of one
   * bar at either end of a long scroll.
   */
  const { boardColumns, SEAM_REM } = await import("../src/lib/shootBoard.mjs");
  const days = Array.from({ length: 60 }, (_, index) => new Date(Date.UTC(2026, 9, 26 + index)));
  const rows = [{ runs: [{ startIndex: 0, endIndex: 0 }, { startIndex: 30, endIndex: 30 }, { startIndex: 50, endIndex: 50 }] }];
  const axis = (available) => boardColumns(days, rows, { collapse: true, available, dayPx: 176, seamPx: SEAM_REM * 16 });
  const kinds = (result) => result.columns.map((column) => column.kind).join(",");

  const roomy = axis(3000);
  assert.equal(roomy.seams, 3, "a seam between each island, and one past the last shoot");
  // Day, day, day, seam, … - three runs of dates with dots between them.
  assert.equal(kinds(roomy), "day,day,day,gap,day,day,day,day,day,gap,day,day,day,day,day,gap");
  // Every shoot still has a date of its own, and dates around it.
  for (const run of rows[0].runs) assert.equal(roomy.columns[roomy.columnOfDay[run.startIndex]].kind, "day");

  // Tighter: the context narrows, the islands stay. The shoots never lose their own dates.
  const tight = axis(1100);
  assert.equal(tight.seams, 3);
  for (const run of rows[0].runs) assert.equal(tight.columns[tight.columnOfDay[run.startIndex]].kind, "day");
  assert.ok(tight.dayColumns < roomy.dayColumns, "fewer dates around each shoot, not fewer shoots");

  // The same for several projects: the islands are wherever anybody is shooting.
  const two = boardColumns(days, [
    { runs: [{ startIndex: 0, endIndex: 0 }] },
    { runs: [{ startIndex: 40, endIndex: 41 }] },
  ], { collapse: true, available: 2000, dayPx: 176, seamPx: SEAM_REM * 16 });
  assert.equal(kinds(two), "day,day,day,gap,day,day,day,day,day,day,gap");
  assert.equal(two.columns[two.columnOfDay[40]].kind, "day");
  assert.equal(two.columns[two.columnOfDay[41]].kind, "day");
});
