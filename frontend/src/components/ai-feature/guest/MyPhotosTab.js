"use client";
import AutoAwesome from "@mui/icons-material/AutoAwesome";
import LazyImage from "@/components/ai-feature/shared/LazyImage";
import { formatCount } from "@/lib/aiFeature.mjs";
import GuestPhotoGrid from "./GuestPhotoGrid";
import GuestPhotoPane from "./GuestPhotoPane";
import { PRIMARY_BUTTON, SECONDARY_BUTTON } from "./guestActions";

/**
 * My Photos: the guest's own collection, drawn as one rather than as a results list. The same
 * `GuestPhotoPane` as All Photos - same paging, same viewer, same "This is not me" - with three
 * things of its own around it:
 *
 * - a summary card in place of the count line: "Your Moments", how many photos were found, and
 *   Use a different selfie beside it (under it on a phone) - or the selfie limit, once it is used;
 * - a layout that suits the number found: one photo is shown large and centred as a featured
 *   card rather than a lone tile in a corner; two to five sit in a curated grid with the first
 *   given the most room; more are the gallery grid the rest of the page uses;
 * - an empty state with the way to try another selfie, and a skeleton while the list loads so
 *   nothing jumps.
 *
 * A guest with no selfie never reaches this while selfie search is open - the gallery shows
 * `FindMyPhotos` in its place - so `NoSelfieYet` only says that the search is closed.
 *
 * No badge names a "best" match: the guest's list carries no confidence, and a label that
 * pretended to know would be a lie.
 */

/** "We found 12 photos featuring you from this event." */
function foundLine(total) {
  if (!total) return "";
  return `We found ${formatCount(total)} ${total === 1 ? "photo" : "photos"} featuring you from this event.`;
}

/** "Use a different selfie", or the limit message in its place once every selfie is used. */
function ReplaceSelfie({ limitReached, limitMessage, onFindSelfie, primary, className = "" }) {
  if (limitReached) return <p role="status" className={`text-sm text-slate-600 ${className}`}>{limitMessage}</p>;
  return <button type="button" onClick={onFindSelfie} className={`${primary ? PRIMARY_BUTTON : SECONDARY_BUTTON} w-full ${className}`}>{primary ? "Try another selfie" : "Use a different selfie"}</button>;
}

function SummaryCard({ total, loading, showFind, limitReached, limitMessage, onFindSelfie }) {
  return <section aria-label="Your photos" className="mb-4 flex flex-col gap-3 rounded-2xl bg-white px-4 py-4 ring-1 ring-slate-200/70 md:mb-5 md:flex-row md:items-center md:justify-between md:px-5">
    <div className="min-w-0">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-blue-600">Your collection</p>
      <h2 className="mt-1 text-xl font-semibold tracking-tight text-slate-900 md:text-2xl">Your Moments</h2>
      <p className="mt-1 text-[15px] leading-6 text-slate-600 md:text-sm">{loading ? "Looking through the photos for you..." : foundLine(total)}</p>
    </div>
    {showFind && <ReplaceSelfie limitReached={limitReached} limitMessage={limitMessage} onFindSelfie={onFindSelfie} className="shrink-0 md:w-auto" />}
  </section>;
}

/** The one-photo case: large, centred, in a card, so a single match reads as a highlight rather than a gap. */
function Featured({ item, onOpen }) {
  const ratio = item.width && item.height ? `${item.width} / ${item.height}` : "4 / 5";
  return <figure className="mx-auto w-full max-w-2xl">
    <div className="overflow-hidden rounded-2xl bg-white p-2 shadow-[0_12px_32px_rgba(15,23,42,0.06)] ring-1 ring-slate-200/70">
      <LazyImage src={item.previewUrl || item.thumbnailUrl} alt="Your photo" eager onClick={() => onOpen(0)} photoIndex={0} className="w-full rounded-xl focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-200" style={{ aspectRatio: ratio, maxHeight: "70vh" }} />
    </div>
  </figure>;
}

/** What is drawn while the list loads: the summary's shape and a few tiles, so the page does not jump when they arrive. */
function Skeleton() {
  return <div aria-hidden="true">
    <div className="mb-4 h-[104px] rounded-2xl bg-white ring-1 ring-slate-200/70 md:mb-5" />
    <div className="grid grid-cols-2 gap-2 md:grid-cols-4 lg:grid-cols-5">
      {Array.from({ length: 5 }, (_, index) => <div key={index} className={`rounded-xl bg-slate-200/60 ${index === 0 ? "col-span-2 aspect-[10/7] md:col-span-1 md:aspect-square" : "aspect-square"}`} />)}
    </div>
  </div>;
}

function EmptyMatches({ showFind, limitReached, limitMessage, onFindSelfie, whatsappOn }) {
  return <section className="mx-auto max-w-md rounded-2xl bg-white px-6 py-8 text-center ring-1 ring-slate-200/70">
    <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-blue-50 text-blue-600"><AutoAwesome style={{ fontSize: 22 }} aria-hidden="true" /></div>
    <h3 className="mt-4 text-lg font-semibold text-slate-900">{whatsappOn ? "Your photos haven't been found yet" : "No photos found yet"}</h3>
    {/* The WhatsApp promise only where it will be kept: the guest asked for it and the event sends it. */}
    <p className="mt-1 text-sm leading-6 text-slate-600">{whatsappOn ? "We'll notify you on WhatsApp when your photos are available." : `Only photos your selfie matches are shown here. More can appear as the photographer uploads${showFind ? ", or try another selfie" : ""}.`}</p>
    {showFind && <div className="mt-5"><ReplaceSelfie primary limitReached={limitReached} limitMessage={limitMessage} onFindSelfie={onFindSelfie} /></div>}
  </section>;
}

function NoSelfieYet() {
  return <section className="mx-auto max-w-md rounded-2xl bg-white px-6 py-8 text-center ring-1 ring-slate-200/70">
    <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-blue-50 text-blue-600"><AutoAwesome style={{ fontSize: 22 }} aria-hidden="true" /></div>
    <h3 className="mt-4 text-lg font-semibold text-slate-900">Find yourself in the photos</h3>
    <p className="mt-1 text-sm leading-6 text-slate-600">The host has not opened selfie search for this event.</p>
  </section>;
}

export default function MyPhotosTab({ listKey, fetchPage, onError, eventName, allowSharing, notify, onNotMe, selfieStatus, whatsappOn = false, showFind, limitReached, limitMessage, onFindSelfie }) {
  // A failed later selfie still leaves the earlier one's matches, so it counts as having one here.
  const hasSelfie = selfieStatus !== "NONE";
  return <GuestPhotoPane
    listKey={listKey}
    fetchPage={fetchPage}
    onError={onError}
    eventName={eventName}
    allowSharing={allowSharing}
    notify={notify}
    onNotMe={onNotMe}
    loadingState={<Skeleton />}
    empty={hasSelfie ? <EmptyMatches showFind={showFind} limitReached={limitReached} limitMessage={limitMessage} onFindSelfie={onFindSelfie} whatsappOn={whatsappOn} /> : <NoSelfieYet />}
    renderGrid={(grid) => grid.items.length === 1
      ? <Featured item={grid.items[0]} onOpen={grid.onOpen} />
      : <GuestPhotoGrid {...grid} curated={grid.items.length <= 5} />}
  >
    {(paged) => (paged.loading || (!paged.error && !paged.items.length && !paged.total)) ? null : <SummaryCard total={paged.total} loading={paged.loading} showFind={showFind && hasSelfie} limitReached={limitReached} limitMessage={limitMessage} onFindSelfie={onFindSelfie} />}
  </GuestPhotoPane>;
}
