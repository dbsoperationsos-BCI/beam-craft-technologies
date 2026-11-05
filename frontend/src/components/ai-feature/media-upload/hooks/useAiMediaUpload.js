"use client";

import { useEffect, useSyncExternalStore } from "react";
import {
  cancelRemainingAiMediaUploads, dismissAiMediaUpload, getAiMediaUploadServerSnapshot, getAiMediaUploadSnapshot, getAiMediaWorkspacesServerSnapshot, getAiMediaWorkspacesSnapshot,
  onAiMediaUploadEvent, pauseAiMediaUpload, registerAiMediaWorkspace, resumeAiMediaUpload, retryFailedAiMediaUploads, setAiMediaUploadFolder, subscribeAiMediaUpload, subscribeAiMediaWorkspaces,
} from "../store/aiMediaUploadStore";

/** Every AI media upload session on this page, live. */
export function useAiMediaUploadSessions() {
  return useSyncExternalStore(subscribeAiMediaUpload, getAiMediaUploadSnapshot, getAiMediaUploadServerSnapshot).sessions;
}

/** One event's session (or null) with its actions bound. */
export function useAiMediaUploadSession(eventId) {
  const sessions = useAiMediaUploadSessions();
  const session = sessions.find((candidate) => candidate.eventId === eventId) || null;
  return {
    session,
    pause: () => pauseAiMediaUpload(eventId),
    resume: () => resumeAiMediaUpload(eventId),
    retryFailed: () => retryFailedAiMediaUploads(eventId),
    cancelRemaining: () => cancelRemainingAiMediaUploads(eventId),
    dismiss: () => dismissAiMediaUpload(eventId),
    setFolder: (folderId, folderName) => setAiMediaUploadFolder(eventId, folderId, folderName),
  };
}

/** The events whose full upload workspace is on screen right now. */
export function useAiMediaWorkspacesOnScreen() {
  return useSyncExternalStore(subscribeAiMediaWorkspaces, getAiMediaWorkspacesSnapshot, getAiMediaWorkspacesServerSnapshot);
}

/** Says the workspace for `eventId` is on screen for as long as the caller is mounted. */
export function useAiMediaWorkspaceOnScreen(eventId) {
  useEffect(() => (eventId ? registerAiMediaWorkspace(eventId) : undefined), [eventId]);
}

/** Runs `onLanded` as photos land (throttled by the engine) and once more when the batch finishes. */
export function useAiMediaLanded(eventId, onLanded) {
  useEffect(() => {
    if (!eventId || !onLanded) return undefined;
    return onAiMediaUploadEvent(eventId, () => onLanded());
  }, [eventId, onLanded]);
}
