"use client";

import Button from "@/components/shared/Button";
import Dialog from "@/components/ui/Dialog";
import SharePanel from "./SharePanel";

/** Review & Share from the rail: the share panel in a dialog, so the studio never leaves the album. */
export default function ReviewShareDialog({ album, canWrite, busy, onPublish, onUnpublish, onNotice, onClose }) {
  return <Dialog title="Review & Share" size="lg" onClose={onClose} bodyClassName="bg-slate-50" footer={<Button type="button" onClick={onClose}>Close</Button>}>
    <SharePanel album={album} canWrite={canWrite} busy={busy} onPublish={onPublish} onUnpublish={onUnpublish} onNotice={onNotice} />
  </Dialog>;
}
