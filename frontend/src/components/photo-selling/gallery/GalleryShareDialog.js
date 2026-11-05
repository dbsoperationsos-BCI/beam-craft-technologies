"use client";

import Autorenew from "@mui/icons-material/Autorenew";
import Check from "@mui/icons-material/Check";
import ContentCopy from "@mui/icons-material/ContentCopy";
import OpenInNew from "@mui/icons-material/OpenInNew";
import Refresh from "@mui/icons-material/Refresh";
import { useState } from "react";
import ActionField from "@/components/shared/ActionField";
import Button from "@/components/shared/Button";
import ShareableMessage from "@/components/shared/ShareableMessage";
import ToggleSwitch from "@/components/shared/ToggleSwitch";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import Dialog from "@/components/ui/Dialog";
import { copyToClipboard } from "@/lib/clipboard";
import { updateSaleGalleryLink } from "@/services/photo-selling/photo-selling.service";
import GalleryQrTemplateDialog from "./GalleryQrTemplateDialog";

/**
 * Share with guests: the store's link, its PIN and its QR code, laid out as the AI Feature's own
 * Share dialog (ai-feature/event/ShareDialog.js) - one dialog opened from the gallery's header.
 * Every value is the gallery's own and made on the server, nothing is typed: Require a PIN sits
 * beside the PIN and applies at once; New link code is inside the link's field and Reset PIN inside
 * the PIN's, each confirmed, because a QR or PIN already handed out stops working. Opening this
 * dialog never changes either. A Photo Selling link is the gallery's for as long as it exists, so
 * there is nothing to generate - and it opens nothing until the gallery is live, which the dialog
 * says. QR Template turns the link into a printable poster (GalleryQrTemplateDialog): it takes this
 * dialog's place, and its back arrow brings this dialog back - as the AI Feature's does.
 *
 * Read-only for a role at Read: the link, PIN, QR and message can be copied; nothing is changed.
 */
const shortDate = (value) => (value ? new Date(value).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "");

