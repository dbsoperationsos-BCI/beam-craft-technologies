"use client";

import ErrorOutlineRounded from "@mui/icons-material/ErrorOutlineRounded";
import CloudOffOutlined from "@mui/icons-material/CloudOffOutlined";
import VisibilityOffOutlined from "@mui/icons-material/VisibilityOffOutlined";
import StarRounded from "@mui/icons-material/StarRounded";
import HourglassTopRounded from "@mui/icons-material/HourglassTopRounded";
import { useCallback, useEffect, useMemo, useState } from "react";
import Button from "@/components/shared/Button";
import Dropdown from "@/components/shared/Dropdown";
import Lightbox from "@/components/shared/Lightbox";
import SearchField from "@/components/shared/SearchField";
import TextField from "@/components/shared/TextField";
import ToggleSwitch from "@/components/shared/ToggleSwitch";
import { CardState } from "@/components/shared/DashboardCard";
import useSubmitOnce from "@/components/shared/useSubmitOnce";
import Dialog from "@/components/ui/Dialog";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import Tabs from "@/components/ui/Tabs";
import LazyImage from "@/components/ai-feature/shared/LazyImage";
import SelectionTick from "@/components/image-selection/SelectionTick";
import { formatMoney, rupeesToPaise } from "@/lib/photoSelling.mjs";
import { absoluteApiUrl, listSaleGalleryPhotos, reindexSaleGalleryPhotos, removeSaleGalleryPhotos, updateSaleGallery, updateSaleGalleryPhotos } from "@/services/photo-selling/photo-selling.service";
import PhotoSaleUploadArea from "../upload/PhotoSaleUploadArea";

/**
 * Step 2 - Photos: upload straight into the gallery, then choose what is on sale. Hide a photo for
 * now, give one its own price, pick the cover, or take photos out - for one photo or a selection.
 * The grid fills in while an upload is still going.
 *
 * Each photo's original is uploaded and kept privately - it is what a buyer downloads - so a photo
 * without one (uploaded before originals were kept) says so on its tile and is not for sale until it
 * is uploaded again. Every photo has its faces found as it arrives - that is how guests find it,
 * by their selfie; one still being prepared, or one whose faces could not be found, says so on its
 * tile and can be retried. "Watermark preview" shows each tile as guests will
 * see it. Taking out a photo nobody has bought deletes it and its original; one somebody has bought
 * is only taken off sale, so its buyers keep their download.
 */
const SCOPES = [
  { id: "all", label: "All", count: "all" },
  { id: "available", label: "On sale", count: "available" },
  { id: "hidden", label: "Hidden", count: "hidden" },
  { id: "preparing", label: "Preparing", count: "preparing" },
  { id: "issues", label: "Needs attention", count: "issues" },
];
const SORTS = [{ value: "upload", label: "Upload order" }, { value: "captured", label: "Time taken" }, { value: "name", label: "File name" }, { value: "newest", label: "Newest first" }];

