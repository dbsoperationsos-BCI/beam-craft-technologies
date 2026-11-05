/**
 * Where the floating upload dock sends a reader who clicks an upload.
 *
 * Image Selection and Album Proofing keep separate lists of projects, and each mounts the same
 * upload dock under its own routes. An upload therefore belongs to the section it was started in,
 * and clicking it has to return there: sending an album's upload to the Projects page put the
 * reader in the other section, looking for a project that is not in that list.
 *
 * Which section a session belongs to is read from the base its uploads were posted to, because
 * that is the one thing the session already carries that names its module.
 */
export const ALBUM_PROOFING_UPLOADS = "/album-proofs/";
export const ALBUM_PROOFING_PAGE = "/image-selection/album-proofing";
export const IMAGE_SELECTION_PAGE = "/image-selection/projects";

export function uploadSectionPath(session) {
  return String(session?.uploadsBase || "").includes(ALBUM_PROOFING_UPLOADS) ? ALBUM_PROOFING_PAGE : IMAGE_SELECTION_PAGE;
}

/**
 * The deep link back to the project (and the folder being uploaded into). `at` only makes each
 * click a distinct URL, so clicking again after browsing elsewhere still navigates back.
 */
export function uploadSessionHref(session, at = Date.now()) {
  const params = new URLSearchParams({ projectId: String(session?.projectId ?? "") });
  if (session?.folderId) params.set("folderId", String(session.folderId));
  params.set("at", String(at));
  return `${uploadSectionPath(session)}?${params.toString()}`;
}
