"use client";

import Link from "next/link";
import EventCover from "@/components/ai-feature/shared/EventCover";
import ProgressBar from "@/components/ai-feature/shared/ProgressBar";
import StatusChip from "@/components/ai-feature/shared/StatusChip";
import OptionsMenu from "@/components/ui/OptionsMenu";
import { formatCount, formatEventRange } from "@/lib/aiFeature.mjs";

export const eventHref = (id) => `/visual-curation/ai/events/${encodeURIComponent(id)}`;

/**
 * One event in the list: its cover, the facts that tell it apart from the one beside it, and how
 * far its photos have been through the AI.
 *
 * The cover and the body are one link to the workspace; the ⋮ sits outside that link so a press
 * on it never also opens the event. `menuItems` is already decided by the page - a reader gets
 * Open Event alone, a writer the rest - so the card draws what it is given and asks nothing.
 */
export default function EventCard({ event, menuItems }) {
  const percent = event.processing?.percent ?? 0;
  const href = eventHref(event.id);
  return <article className="flex min-w-0 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm transition hover:border-blue-300 hover:shadow-md">
    <Link href={href} className="block outline-none focus-visible:ring-2 focus-visible:ring-blue-500" aria-label={`Open ${event.name}`}>
      <EventCover src={event.coverUrl} name={event.name} className="aspect-video w-full" />
    </Link>
    <div className="flex min-w-0 flex-1 flex-col p-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <Link href={href} className="block truncate text-sm font-semibold text-slate-800 outline-none hover:text-blue-700 focus-visible:underline">{event.name}</Link>
          <p className="mt-0.5 truncate text-xs text-slate-500">{formatEventRange(event.startDate, event.endDate)}{event.location ? ` · ${event.location}` : ""}</p>
        </div>
        {menuItems?.length > 0 && <OptionsMenu ariaLabel={`Actions for ${event.name}`} items={menuItems} />}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
        <StatusChip status={event.status} />
        {event.eventType && <span className="truncate text-[11px] text-slate-500">{event.eventType}</span>}
      </div>
      <p className="mt-2 text-[11px] text-slate-500">{formatCount(event.guestCount)} guests · {formatCount(event.mediaCount)} photos · {formatCount(event.faceCount)} faces</p>
      <div className="mt-auto pt-3">
        <div className="mb-1 flex items-center justify-between text-[11px] text-slate-500">
          <span>Face processing</span>
          <span className="tabular-nums">{percent}%</span>
        </div>
        <ProgressBar percent={percent} label={`Face processing for ${event.name}`} />
      </div>
    </div>
  </article>;
}
