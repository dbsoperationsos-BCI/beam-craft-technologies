"use client";

import DeleteOutlineRounded from "@mui/icons-material/DeleteOutlineRounded";
import { useEffect, useState } from "react";
import Button from "@/components/shared/Button";
import DashboardCard from "@/components/shared/DashboardCard";
import IconButton from "@/components/shared/IconButton";
import ReadOnlyFieldset from "@/components/shared/ReadOnlyFieldset";
import TextField from "@/components/shared/TextField";
import ToggleSwitch from "@/components/shared/ToggleSwitch";
import useSubmitOnce from "@/components/shared/useSubmitOnce";
import { bpsToPercentText, formatMoney, paiseToRupeesText, percentToBps, rupeesToPaise } from "@/lib/photoSelling.mjs";
import { saveSaleGalleryPackages, updateSaleGallery } from "@/services/photo-selling/photo-selling.service";

/**
 * Step 3 - Prices: the price of a photo and the gallery's packages. What a buyer pays for is the
 * photo's original, downloaded once their payment is verified. The server prices every cart from
 * these rows and freezes the result on the order, so a change here never alters an order already made.
 *
 * A package is "any N photos for ₹X". The buyer never chooses one: checkout applies the cheapest
 * combination by itself, and the cart says what it saved. A package that would save nothing against
 * buying its photos one by one is refused, here and on the server.
 */
const MAX_PACKAGES = 10;
let seed = 0;
const rowKey = () => `pkg-${(seed += 1)}`;
const pricesFrom = (gallery) => ({ price: paiseToRupeesText(gallery.pricePaise), tax: bpsToPercentText(gallery.taxRateBps), inclusive: gallery.pricesIncludeTax });
const packagesFrom = (gallery) => (gallery.packages || []).map((pack) => ({ key: pack.id, id: pack.id, name: pack.name, photoCount: String(pack.photoCount), price: paiseToRupeesText(pack.pricePaise), isActive: pack.isActive }));

