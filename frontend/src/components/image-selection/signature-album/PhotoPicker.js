"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Folder from "@mui/icons-material/Folder";
import Button from "@/components/shared/Button";
import Dropdown from "@/components/shared/Dropdown";
import Loader from "@/components/shared/Loader";
import RadioGroupField from "@/components/shared/RadioGroupField";
import SelectableOption from "@/components/shared/SelectableOption";
import TextField from "@/components/shared/TextField";
import useInfiniteScroll from "@/components/shared/useInfiniteScroll";
import Dialog from "@/components/ui/Dialog";
import PhotoTileGrid from "./PhotoTileGrid";
import { addAlbumItems, listAlbumSourceFolders, listAlbumSourceImages } from "@/services/image-selection/signature-album.service";

/**
 * Add from Project: the client's Photo Selection picks, a folder, or photos ticked by hand - all
 * of them references to the project's existing photos, added to one chapter. `mode="cover"` is the
 * same picker used to choose one photo (an album or chapter cover) and hands back its id instead.
 *
 * Reads only the album's own source endpoints; nothing here touches the gallery.
 */
const PAGE_SIZE = 60;

function FolderBranch({ folder, selectedId, onSelect, depth = 0 }) {
  return <li>
    <button type="button" onClick={() => onSelect(folder)} className={`flex w-full items-center gap-2 rounded-md py-1.5 pr-2 text-left text-xs ${selectedId === folder.id ? "bg-blue-50 text-blue-700" : "text-slate-700 hover:bg-slate-50"}`} style={{ paddingLeft: `${depth * 14 + 8}px` }}>
      <Folder style={{ fontSize: 15 }} aria-hidden="true" className={selectedId === folder.id ? "text-blue-600" : "text-amber-500"} />
      <span className="min-w-0 flex-1 truncate">{folder.name}</span>
      <span className="shrink-0 text-[10px] text-slate-400">{folder.totalPhotoCount}</span>
    </button>
    {folder.children?.length > 0 && <ul>{folder.children.map((child) => <FolderBranch key={child.id} folder={child} selectedId={selectedId} onSelect={onSelect} depth={depth + 1} />)}</ul>}
  </li>;
}

