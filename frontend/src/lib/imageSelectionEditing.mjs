/**
 * Pure helpers for the AI Editing workspace. Plain module (no React) so `node --test` can hold
 * the rules: what a photo's tile says, when the bay must keep polling, how a render's answer
 * is read back into the sliders, and how the keyboard moves between the bay's photos.
 */
import { PROGRESS_COLORS } from "./progressStatus.mjs";
import { ADJUSTMENTS, TOOLS, defaultToolSettings, normalizeRecipe, recipeIsEmpty } from "./aiEditingRecipe.mjs";

/**
 * One word for where a photo of the bay stands, with the palette colour its chip takes:
 * uploading (its derivatives have not arrived), failed-upload, untouched (in the bay, no edit yet),
 * draft (a recipe saved, not rendered), rendering, waitingForDesktop (the original lives only on a
 * studio workstation, so the desktop app that holds it renders it), edited (rendered, nothing changed
 * since), changed (rendered, then the recipe changed), failed (the render failed) - and `sent…` flags
 * beside it.
 */
export function editingPhotoStatus(photo) {
  if (!photo) return { id: "untouched", label: "Not edited", color: PROGRESS_COLORS.notStarted };
  if (photo.status === "PROCESSING_FAILED") return { id: "failedUpload", label: "Upload failed", color: PROGRESS_COLORS.partiallyCompleted };
  if (photo.status !== "READY") return { id: "uploading", label: "Uploading", color: PROGRESS_COLORS.inProgress };
  const edit = photo.edit;
  if (!edit || (!edit.hasOutput && recipeIsEmpty(edit.recipe) && edit.status !== "QUEUED" && edit.status !== "RENDERING" && edit.status !== "WAITING_FOR_DESKTOP" && edit.status !== "FAILED")) return { id: "untouched", label: "Not edited", color: PROGRESS_COLORS.notStarted };
  if (edit.status === "QUEUED" || edit.status === "RENDERING") return { id: "rendering", label: edit.status === "QUEUED" ? "Queued" : "Rendering", color: PROGRESS_COLORS.inProgress };
  if (edit.status === "WAITING_FOR_DESKTOP") return { id: "waitingForDesktop", label: "Waiting for workstation", color: PROGRESS_COLORS.inProgress };
  if (edit.status === "FAILED") return { id: "failed", label: "Render failed", color: PROGRESS_COLORS.partiallyCompleted };
  if (edit.status === "RENDERED" && edit.hasOutput) return edit.dirty ? { id: "changed", label: "Edited · changes not applied", color: PROGRESS_COLORS.partiallyCompleted } : { id: "edited", label: "Edited", color: PROGRESS_COLORS.completed };
  return { id: "draft", label: "Edit saved, not applied", color: PROGRESS_COLORS.notStarted };
}

/**
 * Whether the bay has to keep asking the server: a photo still uploading, a render in flight, or a
 * render waiting for the desktop app that holds the original (its answer lands server-side).
 */
export function editingNeedsPolling(photos = []) {
  return photos.some((photo) => photo.status === "PROCESSING" || photo.status === "PENDING" || photo.status === "UPLOADING" || photo.edit?.status === "QUEUED" || photo.edit?.status === "RENDERING" || photo.edit?.status === "WAITING_FOR_DESKTOP" || photo.edit?.albumSync?.state === "pending");
}

/**
 * The three ways the desktop app can fail to open an original, and the studio's words for each -
 * identical to the backend's and the desktop's (`LOCAL_SOURCE_CODES`), so the same failure reads the
 * same wherever it is shown. The server already writes these words into `edit.error`; the panel uses
 * this to say them for an `errorCode` on its own too.
 */
export const LOCAL_SOURCE_WORDS = Object.freeze({
  LOCAL_SOURCE_UNAVAILABLE: "Original file is unavailable on this workstation. Reconnect the storage/NAS or remap the storage root, then try again.",
  LOCAL_SOURCE_CHANGED: "The original on this workstation is not the file that was added (its size or checksum differs). Check the file, then try again.",
  LOCAL_SOURCE_UNREADABLE: "The original could not be decoded on this workstation, so it was not analysed.",
});
export const LOCAL_SOURCE_CODES = Object.freeze(Object.keys(LOCAL_SOURCE_WORDS));

