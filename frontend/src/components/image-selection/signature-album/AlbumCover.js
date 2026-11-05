"use client";

import { useState } from "react";
import Button from "@/components/shared/Button";
import DateField from "@/components/shared/DateField";
import RadioGroupField from "@/components/shared/RadioGroupField";
import TextField from "@/components/shared/TextField";
import TextAreaField from "@/components/shared/TextAreaField";
import ReadOnlyFieldset from "@/components/shared/ReadOnlyFieldset";
import useSubmitOnce from "@/components/shared/useSubmitOnce";
import useFormErrors from "@/components/shared/useFormErrors";
import useUnsavedGuard from "@/components/shared/useUnsavedGuard";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import Dialog from "@/components/ui/Dialog";
import GalleryLazyImage from "@/components/image-selection/GalleryLazyImage";
import { updateSignatureAlbum } from "@/services/image-selection/signature-album.service";
import { ALIGNMENT_OPTIONS, coverFormState, hasFormChanges } from "@/lib/signatureAlbum.mjs";
import AlbumCoverPicker from "./AlbumCoverPicker";
import ImagePositionEditor from "./ImagePositionEditor";
import { COVER_FRAMES, isDefaultTransform } from "@/lib/signatureAlbumTransform.mjs";

// The cover frame that matches each cover style, so Adjust Cover opens on the shape the client sees.
const COVER_FRAME_FOR_STYLE = { FULL_SCREEN: "16 / 9", CENTERED_HERO: "16 / 9", EDITORIAL_OVERLAY: "16 / 9", MINIMAL: "16 / 9", SPLIT: "1 / 1", FRAMED: "4 / 3", STORY: "4 / 5" };

/**
 * The cover editor, in a dialog of its own: the cover photo (one of the photos uploaded to the album
 * itself, chosen through `AlbumCoverPicker`, placed with Adjust Cover), and the words over it - title, subtitle, event
 * date, text alignment - plus the ending message, which is the album's other piece of writing.
 *
 * Opened from the Album tab's Add Cover / Edit Cover and nowhere else. **Everything is a draft until
 * Save Cover**: the fields, the photo chosen and where it sits are held here, opened from the album
 * as it was last saved, and written together in one save - the same album update every one of them
 * always used. Cancel or the close button drops the draft, so the next open shows the saved cover
 * again. A save that fails leaves the dialog open with what was typed.
 */
