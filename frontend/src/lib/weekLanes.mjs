// A relative import rather than the `@/` alias, so `node --test` can load it.
import { compareScheduleEntries } from "./schedule.js";

/**
 * The calendar's Week view, laid out as the Shoot Board lays out its days: each booking a bar across
 * the days it covers, and the bars stacked in lines so none sits on another.
 *
 * A project's shoots on days one after another - several on one day included - are one bar, from its
 * first day to its last, so a wedding's Reception on Friday and Wedding on Saturday read as one run on
 * one line rather than one at the top of Friday and the other at the bottom of Saturday. A day with no
 * shoot of that project between them ends the run. Everything else - a meeting, an interview, a
 * blocked period, a holiday, an attendance mark - is a bar of one day.
 *
 * `days` are the week's cells (`{ key }`, Monday first); `byDay` is `scheduleByDay`'s map. Answers
 * `{ spans, lanes }`: each span `{ start, end, entries, lane }` (`start`/`end` are day indexes,
 * inclusive), and how many lines they take.
 */
export function weekLanes(days = [], byDay = new Map()) {
  const indexOf = new Map(days.map((day, index) => [day.key, index]));
  const spans = [];
  const shootsByProject = new Map();
  days.forEach((day) => {
    for (const entry of byDay.get(day.key) || []) {
      const index = indexOf.get(day.key);
      if (entry.kind === "shoot" && entry.subject) {
        if (!shootsByProject.has(entry.subject)) shootsByProject.set(entry.subject, new Map());
        const byIndex = shootsByProject.get(entry.subject);
        if (!byIndex.has(index)) byIndex.set(index, []);
        byIndex.get(index).push(entry);
      } else {
        spans.push({ start: index, end: index, entries: [entry] });
      }
    }
  });
  // Each project's shoot days, cut into runs of days one after another.
  for (const byIndex of shootsByProject.values()) {
    let run = null;
    for (const index of [...byIndex.keys()].sort((left, right) => left - right)) {
      if (run && index === run.end + 1) {
        run.end = index;
        run.entries.push(...byIndex.get(index));
      } else {
        run = { start: index, end: index, entries: [...byIndex.get(index)] };
        spans.push(run);
      }
    }
  }
  // The earliest first, the longest of those first, then in a day's own running order.
  spans.sort((left, right) => (left.start - right.start) || ((right.end - right.start) - (left.end - left.start)) || compareScheduleEntries(left.entries[0], right.entries[0]));
  // Each bar on the first line free over all of its days.
  const lineEnds = [];
  for (const span of spans) {
    let lane = lineEnds.findIndex((end) => end < span.start);
    if (lane === -1) { lane = lineEnds.length; lineEnds.push(span.end); } else lineEnds[lane] = span.end;
    span.lane = lane;
  }
  return { spans, lanes: lineEnds.length };
}
