"use client";
import { useEffect, useRef, useState } from "react";
import PhotoCamera from "@mui/icons-material/PhotoCamera";
import AddPhotoAlternate from "@mui/icons-material/AddPhotoAlternate";
import AutoAwesome from "@mui/icons-material/AutoAwesome";
import CheckCircle from "@mui/icons-material/CheckCircle";
import Loader from "@/components/shared/Loader";
import { formatCount } from "@/lib/aiFeature.mjs";
import { PRIMARY_BUTTON, SECONDARY_BUTTON, selfieLimitMessage, selfieLimitReached } from "./guestActions";
import SelfieCamera from "./SelfieCamera";

/**
 * The selfie search, shown inside My Photos: one selfie, matched against every face in the event.
 * Two ways in - the browser's own camera (`SelfieCamera`, on `getUserMedia`) and the plain file
 * picker - then a preview, then the upload with its wait. Both ways end in the same `File` handed to
 * the same `onUpload`; only how the selfie is obtained differs.
 *
 * `replacing` and `onReplace` belong to the gallery, which shows the guest's matches instead of this
 * once a selfie is in; `onCancel`, when given, takes a guest choosing a different selfie back to
 * them. Once the event's selfie limit is used the ways in are replaced by the limit message - the
 * server refuses another either way.
 */
