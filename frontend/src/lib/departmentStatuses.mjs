/*
 * What a project's overall Pre Production or Production status may be set to by hand - the Update
 * status dialog's choices, and which of them belong to the ticked projects only.
 *
 * Here rather than in the dialog because it is the rule, not the drawing: each board's own list, in
 * the order its tabs read, checked against the server's (`modules/project-management/
 * departmentStatus.js`) by the tests rather than by whoever edits one of them next.
 */

/** Automatic, which hands the status back to the shoots. */
export const AUTO = "AUTO";

/*
 * The three offered over **ticked projects only**, never on one row's ⋮ Update status: they answer
 * "where is this whole batch", which is a thing to say about a set of projects being moved together
 * rather than about a single one, whose own board already says where it stands.
 */
export const BULK_ONLY_STATUSES = new Set(["YET_TO_START", "WORK_IN_PROGRESS", "COMPLETED"]);

/** The exceptions, and the only statuses that carry remarks - the rest are saved without one. */
export const NEEDS_REMARKS = new Set(["HOLD", "REJECTED"]);

/**
 * Each board's statuses. Pre Production is done at **Planned** and has no Completed of its own;
 * Production is done at **Completed**. Either can be put back to Yet to Start.
 */
export const DEPARTMENT_STATUS_OPTIONS = {
  preProduction: [
    { value: AUTO, label: "Automatic (from its shoots)" },
    { value: "YET_TO_START", label: "Yet to Start" },
    { value: "WORK_IN_PROGRESS", label: "Work in Progress" },
    { value: "PLANNED", label: "Planned" },
    { value: "HOLD", label: "Hold" },
    { value: "REJECTED", label: "Rejected" },
  ],
  production: [
    { value: AUTO, label: "Automatic (from its shoots)" },
    { value: "YET_TO_START", label: "Yet to Start" },
    { value: "WORK_IN_PROGRESS", label: "Work in Progress" },
    { value: "PLANNED", label: "Planned" },
    { value: "COMPLETED", label: "Completed" },
    { value: "HOLD", label: "Hold" },
    { value: "REJECTED", label: "Rejected" },
  ],
};

/** The statuses the dialog offers: a board's own, less the bulk-only pair on a single project. */
export const departmentStatusOptions = (department, bulk = false) =>
  (DEPARTMENT_STATUS_OPTIONS[department] || []).filter((option) => bulk || !BULK_ONLY_STATUSES.has(option.value));

/**
 * What the chosen status will do, said before it is saved. The statuses the shoots also reach get
 * their own line: Hold and Rejected read as overrides already, but Planned, Completed and Yet to
 * Start are what the shoots work out on their own, so without this nobody could tell that choosing
 * one here stops the status following them.
 */
const SHOOT_WORKED_OUT = { YET_TO_START: "Yet to Start", WORK_IN_PROGRESS: "Work in Progress", PLANNED: "Planned", COMPLETED: "Completed" };
export function departmentStatusOutcome(status, name) {
  if (status === AUTO) return `The ${name} status is worked out from the shoots again.`;
  if (SHOOT_WORKED_OUT[status]) return `Shows ${SHOOT_WORKED_OUT[status]} until you choose Automatic again, even as the shoots move on. Every shoot keeps its own status.`;
  return `Only the project's ${name} status changes; every shoot keeps its own.`;
}
