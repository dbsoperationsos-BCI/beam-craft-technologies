"use client";
import EventCover from "@/components/ai-feature/shared/EventCover";
import { formatEventRange } from "@/lib/aiFeature.mjs";

/**
 * A phone's small piece of the event before the photos begin: the cover the host chose, with the
 * kind of event and its dates set over its foot. Drawn only when there is a cover - the header
 * already names the event, so without a picture there is nothing here worth the height - and
 * only on a phone; the desktop page goes straight to the photos.
 *
 * The cover is the same public image the landing page shows; nothing new is stored or fetched.
 */
export default function MobileEventHero({ event }) {
  if (!event?.coverUrl) return null;
  const dates = formatEventRange(event.startDate, event.endDate);
  return <section aria-label="About this event" className="relative mb-4 overflow-hidden rounded-2xl md:hidden">
    <EventCover src={event.coverUrl} name={event.name} className="aspect-[2/1] w-full" />
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-gradient-to-t from-slate-950/70 via-slate-950/10 to-transparent" />
    <div className="absolute inset-x-0 bottom-0 px-4 pb-3.5 text-white">
      <p className="text-base font-semibold leading-6 drop-shadow-sm">{event.eventType ? `${event.eventType} Gallery` : "Event Gallery"}</p>
      {dates && <p className="text-[13px] leading-5 text-white/85">{dates}</p>}
    </div>
  </section>;
}
