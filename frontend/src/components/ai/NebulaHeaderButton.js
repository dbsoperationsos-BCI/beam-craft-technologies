"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import NebulaMark from "./NebulaMark";
import AIAssistant from "./AIAssistant";
import { moduleForPath, moduleLabel } from "@/lib/ai/moduleContext";
import useDrawerTop from "@/lib/ai/useDrawerTop";
import { claimNebula, dockNebula, onOpenNebula } from "@/lib/ai/nebulaPanel";
import { onVerticalChange } from "@/lib/ai/activeVertical";
import { layers } from "@/constants/layers";
import useEscapeKey from "@/components/shared/useEscapeKey";

/**
 * Nebula, in the module header beside the page's own actions.
 *
 * It used to be a circular button floating over the page, draggable, anchored to a corner. That was
 * wrong in a way that is obvious once it is in the header instead: it sat on top of the work. On a
 * table it covered a row, in the lead popup it covered a field, and moving it aside only moved the
 * problem somewhere else. A control belongs in the row of controls.
 *
 * Rendered by `ModulePageHeader`, so every screen in the application gets it in the same place
 * without a single page having to ask - and it lines up with Add Lead, the ⋮ menu and every other
 * header action, because it is one of them.
 *
 * It opens the row rather than closing it. The primary button belongs at the end, where the eye
 * looks for it; a tool that is present on every screen belongs before it, quietly.
 *
 * The panel is unchanged: the same `AIAssistant`, the same module scoping, the same dismissal. Only
 * where it opens from has moved.
 */

/*
 * A bare icon, the size of the header's other controls.
 *
 * Not a bordered button with a label. Nebula is available on every screen in the application, and a
 * control that is always there should not compete with the one the page was built around - a boxed
 * "Nebula AI" beside Add Lead read as a second primary action rather than as a tool that happens to
 * be present.
 *
 * `h-11` - 44px, larger than the `min-h-9` buttons beside it rather than level with them.
 *
 * It was `h-9` to match their height exactly, and that is what kept the mark small: a bare glyph
 * inside a 36px box can only ever be a 36px glyph, and beside a button carrying a word of text it
 * read as the smallest thing in the row. A lettered button is mostly padding around 14px of text; an
 * icon is the whole control. Matching their boxes made the two look nothing alike.
 *
 * So the box grows and the row grows with it - `PageHeaderTopRow` is `min-h-12` and sizes to its
 * content, so this is the height it was already prepared for. Alignment is by centre, not by box:
 * `items-center` puts the mark on the same axis as the text beside it, which is the line the eye
 * actually reads.
 *
 * No hover fill and no `title`, which is how icon controls behave everywhere else here; the colour
 * change carries it, and `aria-label` names it for a screen reader without drawing the browser's own
 * tooltip.
 */
const TRIGGER = "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500";