// `layer` is for a picker opened over another dialog - the cover dialog - so it stacks above it.
export default function PhotoPicker({ projectId, album, chapters = [], defaultChapterId = null, mode = "add", title, layer = "dialog", onClose, onAdded, onPick }) {
  const single = mode === "cover";
  const [source, setSource] = useState(single ? "MANUAL" : "SELECTED");
  const [chapterId, setChapterId] = useState(defaultChapterId || chapters[0]?.id || "");
  const [tree, setTree] = useState(null);
  const [folder, setFolder] = useState(null);
  const [includeSubfolders, setIncludeSubfolders] = useState(true);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [images, setImages] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, totalPages: 1, total: 0 });
  const [loadingImages, setLoadingImages] = useState(false);
  const [picked, setPicked] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const scrollerRef = useRef(null);
  const requestRef = useRef(0);

  useEffect(() => { listAlbumSourceFolders(projectId).then((response) => setTree(response.data)).catch((failure) => setError(failure.message || "Unable to load folders.")); }, [projectId]);
  useEffect(() => { const timer = window.setTimeout(() => setQuery(search), 250); return () => window.clearTimeout(timer); }, [search]);

  const albumId = album?.id || null;
  const folderId = folder?.id || null;
  const loadImages = useCallback(async (page) => {
    const request = ++requestRef.current;
    setLoadingImages(true);
    try {
      const response = await listAlbumSourceImages(projectId, { albumId, folderId, search: query, page, pageSize: PAGE_SIZE });
      if (request !== requestRef.current) return;
      // Page one replaces the list, so a new folder or search starts clean without a reset of its own.
      setImages((current) => (page === 1 ? response.data.items : [...current, ...response.data.items]));
      setPagination({ page, totalPages: response.data.pagination.totalPages, total: response.data.pagination.total });
      setError("");
    } catch (failure) { if (request === requestRef.current) setError(failure.message || "Unable to load photos."); }
    finally { if (request === requestRef.current) setLoadingImages(false); }
  }, [projectId, albumId, folderId, query]);

  useEffect(() => {
    if (source !== "MANUAL") return undefined;
    const timer = window.setTimeout(() => loadImages(1), 0);
    return () => window.clearTimeout(timer);
  }, [source, loadImages]);

  const sentinelRef = useInfiniteScroll({ onLoadMore: () => loadImages(pagination.page + 1), hasMore: pagination.page < pagination.totalPages, loading: loadingImages, count: images.length, rootRef: scrollerRef, resetKey: `${folder?.id || ""}|${query}` });

  const chapterOptions = useMemo(() => chapters.map((chapter) => ({ value: chapter.id, label: chapter.name })), [chapters]);
  const pickable = images.filter((image) => single || !image.inAlbum);
  const allPickedHere = pickable.length > 0 && pickable.every((image) => picked.has(image.imageId));

  function togglePick(image) {
    if (single) { onPick?.(image); return; }
    if (image.inAlbum) return;
    setPicked((current) => { const next = new Set(current); if (next.has(image.imageId)) next.delete(image.imageId); else next.add(image.imageId); return next; });
  }

  async function add() {
    if (!chapterId) { setError("Choose a chapter to add the photos to."); return; }
    setBusy(true); setError("");
    try {
      const body = source === "SELECTED" ? { chapterId, source } : source === "FOLDER" ? { chapterId, source, folderId: folder?.id, includeSubfolders } : { chapterId, source, imageIds: [...picked] };
      if (source === "FOLDER" && !folder) { setError("Choose a folder."); return; }
      if (source === "MANUAL" && !picked.size) { setError("Tick at least one photo."); return; }
      const response = await addAlbumItems(album.id, body);
      onAdded?.(response.data);
    } catch (failure) { setError(failure.message || "Unable to add the photos."); }
    finally { setBusy(false); }
  }

  const folderList = tree ? <ul className="space-y-0.5">{tree.folders.map((row) => <FolderBranch key={row.id} folder={row} selectedId={folder?.id} onSelect={setFolder} />)}</ul> : <Loader label="Loading folders..." size="sm" inline />;
  const selectedCount = tree?.selectedCount ?? 0;
  const summary = source === "SELECTED" ? `${selectedCount} photo${selectedCount === 1 ? "" : "s"} the client selected` : source === "FOLDER" ? (folder ? `${includeSubfolders ? folder.totalPhotoCount : folder.photoCount} photos in ${folder.name}` : "Choose a folder") : `${picked.size} ticked`;

  return <Dialog
    title={title || (single ? "Choose a photo" : "Add Photos")}
    description={single ? "One of the project's existing photos. Nothing is copied." : "Photos are added as references to the project's existing files - nothing is copied or moved."}
    size="wide"
    layer={layer}
    height="tall"
    onClose={onClose}
    busy={busy}
    footer={single ? <Button type="button" onClick={onClose}>Cancel</Button> : <>
      <span className="mr-auto self-center text-xs text-slate-500">{summary}</span>
      <Button type="button" onClick={onClose} disabled={busy}>Cancel</Button>
      <Button type="button" variant="primary" busy={busy} onClick={add} disabled={!chapterId || (source === "MANUAL" && !picked.size) || (source === "FOLDER" && !folder)}>Add Photos</Button>
    </>}
  >
    {!single && <div className="mb-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_240px]">
      <RadioGroupField label="Add from Project" helperText="Where the photos to add to the album come from." value={source} onChange={(value) => { setSource(value); setError(""); }} options={[{ value: "SELECTED", label: `Selected Photos (${selectedCount})` }, { value: "FOLDER", label: "Folder" }, { value: "MANUAL", label: "Choose Photos Manually" }]} controlClassName="px-0 py-0" />
      <Dropdown label="Into chapter" helperText="The album chapter the chosen photos are added to." ariaLabel="Chapter" value={chapterId} onChange={setChapterId} options={chapterOptions} placeholder="Choose a chapter" sorted={false} />
    </div>}
    {error && <p role="alert" className="mb-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
    {source === "SELECTED" && <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-600">
      Every photo the client picked through Photo Selection will be added to <strong>{chapterOptions.find((option) => option.value === chapterId)?.label || "the chapter"}</strong>. Their selection stays exactly as it is.
    </div>}
    {source === "FOLDER" && <div className="grid gap-4 md:grid-cols-[260px_minmax(0,1fr)]">
      <div className="max-h-80 overflow-y-auto rounded-lg border border-slate-200 p-2">{folderList}</div>
      <div className="space-y-3 text-sm text-slate-600">
        <p>{folder ? <>Adds <strong>{includeSubfolders ? folder.totalPhotoCount : folder.photoCount}</strong> photos from <strong>{folder.name}</strong>. Photos already in the album are skipped.</> : "Choose a folder on the left."}</p>
        <SelectableOption label="Include subfolders" helperText="Tick to also add the photos in folders inside this one." checked={includeSubfolders} onCheckedChange={setIncludeSubfolders} />
      </div>
    </div>}
    {source === "MANUAL" && <div className="grid gap-4 md:grid-cols-[220px_minmax(0,1fr)]">
      <div className="max-h-40 overflow-y-auto rounded-lg border border-slate-200 p-2 md:max-h-[28rem]">
        <button type="button" onClick={() => setFolder(null)} className={`mb-1 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs ${!folder ? "bg-blue-50 text-blue-700" : "text-slate-700 hover:bg-slate-50"}`}>All photos</button>
        {folderList}
      </div>
      <div className="flex min-h-0 flex-col">
        <div className="mb-2 flex flex-wrap items-end gap-2">
          <TextField label="Search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="File name" className="min-w-0 flex-1" />
          {!single && <Button type="button" size="sm" onClick={() => setPicked((current) => { const next = new Set(current); pickable.forEach((image) => (allPickedHere ? next.delete(image.imageId) : next.add(image.imageId))); return next; })} disabled={!pickable.length}>{allPickedHere ? "Untick loaded" : "Tick all loaded"}</Button>}
          <span className="self-center text-[10px] text-slate-500">{pagination.total} photos</span>
        </div>
        <div ref={scrollerRef} className="max-h-[26rem] overflow-y-auto rounded-lg border border-slate-200 p-2">
          {images.length === 0 && !loadingImages && <p className="py-10 text-center text-xs text-slate-500">No photos here.</p>}
          <PhotoTileGrid photos={images} getKey={(image) => image.imageId} isChosen={(image) => picked.has(image.imageId)} isDisabled={(image) => !single && image.inAlbum} labelOf={(image, chosen) => `${chosen ? "Untick" : "Tick"} ${image.fileName}`} onPick={togglePick} />
          {pagination.page < pagination.totalPages && <div ref={sentinelRef} className="py-3 text-center text-[10px] text-slate-400">{loadingImages ? "Loading..." : "More"}</div>}
          {loadingImages && images.length === 0 && <div className="py-8"><Loader label="Loading photos..." size="sm" /></div>}
        </div>
      </div>
    </div>}
  </Dialog>;
}
