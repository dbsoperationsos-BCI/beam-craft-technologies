/**
 * Everybody a project is staffed to, in the order the Start Project form asks for them.
 *
 * The browser's copy of `PROJECT_STAFF_FIELDS` in
 * [projects/controller.js](../../../backend/src/modules/sales/projects/controller.js), which is what
 * `PATCH` and `DELETE /api/sales/projects/:id` actually decide by. Written once here rather than
 * spelled out on each screen that asks the question: two screens read it, and a fifth role added to
 * the Start Project form is a name that has to appear in one place per side for every menu to know
 * about it.
 *
 * The **Project Manager leads the list**, and that ordering is load-bearing: deleting a project is
 * theirs alone, which both sides express as the first entry rather than as a second list that could
 * disagree with this one.
 */
export const PROJECT_STAFF_FIELDS = [
  "projectManagerEmployeeId",
  "preProductionCoordinatorEmployeeId",
  "creativeManagerEmployeeId",
  "postProductionCoordinatorEmployeeId",
];
