import Event from "@mui/icons-material/Event";
import Place from "@mui/icons-material/Place";
import AppLogo from "@/components/shared/AppLogo";
import useStudioBranding from "@/components/shared/useStudioBranding";
import EventCover from "@/components/ai-feature/shared/EventCover";
import { formatEventRange } from "@/lib/aiFeature.mjs";

/**
 * The top of the landing page: the cover edge to edge, then the event's name, dates and place,
 * with the studio's mark above it all so the guest knows whose photos these are.
 */
export default function GuestHero({ event }) {
  const branding = useStudioBranding();
  const range = formatEventRange(event?.startDate, event?.endDate);
  return <header className="bg-white">
    <div className="flex items-center justify-center gap-2 px-4 py-3">
      <AppLogo variant="clientSelectionMobile" priority />
    </div>
    <EventCover src={event?.coverUrl} name={event?.name} className="aspect-[16/10] w-full sm:aspect-[21/9] lg:max-h-[420px]" />
    <div className="mx-auto w-full max-w-3xl px-4 py-6 text-center sm:py-8">
      {event?.eventType && <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">{event.eventType}</p>}
      <h1 className="mt-2 font-serif text-3xl leading-tight tracking-[-0.03em] text-slate-900 sm:text-5xl">{event?.name}</h1>
      <div className="mt-4 flex flex-col items-center justify-center gap-2 text-sm text-slate-600 sm:flex-row sm:gap-5">
        {range && <span className="inline-flex items-center gap-1.5"><Event style={{ fontSize: 18 }} aria-hidden="true" className="text-slate-400" />{range}</span>}
        {event?.location && <span className="inline-flex items-center gap-1.5"><Place style={{ fontSize: 18 }} aria-hidden="true" className="text-slate-400" />{event.location}</span>}
      </div>
      {event?.description && <p className="mx-auto mt-4 max-w-xl text-sm leading-6 text-slate-600">{event.description}</p>}
      {branding?.studioName && <p className="mt-4 text-xs text-slate-400">Photos by {branding.studioName}</p>}
    </div>
  </header>;
}
