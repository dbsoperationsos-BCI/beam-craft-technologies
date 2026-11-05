/**
 * The Shoot Board's days, times and colours, kept apart from the screen so they can be tested on
 * their own.
 *
 * Days are the viewer's local calendar days, keyed `YYYY-MM-DD`. A shoot's date comes from the
 * server as the midnight of its day (`2026-10-06T00:00:00.000Z`), so its key is the first ten
 * characters, never shifted through a time zone.
 */
const pad = (value) => String(value).padStart(2, "0");

/** How many days the board shows at once. */
export const DAYS_SHOWN = 7;

/** `YYYY-MM-DD` of a local date. */
export function dayKey(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** The day a shoot is on, from the server's date. */
export function shootDayKey(value) {
  return value ? String(value).slice(0, 10) : "";
}

/** Local midnight of `date`. */
export function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** `date` moved by `days` whole days. */
export function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

/** `count` days from `start`, one after another - the board moves a day at a time, not a week. */
export function windowDays(start, count = DAYS_SHOWN) {
  return Array.from({ length: count }, (_, index) => addDays(start, index));
}

// Spelled out rather than asked of Intl, which writes September as "Sept" in some locales' data.
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export const monthName = (date) => MONTHS[date.getMonth()];
export const weekdayName = (date) => WEEKDAYS[date.getDay()];

/** "6 Oct" - a day's date. */
export function shortDate(date) {
  return `${date.getDate()} ${monthName(date)}`;
}

/** "6 – 12 Oct 2026", "29 Sep – 5 Oct 2026", "29 Dec 2025 – 4 Jan 2026". */
export function rangeLabel(first, last) {
  const sameYear = first.getFullYear() === last.getFullYear();
  const sameMonth = sameYear && first.getMonth() === last.getMonth();
  const head = sameMonth ? `${first.getDate()}` : `${first.getDate()} ${monthName(first)}${sameYear ? "" : ` ${first.getFullYear()}`}`;
  return `${head} – ${last.getDate()} ${monthName(last)} ${last.getFullYear()}`;
}

/** "18:30" → "6:30 pm"; null for anything that is not a time. */
export function clockTime(value) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || ""));
  if (!match) return null;
  const hours = Number(match[1]);
  if (hours > 23) return null;
  return `${hours % 12 || 12}:${match[2]} ${hours < 12 ? "am" : "pm"}`;
}

/** When in the day a shoot runs: "6:30 pm – 10:00 pm", "6:30 pm", its session, or null. */
/**
 * Whether a shoot's end time falls on the next day: an end earlier than its start runs past midnight
 * - 9:00 PM to 2:00 AM - which is how Production's crew check reads it too. Both are `HH:MM`.
 */
export function endsNextDay(start, end) {
  const valid = (value) => /^\d{2}:\d{2}/.test(String(value || ""));
  return valid(start) && valid(end) && String(end).slice(0, 5) < String(start).slice(0, 5);
}

export function shootTimeLabel(shoot) {
  const start = clockTime(shoot.startTime);
  const end = clockTime(shoot.endTime);
  if (start && end) return `${start} – ${end}${endsNextDay(shoot.startTime, shoot.endTime) ? " (next day)" : ""}`;
  return start || shoot.session || null;
}

/** A day's shoots in the order they run: timed ones by start time, then the rest as they came. */
export function sortByTime(shoots) {
  const minutes = (shoot) => {
    const match = /^(\d{1,2}):(\d{2})$/.exec(String(shoot.startTime || ""));
    return match ? Number(match[1]) * 60 + Number(match[2]) : Number.POSITIVE_INFINITY;
  };
  return shoots
    .map((shoot, index) => ({ shoot, index }))
    .sort((a, b) => (minutes(a.shoot) - minutes(b.shoot)) || (a.index - b.index))
    .map(({ shoot }) => shoot);
}

/*
 * One colour per project: a solid bar (the same in every appearance) and a soft chip for its name.
 * The chip's colours live in `globals.css` (`.shoot-chip`, `.shoot-hue-*`), with a light and a dark
 * pair each: the dark tiers do not repaint these hues, so a Tailwind chip was unreadable in dark.
 */
