"use client";
import { useState } from "react";
import { getSelectedManifest, markSelectedOriginalsDownloaded } from "@/services/image-selection/image-selection.service";
import {
  openProjectStorage,
  pickSourceFolder,
  readSourceFile,
  resolveProjectPath,
  resolveSourceFolder,
  sourceReasonMessage,
  storageReasonMessage,
  supportsFolderSelection,
} from "@/lib/projectStorage.mjs";

export function getImageId(item) {
  if (typeof item === "string") return item.trim() || null;
  return item?.id ?? item?.imageId ?? item?.galleryImageId ?? null;
}

const UNSORTED = "Unsorted";

// projectName / selectionItem / shootName / subFolder — the trail each selected photo is filed
// under, below the Target Download Path. The selection item comes first so the studio can hand a
// whole deliverable to the team working on it; the shoot and the gallery subfolder it came from sit
// inside, mirroring how the photos were filed in the project. A photo picked for several selection
// items is saved once under each. Only the trail below the project is decided here — the chosen
// folder and the project folder belong to the resolver in `lib/projectStorage.mjs`.
function trailsFor(image) {
  const tail = [image.shootName, ...(image.subFolderName ? [image.subFolderName] : [])];
  const deliverables = image.deliverables?.length ? image.deliverables : [UNSORTED];
  return deliverables.map((deliverable) => [deliverable, ...tail]);
}

