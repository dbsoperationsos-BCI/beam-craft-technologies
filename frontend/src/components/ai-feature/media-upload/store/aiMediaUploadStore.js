"use client";

import { createUploadEngine } from "@/lib/aiMediaUpload/uploadEngine.mjs";
import { createWebUploadAdapter } from "../adapters/WebUploadAdapter";

/**
 * The app-level home of AI media uploads on the web: one engine, one web adapter, alive for as
 * long as the page is. The Media tab's upload workspace and the compact pill both read from here,
 * so an upload keeps going when the person moves to another tab or another page, and the browser
 * warns before a reload would take the queue with it.
 *
 * Kept apart from Image Selection's store on purpose: the two never share state or business rules.
 */
const EMPTY = { sessions: [] };
const EMPTY_WORKSPACES = [];
let engine = null;
let adapter = null;
const landedListeners = new Map();
let unloadGuarded = false;

function onEvent(event) {
  const handlers = landedListeners.get(event.eventId);
  if (!handlers) return;
  for (const handler of handlers) { try { handler(event); } catch { /* one listener's error is not the upload's */ } }
}

function guardUnload() {
  if (typeof window === "undefined" || !engine) return;
  const running = engine.isRunning();
  if (running && !unloadGuarded) { window.addEventListener("beforeunload", warn); unloadGuarded = true; }
  else if (!running && unloadGuarded) { window.removeEventListener("beforeunload", warn); unloadGuarded = false; }
}
function warn(event) { event.preventDefault(); event.returnValue = ""; }

function ensure() {
  if (engine) return engine;
  adapter = createWebUploadAdapter();
  engine = createUploadEngine({ adapter, onEvent });
  engine.subscribe(guardUnload);
  return engine;
}

// ── Actions ───────────────────────────────────────────────────────────────────────────────────
/**
 * `meta`: `{ folderId, folderName, eventName, compression, limits }` - the folder is required (the
 * engine refuses a batch without one), the recipe and limits come from the event's settings.
 */
export function startAiMediaUpload(eventId, entries, meta = {}) {
  const href = typeof window !== "undefined" ? `${window.location.pathname}${window.location.search}` : "";
  return ensure().addFiles(eventId, entries, { ...meta, href });
}
export const pauseAiMediaUpload = (eventId) => engine?.pause(eventId);
export const resumeAiMediaUpload = (eventId) => engine?.resume(eventId);
export const retryFailedAiMediaUploads = (eventId) => engine?.retryFailed(eventId);
export const cancelRemainingAiMediaUploads = (eventId) => engine?.cancelRemaining(eventId);
export const setAiMediaUploadFolder = (eventId, folderId, folderName) => engine?.setFolder(eventId, folderId, folderName);
export function dismissAiMediaUpload(eventId) {
  engine?.dismiss(eventId);
  // Counted on the engine itself: the snapshot is published on a short timer and still holds the
  // session just dismissed, so reading it here would never let the workers go.
  if (engine && engine.sessionCount() === 0) adapter?.dispose();
}

// ── Where the full workspace is on screen ─────────────────────────────────────────────────────
/*
 * The Media tab's workspace says so while it is mounted, per event, and the compact pill draws
 * nothing for that event meanwhile. Keyed on the workspace itself rather than on the page's path:
 * the event page keeps its tab out of the URL, so the path alone cannot tell Media from Overview,
 * and an upload left for the People tab would otherwise have no progress on screen at all.
 */
const workspacesOnScreen = new Map();
const workspaceListeners = new Set();
let workspacesSnapshot = EMPTY_WORKSPACES;
function publishWorkspaces() { workspacesSnapshot = Array.from(workspacesOnScreen.keys()); workspaceListeners.forEach((listener) => listener()); }
/** Called by the workspace on mount; answers the unregister for its unmount. */
export function registerAiMediaWorkspace(eventId) {
  workspacesOnScreen.set(eventId, (workspacesOnScreen.get(eventId) || 0) + 1);
  publishWorkspaces();
  return () => {
    const left = (workspacesOnScreen.get(eventId) || 1) - 1;
    if (left > 0) workspacesOnScreen.set(eventId, left); else workspacesOnScreen.delete(eventId);
    publishWorkspaces();
  };
}
export const subscribeAiMediaWorkspaces = (listener) => { workspaceListeners.add(listener); return () => workspaceListeners.delete(listener); };
export const getAiMediaWorkspacesSnapshot = () => workspacesSnapshot;
export const getAiMediaWorkspacesServerSnapshot = () => EMPTY_WORKSPACES;

// ── Subscriptions ─────────────────────────────────────────────────────────────────────────────
export const subscribeAiMediaUpload = (listener) => ensure().subscribe(listener);
export const getAiMediaUploadSnapshot = () => (engine ? engine.getSnapshot() : EMPTY);
export const getAiMediaUploadServerSnapshot = () => EMPTY;

/** `handler({ type: "landed", count } | { type: "finished", uploaded, failed, total })` for one event; answers the unsubscribe. */
export function onAiMediaUploadEvent(eventId, handler) {
  if (!landedListeners.has(eventId)) landedListeners.set(eventId, new Set());
  landedListeners.get(eventId).add(handler);
  return () => { landedListeners.get(eventId)?.delete(handler); };
}
