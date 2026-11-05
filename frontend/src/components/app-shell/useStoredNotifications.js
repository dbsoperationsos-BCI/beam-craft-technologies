"use client";

import { useCallback, useEffect, useState } from "react";
import { getNotifications, markNotificationRead } from "@/services/notifications.service";
import { storedNotifications } from "@/lib/notificationFeed.mjs";

/**
 * The stored half of the top bar's bell: what the application has been told to tell somebody.
 *
 * Unlike the meetings beside it, these are rows in a table with a `read_at` rather than a list of
 * ids in this browser's storage: being handed a task, or a lead, is a fact about the studio, and
 * whether somebody has seen it should not depend on which machine they opened it from.
 *
 * It was `useTaskNotifications` and it read `response.data` as an array of them. That has been the
 * wrong shape since the endpoint grew its second half: it answers
 * `{ data: { notifications, notices, sources } }`, so the array test failed every time and this half
 * of the bell rendered nothing at all - no task notification has been shown since. The badge still
 * counted them, from `meta.unreadCount`, which is why the panel could read "2 unread" and open with
 * nothing in it.
 *
 * Renamed with the fix rather than after it: the store carries every module's notices now - a lead
 * put in somebody's name as much as a task - and a hook called "task notifications" is a name that
 * would have to be re-read as a lie by whoever touched it next.
 *
 * Read on a slow poll, like the meetings, so a notice raised while somebody is on another screen
 * still reaches them without a page reload. Nothing here is a countdown, so a minute is plenty.
 */

const POLL_INTERVAL_MS = 60000;
const CHANGED_EVENT = "stored-notifications-changed";

/**
 * Tells the bell to read again now rather than at the next poll - for a screen whose own action
 * takes a notice away, such as approving the request it was about.
 */
export function refreshStoredNotifications() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(CHANGED_EVENT));
}

/** How long a notice stays worth showing a relative time for; older ones read as a date. */
const formatWhen = (value) => {
  if (!value) return "";
  const at = new Date(value);
  const minutes = Math.round((Date.now() - at.getTime()) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 24 * 60) return `${Math.round(minutes / 60)}h ago`;
  if (minutes < 7 * 24 * 60) return `${Math.round(minutes / (60 * 24))}d ago`;
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(at);
};

/**
 * No `enabled` permission gate of its own any more, and that is the point of the change.
 *
 * It used to be `HRM / Task Management`, on the reasoning that the endpoint was guarded by exactly
 * that - and it was, once. The endpoint gates each kind of notice against its own module now, so a
 * salesperson with no Tasks permission would have been the only person never told a lead had been
 * put in their name. What comes back is already only what this reader may see; asking is safe for
 * anybody signed in, and the honest answer for somebody who holds nothing is an empty list.
 *
 * `onOpen` is given the notice's `link`, so the bar decides how to navigate rather than this hook
 * reaching for a router of its own.
 */
export default function useStoredNotifications({ onOpen } = {}) {
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);

  const load = useCallback(async () => {
    try {
      const response = await getNotifications();
      // The reply carries the stored rows beside the derived notices and the sources
      // that answered; `storedNotifications` reads either shape. See notificationFeed.mjs.
      setNotifications(storedNotifications(response));
      setUnreadCount(Number(response?.meta?.unreadCount) || 0);
    } catch {
      // Silent, for the same reason the meetings poll is: this is a courtesy on a bar that is on
      // every screen, and an error toast every minute would be worse than a bell briefly out of date.
    }
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => void load(), 0);
    const timer = window.setInterval(() => void load(), POLL_INTERVAL_MS);
    const reload = () => void load();
    window.addEventListener(CHANGED_EVENT, reload);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
      window.removeEventListener(CHANGED_EVENT, reload);
    };
  }, [load]);

  /**
   * Marking a notice read: it leaves the bell.
   *
   * The server lists unread notices only, so a read one is gone for good; it is taken off here as
   * well, and the badge corrected, so it vanishes the moment it is opened rather than at the next
   * poll. Opening the bell does not mark anything read - that would empty it on sight - and there
   * is no "Mark as read" button: a notice stays until the page it points at has been opened.
   */
  const markRead = useCallback((notification) => {
    setNotifications((current) => current.filter((row) => row.id !== notification.id));
    setUnreadCount((current) => Math.max(0, current - 1));
    void markNotificationRead(notification.id).catch(() => {});
  }, []);

  /**
   * Opening a notice: it goes where it points, and is read.
   *
   * Marked here rather than left to the page it opens, so a notice about a task that has since been
   * deleted still clears instead of sitting on the bell for ever.
   */
  const open = useCallback((notification) => {
    markRead(notification);
    onOpen?.(notification);
  }, [markRead, onOpen]);

  /*
   * The rows, ready for the menu - every one of them unread, since a read one is no longer listed.
   *
   * Empty is **empty**, and no longer a line reading "No task notifications." Two things turn on
   * that: the bar draws the plain, unopenable bell for a reader with nothing anywhere at all, and it
   * cannot tell "nothing" from "a line saying nothing" if this half always hands back one row. The
   * panel writes the one empty line for the whole bell - see `AppNotifications` - so three halves
   * with nothing in them read as one sentence rather than three.
   */
  const items = notifications.map((notification) => ({
    label: notification.title,
    detail: [notification.body, formatWhen(notification.createdAt)].filter(Boolean).join(" · "),
    onSelect: () => open(notification),
  }));

  return { items, unreadCount, reload: load };
}
