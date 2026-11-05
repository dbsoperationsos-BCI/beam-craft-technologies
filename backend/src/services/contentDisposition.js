/**
 * A header-safe `Content-Disposition: attachment` for any file name: an ASCII `filename` with
 * anything outside printable ASCII, quotes and backslashes replaced, and the real name in
 * `filename*` for the browsers that read it. Shared by every route that hands back a file.
 */
function attachmentDisposition(name) {
  return `attachment; filename="${String(name).replace(/[^\x20-\x7e]|["\\]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

module.exports = { attachmentDisposition };
