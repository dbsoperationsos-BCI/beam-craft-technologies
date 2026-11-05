import assert from "node:assert/strict";
import test from "node:test";
import {
  CAMERA_REFUSALS, FALLBACK_CONSTRAINTS, PREFERRED_CONSTRAINTS,
  cameraRefusal, cameraSupport, captureSize, classifyCameraError, describeCameraError, formatCameraError, shouldRetryGeneric, videoIsReady,
} from "../src/lib/selfieCamera.mjs";

test("Take selfie prefers the front camera without requiring it, then falls back to any camera", () => {
  assert.deepEqual(PREFERRED_CONSTRAINTS, { video: { facingMode: { ideal: "user" } }, audio: false });
  assert.equal("exact" in PREFERRED_CONSTRAINTS.video.facingMode, false, "exact would refuse a desktop webcam");
  assert.deepEqual(FALLBACK_CONSTRAINTS, { video: true, audio: false });
});

test("the camera is offered only on a secure page with getUserMedia", () => {
  assert.equal(cameraSupport({ isSecureContext: true, mediaDevices: { getUserMedia() {} } }), "ok");
  assert.equal(cameraSupport({ isSecureContext: false, mediaDevices: undefined }), "insecure");
  assert.equal(cameraSupport({ isSecureContext: true, mediaDevices: undefined }), "unsupported");
  assert.equal(cameraSupport({ isSecureContext: true, mediaDevices: {} }), "unsupported");
  assert.equal(cameraSupport(), "unsupported");
});

test("a constraint miss or a not-found on the preferred request earns one generic retry; a refusal does not", () => {
  for (const name of ["OverconstrainedError", "ConstraintNotSatisfiedError", "NotFoundError", "DevicesNotFoundError"]) assert.equal(shouldRetryGeneric({ name }), true, name);
  for (const name of ["NotAllowedError", "NotReadableError", "AbortError", "SecurityError", "TypeError"]) assert.equal(shouldRetryGeneric({ name }), false, name);
  assert.equal(shouldRetryGeneric(undefined), false);
});

test("each refusal is classified by its cause, with Try Again only where the guest can change something", () => {
  assert.equal(classifyCameraError({ name: "NotAllowedError" }), "blocked");
  assert.equal(classifyCameraError({ name: "PermissionDeniedError" }), "blocked");
  assert.equal(classifyCameraError({ name: "NotFoundError" }), "none");
  assert.equal(classifyCameraError({ name: "OverconstrainedError" }), "none", "only reached after the generic retry also failed");
  assert.equal(classifyCameraError({ name: "NotReadableError" }), "busy");
  assert.equal(classifyCameraError({ name: "TrackStartError" }), "busy");
  assert.equal(classifyCameraError({ name: "AbortError" }), "aborted");
  assert.equal(classifyCameraError({ name: "SecurityError" }), "insecure");
  assert.equal(classifyCameraError(new Error("boom")), "failed");
  assert.equal(classifyCameraError(undefined), "failed");
  assert.deepEqual(cameraRefusal({ name: "NotAllowedError" }), CAMERA_REFUSALS.blocked);
  assert.equal(CAMERA_REFUSALS.blocked.retry, true);
  assert.equal(CAMERA_REFUSALS.busy.retry, true);
  assert.equal(CAMERA_REFUSALS.aborted.retry, true);
  assert.equal(CAMERA_REFUSALS.none.retry, true, "not found is not declared absent: a Mac says it when the browser is not allowed the camera");
  assert.equal(CAMERA_REFUSALS.insecure.retry, false);
  assert.equal(CAMERA_REFUSALS.unsupported.retry, false);
  assert.match(CAMERA_REFUSALS.none.message, /privacy settings/);
  assert.equal(CAMERA_REFUSALS.insecure.message, "Camera access requires a secure HTTPS connection.");
});

test("the logged description carries what the browser said", () => {
  const error = new Error("Requested device not found"); error.name = "NotFoundError"; error.constraint = "facingMode";
  assert.deepEqual(describeCameraError(error), { name: "NotFoundError", message: "Requested device not found", constraint: "facingMode" });
  assert.deepEqual(describeCameraError(undefined), { name: "", message: "", constraint: "" });
  assert.equal(formatCameraError(error, { videoInputs: 1 }), "[selfie camera] refused: NotFoundError: Requested device not found constraint=facingMode videoInputs=1");
  assert.equal(formatCameraError({ name: "NotAllowedError", message: "Permission denied" }), "[selfie camera] refused: NotAllowedError: Permission denied");
  assert.equal(typeof formatCameraError(undefined), "string", "always a string, never an error-like object a dev overlay would report");
});

test("a captured frame keeps its aspect ratio and is capped on its longer edge", () => {
  assert.deepEqual(captureSize(1920, 1080), { width: 1280, height: 720 });
  assert.deepEqual(captureSize(1080, 1920), { width: 720, height: 1280 });
  assert.deepEqual(captureSize(640, 480), { width: 640, height: 480 }, "a small frame is not upscaled");
  assert.deepEqual(captureSize(0, 0), { width: 0, height: 0 }, "no frame yet");
});

test("Capture waits for loaded data and a real frame size", () => {
  assert.equal(videoIsReady({ readyState: 2, videoWidth: 640, videoHeight: 480 }), true);
  assert.equal(videoIsReady({ readyState: 1, videoWidth: 640, videoHeight: 480 }), false);
  assert.equal(videoIsReady({ readyState: 4, videoWidth: 0, videoHeight: 0 }), false);
  assert.equal(videoIsReady(undefined), false);
});
