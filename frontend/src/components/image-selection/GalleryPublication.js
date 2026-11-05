"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import FloatingNotice, { useNotice } from "@/components/shared/FloatingNotice";
import DownloadSelectedButton from "./DownloadSelectedButton";
import { PROGRESS_CHIP_CLASS, PROGRESS_COLORS, progressChipStyle } from "@/lib/progressStatus.mjs";
import { getGalleryPublication, listImageSelectionDeliverables, publishGallery, revokeGallery, regeneratePin } from "@/services/image-selection/image-selection.service";

/**
 * Is there a selection to collect?
 *
 * All three answers have to be yes. The gallery has to still be published — unpublishing withdraws
 * it from the client, so the studio should not still be invited to pull originals out of it. The
 * client has to have reviewed and sent, because a selection they are still making is not one to act
 * on. And what they sent has to contain photos: a client can reach the end of the gallery and send
 * without ticking anything, and the download built from that has nothing in it. Offering the button
 * anyway put the studio one click from "No photos have been selected by the client yet.", which
 * reads as a fault when it is simply the client's answer.
 *
 * A gallery that fails the test says nothing about why — the header goes back to reporting the
 * publish state, as it does at every other point before a selection arrives.
 */
function canCollect(publication) {
  return publication?.status === "PUBLISHED" && Boolean(publication.selectionSubmittedAt) && (publication.selectedCount || 0) > 0;
}

