"use client";

import { useCallback, useEffect, useRef } from "react";
import NebulaMark from "./NebulaMark";
import LeadAiPanel from "@/components/sales/LeadAiPanel";
import useDrawerTop from "@/lib/ai/useDrawerTop";
import { onVerticalChange } from "@/lib/ai/activeVertical";
import { claimNebula, dockNebula } from "@/lib/ai/nebulaPanel";
import useEscapeKey from "@/components/shared/useEscapeKey";

/**
 * Nebula about one lead, in the panel it appears in wherever it is opened from.
 *
 * Opened from Ask Nebula on a row's right-click menu, and from the button inside the lead popup.
 * Split out from that button because the panel is the part worth naming - the header, the name chip,
 * the dismissal, and the `scope="lead"` that is what keeps the whole thing about one person rather
 * than the pipeline.
 *
 * Two shapes, because it is opened from two places that want different things of it.
 *
 * `drawer` - from Ask Nebula on a row's right-click menu - matches the module assistant: docked to
 * the right edge, full height, a hairline rather than a shadow. Nothing else is open, so it can take
 * the side of the screen.
 *
 * `chat` - from inside the lead popup - is a chat box above the button that opened it. The popup is a
 * record somebody is reading and filling in, and a full-height panel over it hides half the form they
 * opened it to ask about.
 *
 * The chat box is positioned *absolutely, inside the button's own moving container*, rather than
 * fixed to the window. That is what keeps the two together when the button is dragged: they are one
 * thing being moved, not two things that have to be kept in step.
 *
 * `z-[135]`: above the lead popup (120) so it can be opened from inside it, and below the dialogs
 * that open over that popup (140 and up), so it never covers a confirmation somebody has to read.
 */
export default function LeadNebulaPanel({ leadId, lead, variant = "drawer", ref, onClose, onError }) {
  const isChat = variant === "chat";
  const close = useCallback(() => onClose?.(), [onClose]);
  /*
   * Below the module header, like the module assistant - the drawer only.
   *
   * It used to run the full height of the window - `sm:inset-y-0` - and covered the topbar and the
   * CRM's own controls. A panel about one lead is something you read *while* working on the table,
   * so it must not take the row of controls with it. The chat box is anchored to the bottom corner
   * and never reaches the header, so it has nothing to measure.
   */
  const top = useDrawerTop(!isChat);

  /*
   * Escape closes it, and it is the only thing besides the cross that does.
   *
   * Kept when the outside-press dismissal was taken out, because the two are not the same kind of
   * action: a stray click is something you did to the page, and Escape is something you did to the
   * panel. Without it there is no way to close this from the keyboard except tabbing to the cross.
   */
  useEscapeKey(close);

  /*
   * Nothing outside the panel closes it - see `NebulaHeaderButton` for why.
   *
   * It matters more here, if anything: this panel is about the lead whose row you are looking at,
   * so touching that row is the most likely next thing you do.
   */

  /*
   * Switching the CRM's vertical closes this too.
   *
   * It is about one lead on one board, and the board it belongs to has just gone off screen - so the
   * panel would be answering about a record the table no longer lists.
   */
  useEffect(() => onVerticalChange(() => close()), [close]);

  /*
   * The drawer asks the shell for room; the chat box does not.
   *
   * The drawer is the same full-height panel down the right edge as the module assistant, and covers
   * the page's own controls the same way. The chat box floats over the lead popup, which is a dialog
   * rather than the page - there is nothing behind it to reflow.
   */
  useEffect(() => (isChat ? undefined : dockNebula()), [isChat]);

  /*
   * One assistant at a time - see `NebulaHeaderButton`.
   *
   * Both shapes take the slot, the chat box included: it sits over the lead popup, and a module
   * assistant left open behind that popup is one the reader cannot see and did not close.
   */
  /*
   * Held through a ref so the claim is taken once, on mount.
   *
   * `close` is rebuilt whenever the parent re-renders, and putting it in the dependencies would
   * release and retake the slot on every render - which is a lot of churn to arrive back where it
   * started.
   */
  const closeRef = useRef(close);
  // Kept current in an effect rather than during render - a ref written while rendering is a value
  // React is entitled to have already read.
  useEffect(() => { closeRef.current = close; }, [close]);
  useEffect(() => claimNebula(() => closeRef.current()), []);

  if (!leadId) return null;

  return (
    <div
      /*
       * The caller's ref, taken as a plain prop - React 19 hands one to a function component like
       * any other. The chat variant is measured by the button that owns it, so the drag can be
       * clamped against the pair rather than the button alone.
       */
      ref={ref}
      role="dialog"
      aria-label={`Nebula AI, ${lead?.name || leadId}`}
      style={isChat ? undefined : { top, bottom: 0 }}
      className={isChat
        /*
         * Above the button, right edges aligned, inside the container the two share.
         *
         * `bottom-[68px]` is the 52px button plus a 16px gap, so the launcher stays reachable rather
         * than being covered by what it opened. `right-0` aligns it with the button's right edge,
         * which is what keeps them looking like one control however far the pair is dragged.
         *
         * The width is capped against the viewport because on a 360px screen a 23rem box is wider
         * than the screen, and the height against it too so the pair always fits.
         */
        ? `themed-surface nebula-drawer-enter absolute bottom-[68px] right-0 flex
           w-[min(23rem,calc(100vw-2.5rem))] h-[min(32rem,calc(100dvh-12rem))]
           flex-col overflow-hidden rounded-xl border border-slate-200 bg-white
           shadow-[0_20px_60px_rgba(15,23,42,0.18)]`
        : `themed-surface nebula-drawer-enter fixed inset-x-0 z-[135] flex flex-col
           overflow-hidden border-l border-t border-slate-200 bg-white
           sm:inset-x-auto sm:right-0 sm:w-[26rem] sm:border-t-0`}
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-slate-200 px-4 py-3">
        {/* The same 36px circle and 26px mark as the module panel's header - one assistant, one mark
            at one size, whichever of the two panels you are looking at. */}
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-600 text-white">
          <NebulaMark size={26} />
        </span>
        <span className="text-sm font-semibold text-slate-800">Nebula AI</span>
        {/* Whose record is being answered about, so it is never mistaken for the whole CRM. */}
        <span className="truncate rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
          {lead?.name || leadId}
        </span>
        <button
          type="button"
          onClick={close}
          aria-label="Close Nebula AI"
          className="ml-auto shrink-0 rounded-md p-1 text-slate-400 transition hover:text-slate-700"
        >
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>

      {/* `scope="lead"` is what keeps this about one person rather than the pipeline. */}
      <LeadAiPanel leadId={leadId} lead={lead} scope="lead" onError={onError} />
    </div>
  );
}
