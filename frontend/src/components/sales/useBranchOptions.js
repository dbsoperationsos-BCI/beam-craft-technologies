"use client";

import { useEffect, useState } from "react";
import { getCrmBranches } from "@/services/sales/crm-leads.service";
import useBranchRegistry from "@/components/shared/useBranchRegistry";

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
 * Nothing is written down to stand in while the request is in flight: the picker is empty until the
 * studio's own branches arrive, so it never offers a name the branch table does not hold.
 *
 * Asked again whenever the branch register changes, so a branch added or renamed in Settings —
 * an overlay over the very screens this fills — is offered here without the page being reloaded.
 * The options already on screen are held until the new answer arrives and are only replaced when it
 * is not empty, so a refresh never blinks a picker empty.
 */
export default function useBranchOptions() {
  const [branches, setBranches] = useState([]);
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
          // An empty answer on a refresh keeps the branches already shown rather than blinking empty.
          if (live && options.length) setBranches(options);
        })
        .catch(() => {})
        .finally(() => { if (live) setLoading(false); });
    }, 0);
    return () => { live = false; clearTimeout(timer); };
  }, [branchRegistryRevision]);

  return { branches, loading };
}
