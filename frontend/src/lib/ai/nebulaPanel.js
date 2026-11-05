"use client";

/**
 * Opening the module assistant from somewhere that is not its button.
 *
 * The CRM's page-level right-click offers Ask Nebula, and the panel it opens belongs to
 * `NebulaHeaderButton` in the module header - a different branch of the tree entirely. This is the
 * thread between them.
 *
 * A tiny module rather than a context provider, for the same reason `activeVertical.js` is one: the
 * two components are nowhere near each other, and threading a provider through the app shell to
 * carry one boolean would be more moving parts than the problem deserves.
 */

const EVENT = "dbs-nebula-open";

/** Asks the module assistant to open. Does nothing if no panel is mounted to hear it. */
export function openNebula() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(EVENT));
}

/** Calls back when something asks the assistant to open. Returns an unsubscribe. */
export function onOpenNebula(listener) {
  if (typeof window === "undefined") return () => {};
  const handler = () => listener();
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}

/*
 * Whether a docked assistant is open, and how wide it is.
 *
 * A docked panel is `fixed` to the right edge, so the page underneath does not know it is there -
 * which is how the module header's own controls ended up behind it. Add Lead and the ⋮ menu were
 * still on the page, still clickable in principle, and completely invisible.
 *
 * The shell listens to this and makes room instead, so the page reflows into what is left rather
 * than being covered. One flag rather than a context, for the same reason as the event above: the
 * panel and the shell are nowhere near each other in the tree.
 */
const DOCK_EVENT = "dbs-nebula-dock";

/** Matches the docked panel's own `sm:w-[26rem]`. Read by the shell to inset by the same amount. */
export const DOCK_WIDTH_CLASS = "sm:pr-[26rem]";

/*
 * How many docked panels are open, rather than whether one is.
 *
 * Two can be: the module assistant from the header, and a lead's own drawer from a row's right-click
 * menu. A boolean would un-inset the page the moment either closed, leaving the other panel sitting
 * over the controls again - so this counts, and the page makes room while anything still needs it.
 */
let dockCount = 0;

function announce() {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(DOCK_EVENT, { detail: dockCount > 0 }));
}

/**
 * Asks the shell for room, and returns the release.
 *
 * A claim-and-release pair rather than a setter, because a setter has to be told the truth twice -
 * once on open and once on close - and a missed call leaves the page inset for a panel that has
 * gone. Handing back the release means the effect that took the room is the one that gives it up.
 */
export function dockNebula() {
  dockCount += 1;
  if (dockCount === 1) announce();
  let released = false;
  return () => {
    // Guarded, because React can run a cleanup more than once in development.
    if (released) return;
    released = true;
    dockCount = Math.max(0, dockCount - 1);
    if (dockCount === 0) announce();
  };
}

/** Whether a docked panel is open right now - for a component mounting mid-flight. */
export function isNebulaDocked() {
  return dockCount > 0;
}

/** Calls back whenever the page should start or stop making room. Returns an unsubscribe. */
export function onNebulaDockChange(listener) {
  if (typeof window === "undefined") return () => {};
  const handler = (event) => listener(Boolean(event.detail));
  window.addEventListener(DOCK_EVENT, handler);
  return () => window.removeEventListener(DOCK_EVENT, handler);
}

/*
 * Which assistant panel is the open one.
 *
 * There are two, opened from different places and living in different branches of the tree: the
 * module assistant in the header, and a lead's own panel from a row's right-click menu or from
 * inside the lead popup. Neither knew about the other, so opening the second left the first sitting
 * behind it - and closing the second revealed an assistant nobody had asked to reopen.
 *
 * One at a time, then. A panel claims the slot as it opens, and whatever held it is told to close.
 *
 * The holder is registered *with* its own close callback rather than listening for a broadcast and
 * working out whether the claim was its own. That first version announced the claim before the
 * claimer had recorded its own token, so every panel heard its own claim as somebody else's and shut
 * itself the instant it opened. Keeping the bookkeeping here means a holder cannot be handed its own
 * claim at all - there is no ordering left to get wrong.
 */

/** Everything currently holding the slot. At most one, but a Set makes releasing order-independent. */
const holders = new Set();

/**
 * Takes the assistant slot, closing whatever held it.
 *
 * `onDisplaced` is called when another panel takes the slot - never for this panel's own claim.
 * Returns the release, to be called when this panel closes on its own.
 */
export function claimNebula(onDisplaced) {
  const holder = { onDisplaced };
  // Cleared before being told, so a callback that opens something else cannot see a stale holder.
  for (const other of [...holders]) {
    holders.delete(other);
    other.onDisplaced?.();
  }
  holders.add(holder);
  return () => holders.delete(holder);
}

/** How many panels hold the slot. Exposed for tests rather than for components. */
export function nebulaClaimCount() {
  return holders.size;
}
