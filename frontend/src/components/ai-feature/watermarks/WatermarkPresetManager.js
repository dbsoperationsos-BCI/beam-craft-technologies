"use client";

import { useCallback, useEffect, useState } from "react";
import DeleteOutlineRounded from "@mui/icons-material/DeleteOutlineRounded";
import EditRounded from "@mui/icons-material/EditRounded";
import Button from "@/components/shared/Button";
import FloatingNotice, { useNotice } from "@/components/shared/FloatingNotice";
import IconButton from "@/components/shared/IconButton";
import Loader from "@/components/shared/Loader";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { MAX_PRESETS } from "@/lib/watermarkGeometry.mjs";
import { deleteWatermarkPreset, listWatermarkPresets } from "@/services/ai-feature/watermark-presets.service";
import WatermarkPresetDialog from "./WatermarkPresetDialog";
import WatermarkPreview from "./WatermarkPreview";

/**
 * The studio's saved watermarks, managed where the default is chosen: Event Default Settings →
 * Privacy & Access → Watermark. Each preset drawn on a stand-in photo, with Add Watermark, edit and
 * delete; at most MAX_PRESETS, held on the server too.
 *
 * `canWrite` is AI Event Default Settings Read / Write - a reader sees the list and is offered none
 * of the three. `onChanged({ type, preset })` is told after the server has kept a create, an edit or
 * a delete, so the form around it can refresh its dropdown and preview. The preset the saved
 * defaults name cannot be deleted, and the confirm says so before it is tried.
 */
export default function WatermarkPresetManager({ canWrite = false, onChanged, layer = "dialog" }) {
  const [state, setState] = useState({ loading: true, error: "", items: [], limit: MAX_PRESETS, defaultPresetId: null });
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const { notice, showSuccess, showError, clearNotice } = useNotice();

  const load = useCallback(async () => {
    try {
      const data = (await listWatermarkPresets())?.data || {};
      setState({ loading: false, error: "", items: data.items || [], limit: data.limit || MAX_PRESETS, defaultPresetId: data.defaultPresetId || null });
    } catch (cause) {
      // A reload that fails keeps the list already shown; the message sits above it.
      setState((current) => ({ ...current, loading: false, error: cause?.message || "Unable to load the watermark presets." }));
    }
  }, []);
  useEffect(() => { const timer = window.setTimeout(load, 0); return () => window.clearTimeout(timer); }, [load]);

  const atLimit = state.items.length >= state.limit;
  const isDefault = Boolean(deleting && deleting.id === state.defaultPresetId);

  function saved(preset, { created }) {
    setEditing(null);
    showSuccess(created ? `"${preset.name}" saved.` : `"${preset.name}" updated.`);
    load();
    onChanged?.({ type: created ? "created" : "updated", preset });
  }

  async function confirmDelete() {
    setDeleteBusy(true);
    try {
      await deleteWatermarkPreset(deleting.id);
      showSuccess(`"${deleting.name}" deleted.`);
      onChanged?.({ type: "deleted", preset: deleting });
      setDeleting(null);
      load();
    } catch (cause) {
      setDeleting(null);
      showError(cause?.message || "Unable to delete the watermark.");
    } finally {
      setDeleteBusy(false);
    }
  }

  return <section aria-label="Watermark presets" className="space-y-3">
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-xs text-slate-600">Save a watermark once and use it for any event.{state.loading ? "" : ` ${state.items.length} of ${state.limit} saved.`}</p>
      {canWrite && <Button type="button" variant="primary" size="sm" onClick={() => setEditing({})} disabled={state.loading || atLimit} className="shrink-0">+ Add Watermark</Button>}
    </div>
    {canWrite && atLimit && <p className="text-xs text-slate-500">You have {state.limit} presets, the most you can keep. Delete one to add another.</p>}
    {state.error && <div role="alert" className="flex flex-col items-start gap-2 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700 sm:flex-row sm:items-center sm:justify-between"><span>{state.error}</span><Button type="button" size="sm" onClick={load}>Try again</Button></div>}
    {state.loading
      ? <Loader label="Loading watermark presets..." size="sm" />
      : state.error && state.items.length === 0
        ? null
        : state.items.length === 0
          ? <p className="rounded-md border border-dashed border-slate-300 px-3 py-4 text-center text-xs text-slate-600">{canWrite ? "No watermarks yet. Add your studio's logo or a line of text." : "Nobody has saved a watermark yet."}</p>
          : <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {state.items.map((preset) => <li key={preset.id} className="overflow-hidden rounded-lg border border-slate-200 bg-white">
              <WatermarkPreview look={preset} className="rounded-none" label={`Preview of ${preset.name}`} />
              <div className="flex items-center gap-2 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-900" title={preset.name}>{preset.name}</p>
                  <p className="text-xs text-slate-500">{preset.type === "LOGO" ? "Logo" : "Text"}{preset.id === state.defaultPresetId ? " · Default for new events" : ""}</p>
                </div>
                {canWrite && <>
                  <IconButton label={`Edit ${preset.name}`} onClick={() => setEditing(preset)}><EditRounded fontSize="small" /></IconButton>
                  <IconButton label={`Delete ${preset.name}`} onClick={() => setDeleting(preset)}><DeleteOutlineRounded fontSize="small" /></IconButton>
                </>}
              </div>
            </li>)}
          </ul>}

    {editing && <WatermarkPresetDialog preset={editing.id ? editing : null} onClose={() => setEditing(null)} onSaved={saved} layer={layer} />}
    <ConfirmDialog
      open={Boolean(deleting)}
      layer="confirmOverDialog"
      title={isDefault ? "This watermark is the default" : "Delete this watermark?"}
      message={deleting ? (isDefault
        ? `"${deleting.name}" is the watermark new events start with. Choose another default here, or turn both watermark switches off, save, and it can then be deleted.`
        : `"${deleting.name}" will no longer be offered for new events. Events that already use it keep their own copy and look the same.`) : ""}
      confirmLabel="Delete watermark"
      confirmDisabled={isDefault}
      busyLabel="Deleting..."
      loading={deleteBusy}
      onCancel={() => setDeleting(null)}
      onConfirm={confirmDelete}
    />
    <FloatingNotice notice={notice} onClose={clearNotice} />
  </section>;
}
