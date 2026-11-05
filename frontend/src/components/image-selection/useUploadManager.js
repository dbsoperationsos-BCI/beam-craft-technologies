"use client";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { getImageUploadBatch } from "@/services/image-selection/image-selection.service";
import {
  cancelUpload,
  claimInlineSession,
  clearSavedUpload,
  dismissUpload,
  getUploadStoreServerSnapshot,
  getUploadStoreSnapshot,
  pauseUpload,
  readSavedUpload,
  resumePausedUpload,
  retryFailedUploads,
  resumeUpload,
  startUpload,
  subscribeUploadCompletion,
  subscribeUploadStore,
  uploadSessionKey,
} from "@/lib/imageSelectionUploadStore";

export default function useUploadManager({ projectId, folderId, folderName, projectName, onUploadReady, uploadsBase, replaceExisting = false }) {
  const key = uploadSessionKey(projectId, folderId);
  const store = useSyncExternalStore(subscribeUploadStore, getUploadStoreSnapshot, getUploadStoreServerSnapshot);
  const session = store.sessions.find((item) => item.key === key) || null;
  const hasSession = Boolean(session);
  const [resumeBatch, setResumeBatch] = useState(null);

  // While this card is on screen the floating dock stays out of the way.
  useEffect(() => claimInlineSession(key), [key]);

  useEffect(() => {
    if (!onUploadReady) return undefined;
    return subscribeUploadCompletion((detail) => {
      if (detail.projectId === projectId && (detail.folderId || null) === (folderId || null)) onUploadReady();
    });
  }, [folderId, onUploadReady, projectId]);

  // A batch saved in localStorage but with no live session means the page was reloaded
  // or closed mid-upload. Offer to resume it once we know how far the server got.
  useEffect(() => {
    let cancelledEffect = false;
    const saved = readSavedUpload(projectId, folderId);
    if (!saved?.batchId || hasSession) {
      setResumeBatch(null);
      return () => {
        cancelledEffect = true;
      };
    }
    setResumeBatch({ ...saved, batch: null });
    getImageUploadBatch(uploadsBase ? { projectId, uploadsBase } : projectId, saved.batchId)
      .then((response) => {
        if (!cancelledEffect) setResumeBatch({ ...saved, batch: response.data });
      })
      .catch(() => {
        // The batch is gone server-side, so the saved pointer is useless.
        if (!cancelledEffect) {
          clearSavedUpload(projectId, folderId);
          setResumeBatch(null);
        }
      });
    return () => {
      cancelledEffect = true;
    };
  }, [folderId, hasSession, projectId, uploadsBase]);

  const addFiles = useCallback(
    (files) => startUpload({ projectId, folderId, folderName, projectName, files, uploadsBase, replaceExisting }),
    [folderId, folderName, projectId, projectName, replaceExisting, uploadsBase],
  );
  const resumeFiles = useCallback(
    async (files) => {
      const result = await resumeUpload({ projectId, folderId, folderName, projectName, files, uploadsBase, replaceExisting });
      if (result.resumed) setResumeBatch(null);
      return result;
    },
    [folderId, folderName, projectId, projectName, replaceExisting, uploadsBase],
  );
  const discardResume = useCallback(() => {
    clearSavedUpload(projectId, folderId);
    setResumeBatch(null);
  }, [folderId, projectId]);

  return {
    session,
    batchProgress: session?.batch || null,
    resumeBatch,
    addFiles,
    resumeFiles,
    discardResume,
    pause: useCallback(() => pauseUpload(key), [key]),
    resume: useCallback(() => resumePausedUpload(key), [key]),
    retryFailed: useCallback(() => retryFailedUploads(key), [key]),
    cancel: useCallback(() => cancelUpload(key), [key]),
    dismiss: useCallback(() => dismissUpload(key), [key]),
  };
}
