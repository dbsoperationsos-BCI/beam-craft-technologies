"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ArrowBack from "@mui/icons-material/ArrowBack";
import Dialog from "@/components/ui/Dialog";
import Button from "@/components/shared/Button";
import TextField from "@/components/shared/TextField";
import ToggleSwitch from "@/components/shared/ToggleSwitch";
import Loader from "@/components/shared/Loader";
import { saveBlob } from "@/lib/downloadImage";
import { QR_TEMPLATES, TEXT_FIELDS, TEXT_LIMITS, ensurePosterFonts, exportPoster, pageFontFamily, posterText, qrMatrix, renderPoster, resolvePosterLogos, templateById } from "@/lib/qrPoster.mjs";
import { getAiSharePoster } from "@/services/ai-feature/ai-feature.service";

const THUMB_SCALE = 0.16;
const PREVIEW_SCALE = 0.45;
// The ⓘ help beside each poster text box, by its key in TEXT_FIELDS.
const TEXT_HELP = {
  heading: "The large title at the top of the poster.",
  subheading: "A short line printed under the poster's title.",
  instruction: "Tells guests what to do, such as scan the code.",
  note: "An extra line of smaller text on the poster.",
  footer: "The event name printed at the bottom of the poster.",
};

/**
 * Share → QR Template: the event's guest link as a printable poster, in one of ten designs
 * (`lib/qrPoster.mjs`, which the desktop mirrors). The kit is read fresh every time this opens -
 * the live link, its QR grid, the event's name and the studio's logos - so a link regenerated a
 * moment ago is the one printed, and a revoked or expired one has no poster at all (the server
 * answers 409 and nothing can be downloaded). The words are the studio's to change; the code,
 * the logo and the layout are not.
 */
