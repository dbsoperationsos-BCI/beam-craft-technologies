"use client";

import { useEffect, useState } from "react";
import { getMasterData } from "@/services/hrm/master-data.service";
import { brandCodeForVertical } from "@/lib/quotationBrand.mjs";
import { offerTypeOptions, referredFromOptions, relationshipOptions, religionOptions } from "./quotationVerticalConfig";

/**
 * The suggestions behind Relationship, Referred From and Offer Type, wherever a lead's details are
 * asked for.
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
const FALLBACK = { relationship: relationshipOptions, referredFrom: referredFromOptions, offerType: offerTypeOptions, religion: religionOptions };

/** The resource each field reads, so the keys here are the lead keys the forms already use. */
const RESOURCES = [["relationship", "lead-relationships"], ["referredFrom", "referral-sources"], ["offerType", "offer-types"], ["religion", "religions"]];

/**
 * `vertical` is the quotation's vertical ("Dum Dum"), and decides which brand's Categories are
 * read: the list is kept per brand in Field Settings, so a Qua Qua quotation is offered Qua Qua's
 * categories and none of Dum Dum's. Refetched when the vertical changes. The CRM passes nothing -
 * it does not ask for a category - and reads the other three lists exactly as before.
 */
export default function useLeadSuggestionLists({ vertical } = {}) {
  const [lists, setLists] = useState(FALLBACK);
  const brand = vertical ? brandCodeForVertical(vertical) : null;

  useEffect(() => {
    let live = true;
    // Deferred a tick, which is this codebase's convention for a first load: a fetch started
    // straight from an effect body counts as state set during that effect.
    const timer = setTimeout(() => {
      void Promise.all(RESOURCES.map(([key, resource]) => getMasterData(resource, { active: true, ...(key === "religion" && brand ? { vertical: brand } : {}) })
        .then((response) => [key, (response?.data || []).map((row) => row?.name).filter(Boolean)])
        .catch(() => [key, []])))
        .then((entries) => {
          if (!live) return;
          // A list that came back empty stays on what it always suggested rather than suggesting
          // nothing: an unseeded table is not an instruction to offer no answers. Category is the
          // exception, because its answer is per brand: a brand with no categories yet must show
          // none, not the previous brand's.
          const loaded = Object.fromEntries(entries.filter(([key, names]) => names.length || key === "religion"));
          if (Object.keys(loaded).length) setLists((current) => ({ ...current, ...loaded }));
        });
    }, 0);
    return () => { live = false; clearTimeout(timer); };
  }, [brand]);

  return lists;
}
