"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import ModulePageHeader from "@/components/layout/ModulePageHeader";
import OptionsMenu from "@/components/ui/OptionsMenu";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { deleteMessage } from "@/components/photo-selling/galleries/GalleryActionDialog";
import Button from "@/components/shared/Button";
import FloatingNotice, { useNotice } from "@/components/shared/FloatingNotice";
import { PageLoader } from "@/components/shared/Loader";
import useStickyTab from "@/components/shared/useStickyTab";
import useUnsavedGuard from "@/components/shared/useUnsavedGuard";
import { useRouteAccess } from "@/components/auth/PermissionsProvider";
import EmptyState from "@/components/ai-feature/shared/EmptyState";
import { galleryStatus } from "@/lib/photoSelling.mjs";
import { archiveSaleGallery, deleteSaleGallery, getSaleGallery, publishSaleGallery, restoreSaleGallery, unpublishSaleGallery } from "@/services/photo-selling/photo-selling.service";
import { PHOTO_SELLING_ROOT } from "../PhotoSellingNavigation";
import SaleStatusChip from "../shared/SaleStatusChip";
import GallerySettingsTab from "./GallerySettingsTab";
import GalleryPhotosTab from "./GalleryPhotosTab";
import GalleryPricingTab from "./GalleryPricingTab";
import GalleryShareDialog from "./GalleryShareDialog";
import OrdersTable from "../orders/OrdersTable";

/**
 * One gallery, set up in three steps - Details, Photos, Prices - then sold (Orders). Every step
 * saves as it goes, so a gallery left half done is simply a draft to come back to; `?step=` opens a
 * step directly (a new gallery lands on Photos).
 *
 * Publishing is not a step. The server refuses it until there are photos on sale, ready for selfie
 * search, a price and a watermark; until then the banner above every step says which is missing and
 * leads to the step that fixes it, and once nothing blocks it the header's Publish button appears
 * (Prices ends with one too). Share is not a step either: as on an AI Feature event, the header's
 * Share button opens "Share with guests" over whichever step is open (GalleryShareDialog), with its
 * QR Template for the poster; publishing opens it. Older links: `?step=share` and `?step=qr` open
 * Share with guests; `?step=preview` is ignored - the gallery opens on its last-used step.
 *
 * IMAGE_SELECTION / Photo Selling governs the route: READ sees everything here, and only READ_WRITE
 * is offered a control that changes anything. Every step takes `canWrite` itself.
 */
const STEPS = [
  { id: "details", label: "1 · Details" },
  { id: "photos", label: "2 · Photos" },
  { id: "pricing", label: "3 · Prices" },
  { id: "orders", label: "Orders" },
];
const NEXT = { details: "photos", photos: "pricing" };
// Which setup steps are done, from what the gallery already holds - shown as a tick on the step.
const DONE = { details: (g) => Boolean(g.watermark), photos: (g) => g.availableCount > 0, pricing: (g) => g.pricePaise > 0 };
const STEP_NAMES = { details: "Details", photos: "Photos", pricing: "Prices", orders: "Orders" };
const stepName = (id) => STEP_NAMES[id] || "";

