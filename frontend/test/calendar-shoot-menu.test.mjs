import test from "node:test";
import assert from "node:assert/strict";
import { calendarShootMenuItems } from "../src/lib/calendarShootMenu.mjs";

const grants = (...held) => (module, feature, level) => held.includes(`${module}/${feature}/${level}`)
  || (level === "READ" && held.includes(`${module}/${feature}/READ_WRITE`));
const menu = (shoot, can, onGo = () => {}) => calendarShootMenuItems({ shoot, can, onGo });
const labels = (items, label) => (items.find((item) => item.label === label)?.submenu || []).map((item) => item.label);
const ALL = grants("SALES/Sales Manager/READ_WRITE", "PROJECT/Projects/READ_WRITE", "PROJECT/Pre Production/READ_WRITE", "PROJECT/Production/READ_WRITE", "PROJECT/Post Production/READ_WRITE", "ACCOUNTS/Cash Management/READ_WRITE");
const EVERY_BOARD = ["bookings", "projects", "pre-production", "production", "post-production"];
const IN_PRODUCTION = { eventId: "E1", boards: EVERY_BOARD, shootRecordId: "s1", hasPreProduction: true, productionShootId: 9 };

test("two submenus: Navigate to the project's boards, and Update the forms this shoot is changed in", () => {
  const items = menu(IN_PRODUCTION, ALL);
  assert.deepEqual(items.map((item) => item.label), ["Navigate to", "Update"]);
  assert.deepEqual(labels(items, "Navigate to"), ["Bookings & Converted", "Projects", "Pre Production", "Production", "Post Production"]);
  assert.deepEqual(labels(items, "Update"), ["Project", "Pre Production", "Production", "Payment"]);
});

test("each form is offered when the shoot has that record - both together when it has both", () => {
  assert.deepEqual(labels(menu({ ...IN_PRODUCTION, productionShootId: null }, ALL), "Update"), ["Project", "Pre Production", "Payment"]);
  assert.deepEqual(labels(menu({ ...IN_PRODUCTION, hasPreProduction: false }, ALL), "Update"), ["Project", "Production", "Payment"]);
  assert.deepEqual(labels(menu({ ...IN_PRODUCTION, hasPreProduction: false, productionShootId: null }, ALL), "Update"), ["Project", "Payment"]);
});

test("each entry asks for its own permission - reading a board is not updating it", () => {
  const only = (...held) => menu(IN_PRODUCTION, grants(...held));
  assert.deepEqual(only("PROJECT/Production/READ").map((item) => item.label), ["Navigate to"]);
  assert.deepEqual(labels(only("PROJECT/Production/READ_WRITE"), "Update"), ["Production"]);
  assert.deepEqual(labels(only("PROJECT/Projects/READ_WRITE", "ACCOUNTS/Cash Management/READ"), "Update"), ["Project"], "recording a payment needs Cash Management write");
  assert.deepEqual(menu({ boards: EVERY_BOARD }, ALL), [], "no project, nothing to open");
});

test("the Update links open the project form, the shoot on each board and the Payments tab", () => {
  const went = [];
  const update = menu({ ...IN_PRODUCTION, eventId: "DBS 1", shootRecordId: "s/1" }, ALL, (href) => went.push(href)).find((item) => item.label === "Update");
  update.submenu.forEach((item) => item.onSelect());
  assert.deepEqual(went, [
    "/project-management/projects?project=DBS%201&edit=1",
    "/project-management/pre-production?shoot=s%2F1",
    "/project-management/production?shoot=s%2F1",
    "/project-management/projects?project=DBS%201&edit=1&view=payments",
  ]);
});

test("Navigate to lands each board on this shoot, not only its project", () => {
  const went = [];
  const jump = menu({ ...IN_PRODUCTION, eventId: "DBS 1", shootId: "SID 7", shootRecordId: "s/1" }, ALL, (href) => went.push(href)).find((item) => item.label === "Navigate to");
  jump.submenu.forEach((item) => item.onSelect());
  assert.deepEqual(went, [
    "/sales/manager?project=DBS%201",
    // Projects filters its Event ID / Shoot ID column to the Shoot ID: the project opens on that shoot's row.
    "/project-management/projects?project=SID%207",
    "/project-management/pre-production?project=DBS%201&shoot=s%2F1",
    "/project-management/production?project=DBS%201&shoot=s%2F1",
    "/project-management/post-production?project=DBS%201",
  ]);
});
