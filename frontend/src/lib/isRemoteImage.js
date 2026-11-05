// Derivatives stored in Cloudflare R2 are serialized by the API as absolute URLs on a
// public bucket. Those load directly into an <img> tag: no Authorization header, and no
// CORS preflight, which a fetch() to another origin would require.
//
// Anything relative is a same-origin API route that still needs the authenticated fetch,
// which is how every image uploaded before the move to object storage is served.
export default function isRemoteImage(src) {
  return /^https?:\/\//i.test(String(src || ""));
}