export default function GalleryWorkspacePage({ galleryId }) {
  const router = useRouter();
  const params = useSearchParams();
  const { canWrite, loading: accessLoading } = useRouteAccess();
  const { notice, showSuccess, showError, clearNotice } = useNotice();
  const [gallery, setGallery] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [confirm, setConfirm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [sharing, setSharing] = useState(() => ["share", "qr"].includes(params.get("step")));
  const stepIds = useMemo(() => STEPS.map((step) => step.id), []);
  const asked = stepIds.includes(params.get("step")) ? params.get("step") : "details";
  const [tab, setTab] = useStickyTab(`photo-sale-gallery.${galleryId}`, asked, stepIds);
  // A link that names a step (a card's Edit, a new gallery's Photos) opens it, over the remembered one.
  const linkedStep = useRef(stepIds.includes(params.get("step")) ? params.get("step") : null);
  useEffect(() => { if (linkedStep.current) { setTab(linkedStep.current); linkedStep.current = null; } }, [setTab]);
  // The Details and Prices steps say here whether they hold an unsaved edit; leaving asks first.
  const dirtyRef = useRef(false);
  const onDirtyChange = useCallback((dirty) => { dirtyRef.current = dirty; }, []);
  const { guard, confirmProps } = useUnsavedGuard(() => dirtyRef.current);
  const goTo = (next) => guard(() => { dirtyRef.current = false; setTab(next); });

  const load = useCallback(async () => {
    try {
      const response = await getSaleGallery(galleryId);
      setGallery(response.data);
      setLoadError("");
    } catch (cause) {
      setLoadError(cause.message || "Unable to load this gallery.");
    }
  }, [galleryId]);

  useEffect(() => { const timer = window.setTimeout(() => { load(); }, 0); return () => window.clearTimeout(timer); }, [load]);

  async function runAction(action, success, after) {
    setBusy(true);
    try {
      const response = await action();
      if (response?.data?.id) setGallery(response.data);
      showSuccess(typeof success === "function" ? success(response?.data) : success);
      setConfirm(null);
      after?.();
    } catch (cause) {
      showError(cause.message || "That did not work.");
      setConfirm(null);
    } finally {
      setBusy(false);
    }
  }

  const archived = Boolean(gallery?.archivedAt);
  const published = gallery?.status === "PUBLISHED";
  const status = galleryStatus(gallery);
  const blocking = gallery?.checklist?.blocking || [];
  const advice = gallery?.checklist?.advice || [];
  const menuItems = canWrite && gallery ? [
    ...(published && !archived ? [{ label: "Unpublish", onSelect: () => setConfirm("unpublish") }] : []),
    archived
      ? { label: "Restore gallery", onSelect: () => runAction(() => restoreSaleGallery(galleryId), "Gallery restored. It is unpublished until you publish it again.") }
      : { label: "Archive gallery", onSelect: () => setConfirm("archive") },
    { separator: true },
    { label: "Delete gallery", tone: "danger", onSelect: () => setConfirm("delete") },
  ] : [];

  const stepProps = { gallery, galleryId, canWrite: canWrite && !archived, reload: load, onSaved: setGallery, showSuccess, showError, onDirtyChange };
  const ready = blocking.length === 0;
  // One main action at a time: Continue leads until the gallery is ready, then Publish does.
  const continueTo = (step, note = null) => NEXT[step] && <div className="flex flex-col items-end gap-1">
    <Button type="button" variant={ready && !published ? "secondary" : "primary"} onClick={() => goTo(NEXT[step])}>Continue to {stepName(NEXT[step])}</Button>
    {note && <span className="text-xs text-slate-500">{note}</span>}
  </div>;
  const steps = gallery ? STEPS.map((step) => (DONE[step.id]?.(gallery) ? { ...step, label: `${step.label} ✓` } : step)) : STEPS;

  return <section className="flex min-h-0 flex-1 flex-col bg-white">
    <ModulePageHeader
      onBack={() => guard(() => router.push(`${PHOTO_SELLING_ROOT}/galleries`))}
      title={gallery?.title || "Gallery"}
      titleAccessory={gallery && <SaleStatusChip tone={status.tone}>{status.label}</SaleStatusChip>}
      tabs={steps}
      tabValue={tab}
      onTabChange={goTo}
      tabsAriaLabel="Gallery steps"
      actions={gallery && <>
        {canWrite && !archived && !published && ready && <Button type="button" variant="primary" size="sm" disabled={busy} onClick={() => setConfirm("publish")}>Publish</Button>}
        {!archived && <Button type="button" variant={published ? "primary" : "secondary"} size="sm" onClick={() => setSharing(true)}>Share</Button>}
      </>}
      // The ⋮ in the header's own slot, so the row ends Nebula, then ⋮.
      menu={gallery && menuItems.length > 0 ? <OptionsMenu ariaLabel="Gallery options" triggerVariant="button" items={menuItems} /> : undefined}
    />
    <FloatingNotice notice={notice} onClose={clearNotice} />
    <div className="min-h-0 flex-1 overflow-y-auto">
      {(!gallery && !loadError) || accessLoading
        ? <PageLoader label="Loading gallery..." />
        : loadError
          ? <EmptyState title="This gallery could not be opened." message={loadError} action={<Button type="button" size="sm" onClick={load}>Try again</Button>} />
          : <div className="flex flex-col gap-3 px-3 py-3 sm:px-4">
            {archived && <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">This gallery is archived: closed to guests and read-only. Paid orders stay downloadable from the buyers&apos; order links.</p>}
            {!archived && !published && blocking.length > 0 && <div className="flex flex-col gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 sm:flex-row sm:items-center sm:justify-between" role="status">
              <span>Before you can publish: {blocking.map((item) => item.message.replace(/\.$/, "")).join(" · ")}.</span>
              {blocking[0].step !== tab && <Button type="button" size="sm" onClick={() => goTo(blocking[0].step)}>Go to {stepName(blocking[0].step)}</Button>}
            </div>}
            {!archived && advice.length > 0 && tab === "details" && <ul className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
              {advice.map((item) => <li key={item.code} className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <span>{item.message}</span>
                {canWrite && item.step && item.step !== tab && <Button type="button" size="sm" onClick={() => goTo(item.step)}>{item.code === "FAINT_WATERMARK" ? "Change watermark" : `Go to ${stepName(item.step)}`}</Button>}
              </li>)}
            </ul>}
            {tab === "details" && <><GallerySettingsTab key={gallery.updatedAt} {...stepProps} />{continueTo("details")}</>}
            {tab === "photos" && <><GalleryPhotosTab {...stepProps} />{gallery.photoCount > 0 && continueTo("photos", "Any upload still going carries on while you set prices.")}</>}
            {tab === "pricing" && <><GalleryPricingTab key={gallery.updatedAt} {...stepProps} />
              {canWrite && !archived && !published && ready && <div className="flex justify-end"><Button type="button" variant="primary" disabled={busy} onClick={() => setConfirm("publish")}>Publish</Button></div>}</>}
            {tab === "orders" && <OrdersTable galleryId={galleryId} compact />}
          </div>}
    </div>
    {sharing && gallery && !archived && <GalleryShareDialog gallery={gallery} galleryId={galleryId} canWrite={canWrite && !archived} onSaved={setGallery} onNotify={showSuccess} onClose={() => setSharing(false)} />}
    <ConfirmDialog {...confirmProps} />
    {confirm === "publish" && <ConfirmDialog
      title="Publish this gallery?"
      message={`Anyone with the link${gallery?.requirePin ? " and the PIN" : ""} can see its watermarked photos and buy them. You can unpublish it at any time.`}
      confirmLabel="Publish" busyLabel="Publishing..." tone="primary" loading={busy}
      onCancel={() => setConfirm(null)}
      onConfirm={() => runAction(() => publishSaleGallery(galleryId), "Published. Share its link or QR code with your guests.", () => setSharing(true))} />}
    {confirm === "unpublish" && <ConfirmDialog
      title="Unpublish this gallery?"
      message="Guests can no longer open it or buy from it. Orders already paid stay downloadable. You can publish it again later."
      confirmLabel="Unpublish" busyLabel="Unpublishing..." loading={busy}
      onCancel={() => setConfirm(null)}
      onConfirm={() => runAction(() => unpublishSaleGallery(galleryId), "Gallery unpublished.")} />}
    {confirm === "archive" && <ConfirmDialog
      title="Archive this gallery?"
      message="It closes to guests at once and becomes read-only. Its orders are kept, and buyers can still download what they paid for. You can restore it later."
      confirmLabel="Archive" busyLabel="Archiving..." loading={busy}
      onCancel={() => setConfirm(null)}
      onConfirm={() => runAction(() => archiveSaleGallery(galleryId), "Gallery archived.")} />}
    {confirm === "delete" && <ConfirmDialog
      title="Delete this gallery?"
      message={deleteMessage(gallery)}
      confirmLabel="Delete gallery" busyLabel="Deleting..." loading={busy}
      onCancel={() => setConfirm(null)}
      onConfirm={() => runAction(() => deleteSaleGallery(galleryId), (data) => (data?.filesRemaining ? `Gallery deleted. ${data.filesRemaining} stored file${data.filesRemaining === 1 ? " is" : "s are"} still being removed from cloud storage and will be retried automatically.` : "Gallery deleted, with all of its stored files."), () => router.push(`${PHOTO_SELLING_ROOT}/galleries`))} />}
  </section>;
}
