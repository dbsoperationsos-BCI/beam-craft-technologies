"use client";

import { useEffect, useState } from "react";
import { getCrmBranches } from "@/services/sales/crm-leads.service";
import useBranchRegistry from "@/components/shared/useBranchRegistry";
import { FALLBACK_BRANCH_OPTIONS } from "@/lib/crmOptions";

/**
 * The branches a lead, a quotation or an imported row may be assigned to.
 *
 * Fetched, because the studio maintains its branches in Settings → Organization → Branches and a
 * list written down in the browser cannot follow them. Three files each held a copy of the same
 * hard-coded array — `nearestBranchOptions` here, `assignedBranchOptions` in
 * `quotationVerticalConfig.js`, and the import dialog reading the first — and every copy named six
 * branches the studio does not have: `Erode`, `Tiruppur`, `Coimbatore`, `Bangalore`, `Hyderabad`,
 * `Vizag` against the real `Erode TN`, `Tiruppur TN`, `Coimbatore TN`, `Bangalore KA`,
 * `Hyderabad TL`, `Visakhapatnam AP`.
 *
 * So Assigned Branch offered values that exist nowhere, a branch the studio added or renamed never
 * reached the CRM, and the six survived only because `referenceMatchers` on the server forgives a
 * first word when it resolves `branch_id`. That is a matcher doing the work of a list.
 *
 * The answer is already narrowed to the branches this person's roles reach — the server decides
 * that, not this — so what comes back is what they may actually file against.
 *
 * `FALLBACK_BRANCH_OPTIONS` stands in only while the first request is in flight or if it fails: a
 * picker with no options at all cannot be used, and the fallback is the studio's six spelled the way
 * the branch table spells them.
 *
 * Asked again whenever the branch register changes, so a branch added or renamed in Settings —
 * an overlay over the very screens this fills — is offered here without the page being reloaded.
 * The options already on screen are held until the new answer arrives and are only replaced when it
 * is not empty, so a refresh never blinks a picker back to the fallback.
 */
export default function useBranchOptions() {
  const [branches, setBranches] = useState(FALLBACK_BRANCH_OPTIONS);
  const [loading, setLoading] = useState(true);
  const branchRegistryRevision = useBranchRegistry();

  useEffect(() => {
    let live = true;
    // Deferred a tick, which is this codebase's convention for a first load: a fetch started
    // straight from an effect body counts as state set during that effect.
    const timer = setTimeout(() => {
      void getCrmBranches()
        .then((response) => {
          const rows = Array.isArray(response?.data) ? response.data : [];
          const options = rows
            .map((row) => (typeof row === "string" ? { value: row, label: row } : row))
            .filter((row) => row?.value);
          // An empty answer is left on the fallback rather than emptying the picker: a studio that
          // has recorded no branches is a studio whose leads still have to be filed somewhere.
          if (live && options.length) setBranches(options);
        })
        .catch(() => {})
        .finally(() => { if (live) setLoading(false); });
    }, 0);
    return () => { live = false; clearTimeout(timer); };
  }, [branchRegistryRevision]);

  return { branches, loading };
}
