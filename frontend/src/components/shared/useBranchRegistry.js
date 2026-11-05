"use client";

import { useSyncExternalStore } from "react";
import { branchRegistryRevision, subscribeToBranchRegistry } from "@/lib/branchRegistry.mjs";

/**
 * The branch register's revision, for a picker that should re-read its list when the register
 * changes. `0` until something is actually saved, so a picker can tell its first render from a
 * refresh and skip fetching the same list twice on mount.
 *
 * Why a revision rather than a shared list of branches is in
 * [branchRegistry.mjs](../../lib/branchRegistry.mjs), which holds the store itself.
 *
 * Read through `useSyncExternalStore` rather than copied into state, for the reason
 * `useStudioBranding` beside it is: state would take the value at the first render and subscribe in
 * an effect afterwards, and a change landing in the gap between the two would reach nobody.
 */
export default function useBranchRegistry() {
  // Nothing is rendered on the server against a branch list, so nothing there is stale either.
  return useSyncExternalStore(subscribeToBranchRegistry, branchRegistryRevision, () => 0);
}
