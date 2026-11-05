"use client";

import { useEffect, useSyncExternalStore } from "react";
import useStudioBranding from "@/components/shared/useStudioBranding";
import { faviconFor } from "@/lib/favicon.mjs";

/*
 * Whether the browser's tab strip is dark - `prefers-color-scheme`, which is the browser's own
 * setting and not the application's theme. Read as a store rather than copied into state, so the
 * first client render already knows the strip and no frame wears the wrong mark.
 */
const darkStrip = () => (typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches) || false;
function subscribeToStrip(onChange) {
  const query = window.matchMedia?.("(prefers-color-scheme: dark)");
  if (!query) return () => {};
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/**
 * The studio's mark in the browser tab, on every page this application serves.
 *
 * Mounted once in the root layout rather than per page, which is what puts it on the client's tab
 * as well as the studio's: a proofing link, a gallery, a quotation and the signed-in application
 * are all the same tree, and the tab is the one piece of the studio a client sees before anything
 * has loaded.
 *
 * ── Why a link element rather than Next's metadata ──
 *
 * `metadata.icons` is decided when the page is rendered. The favicon here is a *setting*, changed
 * in the application and expected to show without a reload. So the tag is written here, and
 * rewritten when the setting changes: `useStudioBranding` hands every mounted reader the values
 * Settings has just saved, so the tab changes as the Save lands.
 *
 * Two marks, one per tab strip: Settings holds a favicon for a light strip and one for a dark
 * strip, and the browser's `prefers-color-scheme` says which strip this tab is drawn on. A studio
 * that uploaded one wears it on both - see `faviconFor` - so the query decides only where there is
 * a choice.
 *
 * The page's own `<head>` already carries the studio's marks, written by the server
 * (`faviconIcons` in the root layout), so a tab has the right mark before this component has run;
 * this keeps it right when Settings saves a new one. The bundled mark in `/brand` is what a studio
 * that has uploaded nothing gets.
 */
export default function StudioFavicon() {
  const branding = useStudioBranding();
  const dark = useSyncExternalStore(subscribeToStrip, darkStrip, () => false);
  // Nothing until the branding has been read: the page arrives with the right icons already
  // (`faviconIcons` in the root layout), and answering before the read would put the bundled mark
  // over them for as long as it takes.
  const href = branding ? faviconFor(branding, dark) : "";

  useEffect(() => {
    if (!href || typeof document === "undefined") return;
    /*
     * One tag, replaced rather than added to.
     *
     * Browsers keep every `rel="icon"` they are given and pick among them by their own rules, so
     * appending on each change would leave the old mark to win as often as not. The tag this
     * component owns is marked, so it can be found again without disturbing anything else in the
     * head.
     *
     * A competing tag is *disarmed*, never removed. The marks the server wrote - `metadata.icons`
     * in the root layout - reach the page as `<link rel="icon" href>` elements, and React hoists
     * every one of those into the head as a resource it deletes itself. Detaching one leaves React
     * removing a node whose `parentNode` is already null, which throws "Cannot read properties of
     * null (reading 'removeChild')" out of `commitDeletionEffectsOnFiber` the next time that part
     * of the tree unmounts - a navigation away, most often, so the crash lands nowhere near here.
     * Dropping the `rel` is all the browser needs to ignore a tag, and it leaves the node where
     * React still expects to find it; the `rel` goes back when this effect is torn down.
     */
    const type = href.endsWith(".svg") || href.startsWith("data:image/svg") ? "image/svg+xml" : "image/png";
    const disarmed = [];
    for (const stale of document.querySelectorAll('link[rel="icon"], link[rel="shortcut icon"]')) {
      if (stale.dataset.studioFavicon === "true") continue;
      disarmed.push([stale, stale.getAttribute("rel")]);
      stale.setAttribute("rel", "studio-favicon-replaced");
    }
    let link = document.querySelector('link[data-studio-favicon="true"]');
    if (!link) {
      link = document.createElement("link");
      link.rel = "icon";
      link.dataset.studioFavicon = "true";
      document.head.appendChild(link);
    }
    if (link.getAttribute("href") !== href) link.setAttribute("href", href);
    link.setAttribute("type", type);
    return () => {
      for (const [stale, rel] of disarmed) if (rel !== null) stale.setAttribute("rel", rel);
    };
  }, [href]);

  return null;
}
