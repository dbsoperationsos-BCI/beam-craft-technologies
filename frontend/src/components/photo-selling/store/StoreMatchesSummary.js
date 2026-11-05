"use client";

import StoreButton from "./StoreButton";

/**
 * Above the guest's matched photos, as the AI Feature's My Photos summary card ("Your Moments"):
 * how many photos their selfies found, what buying one gets them, and the store's own actions -
 * Search again and Delete my search for a guest without saved details, Stop WhatsApp messages for one
 * who asked to be told. Matches are by likeness, so the guest is told to leave out one that isn't them.
 */
export default function StoreMatchesSummary({ count, onSearchAgain, onDelete, onStopWhatsApp, stopping = false }) {
  const hasActions = onSearchAgain || onDelete || onStopWhatsApp;
  return <section aria-label="Your photos" className="mb-4 flex flex-col gap-3 rounded-2xl bg-white px-4 py-4 ring-1 ring-slate-200/70 md:mb-5 md:flex-row md:items-center md:justify-between md:px-5">
    <div className="min-w-0">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-blue-600">Your collection</p>
      <h2 className="mt-1 text-xl font-semibold tracking-tight text-slate-900 md:text-2xl">Your Moments</h2>
      <p className="mt-1 text-[15px] leading-6 text-slate-600 md:text-sm">We found {count} {count === 1 ? "photo" : "photos"} featuring you. Matches are by likeness - if one isn&apos;t you, just leave it out. Each photo you buy is the original file, ready to download as soon as your payment is confirmed.</p>
    </div>
    {hasActions && <span className="flex shrink-0 flex-wrap gap-2">
      {onSearchAgain && <StoreButton size="sm" onClick={onSearchAgain}>Search again</StoreButton>}
      {onDelete && <StoreButton size="sm" variant="ghost" onClick={onDelete}>Delete my search</StoreButton>}
      {onStopWhatsApp && <StoreButton size="sm" variant="ghost" disabled={stopping} onClick={onStopWhatsApp}>{stopping ? "Stopping..." : "Stop WhatsApp messages"}</StoreButton>}
    </span>}
  </section>;
}
