"use client";

import AddPhotoAlternate from "@mui/icons-material/AddPhotoAlternate";
import AutoAwesome from "@mui/icons-material/AutoAwesome";
import PhotoCamera from "@mui/icons-material/PhotoCamera";
import SearchOffRounded from "@mui/icons-material/SearchOffRounded";
import ShieldOutlined from "@mui/icons-material/ShieldOutlined";
import { useEffect, useId, useRef, useState } from "react";
import Checkbox from "@/components/shared/Checkbox";
import Loader from "@/components/shared/Loader";
import SelfieCamera from "@/components/ai-feature/guest/SelfieCamera";
import { startSelfieSearch } from "@/services/photo-selling/photo-store-public.service";
import StoreButton from "./StoreButton";

/**
 * The store's front door: a guest finds their photos by a selfie, and only that way - the gallery is
 * never shown whole. Nothing is sent until the guest has read what happens to their selfie and
 * agreed; then one selfie - taken here or chosen from the phone - goes up once, and the matched
 * photos come back (`onFound`). As the AI Feature's Find My Photos: a chosen photo is previewed
 * first and sent by Find my photos (or swapped by Choose another); a camera shot was previewed by
 * the camera itself (Retake / Use photo), so Use photo sends it at once.
 *
 * No match and a failed search are answers of their own, each with a way to try again - neither
 * ever falls back to showing other photos. A guest who asked for WhatsApp messages (`whatsappOn`) is
 * told, with no match yet, that they will hear on WhatsApp when their photos are found.
 */
const TIPS = ["Face the camera, with your whole face in the frame.", "Use good, even light - avoid strong light behind you.", "Take off sunglasses, masks or anything covering your face.", "If you wore glasses or a different look at the event, try a photo like that."];

