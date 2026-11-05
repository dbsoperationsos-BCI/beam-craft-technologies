"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useRouteAccess } from "@/components/auth/PermissionsProvider";
import Button from "@/components/shared/Button";
import SearchField from "@/components/shared/SearchField";
import { CardState } from "@/components/shared/DashboardCard";
import FloatingNotice, { useNotice } from "@/components/shared/FloatingNotice";
import OptionsMenu from "@/components/ui/OptionsMenu";
import Tabs from "@/components/ui/Tabs";
import EmptyState from "@/components/ai-feature/shared/EmptyState";
import EventCover from "@/components/ai-feature/shared/EventCover";
import { formatMoney, galleryStatus } from "@/lib/photoSelling.mjs";
import { archiveSaleGallery, deleteSaleGallery, duplicateSaleGallery, listSaleGalleries, restoreSaleGallery } from "@/services/photo-selling/photo-selling.service";
import PhotoSellingNavigation, { PHOTO_SELLING_ROOT } from "../PhotoSellingNavigation";
import PhotoSellingSettingsDialog from "../settings/PhotoSellingSettingsDialog";
import SaleStatusChip from "../shared/SaleStatusChip";
import CreateGalleryDialog from "./CreateGalleryDialog";
import GalleryActionDialog from "./GalleryActionDialog";

/**
 * Photo Selling → Galleries: every gallery, as a card with its cover, its state and what it has sold.
 * A card opens the gallery; Drafts lists the ones still being set up, and archived ones sit on a tab
 * of their own.
 * `?create=1` opens New Gallery straight away (the overview's button lands here).
 *
 * Settings is maintenance, not one of the day's actions, so it sits behind the ⋮ beside New Gallery
 * and opens over this page (as Accounts keeps its settings). `?photoSettings=1` opens it - where the old
 * Settings address now lands. Shown to anyone who may see Photo Selling: read-only at Read.
 */
const VIEWS = [{ id: "active", label: "All" }, { id: "drafts", label: "Drafts" }, { id: "archived", label: "Archived" }];
const shortDate = (value) => (value ? new Date(value).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "");

/** The AI Feature's own loading card (ai-feature/events/AiEventsPage.js), so the grid does not jump when cards arrive. */
function CardSkeleton() {
  return <div aria-hidden="true" className="animate-pulse overflow-hidden rounded-lg border border-slate-200 bg-white">
    <div className="aspect-video bg-slate-100" />
    <div className="space-y-2 p-3"><div className="h-4 w-2/3 rounded bg-slate-100" /><div className="h-3 w-1/2 rounded bg-slate-100" /><div className="h-3 w-3/4 rounded bg-slate-100" /></div>
  </div>;
}

/** Laid out as the AI Feature's event card (ai-feature/events/EventCard.js): cover, name, when and where, status, one line of figures. */
function GalleryCard({ gallery, href, menuItems }) {
  const status = galleryStatus(gallery);
  return <article className="flex min-w-0 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm transition hover:border-blue-300 hover:shadow-md">
    <Link href={href} className="block outline-none focus-visible:ring-2 focus-visible:ring-blue-500" aria-label={`Open ${gallery.title}`}>
      <EventCover src={gallery.coverUrl} name={gallery.title} className="aspect-video w-full" />
    </Link>
    <div className="flex min-w-0 flex-1 flex-col p-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <Link href={href} className="block truncate text-sm font-semibold text-slate-800 outline-none hover:text-blue-700 focus-visible:underline">{gallery.title}</Link>
          <p className="mt-0.5 truncate text-xs text-slate-500">{[shortDate(gallery.eventDate), gallery.venue].filter(Boolean).join(" · ") || "No date or venue yet"}</p>
        </div>
        {menuItems?.length > 0 && <OptionsMenu ariaLabel={`Actions for ${gallery.title}`} items={menuItems} />}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
        <SaleStatusChip tone={status.tone}>{status.label}</SaleStatusChip>
      </div>
      <p className="mt-2 text-[11px] text-slate-500">{gallery.photoCount} {gallery.photoCount === 1 ? "photo" : "photos"} · {gallery.paidOrders} paid {gallery.paidOrders === 1 ? "order" : "orders"} · {formatMoney(gallery.grossPaise, gallery.currency)} sales</p>
    </div>
  </article>;
}

