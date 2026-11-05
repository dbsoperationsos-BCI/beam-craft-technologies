"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getNotifications } from "@/services/notifications.service";
import { sourceNotices, withoutDismissed } from "@/lib/notificationFeed.mjs";
import useDismissedNotices from "@/components/app-shell/useDismissedNotices";

/*
 * ── The third half of the bell: what is waiting on this person, from every module ─────────────
 *
 * The bar's bell began as the studio's meetings and nothing else, on the reasoning that a Meet
 * starting without the salesperson is the one failure that part of the CRM exists to prevent. That
 * is true, and it is not the only thing with a clock on it: a follow-up booked for this morning, a
 * client who replied on WhatsApp an hour ago, a call nobody has read yet, an approval sitting in
 * somebody's queue. None of those appeared anywhere until you went looking for them.
 *
 * A hook rather than a bell of its own, because the reader has one bell to look at - the same
 * reason the meetings and the tasks are hooks. `AppNotifications` draws all three.
 *
 * ── Where the rules are, and are not ──
 *
 * Not here. `/api/notifications` gathers from every module and gates each source against that
 * module's own permission, so what arrives is already only what this person may act on. The bell
 * holds no idea of its own about who sees what, which is the only way it can be right on a bar that
 * is on every screen in the application.
 *
 * Everything it lists is *theirs*: their follow-ups, the clients who replied to them, the calls
 * they took, the approvals waiting on their decision. A bell counting the whole studio's work would
 * read the same on Monday morning as on Friday night and be ignored by both.
 */

const POLL_INTERVAL_MS = 60000;

/*
 * The notices this person has already looked at.
 *
 * In the browser rather than on the server, and deliberately unlike a task notification: a derived
 * notice is not a fact about the studio, it is one reader's glance at work that is already listed
 * on the screen it belongs to. It has to survive a reload - a badge that came back on every page
 * change would be no better than one that never cleared - and it is pruned to what is still
 * outstanding each time it is written, so it cannot grow without limit.
 */
const SEEN_KEY = "dbs_seen_source_notices";
/** The notices this person has marked as read, which the bell no longer lists. */
const DISMISSED_KEY = "dbs_dismissed_source_notices";

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

/**
 * `enabled` is the caller's answer to "is there any point asking". The endpoint is safe to call for
 * anybody signed in - it answers with whatever sources that person holds - so this is only about
 * not polling once a minute on behalf of a reader the panel is not going to draw this half for.
 */
export default function useSourceNotices({ enabled = true } = {}) {
  const router = useRouter();
  const [notices, setNotices] = useState([]);
  const [seen, setSeen] = useState(readSeen);

  const load = useCallback(async () => {
    try {
      const response = await getNotifications();
      setNotices(sourceNotices(response));
    } catch {
      // A bell that cannot reach the server says nothing rather than an error: it is a courtesy on
      // a bar that is always there, and a red panel on every screen over a dropped poll is worse
      // than a quiet one.
      setNotices([]);
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      setNotices([]);
      return undefined;
    }
    void load();
    const timer = window.setInterval(() => void load(), POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [enabled, load]);

  // Opened, and so read - and off the bell in this browser. Only opening does it: a notice stays on
  // the bell until its page has been looked at.
  const { dismissed, dismiss } = useDismissedNotices(DISMISSED_KEY);
  const showing = withoutDismissed(notices, dismissed);
  const unread = showing.filter((entry) => !seen.includes(String(entry.id)));

  /** Opening the bell is reading it, so that is where the badge clears. */
  const markSeen = useCallback(() => {
    const ids = notices.map((entry) => String(entry.id));
    setSeen(ids);
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(SEEN_KEY, JSON.stringify(ids));
    } catch {
      // Storage refused - a private window, or a browser with site data blocked. The badge lights
      // up again next load, which is the harmless direction to fail in.
    }
  }, [notices]);

  const items = [];
  if (enabled) {
    /*
     * Each row goes where the work is done rather than to a list of notifications - the bell says
     * what is waiting, and a notice that does not say where is one somebody has to go and find,
     * which is most of the work it was meant to save.
     *
     * Already sorted by the server, soonest first, so the ones that are late are at the top.
     */
    for (const entry of showing) {
      items.push({
        label: `${entry.kind} · ${entry.title}`,
        detail: entry.detail,
        tone: entry.tone === "urgent" ? "danger" : undefined,
        onSelect: () => { dismiss(entry.id, notices); if (entry.href) router.push(entry.href); },
      });
    }
  }

  return { items, unreadCount: unread.length, count: showing.length, markSeen };
}
