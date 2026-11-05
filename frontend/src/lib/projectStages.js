/**
 * Which stage of production a project is in the hands of, and which day it happens on.
 *
 * A project carries no stage of its own. It carries the people staffed to it, and a stage is
 * somebody having been given that part of the work - which is exactly how the Pre Production and
 * Post Production boards have always read the register. The Meetings list now asks the same
 * question of the same rows, so the rule lives here rather than being written out twice and
 * quietly drifting apart.
 */

const named = (value) => Boolean(String(value ?? "").trim());

/** Somebody is coordinating this project's pre-production. */
export const inPreProduction = (project) =>
  Boolean(project?.preProductionCoordinatorEmployeeId) || named(project?.preProductionCoordinator);

/** Somebody is coordinating this project's post-production. */
export const inPostProduction = (project) =>
  Boolean(project?.postProductionCoordinatorEmployeeId) || named(project?.postProductionCoordinator);

/**
 * The calendar day a project happens on, as `YYYY-MM-DD`, or "" when no date has been fixed.
 *
 * Sliced off the stored ISO text rather than read through a `Date`. A main event date is a **day**
 * the studio wrote down, not a moment, so putting it through the browser's own timezone would move
 * an 11 September wedding to the 10th for anybody west of Greenwich - the same fault the calendar's
 * `day` field exists to avoid, and the same slice the server's own `dayOf` takes.
 */
export function projectDay(project) {
  const value = project?.mainEventDate;
  if (!value) return "";
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? "" : value.toISOString().slice(0, 10);
  const text = String(value);
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : "";
}
