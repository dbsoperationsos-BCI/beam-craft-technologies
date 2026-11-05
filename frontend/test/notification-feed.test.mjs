import test from "node:test";
import assert from "node:assert/strict";

import { sourceNotices, storedNotifications } from "../src/lib/notificationFeed.mjs";

/*
 * Reading the bell's reply.
 *
 * This is the one place in the panel where being wrong says nothing: the badge counts from
 * `meta.unreadCount` and the list is drawn from the rows, so a reply read from the wrong place
 * leaves the bell saying "3" over a panel reading "No task notifications." Nothing errors, nothing
 * is logged, and the only way to notice is to be the person who was told about a task and cannot
 * find it.
 *
 * That shipped. The endpoint answered with the stored rows as `data`, then grew a derived half and
 * became `{ data: { notifications, notices, sources } }`; the hook went on asking
 * `Array.isArray(data)`, which is false for every reply the server now sends.
 */

const notification = (id) => ({ id, title: `Task ${id}`, body: "", link: `/hrm/tasks?task=${id}`, readAt: null, createdAt: "2026-09-08T09:00:00.000Z" });
const notice = (id) => ({ id, title: `Follow-up ${id}`, at: "2026-09-08T09:00:00.000Z" });

test("the stored rows are read from the reply the server actually sends", () => {
  const response = {
    data: { notifications: [notification(1), notification(2)], notices: [notice("f1")], sources: ["tasks"] },
    meta: { unreadCount: 2 },
  };
  assert.deepEqual(storedNotifications(response).map((row) => row.id), [1, 2]);
});

test("the two halves do not read each other", () => {
  // Drawn as separate halves of one panel and unread in different ways, so a reply whose derived
  // half is full and whose stored half is empty must not fill the task list with follow-ups.
  const response = { data: { notifications: [], notices: [notice("f1"), notice("f2")] } };
  assert.deepEqual(storedNotifications(response), []);
  assert.deepEqual(sourceNotices(response).map((row) => row.id), ["f1", "f2"]);
});

test("a reply from an older server still fills the bell", () => {
  // A deployment is a few minutes with a new browser against the server it is replacing, and a
  // bell that empties itself for those minutes is the bug this whole file is about, in miniature.
  assert.deepEqual(storedNotifications({ data: [notification(7)] }).map((row) => row.id), [7]);
});

test("anything that is not a list of rows reads as none, rather than throwing on the topbar", () => {
  // This runs on every screen in the application: a reply that is missing, refused or shaped
  // unexpectedly has to leave a quiet bell rather than take the bar down with it.
  for (const response of [undefined, null, {}, { data: null }, { data: {} }, { data: { notifications: null } }, { data: "nope" }]) {
    assert.deepEqual(storedNotifications(response), []);
    assert.deepEqual(sourceNotices(response), []);
  }
});
