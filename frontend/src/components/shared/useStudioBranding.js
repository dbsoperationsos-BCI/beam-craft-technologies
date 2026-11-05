"use client";

import { useEffect, useSyncExternalStore } from "react";
import { API_URL } from "@/services/api/client";

/*
 * The Global Name, Global Logo and Login Slides from Settings, as the public branding endpoint
 * answers them. One answer is shared by every reader on the page - the top bar wants it for the
 * name and the mark both, on every screen - and it is shown the instant a reader mounts. It is
 * not trusted for the life of the page, though: each mount asks the endpoint again in the
 * background, and so does a tab coming back into view, so a logo or slide saved in Settings
 * reaches a sign-in page that was already open, or one reached by signing out, without a reload.
 */
let cached = null;
let inFlight = null;
// Every hook currently mounted, so a change reaches all of them at once.
const listeners = new Set();

function publish(next) {
  if (!next || JSON.stringify(next) === JSON.stringify(cached)) return;
  cached = next;
  listeners.forEach((listener) => listener());
}

function fetchBranding() {
  if (!inFlight) {
    inFlight = fetch(`${API_URL}/api/public/studio-branding`, { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((response) => { const data = response?.data || null; publish(data); return data; })
      .catch(() => null)
      .finally(() => { inFlight = null; });
  }
  return inFlight;
}

/**
 * The same answer, awaited rather than subscribed to.
 *
 * For a screen that has to *settle* on a branding value before it decides anything — the Login
 * Credentials page proposes an address at the studio's domain, and compares that proposal against
 * what is stored to tell an edited page from an untouched one. Subscribed to, the domain would
 * arrive a frame after that comparison was made, the proposal would change under it, and the page
 * would open offering to save itself. Awaited alongside the page's own loads, both are decided at
 * the same moment. Shares the one in-flight request, so this costs no extra round trip.
 */
export function loadStudioBranding() {
  return cached ? Promise.resolve(cached) : fetchBranding();
}

/**
 * Settings → Global Logo or Login Slide has just saved. The answer every mounted hook holds is
 * replaced with the saved values on the spot, so the top bar shows the new mark and name without
 * the page being reloaded. The endpoint would answer exactly this, and asking it again is a round
 * trip for nothing; fields the save did not carry are kept as they were.
 */
export function updateStudioBranding(patch) {
  publish({ ...(cached || {}), ...patch });
}

/** One reader, listening. Returns the way to stop, which is what `useSyncExternalStore` wants. */
function subscribe(onChange) {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

/*
 * The answer above is a store outside React, so it is read as one rather than copied into state.
 *
 * Copying it in is what broke this: state took `cached` at the first render, the listener was
 * registered afterwards in an effect, and an answer arriving in the gap between the two reached
 * nobody — `publish` is deliberately quiet about a value that has not changed, so no later fetch
 * repeated it, and that reader sat on `null` for the life of the page while every other one on the
 * same screen showed the studio's branding. It is exactly what the public onboarding page hit: the
 * mark above the title was the studio's, and the sentence under it named the bundled brand.
 *
 * `useSyncExternalStore` has no such gap. It subscribes as it renders and reads the value each
 * time, so a reader cannot be left holding an answer older than the store's. The third argument is
 * what the server renders — nothing is known there — which is also the first frame in the browser,
 * so the markup the server sent and the markup React hydrates over agree.
 */
export default function useStudioBranding() {
  const branding = useSyncExternalStore(subscribe, () => cached, () => null);
  useEffect(() => {
    fetchBranding();
    const onVisible = () => { if (document.visibilityState === "visible") fetchBranding(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);
  return branding;
}