// `folder` scopes the download to one shoot: only that folder's (and its subfolders') selected
// photos are fetched and saved, so clicking Wedding collects the wedding masters alone. Without it
// the download covers the whole project, which is what a manual project still gets.
export default function DownloadSelectedButton({ projectId, projectName, folder = null }) {
  const [state, setState] = useState("idle"); // idle | fetching | downloading | done | error
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [message, setMessage] = useState("");
  // True once a download has found that this browser holds no grant for the project's photos, which
  // is the one failure the studio can clear itself.
  const [needsSource, setNeedsSource] = useState(false);

  async function start() {
    setMessage(""); setState("fetching");
    if (!projectId) { console.error("Cannot download selected images: missing project ID."); setState("error"); setMessage("Missing project ID. Reload the project and try again."); return; }

    // Both folders are opened before anything is fetched: a permission prompt only works while the
    // click is still fresh, so nothing that could await first is allowed to run before them. The
    // source is where the photos already are; the target is where copies go.
    const source = await resolveSourceFolder(projectId, { request: true });
    // With no Target Download Path set the photos go to the Downloads folder as one archive named
    // after the project, which is the only way the folder tree survives the trip — see
    // openProjectStorage. With one set, the name is unused and the folders are made for real.
    const archiveName = folder ? `${projectName} - ${folder.name}` : projectName;
    // Every press is its own delivery: the root folder (or the archive's name) carries the day's
    // date, and a second download the same day gets ` (1)` after it instead of writing new files
    // over the last run's. The tree inside stays exactly the pattern above.
    const storage = await openProjectStorage({ projectName, request: true, archiveName, freshRoot: true });

    if (!source.handle) {
      setState("error");
      setMessage(sourceReasonMessage(source.reason, source.stored?.name));
      // Something the studio can act on right here, rather than an instruction to go and re-add
      // photos: pointing at the folder they are already in is all this needs. Not offered in a
      // browser that has no picker, where there is nothing the button could do.
      setNeedsSource(supportsFolderSelection());
      return;
    }

    let manifest;
    try { const response = await getSelectedManifest(projectId, folder?.id); manifest = response.data; }
    catch (error) { setState("error"); setMessage(error.message || "Unable to load the selected photos list."); return; }
    if (!Array.isArray(manifest) || !manifest.length) { setState("error"); setMessage(folder ? `No photos have been selected for ${folder.name} yet.` : "No photos have been selected by the client yet."); return; }

    const downloads = manifest.map((item) => ({ item, imageId: getImageId(item), fileName: item?.fileName || `image-${getImageId(item) || "unknown"}`, originalPath: item?.originalPath || null, trails: trailsFor(item) }));
    const invalid = downloads.find((download) => !download.imageId);
    if (invalid) {
      console.error("Cannot download selected image: missing image ID.", invalid.item);
      setState("error"); setMessage("A selected photo is missing its image ID. Refresh the gallery and try again."); return;
    }

    // Progress counts saved copies, not source photos: a photo picked for several selection items
    // is written once under each, so counting photos would end the bar at 33/33 while the summary
    // says 40 were saved. The total is every copy this download will write.
    const totalCopies = downloads.reduce((sum, download) => sum + download.trails.length, 0);
    setState("downloading"); setProgress({ done: 0, total: totalCopies });
    let saved = 0;
    // A photo whose file has been moved or renamed since it was added is reported at the end; one
    // missing master is not a reason to abandon the rest of the copy.
    const missing = [];
    try {
      for (const image of downloads) {
        // Read straight out of the folder the photos already live in. Nothing is fetched from the
        // server and nothing is re-encoded — this is a copy from one folder to another, on this
        // computer, of the exact bytes the camera wrote.
        let file;
        // A missing photo still advances the bar by every copy it would have written, so the count
        // always reaches its total instead of stalling short of it.
        try { file = await readSourceFile(source.handle, image.originalPath); }
        catch { missing.push(image.fileName); setProgress((prev) => ({ ...prev, done: prev.done + image.trails.length })); continue; }
        for (const subPath of image.trails) {
          // No module folder: the selection item is the first thing under the project, so the tree
          // reads Project ▸ Selection item ▸ Shoot ▸ Folder.
          await storage.write({ blob: file, fileName: image.fileName, subPath });
          saved += 1;
          setProgress((prev) => ({ ...prev, done: prev.done + 1 }));
        }
      }
      // Closes and saves the archive when that is the route this download took, before anything is
      // reported. It has to happen even when photos were missing, or the ones that *were* found
      // would be built into an archive that is then never written.
      const archived = await storage.finish();
      setState(missing.length ? "error" : "done");
      // A complete run is a download, and the dashboard's "Downloaded" card reads the stamp this
      // leaves. Best effort: a role that may download but not write is refused the stamp, and a
      // refused stamp is not a failed download, so nothing here reports it.
      if (!missing.length && saved > 0) markSelectedOriginalsDownloaded(projectId).catch(() => {});
      const count = `${saved} original-quality photo${saved === 1 ? "" : "s"}`;
      if (missing.length) {
        setMessage(`Saved ${count}. ${missing.length} could not be found in "${source.stored?.name || "the photo folder"}": ${missing.slice(0, 3).join(", ")}${missing.length > 3 ? "…" : ""}`);
        // A saved folder can be readable but still be the wrong location for these masters.
        // Offer the picker again so it can be replaced without clearing browser data.
        setNeedsSource(supportsFolderSelection());
        return;
      }
      if (archived) {
        // Named rather than described: the studio has to find this file in Downloads, and the whole
        // point of the archive is that the folders they expect are inside it.
        setMessage(`Saved ${count} into "${archived.path}" in your Downloads folder. Choose a Target Download Path in Settings to save them straight into folders instead.`);
        return;
      }
      const destination = resolveProjectPath({ folderName: storage.folderName, projectName: storage.projectFolderName || projectName }).path;
      setMessage(storage.available
        ? `Saved ${count} into ${destination}.`
        : `Saved ${count}. ${storageReasonMessage(storage.reason, storage.folderName)}`);
    } catch (error) {
      setState("error");
      // A permission or disk error stops the run, but everything written before it is still there.
      setMessage(error.message || "Download interrupted. You can try again — already-saved files are kept.");
    }
  }

  /**
   * Points this browser at the folder the project's photos are already in.
   *
   * Needed for a project whose photos were added before the folder was remembered, added with
   * **Choose Photos** rather than **Choose Folder**, or added on a different computer. Nothing is
   * re-uploaded and nothing changes in the gallery — this only restores the read access that
   * copying a master out requires. Picking must happen in its own click, because a browser grants
   * folder access only on a fresh gesture.
   */
  async function locate() {
    try {
      await pickSourceFolder(projectId);
      setNeedsSource(false);
      setState("idle");
      setMessage("Photo folder set. Click Download Selected again.");
    } catch (error) {
      if (error?.name !== "AbortError") setMessage(error?.message || "Unable to open the folder picker.");
    }
  }

  const busy = state === "fetching" || state === "downloading";
  return (
    // Laid out in a row so it fits inside the single-line workspace header without the
    // status text pushing the bar taller than it is allowed to be.
    <div className="inline-flex max-w-full items-center gap-2">
      {message && <span title={message} className={`truncate text-[10px] ${state === "error" ? "text-red-600" : "text-slate-500"}`}>{message}</span>}
      {!supportsFolderSelection() && state === "idle" && !message && <span className="truncate text-[10px] text-slate-400">Files will go to Downloads.</span>}
      {needsSource && (
        <button type="button" onClick={locate} className="h-8 shrink-0 rounded-md border border-emerald-600 bg-white px-3 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-50">
          Locate Photo Folder
        </button>
      )}
      {/* The label says what the button does and nothing else. Which shoot it scopes to is where
          the button sits — on that shoot's own card — so the name only made the label long enough
          to crowd the header; it survives in the tooltip for anyone who wants it confirmed. */}
      <button type="button" disabled={busy} onClick={start} title={folder ? `Download the photos selected for ${folder.name}` : undefined} className="h-8 shrink-0 rounded-md bg-emerald-600 px-3 text-xs font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60">
        {state === "downloading" ? `Saving ${progress.done}/${progress.total}…` : state === "fetching" ? "Preparing…" : folder ? "Download Selected" : "Download Selected (Original Quality)"}
      </button>
    </div>
  );
}
