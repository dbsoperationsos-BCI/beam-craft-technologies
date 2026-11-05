"use client";

import { useCallback, useEffect, useState } from "react";
import { getMasterData } from "@/services/hrm/master-data.service";
import { getQuotationBrandShoots } from "@/services/sales/quotation-brands.service";
import { brandCodeForVertical } from "@/lib/quotationBrand.mjs";
import { offerTypeOptions, referredFromOptions, relationshipOptions, religionOptions } from "./quotationVerticalConfig";

/**
 * The suggestions behind Relationship, Referred From and Offer Type, and the Shoot Type list,
 * wherever a lead's details are asked for.
 *
 * Both are typed-with-suggestions fields: the list is offered so the common answers are spelled
 * one way, and anything not on it can still be typed. The two lists were written out twice - once
 * in `CRMPage.js` for Add Lead and the lead popup, once in `quotationVerticalConfig.js` for the
 * Quotation Generator's Client Details - and no studio could add to either. They are maintained in
 * Settings → Field Settings → Quotation now, and this is the one place both screens read them
 * from, so a source added there is suggested on the lead and on the quotation alike.
 *
 * Reads through the HRM master data like every other list that screen edits
 * (`/api/hrm/lead-relationships`, `/api/hrm/referral-sources`). The arrays in
 * `quotationVerticalConfig.js` are what the two fields have always suggested and stand in while
 * the request is in flight, if it fails, or for a table nobody has seeded - so the worst case is
 * the behaviour this replaces rather than a field with nothing to suggest.
 *
 * Fetched on mount, which is per open for the lead popup and the quotation panel. The Add Lead form
 * lives on the CRM page itself, so an entry added in Settings while that page is open reaches it
 * on the next load - the same as the tiers and payment modes read this way, and unlike the
 * branches, which carry a registry revision for the purpose.
 */
// Category's fallback is empty, which is the honest answer: the studio ships with no list, so a
// failed request leaves the dropdown with nothing rather than with somebody else's wording.
//
// Shoot Type has no fallback either, and `status.shootType` says why the list is empty when it
// is: "loading" while the request is out, "error" when it failed, "ready" when this is the answer.
// The array that used to stand in was the hardcoded list this replaces, and falling back to it
// would quietly offer a shoot the studio had removed in Settings. The other three keep their
// fallback on purpose: they are suggestions under a field that can be typed into, so standing in
// with the words always offered costs nothing, where an empty closed list would.
const FALLBACK = { relationship: relationshipOptions, referredFrom: referredFromOptions, offerType: offerTypeOptions, religion: religionOptions, shootType: [] };
const NO_FALLBACK = new Set(["religion", "shootType"]);

/** The resource each field reads, so the keys here are the lead keys the forms already use. */
const RESOURCES = [["relationship", "lead-relationships"], ["referredFrom", "referral-sources"], ["offerType", "offer-types"], ["religion", "religions"]];

/*
 * Shoot Type is not an HRM list at all: it is the brand's own shoots - Settings → Fields → Shoot
 * Types, a tab per brand - which the Quotation Generator's Add Shoot reads for the quotation's
 * brand. The lead reads the same list for its own vertical, through `getQuotationBrandShoots`,
 * so the two screens can never be offered different shoots. No brand (a vertical nothing
 * resolves) is answered with nothing, and is "ready": there is no list to wait for.
 */
function readShootTypes(brand) {
  if (!brand) return Promise.resolve({ key: "shootType", names: [], failed: false });
  return getQuotationBrandShoots(brand)
    .then((response) => ({ key: "shootType", names: (Array.isArray(response?.data) ? response.data : []).map((name) => String(name || "").trim()).filter(Boolean), failed: false }))
    .catch(() => ({ key: "shootType", names: [], failed: true }));
}

/**
 * `vertical` is the lead's or the quotation's vertical ("Dum Dum"), and decides which brand's
 * Categories and Shoot Types are read: both are kept per brand in Field Settings, so a Qua Qua
 * lead or quotation is offered Qua Qua's and none of Dum Dum's. Refetched when the vertical
 * changes, and an answer that lands after the vertical has moved on is dropped (`live`), so a
 * slow Dum Dum reply can never fill a form that now says Qua Qua.
 */
export default function useLeadSuggestionLists({ vertical } = {}) {
  const [lists, setLists] = useState({ ...FALLBACK, status: { shootType: "loading" } });
  // Bumped by `reload`, which is the way back from a failed load without leaving the form.
  const [attempt, setAttempt] = useState(0);
  const brand = vertical ? brandCodeForVertical(vertical) : null;
  const reload = useCallback(() => {
    setLists((current) => ({ ...current, status: { ...current.status, shootType: "loading" } }));
    setAttempt((count) => count + 1);
  }, []);

  useEffect(() => {
    let live = true;
    // Deferred a tick, which is this codebase's convention for a first load: a fetch started
    // straight from an effect body counts as state set during that effect.
    const timer = setTimeout(() => {
      // Said to be loading again for a vertical switch, not only the first time: the rows would
      // otherwise offer the previous brand's shoots as if they were this one's until the reply.
      if (live) setLists((current) => (current.status.shootType === "loading" ? current : { ...current, status: { ...current.status, shootType: "loading" } }));
      void Promise.all([
        ...RESOURCES.map(([key, resource]) => getMasterData(resource, { active: true, ...(key === "religion" && brand ? { vertical: brand } : {}) })
          .then((response) => ({ key, names: (response?.data || []).map((row) => row?.name).filter(Boolean), failed: false }))
          .catch(() => ({ key, names: [], failed: true }))),
        readShootTypes(brand),
      ])
        .then((results) => {
          if (!live) return;
          // A list that came back empty stays on what it always suggested rather than suggesting
          // nothing: an unseeded table is not an instruction to offer no answers. Category and
          // Shoot Type are the exceptions: a brand with no categories yet must show none, not the
          // previous brand's, and a studio that has emptied its shoot types must be offered none.
          const loaded = Object.fromEntries(results
            .filter(({ key, names }) => names.length || NO_FALLBACK.has(key))
            .map(({ key, names }) => [key, names]));
          const shootTypes = results.find(({ key }) => key === "shootType");
          setLists((current) => ({ ...current, ...loaded, status: { ...current.status, shootType: shootTypes?.failed ? "error" : "ready" } }));
        });
    }, 0);
    return () => { live = false; clearTimeout(timer); };
  }, [brand, attempt]);

  return { ...lists, reload };
}
