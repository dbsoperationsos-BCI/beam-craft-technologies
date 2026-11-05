"use client";

import Tabs from "@/components/ui/Tabs";
import { formatShortDate } from "@/lib/signatureAlbum.mjs";
import { StatusChip } from "./PublishPanel";

// Two sections. Sharing is not one of them: the rail's Review & Share holds the link, PIN,
// expiry and every way the album leaves, and a Share tab beside it said the same thing twice.
const SECTIONS = [{ id: "album", label: "Album" }, { id: "design", label: "Design" }];

/** The album's header: name, status, the photo count and the two sections. The album is not deleted from here. */
export default function AlbumToolbar({ album, section, onSectionChange }) {
  return <div className="mb-4">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2"><h2 className="text-base font-semibold text-slate-900">Signature Album</h2><StatusChip status={album.status} /></div>
        <p className="mt-0.5 text-[11px] text-slate-500">Photos: {album.counts.photoCount}{album.status === "PUBLISHED" && album.publishedAt ? ` · Published: ${formatShortDate(album.publishedAt)}` : ""}</p>
      </div>
    </div>
    <Tabs tabs={SECTIONS} value={section} onChange={onSectionChange} size="sm" ariaLabel="Signature Album sections" className="mt-2 border-b border-slate-200" />
  </div>;
}