export default function GalleryShareDialog({ gallery, galleryId, canWrite, onSaved, onNotify, onClose }) {
  const link = gallery.link || {};
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState(null);
  const [copied, setCopied] = useState(false);
  const [posters, setPosters] = useState(false);

  async function applyChange(payload, busyKey, done) {
    setBusy(busyKey);
    try {
      const response = await updateSaleGalleryLink(galleryId, payload);
      onSaved(response.data);
      setConfirm(null); setError("");
      onNotify?.(done);
    } catch (cause) {
      setError(cause.message || "The link could not be changed.");
      setConfirm(null);
    } finally {
      setBusy("");
    }
  }

  async function copy(text, which) {
    const done = await copyToClipboard(text);
    setCopied(done ? which : false);
    if (done) window.setTimeout(() => setCopied(false), 2500);
    else setError("Couldn't copy - select the text and copy it instead.");
  }
  const copyIcon = (which) => (copied === which ? <Check style={{ fontSize: 16 }} aria-hidden="true" /> : <ContentCopy style={{ fontSize: 16 }} aria-hidden="true" />);

  const message = `Photos from ${gallery.title} are ready.\n\nOpen ${link.url}${link.pin ? `\nPIN: ${link.pin}` : ""}\n\nTake a selfie to find the photos you are in, then buy the ones you love.`;

  if (posters) return <GalleryQrTemplateDialog gallery={gallery} galleryId={galleryId} canWrite={canWrite} onSaved={onSaved} onNotify={onNotify} onClose={onClose} onBack={() => setPosters(false)} />;

  return <>
    <Dialog
      title="Share with guests"
      description={gallery.live ? "Send this link or QR to the guests. They take a selfie, see the photos they are in, and buy them." : "Guests reach the gallery through this link and its PIN, both made for you."}
      size="md"
      onClose={onClose}
      busy={Boolean(busy)}
      footer={<>
        <Button type="button" className="max-sm:flex-1" disabled={Boolean(busy)} onClick={() => setPosters(true)}>QR Template</Button>
        <Button type="button" variant="primary" className="max-sm:flex-1" onClick={onClose}>Done</Button>
      </>}
    >
      {error && <p role="alert" className="mb-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
      {!gallery.live && <p role="status" className="mb-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">This link opens nothing until the gallery is live ({gallery.liveReason?.toLowerCase() || "not published"}).</p>}
      <div className="space-y-4">
        <ActionField
          label="Gallery link"
          value={link.url}
          link
          actions={[
            { label: copied === "url" ? "Copied" : "Copy gallery link", icon: copyIcon("url"), onClick: () => copy(link.url, "url") },
            { label: "Open the store", icon: <OpenInNew style={{ fontSize: 16 }} aria-hidden="true" />, onClick: () => window.open(link.url, "_blank", "noopener,noreferrer"), disabled: !gallery.live },
            ...(canWrite ? [{ label: "New link code", icon: <Autorenew style={{ fontSize: 16 }} aria-hidden="true" />, onClick: () => setConfirm("code"), disabled: Boolean(busy) }] : []),
          ]}
        />
        <ActionField
          label="Access PIN"
          labelAside={canWrite && <ToggleSwitch size="sm" label="Require a PIN to open" className="text-xs" checked={Boolean(gallery.requirePin)} disabled={Boolean(busy)} onCheckedChange={(checked) => applyChange({ requirePin: checked }, "toggle", checked ? "PIN turned on." : "PIN turned off - guests open with the link alone.")} />}
          value={link.pin || ""}
          placeholder="PIN is off - guests open with the link alone"
          mono
          actions={[
            { label: copied === "pin" ? "Copied" : "Copy access PIN", icon: copyIcon("pin"), onClick: () => copy(link.pin, "pin"), disabled: !link.pin },
            ...(canWrite && gallery.requirePin ? [{ label: "Reset PIN", icon: <Refresh style={{ fontSize: 16 }} aria-hidden="true" />, onClick: () => setConfirm("pin"), disabled: Boolean(busy) }] : []),
          ]}
        />
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
          {link.qrDataUrl && (
            // A data: address drawn by the server; next/image adds nothing for it.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={link.qrDataUrl} alt={`QR code for ${gallery.title}`} className="h-40 w-40 shrink-0 self-center rounded-lg border border-slate-200 bg-white p-1 sm:self-start" />
          )}
          <dl className="grid flex-1 grid-cols-2 gap-x-3 gap-y-2 text-xs">
            <dt className="text-slate-500">Short code</dt><dd className="font-mono text-slate-800">{gallery.shortCode}</dd>
            <dt className="text-slate-500">Status</dt><dd className="text-slate-800">{gallery.live ? "Live" : gallery.liveReason || "Not published"}</dd>
            <dt className="text-slate-500">Closes</dt><dd className="text-slate-800">{gallery.expiresAt ? shortDate(gallery.expiresAt) : "Never"}</dd>
          </dl>
        </div>
        <ShareableMessage label="Ready-to-send message" message={message} rows={5} />
      </div>
    </Dialog>
    <ConfirmDialog
      open={confirm === "code"}
      layer="confirmOverDialog"
      tone="primary"
      title="Make a new link code?"
      message="A new code is made and the gallery link changes. The old link, and any QR or poster already printed or sent with it, stop opening the gallery - share the new link or print a new poster. The PIN stays the same, and buyers keep access to their orders."
      confirmLabel="New link code"
      loading={busy === "code"}
      onCancel={() => setConfirm(null)}
      onConfirm={() => applyChange({ newCode: true }, "code", "New link code made. Share the new link.")}
    />
    <ConfirmDialog
      open={confirm === "pin"}
      layer="confirmOverDialog"
      tone="primary"
      title="Reset the PIN?"
      message="A new PIN is made and the old one stops opening the gallery. Guests who have the old PIN will need the new one, and posters printed with it show the wrong one. Guests already inside, and buyers' orders, are unaffected; the link stays the same."
      confirmLabel="Reset PIN"
      loading={busy === "pin"}
      onCancel={() => setConfirm(null)}
      onConfirm={() => applyChange({ newPin: true }, "pin", "New PIN made. Send it to guests who have not opened the gallery yet.")}
    />
  </>;
}
