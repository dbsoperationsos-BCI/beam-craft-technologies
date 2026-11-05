// const keyFor = (token) => `dbs_gallery_session_${token}`;

// export function getGallerySession(token) {
//   if (typeof window === "undefined") return null;
//   return window.localStorage.getItem(keyFor(token));
// }

// export function setGallerySession(token, sessionToken) {
//   if (typeof window !== "undefined") window.localStorage.setItem(keyFor(token), sessionToken);
// }

// export function clearGallerySession(token) {
//   if (typeof window !== "undefined") window.localStorage.removeItem(keyFor(token));
// }


const keyFor = (token) => `dbs_gallery_session_${token}`;
// A preview session browses without the PIN, so it is kept apart from a verified one: only
// the verified session is remembered across visits.
const previewKeyFor = (token) => `dbs_gallery_preview_${token}`;

export function getGallerySession(token) {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(keyFor(token)) || window.sessionStorage.getItem(previewKeyFor(token));
}

export function isGalleryPreviewSession(token) {
  if (typeof window === "undefined") return false;
  return !window.localStorage.getItem(keyFor(token)) && Boolean(window.sessionStorage.getItem(previewKeyFor(token)));
}

export function setGallerySession(token, sessionToken) {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(previewKeyFor(token));
  window.localStorage.setItem(keyFor(token), sessionToken);
}

export function setGalleryPreviewSession(token, sessionToken) {
  if (typeof window !== "undefined") window.sessionStorage.setItem(previewKeyFor(token), sessionToken);
}

export function clearGallerySession(token) {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(keyFor(token));
  window.sessionStorage.removeItem(previewKeyFor(token));
}