export default function GalleryPricingTab({ gallery, galleryId, canWrite, onSaved, showSuccess, showError, onDirtyChange }) {
  const [prices, setPrices] = useState(() => pricesFrom(gallery));
  const [packs, setPacks] = useState(() => packagesFrom(gallery));
  const [errors, setErrors] = useState({});
  const pricesSubmit = useSubmitOnce();
  const packsSubmit = useSubmitOnce();

  const setPrice = (key) => (value) => setPrices((current) => ({ ...current, [key]: value }));
  const pricesDirty = JSON.stringify(prices) !== JSON.stringify(pricesFrom(gallery));
  const packsDirty = JSON.stringify(packs.map(({ key, ...rest }) => rest)) !== JSON.stringify(packagesFrom(gallery).map(({ key, ...rest }) => rest));
  useEffect(() => { onDirtyChange?.(pricesDirty || packsDirty); return () => onDirtyChange?.(false); }, [pricesDirty, packsDirty, onDirtyChange]);
  const unit = rupeesToPaise(prices.price) ?? gallery.pricePaise;

  const savePrices = (event) => {
    event?.preventDefault?.();
    return pricesSubmit.run(async () => {
      const next = {};
      const price = rupeesToPaise(prices.price);
      if (price == null || price < 100) next.price = "Enter a price of at least ₹1.";
      const tax = percentToBps(prices.tax);
      if (tax == null || tax > 5000) next.tax = "Enter a tax rate between 0 and 50%.";
      setErrors(next);
      if (Object.keys(next).length) return;
      try {
        const response = await updateSaleGallery(galleryId, { pricePaise: price, taxRateBps: tax, pricesIncludeTax: prices.inclusive });
        onSaved(response.data);
        showSuccess("Prices saved. Orders already made keep the prices they were made with.");
      } catch (error) {
        showError(error.message || "The prices could not be saved.");
      }
    });
  };

  const setPack = (key, field) => (value) => setPacks((current) => current.map((pack) => (pack.key === key ? { ...pack, [field]: value } : pack)));
  const savePackages = () => packsSubmit.run(async () => {
    const next = {};
    const body = packs.map((pack) => {
      const photoCount = Number(pack.photoCount);
      const pricePaise = rupeesToPaise(pack.price);
      if (!pack.name.trim()) next[`${pack.key}:name`] = "Give the package a name guests will see.";
      if (!Number.isInteger(photoCount) || photoCount < 2 || photoCount > 200) next[`${pack.key}:photoCount`] = "A package holds 2 to 200 photos.";
      if (!gallery.pricePaise) next[`${pack.key}:price`] = "Save the price per photo first.";
      else if (pricePaise == null || pricePaise < 100) next[`${pack.key}:price`] = "At least ₹1.";
      else if (Number.isInteger(photoCount) && pricePaise >= photoCount * gallery.pricePaise) next[`${pack.key}:price`] = `Must be under ${formatMoney(photoCount * gallery.pricePaise)} to save anything.`;
      return { ...(pack.id ? { id: pack.id } : {}), name: pack.name.trim(), photoCount, pricePaise, isActive: pack.isActive };
    });
    setErrors(next);
    if (Object.keys(next).length) return;
    try {
      const response = await saveSaleGalleryPackages(galleryId, body);
      onSaved(response.data);
      showSuccess("Packages saved.");
    } catch (error) {
      showError(error.message || "The packages could not be saved.");
    }
  });

  return <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
    <form onSubmit={savePrices}>
      <DashboardCard title="Prices" bodyClassName="flex flex-col gap-3 p-3">
        <ReadOnlyFieldset canWrite={canWrite}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <TextField label="Price per photo" required prefix="₹" inputMode="decimal" value={prices.price} onChange={(event) => setPrice("price")(event.target.value)} error={errors.price} note="The buyer gets the photo's original file, ready to download once paid. A photo may carry its own price (Photos step)." />
            <TextField label="Tax rate" suffix="%" inputMode="decimal" value={prices.tax} onChange={(event) => setPrice("tax")(event.target.value)} error={errors.tax} />
            {percentToBps(prices.tax) > 0 && <div className="flex items-end pb-2"><ToggleSwitch label="Prices include tax" checked={prices.inclusive} onCheckedChange={setPrice("inclusive")} /></div>}
          </div>
        </ReadOnlyFieldset>
        {canWrite && <div className="flex justify-end gap-2">
          {pricesDirty && <Button type="button" onClick={() => setPrices(pricesFrom(gallery))}>Discard</Button>}
          <Button type="submit" variant="primary" busy={pricesSubmit.busy} busyLabel="Saving..." disabled={!pricesDirty}>Save prices</Button>
        </div>}
      </DashboardCard>
    </form>

    <DashboardCard title="Packages" note="Bundles of photos; the cheapest combination is applied at checkout." bodyClassName="flex flex-col gap-3 p-3">
      {packs.length === 0 && <p className="text-sm text-slate-500">No packages. Every photo is sold at its own price.</p>}
      <ReadOnlyFieldset canWrite={canWrite}>
        <ul className="flex flex-col gap-3">
          {packs.map((pack) => {
            const count = Number(pack.photoCount);
            const value = rupeesToPaise(pack.price);
            const saving = Number.isInteger(count) && value != null ? count * unit - value : null;
            return <li key={pack.key} className="rounded-lg border border-slate-200 p-3">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-start">
                <TextField label="Name" value={pack.name} onChange={(event) => setPack(pack.key, "name")(event.target.value)} maxLength={120} error={errors[`${pack.key}:name`]} placeholder="e.g. Any 10 photos" />
                <TextField label="Photos" inputMode="numeric" value={pack.photoCount} onChange={(event) => setPack(pack.key, "photoCount")(event.target.value.replace(/\D/g, ""))} error={errors[`${pack.key}:photoCount`]} />
                <TextField label="Price" prefix="₹" inputMode="decimal" value={pack.price} onChange={(event) => setPack(pack.key, "price")(event.target.value)} error={errors[`${pack.key}:price`]} />
                {canWrite && <IconButton label={`Remove ${pack.name || "package"}`} onClick={() => setPacks((current) => current.filter((item) => item.key !== pack.key))} className="sm:mt-6"><DeleteOutlineRounded fontSize="small" /></IconButton>}
              </div>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                <ToggleSwitch label="Offered" checked={pack.isActive} onCheckedChange={setPack(pack.key, "isActive")} size="sm" />
                {saving != null && saving > 0 && <span>Saves {formatMoney(saving)} against {count} photos bought singly</span>}
              </div>
            </li>;
          })}
        </ul>
      </ReadOnlyFieldset>
      {canWrite && <div className="flex flex-wrap justify-between gap-2">
        <Button type="button" size="sm" disabled={packs.length >= MAX_PACKAGES} onClick={() => setPacks((current) => [...current, { key: rowKey(), name: "", photoCount: "", price: "", isActive: true }])}>Add package</Button>
        <span className="flex gap-2">
          {packsDirty && <Button type="button" size="sm" onClick={() => { setPacks(packagesFrom(gallery)); setErrors({}); }}>Discard</Button>}
          <Button type="button" size="sm" busy={packsSubmit.busy} busyLabel="Saving..." disabled={!packsDirty} onClick={savePackages}>Save packages</Button>
        </span>
      </div>}
    </DashboardCard>
  </div>;
}
