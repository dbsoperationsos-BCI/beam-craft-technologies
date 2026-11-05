"use client";
import Logout from "@mui/icons-material/Logout";
import AppLogo from "@/components/shared/AppLogo";
import { formatEventRange } from "@/lib/aiFeature.mjs";
import { MOBILE_TAB_LABELS } from "@/lib/guestGalleryLayout.mjs";
import { PAGE_CONTAINER } from "./guestActions";

/**
 * The guest gallery's header, sticky at the top of the one page scroll, with the tab bar under it.
 * Its height is the same on every tab - the tab bar is drawn whenever there is more than one tab,
 * not per tab - so switching never moves the content under it. Leave is the same `onLeave` the
 * shell has always had; this only draws it.
 *
 * Two drawings of the same things, chosen by width:
 *
 * A phone gets a gallery-app header: the mark and Leave on the first row, then the event's name
 * large, then who is signed in and the dates, on a translucent white that the photos blur through,
 * padded for a notch; and the tabs as a segmented control - one rounded track, the chosen segment
 * lifted white - with the short labels (Find Me) so three fit across without shrinking the type.
 *
 * From `md` up it is the desktop bar: mark, name and dates, Leave in one row, and underlined tabs.
 *
 * `actions` are drawn beside Leave, and Leave only with an `onLeave`: the Photo Selling store uses
 * this header with its cart and orders there, and no Leave. The AI Feature passes `onLeave` alone.
 */
export default function GuestEventHeader({ eventName, guest, meta, tabs, tab, onTabChange, onLeave, actions = null }) {
  const dates = formatEventRange(meta?.event?.startDate, meta?.event?.endDate);
  const subtitle = [guest?.name && `Hi ${guest.name}`, dates].filter(Boolean).join(" · ");
  const leaveButton = <span className="flex shrink-0 items-center gap-2">{actions}{onLeave && <button type="button" onClick={onLeave} aria-label="Leave event" className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full px-3 text-sm font-semibold text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 active:bg-slate-200 md:min-h-9">
    <Logout style={{ fontSize: 16 }} aria-hidden="true" />Leave
  </button>}</span>;

  return <header className="sticky top-0 z-20 border-b border-slate-200/80 bg-white/90 pt-[env(safe-area-inset-top)] backdrop-blur-md md:bg-white md:backdrop-blur-none">
    {/* Phone */}
    <div className={`${PAGE_CONTAINER} md:hidden`}>
      <div className="flex items-center justify-between pt-2">
        <AppLogo variant="clientSelectionMobile" />
        {leaveButton}
      </div>
      <p className="mt-1 truncate text-[22px] font-semibold leading-7 tracking-tight text-slate-900">{eventName}</p>
      {subtitle && <p className="truncate text-[13px] leading-5 text-slate-500">{subtitle}</p>}
      {tabs.length > 1 && <nav aria-label="Gallery sections" className="pb-3 pt-3">
        <div role="tablist" className="flex gap-1 rounded-full bg-slate-100 p-1">
          {tabs.map((item) => <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} onClick={() => onTabChange(item.id)} className={`min-h-11 min-w-0 flex-1 truncate rounded-full px-2 text-sm font-semibold transition ${tab === item.id ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 active:bg-slate-200"}`}>{MOBILE_TAB_LABELS[item.id] || item.label}</button>)}
        </div>
      </nav>}
      {tabs.length <= 1 && <div className="pb-3" />}
    </div>

    {/* Desktop */}
    <div className={`${PAGE_CONTAINER} hidden md:block`}>
      <div className={`flex items-center gap-3 pt-2.5 ${tabs.length > 1 ? "pb-1" : "pb-2.5"}`}>
        <span className="shrink-0"><AppLogo variant="clientSelectionMobile" /></span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-semibold text-slate-900">{eventName}</p>
          {subtitle && <p className="truncate text-xs text-slate-500">{subtitle}</p>}
        </div>
        {leaveButton}
      </div>
      {tabs.length > 1 && <nav aria-label="Gallery sections" className="overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {/* -mb-px lets the chosen tab's underline sit on the header's own hairline rather than above it. */}
        <div role="tablist" className="-mb-px flex gap-1">
          {tabs.map((item) => <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} onClick={() => onTabChange(item.id)} className={`min-h-10 shrink-0 whitespace-nowrap border-b-2 px-3 text-sm transition ${tab === item.id ? "border-blue-600 font-semibold text-blue-700" : "border-transparent font-medium text-slate-500 hover:text-slate-800"}`}>{item.label}</button>)}
        </div>
      </nav>}
    </div>
  </header>;
}
