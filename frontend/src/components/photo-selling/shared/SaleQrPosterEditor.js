"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Button from "@/components/shared/Button";
import TextField from "@/components/shared/TextField";
import ToggleSwitch from "@/components/shared/ToggleSwitch";
import { saveBlob } from "@/lib/downloadImage";
import { TEXT_FIELDS, TEXT_LIMITS, ensurePosterFonts, exportPoster, pageFontFamily, qrMatrix, renderPoster, resolvePosterLogos } from "@/lib/qrPoster.mjs";
import { SALE_QR_TEMPLATES, saleTemplateById, salePosterText } from "@/lib/photoSellingQr.mjs";

const THUMB_SCALE = 0.16;
const PREVIEW_SCALE = 0.45;

/**
 * A poster in the making: the server's kit drawn in the shared designs (lib/qrPoster.mjs, the AI
 * Feature's own) with Photo Selling's words (lib/photoSellingQr.mjs) - the ten thumbnails, the large
 * preview, and `save("png" | "pdf")` for the A1 export. Used by the editor below, and by the gallery's
 * QR Template dialog, which keeps its downloads in its own footer as the AI Feature's does.
 * `enabled: false` leaves it idle, for an editor whose poster is drawn by its caller.
 */
export function useSalePoster({ kit, templateId, words, onNotify, onError, enabled = true }) {
  const [assets, setAssets] = useState(null);
  const [thumbs, setThumbs] = useState({});
  const [preview, setPreview] = useState("");
  const [busy, setBusy] = useState("");
  const saving = useRef(false);

  useEffect(() => {
    let cancelled = false;
    if (!kit || !enabled) return undefined;
    const fontFamily = pageFontFamily();
    Promise.all([resolvePosterLogos(kit), ensurePosterFonts(fontFamily)])
      .then(([logos]) => { if (!cancelled) setAssets({ matrix: qrMatrix(kit.qr), logos, fontFamily, studioName: kit.studioName }); })
      .catch((cause) => onError?.(cause.message || "The poster could not be prepared."));
    return () => { cancelled = true; };
  }, [kit, onError, enabled]);

  const template = saleTemplateById(templateId);
  const text = useMemo(() => (kit ? salePosterText(kit, words) : null), [kit, words]);
  useEffect(() => {
    if (!assets || !text) return undefined;
    const timer = window.setTimeout(() => setThumbs(Object.fromEntries(SALE_QR_TEMPLATES.map((item) => [item.id, renderPoster(item, text, assets, THUMB_SCALE).toDataURL("image/png")]))), 250);
    return () => window.clearTimeout(timer);
  }, [assets, text]);
  useEffect(() => {
    if (!assets || !text) return undefined;
    const timer = window.setTimeout(() => setPreview(renderPoster(template, text, assets, PREVIEW_SCALE).toDataURL("image/png")), 120);
    return () => window.clearTimeout(timer);
  }, [assets, text, template]);

  // Answers whether a file was saved, so a caller can act only on a download that happened.
  async function save(format) {
    if (saving.current || !assets || !text) return false;
    saving.current = true; setBusy(format);
    try {
      const { blob, fileName, dpi } = await exportPoster(template, text, assets, { format, eventName: kit?.event?.name });
      saveBlob(blob, fileName);
      onNotify?.(`${template.name} A1 poster downloaded${dpi < 300 ? ` at ${dpi} dpi - this device could not draw it at 300` : ""}.`);
      return true;
    } catch (cause) {
      onError?.(cause.message || "Unable to download the poster.");
      return false;
    } finally {
      saving.current = false; setBusy("");
    }
  }

  return { assets, thumbs, preview, busy, template, ready: Boolean(assets && text), save };
}

/**
 * Photo Selling's QR poster editor, for a gallery's QR Template dialog and the Settings defaults:
 * the designs as selectable cards, the words, and the live preview. Controlled: `templateId` and
 * `words` come in, `onChange({ templateId, words })` goes out; saving is the caller's. `kit` is
 * what the server built the poster from - a gallery's own store link, or the Settings placeholder.
 * A caller that offers downloads draws the poster itself with `useSalePoster` and passes it as
 * `poster`, keeping the buttons in its own footer.
 */
export default function SaleQrPosterEditor({ kit, templateId, words, onChange, readOnly = false, onNotify, onError, poster: drawn = null }) {
  const own = useSalePoster({ kit, templateId, words, onNotify, onError, enabled: !drawn });
  const { thumbs, preview, template, assets } = drawn || own;

  const setWord = (key) => (event) => onChange({ templateId: template.id, words: { ...words, [key]: event.target.value } });
  return <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
    <div className="min-w-0 space-y-4">
      <div>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Designs</p>
        <div role="radiogroup" aria-label="Poster design" className="grid grid-cols-3 gap-2 sm:grid-cols-5">
          {SALE_QR_TEMPLATES.map((item) => {
            const selected = item.id === template.id;
            return <Button key={item.id} type="button" variant="plain" role="radio" aria-checked={selected} disabled={readOnly && !selected}
              onClick={() => onChange({ templateId: item.id, words })}
              className={`flex-col !items-stretch gap-1 rounded-lg border-2 p-1 text-left ${selected ? "border-blue-600 bg-blue-50" : "border-slate-200 hover:border-slate-300"}`}>
              {thumbs[item.id]
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={thumbs[item.id]} alt="" className="aspect-[594/841] w-full rounded object-cover" />
                : <span className="block aspect-[594/841] w-full animate-pulse rounded bg-slate-100" />}
              <span className={`truncate px-0.5 text-[11px] ${selected ? "font-semibold text-blue-700" : "text-slate-700"}`}>{item.name}</span>
            </Button>;
          })}
        </div>
      </div>
      <fieldset disabled={readOnly} className="grid gap-3 sm:grid-cols-2">
        {TEXT_FIELDS.map((field) => <TextField key={field.key} label={field.label}
          value={words[field.key] ?? (field.key === "footer" ? kit?.event?.name || "" : "")}
          maxLength={TEXT_LIMITS[field.key]} onChange={setWord(field.key)}
          note={field.key === "footer" ? "Starts as the gallery's name. Leave empty to leave it off." : undefined}
          className={field.key === "note" ? "sm:col-span-2" : ""} />)}
      </fieldset>
      <ToggleSwitch label="Print the PIN on the poster" checked={Boolean(kit?.pin || kit?.sample) && words.showPin !== false} disabled={readOnly || !(kit?.pin || kit?.sample)} onCheckedChange={(checked) => onChange({ templateId: template.id, words: { ...words, showPin: checked } })} />
      {kit && <p className="text-xs text-slate-500">{kit.sample ? "A sample link is shown here; each gallery's poster opens that gallery's own store." : <>The code opens <span className="font-medium text-slate-700">{kit.url}</span>.{kit.pin ? "" : " This gallery has no PIN, so none is printed - turn on Require a PIN in Share with guests to print one."}</>} Every design prints at A1 (594 × 841 mm): a 7016 × 9933 px PNG at 300 dpi, or an A1 PDF.{assets && !assets.logos?.own ? " No studio logo is set in Settings → Branding Logo, so the app's own mark is used." : ""}</p>}
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
  </div>;
}
