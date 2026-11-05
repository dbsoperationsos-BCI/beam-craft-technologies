"use client";

import { useState } from "react";
import ContentCopy from "@mui/icons-material/ContentCopy";
import OpenInNew from "@mui/icons-material/OpenInNew";
import Refresh from "@mui/icons-material/Refresh";
import Button from "@/components/shared/Button";
import DateField from "@/components/shared/DateField";
import HelpTip from "@/components/shared/HelpTip";
import ReadOnlyFieldset from "@/components/shared/ReadOnlyFieldset";
import ToggleSwitch from "@/components/shared/ToggleSwitch";
import Dialog from "@/components/ui/Dialog";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { copyToClipboard } from "@/lib/clipboard";
import { toDateInput, formatShortDate } from "@/lib/signatureAlbum.mjs";
import AlbumPreview from "./AlbumPreview";
import ClientPermissions from "./ClientPermissions";
import ReviewShareDialog from "./ReviewShareDialog";

/**
 * The album's rail, in the shape of the Selection Settings rail beside it: ALBUM, CLIENT ACCESS,
 * PERMISSIONS, and Preview Album / Review & Share at the foot. Every value here is the album's own -
 * none of it is the project's publish status, PIN or expiry, which stay in the Photo Selection rail
 * and are not touched from here. The album's status is not repeated here: the workspace header
 * shows it beside the album's last write while this tab is open.
 */
function Section({ title, children, last = false }) {
  return <section className={`shrink-0 py-3 ${last ? "" : "border-b border-slate-200"}`}><p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-700">{title}</p>{children}</section>;
}
function CopyField({ label, value, placeholder, mono = false, onCopy, actions }) {
  return <>
    <label className="mt-2 block text-[10px] font-bold text-slate-700">{label}</label>
    <div className="mt-1 flex h-8 items-center rounded-md border border-slate-300 px-2">
      <input readOnly disabled={!value} value={value || ""} placeholder={placeholder} className={`min-w-0 flex-1 bg-transparent text-[10px] outline-none disabled:cursor-restricted ${mono ? "font-mono" : "text-blue-600"}`} />
      <button type="button" disabled={!value} onClick={() => onCopy(value, label)} className="p-1 disabled:cursor-restricted disabled:opacity-40" aria-label={`Copy ${label}`}><ContentCopy style={{ fontSize: 13 }} /></button>
      {actions}
    </div>
  </>;
}

