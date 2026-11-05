"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouteAccess } from "@/components/auth/PermissionsProvider";
import Button from "@/components/shared/Button";
import ChoiceCards from "@/components/shared/ChoiceCards";
import ColorField from "@/components/shared/ColorField";
import DashboardCard, { CardState } from "@/components/shared/DashboardCard";
import Dropdown from "@/components/shared/Dropdown";
import Loader from "@/components/shared/Loader";
import ReadOnlyFieldset from "@/components/shared/ReadOnlyFieldset";
import TextField from "@/components/shared/TextField";
import ToggleSwitch from "@/components/shared/ToggleSwitch";
import useSubmitOnce from "@/components/shared/useSubmitOnce";
import useUnsavedGuard, { useUnloadWarning } from "@/components/shared/useUnsavedGuard";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import Dialog from "@/components/ui/Dialog";
import { bpsToPercentText, paiseToRupeesText, percentToBps, rupeesToPaise } from "@/lib/photoSelling.mjs";
import { qrWordsPayload, saleQrWords } from "@/lib/photoSellingQr.mjs";
import { getPhotoSellingStatus, getSaleQrSample, getSaleSettings, listSaleWatermarkPresets, saveSaleSettings } from "@/services/photo-selling/photo-selling.service";
import SaleQrPosterEditor from "../shared/SaleQrPosterEditor";
import ServerStatusBanner from "../shared/ServerStatusBanner";
import WhatsAppMessagesStatus from "../shared/WhatsAppMessagesStatus";

/**
 * Photo Selling → Settings, opened over the Galleries page from its ⋮ menu: the studio's own Photo
 * Selling settings, saved in Photo Selling and read by nothing else - the AI Feature's settings are
 * separate and never used here.
 *
 * - Gallery defaults: what each new gallery starts with (price, tax, PIN, how closely a face must
 *   match a guest's selfie, button colour, watermark). Copied onto a gallery when it is made, so a change
 *   here never alters a gallery that already exists - each gallery's Details and Prices steps do.
 * - Downloads: how often, and for how long after payment, a buyer can download each photo bought.
 *   Each order keeps the policy it was sold under.
 * - QR poster: the design and words new galleries' posters start with.
 * - Guest selfie search & WhatsApp: whether new galleries open selfie search, and whether they message
 *   guests who leave their number when later photos match them - with what the server has in place.
 *
 * Read-only for a role with Photo Selling at Read; saving needs Read / Write (the server's guard
 * decides; this dialog only stops offering what it would refuse). Closing with unsaved edits asks
 * first, and so does leaving the page; a save closes it and the page says so (`onSaved`).
 */
const STRICTNESS_OPTIONS = [
  { value: "STANDARD", label: "Standard", description: "Confident matches only. Right for most events." },
  { value: "STRICTER", label: "Stricter", description: "Fewer, closer matches - for large events with many look-alikes." },
  { value: "BROADER", label: "Broader", description: "Finds a little more, with more chance of a wrong face." },
];

function formFrom(settings) {
  return {
    price: paiseToRupeesText(settings.pricePaise), tax: bpsToPercentText(settings.taxRateBps), pricesIncludeTax: settings.pricesIncludeTax,
    requirePin: settings.requirePin, matchStrictness: settings.matchStrictness,
    accentColor: settings.accentColor || "", watermarkPresetId: settings.watermarkPresetId || "",
    downloadLimit: String(settings.downloads.limit), downloadDays: String(settings.downloads.days),
    qrTemplateId: settings.qrTemplateId, qrWords: saleQrWords(settings.qrText),
    selfieSearchEnabled: settings.selfieSearchEnabled !== false, whatsappNotify: Boolean(settings.whatsappNotify),
  };
}

