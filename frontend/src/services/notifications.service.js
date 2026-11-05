import { apiRequest } from "@/services/api/client";

/**
 * The bell in the top bar: everything the application has to tell the person signed in.
 *
 * One store and one request for the whole application rather than a panel per feature. The bell
 * hangs off the topbar, so it is on every screen and polls while it is there - a request per source
 * would be a cost paid on every page for something that is a glance.
 *
 * The reply carries two kinds of notice, because they are unread in genuinely different ways:
 *
 *   - `notifications` are stored rows, written by the module that raised them (tasks today), each
 *     with its own read state, because being told to do something is a fact about the studio.
 *   - `notices` are derived on read - a follow-up due this morning, a client who replied, a call
 *     nobody has opened, an approval waiting - and stop being listed when the work is done rather
 *     than when somebody has looked at them.
 *
 * The server decides which of either this person may see, against each module's own permission, so
 * what arrives is already only what they may act on. `sources` says which ones actually answered,
 * which is what lets the bell tell "nothing is waiting" from "you cannot see any of this" - two
 * very different empty states.
 */
// The request already on its way, shared: the bell's stored notices and its derived ones
// (`useStoredNotifications`, `useSourceNotices`) both read this list on every page and every poll,
// and asked the server for it separately - three calls per page load where one answers both.
let pending = null;

export function getNotifications() {
  if (!pending) pending = apiRequest("/api/notifications").finally(() => { pending = null; });
  return pending;
}

/**
 * Opening a notice: it has been seen, and the badge stops counting it.
 *
 * Stored rows only. A derived notice has nothing to mark - it is a follow-up that is due, and it
 * goes when the follow-up is made; the bell remembers a glance at those in this browser instead.
 */
export function markNotificationRead(id) {
  return apiRequest(`/api/notifications/${id}/read`, { method: "POST" });
}

/** What opening the bell does — everything stored in it has now been looked at. */
export function markAllNotificationsRead() {
  return apiRequest("/api/notifications/read-all", { method: "POST" });
}