export default function GalleryPhotosTab({ gallery, galleryId, canWrite, reload, showSuccess, showError }) {
  const [scope, setScope] = useState("all");
  const [sort, setSort] = useState("upload");
  const [search, setSearch] = useState("");
  const [items, setItems] = useState([]);
  const [meta, setMeta] = useState(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(() => new Set());
  const [watermarked, setWatermarked] = useState(false);
  const [viewing, setViewing] = useState(-1);
  const [pricing, setPricing] = useState(false);
  const [price, setPrice] = useState("");
  const [confirmRemove, setConfirmRemove] = useState(false);
  const { busy, run } = useSubmitOnce();

  const load = useCallback(async (nextPage = 1) => {
    setLoading(true);
    try {
      const response = await listSaleGalleryPhotos(galleryId, { scope, sort, search: search.trim() || undefined, page: nextPage });
      const data = response.data;
      setItems((current) => (nextPage === 1 ? data.items : [...current, ...data.items]));
      setMeta(data);
      setPage(nextPage);
      setError("");
    } catch (caught) {
      setError(caught.message || "Unable to load photos.");
    } finally {
      setLoading(false);
    }
  }, [galleryId, scope, sort, search]);

  useEffect(() => { const timer = setTimeout(() => { setSelected(new Set()); void load(1); }, search ? 250 : 0); return () => clearTimeout(timer); }, [load, search]);
  // While faces are still being found, the counts and badges refresh themselves - unless photos are selected.
  const preparing = meta?.counts?.preparing || 0;
  const scopeCount = meta?.counts?.[scope];
  const picking = selected.size > 0;
  useEffect(() => {
    if (!preparing || picking) return undefined;
    const timer = setInterval(() => void load(1), 10000);
    return () => clearInterval(timer);
  }, [preparing, picking, load]);
  // A scope tab that empties out disappears; whoever was looking at it goes back to All.
  useEffect(() => {
    if (meta && (scope === "preparing" || scope === "issues") && !(scopeCount > 0)) { const timer = setTimeout(() => setScope("all"), 0); return () => clearTimeout(timer); }
    return undefined;
  }, [meta, scope, scopeCount]);
  // Photos landing from an upload: the grid and the gallery's counts catch up as they arrive.
  const landed = useCallback(() => { void load(1); reload(); }, [load, reload]);

  const chosen = useMemo(() => items.filter((item) => selected.has(item.id)), [items, selected]);
  const ids = chosen.map((item) => item.id);
  const toggle = (id) => setSelected((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const allShown = items.length > 0 && items.every((item) => selected.has(item.id));
  const tileUrl = (item) => (watermarked && item.watermarkedThumbnailUrl ? absoluteApiUrl(item.watermarkedThumbnailUrl) : item.thumbnailUrl);
  const viewed = viewing >= 0 ? items[viewing] : null;
  const priceOf = (item) => item.pricePaise ?? gallery.pricePaise;
  const originals = gallery.server?.originals;

  const act = (work, message) => run(async () => {
    try {
      const result = await work();
      showSuccess(typeof message === "function" ? message(result?.data) : message);
      setSelected(new Set());
      await load(1);
      reload();
    } catch (caught) {
      showError(caught.message || "That did not work.");
    }
  });

  const savePrice = (event) => {
    event?.preventDefault?.();
    const value = price.trim() === "" ? null : rupeesToPaise(price);
    if (price.trim() !== "" && (value == null || value < 100)) { showError("Enter a price of at least ₹1, or leave it empty to use the gallery's price."); return undefined; }
    return act(() => updateSaleGalleryPhotos(galleryId, { photoIds: ids, pricePaise: value }), value == null ? "Photos now use the gallery's price." : `Price set to ${formatMoney(value)}.`).then(() => { setPricing(false); setPrice(""); });
  };

  const counts = meta?.counts || {};
  const empty = meta && counts.all === 0;
  return <div className="flex flex-col gap-4">
    {canWrite && (originals && !originals.ready
      ? <p role="alert" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">Photos can&apos;t be uploaded yet: cloud storage isn&apos;t set up on the server. Ask your administrator. <span className="text-amber-800">({originals.reason})</span></p>
      : <PhotoSaleUploadArea galleryId={galleryId} galleryTitle={gallery.title} onLanded={landed} compact={!empty} />)}
    {!canWrite && empty && <p className="py-10 text-center text-sm text-slate-500">No photos have been uploaded yet.</p>}

    {!empty && <>
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <Tabs tabs={SCOPES.filter((item) => !["issues", "preparing"].includes(item.id) || counts[item.count] > 0).map((item) => ({ id: item.id, label: `${item.label}${counts[item.count] != null ? ` (${counts[item.count]})` : ""}` }))} value={scope} onChange={setScope} ariaLabel="Which photos" size="sm" />
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <SearchField value={search} onChange={setSearch} ariaLabel="Search photos by file name" placeholder="Search file name" className="w-full sm:w-56" preventSubmit />
          <Dropdown ariaLabel="Sort photos" options={SORTS} value={sort} onChange={setSort} sorted={false} searchable={false} className="w-full sm:w-40" />
          <ToggleSwitch label="Watermark preview" checked={watermarked} onCheckedChange={setWatermarked} />
        </div>
      </div>

      {(counts.preparing > 0 || counts.issues > 0) && <div className="flex flex-col gap-2 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-sm text-blue-900 sm:flex-row sm:items-center sm:justify-between" role="status">
        <span className="flex flex-col gap-0.5">
          {counts.preparing > 0 && <span>Finding faces in {`${counts.preparing} photo${counts.preparing === 1 ? "" : "s"}`}  - guests can find a photo by selfie once it&apos;s ready. This updates by itself.</span>}
          {counts.issues > 0 && <span>Faces couldn&apos;t be found in {`${counts.issues} photo${counts.issues === 1 ? "" : "s"}`}, so guests can&apos;t find {counts.issues === 1 ? "it" : "them"}.</span>}
        </span>
        {canWrite && counts.issues > 0 && <Button type="button" size="sm" busy={busy} onClick={() => act(() => reindexSaleGalleryPhotos(galleryId), (data) => (data?.queued ? `Trying again for ${data.queued} photo${data.queued === 1 ? "" : "s"}.` : "Nothing to retry - every photo is ready or already queued."))}>Retry failed photos</Button>}
      </div>}

      {canWrite && <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
        <Button type="button" size="sm" onClick={() => setSelected(allShown ? new Set() : new Set(items.map((item) => item.id)))} disabled={!items.length}>{allShown ? "Clear selection" : "Select shown"}</Button>
        <span className="text-slate-600">{selected.size ? `${selected.size} selected` : "Select photos to change them together."}</span>
        {selected.size > 0 && <span className="flex flex-wrap gap-2 sm:ml-auto">
          <Button type="button" size="sm" busy={busy} onClick={() => act(() => updateSaleGalleryPhotos(galleryId, { photoIds: ids, available: false }), "Hidden from the store.")}>Hide</Button>
          <Button type="button" size="sm" busy={busy} onClick={() => act(() => updateSaleGalleryPhotos(galleryId, { photoIds: ids, available: true }), "On sale.")}>Show</Button>
          <Button type="button" size="sm" onClick={() => setPricing(true)}>Set price</Button>
          {ids.length === 1 && <Button type="button" size="sm" busy={busy} onClick={() => act(() => updateSaleGallery(galleryId, { coverPhotoId: ids[0] }), "Cover photo set.")}>Use as cover</Button>}
          <Button type="button" size="sm" variant="danger" onClick={() => setConfirmRemove(true)}>Remove</Button>
        </span>}
      </div>}

      {error && !items.length
        ? <CardState error={error} onRetry={() => load(1)} />
        : !loading && !items.length
          ? <p className="py-10 text-center text-sm text-slate-500">{search ? "No photos match." : scope === "hidden" ? "No hidden photos." : "No photos here."}</p>
          : <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 2xl:grid-cols-8" aria-busy={loading}>
            {items.map((item, index) => {
              const isSelected = selected.has(item.id);
              return <li key={item.id} className={`group relative overflow-hidden rounded-lg border bg-slate-100 ${isSelected ? "border-blue-500 ring-2 ring-blue-500" : "border-slate-200"}`}>
                <Button type="button" variant="ghost" size="none" ariaLabel={`View ${item.fileName}`} className="block aspect-square w-full overflow-hidden rounded-none p-0" onClick={() => setViewing(index)}><LazyImage src={tileUrl(item)} alt="" className="h-full w-full cursor-zoom-in object-cover" /></Button>
                {canWrite && <SelectionTick selected={isSelected} onClick={() => toggle(item.id)} label={`${isSelected ? "Deselect" : "Select"} ${item.fileName}`} size="md" className="absolute left-1.5 top-1.5" />}
                <div className="absolute right-1.5 top-1.5 flex gap-1">
                  {gallery.coverPhotoId === item.id && <span role="img" aria-label="Cover photo" title="Cover photo" className="grid h-6 w-6 place-items-center rounded-full bg-amber-500 text-white"><StarRounded style={{ fontSize: 14 }} /></span>}
                  {!item.available && <span role="img" aria-label="Hidden from the store" title="Hidden from the store" className="grid h-6 w-6 place-items-center rounded-full bg-slate-900/70 text-white"><VisibilityOffOutlined style={{ fontSize: 14 }} /></span>}
                  {!item.hasOriginal && <span role="img" aria-label="No original stored - not for sale" title="No original is stored for this photo, so it isn't for sale. Upload it again to sell it." className="grid h-6 w-6 place-items-center rounded-full bg-amber-600 text-white"><CloudOffOutlined style={{ fontSize: 14 }} /></span>}
                  {["QUEUED", "PROCESSING"].includes(item.faceStatus) && <span role="img" aria-label="Preparing for selfie search" title="Preparing for selfie search" className="grid h-6 w-6 place-items-center rounded-full bg-blue-600 text-white"><HourglassTopRounded style={{ fontSize: 14 }} /></span>}
                  {item.faceStatus === "FAILED" && <span role="img" aria-label="Faces could not be found - it won't appear in selfie searches" title={item.faceError || "Faces could not be found in this photo, so it won't appear in selfie searches."} className="grid h-6 w-6 place-items-center rounded-full bg-red-600 text-white"><ErrorOutlineRounded style={{ fontSize: 14 }} /></span>}
                </div>
                <div className="flex items-center justify-between gap-1 border-t border-slate-200 bg-white px-2 py-1 text-[11px]">
                  <span className={item.available && item.hasOriginal ? "font-medium text-green-700" : "text-slate-500"}>{!item.available ? "Hidden" : item.hasOriginal ? "On sale" : "No original"}</span>
                  <span className="tabular-nums text-slate-700">{priceOf(item) ? formatMoney(priceOf(item), gallery.currency) : "No price"}{item.pricePaise != null && <span className="ml-1 rounded bg-blue-50 px-1 text-[10px] font-medium text-blue-700">Own price</span>}</span>
                </div>
              </li>;
            })}
          </ul>}

      {meta && items.length < meta.total && <div className="flex justify-center"><Button type="button" size="sm" busy={loading} busyLabel="Loading..." onClick={() => load(page + 1)}>Show more ({meta.total - items.length} left)</Button></div>}
    </>}

    {viewed && <Lightbox
      src={watermarked && viewed.watermarkedPreviewUrl ? absoluteApiUrl(viewed.watermarkedPreviewUrl) : viewed.thumbnailUrl}
      alt={viewed.fileName} title={viewed.fileName}
      subtitle={[watermarked && viewed.available ? "As guests see it" : "Without the watermark - staff only", !viewed.available ? "Hidden from the store" : null, !viewed.hasOriginal ? "No original stored - upload it again to sell it" : null, viewed.faceStatus === "FAILED" ? "Faces could not be found - it won't appear in selfie searches" : null, viewed.relativePath && viewed.relativePath !== viewed.fileName ? viewed.relativePath : null].filter(Boolean).join(" · ")}
      onClose={() => setViewing(-1)} hasPrev={viewing > 0} hasNext={viewing < items.length - 1}
      onPrev={() => setViewing((value) => Math.max(0, value - 1))} onNext={() => setViewing((value) => Math.min(items.length - 1, value + 1))} />}

    {pricing && <Dialog title={`Price for ${ids.length} photo${ids.length === 1 ? "" : "s"}`} description={gallery.pricePaise ? `The gallery's price is ${formatMoney(gallery.pricePaise, gallery.currency)}. Leave empty to use it.` : "Leave empty to use the gallery's price, which you set in the next step."} onClose={() => setPricing(false)} onSubmit={savePrice} busy={busy}
      footer={<><Button type="button" onClick={() => setPricing(false)}>Cancel</Button><Button type="submit" variant="primary" busy={busy} busyLabel="Saving...">Save price</Button></>}>
      <TextField label="Price per photo" prefix="₹" inputMode="decimal" value={price} onChange={(event) => setPrice(event.target.value)} autoFocus />
    </Dialog>}
    {confirmRemove && <ConfirmDialog title={`Remove ${ids.length} photo${ids.length === 1 ? "" : "s"}?`} message="They leave the gallery and any guest's cart, and their stored files - the original included - are deleted. A photo somebody has already bought is only taken off sale, so its buyer keeps the download. The files on your own computer are not touched." confirmLabel="Remove" busyLabel="Removing..." loading={busy}
      onCancel={() => setConfirmRemove(false)}
      onConfirm={() => act(() => removeSaleGalleryPhotos(galleryId, ids), (data) => (data?.keptForBuyers ? `${data.removed} removed; ${data.keptForBuyers} kept for the buyers who paid for them.` : "Removed.")).then(() => setConfirmRemove(false))} />}
  </div>;
}
