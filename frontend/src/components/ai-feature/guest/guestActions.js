import downloadImage from "@/lib/downloadImage";
import { copyToClipboard } from "@/lib/clipboard";

/**
 * The small things the guest page does that are not rendering: saving a photo, sharing the link,
 * telling an expired session from any other failure, and working out which tabs the event opens.
 * Pure enough to sit apart from the components, and shared by more than one of them.
 */

/** The soft blue the public gallery's primary control wears, so the two public pages match. */
/** The join card's one action, and its code step's: full width, the strongest blue on the glass. */
export const JOIN_BUTTON = "mt-6 inline-flex min-h-13 w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 text-[15px] font-semibold text-white transition hover:bg-blue-700 active:bg-blue-800 focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-200 disabled:cursor-not-allowed disabled:opacity-60";
export const PRIMARY_BUTTON = "inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-[#7fa4fa] px-5 text-sm font-semibold text-white transition hover:bg-[#638df0] focus:outline-none focus:ring-4 focus:ring-blue-200 disabled:cursor-not-allowed disabled:opacity-50";
/**
 * The one column the guest page's header, content and footer all sit in: wide on a desktop, up to
 * 1600px and centred beyond that, with a gutter that grows with the screen - 16px on a phone, 24px
 * on a tablet, 32px on a desktop - so nothing touches the window's edge and the three line up.
 */
export const PAGE_CONTAINER = "mx-auto w-full max-w-[1600px] px-4 sm:px-6 lg:px-8";

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

/**
 * The tabs this event's settings open: My Photos only. A guest never browses the whole event - the
 * page shows only the photos their own selfie matched, whatever an older event stored for All
 * Photos. My Photos is open when the event shows guests their matches or offers selfie search -
 * finding yourself happens inside it, so a guest with no selfie yet is asked for one there.
 */
export function guestTabsFor(meta) {
  const tabs = [];
  if (meta?.gallery?.showMyPhotos || meta?.features?.selfieSearch) tabs.push({ id: "mine", label: "My Photos" });
  return tabs;
}

/** Where a guest lands: their own photos, the only tab there is. */
export function defaultGuestTab(tabs) {
  return tabs[0]?.id || "mine";
}

/** Whether the guest has every selfie the event allows (active ones - removing one frees a slot); the server refuses one more either way. */
export const selfieLimitReached = (guest) => Boolean(guest?.selfieLimit) && (guest?.selfieUploads || 0) >= guest.selfieLimit;

/** Said wherever a new selfie would be offered once the limit is used. */
export const selfieLimitMessage = (guest) => `You have ${guest?.selfieLimit || 10} selfies. Remove one to add another.`;

/** A file name stem for a saved photo: the event, then the photo's place in the list. */
export const photoBaseName = (eventName, index) => `${eventName || "event"}-${String(index + 1).padStart(3, "0")}`;
