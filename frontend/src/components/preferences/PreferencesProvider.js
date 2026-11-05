"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { getAuthenticatedUser } from "@/lib/auth";
import { clearMyPreference, getMyPreferences, saveMyPreference } from "@/services/user/preferences.service";

/*
 * How this login has arranged the application for itself, kept on the server so it follows the
 * person rather than the browser: the order columns were dragged into, the ones hidden, how many
 * were frozen, how wide they were pulled, the density every table reads at, and the tab each screen
 * was left on.
 *
 * All of it used to live in `localStorage` alone, which had three faults. It did not survive a move
 * to another machine, which is the one the studio actually noticed - somebody arranges Employee
 * Repository at the desk and finds it untouched on the laptop. It was lost whenever site data was
 * cleared. And because the keys were not namespaced by user, the next person to sign in on a shared
 * machine inherited the previous one's layout.
 *
 * One fetch for the whole session, like `PermissionsProvider` beside it: the alternative is a
 * request behind every table on the screen.
 *
 * `localStorage` is kept, demoted to a cache. It is what lets a table draw in the right order on
 * the very first frame instead of jumping once the server answers - the same reason `useCompactView`
 * read straight out of storage rather than in an effect. The server is the truth; the cache is only
 * how the truth gets on screen quickly. The cache key carries the user id, so the shared-machine
 * leak cannot happen through it either.
 */
const PreferencesContext = createContext(null);

/** Where the cache of one login's preferences sits. The id is the point: see above. */
const cacheKey = (userId) => `dbs_prefs_${userId}`;
const CACHE_PREFIX = "dbs_prefs_";

/*
 * How long a change waits before it is sent.
 *
 * Dragging a column across a wide table fires a save per drop, and resizing one fires a save per
 * frame of the drag. Debouncing collapses a gesture into the one request that matters. The value
 * is already on screen and already cached by then, so this delays nothing the reader can see.
 */
const SAVE_DEBOUNCE_MS = 600;

function readCache(userId) {
  if (typeof window === "undefined" || !userId) return {};
  try {
    const stored = JSON.parse(window.localStorage.getItem(cacheKey(userId)) || "null");
    return stored && typeof stored === "object" && !Array.isArray(stored) ? stored : {};
  } catch {
    // A browser refusing storage - a private window, site data blocked - is not a reason to fail to
    // draw the application. It simply opens on the defaults until the server answers.
    return {};
  }
}

function writeCache(userId, preferences) {
  if (typeof window === "undefined" || !userId) return;
  try {
    window.localStorage.setItem(cacheKey(userId), JSON.stringify(preferences));
  } catch {
    // Nothing to do: the preference is already applied and already on its way to the server, so it
    // survives this session and the next sign-in. Only the first frame of the next load is slower.
  }
}

/*
 * Caches belonging to other logins, dropped.
 *
 * Not for correctness - the key namespacing above already means one account cannot read another's -
 * but because a shared machine would otherwise accumulate the layout of everybody who has ever
 * signed in on it, and none of it will ever be read again.
 */
function pruneOtherCaches(userId) {
  if (typeof window === "undefined" || !userId) return;
  try {
    const mine = cacheKey(userId);
    for (const key of Object.keys(window.localStorage)) {
      if (key.startsWith(CACHE_PREFIX) && key !== mine) window.localStorage.removeItem(key);
    }
  } catch {
    /* Storage is unavailable; there is nothing cached to prune. */
  }
}

