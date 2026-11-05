import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { orderShoots, reorderShoots, shootListOrder, shootsByDate } from "../src/lib/shootOrder.mjs";

/*
 * A project's Shoot List can be dragged into the order the studio wants, on every form that edits a
 * project's shoots. Only the list's order: dates, Shoot IDs and every other screen are untouched.
 */

const read = (file) => readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8");
// As the server sends them: by date.
const byDate = [
  { id: "a", shoot: "Pre Wedding", dateCreated: "2026-08-24", sortOrder: null },
  { id: "b", shoot: "Wedding", dateCreated: "2026-08-26", sortOrder: null },
  { id: "c", shoot: "Haldi", dateCreated: "2026-10-27", sortOrder: null },
  { id: "d", shoot: "Post Wedding", dateCreated: "2026-10-30", sortOrder: null },
];
const ids = (shoots) => shoots.map((shoot) => shoot.id);

test("a list nobody has arranged stays in date order", () => {
  assert.deepEqual(ids(orderShoots(byDate)), ["a", "b", "c", "d"]);
  assert.deepEqual(orderShoots(undefined), []);
});

test("a dragged order is kept, and a shoot added afterwards follows it by date", () => {
  const arranged = byDate.map((shoot) => ({ ...shoot, sortOrder: { a: 2, b: 0, c: 1, d: 3 }[shoot.id] }));
  assert.deepEqual(ids(orderShoots(arranged)), ["b", "c", "a", "d"]);
  const withNew = [...arranged, { id: "e", shoot: "Reception", dateCreated: "2026-08-01", sortOrder: null }];
  assert.deepEqual(ids(orderShoots(withNew)), ["b", "c", "a", "d", "e"]);
});

test("dragging stamps every shoot with its new place and changes nothing else", () => {
  const moved = reorderShoots(byDate, ["d", "a", "b", "c"]);
  assert.deepEqual(ids(moved), ["d", "a", "b", "c"]);
  assert.deepEqual(moved.map((shoot) => shoot.sortOrder), [0, 1, 2, 3]);
  assert.equal(moved[0].dateCreated, "2026-10-30", "the date is never touched");
  // A key nobody holds is ignored, and a shoot left out keeps its place after the named ones.
  assert.deepEqual(ids(reorderShoots(byDate, ["c", "zzz", "a"])), ["c", "a", "b", "d"]);
});

test("every form editing a project's shoots offers the drag; quoted shoots do not", () => {
  const plan = read("components/project-management/useProjectPlan.js");
  assert.match(plan, /onReorderShoots: reorderShoots,/);
  assert.match(plan, /setShoots\(orderShoots\(shootResult\?\.data\)\);/);
  assert.match(plan, /await reorderProjectShoots\(projectId, ids\);/);
  assert.match(plan, /await refreshShoots\(\);/, "a failed save reads the shoots back");
  const create = read("components/sales/CreateProjectFormPanel.js");
  assert.match(create, /onReorderShoots=\{shootsFromQuotation \? undefined : \(keys\) => setForm\(\(current\) => \(\{ \.\.\.current, shoots: reorderShoots\(current\.shoots, keys\) \}\)\)\}/);
  assert.match(read("services/project-management/project-workflow.service.js"), /\/api\/sales\/projects\/\$\{projectId\}\/shoots\/order`, \{\s+method: "PUT"/);
});

/*
 * A project's shoots in date order everywhere: the earliest first, a shoot with no date yet after every
 * dated one, and shoots on one day in the order they had. The server lists them so; the project plan
 * and Create Project keep that order while shoots are added and re-dated on screen.
 */
test("dated shoots earliest first, undated last, ties as they were", () => {
  const shoots = [
    { id: "a", dateCreated: null },
    { id: "b", dateCreated: "2026-11-25" },
    { id: "c", dateCreated: "2026-10-29" },
    { id: "d" },
    { id: "e", dateCreated: "2026-10-29T18:30:00.000Z" },
    { id: "f", dateCreated: "2026-10-29" },
  ];
  assert.deepEqual(shootsByDate(shoots).map((shoot) => shoot.id), ["c", "f", "e", "b", "a", "d"]);
  assert.deepEqual(shootsByDate([{ id: "x", shootDate: "2026-12-01" }, { id: "y", shootDate: "2026-11-01" }], (shoot) => shoot.shootDate).map((shoot) => shoot.id), ["y", "x"]);
  assert.deepEqual(shootsByDate(undefined), []);
});

test("the project plan and Create Project keep their shoots in date order, with a dragged order on top", () => {
  const plan = readFileSync(new URL("../src/components/project-management/useProjectPlan.js", import.meta.url), "utf8");
  assert.match(plan, /const orderedShoots = useMemo\(\(\) => shootListOrder\(shoots\), \[shoots\]\);/);
  assert.match(plan, /return \{\s*shoots: orderedShoots,/);
  assert.match(plan, /sectionProps: \{\s*shoots: orderedShoots,/);
  const create = readFileSync(new URL("../src/components/sales/CreateProjectFormPanel.js", import.meta.url), "utf8");
  assert.equal((create.match(/shoots: shootListOrder\(/g) || []).length, 4, "quoted, prefilled, added and edited shoots are all put in order");
});

test("an arranged Shoot List stays arranged when a shoot is added or re-dated; a list nobody arranged is date order", () => {
  const unarranged = [{ id: "late", dateCreated: "2026-12-01" }, { id: "none" }, { id: "early", dateCreated: "2026-11-01" }];
  assert.deepEqual(ids(shootListOrder(unarranged)), ids(shootsByDate(unarranged)), "nobody dragged: exactly the date order");
  const arranged = reorderShoots(shootsByDate(unarranged), ["late", "early", "none"]);
  const added = [...arranged, { id: "new", dateCreated: "2026-10-01" }];
  assert.deepEqual(ids(shootListOrder(added)), ["late", "early", "none", "new"], "the dragged order holds; the new shoot follows it");
  const redated = arranged.map((shoot) => (shoot.id === "late" ? { ...shoot, dateCreated: "2027-01-01" } : shoot));
  assert.deepEqual(ids(shootListOrder(redated)), ["late", "early", "none"]);
});
