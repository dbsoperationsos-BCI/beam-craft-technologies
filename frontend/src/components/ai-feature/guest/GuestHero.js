import Event from "@mui/icons-material/Event";
import Place from "@mui/icons-material/Place";
import AppLogo from "@/components/shared/AppLogo";
import useStudioBranding from "@/components/shared/useStudioBranding";
import { formatEventRange } from "@/lib/aiFeature.mjs";
import { logoFor } from "@/lib/studioBranding.mjs";

/**
 * The event's identity over its cover: the studio's mark first, then the kind of event in small
 * caps, the name large, the dates and the place, the description, and whose photographs these
 * are - all in white on the photograph, with a shadow under every line so they hold on a bright
 * patch the veil has not fully covered; the secondary lines a shade dimmer than the name. The mark is the dark-surface one, since the veil under it is dark whatever the photo is.
 * A studio that has uploaded no dark-mode mark is shown its light one on a small light pill,
 * so a mark drawn for white paper still reads on a photograph; a mark made for the dark stands
 * on the picture by itself.
 */
export default function GuestHero({ event }) {
  const branding = useStudioBranding();
  const range = formatEventRange(event?.startDate, event?.endDate);
  const ownDarkMark = logoFor(branding, true).ownMark;
  return <header className="flex w-full flex-col items-center text-center [text-shadow:0_1px_2px_rgba(0,0,0,0.35),0_2px_18px_rgba(0,0,0,0.45)]">
    <div className={ownDarkMark ? "drop-shadow-[0_2px_10px_rgba(0,0,0,0.45)]" : "rounded-full bg-white/90 px-5 py-2.5 shadow-[0_8px_24px_rgba(0,0,0,0.18)] supports-backdrop-filter:bg-white/80 supports-backdrop-filter:backdrop-blur-md"}>
      <AppLogo variant="clientSelectionMobile" priority surface="dark" />
    </div>
    {event?.eventType && <p className="mt-8 text-[11px] font-semibold uppercase tracking-[0.28em] text-white/80 md:mt-10 md:text-xs">{event.eventType}</p>}
    <h1 className="mt-3 max-w-3xl font-serif text-4xl leading-[1.05] tracking-[-0.02em] text-white [text-shadow:0_2px_4px_rgba(0,0,0,0.4),0_4px_28px_rgba(0,0,0,0.5)] md:text-6xl">{event?.name}</h1>
    {(range || event?.location) && <div className="mt-4 flex flex-col items-center justify-center gap-1.5 text-[15px] text-white/85 sm:flex-row sm:gap-5 md:mt-5 md:text-base">
      {range && <span className="inline-flex items-center gap-1.5"><Event style={{ fontSize: 18 }} aria-hidden="true" className="text-white/70" />{range}</span>}
      {event?.location && <span className="inline-flex items-center gap-1.5"><Place style={{ fontSize: 18 }} aria-hidden="true" className="text-white/70" />{event.location}</span>}
    </div>}
    {event?.description && <p className="mx-auto mt-4 max-w-xl text-[15px] leading-6 text-white/75 md:text-sm">{event.description}</p>}
    {branding?.studioName && <p className="mt-4 text-xs text-white/60">Photos by {branding.studioName}</p>}
  </header>;
}
