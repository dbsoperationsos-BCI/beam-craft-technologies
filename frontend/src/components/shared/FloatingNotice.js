"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ErrorIcon from "@mui/icons-material/Error";
import CloseIcon from "@/components/ui/CloseIcon";
import IconButton from "./IconButton";

/**
 * The snackbar is one dark bar whatever it says, so the tone is carried by the icon in front of the
 * message rather than by the colour of the bar: a failure leads with the red error mark, something
 * that worked with the green tick, and a plain remark with nothing at all.
 */
const tones = {
  info: { Icon: null, iconClassName: "" },
  success: { Icon: CheckCircleIcon, iconClassName: "text-green-400" },
  error: { Icon: ErrorIcon, iconClassName: "text-red-500" },
};

function normalize(notice) {
  if (!notice) return null;
  if (typeof notice === "string") return { message: notice, tone: "info" };
  if (!notice.message) return null;
  // `action` is an optional `{ label, onSelect }` offered beside the message - an undo for
  // something just done, which belongs here rather than behind a confirmation nobody reads.
  return { message: notice.message, tone: tones[notice.tone] ? notice.tone : "info", action: notice.action };
}

export function useNotice() {
  const [notice, setNotice] = useState(null);
  const showNotice = useCallback((message, tone = "info", action) => setNotice(message ? { message, tone, action } : null), []);
  const showSuccess = useCallback((message, action) => showNotice(message, "success", action), [showNotice]);
  const showError = useCallback((message) => showNotice(message, "error"), [showNotice]);
  const clearNotice = useCallback(() => setNotice(null), []);
  // For something reversible: the message says what happened and the button puts it back. The
  // notice closes itself on the way, so the undo cannot be pressed twice.
  const showUndo = useCallback((message, onUndo) => showNotice(message, "success", {
    label: "Undo",
    onSelect: () => { setNotice(null); onUndo(); },
  }), [showNotice]);
  return { notice, showNotice, showSuccess, showError, showUndo, clearNotice };
}

export default function FloatingNotice({ notice, onClose, duration = 5000 }) {
  const active = normalize(notice);
  const message = active?.message;
  const toneName = active?.tone;

  // Keyed on the message itself, so a second notice restarts the countdown instead of inheriting
  // whatever was left of the first one's.
  useEffect(() => {
    if (!message || !duration) return undefined;
    const timer = window.setTimeout(() => onClose?.(), duration);
    return () => window.clearTimeout(timer);
  }, [duration, message, onClose, toneName]);

  if (!active || typeof document === "undefined") return null;

  const { Icon, iconClassName } = tones[active.tone];

  return createPortal(
    // Anchored to the bottom of the window and out of the way of pointer events, so the page stays
    // usable while a message is up.
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[200] flex justify-center px-3 pb-4 sm:pb-6">
      <div
        role="status"
        aria-live="polite"
        // Keyed on the message so a second one replays the rise instead of swapping text in place.
        key={message}
        className="animate-snackbar-rise pointer-events-auto flex max-w-[min(36rem,100%)] items-center gap-3 rounded-lg bg-slate-800 px-4 py-2.5 text-sm font-medium text-white shadow-lg"
      >
        {Icon && <Icon aria-hidden="true" fontSize="small" className={`shrink-0 ${iconClassName}`} />}
        <span className="min-w-0 break-words">{message}</span>
        {active.action && <button
          type="button"
          onClick={active.action.onSelect}
          className="shrink-0 rounded px-2 py-1 text-sm font-semibold text-blue-300 underline-offset-2 hover:bg-white/10 hover:text-blue-200 hover:underline"
        >
          {active.action.label}
        </button>}
        <IconButton onClick={() => onClose?.()} label="Close notification" size="sm" shape="circle" className="ml-1 text-slate-300 hover:bg-white/10 hover:text-white">
          <CloseIcon />
        </IconButton>
      </div>
    </div>,
    document.body,
  );
}
