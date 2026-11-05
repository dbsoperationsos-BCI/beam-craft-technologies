const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { postedNotice } = require("../src/modules/hrm/events/eventNotifications");
const { TYPES, TYPE_PERMISSIONS } = require("../src/services/notifications");

/*
 * HRM → Events on the bell: a post is announced to everybody who can open the page, and a removed
 * post takes its notices with it.
 */

const MODULE = path.join(__dirname, "..", "src", "modules", "hrm", "events");
const HELPER = fs.readFileSync(path.join(MODULE, "eventNotifications.js"), "utf8");
const CONTROLLER = fs.readFileSync(path.join(MODULE, "controller.js"), "utf8");

test("a posted event is read by whoever holds HRM / Events, and nobody else", () => {
  assert.deepEqual(TYPE_PERMISSIONS[TYPES.EVENT_POSTED], { module: "HRM", feature: "Events" });
  // Written to the same permission the route guard asks for, and never back to the poster.
  assert.match(HELPER, /hasPermission\(user\.id, "HRM", "Events", "READ"\)/);
  assert.match(HELPER, /NOT: \{ id: actorId \}/);
  assert.match(HELPER, /status: "ACTIVE"/);
});

test("the notice names the event, its day and who posted it, and links to Events", () => {
  const notice = postedNotice({ id: 7, title: "Annual Day", eventDate: "2026-09-20", postedBy: "Asha" });
  assert.equal(notice.type, "EVENT_POSTED");
  assert.equal(notice.title, "New event: Annual Day");
  assert.equal(notice.body, "20 Sep 2026 · Posted by Asha");
  assert.equal(notice.entityType, "HRM_EVENT");
  assert.equal(notice.entityId, "7");
  assert.equal(notice.link, "/hrm/events");
  assert.ok(postedNotice({ id: 1, title: "x".repeat(300) }).title.length <= 200, "a long title overflows the column");
});

test("posting announces without making the poster wait, and removing withdraws", () => {
  assert.match(CONTROLLER, /void announceEvent\(event, /);
  assert.match(CONTROLLER, /await withdrawEvent\(id\)/);
  // A bell that could not be written never turns a successful post into an error.
  assert.match(HELPER, /catch \(error\) \{\s*console\.warn\("Unable to announce the event:/);
});
