import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

/*
 * `SALES / Booking Edit`: editing a booking on Bookings & Converted - and on Projects - without being
 * staffed on the project, a branch administrator, or holding `PROJECT / Show All Projects`, which
 * would also hand over every project on three other boards.
 *
 * Both screens decide the row's Edit the same way the server decides the write (`mayEditProject`), so
 * the menu cannot offer an Edit the endpoint refuses, or hide one it would allow.
 */

const read = (file) => fs.readFileSync(new URL(`../src/components/${file}`, import.meta.url), "utf8");
const SCREENS = ["sales/SalesManagerPage.js", "project-management/ProjectsPage.js"];

test("both screens read the grant and let it answer for the row's Edit", () => {
  for (const screen of SCREENS) {
    const source = read(screen);
    assert.match(source, /const \{ canWrite: mayEditBookings \} = useModuleAccess\("SALES", "Booking Edit"\);/, `${screen}: asked at Read / Write`);
    // On both screens the grant is one more way in, beside the three that already were. Bookings &
    // Converted lets it in only on a sent-back project (`project-send-back.test.mjs`); the other three
    // edit there as they always did.
    assert.match(
      source,
      screen.startsWith("sales/")
        ? /\(project\) => editsAnyTime\(project\) \|\| \(mayEditBookings && Boolean\(project\?\.sentBackAt\)\),/
        // Projects: planning projects is enough on its own as well (the studio's rule for that screen).
        : /\(project\) => canPlanProjects \|\| mayEditBookings \|\| administersBranches \|\| worksEveryProject \|\| staffedOn\(project, PROJECT_STAFF_FIELDS\),/,
      `${screen}: one more way in, beside the three that already were`,
    );
    // Deleting is untouched: still the Project Manager's, a branch administrator's or Show All Projects'.
    assert.match(
      source,
      /\(project\) => administersBranches \|\| worksEveryProject \|\| staffedOn\(project, PROJECT_STAFF_FIELDS\.slice\(0, 1\)\),/,
      `${screen}: deleting does not read the booking grant`,
    );
  }
});

test("the row's Edit answers to that rule, and Delete to the stricter one", () => {
  const table = read("data-table/ProjectDataTable.js");
  // `mayEditRecord` is what draws Edit / Edit Sale Details; `mayDeleteRecord` draws Delete.
  assert.match(table, /const mayEditRecord = answers\(canEditProject\);/);
  assert.match(table, /mayEditRecord && onEditSaleDetails \? \[\{ label: "Edit",/);
  assert.match(table, /mayDeleteRecord && onDelete \? \[\{ label: "Delete", tone: "danger",/);
});

test("the grant alone draws no Edit - a module write is still needed, as the route guard asks", () => {
  /*
   * What keeps the menu and the endpoint in step. `PATCH /api/sales/projects/:id` sits behind the
   * router's own guard (one of SALES / Sales Manager, PROJECT / Projects or PROJECT / Show All
   * Projects at Read / Write), and the booking grant is deliberately not in that list - it would also
   * open the client-login read and the bulk delete behind the same guard. So a role holding only Edit
   * Bookings must not be shown an Edit the server would refuse, and it is not: the row's rule needs
   * `canEditSale || canPlan` as well, each of which *is* one of those module writes.
   */
  const table = read("data-table/ProjectDataTable.js");
  assert.match(table, /const answers = \(may\) => !readOnly && Boolean\(canEditSale \|\| canPlan\) && typeof may === "function" && may\(project\);/);
  // And each screen hands those two from a module write of its own, never from the booking grant.
  assert.match(read("sales/SalesManagerPage.js"), /canEditSale=\{canWrite\}[\s\S]*readOnly=\{!canWrite\}/, "Bookings & Converted: Sales Manager Read / Write");
  const projects = read("project-management/ProjectsPage.js");
  assert.match(projects, /const canPlanProjects = canWrite \|\| worksEveryProject;/);
  assert.match(projects, /const \{ canWrite: canEditSale \} = useModuleAccess\("SALES", "Sales Manager"\);/);
  assert.match(projects, /readOnly=\{!canPlanProjects && !canEditSale\}/);
});
