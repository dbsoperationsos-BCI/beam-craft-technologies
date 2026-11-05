"use client";

import DragIndicator from "@mui/icons-material/DragIndicator";
import ExpandLess from "@mui/icons-material/ExpandLess";
import ExpandMore from "@mui/icons-material/ExpandMore";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import UploadBatchProgress from "./UploadBatchProgress";
import {
  cancelUpload,
  dismissUpload,
  getUploadStoreServerSnapshot,
  getUploadStoreSnapshot,
  pauseUpload,
  resumePausedUpload,
  retryFailedUploads,
  subscribeUploadStore,
} from "@/lib/imageSelectionUploadStore";
// Deep link back to the project (and the folder being uploaded into), in the section the upload
// was started in — see the lib for why that matters.
import { uploadSessionHref } from "@/lib/uploadDockLink.mjs";

const POSITION_KEY = "image-selection-upload-dock-position";

function sessionTitle(session) {
  return session.projectName || session.folderName || "Event Upload Progress";
}
function readPosition() {
  if (typeof window === "undefined") return null;
  try {
    const saved = JSON.parse(window.localStorage.getItem(POSITION_KEY) || "null");
    return typeof saved?.x === "number" && typeof saved?.y === "number" ? saved : null;
  } catch {
    return null;
  }
}
// Keeps the panel fully on screen after a drag, a resize, or a collapse toggle.
function clampToViewport(position, element) {
  if (!element) return position;
  const maxX = Math.max(0, window.innerWidth - element.offsetWidth);
  const maxY = Math.max(0, window.innerHeight - element.offsetHeight);
  return {
    x: Math.min(Math.max(0, position.x), maxX),
    y: Math.min(Math.max(0, position.y), maxY),
  };
}

// Rendered once by the app shell so uploads started in a project workspace stay visible
// and keep running after the user navigates to a different route. Drag the header to
// move it out of the way of whatever is underneath.
export default function UploadDock() {
  const router = useRouter();
  const store = useSyncExternalStore(subscribeUploadStore, getUploadStoreSnapshot, getUploadStoreServerSnapshot);
  const [collapsed, setCollapsed] = useState(false);
  const [position, setPosition] = useState(null); // null keeps the default bottom-right anchor
  const [dragging, setDragging] = useState(false);
  const containerRef = useRef(null);
  const grabOffset = useRef({ x: 0, y: 0 });
  const floating = store.sessions.filter((session) => !session.inline);
  const count = floating.length;

  const reclamp = useCallback(() => {
    setPosition((current) => (current ? clampToViewport(current, containerRef.current) : current));
  }, []);

  // localStorage is client-only, so restore after mount to keep hydration stable.
  useEffect(() => setPosition(readPosition()), []);
  useEffect(() => {
    window.addEventListener("resize", reclamp);
    return () => window.removeEventListener("resize", reclamp);
  }, [reclamp]);
  useEffect(() => reclamp(), [collapsed, count, reclamp]);
  useEffect(() => {
    if (dragging || !position) return;
    try {
      window.localStorage.setItem(POSITION_KEY, JSON.stringify(position));
    } catch {
      /* Private mode — the panel just falls back to its default corner next time. */
    }
  }, [dragging, position]);

  function startDrag(event) {
    if (event.target.closest("button")) return; // let the collapse toggle work
    const element = containerRef.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    grabOffset.current = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    setPosition(clampToViewport({ x: rect.left, y: rect.top }, element));
    setDragging(true);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }
  function moveDrag(event) {
    if (!dragging) return;
    setPosition(
      clampToViewport(
        { x: event.clientX - grabOffset.current.x, y: event.clientY - grabOffset.current.y },
        containerRef.current,
      ),
    );
  }
  function endDrag(event) {
    if (!dragging) return;
    setDragging(false);
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  }

  if (!count) return null;
  const running = floating.filter((session) => !session.finished).length;

  return (
    <div
      ref={containerRef}
      style={position ? { left: position.x, top: position.y } : undefined}
      className={`fixed z-50 w-[min(24rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl ${position ? "" : "bottom-4 right-4"} ${dragging ? "select-none" : ""}`}
    >
      <div
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        title="Drag to move"
        className={`flex touch-none select-none items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2 ${dragging ? "cursor-grabbing" : "cursor-grab"}`}
      >
        <span className="flex min-w-0 items-center gap-1.5 text-xs font-semibold text-slate-800">
          <DragIndicator style={{ fontSize: 14 }} aria-hidden="true" className="shrink-0 text-slate-400" />
          <span className="truncate">
            {running ? `Uploading in background (${running})` : `Uploads finished (${count})`}
          </span>
        </span>
        <button
          type="button"
          onClick={() => setCollapsed((value) => !value)}
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Expand uploads" : "Collapse uploads"}
          className="shrink-0 rounded p-0.5 text-slate-500 hover:bg-slate-200"
        >
          {collapsed ? <ExpandLess style={{ fontSize: 15 }} /> : <ExpandMore style={{ fontSize: 15 }} />}
        </button>
      </div>
      {!collapsed && (
        <div className="max-h-[70vh] space-y-2 overflow-y-auto p-2">
          {floating.map((session) => (
            <UploadBatchProgress
              key={session.key}
              session={session}
              compact
              title={sessionTitle(session)}
              onPause={() => pauseUpload(session.key)}
              onResume={() => resumePausedUpload(session.key)}
              onRetryFailed={() => retryFailedUploads(session.key)}
              onCancel={() => cancelUpload(session.key)}
              onDone={() => dismissUpload(session.key)}
              onOpen={() => router.push(uploadSessionHref(session))}
            />
          ))}
        </div>
      )}
    </div>
  );
}
