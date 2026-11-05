"use client";

import { useCallback, useEffect, useState } from "react";
import { apiRequest } from "@/lib/apiClient";
import {
  formatMeetingDate,
  formatMeetingTime,
  meetingCountdown,
  meetingFinished,
  meetingLeadName,
  meetingNotices,
  meetingTitle,
} from "@/lib/meetings";
import { withoutDismissed } from "@/lib/notificationFeed.mjs";
import useDismissedNotices from "@/components/app-shell/useDismissedNotices";

/**
 * The meetings half of the top bar's bell: what is booked today, and what is coming.
 *
 * This used to be a bell of its own — the bar's only notification panel, which knew about meetings
 * and nothing else and went quiet for anybody without the Sales permission. It is a hook now so
 * that one bell can carry it alongside the tasks feed, which is what `AppNotifications` does; the
 * behaviour below is unchanged, down to the poll interval and where "seen" is remembered.
 *
 * It is the same schedule the Meetings screen reads, through the same endpoint, and it applies the
 * same rules from `@/lib/meetings`: the same idea of which day a meeting falls on, and the same
 * idea of whether it has been and gone. A bell that counted differently from the page it links to
 * would be worse than no bell.
 *
 * Read only. Nothing here books or cancels anything; marking a meeting read only takes it off the bell.
 */

// How often the bell re-reads the day. Slow on purpose: this is a glance, not a countdown, and
// `MeetingReminders` is the thing that announces a meeting about to start.
const POLL_INTERVAL_MS = 60000;

// How far ahead the bell looks. Enough to carry "what is coming" without becoming the diary.
const UPCOMING_DAYS = 14;

/*
 * The meetings this person has already seen on the bell.
 *
 * In the browser rather than on the server: it is one reader's idea of what they have looked at,
 * and it has to survive a reload - a badge that came back on every page change would be no better
 * than one that never cleared. Pruned to what is still outstanding each time it is written, so it
 * cannot grow without limit.
 *
 * Task notifications are the other way round - they are rows in a table with a `read_at`, because a
 * task is a fact about the studio rather than one reader's idea of what they have glanced at.
 */
const SEEN_KEY = "dbs_seen_meeting_notices";
/** The meetings this person has marked as read, which the bell no longer lists. */
const DISMISSED_KEY = "dbs_dismissed_meeting_notices";

function readSeen() {
  if (typeof window === "undefined") return [];
  try {
    const stored = JSON.parse(window.localStorage.getItem(SEEN_KEY) || "[]");
    return Array.isArray(stored) ? stored.map(String) : [];
  } catch {
    // Unreadable storage is the same as nothing seen: the bell lights up once more, which is the
    // safe way to be wrong about a reminder.
    return [];
  }
}

/** One meeting as a menu row: when it is, what it is, and who it is with. */
function noticeItem(meeting, { dated, now, onSelect, onMarkRead }) {
  const when = dated ? `${formatMeetingDate(meeting.startAt)} · ${formatMeetingTime(meeting.startAt)}` : formatMeetingTime(meeting.startAt);
  const withWhom = meetingLeadName(meeting);
  // Only where the clock says something the time does not: "in 10 minutes", "under way",
  // "finished". Beyond an hour out, the time beside it is the better answer.
  const standing = dated ? "" : meetingCountdown(meeting, now);
  return {
    label: `${when} · ${meetingTitle(meeting)}`,
    // The client and the countdown as the row's own second line rather than a row beneath it: one
    // meeting is one entry, and two blocks made the panel twice as tall as the day it describes.
    detail: [withWhom, standing].filter(Boolean).join(" · "),
    // Opening it is what reads it: there is no "Mark as read", so it stays until it is opened.
    onSelect: () => { onMarkRead(); onSelect?.(); },
  };
}

/**
 * `enabled` is the caller's permission answer. A reader without `SALES / CRM Leads` never polls the
 * meetings endpoint at all, rather than firing a request that comes back refused once a minute.
 */
