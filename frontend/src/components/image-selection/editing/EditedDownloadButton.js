"use client";

import { useRef, useState } from "react";
import FileDownload from "@mui/icons-material/FileDownload";
import Button from "@/components/shared/Button";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { editedDownloadSummary } from "@/lib/imageSelectionEditing.mjs";
import { planAiEditingDownload, startAiEditingDownload } from "@/services/image-selection/ai-editing.service";

/**
 * Download Edited - the one control for downloading AI Editing's results, in the bay's bulk bar
 * (the ticked photos) and in the editor (the open photo). The server decides what is downloadable:
 * only photos whose edit is saved and rendered at its current recipe, served from the saved master
 * (`planAiEditingDownload`); a tick, an open photo or a slider not yet applied is never an edit, and
 * an original or a preview never stands in. When some of the photos asked for are left out, the
 * count and the reasons are asked about before the download; when none is downloadable, that is
 * said instead. The selection is left as it was. A second press while one is being prepared does
 * nothing.
 */
const startedLine = (count) => `Download of ${count} edited photo${count === 1 ? "" : "s"} started - your browser saves ${count === 1 ? "it" : "them as one ZIP"}.`;

export default function EditedDownloadButton({ projectId, uploadIds, label = "Download edited", disabled = false, title, onNotice, className = "", buttonClassName = "", variant = "secondary" }) {
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const working = useRef(false);
  if (!uploadIds.length) return null;

  async function prepare() {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    try {
      const { data } = await planAiEditingDownload(projectId, uploadIds);
      const summary = editedDownloadSummary(data);
      if (!summary.included) { onNotice?.(summary.line, "info"); return; }
      if (summary.leftOut) { setConfirm({ ticket: data.ticket, summary }); return; }
      startAiEditingDownload(projectId, data.ticket);
      // The browser saves the file and shows its own progress; this page cannot see it finish.
      onNotice?.(startedLine(summary.included), "info");
    } catch (error) {
      onNotice?.(error.message || "Unable to prepare the download.", "error");
    } finally { working.current = false; setBusy(false); }
  }

  return (
    <span className={className}>
      <Button variant={variant} size="sm" onClick={prepare} disabled={disabled || busy} busy={busy} busyLabel="Preparing..." title={title} className={buttonClassName}>
        <FileDownload style={{ fontSize: 16 }} aria-hidden="true" />
        {label}
      </Button>
      {confirm && (
        <ConfirmDialog
          title={confirm.summary.title}
          message={confirm.summary.line}
          confirmLabel="Download"
          tone="primary"
          onCancel={() => setConfirm(null)}
          onConfirm={() => { const { ticket, summary } = confirm; setConfirm(null); startAiEditingDownload(projectId, ticket); onNotice?.(startedLine(summary.included), "info"); }}
        />
      )}
    </span>
  );
}
