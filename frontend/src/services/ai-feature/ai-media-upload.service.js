import { apiRequest } from "@/services/api/client";

const eventPath = (id) => `/api/ai-feature/events/${encodeURIComponent(id)}`;

/**
 * One optimized photo (or an as-is file) to the AI Feature media route, into one folder, with the
 * description of the source the server can no longer see for itself. Field names are the
 * backend's `media/uploadIntake.js` contract; every field but `file` and `folderId` is optional
 * there (the server refuses a staff upload that names no folder). `thumbnail` is the thumbnail
 * cut beside the preview from the same decode of the original; the server keeps it when it fits
 * the event's thumbnail preset and derives its own otherwise.
 */
export function uploadOptimizedAiMedia(eventId, { payload, thumbnail, fileName, folderId, fingerprint, sourceSizeBytes, relativePath, optimized, capturedAt }) {
  const body = new FormData();
  const sendName = optimized ? `${fileName.replace(/\.[^.]+$/, "")}.jpg` : fileName;
  body.append("file", payload, sendName);
  if (optimized && thumbnail) body.append("thumbnail", thumbnail, thumbnail.type === "image/jpeg" ? "thumbnail.jpg" : "thumbnail.webp");
  if (folderId) body.append("folderId", folderId);
  if (fingerprint) body.append("sourceFingerprint", fingerprint);
  if (Number.isFinite(sourceSizeBytes)) body.append("sourceSizeBytes", String(sourceSizeBytes));
  if (fileName) body.append("sourceFileName", fileName);
  if (relativePath && relativePath !== fileName) body.append("relativePath", relativePath);
  if (optimized) body.append("clientOptimized", "true");
  if (capturedAt) body.append("sourceCapturedAt", capturedAt);
  return apiRequest(`${eventPath(eventId)}/media/upload`, { method: "POST", body });
}

export const noteAiMediaUploadBatch = (eventId, count) => apiRequest(`${eventPath(eventId)}/media/batch`, { method: "POST", body: JSON.stringify({ count }) });