// `folder` is the shoot folder open in the workspace, or null at the project root. The client
// submits and the studio collects one shoot at a time, so the compact header offers the download
// for the shoot in view once that shoot's selection items are all submitted — scoped to that
// folder's photos. A Project Management shoot folder names its shoot by id; a manual project's
// root folder pairs with the shoot group of the same name, the same pairing the client gallery
// lists and submits that group under.
//
// `linked` says whether the project has a Project Management job behind it. Only a linked
// project keeps the whole-project fallback download inside a folder with no shoot behind it; a
// manual project downloads shoot-wise or not at all — a project-wide archive of a manual
// project is never offered.
// `canWrite` is IMAGE_SELECTION / Project Management at READ_WRITE. Reading a published gallery -
// copying its URL, opening it, seeing the PIN - stays either way; publishing it, rotating the PIN
// and unpublishing do not.
export default function GalleryPublication({ projectId, projectName, refreshKey, compact = false, folder = null, linked = true, onCollectingChange, canWrite = true }) {
  const [publication, setPublication] = useState(null); const [busy, setBusy] = useState(false); const [showPin, setShowPin] = useState(false);
  const { notice, showSuccess, showError, clearNotice } = useNotice();
  // The per-item submission flags, needed only to decide the compact header's shoot download.
  const [deliverables, setDeliverables] = useState(null);
  useEffect(() => {
    if (!compact) return undefined;
    let active = true;
    listImageSelectionDeliverables(projectId)
      .then((response) => { if (active) setDeliverables(response.data || []); })
      .catch(() => { if (active) setDeliverables([]); });
    return () => { active = false; };
  }, [projectId, compact, refreshKey]);
  // Matched the way the client gallery matches a group to its folder: by name, trimmed and
  // case-insensitive.
  const nameKey = (value) => String(value || "").trim().toLowerCase();
  const shootItems = folder && deliverables
    ? deliverables.filter((item) => item.enabled && !item.inactiveAt && (folder.projectShootId
        ? item.shootId === folder.projectShootId
        : Boolean(item.shootId) && nameKey(item.shoot?.shoot) === nameKey(folder.name)))
    : [];
  // Any one submitted item is enough to offer the shoot's download: items submit one at a time
  // now, and the manifest itself only hands over photos of submitted items, so an early download
  // simply holds what has been sent so far.
  const shootSubmitted = shootItems.some((item) => item.selectionSubmittedAt);
  // True when the folder in view stands for a shoot — a Project Management shoot folder, or a
  // root folder carrying a shoot group of its name — and the download should be scoped to it.
  const folderIsShoot = Boolean(folder?.projectShootId) || shootItems.length > 0;
  const load = useCallback(async () => { try { const response = await getGalleryPublication(projectId); setPublication(response.data); } catch (error) { showError(error.message || "Unable to load publish status."); } }, [projectId, showError]);
  useEffect(() => { const timer = window.setTimeout(load, 0); return () => window.clearTimeout(timer); }, [load, refreshKey]);
  // Whether the compact header shows the download button instead of the state badge. Never at the
  // project root — the download belongs to a shoot, and opening a project is not yet a claim on
  // any shoot's photos. Inside a folder that stands for a shoot — by id or by name — it is that
  // shoot's own submission state. Inside a folder with no shoot behind it, only a linked project
  // falls back to the project-wide rule; a manual project shows nothing there, because its
  // downloads are shoot-wise or not at all.
  const collecting = publication?.status === "PUBLISHED" && Boolean(folder) && (folderIsShoot ? shootSubmitted : linked && canCollect(publication));
  // What the parent header needs to know is not "has the client submitted" but "is this header
  // showing the wide Download Selected button instead of the state badge" — the exact condition the
  // compact branch below renders on. Reported from the render condition itself rather than from the
  // load call, so unpublishing hands the row back to the badge and the header's "Updated:" label at
  // the same moment, without waiting for the next reload.
  useEffect(() => { onCollectingChange?.(collecting); }, [collecting, onCollectingChange]);
  // The short public URL the backend built; the origin-plus-long-path build survives only as a
  // fallback for a publication row that has not picked up its short code yet.
  const clientUrl = useMemo(() => publication?.clientUrl || (publication?.clientPath && typeof window !== "undefined" ? `${window.location.origin}${publication.clientPath}` : ""), [publication]);
  async function publish() { setBusy(true); try { const response = await publishGallery(projectId); setPublication(response.data); showSuccess("Gallery published."); setShowPin(true); } catch (error) { showError(error.message || "Unable to publish gallery."); } finally { setBusy(false); } }
  async function revoke() { setBusy(true); try { const response = await revokeGallery(projectId); setPublication(response.data); showSuccess("Gallery unpublished."); } catch (error) { showError(error.message || "Unable to unpublish gallery."); } finally { setBusy(false); } }
  async function rotatePin() { setBusy(true); try { const response = await regeneratePin(projectId); setPublication(response.data); showSuccess("New PIN generated."); setShowPin(true); } catch (error) { showError(error.message || "Unable to generate a new PIN."); } finally { setBusy(false); } }
  async function copyUrl() { try { await navigator.clipboard.writeText(clientUrl); showSuccess("URL copied."); } catch { showError("Unable to copy. Select the URL manually."); } }
  async function copyPin() { try { await navigator.clipboard.writeText(publication.pin); showSuccess("PIN copied."); } catch { showError("Unable to copy. Select the PIN manually."); } }
  const floatingNotice = <FloatingNotice notice={notice} onClose={clearNotice} />;
  if (!publication) return <>{floatingNotice}<span className="text-[10px] text-slate-500">Loading publish status…</span></>;
  const published = publication.status === "PUBLISHED";
  // The publish state wears the product-wide progress chip — published is the ladder's green,
  // unpublished its "not started" bronze — so it matches the shoot chips below it in every theme
  // instead of keeping a light-mode emerald that no dark theme recolors.
  const badge = <span className={`${PROGRESS_CHIP_CLASS} rounded-full px-2 py-1 text-[10px] font-semibold`} style={progressChipStyle(published ? PROGRESS_COLORS.completed : PROGRESS_COLORS.notStarted)}>{published ? "Published" : "Unpublished"}</span>;
  // Once the client has sent a selection with photos in it, the header stops reporting the publish
  // state and offers the one action left: collecting the chosen photos. Anything else — still
  // choosing, sent nothing, or unpublished since — goes back to reporting the state, and the button
  // returns on its own once there is something to collect. The selection is kept throughout.
  // Inside a shoot folder the download is that shoot's: offered as soon as the client submits any
  // of its selection items, and fetching only the submitted items' photos, so an Engagement album
  // collected in March is not held hostage by anything not yet sent. The same holds for a manual
  // project's root folder carrying the shoot group of its name.
  // Keyed by the folder the download is scoped to, so moving from one shoot folder to another
  // remounts the button: without the key, the "Saved N photos into …" message and progress from the
  // previous shoot's download survive the folder change and read as that shoot's result.
  if (compact && collecting) return <>{floatingNotice}<DownloadSelectedButton key={folderIsShoot ? folder?.id ?? "shoot" : "project"} projectId={projectId} projectName={projectName} folder={folderIsShoot ? folder : null} /></>;
  if (compact) return <div className="flex items-center gap-2">{floatingNotice}{badge}</div>;
  return (
    <div className="flex max-w-full flex-wrap items-center justify-end gap-2">
      {floatingNotice}
      {badge}
      {published && clientUrl ? (
        <>
          {!compact && <input readOnly value={clientUrl} onFocus={(event) => event.target.select()} aria-label="Client gallery URL" className="h-8 w-52 rounded-md border border-slate-300 bg-white px-2 text-[10px] text-slate-600 sm:w-72" />}
          <button type="button" onClick={copyUrl} className="h-8 rounded-md border border-slate-300 px-3 text-xs">{compact ? "Copy Client URL" : "Copy URL"}</button>
          <a href={clientUrl} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center rounded-md border border-slate-300 px-3 text-xs">Open</a>
          <div className="inline-flex items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-2 py-1">
            <span className="text-[10px] font-semibold text-blue-700">PIN:</span>
            <span className="font-mono text-xs font-semibold text-blue-900">{showPin ? (publication.pin || "—") : "••••"}</span>
            <button type="button" onClick={() => setShowPin((value) => !value)} aria-label={showPin ? "Hide PIN" : "Show PIN"} className="text-[10px] text-blue-700 underline">{showPin ? "Hide" : "Show"}</button>
            {showPin && publication.pin && <button type="button" onClick={copyPin} className="text-[10px] text-blue-700 underline">Copy</button>}
          </div>
          {canWrite && <button type="button" disabled={busy} onClick={rotatePin} className="h-8 rounded-md border border-slate-300 px-3 text-xs">New PIN</button>}
          {canWrite && <button type="button" disabled={busy} onClick={revoke} className="h-8 rounded-md border border-red-200 px-3 text-xs text-red-600 disabled:opacity-50">Unpublish</button>}
          {publication.selectionSubmittedAt && (
            <span className="w-full text-right text-[10px] text-emerald-700">
              Client sent their selection on {new Date(publication.selectionSubmittedAt).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
              {publication.selectedCount ? ` — ${publication.selectedCount} photo${publication.selectedCount === 1 ? "" : "s"}` : ""}
            </span>
          )}
        </>
      ) : (
        canWrite ? <button type="button" disabled={busy || publication.imageCount === 0} onClick={publish} className="h-8 rounded-md bg-blue-600 px-3 text-xs font-semibold text-white disabled:opacity-50">{busy ? "Publishing…" : "Publish Gallery"}</button> : null
      )}
    </div>
  );
}