export const PROJECT_COLOURS = [
  { bar: "bg-sky-500", chip: "shoot-chip shoot-hue-sky" },
  { bar: "bg-amber-500", chip: "shoot-chip shoot-hue-amber" },
  { bar: "bg-emerald-500", chip: "shoot-chip shoot-hue-emerald" },
  { bar: "bg-rose-500", chip: "shoot-chip shoot-hue-rose" },
  { bar: "bg-violet-500", chip: "shoot-chip shoot-hue-violet" },
  { bar: "bg-orange-500", chip: "shoot-chip shoot-hue-orange" },
  { bar: "bg-teal-500", chip: "shoot-chip shoot-hue-teal" },
  { bar: "bg-fuchsia-500", chip: "shoot-chip shoot-hue-fuchsia" },
  { bar: "bg-lime-600", chip: "shoot-chip shoot-hue-lime" },
  { bar: "bg-slate-500", chip: "shoot-chip shoot-hue-slate" },
];

/**
 * The projects on screen with their colours, in the order they first appear - so two projects never
 * share a colour until there are more than ten of them.
 */
export function projectLegend(shoots) {
  const legend = new Map();
  for (const shoot of shoots) {
    if (legend.has(shoot.projectId)) continue;
    legend.set(shoot.projectId, {
      projectId: shoot.projectId,
      label: shoot.clientName || shoot.eventId || "Project",
      eventId: shoot.eventId,
      colour: PROJECT_COLOURS[legend.size % PROJECT_COLOURS.length],
    });
  }
  return [...legend.values()];
}

/** `YYYY-MM-DD` to its local midnight. */
export function fromKey(key) {
  const [year, month, date] = String(key).split("-").map(Number);
  return new Date(year, month - 1, date);
}

/** Whole days from `a` to `b` (local dates). */
export function daysBetween(a, b) {
  return Math.round((startOfDay(b) - startOfDay(a)) / 86400000);
}

/**
 * The timeline's zoom levels, as factors on the day width the breakpoint already uses.
 *
 * The range filter decides which days are loaded; zoom decides how many of them are on screen at
 * once. Factors rather than widths, because a day is 7rem on a phone and 11rem from `sm` and both
 * have to come down by the same proportion - a ladder of fixed widths would make a phone's days
 * wider than they are today at the first level.
 */
export const ZOOM_LEVELS = [1, 0.6, 0.36, 0.22, 0.13];

/**
 * How narrow a day may get.
 *
 * It was 4rem - the width that keeps the whole header, weekday and circled date and month - and that
 * fits about twelve days on a laptop, so the default Next 30 days still scrolled. A month on one
 * screen is about 26px a day, so the floor comes down to 1.5rem and **the header gives way
 * instead**
 * (`headerDetail`): the weekday shortens to a letter, the circle goes, and at the narrowest the
 * date number stands alone. A column with a date on it is still a calendar; a column cut off
 * mid-word is not.
 *
 * And it stops there. A month to six weeks on screen is what the board is for; thinner days than
 * that are not worth reading, so a longer range - three months, a wide custom one - **scrolls at the
 * narrowest level** rather than being squeezed into one screen. Zooming out stops when the days stop
 * getting narrower, and the line above the board says so.
 */
export const ZOOM_FLOOR_REM = 1.5;
export const ZOOM_FLOOR = `${ZOOM_FLOOR_REM}rem`;

/**
 * How much of a day's header fits in `dayWidth`, as a measured width in pixels.
 *
 *   `full`     the weekday, the date in its 2.5rem circle, the month - the header as it has always
 *              been, from 4rem up.
 *   `compact`  the weekday as a letter and the date plain, the circle dropped: it alone is 2.5rem,
 *              so it is the first thing that cannot fit.
 *   `minimal`  the date and nothing else, which is what a month-on-one-screen leaves room for.
 *
 * Nothing measured yet answers `full`: the board draws its usual header and then measures it, and a
 * first paint of bare numbers that filled in afterwards would read as a fault.
 */
export function headerDetail(dayWidth) {
  if (!(dayWidth > 0) || dayWidth >= 64) return "full";
  return dayWidth >= 40 ? "compact" : "minimal";
}

/** A weekday as one letter, for a day too narrow for the word. */
export const weekdayInitial = (day) => weekdayName(day).charAt(0);

/**
 * Whether a measured day is as narrow as it is allowed to get.
 *
 * The level is not the question - the width is. On a phone the base day is 7rem, so most of the
 * ladder lands on the floor: a `−` that counted levels stayed enabled for three presses that changed
 * nothing on screen. `remPx` is the root font size, because somebody reading at 20px has a larger
 * floor than somebody reading at 16.
 */
export const isAtFloor = (dayWidth, remPx) => dayWidth > 0 && remPx > 0 && dayWidth <= ZOOM_FLOOR_REM * remPx + 0.5;

const atLevel = (level) => ZOOM_LEVELS[Math.min(Math.max(Math.round(level) || 0, 0), ZOOM_LEVELS.length - 1)];