/** Why a render failed on the workstation, in the studio's words - "" when the failure was not that. */
export function editingLocalSourceLine(edit) {
  return (edit?.errorCode && LOCAL_SOURCE_WORDS[edit.errorCode]) || "";
}

/**
 * The line under a render that waits for the desktop app: what is happening and, for somebody who
 * may act on it, the two ways out. A viewer is told only what is happening - an instruction they
 * cannot follow is noise.
 */
export function editingWaitingLine(photo, canWrite = true) {
  if (!photo?.edit?.waitingForDesktop && photo?.edit?.status !== "WAITING_FOR_DESKTOP") return "";
  if (!canWrite) return "Waiting for the studio workstation to render this photo from the original.";
  return "Only the desktop app that holds this original can render it from the original. Open the project in the desktop app, or render from the web preview (1600px) instead - the original stays untouched.";
}

/** What the tile shows: the rendered output once there is one, else the photo as uploaded. */
export function editingTileImage(photo) {
  const edit = photo?.edit;
  if (edit?.hasOutput && edit.outputThumbnailUrl) return { src: edit.outputThumbnailUrl, edited: true };
  return { src: photo?.thumbnailUrl || "", edited: false };
}

/**
 * The sliders after a render: a slider the photographer left to the AI (null) stays Auto, with the
 * number the render chose shown beside it (`autoValues`); one they set keeps their number.
 */
export function autoValuesOf(edit) {
  const applied = edit?.appliedRecipe?.adjustments;
  if (!applied) return {};
  const saved = normalizeRecipe(edit.recipe).adjustments;
  const out = {};
  for (const [key, value] of Object.entries(saved)) if (value === null && typeof applied[key] === "number") out[key] = applied[key];
  return out;
}

/** The one line under the preview that says what the render read, honestly. */
export function editingSourceLine(edit) {
  if (!edit?.hasOutput) return "";
  if (edit.sourceKind === "ORIGINAL") return "Rendered from the original file.";
  if (edit.sourceKind === "ORIGINAL_LOCAL") return "Rendered on the desktop app from the original file on the studio's computer - the original was never uploaded.";
  if (edit.sourceKind === "PREVIEW") return "Rendered from the uploaded preview - the original stays on the studio's machine.";
  return "";
}

/**
 * The short text under a tile: where the photo has gone from here. AI Editing's one destination
 * is the Signature Album, so that is the only send named. Nothing about Photo Selection is said
 * in AI Editing - not that a photo is in it, not that one was once sent there - the two are
 * separate workspaces with no link between them on this tab (the server's own Photo Selection
 * fields on the row stay for its bookkeeping; the bay does not draw them).
 */
/**
 * Where the photo went - or, for a photo sent from AI Culling as "AI Editing + Signature Album",
 * where its automatic album sync stands (the server's `edit.albumSync`): its edits go to the album
 * on their own, so the line says whether this edit is there yet.
 */
const ALBUM_SYNC_LINES = {
  waiting: "Signature Album: updates when you apply an edit",
  rendering: "Signature Album: updates when this edit is saved",
  pending: "Signature Album: updating…",
  synced: "In the Signature Album - this edit",
  failed: "Signature Album update failed",
};
export function editingSentLine(photo) {
  const sync = photo?.edit?.albumSync;
  if (sync?.state) return ALBUM_SYNC_LINES[sync.state] || "";
  return photo?.edit?.sentToAlbum ? "Sent to Signature Album" : "";
}
/** Whether this photo's automatic album sync failed and can be retried. */
export const editingAlbumSyncFailed = (photo) => photo?.edit?.albumSync?.state === "failed";

/** The bay's header line. */
export function editingCountsLine(counts) {
  if (!counts) return "";
  const parts = [`${counts.total} photo${counts.total === 1 ? "" : "s"}`];
  if (counts.uploading) parts.push(`${counts.uploading} uploading`);
  if (counts.rendering) parts.push(`${counts.rendering} rendering`);
  if (counts.waitingForDesktop) parts.push(`${counts.waitingForDesktop} waiting for workstation`);
  if (counts.rendered) parts.push(`${counts.rendered} edited`);
  if (counts.failedRenders) parts.push(`${counts.failedRenders} failed`);
  return parts.join(" · ");
}