export default function FindMyPhotos({ guest, features, onUpload, onFound, replacing = false, onReplace, onCancel }) {
  // The event's own answers, from the public meta. A meta without them - an older server - offers
  // both, which is what every event did before the switches existed.
  const showTake = features?.selfieTake !== false;
  const showUpload = features?.selfieUpload !== false;
  // The chosen file and the object URL it is previewed through, kept together so one cannot
  // outlive the other.
  const [chosenFile, setChosenFile] = useState({ file: null, preview: "" });
  const { file, preview } = chosenFile;
  const [state, setState] = useState({ status: "idle", message: "", matched: null });
  const pickerRef = useRef(null);
  // Written before the upload awaits, so a second press in the same tick does not send a second selfie.
  const sendingRef = useRef(false);
  // Take selfie mounts the camera in place of the two buttons; it is never open on arrival.
  const [cameraOpen, setCameraOpen] = useState(false);
  const hasSelfie = guest?.selfieStatus === "UPLOADED";
  const limitReached = selfieLimitReached(guest);

  // The preview URL is released when it is replaced, and once more when the pane goes away.
  const previewRef = useRef("");
  useEffect(() => { previewRef.current = preview; }, [preview]);
  useEffect(() => () => { if (previewRef.current) URL.revokeObjectURL(previewRef.current); }, []);
  function pick(next) {
    setChosenFile((current) => { if (current.preview) URL.revokeObjectURL(current.preview); return next ? { file: next, preview: URL.createObjectURL(next) } : { file: null, preview: "" }; });
  }

  // Which way the previewed file came, told to the server with it so the event's switch for that
  // way is enforced there and not only by which button was drawn.
  const [source, setSource] = useState("upload");

  function choose(event) {
    const chosen = event.target.files?.[0];
    event.target.value = "";
    if (!chosen) return;
    if (!/^image\//.test(chosen.type || "")) { setState({ status: "error", message: "Please choose a photo.", matched: null }); return; }
    setSource("upload"); pick(chosen); setState({ status: "idle", message: "", matched: null });
  }
  // `chosen` is the file the camera just handed over, sent before the state holding it has
  // rendered; the Find my photos button passes nothing and sends the previewed one.
  async function find(chosen, chosenSource) {
    const target = chosen instanceof File ? chosen : file;
    if (!target || sendingRef.current) return;
    sendingRef.current = true;
    setState({ status: "busy", message: "", matched: null });
    try {
      const result = await onUpload(target, chosenSource || source);
      setState({ status: "done", message: "", matched: result?.matched });
      pick(null);
      onFound?.(result);
    } catch (error) {
      const status = Number(error?.status);
      const message = status === 503 ? "Face matching is taking a break. Please try again shortly." : status === 422 ? error.message || "We could not find a clear face in that photo." : error?.message || "Something went wrong. Please try again.";
      setState({ status: "error", message, matched: null });
    } finally { sendingRef.current = false; }
  }

  // The captured frame takes the same road as a picked file: previewed, then sent at once - the
  // live preview was the guest's look at it, so there is no second Find my photos press to make.
  function useCaptured(captured) {
    setCameraOpen(false);
    setSource("camera"); pick(captured);
    void find(captured, "camera");
  }

  const showPicker = !hasSelfie || replacing || state.status === "error";

  // On a phone the card falls away - the page is the card; from `md` up it is the bordered card it
  // has always been. Same buttons, same handlers either way.
  return <div className="mx-auto w-full max-w-lg">
    <div className="px-1 pt-2 md:rounded-2xl md:border md:border-slate-200 md:bg-white md:p-8 md:shadow-sm">
      <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-blue-50 text-blue-600 md:h-12 md:w-12"><AutoAwesome style={{ fontSize: 26 }} aria-hidden="true" /></div>
      <h2 className="mt-4 text-center text-[22px] font-semibold tracking-tight text-slate-900 md:text-lg">Find your photos</h2>

      {state.status === "done" && <div role="status" className="mt-6 rounded-xl bg-green-50 px-4 py-3 text-center text-sm text-green-800">
        <CheckCircle style={{ fontSize: 18 }} aria-hidden="true" className="mr-1 -mt-0.5 inline" />
        {state.matched === null ? "Your selfie is in. Your photos will appear shortly." : `${formatCount(state.matched)} ${state.matched === 1 ? "photo" : "photos"} found.`}
      </div>}

      {hasSelfie && !replacing && state.status !== "done" && <div className="mt-6 rounded-xl bg-slate-50 px-4 py-3 text-center text-sm text-slate-700">
        <p>You have already shared a selfie{guest?.matchedCount ? ` - ${formatCount(guest.matchedCount)} ${guest.matchedCount === 1 ? "photo" : "photos"} matched so far` : ""}.</p>
        {limitReached
          ? <p className="mt-2 text-slate-600">{selfieLimitMessage(guest)}</p>
          : <button type="button" onClick={onReplace} className={`${SECONDARY_BUTTON} mt-3 w-full`}>Use a different selfie</button>}
      </div>}

      {showPicker && state.status !== "done" && <div className="mt-6">
        {/* Upload selfie alone reaches this input; Take selfie opens the camera below. */}
        <input ref={pickerRef} type="file" accept="image/*" onChange={choose} className="sr-only" aria-label="Upload a selfie" />
        {cameraOpen
          ? <SelfieCamera onUse={useCaptured} onCancel={() => setCameraOpen(false)} onUploadInstead={showUpload ? () => { setCameraOpen(false); pickerRef.current?.click(); } : undefined} />
          : preview
            ? <div className="flex flex-col items-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={preview} alt="Your selfie" className="h-44 w-44 rounded-full object-cover shadow-md" />
              {state.status === "busy"
                ? <Loader label="Finding your photos..." className="pt-4" />
                : <div className="mt-5 grid w-full gap-2">
                  <button type="button" onClick={() => find()} className={`${PRIMARY_BUTTON} w-full`}><AutoAwesome style={{ fontSize: 18 }} aria-hidden="true" />Find my photos</button>
                  <button type="button" onClick={() => pick(null)} className={`${SECONDARY_BUTTON} w-full`}>Choose another</button>
                </div>}
            </div>
            : limitReached
              ? <p role="status" className="rounded-xl bg-slate-50 px-4 py-3 text-center text-sm text-slate-600">{selfieLimitMessage(guest)}</p>
              : !showTake && !showUpload
                ? <p role="status" className="rounded-xl bg-slate-50 px-4 py-3 text-center text-sm text-slate-600">Selfie search is not open for this event right now. Please check back later.</p>
                // Stacked on a phone - the camera the one big action, the picker quieter under it -
                // and side by side from `md` up; one column when only one way is offered, so a lone
                // button fills the row.
                : <div className={`grid gap-2.5 ${showTake && showUpload ? "md:grid-cols-2" : ""}`}>
                  {showTake && <button type="button" onClick={() => { setState({ status: "idle", message: "", matched: null }); setCameraOpen(true); }} className={`${PRIMARY_BUTTON} min-h-14 w-full rounded-2xl text-base active:scale-[0.99] md:min-h-12 md:rounded-xl md:text-sm`}><PhotoCamera style={{ fontSize: 22 }} aria-hidden="true" />Take selfie</button>}
                  {showUpload && <button type="button" onClick={() => pickerRef.current?.click()} className={`${showTake ? SECONDARY_BUTTON : PRIMARY_BUTTON} min-h-14 w-full rounded-2xl text-base active:scale-[0.99] md:min-h-12 md:rounded-xl md:text-sm`}><AddPhotoAlternate style={{ fontSize: 22 }} aria-hidden="true" />Upload selfie</button>}
                </div>}
        {state.status === "error" && !cameraOpen && <p role="alert" className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.message}</p>}
        {onCancel && !cameraOpen && state.status !== "busy" && <button type="button" onClick={onCancel} className={`${SECONDARY_BUTTON} mt-4 w-full`}>Back to my photos</button>}
      </div>}
    </div>
  </div>;
}