export default function NebulaHeaderButton() {
  const pathname = usePathname();
  const scope = moduleForPath(pathname);

  /*
   * Which module the panel is open for, rather than a plain "is it open".
   *
   * Navigating to another module then closes it by arithmetic instead of by an effect that reaches
   * back and sets state - the panel is open for SALES, you are now in ASSET, so it is not open. A
   * `useEffect` that called `setOpen(false)` on every scope change did the same thing one render
   * later and by a route React is right to warn about.
   */
  const [openFor, setOpenFor] = useState(null);
  const open = openFor !== null && openFor === scope;
  const [error, setError] = useState("");
  const panelRef = useRef(null);
  const triggerRef = useRef(null);
  // Where the module header ends, which is where the drawer begins. Shared with the lead panel.
  const top = useDrawerTop(open);

  const close = useCallback(() => setOpenFor(null), []);

  /*
   * Tells the shell to make room while this is open.
   *
   * Cleared on unmount as well as on close - navigating away from a module with the panel open
   * would otherwise leave the page permanently inset for a panel that is no longer there.
   */
  useEffect(() => (open ? dockNebula() : undefined), [open]);

  /*
   * One assistant at a time.
   *
   * Opening this takes the slot from a lead's panel; a lead's panel opening takes it from this. They
   * live in different branches of the tree and used to stack, so closing the one on top revealed one
   * underneath that nobody had asked to reopen.
   */
  // `setOpenFor` is stable, so this is the whole of it: hold the slot while open, close if displaced.
  useEffect(() => (open ? claimNebula(() => setOpenFor(null)) : undefined), [open]);

  /*
   * Opened from elsewhere - the CRM's page-level right-click offers Ask Nebula, and this is the
   * panel it means.
   */
  useEffect(() => onOpenNebula(() => setOpenFor(scope)), [scope]);

  /*
   * The conversation belongs to what is on screen, so a change of screen ends it.
   *
   * Two changes count. Switching module - CRM to Assets - is obvious. Switching the CRM's vertical
   * is the one that matters more and is easier to miss: Dum Dum, Qua Qua and Corp are different
   * businesses, and an answer about Dum Dum's pipeline left sitting above a Corp board is not
   * merely stale, it is about somebody else's work. Nothing on screen says which board it was for.
   *
   * The panel closes rather than re-answering, because the question that produced it was asked
   * about a board that is no longer there.
   */
  useEffect(() => {
    if (!open) return undefined;
    return onVerticalChange(() => setOpenFor(null));
  }, [open]);

  // A different module is a different session entirely - handled by `openFor` above, which simply
  // stops matching.

  /*
   * Escape closes it, and it is the only thing besides the cross that does.
   *
   * Kept when the outside-press dismissal was taken out, because the two are not the same kind of
   * action: a stray click is something you did to the page, and Escape is something you did to the
   * panel. Without it there is no way to close this from the keyboard except tabbing to the cross.
   */
  useEscapeKey(close, open);

  /*
   * Nothing outside the panel closes it.
   *
   * It used to dismiss on a press anywhere else, the way a popover does, and that is wrong for what
   * this actually is. A popover is a menu you are choosing from; this is a panel you work beside -
   * you read an answer, click a row to check it, come back and ask the next thing. Closing on that
   * click threw away the conversation for touching the very table it was about.
   *
   * So it closes on the cross, and on nothing else. The panel does not cover the page it docks
   * beside, so leaving it open costs nothing.
   */

  // Nowhere to scope a session to. Every signed-in route maps to a module, so this is a guard
  // against an unrecognised path rather than a state anyone should see.
  if (!scope) return null;

  return (
    <>
      <button
        type="button"
        ref={triggerRef}
        data-nebula-header-button="true"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Open Nebula AI for ${moduleLabel(scope)}`}
        onClick={() => setOpenFor((current) => (current === scope ? null : scope))}
        className={`${TRIGGER} ${open ? "text-blue-600" : "text-slate-500 hover:text-blue-600"}`}
      >
        {/*
         * The mark alone. It takes `currentColor`, so the open and hover states need no variant.
         *
         * 44, the whole button, which draws about 38px of ink - `size` is the box, and the glyph
         * fills about 89% of it, so the mark carries its own margin and needs none added.
         *
         * It went 20, then 24, then 34, and each of those was a few pixels of ink on the last because
         * the 36px button capped it. The cap was the problem, not the number.
         */}
        <NebulaMark size={44} />
      </button>

      {open && (
        <div
          ref={panelRef}
          role="dialog"
          aria-label={`Nebula AI, ${moduleLabel(scope)}`}
          /*
           * A full-height panel down the right-hand side, starting where the header ends.
           *
           * It was a floating card with a drop shadow before, and it read as something laid on top
           * of the application rather than part of it. A docked panel is what a side assistant
           * actually is: square corners against the edges it meets, one hairline on its left, and no
           * shadow - the border does the separating, the way every other pane in this shell does it.
           *
           * `top` is the header's own bottom edge, so the topbar and the module's own controls stay
           * reachable while it is open. Nothing about the page is covered that somebody might need
           * in order to decide what to ask.
           *
           * `layers.assistant` (105): above the page, below the lead popup (120), dialogs (140) and
           * the WhatsApp panel - the same layer the floating panel had, so nothing that used to sit
           * above it now sits below it.
           *
           * The navigation drawer and its scrim sit above this on purpose (106/108), so opening the
           * drawer dims this panel along with the page rather than leaving it lit beside the dim.
           */
          style={{ top, bottom: 0 }}
          /*
           * Slides in from the edge it is docked to: up from the bottom on a phone, in from the
           * right on a wide screen. Both use the CRM drawer's own duration and curve, and both stop
           * moving entirely under `prefers-reduced-motion`.
           */
          className={`themed-surface nebula-drawer-enter fixed inset-x-0 ${layers.assistant} flex flex-col overflow-hidden
            border-l border-t border-slate-200 bg-white
            sm:inset-x-auto sm:right-0 sm:w-[26rem] sm:border-t-0`}
        >
          <div className="flex shrink-0 items-center gap-2 border-b border-slate-200 px-4 py-3">
            {/* 36px circle, 26px box - a ~23px mark, so the thing you pressed and the thing that
                opened are recognisably one mark at one weight. The disc is drawn here, unlike the
                trigger, so the margin lives in the disc and the mark stops short of its edge. */}
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-600 text-white">
              <NebulaMark size={26} />
            </span>
            {/*
             * The name and nothing after it.
             *
             * A pill naming the module - CRM, Assets, Accounts - used to sit beside this, and it read
             * as a second, smaller product name attached to the first. The assistant is one assistant
             * across the whole application, and the module is already the screen you are standing on,
             * so the badge said what the page behind the panel was already saying. `mr-auto` takes
             * the space the pill was holding, which keeps the mark, the name and the cross on the one
             * line at every width.
             *
             * Which module is answering is still carried where it matters and costs nothing: the
             * panel's `aria-label` below, and the thread's own opening line.
             */}
            <span className="mr-auto truncate text-sm font-semibold text-slate-800">Nebula AI</span>
            <button
              type="button"
              onClick={close}
              aria-label="Close Nebula AI"
              className="shrink-0 rounded-md p-1 text-slate-400 transition hover:text-slate-700"
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>

          {error && (
            <p className="shrink-0 border-b border-red-100 bg-red-50 px-4 py-2 text-xs text-red-700">{error}</p>
          )}

          <AIAssistant module={scope} title="Nebula AI" onError={setError} />
        </div>
      )}
    </>
  );
}