export default function AlbumCover({ album, canWrite, onSaved, onError, onClose }) {
  // The album as it was when the dialog opened. The album itself is reloaded behind the dialog while
  // photos upload, so a draft is only ever measured against this, never against the live prop.
  // A cover chosen before album uploads existed is a project photo (`coverImageId`); it keeps showing
  // until an album photo replaces it.
  const [saved] = useState(() => ({ form: coverFormState(album), coverPhotoId: album.coverPhotoId || null, transform: album.coverTransform || null }));
  const initial = saved.form;
  const [form, setForm] = useState(initial);
  // The photo and its placement, staged the same way. `cover` is the photo as the preview draws it.
  const [cover, setCover] = useState(album.cover || null);
  const [coverPhotoId, setCoverPhotoId] = useState(saved.coverPhotoId);
  const [transform, setTransform] = useState(saved.transform);
  const [picking, setPicking] = useState(false);
  const [adjusting, setAdjusting] = useState(false);
  const { busy: saving, run } = useSubmitOnce();
  const fields = useFormErrors();
  const set = (key) => (value) => setForm((current) => ({ ...current, [key]: value }));

  const coverChanged = coverPhotoId !== saved.coverPhotoId;
  const transformChanged = transform !== saved.transform;
  const dirty = hasFormChanges(initial, form) || coverChanged || transformChanged;
  // Escape, the backdrop and the close button ask before dropping a draft; Cancel is already that choice.
  const leave = useUnsavedGuard(dirty, { title: "Discard your cover changes?", message: "The cover keeps what was last saved.", confirmLabel: "Discard" });

  function pickCover(photo) {
    setPicking(false);
    if (photo.photoId === coverPhotoId) return;
    // A different photo starts centred, as the server would have it: the old point meant nothing here.
    setCover(photo);
    setCoverPhotoId(photo.photoId);
    setTransform(null);
  }
  function save() {
    if (!fields.check({ title: form.title.trim() ? "" : "Enter the title." })) return;
    return run(async () => {
      try {
        onSaved?.(await updateSignatureAlbum(album.id, {
          title: form.title.trim(), subtitle: form.subtitle.trim(), eventDate: form.eventDate || null, coverAlignment: form.coverAlignment, endingMessage: form.endingMessage.trim(),
          ...(coverChanged ? { coverAlbumPhotoId: coverPhotoId } : {}),
          ...(transformChanged ? { coverDisplayMode: transform?.displayMode ?? null, coverFocalX: transform?.focalX ?? null, coverFocalY: transform?.focalY ?? null, coverZoom: transform?.zoom ?? null } : {}),
        }));
        onClose?.();
      } catch (failure) { onError?.(failure.message || "Unable to save the cover."); }
    });
  }

  const adjusted = Boolean(transform) && !isDefaultTransform(transform);
  return <>
    <Dialog
      title="Cover"
      description="Configure the Signature Album cover"
      size="xl"
      busy={saving}
      onClose={() => leave.guard(onClose)}
      footer={canWrite ? <>
        <Button type="button" onClick={onClose} disabled={saving}>Cancel</Button>
        <Button type="button" variant="primary" busy={saving} onClick={save} disabled={!dirty}>Save Cover</Button>
      </> : <Button type="button" onClick={onClose}>Close</Button>}
    >
      <div className="grid gap-4 md:grid-cols-[220px_minmax(0,1fr)]">
        <div>
          <div className="relative aspect-[4/5] overflow-hidden rounded-lg bg-slate-100">
            {cover ? <GalleryLazyImage src={cover.previewUrl} alt={cover.fileName} className="h-full w-full" /> : <div className="grid h-full place-items-center px-4 text-center text-xs text-slate-500">No cover yet. Choose one of the album&apos;s photos.</div>}
          </div>
          <p className="mt-1 truncate text-[10px] text-slate-500" title={cover?.fileName}>{cover?.fileName || "—"}</p>
          {canWrite && <Button type="button" size="sm" className="mt-2 w-full" onClick={() => setPicking(true)} disabled={saving}>{cover ? "Change Cover" : "Choose Cover"}</Button>}
          {canWrite && cover && <Button type="button" size="sm" className="mt-2 w-full" onClick={() => setAdjusting(true)} disabled={saving}>{adjusted ? "Adjust Cover ·" : "Adjust Cover"}</Button>}
        </div>
        <ReadOnlyFieldset canWrite={canWrite} reason="You have read-only access to the Signature Album." className="grid gap-3 sm:grid-cols-2">
          <TextField label="Title" helperText="The main title printed on the album cover." required value={form.title} onChange={(event) => { set("title")(event.target.value); fields.clear("title"); }} error={fields.errors.title} maxLength={191} placeholder="Ajay & Priya" className="sm:col-span-2" />
          <TextField label="Subtitle" helperText="A short line printed under the cover title." value={form.subtitle} onChange={(event) => set("subtitle")(event.target.value)} maxLength={191} placeholder="Our Wedding Story" />
          <DateField label="Event Date" helperText="The event date printed on the album cover." value={form.eventDate} onChange={set("eventDate")} />
          <RadioGroupField label="Text Alignment" helperText="Where the cover's title text sits on the page." value={form.coverAlignment} onChange={set("coverAlignment")} options={ALIGNMENT_OPTIONS} className="sm:col-span-2" />
          <TextAreaField label="Ending Message" helperText="The closing note on the album's last page; empty uses the default." value={form.endingMessage} onChange={(event) => set("endingMessage")(event.target.value)} rows={2} maxLength={2000} placeholder={album.effectiveEndingMessage} className="sm:col-span-2" />
        </ReadOnlyFieldset>
      </div>
    </Dialog>
    <ConfirmDialog {...leave.confirmProps} layer="confirmOverDialog" />
    {picking && <AlbumCoverPicker albumId={album.id} currentPhotoId={coverPhotoId} layer="confirmOverDialog" onClose={() => setPicking(false)} onPick={pickCover} />}
    {/* Apply stages the placement; it is written with the rest on Save Cover. */}
    {adjusting && cover && <ImagePositionEditor title="Adjust Cover" layer="confirmOverDialog" image={cover} transform={transform} frames={COVER_FRAMES} defaultFrame={COVER_FRAME_FOR_STYLE[album.design?.coverStyle] || "16 / 9"} onApply={(next) => { setTransform(next); setAdjusting(false); }} onClose={() => setAdjusting(false)} />}
  </>;
}
