/**
 * Which columns of an employee record the data scope narrows by (`dataScope.resolve`'s `columns`),
 * declared once for every reader of employee rows - the employees screen (`controller.js`) and
 * Nebula's attendance lookup (`services/ai/tools/attendance.js`) - so the two cannot drift.
 *
 * `employee: "id"`: the record names the person themself. `branch` is the branch reference, and
 * `branchText` the two work-location texts it is derived from, as a fallback for somebody based in one
 * branch and working in another. `branchOnReach`: reaching a branch is the claim on its people - a
 * register of who works here is the studio's own shape, not a colleague's work (see the controller).
 */
const EMPLOYEE_SCOPE_COLUMNS = { employee: "id", branch: "branchId", branchText: ["workBaseLocation", "currentWorkLocation"], branchOnReach: true };

module.exports = { EMPLOYEE_SCOPE_COLUMNS };
