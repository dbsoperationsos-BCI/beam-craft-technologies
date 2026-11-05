/**
 * Pure helpers behind the guest page's Take selfie camera: whether the browser can offer a camera
 * at all, which constraints to ask with and when to ask again, what to say when it refuses, and
 * how large a captured frame is sent. `.mjs` so `node --test` can import them without the bundler.
 */

/**
 * The first request: the front camera *preferred*, never required. `ideal` rather than `exact` or
 * a bare string, because a desktop webcam may not advertise a facing mode at all and an exact
 * match would refuse a perfectly good camera.
 */
export const PREFERRED_CONSTRAINTS = Object.freeze({ video: { facingMode: { ideal: "user" } }, audio: false });
/** The second request, any camera at all - what a Mac webcam usually needs. */
export const FALLBACK_CONSTRAINTS = Object.freeze({ video: true, audio: false });

/** Longest edge of the selfie that is sent; a webcam frame is downscaled to it, a smaller one is kept. */
export const MAX_CAPTURE_EDGE = 1280;

/**
 * "ok" when the camera API can be called, otherwise why not: "insecure" on a plain-http page (the
 * browser hides `mediaDevices` there, and the message should say so rather than "no camera") and
 * "unsupported" when the browser has no `getUserMedia`.
 */
export function cameraSupport({ isSecureContext, mediaDevices } = {}) {
  if (isSecureContext === false) return "insecure";
  if (!mediaDevices || typeof mediaDevices.getUserMedia !== "function") return "unsupported";
  return "ok";
}

/**
 * Whether a refusal of the preferred constraints deserves one more try with the generic ones. A
 * constraint the browser cannot satisfy obviously does; so does "not found", because some browsers
 * answer a facing-mode request on a camera with no facing mode that way, and "no camera" must only
 * ever be concluded after the generic request has been refused too.
 */
export function shouldRetryGeneric(error) {
  const name = error?.name || "";
  return name === "OverconstrainedError" || name === "ConstraintNotSatisfiedError" || name === "NotFoundError" || name === "DevicesNotFoundError";
}

/**
 * The refusal as the guest is told it - one sentence per cause, never the browser's own words -
 * and whether Try Again is worth offering: it is when the guest can change something (allow the
 * camera, close the other app), and not when there is no camera or no secure page to be had.
 */
export const CAMERA_REFUSALS = Object.freeze({
  blocked: { message: "Camera access is blocked. Please allow camera access in your browser settings and try again.", retry: true },
  // "Not found" is what a browser says when it can see no camera *it may use* - on a Mac, most
  // often because the browser is not allowed the camera in System Settings → Privacy & Security.
  // So it is not declared absent; the guest is told what to check, and may try again.
  none: { message: "No camera could be found. Check that a camera is connected and that this browser is allowed to use it in your system's privacy settings, then try again.", retry: true },
  busy: { message: "Your camera is currently unavailable. It may be in use by another application.", retry: true },
  aborted: { message: "Camera could not be started. Please try again.", retry: true },
  insecure: { message: "Camera access requires a secure HTTPS connection.", retry: false },
  unsupported: { message: "This browser cannot open the camera. You can upload a selfie instead.", retry: false },
  failed: { message: "The camera could not be opened. Please try again.", retry: true },
});

/** Which refusal a `getUserMedia` rejection is, by the DOMException name browsers agree on. */
export function classifyCameraError(error) {
  const name = error?.name || "";
  if (name === "NotAllowedError" || name === "PermissionDeniedError") return "blocked";
  if (name === "SecurityError") return "insecure";
  if (name === "NotFoundError" || name === "DevicesNotFoundError" || name === "OverconstrainedError" || name === "ConstraintNotSatisfiedError") return "none";
  if (name === "NotReadableError" || name === "TrackStartError") return "busy";
  if (name === "AbortError") return "aborted";
  return "failed";
}

/** The refusal `{ message, retry }` for a rejection - `classifyCameraError` looked up in `CAMERA_REFUSALS`. */
export function cameraRefusal(error) {
  return CAMERA_REFUSALS[classifyCameraError(error)];
}

/** The rejection as it is logged: what the browser actually said, for finding the real cause. */
export function describeCameraError(error) {
  return { name: error?.name || "", message: error?.message || String(error ?? ""), constraint: error?.constraint || "" };
}

/**
 * The same, as one line for `console.warn`. A string rather than an error-like object, because a
 * dev overlay reads anything with `name` and `message` as a crash to report, and this is a
 * diagnosis of a refusal the guest has already been told about. `videoInputs` is how many
 * cameras `enumerateDevices` lists, which tells "none plugged in" from "not allowed" apart.
 */
export function formatCameraError(error, { videoInputs } = {}) {
  const { name, message, constraint } = describeCameraError(error);
  const parts = [`[selfie camera] refused: ${name || "Error"}: ${message}`];
  if (constraint) parts.push(`constraint=${constraint}`);
  if (typeof videoInputs === "number") parts.push(`videoInputs=${videoInputs}`);
  return parts.join(" ");
}

/**
 * The size the frame is drawn at: the video's own aspect ratio, downscaled so the longer edge is at
 * most `maxEdge`. A frame with no size yet (the video has not started) is refused with zeros.
 */
export function captureSize(videoWidth, videoHeight, maxEdge = MAX_CAPTURE_EDGE) {
  const width = Number(videoWidth) || 0; const height = Number(videoHeight) || 0;
  if (width <= 0 || height <= 0) return { width: 0, height: 0 };
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

/** Whether a video element is showing frames worth capturing: data loaded and a real size. */
export function videoIsReady({ readyState, videoWidth, videoHeight } = {}) {
  return Number(readyState) >= 2 && Number(videoWidth) > 0 && Number(videoHeight) > 0;
}
