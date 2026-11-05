"use client";
import AppLogo from "@/components/shared/AppLogo";
import useStudioBranding from "@/components/shared/useStudioBranding";
import { PAGE_CONTAINER } from "./guestActions";

/**
 * The guest gallery's footer: the studio mark and who the photos are by, and nothing else. It sits
 * after the content in the page's own flow - the shell is a column with the main pane growing, so
 * a short gallery still ends with the footer at the bottom of the window and a long one pushes it
 * below the last photo; it never floats over a photograph. On a phone it is centred and padded
 * for the home indicator.
 *
 * Leave used to be repeated here. There is one Leave, in the header, on the same handler.
 */
export default function GuestEventFooter() {
  const branding = useStudioBranding();
  return <footer className="border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)]">
    <div className={`${PAGE_CONTAINER} flex min-h-14 flex-col items-center justify-center gap-0.5 py-2.5 text-center md:min-h-16 md:flex-row md:justify-between md:py-3 md:text-left`}>
      <AppLogo variant="clientSelectionMobile" />
      {branding?.studioName && <p className="text-[13px] text-slate-500 md:text-xs">Photos by {branding.studioName}</p>}
    </div>
  </footer>;
}