/**
 * A level as the `--day-width` the grid reads.
 *
 * `max()` is CSS's rather than arithmetic here: only the stylesheet knows which base applies at the
 * width the board is being drawn at, so only it can hold the floor at both.
 */
export const dayWidthStyle = (level) => `max(${ZOOM_FLOOR}, calc(var(--day-base) * ${atLevel(level)}))`;


/**
 * The widest zoom level that puts `dayCount` days on screen, or `null` where none does.
 *
 * What "show me this project" should do first: the days have a width that fits a month, so a range
 * that will go on one screen is zoomed out to rather than cut into islands of dates with dots
 * between them. `dayWidth` is what a day comes out at now, at level `zoom`, which is how the base
 * width is worked back to without this needing to know the breakpoint's own.
 *
 * `null` means no level is enough - a quarter, a long custom range - and that is when the dates
 * themselves have to give way (`boardColumns`).
 */
export function levelThatFits(dayCount, dayWidth, zoom, shownWidth) {
  if (dayCount <= 0 || dayWidth <= 0 || shownWidth <= 0) return null;
  const base = dayWidth / atLevel(zoom);
  for (let level = 0; level < ZOOM_LEVELS.length; level += 1) {
    if (dayCount * base * atLevel(level) <= shownWidth) return level;
  }
  return null;
}

/** One press of − (`1`) or + (`-1`), held inside the ladder. */
export const zoomStep = (level, direction) => Math.min(Math.max((Math.round(level) || 0) + direction, 0), ZOOM_LEVELS.length - 1);

/**
 * Whether every day in the range is already on screen - which is where zooming out stops.
 *
 * `shownWidth` is the days' half of the board: the project column is sticky and the days scroll
 * past it, so it is not part of what has to fit.
 *
 * `seamsWidth` is what the collapsed stretches take when projects are picked in the filter
 * (`boardColumns`): those are not days and do not scale with the zoom, so they come off the width
 * the days have to fit in rather than being counted as days.
 */
export const wholeRangeFits = (dayCount, dayWidth, shownWidth, seamsWidth = 0) => dayCount > 0 && dayWidth > 0 && shownWidth > 0
  && dayCount * dayWidth <= shownWidth - seamsWidth;

/** The most days the board asks for at once (the server's own limit). */
export const MAX_DAYS = 92;

/**
 * The range presets, looking ahead - a shoot board is about what is coming. The range is what is
 * loaded; the timeline scrolls sideways through it.
 */
export const RANGE_PRESETS = [
  // Shortest span first, nearest first among equals; the one that asks its own question last.
  { value: "week", label: "This week" },
  { value: "month", label: "This month" },
  { value: "next30", label: "Next 30 days" },
  { value: "nextMonth", label: "Next month" },
  { value: "next90", label: "Next 3 months" },
  { value: "custom", label: "Custom dates" },
];
export const DEFAULT_PRESET = "next30";

/** A preset's `{ from, to }` days from `today`; null for "custom", which the caller holds. */
export function presetRange(value, today = new Date()) {
  const day = startOfDay(today);
  switch (value) {
    case "next7": return { from: day, to: addDays(day, 6) };
    case "next30": return { from: day, to: addDays(day, 29) };
    case "next90": return { from: day, to: addDays(day, MAX_DAYS - 1) };
    case "nextMonth": return { from: new Date(day.getFullYear(), day.getMonth() + 1, 1), to: new Date(day.getFullYear(), day.getMonth() + 2, 0) };
    case "week": {
      const monday = addDays(day, -((day.getDay() + 6) % 7));
      return { from: monday, to: addDays(monday, 6) };
    }
    case "month": return { from: new Date(day.getFullYear(), day.getMonth(), 1), to: new Date(day.getFullYear(), day.getMonth() + 1, 0) };
    default: return null;
  }
}

/**
 * The timeline's rows: one per project **with a shoot in these days**, in the order its first shoot
 * comes, each with its **runs** - shoots on the same day or on days that follow one another, joined
 * into one bar. `startIndex` and `endIndex` are the bar's first and last column among `days`.
 *
 * A project with nothing inside `days` is **not a row**. The legend is built from every project in
 * the shoots handed in, and only then is each project narrowed to the days on screen - so without
 * this a project whose shoots all fall outside the window became a row with no runs. Such a row can
 * never be drawn, `rowsInView` excluding it and the project column listing only what is in view, but
 * it is not harmless: the empty state reads a row as "there is a shoot somewhere either side of these
 * days" and works the nearest one out from the rows' own runs, which a run-less row has none of. The
 * board crashed on `days[undefined]`.
 *
 * It is reached by narrowing the range - "This week" sets the days at once, while the shoots for that
 * week are still being fetched, so for one render the new days are held against the old range's
 * shoots. Dropping the row is what makes `rows.length` mean what the empty state takes it to mean.
 */
