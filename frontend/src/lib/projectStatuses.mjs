import { formatRupees } from "./saleExtras.mjs";

/**
 * A project's status. Only `PROJECT_STATUSES` may be chosen - by bulk Update, Start Project or an
 * import. Projects saved before 14 Oct 2026 can still read one of the old statuses and keep it, so
 * every check reads through the sets below, which count the old words with the new.
 */
export const PROJECT_STATUSES = ["Yet to Start", "In Progress", "Completed", "On Hold", "Rejected"];

/** In Progress, and the two old Work in Progress statuses it replaced. */
export const IN_PROGRESS_STATUSES = new Set([
  "In Progress",
  "Work in Progress - Pre & Production",
  "Work in Progress - Post Production",
]);

/** Completed, and Delivered - its old name. */
export const COMPLETED_STATUSES = new Set(["Completed", "Delivered"]);

export const isInProgressStatus = (status) => IN_PROGRESS_STATUSES.has(status);
export const isCompletedStatus = (status) => COMPLETED_STATUSES.has(status);

/**
 * The status a project stands under on a Board: its own when it is one of `PROJECT_STATUSES`, an old
 * one under the status that replaced it (the two sets above), and any other old word - Cancelled &
 * Refunded, Client not Turned, Duplicated, Date Elapsed - as itself, so the Board's Other column
 * holds it under the same word the table's status column shows. Never under Yet to Start: those
 * projects ended without being started, and the Project Status stage flags them as such.
 */
export function projectBoardStatus(project) {
  const status = project?.projectStatus || "Yet to Start";
  if (PROJECT_STATUSES.includes(status)) return status;
  if (isInProgressStatus(status)) return "In Progress";
  if (isCompletedStatus(status)) return "Completed";
  return status;
}

/** Why a Board will not set a project's status by a drop, or "" when the drop may run. */
export const START_PROJECT_REFUSAL = "A project leaves Yet to Start through Start Project on the Projects page, which records its setup and opens its Pre Production - a drop cannot start it.";
export function projectBoardDropRefusal(project, to) {
  // Out of Yet to Start by any drop - into In Progress or straight to Completed - skips Start Project.
  return projectBoardStatus(project) === "Yet to Start" && (isInProgressStatus(to) || isCompletedStatus(to)) ? START_PROJECT_REFUSAL : "";
}

/** The cards a Board of projects draws: the group name, its Event ID and vertical, its event date. */
const boardDate = (value) => {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(date) : "";
};
/*
 * What a project was converted at (its Initial Converted Value, the table's column of that name): on
 * its card beside the event date, and summed under each column's heading over the cards the column
 * is showing (`projectColumnAmount`, a `KanbanBoard` `columnAmount`) - on every project board:
 * Bookings, Projects and Post Production.
 */
export const convertedValueOf = (project) => Number(project?.initialConvertedValue) || 0;
export const PROJECT_BOARD_CARD = {
  title: (project) => project.whatsappGroupName?.trim() || project.eventId || project.enquiryId || "Project",
  subtitle: (project) => [project.eventId || project.enquiryId, project.vertical].filter(Boolean).join(" · "),
  meta: (project) => [
    project.mainEventDate ? `Event ${boardDate(project.mainEventDate)}` : "",
    convertedValueOf(project) ? formatRupees(convertedValueOf(project)) : "",
  ].filter(Boolean).join(" · "),
};
export const projectColumnAmount = (rows) => ({
  label: "Converted",
  amount: rows.reduce((sum, project) => sum + convertedValueOf(project), 0),
  title: "Total Initial Converted Value of these projects",
});
