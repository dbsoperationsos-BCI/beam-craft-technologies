"use client";

import ArrowBack from "@mui/icons-material/ArrowBack";
import { useCallback, useEffect, useState } from "react";
import Button from "@/components/shared/Button";
import Loader from "@/components/shared/Loader";
import Dialog from "@/components/ui/Dialog";
import { qrWordsPayload, saleQrWords } from "@/lib/photoSellingQr.mjs";
import { getSaleGalleryQrKit, updateSaleGallery } from "@/services/photo-selling/photo-selling.service";
import SaleQrPosterEditor, { useSalePoster } from "../shared/SaleQrPosterEditor";

/**
 * Share with guests → QR Template: the gallery's store link as a printable poster, laid out as the
 * AI Feature's own QR Template (ai-feature/event/QrTemplateDialog.js) - the ten shared designs, the
 * words, a large live preview, and Back / Download PDF / Download PNG. It takes the Share dialog's
 * place, and its back arrow brings that dialog back.
 *
 * Everything printed is this gallery's: the kit is read fresh from the server each time this opens
 * (`GET galleries/:id/qr-kit` - the store link, its QR grid, the PIN, the gallery's name and the
 * studio's logos), so a link code or PIN changed a moment ago is the one printed.
 *
 * This is the gallery's one poster screen (there is no QR poster step). It opens on the design and
 * words saved with the gallery - Photo Selling's settings, when it was made - and a download by
 * someone at Read / Write keeps the chosen design and words with the gallery, so the next poster
 * starts from them. Read only downloads: nothing is saved. The download never waits on the save.
 */
const fromGallery = (gallery) => ({ templateId: gallery.qrTemplateId || "ivory", words: saleQrWords(gallery.qrText) });

export default function GalleryQrTemplateDialog({ gallery, galleryId, canWrite = false, onSaved, onBack, onClose, onNotify }) {
  const [kit, setKit] = useState(undefined);
  const [error, setError] = useState("");
  const [poster, setPoster] = useState(() => fromGallery(gallery));

  const load = useCallback(async () => {
    setKit(undefined); setError("");
    try { setKit((await getSaleGalleryQrKit(galleryId)).data || null); }
    catch (cause) { setError(cause.message || "Unable to prepare the poster."); setKit(null); }
  }, [galleryId]);
  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(timer); }, [load]);

  const drawn = useSalePoster({ kit, templateId: poster.templateId, words: poster.words, onNotify, onError: setError });
  const { busy, ready } = drawn;
  const changed = JSON.stringify(poster) !== JSON.stringify(fromGallery(gallery));
  // Download, then keep the design and words with the gallery when they changed (Read / Write only).
  async function save(format) {
    const downloaded = await drawn.save(format);
    if (!downloaded || !canWrite || !changed) return;
    try {
      const response = await updateSaleGallery(galleryId, { qrTemplateId: poster.templateId, qrText: qrWordsPayload(poster.words) });
      onSaved?.(response.data);
    } catch (cause) {
      setError(`The poster downloaded, but its design couldn't be kept with the gallery: ${cause.message || "please try again."}`);
    }
  }

  return <Dialog
    title="QR Template"
    description="Pick a design for a printable poster of this gallery's store link. The QR code, logo and link are filled in for you."
    size="wide"
    onBack={onBack}
    backAriaLabel="Back to Share with guests"
    backIcon={<ArrowBack style={{ fontSize: 20 }} aria-hidden="true" />}
    onClose={onClose}
    busy={Boolean(busy)}
    footer={<>
      <Button type="button" className="max-sm:flex-1" disabled={Boolean(busy)} onClick={onBack}>Back</Button>
      <Button type="button" className="max-sm:flex-1" disabled={!ready || Boolean(busy)} onClick={() => save("pdf")}>{busy === "pdf" ? "Preparing PDF..." : "Download PDF"}</Button>
      <Button type="button" variant="primary" className="max-sm:flex-1" disabled={!ready || Boolean(busy)} onClick={() => save("png")}>{busy === "png" ? "Preparing PNG..." : "Download PNG"}</Button>
    </>}
  >
    {error && <p role="alert" className="mb-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
    {kit && !gallery.live && <p role="status" className="mb-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">The gallery isn&apos;t live yet, so the code opens a page saying it isn&apos;t open. Publish it before putting the poster up.</p>}
    {kit === undefined
      ? <Loader label="Preparing the poster..." />
      : !kit
        ? <div className="flex flex-col items-start gap-2 rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">
          <span>The poster could not be prepared for this gallery.</span>
          <Button type="button" size="sm" onClick={load}>Try again</Button>
        </div>
        : <>
          <SaleQrPosterEditor kit={kit} templateId={poster.templateId} words={poster.words} onChange={setPoster} poster={drawn} />
          {canWrite && <p className="mt-3 text-xs text-slate-500">The design and words you download are kept with this gallery, so its next poster starts from them.</p>}
        </>}
  </Dialog>;
}