/** The engine chip: a word and a colour from the capabilities answer. */
export function editingEngineStatus(capabilities) {
  const status = capabilities?.engine?.status;
  if (status === "ready") return { label: "AI ready", color: PROGRESS_COLORS.completed };
  if (status === "starting") return { label: "AI starting", color: PROGRESS_COLORS.inProgress };
  if (status === "disabled") return { label: "AI off on this server", color: PROGRESS_COLORS.notStarted };
  if (status === "offline") return { label: "AI engine offline", color: PROGRESS_COLORS.partiallyCompleted };
  if (status === "unknown") return { label: "AI status unknown", color: PROGRESS_COLORS.partiallyCompleted };
  return { label: "Checking AI", color: PROGRESS_COLORS.notStarted };
}

/** What the engine read in the photo, in the studio's words: scene, light, what it recovered. */
const SCENE_WORDS = { bride_portrait: "bride portrait", groom_portrait: "groom portrait", couple: "couple", portrait: "portrait", family: "family", group: "group", candid: "candid", ceremony: "ceremony", getting_ready: "getting ready", reception: "reception", decor: "decor", details: "details", venue: "venue" };
const LIGHT_WORDS = { daylight: "daylight", cloudy: "soft daylight", tungsten: "warm indoor light", mixed: "mixed light", night: "night light", indoor: "indoor light" };
export function describeAnalysis(analysis) {
  if (!analysis) return "";
  const parts = [`${SCENE_WORDS[analysis.scene] || analysis.scene || "photo"}`, LIGHT_WORDS[analysis.lighting] || analysis.lighting];
  if (analysis.cast && analysis.cast !== "neutral") parts.push(`${analysis.cast.replace("+", " and ")} cast corrected`);
  const found = [];
  if (analysis.brightDress) found.push("a bright dress");
  if (analysis.darkSuit) found.push("a dark suit");
  if (analysis.backlit) found.push("a backlit face");
  if (analysis.sky) found.push("sky");
  if (found.length) parts.push(`${found.join(", ")} recovered`);
  const faces = Number(analysis.faces) || 0;
  if (faces) parts.push(`${faces} face${faces === 1 ? "" : "s"}`);
  return `Read as ${parts.join(" · ")}.`;
}

/** What the reference photo asked for, in words rather than numbers. */
export function describeReference(analysis) {
  if (!analysis) return "";
  const word = (value, up, down, strong = 25) => (Math.abs(value) < 5 ? "" : `${Math.abs(value) >= strong ? "much " : "slightly "}${value > 0 ? up : down}`);
  const parts = [word(analysis.exposure, "brighter", "darker"), word(analysis.contrast, "more contrast", "softer"), word(analysis.temperature, "warmer", "cooler"), word(analysis.saturation, "more colour", "more muted")].filter(Boolean);
  return parts.length ? `The reference reads ${parts.join(", ")}; this photo was moved that way.` : "The reference's look is close to this photo's already.";
}

/**
 * The editor's keyboard: which way a key moves between the bay's photos - Left / Right step,
 * Home / End jump to the ends - or null for any other key. A chord with a modifier is the
 * browser's or the control's, never a move. Whether the key is being typed into a control is the
 * listener's question (`cullingKeyIgnored`), not this one's.
 */
