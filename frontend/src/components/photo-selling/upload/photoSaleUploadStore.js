"use client";

import { useSyncExternalStore } from "react";
import { createUploadEngine } from "@/lib/aiMediaUpload/uploadEngine.mjs";
import { createWebUploadAdapter } from "@/components/ai-feature/media-upload/adapters/WebUploadAdapter";
import { uploadSalePhoto } from "@/services/photo-selling/photo-selling.service";

/**
 * Photo Selling's uploads: the same engine and on-device optimiser the AI Feature uses
 * (lib/aiMediaUpload/uploadEngine.mjs, the compression worker), with sessions of its own - one per
 * gallery - sending to Photo Selling's own upload route. Nothing here touches an AI Feature upload,
 * and an AI Feature upload never lands in a gallery.
 *
 * Each photo travels as its original - byte for byte, what a buyer downloads, stored privately -
 * with the web-size preview and thumbnail made from it on this computer for showing, and its name,
 * folder path, size and fingerprint (the original's SHA-256, which the server checks).
 */
const EMPTY = { sessions: [] };
let engine = null;
let unloadGuarded = false;
const landed = new Map();
/*
 * Each item's original File, kept from the moment it is compressed until its upload lands. The
 * shared engine lets go of `item.file` once the web-size copy is made (its memory rule); a sale
 * photo still needs the original, so it is held here - a reference to the file on disk, not its
 * bytes - for the upload and any retry, and goes with the item when its session is dismissed.
 */
const originals = new WeakMap();

const adapterUpload = async (item, payload) => {
  const original = originals.get(item);
  if (!original) throw Object.assign(new Error("The original file is no longer available. Choose the photo again."), { code: "FILE_UNAVAILABLE" });
  const response = await uploadSalePhoto(item.eventId, { original, payload, thumbnail: item.thumbnail, fileName: item.name, fingerprint: item.fingerprint, sourceSizeBytes: item.size, relativePath: item.relativePath, optimized: item.optimized, capturedAt: item.capturedAt });
  originals.delete(item);
  return { duplicate: Boolean(response?.data?.duplicate), media: response?.data?.photo || null };
};

function warn(event) { event.preventDefault(); event.returnValue = ""; }
function guardUnload() {
  if (typeof window === "undefined" || !engine) return;
  const running = engine.isRunning();
  if (running && !unloadGuarded) { window.addEventListener("beforeunload", warn); unloadGuarded = true; }
  else if (!running && unloadGuarded) { window.removeEventListener("beforeunload", warn); unloadGuarded = false; }
}

function ensure() {
  if (engine) return engine;
  const web = createWebUploadAdapter({ uploadItem: adapterUpload, noteBatch: null });
  const adapter = { ...web, compress: (item) => { if (item.file) originals.set(item, item.file); return web.compress(item); } };
  engine = createUploadEngine({ adapter, onEvent: (event) => { for (const handler of landed.get(event.eventId) || []) { try { handler(event); } catch { /* one listener's error is not the upload's */ } } } });
  engine.subscribe(guardUnload);
  return engine;
}

/** Starts (or adds to) a gallery's upload. The gallery is the session's only destination. */
export function startPhotoSaleUpload(galleryId, entries, meta = {}) {
  return ensure().addFiles(galleryId, entries, { ...meta, folderId: galleryId, folderName: meta.galleryTitle || "this gallery", eventName: meta.galleryTitle || "" });
}

const subscribe = (listener) => ensure().subscribe(listener);
const snapshot = () => (engine ? engine.getSnapshot() : EMPTY);
const serverSnapshot = () => EMPTY;

/** One gallery's upload session (or null), live, with its actions bound. */
export function usePhotoSaleUpload(galleryId) {
  const { sessions } = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  return {
    session: sessions.find((candidate) => candidate.eventId === galleryId) || null,
    pause: () => engine?.pause(galleryId),
    resume: () => engine?.resume(galleryId),
    retryFailed: () => engine?.retryFailed(galleryId),
    cancelRemaining: () => engine?.cancelRemaining(galleryId),
    dismiss: () => engine?.dismiss(galleryId),
  };
}

/** Runs `handler` as photos land (throttled by the engine) and when the batch finishes. */
export function onPhotoSaleUploadLanded(galleryId, handler) {
  if (!landed.has(galleryId)) landed.set(galleryId, new Set());
  landed.get(galleryId).add(handler);
  return () => { landed.get(galleryId)?.delete(handler); };
}
