"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Loader from "@/components/shared/Loader";
import { useModuleAccess } from "@/components/auth/PermissionsProvider";
import { previewEditable } from "@/lib/signatureAlbum.mjs";
import { fetchProtectedImage } from "@/services/image-selection/image-selection.service";
import { getSignatureAlbumPreview, listSignatureAlbumPreviewItems, updateAlbumChapter, updateAlbumItem, updateSignatureAlbum } from "@/services/image-selection/signature-album.service";
import SignatureAlbumView from "./client/SignatureAlbumView";

/**
 * The client's album, for the studio, before or after publish. Same view, same content builder;
 * only the photo URLs point behind the studio's guard and the controls that need a client session
 * (Download Album, share) draw but do nothing. The workspace tells it to refetch by posting
 * `signature-album:refresh` after a save, so the preview follows every change without a reload.
 *
 * With `editable` (the Design tab's Edit Album Preview) the cover, each chapter's cover band and
 * every photo can be dragged into place. A cover save is posted to the workspace
 * (`signature-album:cover-saved`) so it keeps its album; any failed save is posted as
 * `signature-album:position-error` with the reason, and the photo goes back. `?edit=1` only asks:
 * dragging is offered to a viewer who may write the Signature Album, never on the URL alone.
 */
export default function AdminAlbumPreview({ albumId, editRequested = false }) {
  const { canWrite } = useModuleAccess("IMAGE_SELECTION", "Signature Album");
  const editable = previewEditable(editRequested, canWrite);
  const [content, setContent] = useState(null);
  const [error, setError] = useState("");
  const [loadingMore, setLoadingMore] = useState({});

  const load = useCallback(async () => {
    try { setContent((await getSignatureAlbumPreview(albumId)).data); setError(""); }
    catch (failure) { setError(failure.message || "Unable to load the album preview."); }
  }, [albumId]);
  useEffect(() => { const timer = window.setTimeout(load, 0); return () => window.clearTimeout(timer); }, [load]);
  useEffect(() => {
    const onMessage = (event) => { if (event.origin === window.location.origin && event.data?.type === "signature-album:refresh") load(); };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [load]);

  const loadMore = useCallback(async (chapter) => {
    if (loadingMore[chapter.id]) return;
    setLoadingMore((current) => ({ ...current, [chapter.id]: true }));
    try {
      const response = await listSignatureAlbumPreviewItems(albumId, chapter.id, { offset: chapter.items.length });
      setContent((current) => ({ ...current, chapters: current.chapters.map((row) => (row.id === chapter.id ? { ...row, items: [...row.items, ...response.data.items.filter((item) => !row.items.some((existing) => existing.id === item.id))] } : row)) }));
    } catch { /* the rows already shown stay; the sentinel asks again on the next scroll */ }
    finally { setLoadingMore((current) => ({ ...current, [chapter.id]: false })); }
  }, [albumId, loadingMore]);

  // Each drag is saved through the endpoint that already owns that photo's placement - the album
  // for its cover, the chapter for its cover band, the item for a photo - with the same four values
  // Adjust Cover / Adjust Photo write. The page keeps the answer, so the photo stays where it was put.
  const editor = useMemo(() => {
    if (!editable) return null;
    const tell = (message) => window.parent?.postMessage(message, window.location.origin);
    const save = async (write, apply) => {
      try { const response = await write(); setContent((current) => (current ? apply(current, response.data) : current)); return response; }
      catch (failure) { tell({ type: "signature-album:position-error", message: failure.message || "Unable to save the photo's position." }); throw failure; }
    };
    return {
      cover: async (transform) => {
        const response = await save(() => updateSignatureAlbum(albumId, { coverDisplayMode: transform.displayMode, coverFocalX: transform.focalX, coverFocalY: transform.focalY, coverZoom: transform.zoom }), (current, album) => ({ ...current, coverTransform: album?.coverTransform || transform }));
        tell({ type: "signature-album:cover-saved", response });
      },
      chapterCover: (chapter, transform) => save(() => updateAlbumChapter(albumId, chapter.id, { coverDisplayMode: transform.displayMode, coverFocalX: transform.focalX, coverFocalY: transform.focalY, coverZoom: transform.zoom }), (current, saved) => ({ ...current, chapters: current.chapters.map((row) => (row.id === chapter.id ? { ...row, coverTransform: saved?.coverTransform || transform } : row)) })),
      // One item can be both a highlight and in its chapter: both copies take the new place.
      photo: (item, transform) => save(() => updateAlbumItem(albumId, item.id, transform), (current, saved) => {
        const place = (row) => (row.id === item.id ? { ...row, transform: saved?.transform || transform } : row);
        return { ...current, highlights: (current.highlights || []).map(place), chapters: current.chapters.map((chapter) => ({ ...chapter, items: chapter.items.map(place) })) };
      }),
    };
  }, [albumId, editable]);

  if (error) return <main className="grid min-h-[100svh] place-items-center bg-white px-6 text-center text-sm text-slate-600">{error}</main>;
  if (!content) return <main className="grid min-h-[100svh] place-items-center bg-white"><Loader label="Loading preview..." size="lg" /></main>;
  return <SignatureAlbumView content={content} loader={fetchProtectedImage} onLoadMore={loadMore} loadingMore={loadingMore} editor={editor} />;
}