export function projectRows(shoots, days) {
  const index = new Map(days.map((day, position) => [dayKey(day), position]));
  const legend = projectLegend(shoots);
  return legend.map((project) => {
    const own = shoots
      .filter((shoot) => shoot.projectId === project.projectId && index.has(shootDayKey(shoot.shootDate)))
      .map((shoot) => ({ shoot, at: index.get(shootDayKey(shoot.shootDate)) }))
      .sort((a, b) => a.at - b.at);
    const runs = [];
    for (const { shoot, at } of own) {
      const last = runs[runs.length - 1];
      if (last && at - last.endIndex <= 1) {
        last.endIndex = at;
        last.shoots.push(shoot);
      } else {
        runs.push({ startIndex: at, endIndex: at, shoots: [shoot] });
      }
    }
    for (const run of runs) run.shoots = sortRun(run.shoots);
    return { ...project, runs };
  }).filter((row) => row.runs.length);
}

// A run's shoots by day, then by time within the day.
function sortRun(shoots) {
  const byDay = new Map();
  for (const shoot of shoots) {
    const key = shootDayKey(shoot.shootDate);
    byDay.set(key, [...(byDay.get(key) || []), shoot]);
  }
  return [...byDay.keys()].sort().flatMap((key) => sortByTime(byDay.get(key)));
}

/**
 * A stretch of empty days short enough to leave alone.
 *
 * Collapsing one empty day into a seam of its own saves nothing - the seam is about as wide as the
 * day it replaced - and costs the dates their even spacing. Two is where the saving starts.
 */
const MIN_COLLAPSE_DAYS = 2;

/** How wide a dotted seam is drawn, in rem. Fixed: what it says is the same at any zoom. */
export const SEAM_REM = 3;

/**
 * A shoot with no dates around it is a bar floating between two seams: the reader cannot see what
 * day comes before it or after, which is half of what a timeline is for. So the dates either side of
 * each shoot are kept, **as many as the room allows** - the board grows them outwards until the next
 * one would not fit, so the width is spent on real dates rather than on empty space.
 */

/**
 * The board's columns: one per day, and - only where the board **runs out of room** - the stretches
 * of empty days between the shoots collapsed into dotted seams.
 *
 * ── What is kept, and in what order it is given up ──
 *
 * Every day a bar covers, today, and a few dates either side of each shoot so a bar is never a thing
 * floating between two seams. Three islands of dates with dots between them is the shape this is
 * for: a project shooting today, in a month and a fortnight after that reads as three moments, each
 * with its own days around it, rather than as one bar at either end of a scroll.
 *
 * Room decides how much of that survives, in this order:
 *
 *   1. everything fits → **every date**, no dots at all;
 *   2. otherwise every stretch of empty days between the shoots becomes a dotted mark, and the dates
 *      around each shoot grow outwards - one more each side, then another - until the next one would
 *      not fit. The room is spent on dates; the marks stay the narrow things they are;
 *   3. and if not even the shoots with their own dates fit, that is what the board scrolls through.
 *
 * `available` is the width the days have (the project column is sticky and does not count), `dayPx`
 * what a day comes out at, `seamPx` what a seam takes. Without those - the first render, before
 * anything is measured - nothing is collapsed: a board that flashed a row of dots and then laid
 * itself out properly would read as a glitch.
 *
 * **Today is not held out of a mark.** It was, on the grounds that the board tints it and the Today
 * button goes to it - but a reader who has just named a project is looking at that project's dates,
 * and holding today open put a column of nothing in the middle of them. Today is still a date like
 * any other, kept when it is near a shoot and collapsed when it is not.
 *
 * `columnOfDay` answers "which column is this day drawn in" for every day in the range - a day
 * inside a collapsed stretch points at the seam standing for it, so a caller asking where a day went
 * always lands somewhere real.
 *
 * @returns {{ columns: Array<object>, columnOfDay: number[], dayColumns: number, seams: number }}
 */
