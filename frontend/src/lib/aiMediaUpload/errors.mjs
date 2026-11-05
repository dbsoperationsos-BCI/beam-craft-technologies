/**
 * Errors the upload workspace shows, in the studio's words: what happened and, where there is one,
 * the next step. A row never shows a stack trace or an HTTP status; `retryable` says whether trying
 * again can help, and `network` marks the ones that mean the connection or the session is gone.
 */
export function describeUploadError(error) {
  const status = Number(error?.status) || 0;
  const code = error?.code || "";
  if (code === "NETWORK_ERROR" || error?.offline) return { message: "Network interrupted - check the connection, then retry", retryable: true, network: true };
  if (code === "UNDECODABLE") return { message: "Unsupported image - convert it to JPEG or PNG", retryable: false };
  if (code === "COMPRESSION_FAILED") return { message: "Could not be optimized - retry, or try another browser", retryable: true };
  if (code === "FILE_UNAVAILABLE") return { message: "File no longer available - pick it again", retryable: false };
  if (status === 401) return { message: "Session expired - sign in again, then retry", retryable: true, network: true };
  if (status === 403) return { message: error?.message || "Uploads are switched off for this event", retryable: false };
  if (status === 404) return { message: "Folder or event no longer exists", retryable: false };
  if (status === 409) return { message: "The server is busy with this photo - retry in a moment", retryable: true };
  if (status === 413) return { message: error?.message || "Too large for this event's file limit", retryable: false };
  if (status === 415 || status === 422) return { message: error?.message || "Unsupported image", retryable: false };
  if (status === 429) return { message: "The server asked for a pause - retry in a moment", retryable: true };
  if (status >= 500) return { message: "The server could not take it - retry in a moment", retryable: true };
  return { message: error?.message || "Upload failed", retryable: !status };
}