export default function QrTemplateDialog({ eventId, eventName, onBack, onClose, onNotify }) {
  const [kit, setKit] = useState(undefined);
  const [assets, setAssets] = useState(null);
  const [error, setError] = useState("");
  const [templateId, setTemplateId] = useState(QR_TEMPLATES[0].id);
  const [edits, setEdits] = useState({});
  const [thumbs, setThumbs] = useState({});
  const [preview, setPreview] = useState("");
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    setKit(undefined); setAssets(null); setError("");
    try {
      const data = (await getAiSharePoster(eventId)).data;
      const fontFamily = pageFontFamily();
      const [logos] = await Promise.all([resolvePosterLogos(data), ensurePosterFonts(fontFamily)]);
      setAssets({ matrix: qrMatrix(data.qr), logos, fontFamily, studioName: data.studioName });
      setKit(data);
    } catch (cause) {
      setError(cause.message || "Unable to prepare the poster.");
      setKit(null);
    }
  }, [eventId]);
  useEffect(() => {
    const timer = window.setTimeout(() => { load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  // The link, its QR and its PIN as they stand now, re-read quietly whenever this window comes
  // back into focus: a PIN or code changed in another tab, on the other app or by a colleague
  // reaches the preview and the next download without the dialog being opened again. Only the
  // kit and its QR grid change; the chosen design and the typed words are kept.
  useEffect(() => {
    if (!kit) return undefined;
    let cancelled = false;
    async function refresh() {
      if (document.visibilityState === "hidden") return;
      try {
        const data = (await getAiSharePoster(eventId)).data;
        if (cancelled || !data) return;
        if (data.url === kit.url && data.pin === kit.pin && data.qr?.modules === kit.qr?.modules) return;
        setKit(data);
        setAssets((current) => (current ? { ...current, matrix: qrMatrix(data.qr) } : current));
      } catch (cause) {
        // A link revoked or expired meanwhile has no poster: say so and stop offering downloads.
        if (!cancelled && cause?.status === 409) { setKit(null); setError(cause.message); }
      }
    }
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => { cancelled = true; window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, [eventId, kit]);

  const text = useMemo(() => (kit ? posterText(kit, edits) : null), [kit, edits]);
  const template = templateById(templateId);

  // The ten small previews, drawn once the kit is in, again only when the words change.
  useEffect(() => {
    if (!assets || !text) return undefined;
    const timer = window.setTimeout(() => {
      setThumbs(Object.fromEntries(QR_TEMPLATES.map((item) => [item.id, renderPoster(item, text, assets, THUMB_SCALE).toDataURL("image/png")])));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [assets, text]);
  // The large preview of the chosen design, redrawn a moment after typing stops.
  useEffect(() => {
    if (!assets || !text) return undefined;
    const timer = window.setTimeout(() => { setPreview(renderPoster(template, text, assets, PREVIEW_SCALE).toDataURL("image/png")); }, 120);
    return () => window.clearTimeout(timer);
  }, [assets, text, template]);

  const download = useRef(false);
  async function save(format) {
    if (download.current || !assets || !text) return;
    download.current = true; setBusy(format);
    try {
      const { blob, fileName, dpi } = await exportPoster(template, text, assets, { format, eventName: kit?.event?.name || eventName });
      saveBlob(blob, fileName);
      onNotify?.(`${template.name} A1 poster downloaded${dpi < 300 ? ` at ${dpi} dpi - this device could not draw it at 300` : ""}.`);
    } catch (cause) {
      setError(cause.message || "Unable to download the poster.");
    } finally {
      download.current = false; setBusy("");
    }
  }

  const setText = (key) => (event) => setEdits((current) => ({ ...current, [key]: event.target.value }));
  const ready = Boolean(kit && assets && text);

  return <Dialog
    title="QR Template"
    description="Pick a design for a printable poster of this event's guest link. The QR code, logo and link are filled in for you."
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
    {kit === undefined
      ? <Loader label="Preparing the poster..." />
      : !ready
        ? <p className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">A poster needs an active guest link. Go back to generate or regenerate it, then open QR Template again.</p>
        : <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
          <div className="min-w-0 space-y-4">
            <div>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Designs</p>
              <div role="radiogroup" aria-label="Poster design" className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                {QR_TEMPLATES.map((item) => {
                  const selected = item.id === template.id;
                  return <Button
                    key={item.id}
                    type="button"
                    variant="plain"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => setTemplateId(item.id)}
                    className={`flex-col !items-stretch gap-1 rounded-lg border-2 p-1 text-left ${selected ? "border-blue-600 bg-blue-50" : "border-slate-200 hover:border-slate-300"}`}
                  >
                    {thumbs[item.id]
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img src={thumbs[item.id]} alt="" className="aspect-[594/841] w-full rounded object-cover" />
                      : <span className="block aspect-[594/841] w-full animate-pulse rounded bg-slate-100" />}
                    <span className={`truncate px-0.5 text-[11px] ${selected ? "font-semibold text-blue-700" : "text-slate-700"}`}>{item.name}</span>
                  </Button>;
                })}
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {TEXT_FIELDS.map((field) => <TextField
                key={field.key}
                label={field.label}
                helperText={TEXT_HELP[field.key]}
                value={edits[field.key] ?? text[field.key]}
                maxLength={TEXT_LIMITS[field.key]}
                onChange={setText(field.key)}
                note={field.key === "footer" ? "Starts as the event's name. Leave empty to leave it off." : undefined}
                className={field.key === "note" ? "sm:col-span-2" : ""}
              />)}
            </div>
            {/* Only whether an existing PIN is printed: protection itself is the link's, set in Share with guests. */}
            <div>
              <ToggleSwitch label="Print the PIN on the poster" helperText="Prints the link's PIN on the poster so guests can open it." checked={Boolean(kit.pin) && edits.showPin !== false} disabled={!kit.pin} onCheckedChange={(checked) => setEdits((current) => ({ ...current, showPin: checked }))} />
              {!kit.pin && <p className="mt-1 text-xs text-slate-500">This link has no PIN, so none is printed. Turn on Require a PIN in Share with guests to print one.</p>}
            </div>
            <p className="text-xs text-slate-500">The code opens <span className="font-medium text-slate-700">{kit.url}</span>. Every design prints at A1 (594 × 841 mm): a 7016 × 9933 px PNG at 300 dpi, or an A1 PDF.{assets.logos.own ? "" : " No studio logo is set in Settings → Branding Logo, so the app's own mark is used."}</p>
          </div>
          <div className="min-w-0">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Preview · {template.name}</p>
            <div className="flex justify-center rounded-xl bg-slate-100 p-3">
              {preview
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={preview} alt={`${template.name} poster preview`} className="aspect-[594/841] w-full max-w-[18rem] rounded shadow-md lg:max-w-none" />
                : <span className="block aspect-[594/841] w-full max-w-[18rem] animate-pulse rounded bg-slate-200" />}
            </div>
          </div>
        </div>}
  </Dialog>;
}