export default function StoreSelfieSearch({ code, session, accent, preparing = false, unavailable = "", noMatch = false, whatsappOn = false, onStopWhatsApp, stopping = false, onFound, onNoMatch, onRefresh, onBack, backLabel = "Back to my photos" }) {
  const ids = useId();
  const [consent, setConsent] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  // The selfie about to be sent and the object URL it is previewed through, kept together so one
  // cannot outlive the other; released when replaced, and once more when the page goes away.
  const [chosen, setChosen] = useState({ file: null, preview: "" });
  const previewRef = useRef("");
  useEffect(() => { previewRef.current = chosen.preview; }, [chosen.preview]);
  useEffect(() => () => { if (previewRef.current) URL.revokeObjectURL(previewRef.current); }, []);
  const pickerRef = useRef(null);

  function pick(file) {
    setChosen((current) => { if (current.preview) URL.revokeObjectURL(current.preview); return file ? { file, preview: URL.createObjectURL(file) } : { file: null, preview: "" }; });
  }

  async function send(file) {
    if (!file || sending) return;
    setSending(true);
    setError("");
    try {
      const response = await startSelfieSearch(code, session, file);
      if (response.data.status === "COMPLETED") onFound(response.data); else { pick(null); onNoMatch(response.data); }
    } catch (caught) {
      // The preview stays: Find my photos tries it again, Choose another swaps it (a 422 needs a new one).
      setError(caught.message || "Your search couldn't be completed.");
    } finally {
      setSending(false);
    }
  }
  function choose(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!/^image\//.test(file.type || "")) { setError("Please choose a photo of your face."); return; }
    setError("");
    pick(file);
  }
  const sendCaptured = (file) => { setCameraOpen(false); pick(file); void send(file); };

  if (unavailable) return <div className="mx-auto w-full max-w-lg">
    <div className="rounded-2xl bg-white p-6 text-center ring-1 ring-slate-200/70" role="status">
      <h2 className="text-lg font-semibold text-neutral-900">{preparing ? "Your photos are almost ready" : "Photo search isn't open yet"}</h2>
      <p className="mt-2 text-sm text-neutral-600">{unavailable}</p>
      <span className="mt-4 flex flex-wrap justify-center gap-2">
        {onRefresh && <StoreButton size="sm" onClick={onRefresh}>Check again</StoreButton>}
        {onBack && <StoreButton size="sm" variant="ghost" onClick={onBack}>{backLabel}</StoreButton>}
      </span>
    </div>
  </div>;

  // The AI Feature's Find My Photos card: on a phone the card falls away and the page is the card;
  // from `md` up it is a bordered white card.
  return <div className="mx-auto w-full max-w-lg">
    <div className="px-1 pt-2 md:rounded-2xl md:border md:border-slate-200 md:bg-white md:p-8 md:shadow-sm">
      <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-blue-50 text-blue-600 md:h-12 md:w-12">{noMatch ? <SearchOffRounded style={{ fontSize: 26 }} aria-hidden="true" /> : <AutoAwesome style={{ fontSize: 26 }} aria-hidden="true" />}</div>
      <h2 className="mt-4 text-center text-[22px] font-semibold tracking-tight text-slate-900 md:text-lg">{noMatch ? (whatsappOn ? "Your photos haven't been found yet" : "No matching photos found") : "Find your photos"}</h2>
      <p className="mt-1 text-center text-sm text-neutral-600">{noMatch ? (whatsappOn ? "Please wait - we'll notify you on WhatsApp when your photos are available. Or try a clearer selfie:" : "We didn't find you in this gallery's photos. A clearer selfie often helps:") : "Take a selfie facing the camera, in good light, and we'll show you only the photos you're in."}</p>
      {noMatch && <ul className="mt-3 list-disc space-y-1 rounded-xl bg-neutral-50 p-4 pl-8 text-sm text-neutral-700">{TIPS.map((tip) => <li key={tip}>{tip}</li>)}</ul>}
      {preparing && <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-center text-xs text-amber-900">Some photos are still being prepared - if you don&apos;t find yourself yet, try again a little later.</p>}
      {onBack && !sending && <p className="mt-3 text-center"><StoreButton size="sm" variant="ghost" onClick={onBack}>{backLabel}</StoreButton></p>}
      {onStopWhatsApp && !sending && <p className="mt-2 text-center"><StoreButton size="sm" variant="ghost" disabled={stopping} onClick={onStopWhatsApp}>{stopping ? "Stopping..." : "Stop WhatsApp messages"}</StoreButton></p>}

      {chosen.preview
        ? <div className="mt-5 flex flex-col items-center">
          {/* A local object URL of the guest's own selfie; next/image has nothing to optimise. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={chosen.preview} alt="Your selfie" className="h-44 w-44 rounded-full object-cover shadow-md" />
          {sending
            ? <div role="status"><Loader label="Looking for you in the photos - this takes a few seconds..." className="pt-4" /></div>
            : <>
              {error && <p role="alert" className="mt-4 w-full rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
              <div className="mt-5 grid w-full gap-2">
                <StoreButton variant="primary" accent={accent} disabled={!consent} onClick={() => send(chosen.file)} className="w-full"><AutoAwesome style={{ fontSize: 18 }} className="mr-2" aria-hidden="true" />Find my photos</StoreButton>
                <StoreButton onClick={() => { setError(""); pick(null); }} className="w-full">Choose another</StoreButton>
              </div>
            </>}
        </div>
        : <>
          {noMatch
            ? <p id={`${ids}-terms`} className="mt-4 text-center text-xs text-neutral-500">Same terms as before: your selfie isn&apos;t stored; its face and a small private thumbnail are kept, for this gallery only, until you remove it.</p>
            : <div id={`${ids}-terms`} className="mt-5 rounded-xl bg-neutral-50 p-4 text-sm leading-6 text-neutral-700">
            <p className="flex items-center gap-2 font-semibold text-neutral-900"><ShieldOutlined fontSize="small" aria-hidden="true" />Before you share a selfie</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>Use your own face. It&apos;s compared with the faces in <strong>this gallery only</strong>, to find the photos you&apos;re in - never used for anything else, or to train any system.</li>
              <li>Your selfie itself isn&apos;t stored. Its face and a small private thumbnail are kept as one of your selfies (up to 10) - for this gallery only, to find photos uploaded later - until you remove it under Your Selfies.</li>
            </ul>
          </div>}
          {error && <p role="alert" className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <label className="mt-4 flex cursor-pointer items-start gap-2 text-sm font-medium text-neutral-900">
            <Checkbox checked={consent} onChange={(checked) => setConsent(Boolean(checked))} ariaDescribedBy={`${ids}-terms`} />
            <span>I agree to my selfie being used to find my photos in this gallery.</span>
          </label>
          <input ref={pickerRef} type="file" accept="image/*" onChange={choose} className="sr-only" aria-label="Upload a selfie" tabIndex={-1} />
          {cameraOpen
            ? <div className="mt-5"><SelfieCamera onUse={sendCaptured} onCancel={() => setCameraOpen(false)} onUploadInstead={() => { setCameraOpen(false); pickerRef.current?.click(); }} /></div>
            // Stacked on a phone - the camera the one big action, the picker quieter under it - and
            // side by side from `md` up, as on the AI Feature.
            : <div className="mt-5 grid gap-2.5 md:grid-cols-2">
              <StoreButton variant="primary" accent={accent} disabled={!consent} onClick={() => setCameraOpen(true)} className="min-h-14 w-full rounded-2xl text-base md:min-h-12 md:rounded-xl md:text-sm"><PhotoCamera style={{ fontSize: 18 }} className="mr-2" aria-hidden="true" />{noMatch ? "Take another selfie" : "Take a selfie"}</StoreButton>
              <StoreButton disabled={!consent} onClick={() => pickerRef.current?.click()} className="min-h-14 w-full rounded-2xl text-base md:min-h-12 md:rounded-xl md:text-sm"><AddPhotoAlternate style={{ fontSize: 18 }} className="mr-2" aria-hidden="true" />Upload a photo</StoreButton>
              {!consent && <p className="text-center text-xs text-neutral-500 sm:col-span-2">Tick the box above to continue.</p>}
            </div>}
        </>}

    </div>
  </div>;
}
