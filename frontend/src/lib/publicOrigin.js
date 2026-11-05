/**
 * The origin to put in front of a link somebody outside the studio will open.
 *
 * A CRD document and a quotation are sent to clients, so their links have to name a host the client
 * can reach - not `localhost`, and not whichever machine happened to build the page.
 *
 * `NEXT_PUBLIC_PUBLIC_APP_URL` is the answer when the app is served from a different host than the
 * one people use it on: behind a proxy, or on a staging domain that should still hand out production
 * links. When it is unset the browser's own origin is used, which is correct for every ordinary
 * deployment and needs no configuration at all.
 *
 * What this deliberately no longer does is fall back to a hard-coded studio domain. It did, and that
 * is invisible until the day somebody runs this anywhere else: every client link would have pointed
 * at `operations.dontblinkstudioz.com` regardless of where the app actually was, and nothing on
 * screen would have said so.
 */
export function publicOrigin() {
  const configured = (process.env.NEXT_PUBLIC_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL || "").trim();
  if (configured) return configured.replace(/\/+$/, "");
  // Client components only - these links are built in response to a press, never while rendering
  // on the server, so `window` is there.
  if (typeof window !== "undefined") return window.location.origin.replace(/\/+$/, "");
  return "";
}