export function boardColumns(days, rows = [], { collapse = false, available = 0, dayPx = 0, seamPx = 0 } = {}) {
  const everyDay = () => ({
    columns: days.map((day, dayIndex) => ({ kind: "day", day, dayIndex })),
    columnOfDay: days.map((_, index) => index),
    dayColumns: days.length,
    seams: 0,
  });
  if (!collapse || !days.length || available <= 0 || dayPx <= 0 || seamPx <= 0) return everyDay();
  const fits = (dayCount, seamCount) => dayCount * dayPx + seamCount * seamPx <= available;
  // Room for the lot: nothing is given up, and there is nothing to explain.
  if (fits(days.length, 0)) return everyDay();

  // What the dates are kept **around**: every day a bar covers, and nothing else.
  const anchors = [];
  for (const row of rows) {
    for (const run of row.runs) {
      for (let index = run.startIndex; index <= run.endIndex; index += 1) anchors.push(index);
    }
  }
  // Nothing to anchor on - a range with no shoots in it at all - so the dates are left alone.
  if (!anchors.length) return everyDay();

  /** The days kept at this much context, and the stretches between them worth a seam. */
  const shapeAt = (context) => {
    const keep = new Set();
    for (const anchor of anchors) {
      for (let index = anchor - context; index <= anchor + context; index += 1) {
        if (index >= 0 && index < days.length) keep.add(index);
      }
    }
    const stretches = [];
    let pending = null;
    days.forEach((day, dayIndex) => {
      if (keep.has(dayIndex)) { if (pending) { stretches.push(pending); pending = null; } return; }
      if (pending) { pending.to = dayIndex; pending.days += 1; return; }
      pending = { kind: "gap", from: dayIndex, to: dayIndex, days: 1 };
    });
    if (pending) stretches.push(pending);
    return { kept: keep.size, candidates: stretches.filter((stretch) => stretch.days >= MIN_COLLAPSE_DAYS) };
  };

  /** The columns these seams make, in date order. */
  const assemble = (chosen) => {
    const seamByFirstDay = new Map(chosen.map((stretch) => [stretch.from, stretch]));
    const columns = [];
    const columnOfDay = new Array(days.length).fill(0);
    let dayIndex = 0;
    while (dayIndex < days.length) {
      const seam = seamByFirstDay.get(dayIndex);
      if (seam) {
        for (let index = seam.from; index <= seam.to; index += 1) columnOfDay[index] = columns.length;
        columns.push(seam);
        dayIndex = seam.to + 1;
        continue;
      }
      columnOfDay[dayIndex] = columns.length;
      columns.push({ kind: "day", day: days[dayIndex], dayIndex });
      dayIndex += 1;
    }
    return { columns, columnOfDay, dayColumns: columns.length - chosen.length, seams: chosen.length };
  };

  /*
   * The **widest** context that still fits, found by growing it a day at a time.
   *
   * Going the other way - starting generous and giving up - left the board half spent: three dates
   * around each shoot and the rest of the width taken by a seam stretched across it, which is a lot
   * of screen saying "nothing here". Growing instead spends the room on dates, which is the thing
   * worth looking at, and stops at the last day that fits. The seams stay the narrow marks they are.
   */
  let widest = null;
  for (let context = 0; context <= days.length; context += 1) {
    const { kept, candidates } = shapeAt(context);
    // Nothing left worth collapsing: the axis is all dates, which the fit above would have taken.
    if (!candidates.length) break;
    if (!fits(kept, candidates.length)) break;
    widest = candidates;
  }
  if (widest) return assemble(widest);
  // Not even the shoots and their own dates fit: the tightest shape there is, and it scrolls.
  return assemble(shapeAt(0).candidates);
}

/**
 * The days a window of columns covers (`first`–`last`, column indexes), as day indexes.
 *
 * Everything that asks what is on screen - which rows to list, what the empty state names - asks in
 * **days**, because that is what a shoot has. A seam stands for all of its days, so scrolling one
 * onto the screen brings its whole stretch with it.
 */
export function dayRangeOfColumns(columns, first, last) {
  const window = columns.slice(Math.max(0, first), Math.max(0, last) + 1);
  if (!window.length) return { from: 0, to: 0 };
  const days = window.flatMap((column) => (column.kind === "day" ? [column.dayIndex] : [column.from, column.to]));
  return { from: Math.min(...days), to: Math.max(...days) };
}

/**
 * The rows with a bar in the days on screen (`first`–`last`, column indexes), so the project column
 * lists what the eye is on and changes as the timeline scrolls.
 */
export function rowsInView(rows, first, last) {
  return rows.filter((row) => row.runs.some((run) => run.endIndex >= first && run.startIndex <= last));
}

/** Why a custom range cannot be used, or "" when it can. */
export function customRangeProblem(from, to) {
  if (!from || !to) return "Pick both days.";
  if (to < from) return "The last day comes before the first.";
  if (daysBetween(from, to) + 1 > MAX_DAYS) return `Pick at most ${MAX_DAYS} days.`;
  return "";
}