export default function useMeetingNotices({ enabled = true, onOpenMeetings } = {}) {
  const [meetings, setMeetings] = useState([]);
  // Held in state rather than read at render, so the countdowns move with the poll instead of
  // with whatever else happens to re-render the topbar.
  const [now, setNow] = useState(() => new Date());
  // Read straight out of storage on the first render, so the bell is drawn already-read rather than
  // lighting up and clearing itself a moment later.
  const [seen, setSeen] = useState(readSeen);

  const load = useCallback(async () => {
    const from = new Date();
    from.setHours(0, 0, 0, 0);
    const to = new Date(from.getTime() + UPCOMING_DAYS * 24 * 60 * 60000);
    try {
      const response = await apiRequest(
        `/api/sales/crm-meetings?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}&includeCancelled=false`,
      );
      setMeetings(Array.isArray(response?.data) ? response.data : []);
    } catch {
      // The bell is a courtesy on a bar that is on every screen. A failed poll is silent and the
      // next one tries again; an error toast every minute, on every page, would be worse than a
      // bell that is briefly out of date.
      return;
    }
    setNow(new Date());
  }, []);

  useEffect(() => {
    if (!enabled) return undefined;
    // Deferred a tick before the first read, the way every other first load in this codebase is
    // started: a fetch run straight from an effect body counts as state set during that effect.
    const initial = window.setTimeout(() => void load(), 0);
    const timer = window.setInterval(() => void load(), POLL_INTERVAL_MS);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [enabled, load]);

  const all = enabled ? meetingNotices(meetings, { now }) : { today: [], upcoming: [] };
  // A meeting that has been opened leaves the bell in this browser. It is still in the diary; the
  // bell just stops repeating it.
  const { dismissed, dismiss } = useDismissedNotices(DISMISSED_KEY);
  const today = withoutDismissed(all.today, dismissed);
  const upcoming = withoutDismissed(all.upcoming, dismissed);
  const markRead = (meeting) => dismiss(meeting.id, [...all.today, ...all.upcoming]);

  /*
   * What the badge counts: today's meetings still to come that this reader has not looked at.
   *
   * It counted every meeting still to come, which meant opening the bell, reading it and closing it
   * left the number exactly where it was - the panel said "you have seen this" and the badge said
   * "you have not". Marking them seen on open is what makes the two agree, and a meeting booked
   * afterwards lights it again because its id is not in the list.
   */
  const stillToCome = today.filter((meeting) => !meetingFinished(meeting, now));
  const unread = stillToCome.filter((meeting) => !seen.includes(String(meeting.id)));

  function markSeen() {
    // Only what is outstanding right now, so the list is pruned to the day rather than kept for
    // every meeting the studio has ever held.
    const ids = stillToCome.map((meeting) => String(meeting.id));
    setSeen(ids);
    try {
      window.localStorage.setItem(SEEN_KEY, JSON.stringify(ids));
    } catch {
      // Storage a browser refuses is a badge that lights up again next visit, and nothing worse.
    }
  }

  /*
   * The rows, ready for the menu. Selecting any of them opens the Meetings screen - the bell says
   * what is booked, and the screen is where a meeting is actually worked with, so it is one
   * destination rather than a different action per row.
   */
  const items = [];
  if (enabled) {
    // "Nothing booked" only when nothing is; a day whose meetings have all been read says nothing.
    if (all.today.length === 0) items.push({ description: "Nothing booked for today." });
    else for (const meeting of today) items.push(noticeItem(meeting, { dated: false, now, onSelect: onOpenMeetings, onMarkRead: () => markRead(meeting) }));

    if (upcoming.length) {
      if (items.length) items.push({ separator: true });
      for (const meeting of upcoming) items.push(noticeItem(meeting, { dated: true, now, onSelect: onOpenMeetings, onMarkRead: () => markRead(meeting) }));
    }
  }

  return { items, unreadCount: unread.length, todayCount: today.length, markSeen };
}
