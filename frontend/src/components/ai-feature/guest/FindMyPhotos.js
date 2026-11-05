"use client";
import { useEffect, useRef, useState } from "react";
import PhotoCamera from "@mui/icons-material/PhotoCamera";
import AddPhotoAlternate from "@mui/icons-material/AddPhotoAlternate";
import AutoAwesome from "@mui/icons-material/AutoAwesome";
import CheckCircle from "@mui/icons-material/CheckCircle";
import Loader from "@/components/shared/Loader";
import { formatCount } from "@/lib/aiFeature.mjs";
import { PRIMARY_BUTTON, SECONDARY_BUTTON } from "./guestActions";

const TIPS = ["Face the camera straight on, with nothing covering your face.", "Find good light - daylight or a bright room, not a window behind you.", "Just you in the frame, close enough that your face fills a good part of it."];

/**
 * Find My Photos: one selfie, matched against every face in the event. Two ways in - the phone's
 * front camera and the plain picker - then a preview, then the upload with its wait, and at the
 * end how many photos were found and a step over to My Photos. A guest who already gave a selfie
 * is told so and may swap it for another.
 */
export default function FindMyPhotos({ guest, onUpload, onFound, canShowMine }) {
  // The chosen file and the object URL it is previewed through, kept together so one cannot
  // outlive the other.
  const [chosenFile, setChosenFile] = useState({ file: null, preview: "" });
  const { file, preview } = chosenFile;
  const [state, setState] = useState({ status: "idle", message: "", matched: null });
  const cameraRef = useRef(null); const pickerRef = useRef(null);
  const hasSelfie = guest?.selfieStatus === "UPLOADED";
  const [replacing, setReplacing] = useState(false);

  // The preview URL is released when it is replaced, and once more when the pane goes away.
  const previewRef = useRef("");
  useEffect(() => { previewRef.current = preview; }, [preview]);
  useEffect(() => () => { if (previewRef.current) URL.revokeObjectURL(previewRef.current); }, []);
  function pick(next) {
    setChosenFile((current) => { if (current.preview) URL.revokeObjectURL(current.preview); return next ? { file: next, preview: URL.createObjectURL(next) } : { file: null, preview: "" }; });
  }

  function choose(event) {
    const chosen = event.target.files?.[0];
    event.target.value = "";
    if (!chosen) return;
    if (!/^image\//.test(chosen.type || "")) { setState({ status: "error", message: "Please choose a photo.", matched: null }); return; }
    pick(chosen); setState({ status: "idle", message: "", matched: null });
  }
  async function find() {
    if (!file || state.status === "busy") return;
    setState({ status: "busy", message: "", matched: null });
    try {
      const result = await onUpload(file);
      const matched = result?.matched;
      setState({ status: "done", message: "", matched });
      pick(null); setReplacing(false);
      onFound?.(result);
    } catch (error) {
      const status = Number(error?.status);
      const message = status === 503 ? "Face matching is taking a break. Please try again shortly." : status === 422 ? error.message || "We could not find a clear face in that photo." : error?.message || "Something went wrong. Please try again.";
      setState({ status: "error", message, matched: null, showTips: status === 422 });
    }
  }

  const showPicker = !hasSelfie || replacing || state.status === "error";

  return <div className="mx-auto w-full max-w-lg">
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
      <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-blue-50 text-blue-600"><AutoAwesome style={{ fontSize: 22 }} aria-hidden="true" /></div>
      <h2 className="mt-4 text-center text-lg font-semibold text-slate-900">Find my photos</h2>
      <p className="mt-1 text-center text-sm leading-6 text-slate-600">Take a selfie and we will find every photo you appear in. Your selfie is only used to match faces at this event.</p>

      {state.status === "done" && <div role="status" className="mt-6 rounded-xl bg-green-50 px-4 py-3 text-center text-sm text-green-800">
        <CheckCircle style={{ fontSize: 18 }} aria-hidden="true" className="mr-1 -mt-0.5 inline" />
        {state.matched === null ? "Your selfie is in. Matching is running and your photos will appear shortly." : `${formatCount(state.matched)} ${state.matched === 1 ? "photo" : "photos"} found.`}
        {canShowMine && <div className="mt-3"><button type="button" onClick={() => onFound?.({ goToMine: true })} className={`${PRIMARY_BUTTON} w-full`}>See my photos</button></div>}
      </div>}

      {hasSelfie && !replacing && state.status !== "done" && <div className="mt-6 rounded-xl bg-slate-50 px-4 py-3 text-center text-sm text-slate-700">
        <p>You have already shared a selfie{guest?.matchedCount ? ` - ${formatCount(guest.matchedCount)} ${guest.matchedCount === 1 ? "photo" : "photos"} matched so far` : ""}. New photos are matched automatically as the photographer uploads.</p>
        <button type="button" onClick={() => setReplacing(true)} className={`${SECONDARY_BUTTON} mt-3 w-full`}>Use a different selfie</button>
      </div>}

      {showPicker && state.status !== "done" && <div className="mt-6">
        <input ref={cameraRef} type="file" accept="image/*" capture="user" onChange={choose} className="sr-only" aria-label="Take a selfie" />
        <input ref={pickerRef} type="file" accept="image/*" onChange={choose} className="sr-only" aria-label="Upload a selfie" />
        {preview
          ? <div className="flex flex-col items-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={preview} alt="Your selfie" className="h-44 w-44 rounded-full object-cover shadow-md" />
            {state.status === "busy"
              ? <Loader label="Looking for you in the photos..." className="pt-4" />
              : <div className="mt-5 grid w-full gap-2">
                <button type="button" onClick={find} className={`${PRIMARY_BUTTON} w-full`}><AutoAwesome style={{ fontSize: 18 }} aria-hidden="true" />Find my photos</button>
                <button type="button" onClick={() => pick(null)} className={`${SECONDARY_BUTTON} w-full`}>Choose another</button>
              </div>}
          </div>
          : <div className="grid gap-2 sm:grid-cols-2">
            <button type="button" onClick={() => cameraRef.current?.click()} className={`${PRIMARY_BUTTON} w-full`}><PhotoCamera style={{ fontSize: 20 }} aria-hidden="true" />Take selfie</button>
            <button type="button" onClick={() => pickerRef.current?.click()} className={`${SECONDARY_BUTTON} w-full`}><AddPhotoAlternate style={{ fontSize: 20 }} aria-hidden="true" />Upload selfie</button>
          </div>}
        {state.status === "error" && <p role="alert" className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.message}</p>}
        {(state.showTips || !preview) && <ul className="mt-5 space-y-1.5 text-xs leading-5 text-slate-500">
          {TIPS.map((tip) => <li key={tip} className="flex gap-2"><span aria-hidden="true">•</span><span>{tip}</span></li>)}
        </ul>}
      </div>}
    </div>
  </div>;
}
