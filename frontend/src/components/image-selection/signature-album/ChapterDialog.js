"use client";

import { useState } from "react";
import Button from "@/components/shared/Button";
import Dropdown from "@/components/shared/Dropdown";
import TextField from "@/components/shared/TextField";
import useFormErrors from "@/components/shared/useFormErrors";
import Dialog from "@/components/ui/Dialog";
import { fetchProtectedImage } from "@/services/image-selection/image-selection.service";
import { createAlbumChapter, updateAlbumChapter } from "@/services/image-selection/signature-album.service";
import { LAYOUT_OPTIONS } from "@/lib/signatureAlbum.mjs";
import { CHAPTER_COVER_FRAME, CHAPTER_COVER_FRAMES } from "@/lib/signatureAlbumTransform.mjs";
import AlbumImage from "./client/AlbumImage";
import ImagePositionEditor from "./ImagePositionEditor";
import PhotoPicker from "./PhotoPicker";

/**
 * Add or edit a chapter: its name, a line under it, its cover and, if it differs, its layout.
 *
 * The cover has a placement as well as a photo - the album cover's four values, on the chapter -
 * chosen through the same Adjust dialog the album cover uses, opened on the 21:9 band the client
 * page draws the chapter cover in. Apply stages the placement here; nothing is stored until Save
 * Chapter, which sends it with the chapter's other fields. The preview above the buttons is that
 * band under the staged placement, so the studio sees the crop the client will.
 *
 * A newly picked cover starts from the default placement - the old photo's crop is not the new
 * one's - and Cancel in the Adjust dialog leaves the staged placement as it was.
 */
export default function ChapterDialog({ album, projectId, chapter = null, onClose, onSaved }) {
  const [name, setName] = useState(chapter?.name || "");
  const [subtitle, setSubtitle] = useState(chapter?.subtitle || "");
  const [layoutStyle, setLayoutStyle] = useState(chapter?.layoutStyle || "");
  const [cover, setCover] = useState(chapter?.cover || null);
  const [coverImageId, setCoverImageId] = useState(chapter?.coverImageId || null);
  // The staged placement: what was saved, or null for the default the band always drew.
  const [coverTransform, setCoverTransform] = useState(chapter?.coverTransform?.adjusted ? chapter.coverTransform : null);
  const [picking, setPicking] = useState(false);
  const [adjusting, setAdjusting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fields = useFormErrors();

  function pickCover(image) {
    setCover(image); setCoverImageId(image.imageId); setCoverTransform(null); setPicking(false);
  }
  function removeCover() {
    setCover(null); setCoverImageId(null); setCoverTransform(null);
  }

  async function save(event) {
    event.preventDefault();
    setError("");
    if (!fields.check({ name: name.trim() ? "" : "Give the chapter a name." })) return;
    setBusy(true);
    try {
      // The placement travels with the cover: the staged values, or nulls to put the band back to
      // its default. Without a cover there is nothing to place and nothing is sent for it.
      const placement = coverImageId
        ? (coverTransform ? { coverDisplayMode: coverTransform.displayMode, coverFocalX: coverTransform.focalX, coverFocalY: coverTransform.focalY, coverZoom: coverTransform.zoom } : { coverDisplayMode: null, coverFocalX: null, coverFocalY: null, coverZoom: null })
        : {};
      const body = { name: name.trim(), subtitle: subtitle.trim(), layoutStyle: layoutStyle || null, coverImageId, ...placement };
      const response = chapter ? await updateAlbumChapter(album.id, chapter.id, body) : await createAlbumChapter(album.id, body);
      onSaved?.(response.data);
    } catch (failure) { setError(failure.message || "Unable to save the chapter."); }
    finally { setBusy(false); }
  }

  return <>
    <Dialog title={chapter ? "Edit Chapter" : "Add Chapter"} size="md" onClose={onClose} busy={busy} onSubmit={save} footer={<><Button type="button" onClick={onClose} disabled={busy}>Cancel</Button><Button type="submit" variant="primary" busy={busy}>{chapter ? "Save Chapter" : "Add Chapter"}</Button></>}>
      <div className="grid gap-3 sm:grid-cols-[200px_minmax(0,1fr)]">
        <div>
          {/* The chapter's band, as the client page draws it, under the staged placement. */}
          <div className="overflow-hidden rounded-lg bg-slate-100" style={{ aspectRatio: CHAPTER_COVER_FRAME }}>
            {cover
              ? <AlbumImage key={`${cover.imageId}-${coverTransform?.focalX}-${coverTransform?.focalY}-${coverTransform?.zoom}-${coverTransform?.displayMode}`} item={cover} eager loader={fetchProtectedImage} alt={cover.fileName} transform={coverTransform} className="!bg-slate-100 h-full" style={{ aspectRatio: "auto" }} />
              : <div className="grid h-full place-items-center px-2 text-center text-[10px] text-slate-500">No cover</div>}
          </div>
          <Button type="button" size="sm" className="mt-2 w-full" onClick={() => setPicking(true)}>{cover ? "Change" : "Cover photo"}</Button>
          {cover && <Button type="button" size="sm" className="mt-2 w-full" onClick={() => setAdjusting(true)}>{coverTransform ? "Adjust Cover ·" : "Adjust Cover"}</Button>}
          {cover && <button type="button" onClick={removeCover} className="mt-1 w-full text-[10px] text-slate-500 hover:text-red-600">Remove cover</button>}
        </div>
        <div className="grid gap-3">
          <TextField label="Chapter name" helperText="The chapter title shown in the album, such as The Wedding." required value={name} onChange={(event) => { fields.clear("name"); setName(event.target.value); }} maxLength={191} placeholder="The Wedding" error={fields.errors.name} />
          <TextField label="Subtitle" helperText="A short line shown under the chapter title." value={subtitle} onChange={(event) => setSubtitle(event.target.value)} maxLength={255} placeholder="The beginning of forever." />
          <Dropdown label="Photo layout" helperText="How this chapter's photos are arranged; Album default follows the album." ariaLabel="Chapter photo layout" value={layoutStyle} onChange={(value) => setLayoutStyle(value || "")} options={[{ value: "", label: "Album default" }, ...LAYOUT_OPTIONS]} sorted={false} />
        </div>
      </div>
      {error && <p role="alert" className="mt-3 text-xs text-red-600">{error}</p>}
    </Dialog>
    {picking && <PhotoPicker projectId={projectId} album={album} mode="cover" title="Choose the chapter cover" onClose={() => setPicking(false)} onPick={pickCover} />}
    {adjusting && cover && <ImagePositionEditor title="Adjust Cover" image={cover} transform={coverTransform} frames={CHAPTER_COVER_FRAMES} defaultFrame={CHAPTER_COVER_FRAME} onApply={(transform) => { setCoverTransform(transform); setAdjusting(false); }} onClose={() => setAdjusting(false)} />}
  </>;
}
