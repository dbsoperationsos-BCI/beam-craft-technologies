"use client";

import { useCallback, useEffect, useRef } from "react";
import { apiRequest } from "@/lib/apiClient";
import {
  formatMeetingTime,
  meetingLeadName,
  meetingTitle,
  minutesUntil,
  REMINDER_THRESHOLDS,
  REMINDER_WINDOW_MINUTES,
  reminderLabel,
} from "@/lib/meetings";

/**
 * The CRM's meeting reminder: a small notice at the bottom of the page as a meeting comes up.
 *
 * Announced three times - thirty minutes out, fifteen, and five - because one warning is
 * easily missed by someone working a list of leads, and a Meet that starts without the
 * salesperson is the failure this exists to prevent.
 *
 * Each announcement is made once. The thresholds already passed are marked off along with the
 * one being shown, so opening the CRM four minutes before a meeting gives the five-minute
 * warning alone rather than all three stacked on top of each other. What has been shown is
 * kept in sessionStorage, so moving between CRM pages does not replay a reminder that has
 * already been read and dismissed - while a new sign-in or a new tab starts clean.
 *
 * Read only, and deliberately self-contained: it polls the meetings list and hands what it finds
 * to the page it is mounted on. It never writes a meeting, and dismissing a reminder changes
 * nothing but the notice.
 *
 * It draws nothing of its own. It used to render a blue panel built here - its own shape, its own
 * dismiss, its own place on the screen - which meant the application announced a meeting in a way
 * it announces nothing else, and two notices could sit on top of each other at the foot of the
 * page. The reminder now goes through `showNotice`, so it is the same snackbar, in the same place,
 * with the same dismiss and the same timing as every other thing the application has to say. The
 * Join button rides on the snackbar's own `action` slot, which is what that slot is for.
 */

const POLL_INTERVAL_MS = 30000;
const SEEN_STORAGE_KEY = "dbs_crm_meeting_reminders_seen";

function loadSeen() {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.sessionStorage.getItem(SEEN_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}

function saveSeen(seen) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(SEEN_STORAGE_KEY, JSON.stringify([...seen]));
  } catch {
    // A full or blocked sessionStorage only costs the de-duplication across pages; the
    // in-memory set still prevents the same reminder repeating on this one.
  }
}

/**
 * The reminder a meeting is due, or null.
 *
 * The tightest unseen threshold wins: at fourteen minutes out both the thirty and the fifteen
 * apply, and the fifteen is the honest one to show. Every threshold that applies is returned
 * so the caller can mark them all off at once.
 */
function dueReminder(meeting, seen, now) {
  const remaining = minutesUntil(meeting.startAt, now);
  // Already started, or too far out to matter yet.
  if (remaining <= 0 || remaining > REMINDER_THRESHOLDS[0]) return null;

  const applicable = REMINDER_THRESHOLDS.filter((threshold) => remaining <= threshold);
  const threshold = applicable[applicable.length - 1];
  const keys = applicable.map((value) => `${meeting.id}:${value}`);
  if (seen.has(`${meeting.id}:${threshold}`)) return null;
  return { meeting, threshold, remaining, keys };
}

export default function MeetingReminders({ onRemind }) {
  const seenRef = useRef(null);
  /*
   * Held in a ref so the poll below does not have to be rebuilt every time the page it is mounted
   * on re-renders - a fresh `check` would restart the interval on every keystroke elsewhere on that
   * page, and a reminder due in the gap would be missed.
   *
   * Kept in step from an effect rather than assigned during render: a ref written while rendering
   * is a side effect in the render pass, which is what the compiler refuses.
   */
  const remindRef = useRef(onRemind);
  useEffect(() => { remindRef.current = onRemind; }, [onRemind]);
  if (seenRef.current === null) seenRef.current = loadSeen();

  const check = useCallback(async () => {
    const now = new Date();
    const to = new Date(now.getTime() + REMINDER_WINDOW_MINUTES * 60000);
    let meetings = [];
    try {
      const response = await apiRequest(
        `/api/sales/crm-meetings?from=${encodeURIComponent(now.toISOString())}&to=${encodeURIComponent(to.toISOString())}&includeCancelled=false`,
      );
      meetings = Array.isArray(response?.data) ? response.data : [];
    } catch {
      // A reminder is a courtesy, not a feature the page depends on. A failed poll is silent
      // and the next one tries again - an error toast every thirty seconds would be worse
      // than no reminder at all.
      return;
    }

    // Soonest first, so the meeting about to start is the one announced.
    const due = meetings
      .map((meeting) => dueReminder(meeting, seenRef.current, now))
      .filter(Boolean)
      .sort((left, right) => left.remaining - right.remaining)[0];
    if (!due) return;

    for (const key of due.keys) seenRef.current.add(key);
    saveSeen(seenRef.current);

    const { meeting, threshold } = due;
    const withWhom = meetingLeadName(meeting);
    const message = [
      `Meeting ${reminderLabel(threshold)} · ${formatMeetingTime(meeting.startAt)}`,
      [meetingTitle(meeting), withWhom].filter(Boolean).join(" · "),
    ].join(" — ");
    // Its own tab, so whatever is being worked on stays exactly where it was.
    const action = meeting.meetLink
      ? { label: "Join", onSelect: () => window.open(meeting.meetLink, "_blank", "noopener,noreferrer") }
      : undefined;
    remindRef.current?.(message, action);
  }, []);

  useEffect(() => {
    // The first check is deferred a tick rather than run from the effect body, the way the
    // CRM starts its own first load.
    const initial = window.setTimeout(() => void check(), 0);
    const timer = window.setInterval(() => void check(), POLL_INTERVAL_MS);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [check]);

  return null;
}
