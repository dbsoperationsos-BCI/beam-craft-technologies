"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import PhotoCamera from "@mui/icons-material/PhotoCamera";
import Loader from "@/components/shared/Loader";
import {
  CAMERA_REFUSALS, FALLBACK_CONSTRAINTS, PREFERRED_CONSTRAINTS,
  cameraRefusal, cameraSupport, captureSize, formatCameraError, shouldRetryGeneric, videoIsReady,
} from "@/lib/selfieCamera.mjs";
import { PRIMARY_BUTTON, SECONDARY_BUTTON } from "./guestActions";

/**
 * The live camera behind Take selfie on Find My Photos: `getUserMedia`, a mirrored preview with an
 * oval guide, Capture, then the frozen frame with Retake / Use photo. `onUse(file)` hands over a
 * JPEG `File` and nothing else - what happens to it is the same upload and match the picker's file
 * goes through. `onUploadInstead` is the way out a refusal offers when the event allows uploading a
 * selfie: the caller opens its own file picker. Left out, a refusal offers Back and Try again only.
 *
 * Why not `<input type="file" capture="user">`: a desktop browser ignores `capture` and opens the
 * file picker, which is the bug this replaces. A camera that cannot be opened is *said* here,
 * with Try Again where the guest can change something and Upload selfie always; it never quietly
 * opens the picker instead.
 *
 * Opening asks twice before giving up: the front camera preferred (`ideal`, never `exact`), and if
 * the browser cannot satisfy that - a Mac webcam advertises no facing mode, and some browsers answer
 * "not found" rather than "over-constrained" - any camera at all. "No camera could be found" is only
 * ever said after that second request is refused too, and even then with Try again: a Mac whose
 * browser is not allowed the camera in System Settings answers "not found", not "denied". The
 * browser's actual refusal is logged as a warning so the real cause can be read off the console.
 *
 * The stream starts only from the button press that mounted this, and every path out - Use photo,
 * Cancel, Retake, Try Again, unmount - stops every track first, so the camera light goes off when
 * the guest is done and no second stream is ever opened over a first. Capture is offered only once
 * the element is showing real frames. The preview is mirrored with CSS only; the frame drawn to the
 * canvas is the camera's own, so the selfie sent to matching is not flipped.
 */

/** Resolves once the element has loaded data and knows its size, or after a short wait either way. */
function whenVideoReady(video) {
  return new Promise((resolve) => {
    if (videoIsReady(video)) { resolve(); return; }
    let done = false;
    const finish = () => { if (done) return; done = true; window.clearTimeout(timer); for (const name of EVENTS) video.removeEventListener(name, check); resolve(); };
    const check = () => { if (videoIsReady(video)) finish(); };
    const EVENTS = ["loadedmetadata", "loadeddata", "canplay", "resize"];
    for (const name of EVENTS) video.addEventListener(name, check);
    // A stream that never reports frames is still handed on; Capture stays disabled until it does.
    const timer = window.setTimeout(finish, 4000);
  });
}

/**
 * How many cameras the browser lists, for the diagnostic line: labels are hidden before permission
 * but kinds are not, so "not found" with a camera listed reads as "not allowed" rather than "none".
 * Never used to decide anything - `getUserMedia` is the only judge of whether a camera can be used.
 */
async function countVideoInputs() {
  try { return (await navigator.mediaDevices.enumerateDevices()).filter((device) => device.kind === "videoinput").length; } catch { return undefined; }
}

/**
 * The two requests, in order. Returns the stream, or throws the refusal that ended the attempt -
 * the second one's, since the first was only a preference that could not be met.
 */
async function requestCamera() {
  try {
    return await navigator.mediaDevices.getUserMedia(PREFERRED_CONSTRAINTS);
  } catch (error) {
    if (!shouldRetryGeneric(error)) throw error;
    return navigator.mediaDevices.getUserMedia(FALLBACK_CONSTRAINTS);
  }
}