export default function PhotoSellingSettingsDialog({ onClose, onSaved }) {
  const { canWrite } = useRouteAccess();
  const [settings, setSettings] = useState(null);
  const [form, setForm] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [presets, setPresets] = useState([]);
  const [server, setServer] = useState(null);
  const [sample, setSample] = useState(null);
  const [errors, setErrors] = useState({});
  const { busy, run } = useSubmitOnce();

  const load = useCallback(async () => {
    setLoadError("");
    try {
      const [saved, status] = await Promise.all([getSaleSettings(), getPhotoSellingStatus()]);
      setSettings(saved.data); setForm(formFrom(saved.data)); setServer(status.data);
    } catch (cause) { setLoadError(cause.message || "The settings could not be loaded."); }
    listSaleWatermarkPresets().then((response) => setPresets(response.data || [])).catch(() => setPresets([]));
    getSaleQrSample().then((response) => setSample(response.data)).catch(() => setSample(null));
  }, []);
  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(timer); }, [load]);

  const dirty = Boolean(settings && form) && JSON.stringify(form) !== JSON.stringify(formFrom(settings));
  useUnloadWarning(dirty, dirty);
  const { guard, confirmProps } = useUnsavedGuard(dirty);
  const close = () => guard(onClose);
  // Editing a field takes back its own error; the rest wait for the next Save.
  const set = (key) => (value) => {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => (current[key] ? Object.fromEntries(Object.entries(current).filter(([name]) => name !== key)) : current));
  };
  const presetOptions = [{ value: "", label: "None - choose one per gallery" }, ...presets.map((preset) => ({ value: preset.id, label: preset.name }))];

  const save = (event) => {
    event?.preventDefault?.();
    if (!canWrite || !form) return undefined;
    return run(async () => {
      const next = {};
      const price = form.price.trim() === "" ? null : rupeesToPaise(form.price);
      if (form.price.trim() !== "" && (price == null || price < 100)) next.price = "Enter at least ₹1, or leave it empty to set prices per gallery.";
      const tax = percentToBps(form.tax);
      if (tax == null || tax > 5000) next.tax = "Enter a tax rate between 0 and 50%.";
      const limit = Number(form.downloadLimit);
      const days = Number(form.downloadDays);
      if (!Number.isInteger(limit) || limit < 1 || limit > 1000) next.downloadLimit = "Between 1 and 1000.";
      if (!Number.isInteger(days) || days < 1 || days > 3650) next.downloadDays = "Between 1 and 3650 days.";
      if (form.accentColor && !/^#[0-9A-F]{6}$/i.test(form.accentColor)) next.accentColor = "Use a colour like #1D4ED8.";
      setErrors(next);
      setSaveError("");
      if (Object.keys(next).length) return;
      try {
        await saveSaleSettings({
          pricePaise: price, taxRateBps: tax, pricesIncludeTax: form.pricesIncludeTax, requirePin: form.requirePin,
          matchStrictness: form.matchStrictness,
          accentColor: form.accentColor || null, watermarkPresetId: form.watermarkPresetId || null,
          downloads: { limit, days }, qrTemplateId: form.qrTemplateId, qrText: qrWordsPayload(form.qrWords),
          selfieSearchEnabled: form.selfieSearchEnabled, whatsappNotify: form.whatsappNotify,
        });
        onSaved?.("Settings saved. New galleries start from them; existing galleries keep their own.");
      } catch (cause) {
        setSaveError(cause.message || "The settings could not be saved.");
      }
    });
  };

  const footer = canWrite && form
    ? <>
      <Button type="button" onClick={close} disabled={busy}>Cancel</Button>
      <Button type="submit" variant="primary" busy={busy} busyLabel="Saving..." disabled={!dirty}>Save settings</Button>
    </>
    : <Button type="button" onClick={onClose}>Close</Button>;

  return <>
    <Dialog
      title="Photo Selling settings"
      description="Defaults for new galleries, buyers' downloads and the QR poster - Photo Selling's own, never the AI Feature's."
      size="form"
      busy={busy}
      onClose={close}
      onSubmit={canWrite && form ? save : undefined}
      footer={footer}
    >
      {loadError && !form
        ? <CardState error={loadError} onRetry={load} />
        : !form
          ? <Loader label="Loading settings..." className="py-16" />
          : <div className="flex flex-col gap-3">
            {/* At the top, where a failed Save is seen whatever part of the form is scrolled into view. */}
            {Object.keys(errors).length > 0 && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">Some settings need a fix - see the highlighted fields.</p>}
            {saveError && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{saveError}</p>}
            {!canWrite && <p role="status" className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">You can view these settings but not change them.</p>}
            <ServerStatusBanner server={server} />
            {server?.storageCleanupPending > 0 && <p role="status" className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">{server.storageCleanupPending} stored file{server.storageCleanupPending === 1 ? " is" : "s are"} still being removed from cloud storage after a deletion. This is retried automatically.</p>}
            <ReadOnlyFieldset canWrite={canWrite}>
              <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                <DashboardCard title="New gallery defaults" note="Copied onto each new gallery. Existing galleries keep their own." bodyClassName="flex flex-col gap-3 p-3">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <TextField label="Price per photo" prefix="₹" inputMode="decimal" value={form.price} onChange={(event) => set("price")(event.target.value)} error={errors.price} note="Leave empty to set it per gallery." />
                    <TextField label="Tax rate" suffix="%" inputMode="decimal" value={form.tax} onChange={(event) => set("tax")(event.target.value)} error={errors.tax} />
                  </div>
                  {percentToBps(form.tax) > 0 && <ToggleSwitch label="Prices include tax" checked={form.pricesIncludeTax} onCheckedChange={set("pricesIncludeTax")} />}
                  <ToggleSwitch label="Require a PIN to open a gallery" checked={form.requirePin} onCheckedChange={set("requirePin")} />
                  <Dropdown label="Watermark on previews" options={presetOptions} value={form.watermarkPresetId} onChange={set("watermarkPresetId")} sorted={false} />
                  <ColorField label="Button colour" value={form.accentColor} onChange={set("accentColor")} error={errors.accentColor} />
                </DashboardCard>
                <DashboardCard title="Selfie search" bodyClassName="flex flex-col gap-3 p-3">
                  <p className="text-xs text-slate-500">Guests find their photos only with a selfie: each sees - and can buy - only the photos their own face matches, never the whole gallery.{server && !server.faceMatching?.available ? " Selfie search isn't ready on this server yet, so no gallery can be published - the status above says why." : ""}</p>
                  <div>
                    <p className="mb-1.5 text-xs font-semibold text-slate-600">How closely a face must match the guest&apos;s selfie</p>
                    <ChoiceCards ariaLabel="How closely a face must match the guest's selfie" value={form.matchStrictness} onChange={set("matchStrictness")} options={STRICTNESS_OPTIONS} />
                  </div>
                </DashboardCard>
                <DashboardCard title="Guest selfie search & WhatsApp notifications" note="Copied onto each new gallery. Existing galleries keep their own." bodyClassName="flex flex-col gap-3 p-3">
                  <ToggleSwitch label="Enable guest selfie search" checked={form.selfieSearchEnabled} onCheckedChange={set("selfieSearchEnabled")} />
                  <ToggleSwitch label="Enable WhatsApp photo-match notifications" checked={form.whatsappNotify} onCheckedChange={set("whatsappNotify")} />
                  <p className="text-xs text-slate-500">With notifications on, a guest leaves their name and WhatsApp number before the selfie, and may tick to be told when photos uploaded later match them - one message per batch, no login code. Their selfie&apos;s face is kept only with that tick, until they stop the messages.</p>
                  <WhatsAppMessagesStatus status={settings?.whatsapp} />
                </DashboardCard>
                <DashboardCard title="Buyers' downloads" note="Each order keeps the policy it was sold under." bodyClassName="grid grid-cols-1 gap-3 p-3 sm:grid-cols-2">
                  <TextField label="Downloads per photo bought" inputMode="numeric" value={form.downloadLimit} onChange={(event) => set("downloadLimit")(event.target.value.replace(/\D/g, ""))} error={errors.downloadLimit} />
                  <TextField label="For this many days after payment" inputMode="numeric" value={form.downloadDays} onChange={(event) => set("downloadDays")(event.target.value.replace(/\D/g, ""))} error={errors.downloadDays} />
                </DashboardCard>
              </div>
            </ReadOnlyFieldset>
            <DashboardCard title="QR poster defaults" note="New galleries' posters start with this design and these words; each gallery's Share with guests → QR Template can change them." bodyClassName="p-3">
              {sample
                ? <SaleQrPosterEditor kit={sample} templateId={form.qrTemplateId} words={form.qrWords} readOnly={!canWrite} onChange={({ templateId, words }) => setForm((current) => ({ ...current, qrTemplateId: templateId, qrWords: words }))} onError={setSaveError} />
                : <Loader label="Preparing the preview..." />}
            </DashboardCard>
          </div>}
    </Dialog>
    <ConfirmDialog {...confirmProps} layer="confirmOverDialog" />
  </>;
}
