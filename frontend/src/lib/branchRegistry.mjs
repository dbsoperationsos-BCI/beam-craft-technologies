/**
 * When the branch register last changed, as a number every branch picker can watch.
 *
 * The register is Settings → Organization → Branches, and Settings is a portal overlay: the screen
 * underneath it stays mounted, still holding the branch list it fetched when it opened. So a branch
 * added, renamed or disabled reached the register and nothing else — the CRM's Assigned Branch, a
 * quotation's Source Branch, an asset's location, a user's home branch and the WhatsApp group name
 * dialog all went on offering the list they were born with until somebody reloaded the page.
 *
 * A revision rather than the branches themselves, because there is no one branch list to share.
 * Three endpoints answer this question and each answers it differently: `/api/admin/branches` is
 * the whole register, inactive branches included; `/api/hrm/branches` is the active master data a
 * picker fills from; `/api/sales/crm-leads/branches` is that same list narrowed by the server to
 * the branches the signed-in person's roles reach. A shared cache would have to pick one of the
 * three and hand it to readers the other two belong to — which is how a picker ends up offering a
 * branch its owner may not file against. A number changes nothing about what each picker asks for
 * or what it is allowed to see, and says the only thing they all need to hear: what you are holding
 * is out of date, ask again.
 *
 * Free of React so `test/branch-registry.test.mjs` can hold the rules; `useBranchRegistry` is the
 * one line of React over the top of it.
 */

let revision = 0;
// Every picker currently listening, so one save reaches all of them at once.
const listeners = new Set();

/**
 * The current revision, `0` until the register is changed.
 *
 * That zero is load-bearing: it is what lets a picker tell its first render from a refresh, so one
 * that already fetches its list on mount can skip doing it a second time and only act on a change.
 */
export const branchRegistryRevision = () => revision;

/** A branch has been saved, disabled or put back in use. Every mounted picker re-reads its list. */
export function branchRegistryChanged() {
  revision += 1;
  // A copy, so a listener that unsubscribes as it runs cannot change the set being walked.
  [...listeners].forEach((listener) => listener());
}

/** One reader, listening. Returns the way to stop, which is what `useSyncExternalStore` wants. */
export function subscribeToBranchRegistry(onChange) {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}