export default function SignatureAlbumRightPanel({ album, canWrite, busy, onPublish, onUnpublish, onAccessChange, onRegenerateLink, onResetPin, onNotice, previewKey }) {
  const [preview, setPreview] = useState(false);
  const [share, setShare] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const readOnlyTitle = "You have read-only access to the Signature Album.";
  const published = album.status === "PUBLISHED";
  // Taking a live link down is asked first, from the switch here and from Review & Share alike.
  const askUnpublish = () => setConfirm("unpublish");
  async function copy(value, label) { if (await copyToClipboard(value)) onNotice?.(`${label} copied.`, "success"); else onNotice?.(`Unable to copy the ${label}.`, "error"); }

  return <>
    <aside className="flex min-h-0 flex-col overflow-hidden border-l border-slate-200 bg-white md:h-full">
      <div className="flex min-h-0 flex-1 flex-col p-3">
        {/* Only what writes is held in a read-only fieldset: copying the link or the PIN is reading,
            and a whole-rail fieldset disabled the Copy buttons for the people who only share. */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <ReadOnlyFieldset canWrite={canWrite} reason={readOnlyTitle}>
          <Section title="Album">
            <div className="flex items-start justify-between gap-3">
              <div><p className="text-xs font-medium text-slate-700">Publish Status<HelpTip text="On makes the client link live; off takes the album down from the client." /></p><p className="mt-0.5 text-[10px] text-slate-500">{published ? "The client link is live" : album.problems.length ? "Complete the album to publish" : "Ready to publish"}</p></div>
              <ToggleSwitch ariaLabel="Publish Status" checked={published} disabled={!canWrite || busy || (!published && album.problems.length > 0)} title={canWrite ? (!published && album.problems.length ? album.problems[0].message : undefined) : readOnlyTitle} onCheckedChange={(value) => (value ? onPublish() : askUnpublish())} className="mt-0.5" />
            </div>
          </Section>
          </ReadOnlyFieldset>
          <Section title="Client Access">
            <CopyField label="Client URL" value={album.link.clientUrl} placeholder="Publish to create the link" onCopy={copy} actions={<>
              <a href={published && album.link.clientUrl ? album.link.clientUrl : undefined} target="_blank" rel="noreferrer" aria-label="Open client URL" className={`p-1 ${published && album.link.clientUrl ? "" : "pointer-events-none opacity-40"}`}><OpenInNew style={{ fontSize: 13 }} /></a>
              {canWrite && album.link.shortCode && <button type="button" disabled={busy} onClick={() => setConfirm("link")} className="p-1 disabled:opacity-40" aria-label="Regenerate client link"><Refresh style={{ fontSize: 13 }} /></button>}
            </>} />
            {album.link.requiresPin && <CopyField label="Access PIN" value={album.link.pin} placeholder="Set when the album is published" mono onCopy={copy} actions={canWrite && <button type="button" disabled={busy} onClick={() => setConfirm("pin")} className="p-1 disabled:opacity-40" aria-label="Reset access PIN"><Refresh style={{ fontSize: 13 }} /></button>} />}
            <ReadOnlyFieldset canWrite={canWrite} reason={readOnlyTitle}>
            <DateField label="Expiry" helperText="The day the client's album link stops working; leave empty to keep it open." value={toDateInput(album.expiresAt)} restriction="past" className="mt-3 [&_button]:min-h-8 [&_button]:text-[10px]" labelClassName="text-[10px] font-bold text-slate-700" onChange={(value) => onAccessChange({ expiresAt: value || null })} />
            {published && album.expiresAt && <p className="mt-1 text-[10px] text-slate-500">Link expires on {formatShortDate(album.expiresAt)}</p>}
            </ReadOnlyFieldset>
          </Section>
          <ReadOnlyFieldset canWrite={canWrite} reason={readOnlyTitle}>
          <Section title="Permissions" last>
            <ClientPermissions album={album} canWrite={canWrite} busy={busy} onChange={onAccessChange} />
          </Section>
          </ReadOnlyFieldset>
        </div>
      </div>
      <footer className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-slate-200 p-3">
        <button type="button" onClick={() => setPreview(true)} className="text-[10px] text-blue-600">Preview Album</button>
        <Button type="button" size="sm" variant="primary" className="!min-h-8 !px-2 !text-[10px]" onClick={() => setShare(true)}>Review &amp; Share</Button>
      </footer>
    </aside>
    {preview && <Dialog title="Album Preview" size="wide" height="tall" onClose={() => setPreview(false)} bodyClassName="bg-slate-50"><AlbumPreview album={album} refreshKey={previewKey} className="h-full" /></Dialog>}
    {share && <ReviewShareDialog album={album} canWrite={canWrite} busy={busy} onPublish={onPublish} onUnpublish={askUnpublish} onNotice={onNotice} onClose={() => setShare(false)} />}
    {confirm === "link" && <ConfirmDialog title="Generate a new client link?" message="The link already shared stops working the moment the new one is made. The PIN stays the same." confirmLabel="New link" loading={busy} tone="primary" onCancel={() => setConfirm(null)} onConfirm={async () => { await onRegenerateLink(); setConfirm(null); }} />}
    {confirm === "unpublish" && <ConfirmDialog layer="confirmOverDialog" title="Unpublish the album?" message="The client link stops opening the album until you publish it again. The link, the PIN and the photos are kept - publishing again brings back the same link." confirmLabel="Unpublish" busyLabel="Unpublishing..." loading={busy} onCancel={() => setConfirm(null)} onConfirm={async () => { await onUnpublish(); setConfirm(null); }} />}
    {confirm === "pin" && <ConfirmDialog title="Reset the access PIN?" message="A new PIN is generated. Anyone who has the old one can no longer open the album with it." confirmLabel="Reset PIN" loading={busy} tone="primary" onCancel={() => setConfirm(null)} onConfirm={async () => { await onResetPin(); setConfirm(null); }} />}
  </>;
}
