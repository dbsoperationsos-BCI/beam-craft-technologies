"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import Button from "@/components/shared/Button";
import Dialog from "@/components/ui/Dialog";
import { compressImageFile } from "@/lib/imageCompression";
import { facesUser } from "@/lib/cameraFacing.mjs";

/**
 * A live camera that stays open: every press of Capture adds a photo, and Done closes it.
 *
 * For taking several pictures in a row - an event's photos - where the phone's own camera screen,
 * reached through `<input capture>`, hands back one picture and closes, and a laptop ignores
 * `capture` altogether and opens a file picker instead. `getUserMedia` works on both, and the back
 * camera is asked for first, since this is for photographing a room rather than a selfie; Switch
 * camera turns round to the other one where a device has two.
 *
 * Where the camera cannot be had - refused, missing, or a browser without it (plain http is one) -
 * it says so and offers the device's own camera screen through `<input capture>`, one picture at a
 * time, so the button still does something on a phone whose browser refused the live view.
 *
 * `onCapture(dataUrl)` receives each photo already compressed by `compressImageFile` with
 * `compress`. `taken` and `max` are the caller's count, shown here and used to stop at the limit.
 * The stream is stopped whenever the dialog closes, so the camera light goes out with it.
 */
export default function CameraCaptureDialog({ onCapture, onClose, taken = 0, max = Infinity, compress = null, layer = "dialogOverPanel", title = "Take photos" }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const fallbackInputId = useId();
  const [facing, setFacing] = useState("environment");
  const [canSwitch, setCanSwitch] = useState(false);
  // Whether the camera in use faces the person - its preview then reads like a mirror (`facesUser`).
  const [mirrored, setMirrored] = useState(false);
  const [status, setStatus] = useState("starting");
  const [problem, setProblem] = useState("");
  const [flash, setFlash] = useState(false);
  const [saving, setSaving] = useState(false);
  const full = taken >= max;

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => {
    let cancelled = false;
    const start = async () => {
      stop();
      setStatus("starting");
      setProblem("");
      if (!navigator.mediaDevices?.getUserMedia) {
        setStatus("unavailable");
        setProblem("This browser cannot open the camera here. Use your device's camera below, or Upload from gallery instead.");
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
        if (cancelled) { stream.getTracks().forEach((track) => track.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
        setMirrored(facesUser(stream));
        setStatus("live");
        // Offered only where there is a second camera to turn to.
        const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
        if (!cancelled) setCanSwitch(devices.filter((device) => device.kind === "videoinput").length > 1);
      } catch (error) {
        if (cancelled) return;
        setStatus("unavailable");
        setProblem(error?.name === "NotAllowedError"
          ? "Camera access was refused. Allow the camera for this site in the browser's settings, or use Upload from gallery instead."
          : "No camera could be opened on this device. Use Upload from gallery instead.");
      }
    };
    void start();
    return () => { cancelled = true; stop(); };
  }, [facing, stop]);

  /** One frame of the live view, as a compressed photo handed to the caller. */
  async function capture() {
    const video = videoRef.current;
    if (!video || status !== "live" || full || saving || !video.videoWidth) return;
    setSaving(true);
    setFlash(true);
    window.setTimeout(() => setFlash(false), 150);
    try {
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
      if (!blob) throw new Error("capture failed");
      const { dataUrl } = await compressImageFile(new File([blob], `photo-${Date.now()}.jpg`, { type: "image/jpeg" }), compress || {});
      onCapture(dataUrl);
    } catch {
      setProblem("That photo could not be taken. Try again.");
    } finally {
      setSaving(false);
    }
  }

  /** The device's own camera screen, one picture per trip, where the live view is not available. */
  async function captureWithDevice(event) {
    const [file] = Array.from(event.target.files || []);
    event.target.value = "";
    if (!file || full) return;
    try {
      const { dataUrl } = await compressImageFile(file, compress || {});
      onCapture(dataUrl);
    } catch {
      setProblem("That photo could not be read. Try again.");
    }
  }

  return <Dialog
    title={title}
    description={full ? `That is the limit of ${max} photos.` : `${taken} taken${Number.isFinite(max) ? ` of ${max}` : ""}. Keep capturing, then press Done.`}
    size="lg"
    layer={layer}
    onClose={onClose}
    footer={<>
      {canSwitch && status === "live" && <Button type="button" onClick={() => setFacing((current) => (current === "environment" ? "user" : "environment"))}>Switch camera</Button>}
      <Button type="button" variant="primary" onClick={onClose}>Done</Button>
    </>}
  >
    <div className="space-y-3 pb-2">
      {status !== "unavailable" && <div className="relative overflow-hidden rounded-lg bg-slate-900">
        <video ref={videoRef} autoPlay playsInline muted className={`aspect-video w-full object-contain ${mirrored ? "-scale-x-100" : ""}`} />
        {status === "starting" && <p className="absolute inset-0 flex items-center justify-center text-sm text-slate-200">Opening the camera...</p>}
        {flash && <div aria-hidden="true" className="absolute inset-0 bg-white/70" />}
        {status === "live" && <div className="absolute inset-x-0 bottom-3 flex justify-center">
          <button
            type="button"
            onClick={() => void capture()}
            disabled={full || saving}
            aria-label="Capture photo"
            className="h-16 w-16 rounded-full border-4 border-white bg-white/30 shadow-lg transition hover:bg-white/50 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
          />
        </div>}
      </div>}
      {problem && <p role="alert" className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">{problem}</p>}
      {status === "unavailable" && <>
        <label htmlFor={fallbackInputId} className={`inline-flex cursor-pointer items-center justify-center rounded-md border border-blue-300 bg-blue-50 px-4 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100 ${full ? "pointer-events-none opacity-60" : ""}`}>Use device camera</label>
        <input id={fallbackInputId} type="file" accept="image/*" capture="environment" disabled={full} onChange={(event) => void captureWithDevice(event)} className="sr-only" />
      </>}
    </div>
  </Dialog>;
}
