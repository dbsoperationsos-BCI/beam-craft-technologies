import downloadImage from "@/lib/downloadImage";
import { copyToClipboard } from "@/lib/clipboard";

/**
 * The small things the guest page does that are not rendering: saving a photo, sharing the link,
 * telling an expired session from any other failure, and working out which tabs the event opens.
 * Pure enough to sit apart from the components, and shared by more than one of them.
 */

/** The soft blue the public gallery's primary control wears, so the two public pages match. */
export const PRIMARY_BUTTON = "inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-[#7fa4fa] px-5 text-sm font-semibold text-white transition hover:bg-[#638df0] focus:outline-none focus:ring-4 focus:ring-blue-200 disabled:cursor-not-allowed disabled:opacity-50";
export const SECONDARY_BUTTON = "inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 focus:outline-none focus:ring-4 focus:ring-blue-100 disabled:cursor-not-allowed disabled:opacity-50";

export const PAGE_SIZE = 60;

/** A 401 from any guest call: the session is gone and the join screen is the only way back. */
export const isSessionExpired = (error) => Number(error?.status) === 401;

/**
 * Saves a photo the guest is looking at. The bucket is another origin, so the bytes are fetched
 * and handed to the shared helper; a bucket that refuses the cross-origin read still gets the
 * guest their picture, in a new tab, rather than a silent nothing.
 */
export async function downloadGuestPhoto(item, baseName) {
  const url = item?.downloadUrl;
  if (!url) throw new Error("This photo cannot be downloaded.");
  try {
    await downloadImage(url, baseName, async () => {
      const response = await fetch(url);
      if (!response.ok) throw new Error("The photo could not be fetched.");
      return response.blob();
    });
    return "saved";
  } catch {
    window.open(url, "_blank", "noopener");
    return "opened";
  }
}

/** The page's own link, through the phone's share sheet where there is one, the clipboard otherwise. */
export async function shareGuestLink(title) {
  const url = window.location.href;
  if (typeof navigator !== "undefined" && navigator.share) {
    try { await navigator.share({ title, url }); return "shared"; }
    catch (error) { if (error?.name === "AbortError") return "cancelled"; }
  }
  return (await copyToClipboard(url)) ? "copied" : "failed";
}

/** The tabs this event's settings open, in the order they sit on the bar. */
export function guestTabsFor(meta) {
  const tabs = [];
  if (meta?.gallery?.showAllPhotos) tabs.push({ id: "all", label: "All Photos" });
  if (meta?.gallery?.showMyPhotos) tabs.push({ id: "mine", label: "My Photos" });
  if (meta?.gallery?.showAllPhotos && meta?.schedule?.length) tabs.push({ id: "subEvents", label: "Sub Events" });
  if (meta?.features?.selfieSearch) tabs.push({ id: "find", label: "Find My Photos" });
  return tabs;
}

/** Where a guest lands: on their own photos once a selfie is in, otherwise on the gallery. */
export function defaultGuestTab(tabs, guest) {
  const ids = tabs.map((tab) => tab.id);
  if (guest?.selfieStatus === "UPLOADED" && ids.includes("mine")) return "mine";
  if (ids.includes("all")) return "all";
  if (ids.includes("find")) return "find";
  return ids[0] || "mine";
}

/** A file name stem for a saved photo: the event, then the photo's place in the list. */
export const photoBaseName = (eventName, index) => `${eventName || "event"}-${String(index + 1).padStart(3, "0")}`;
