"use client";

import { useEffect, useMemo, useState } from "react";
import { getMasterData } from "@/services/hrm/master-data.service";

/**
 * The option lists a form draws from, read from the ones the studio maintains.
 *
 * A dozen screens ask the same question - "what may this dropdown offer?" - and each used to answer
 * it with an array written beside the field. Those arrays are the studio's vocabulary rather than
 * the application's: what state an asset is in, how it travels, what a vendor is engaged for. They
 * are lists in Settings → Fields now, and this is the one read of them the forms share.
 *
 * Give it what each option key is called and what it used to be:
 *
 *     const lists = useEditableLists({ assetConditions: ["asset-conditions", assetConditions] });
 *
 * and hand the result to `context.options`, where the field descriptions already look their choices
 * up by name. What comes back is names only - which is all any of these fields stores.
 *
 * **It always answers.** The fallbacks are returned from the first render, so a form opened before
 * the fetch lands is never a dropdown with nothing in it; a read that fails or comes back empty
 * leaves them in place, which is exactly what the form offered before the list existed. That is the
 * same rule the server keeps in `services/optionLists.js`, and for the same reason: on this screen
 * an empty picker is not a smaller failure than a wrong one.
 *
 * The spec is read once, on mount. These are the studio's lists, edited in Settings, not something
 * that changes while somebody is filling in the form in front of it.
 */
export default function useEditableLists(spec) {
  const [fetched, setFetched] = useState(null);

  // The resources to read, as a stable string, so a caller writing the spec inline in its render -
  // which every caller does - does not refetch on every keystroke in the form.
  const resources = Object.entries(spec).map(([key, [resource]]) => `${key}:${resource}`).sort().join(",");

  useEffect(() => {
    let live = true;
    const pairs = resources.split(",").map((entry) => entry.split(":"));
    Promise.all(pairs.map(async ([key, resource]) => {
      try {
        const response = await getMasterData(resource, { active: true });
        const names = (Array.isArray(response?.data) ? response.data : []).map((row) => row.name).filter(Boolean);
        return [key, names.length ? names : null];
      } catch {
        // Left as null, so the fallback stands. Nothing is said on screen: the form still offers
        // every answer it ever did, and a notice about a list nobody has edited would be noise.
        return [key, null];
      }
    })).then((entries) => {
      if (live) setFetched(Object.fromEntries(entries));
    });
    return () => { live = false; };
  }, [resources]);

  return useMemo(() => Object.fromEntries(
    Object.entries(spec).map(([key, [, fallback]]) => [key, fetched?.[key] || fallback]),
  // `resources` rather than `spec`, which is a fresh object every render; the fallbacks belong to
  // the same literal and change with it.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ), [fetched, resources]);
}
