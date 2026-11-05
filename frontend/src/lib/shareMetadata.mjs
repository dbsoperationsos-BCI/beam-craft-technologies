/**
 * What a chat app shows when a client link is pasted into it - the title, the line under it and the
 * picture (Open Graph and Twitter cards). WhatsApp, Facebook and LinkedIn read these, not the
 * favicon, and a page that sets none inherits the root layout's description and falls back to an
 * app icon for the picture.
 *
 * The name and the picture are the studio's own, from Settings → Branding (the public
 * `/api/public/studio-branding`, read on the server by `serverStudioBranding`) - never a name or a
 * card written into the code. With no name set the title is the page's name alone; with no logo
 * there is no picture, rather than somebody else's. The picture is named by an absolute URL because
 * a crawler does not resolve a relative one reliably. Nothing about the quotation itself goes in:
 * the token in the link is its only secret, and a preview is shown to whoever it is forwarded to.
 *
 * Kept free of Next so `node --test` can hold the rules; `requestOrigin.js` supplies the origin.
 */
export const QUOTATION_SHARE_DESCRIPTION = "View your quotation securely.";

/** The studio's name from its branding, trimmed, or "" where none is set. */
function studioNameOf(branding) {
  return String(branding?.studioName ?? "").trim();
}

/** A page's title with the studio's name after it - "Quotation | <studio>" - or the page's name alone. */
export function brandedTitle(page, branding) {
  const name = studioNameOf(branding);
  return name ? `${page} | ${name}` : page;
}

/**
 * The studio's logo as a picture a crawler can fetch, or null: an absolute http(s) link as stored,
 * or a path on this site made absolute against `origin`. A local address never goes into a card -
 * no crawler can reach it - and an https page is not given an http picture.
 */
export function shareImageUrl(branding, origin = null) {
  const logo = String(branding?.galleryLogoUrl ?? "").trim();
  if (!logo) return null;
  let url = null;
  if (/^https?:\/\//i.test(logo)) url = logo;
  else if (logo.startsWith("/") && !logo.startsWith("//") && origin) url = `${origin}${logo}`;
  if (!url) return null;
  let parsed;
  try { parsed = new URL(url); } catch { return null; }
  if (/^(localhost|127\.0\.0\.1|0\.0\.0\.0)$/i.test(parsed.hostname)) return null;
  if (parsed.protocol === "http:" && String(origin || "").startsWith("https:")) return null;
  return parsed.toString();
}

/**
 * The origin the link was opened on: the configured public URL where there is one, else the host
 * the request came to (behind the proxy, the one it forwarded). Null when neither is usable, so no
 * `localhost` or malformed host ever ends up in a card.
 */
export function shareOrigin({ configured = "", host = "", proto = "" } = {}) {
  const fixed = String(configured || "").trim().replace(/\/+$/, "");
  if (/^https?:\/\/[^\s/]+$/i.test(fixed)) return fixed;
  const name = String(host || "").split(",")[0].trim();
  if (!/^[a-z0-9.-]+(:\d+)?$/i.test(name)) return null;
  const local = /^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(name);
  const scheme = String(proto || "").split(",")[0].trim().toLowerCase();
  return `${scheme === "http" || scheme === "https" ? scheme : local ? "http" : "https"}://${name}`;
}

/**
 * The whole metadata for one public client page: title, description, Open Graph and Twitter.
 * `page` is the page's own name ("Quotation"); `branding` the studio's public branding, or null
 * where it could not be read - which still gives a title, just without the studio's name.
 */
export function clientShareMetadata({ page, branding = null, description = QUOTATION_SHARE_DESCRIPTION, origin = null, path = "/", referrer }) {
  const title = brandedTitle(page, branding);
  const siteName = studioNameOf(branding);
  const url = origin ? `${origin}${path}` : undefined;
  const imageUrl = shareImageUrl(branding, origin);
  // A logo is not a 1200x630 card, so no size is claimed and the smaller card is asked for.
  const image = imageUrl ? { url: imageUrl, alt: siteName || page } : null;
  return {
    title,
    description,
    // Never indexed: the token in the URL is the whole of the secrecy here.
    robots: { index: false, follow: false },
    // A page whose address is its credential can keep it from being sent on to the hosts it loads from.
    ...(referrer ? { referrer } : {}),
    openGraph: { type: "website", ...(siteName ? { siteName } : {}), title, description, ...(url ? { url } : {}), ...(image ? { images: [image] } : {}) },
    twitter: { card: "summary", title, description, ...(image ? { images: [image.url] } : {}) },
  };
}