export default function PreferencesProvider({ children }) {
  // Read on the first client render rather than in an effect, so a table is drawn in the order it
  // was left in immediately instead of rearranging itself under the reader a moment later.
  const [userId] = useState(() => getAuthenticatedUser()?.id ?? null);
  const [preferences, setPreferences] = useState(() => readCache(userId));
  // Signed out, there is nothing to wait for, so it starts settled rather than being set settled
  // from inside the effect - a synchronous setState on mount, which is the one thing the effect
  // below must not do.
  const [ready, setReady] = useState(() => !userId);
  // The keys with a save in flight or waiting on the debounce. A server answer must not overwrite a
  // change the reader has just made but which has not landed yet.
  const pendingRef = useRef(new Map());
  const timersRef = useRef(new Map());

  useEffect(() => {
    if (!userId) return undefined;
    pruneOtherCaches(userId);

    let cancelled = false;
    getMyPreferences()
      .then((response) => {
        if (cancelled) return;
        const fromServer = response?.data && typeof response.data === "object" ? response.data : {};
        // The reader's own unsaved changes win over what the server knew a moment ago - they made
        // them after this request went out.
        setPreferences(() => {
          const merged = { ...fromServer };
          for (const [key, value] of pendingRef.current) merged[key] = value;
          return merged;
        });
        setReady(true);
      })
      .catch(() => {
        // A failed fetch leaves the cached layout in place rather than resetting every table to its
        // natural order, which is what dropping to `{}` here would do. The application is entirely
        // usable without this; it is a layout, not data.
        if (!cancelled) setReady(true);
      });

    return () => { cancelled = true; };
  }, [userId]);

  // Every queued save is flushed on unmount, so a preference changed a moment before signing out or
  // navigating away is not lost inside a timer that never fires. The refs are read inside the
  // effect rather than in the render above it, which is where they are allowed to be read at all.
  useEffect(() => {
    const timers = timersRef.current;
    const pending = pendingRef.current;
    return () => {
      for (const [key, timer] of timers) {
        window.clearTimeout(timer);
        if (pending.has(key)) saveMyPreference(key, pending.get(key)).catch(() => { /* see `set` below */ });
      }
      timers.clear();
    };
  }, []);

  /*
   * The cache, rewritten a moment after the last change rather than on every one.
   *
   * Dragging a column's edge resizes it on every frame of the gesture, and writing to
   * `localStorage` means serialising every preference this login holds and handing it to a
   * synchronous browser API - sixty times a second, for the length of the drag. Nothing reads the
   * cache until the next page load, so there is no reason for it to keep up with the pointer.
   *
   * Held until the server's answer has been merged in: writing before that would put an empty
   * object over a perfectly good cache on a slow connection, and the next load would open on the
   * defaults.
   */
  useEffect(() => {
    if (!userId || !ready) return undefined;
    const timer = window.setTimeout(() => writeCache(userId, preferences), SAVE_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [userId, ready, preferences]);

  /*
   * A preference changed: on screen at once, in the cache and on the server shortly after.
   *
   * Optimistic on purpose. The reader dragged a column and the column has to move now; making that
   * wait for a round trip would make every table feel remote. A save that fails is swallowed for the
   * same reason - there is nothing useful to tell somebody who moved a column, and an error toast
   * over a layout change would be worse than the layout not being remembered.
   */
  const set = useCallback((key, value) => {
    if (!key) return;
    setPreferences((current) => ({ ...current, [key]: value }));
    if (!userId) return;

    pendingRef.current.set(key, value);
    window.clearTimeout(timersRef.current.get(key));
    timersRef.current.set(key, window.setTimeout(() => {
      timersRef.current.delete(key);
      saveMyPreference(key, value)
        .catch(() => { /* The change is applied and cached; only the other device misses it. */ })
        // Cleared whether or not it landed: it is no longer newer than what the server holds in the
        // one case, and retrying forever in the other would not help.
        .finally(() => { if (pendingRef.current.get(key) === value) pendingRef.current.delete(key); });
    }, SAVE_DEBOUNCE_MS));
  }, [userId]);

  /**
   * Forgets one preference - "Reset Table Layout", and anything like it added later.
   *
   * The queued save is dropped rather than allowed to fire after the delete, which would put the
   * layout straight back.
   */
  const clear = useCallback((key) => {
    if (!key) return;
    setPreferences((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
    if (!userId) return;
    window.clearTimeout(timersRef.current.get(key));
    timersRef.current.delete(key);
    pendingRef.current.delete(key);
    clearMyPreference(key).catch(() => { /* Reset locally either way; see `set`. */ });
  }, [userId]);

  const value = useMemo(() => ({ preferences, ready, set, clear }), [preferences, ready, set, clear]);
  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

/**
 * One preference, as `[value, setValue, reset]`.
 *
 * Outside the provider - a public page, a test rendering one component - this falls back to plain
 * component state rather than throwing. Nothing here is worth failing a render over: a table with
 * an unremembered layout is a working table, and a gallery the client opens by token has no account
 * to remember anything against in the first place.
 */
export function usePreference(key, fallback) {
  const context = useContext(PreferencesContext);
  const [local, setLocal] = useState(fallback);

  const stored = context ? context.preferences[key] : local;
  const value = stored === undefined ? fallback : stored;

  const setValue = useCallback((next) => {
    if (context) context.set(key, next);
    else setLocal(next);
  }, [context, key]);

  const reset = useCallback(() => {
    if (context) context.clear(key);
    else setLocal(fallback);
  }, [context, key, fallback]);

  return [value, setValue, reset];
}

/** Whether the server's answer has arrived. Nothing has to wait for it; a few things like to know. */
export function usePreferencesReady() {
  return useContext(PreferencesContext)?.ready ?? true;
}
