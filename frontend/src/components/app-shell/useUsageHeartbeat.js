"use client";

import { useEffect, useRef } from "react";
import { ACTIVITY_EVENTS, HEARTBEAT_MS, IDLE_AFTER_MS, idleAfterMsFrom, isActive } from "@/lib/usageHeartbeat";
import { sendUsageHeartbeat } from "@/services/usage/usage.service";

/**
 * Reports that this person is using the application, while they are.
 *
 * Mounted once by the app shell for the application at large, and again by the WhatsApp chat panel
 * for its own context - the two are separate stretches on the server, so time in the chat is
 * counted both as WhatsApp use and as use of the application, which is what each report means.
 *
 * What it does not do is as important as what it does. It never beats while the tab is in the
 * background, and never beats after the person has stopped touching anything - see
 * `@/lib/usageHeartbeat` for that rule. The interval runs continuously and checks the rule at each
 * beat rather than being started and stopped by every mouse movement, which would be a timer torn
 * down and rebuilt hundreds of times a minute.
 *
 * A failed beat is swallowed. It costs a few seconds of a usage figure; it is never worth putting
 * an error in front of somebody who is simply working.
 */
export default function useUsageHeartbeat(context = "app", enabled = true) {
  const lastInteractionRef = useRef(null);
  /*
   * The studio's inactivity timeout, as the server last stated it.
   *
   * Taken from the reply to each beat rather than fetched separately: the browser is already
   * talking to that endpoint every thirty seconds, so the setting arrives for free and a change an
   * administrator makes reaches every open tab within a beat or two - without anybody reloading.
   * Until the first reply lands it is the bundled fallback.
   */
  const idleAfterRef = useRef(IDLE_AFTER_MS);

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return undefined;

    const mark = () => { lastInteractionRef.current = Date.now(); };
    // Passive: none of these are ever cancelled here, and saying so keeps scrolling smooth on a
    // page that is already listening for it.
    for (const event of ACTIVITY_EVENTS) window.addEventListener(event, mark, { passive: true });

    /*
     * Opening the page is itself an interaction - somebody navigated here. Without this the first
     * beat of every visit waits for a mouse to move, so a person who lands on a report and reads it
     * without touching anything is recorded as never having used the application at all.
     */
    mark();

    const beat = () => {
      if (!isActive({
        visible: document.visibilityState === "visible",
        lastInteractionAt: lastInteractionRef.current,
        idleAfterMs: idleAfterRef.current,
      })) return;
      void sendUsageHeartbeat(context)
        .then((response) => {
          const next = idleAfterMsFrom(response);
          if (next) idleAfterRef.current = next;
        })
        .catch(() => {});
    };

    /*
     * Coming back to the tab counts as an interaction and beats at once, rather than waiting up to
     * a full interval: returning to the application is exactly the moment somebody starts using it
     * again, and the stretch should start there rather than half a minute later.
     */
    const onVisibility = () => {
      if (document.visibilityState !== "visible") return;
      mark();
      beat();
    };
    document.addEventListener("visibilitychange", onVisibility);

    const timer = window.setInterval(beat, HEARTBEAT_MS);
    // The first beat is deferred a tick rather than sent from the effect body, the way every other
    // first request in this codebase is started.
    const initial = window.setTimeout(beat, 0);

    return () => {
      for (const event of ACTIVITY_EVENTS) window.removeEventListener(event, mark);
      document.removeEventListener("visibilitychange", onVisibility);
      window.clearInterval(timer);
      window.clearTimeout(initial);
    };
  }, [context, enabled]);
}