const NAVIGATION_KEYS = Object.freeze({ ArrowLeft: "prev", ArrowRight: "next", Home: "first", End: "last" });
export function editingNavigationKey(event) {
  if (!event || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return null;
  return NAVIGATION_KEYS[event.key] || null;
}

/**
 * Where a move lands among `count` photos from `index`, or null when it lands nowhere: the list
 * clamps at its ends (the culling review's rule - nothing wraps), so the last photo's Right and
 * the first's Left answer null, which the bay may read as "turn the page".
 */
export function editingNavigationTarget(direction, index, count) {
  if (!count || index < 0 || index >= count) return null;
  const target = direction === "first" ? 0 : direction === "last" ? count - 1 : direction === "prev" ? index - 1 : direction === "next" ? index + 1 : null;
  if (target === null || target < 0 || target >= count || target === index) return null;
  return target;
}

/** "3 of 20": the open photo's place in the bay, counted across its pages; "" when it has none. */
export function editingPositionLine(position) {
  if (!position || !(position.total > 0) || !(position.index >= 0)) return "";
  return `${position.index + 1} of ${position.total}`;
}

/**
 * The viewer frame's size - from the workspace, not from the photograph. The editor's column is
 * the frame's widest; the room left under the compare toolbar and above the action bar is its
 * tallest. That room is measured from the layout by the preview and written to the CSS variable
 * `--editing-viewer-max` on the frame's wrapper (the fallback below - the viewport less a typical
 * shell, project header and bars - stands in until the first measurement and on the server).
 * The width is worked out FROM that height and the photo's own ratio, so the frame always hugs
 * the photo: a landscape frame fills the column, a portrait frame stands as tall as the room
 * allows and no wider, and neither letterboxes, which keeps the Split divider's geometry exact.
 * The photo inside is object-contain, never stretched or cropped. One rule for Before / After,
 * Split and each Side by side panel.
 */
export const EDITING_VIEWER_FALLBACK_HEIGHT = "clamp(14rem, calc(100vh - 22rem), 64rem)";
export const EDITING_VIEWER_MAX_HEIGHT = `var(--editing-viewer-max, ${EDITING_VIEWER_FALLBACK_HEIGHT})`;
export function editingViewerFrame(dimensions) {
  const width = Number(dimensions?.width) > 0 ? Number(dimensions.width) : 3;
  const height = Number(dimensions?.height) > 0 ? Number(dimensions.height) : 2;
  return { aspectRatio: `${width} / ${height}`, width: `min(100%, calc(${EDITING_VIEWER_MAX_HEIGHT} * ${width} / ${height}))` };
}
/**
 * The room the frame may take, in pixels, from where the frame starts to the bottom of the pane it
 * scrolls in, less what sits under the frame (the navigation row, the action bar, their borders
 * and margins: 10rem); never under
 * 14rem, never over 64rem. Pure arithmetic over numbers the preview measures.
 */
export const EDITING_VIEWER_RESERVE_REM = 10;
export function editingViewerRoom({ paneHeight, frameTop, rem = 16 }) {
  const room = paneHeight - frameTop - EDITING_VIEWER_RESERVE_REM * rem;
  return Math.round(Math.min(64 * rem, Math.max(14 * rem, room)));
}

/**
 * The section switches in the editor's headers (AI tools, Retouching, Basic adjustments). Their
 * state is never stored: it is read off the recipe every time, so a switch can never disagree with
 * the rows under it, and every press is an ordinary recipe change (saved, rendered, reset like any
 * other). Each section reads and writes only its own part of the recipe.
 *
 * Tools: a tool is on when it is in `recipe.tools` - the same rule its own row uses. A section's
 * switch covers the tools of that group this server can run, except one that needs the
 * photographer's own input to do anything (Remove Object waits for painted areas), which stays
 * that row's alone. Switching on adds each covered tool with its settings kept if it was on, its
 * defaults otherwise; switching off removes the covered tools - exactly what each row's own switch
 * does, all at once.
 */
export function sectionToolIds(group, capabilities) {
  return TOOLS.filter((spec) => spec.group === group && !spec.masks && toolAvailability(capabilities, spec.id).available).map((spec) => spec.id);
}
/** "on" (every covered tool on), "off" (none) or "mixed"; "off" when the section covers nothing. */
export function toolSectionState(recipe, ids) {
  const on = (ids || []).filter((id) => Boolean(recipe?.tools?.[id])).length;
  return !ids?.length || on === 0 ? "off" : on === ids.length ? "on" : "mixed";
}
/** The recipe with the covered tools all on (`on`) or all off; the rest of the recipe untouched. */
export function setToolSection(recipe, ids, on) {
  const tools = { ...recipe.tools };
  for (const id of ids) {
    if (on) tools[id] = recipe.tools[id] || defaultToolSettings(id);
    else delete tools[id];
  }
  return { ...recipe, tools };
}

/**
 * Basic adjustments are numbers, not switches: 0 means "leave it", `null` "let the AI choose",
 * and only the exposure and white-balance sliders take `null` (the recipe's rule). Inventing a
 * number for a slider would be an edit nobody asked for, so this section's switch hands the
 * sliders to the AI instead: on, every auto-able slider left at 0 becomes Auto; off, every Auto
 * slider goes back to 0. A number the photographer set is never touched, and contrast, vibrance
 * and saturation (which have no Auto) are left to their own sliders. The state: "on" when every
 * auto-able slider is in use (Auto or a number), "off" when no slider is in use, "mixed" between.
 */
export function adjustmentSectionState(recipe) {
  const adjustments = recipe?.adjustments || {};
  const autoAble = ADJUSTMENTS.filter((entry) => entry.auto);
  const inUse = (entry) => adjustments[entry.id] !== 0 && adjustments[entry.id] !== undefined;
  if (!ADJUSTMENTS.some(inUse)) return "off";
  return autoAble.every(inUse) ? "on" : "mixed";
}
export function setAdjustmentSection(recipe, on) {
  const adjustments = { ...recipe.adjustments };
  for (const entry of ADJUSTMENTS) {
    if (!entry.auto) continue;
    if (on && adjustments[entry.id] === 0) adjustments[entry.id] = null;
    if (!on && adjustments[entry.id] === null) adjustments[entry.id] = 0;
  }
  return { ...recipe, adjustments };
}

/** Whether a tool may be switched on here: the server's capability map, or "unknown" before it answers. */
export function toolAvailability(capabilities, toolId) {
  const tools = capabilities?.tools;
  if (!tools) return { available: true, reason: "", partial: false };
  const entry = tools[toolId];
  if (!entry) return { available: true, reason: "", partial: false };
  return { available: entry.available !== false, reason: entry.reason || "", partial: Boolean(entry.partial), engine: entry.engine || "", note: entry.note || "" };
}

/**
 * Download Edited's words for the server's plan (`{ asked, included, excluded }`): what will be
 * downloaded, and what is left out and why - said before the download, so a mixed selection is
 * never a surprise. Only photos with a saved, current edit are ever included.
 */
const EXCLUDED_WORDS = { notEdited: "not edited", outdated: "changed since the last Apply", inProgress: "still rendering", failed: "render failed", missing: "edited file not found in storage" };
export function editedDownloadSummary(plan) {
  const included = plan?.included?.length || 0;
  const excluded = plan?.excluded || {};
  const left = Object.entries(EXCLUDED_WORDS).filter(([key]) => excluded[key] > 0).map(([key, words]) => `${excluded[key]} ${words}`);
  const leftTotal = Object.keys(EXCLUDED_WORDS).reduce((sum, key) => sum + (excluded[key] || 0), 0);
  const photos = (count) => `${count} edited photo${count === 1 ? "" : "s"}`;
  return {
    included,
    leftOut: leftTotal,
    title: included ? `Download ${photos(included)}?` : "No edited photos to download",
    line: !included
      ? `${plan?.asked === 1 ? "This photo has no" : `None of the ${plan?.asked || 0} photos has a`} saved edit to download${left.length ? ` (${left.join(", ")})` : ""}. Apply an edit first.`
      : leftTotal
        ? `${photos(included)} will be downloaded${included > 1 ? " as one ZIP" : ""}. ${leftTotal} not included: ${left.join(", ")}.`
        : `${photos(included)} will be downloaded${included > 1 ? " as one ZIP" : ""}.`,
  };
}

/**
 * Edit Selected: the ticked photos the editor walks, frozen when it begins - by id, never by a
 * place in a page. The ticked photos on the page in view come first, in the bay's order; any
 * ticked on another page follow in the order they were ticked. Nothing unticked is ever in it.
 */
export function editingFocusOrder(selectedIds, pagePhotos = []) {
  const ticked = [...selectedIds];
  const wanted = new Set(ticked);
  const onPage = pagePhotos.map((photo) => photo.id).filter((id) => wanted.has(id));
  const seen = new Set(onPage);
  return [...onPage, ...ticked.filter((id) => !seen.has(id))];
}

/** Where the open photo sits among the walked ones, for the position row ("2 of 4"), or null. */
export function editingFocusPosition(ids, openId, busy = false) {
  const index = ids.indexOf(openId);
  if (index < 0) return null;
  return { index, total: ids.length, canPrev: !busy && index > 0, canNext: !busy && index < ids.length - 1 };
}