export default function SelfieCamera({ onUse, onCancel, onUploadInstead }) {
  // opening → live → captured, or refused with what to say and whether Try Again is offered. One
  // state, so a late permission answer cannot land the pane in two of them at once.
  const [phase, setPhase] = useState({ name: "opening", message: "", retry: false });
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  // A start already in flight: a second press of Try Again while the browser is still asking must
  // not open a second stream.
  const startingRef = useRef(false);
  // The captured frame and the object URL it is shown through, released together.
  const [shot, setShot] = useState({ file: null, preview: "" });

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const refuse = (kind) => setPhase({ name: "refused", ...CAMERA_REFUSALS[kind] });

  const start = useCallback(async () => {
    if (startingRef.current) return;
    startingRef.current = true;
    stopStream();
    setPhase({ name: "opening", message: "", retry: false });
    try {
      const support = cameraSupport({ isSecureContext: window.isSecureContext, mediaDevices: navigator.mediaDevices });
      if (process.env.NODE_ENV !== "production") console.log(`[selfie camera] secureContext=${window.isSecureContext} mediaDevices=${Boolean(navigator.mediaDevices)} getUserMedia=${Boolean(navigator.mediaDevices?.getUserMedia)} support=${support}`);
      if (support !== "ok") { refuse(support); return; }
      let stream;
      try {
        stream = await requestCamera();
      } catch (error) {
        // What the browser actually said, so a "no camera" on a machine with one can be traced. A
        // warning, as one string: the guest has already been told, and a dev overlay reports a
        // `console.error` carrying an error-like object as a crash of the page.
        console.warn(formatCameraError(error, { videoInputs: await countVideoInputs() }));
        setPhase({ name: "refused", ...cameraRefusal(error) });
        return;
      }
      // The pane may have gone while the browser was asking; a stream nobody will show is stopped
      // at once rather than left running behind the page.
      const video = videoRef.current;
      if (!video) { stream.getTracks().forEach((track) => track.stop()); return; }
      streamRef.current = stream;
      video.srcObject = stream;
      await whenVideoReady(video);
      // Some browsers only start rendering frames once told to play, autoplay attribute or not.
      try { await video.play(); } catch { /* autoplay refused: the frames still arrive once the element can play */ }
      if (!videoIsReady(video)) await whenVideoReady(video);
      // Still nothing after the wait: the stream is open but shows no frames, which is not a
      // camera the guest can use. Said as a fault to retry, never as "no camera".
      if (!videoIsReady(video)) { console.warn(formatCameraError({ name: "NoFrames", message: `readyState=${video.readyState} size=${video.videoWidth}x${video.videoHeight}` })); stopStream(); refuse("failed"); return; }
      setPhase({ name: "live", message: "", retry: false });
    } finally {
      startingRef.current = false;
    }
  }, [stopStream]);

  // Started once, from the press that mounted this - never on page load - and stopped on unmount.
  useEffect(() => {
    const timer = window.setTimeout(() => void start(), 0);
    return () => { window.clearTimeout(timer); stopStream(); };
  }, [start, stopStream]);

  // The preview URL is released when it is replaced, and once more when the pane goes away.
  const previewRef = useRef("");
  useEffect(() => { previewRef.current = shot.preview; }, [shot.preview]);
  useEffect(() => () => { if (previewRef.current) URL.revokeObjectURL(previewRef.current); }, []);

  function capture() {
    const video = videoRef.current;
    if (!video || phase.name !== "live" || !videoIsReady(video)) return;
    const { width, height } = captureSize(video.videoWidth, video.videoHeight);
    if (!width) { refuse("failed"); return; }
    const canvas = document.createElement("canvas");
    canvas.width = width; canvas.height = height;
    // Drawn as the camera sees it, not as the mirrored preview shows it.
    canvas.getContext("2d").drawImage(video, 0, 0, width, height);
    canvas.toBlob((blob) => {
      if (!blob) { refuse("failed"); return; }
      const file = new File([blob], "selfie.jpg", { type: "image/jpeg" });
      setShot((current) => { if (current.preview) URL.revokeObjectURL(current.preview); return { file, preview: URL.createObjectURL(file) }; });
      // The frame is frozen on screen, so the camera has nothing more to show and goes off.
      stopStream();
      setPhase({ name: "captured", message: "", retry: false });
    }, "image/jpeg", 0.9);
  }

  function retake() {
    setShot((current) => { if (current.preview) URL.revokeObjectURL(current.preview); return { file: null, preview: "" }; });
    void start();
  }

  function use() {
    if (!shot.file) return;
    stopStream();
    onUse(shot.file);
  }

  function leave(next) {
    stopStream();
    next?.();
  }

  const live = phase.name === "live";
  const refused = phase.name === "refused";
  return <div className="flex flex-col items-center">
    <div className="relative aspect-4/5 w-full max-w-xs overflow-hidden rounded-2xl bg-slate-900 sm:aspect-square">
      {/* Always in the tree, so Retake and Try Again have an element to start the stream on; hidden
          while the captured frame is shown and transparent until the stream is live. */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        aria-label="Live camera"
        className={`h-full w-full object-cover ${phase.name === "captured" ? "hidden" : live ? "" : "opacity-0"}`}
        style={{ transform: "scaleX(-1)" }}
      />
      {phase.name === "captured" && shot.preview && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={shot.preview} alt="Your selfie" className="h-full w-full object-cover" style={{ transform: "scaleX(-1)" }} />
      )}
      {live && <div aria-hidden="true" className="pointer-events-none absolute inset-0 grid place-items-center">
        <div className="h-[68%] w-[62%] rounded-[50%] border-2 border-white/70 shadow-[0_0_0_9999px_rgba(15,23,42,0.35)]" />
      </div>}
      {phase.name === "opening" && <div className="absolute inset-0 grid place-items-center"><Loader label="Opening camera..." className="text-white" /></div>}
      {refused && <div className="absolute inset-0 grid place-items-center p-5 text-center text-sm text-white/90"><p role="alert">{phase.message}</p></div>}
    </div>

    {live && <p className="mt-3 text-center text-xs text-slate-500">Position your face inside the oval, then capture.</p>}

    <div className="mt-4 grid w-full gap-2 sm:grid-cols-2">
      {phase.name === "captured" && <>
        <button type="button" onClick={retake} className={`${SECONDARY_BUTTON} w-full`}>Retake</button>
        <button type="button" onClick={use} className={`${PRIMARY_BUTTON} w-full`}>Use photo</button>
      </>}
      {refused && <>
        <button type="button" onClick={() => leave(onCancel)} className={`${SECONDARY_BUTTON} w-full`}>Back</button>
        {phase.retry
          ? <button type="button" onClick={() => void start()} className={`${PRIMARY_BUTTON} w-full`}>Try again</button>
          : onUploadInstead && <button type="button" onClick={() => leave(onUploadInstead)} className={`${PRIMARY_BUTTON} w-full`}>Upload selfie</button>}
        {phase.retry && onUploadInstead && <button type="button" onClick={() => leave(onUploadInstead)} className={`${SECONDARY_BUTTON} w-full sm:col-span-2`}>Upload selfie instead</button>}
      </>}
      {!refused && phase.name !== "captured" && <>
        <button type="button" onClick={() => leave(onCancel)} className={`${SECONDARY_BUTTON} w-full`}>Cancel</button>
        <button type="button" onClick={capture} disabled={!live} className={`${PRIMARY_BUTTON} w-full`}><PhotoCamera style={{ fontSize: 20 }} aria-hidden="true" />Capture</button>
      </>}
    </div>
  </div>;
}