export default function GalleriesPage() {
  const router = useRouter();
  const params = useSearchParams();
  const { canWrite } = useRouteAccess();
  const { notice, showSuccess, clearNotice } = useNotice();
  const [view, setView] = useState("active");
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState(null);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(() => params.get("create") === "1");
  const [settingsOpen, setSettingsOpen] = useState(() => params.get("photoSettings") === "1");

  const load = useCallback(async () => {
    try {
      const response = await listSaleGalleries({ view, search: search.trim() || undefined });
      setRows(response.data || []);
      setError("");
    } catch (caught) {
      setError(caught.message || "Unable to load galleries.");
    }
  }, [view, search]);

  useEffect(() => { const timer = setTimeout(() => void load(), search ? 250 : 0); return () => clearTimeout(timer); }, [load, search]);

  const galleryHref = (id) => `${PHOTO_SELLING_ROOT}/galleries/${encodeURIComponent(id)}`;
  const [action, setAction] = useState(null);

  /**
   * The card's ⋮, as on an AI Feature event card: Open Gallery for anyone who may see it; Edit (the
   * gallery's Details step), Duplicate, Archive / Restore and Delete - on every gallery, live and
   * sold ones too - for Read / Write. Each asks first (GalleryActionDialog), saying what a delete
   * of this gallery keeps; the server's guard still decides.
   */
  function menuFor(gallery) {
    const open = { label: "Open Gallery", onSelect: () => router.push(galleryHref(gallery.id)) };
    if (!canWrite) return [open];
    const archived = Boolean(gallery.archivedAt);
    return [
      open,
      ...(archived ? [] : [{ label: "Edit", onSelect: () => router.push(`${galleryHref(gallery.id)}?step=details`) }]),
      { label: "Duplicate", onSelect: () => setAction({ mode: "duplicate", gallery }) },
      archived
        ? { label: "Restore", onSelect: () => setAction({ mode: "restore", gallery }) }
        : { label: "Archive", onSelect: () => setAction({ mode: "archive", gallery }) },
      { separator: true },
      { label: "Delete", tone: "danger", onSelect: () => setAction({ mode: "delete", gallery }) },
    ];
  }

  async function runAction(payload) {
    const { mode, gallery } = action;
    if (mode === "delete") { const response = await deleteSaleGallery(gallery.id); showSuccess(response?.data?.filesRemaining ? `${gallery.title} deleted. ${response.data.filesRemaining} stored file${response.data.filesRemaining === 1 ? " is" : "s are"} still being removed from cloud storage.` : `${gallery.title} deleted.`); }
    else if (mode === "archive") { await archiveSaleGallery(gallery.id); showSuccess(`${gallery.title} archived.`); }
    else if (mode === "restore") { await restoreSaleGallery(gallery.id); showSuccess(`${gallery.title} restored. It is unpublished until you publish it again.`); }
    else if (mode === "duplicate") {
      const response = await duplicateSaleGallery(gallery.id, payload);
      showSuccess(`${response?.data?.title || "The copy"} created as a draft.`);
    }
    void load();
  }

  const closeCreate = () => { setCreating(false); if (params.get("create")) router.replace(`${PHOTO_SELLING_ROOT}/galleries`); };
  const closeSettings = () => { setSettingsOpen(false); if (params.get("photoSettings")) router.replace(`${PHOTO_SELLING_ROOT}/galleries`); };

  return <section className="flex min-h-0 flex-1 flex-col bg-white">
    <PhotoSellingNavigation actions={<>
      {canWrite && <Button type="button" variant="primary" size="sm" onClick={() => setCreating(true)}>+ New Gallery</Button>}
      <OptionsMenu ariaLabel="More Photo Selling actions" menuClassName="w-40" items={[{ label: "Settings", onSelect: () => setSettingsOpen(true) }]} />
    </>} />
    <FloatingNotice notice={notice} onClose={clearNotice} />
    <div className="flex flex-col gap-2 border-b border-slate-200 px-3 py-2 sm:flex-row sm:items-center sm:justify-between sm:px-4">
      <Tabs tabs={VIEWS} value={view} onChange={setView} ariaLabel="Projects" size="sm" />
      <SearchField value={search} onChange={setSearch} ariaLabel="Search galleries" placeholder="Search by name, venue or code" className="w-full sm:w-72" preventSubmit />
    </div>
    <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 sm:px-4">
      {error && !rows
        ? <CardState error={error} onRetry={load} />
        : !rows
          ? <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3" aria-busy="true">{Array.from({ length: 6 }, (_, index) => <CardSkeleton key={index} />)}</div>
          : rows.length === 0
            ? <EmptyState
              title={search ? "No galleries match." : view === "archived" ? "Nothing archived." : view === "drafts" ? "No drafts." : "No galleries yet."}
              message={search ? "Try another name, venue or code." : view === "archived" ? "Archived galleries are kept here with their orders." : view === "drafts" ? "A gallery stays here until it is published." : canWrite ? "Create a gallery, upload its photos, set the prices and publish - guests buy straight from the link." : "Projects appear here once somebody creates one."}
              action={!search && view !== "archived" && canWrite && <Button type="button" variant="primary" size="sm" onClick={() => setCreating(true)}>+ New Gallery</Button>} />
            : <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {rows.map((gallery) => <GalleryCard key={gallery.id} gallery={gallery} href={galleryHref(gallery.id)} menuItems={menuFor(gallery)} />)}
            </div>}
    </div>
    {settingsOpen && <PhotoSellingSettingsDialog onClose={closeSettings} onSaved={(message) => { closeSettings(); showSuccess(message); }} />}
    {action && canWrite && <GalleryActionDialog mode={action.mode} gallery={action.gallery} onClose={() => setAction(null)} onConfirm={runAction} />}
    {creating && canWrite && <CreateGalleryDialog onClose={closeCreate} onCreated={(gallery) => { showSuccess("Draft saved. Now add its photos."); router.push(`${galleryHref(gallery.id)}?step=photos`); }} />}
  </section>;
}
