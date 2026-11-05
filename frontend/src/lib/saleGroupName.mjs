/**
 * What the WhatsApp Group Name fields become when a different enquiry is chosen.
 *
 * Group names are saved against an enquiry, so the name belongs to the enquiry rather than to the
 * form: choosing an enquiry chooses its name, and choosing a different one must not leave the
 * previous enquiry's name sitting in the box.
 *
 * That last part is not only cosmetic, which is why this is worth a helper of its own. The form
 * carries `whatsappGroupNameId` beside the text, and that id is the generator row the save claims —
 * so a stale name is a stale id, and saving it would claim the name reserved for one enquiry
 * against the project being created for another.
 *
 * Three outcomes, and the third is the one that is easy to get wrong:
 *
 *   - the new enquiry has a name waiting  → take it, id and all
 *   - the enquiry changed and it has none → clear, so nothing is carried over from the last one
 *   - the enquiry did not really change   → leave everything alone
 *
 * The third case is what stops a re-selection of the same enquiry, or a search that resolves to the
 * enquiry already chosen, from wiping a name the user picked or typed by hand.
 */

/** The group name fields emptied — the shape the form holds them in, not nulls. */
const CLEARED = { whatsappGroupNameId: "", whatsappGroupName: "", groupType: "", vertical: "" };

export function groupNameFieldsForEnquiry({ currentEnquiryId, nextEnquiryId, savedForEnquiry } = {}) {
  if (savedForEnquiry) {
    return {
      whatsappGroupNameId: savedForEnquiry.id,
      whatsappGroupName: savedForEnquiry.generatedName,
      groupType: savedForEnquiry.groupType,
      vertical: savedForEnquiry.vertical,
    };
  }
  // Compared as written: the ids are the studio's own strings and are never re-cased on the way in,
  // so an exact comparison is the right one and a loose one would call two enquiries the same.
  return nextEnquiryId !== currentEnquiryId ? { ...CLEARED } : {};
}

/** Ids are compared as trimmed strings: the form holds one typed into a search box. */
const asId = (value) => String(value ?? "").trim();

/**
 * The saved group names that belong to one enquiry — which is all the picker may offer.
 *
 * A name is generated *for* a lead, so the studio's whole pool of unused names is not a list of
 * choices: all but one of them belong to somebody else's booking, and picking one of those is how a
 * project ends up carrying a name generated for a different client. The picker therefore lists the
 * names saved against the enquiry chosen and nothing else, the same way the quotation list beside
 * it narrows to that enquiry rather than offering every quotation in the studio.
 *
 * With no enquiry chosen the answer is nothing rather than everything, for the same reason.
 *
 * Names carrying no `enquiryId` are left out, and that is deliberate: the column is nullable only
 * for rows generated before the generator asked which lead a name was for, so such a name cannot be
 * shown to belong to the enquiry in hand. The "Enter manually" switch beside the picker is how one
 * of those is still used — it is typed rather than claimed.
 */
export function groupNamesForEnquiry(groupNames, enquiryId) {
  const enquiry = asId(enquiryId);
  if (!enquiry) return [];
  return (groupNames || []).filter((groupName) => asId(groupName?.enquiryId) === enquiry);
}

/**
 * The one name to fill in automatically when an enquiry is chosen — the first saved against it.
 *
 * Reads through `groupNamesForEnquiry` rather than matching separately, so what the form fills in
 * is always something the picker would also have offered. The two matching by different rules is
 * how a form ends up holding a name that its own dropdown does not list.
 */
export function savedGroupNameForEnquiry(groupNames, enquiryId) {
  return groupNamesForEnquiry(groupNames, enquiryId)[0] || null;
}

/**
 * Whether the **Saved** side of the group-name switch has anything behind it.
 *
 * The switch already followed the enquiry — landing on Manual for one with no generated name — but
 * Saved stayed pressable beside it, and pressing it swapped a usable box for a dropdown whose only
 * content was a sentence explaining that it was empty.
 *
 * Three things make it unavailable, and each is a different "no":
 *
 *   - **Still loading.** Not an answer yet. Left available, or the button would grey out for a
 *     moment on every enquiry and come back, which reads as a control that flickers.
 *   - **Nothing saved for this enquiry.** The real case, and the one the studio meets: names are
 *     generated per enquiry, so an enquiry nobody has generated one for has nothing to offer.
 *   - **Unless Saved is already the mode.** An existing project whose enquiry has since lost its
 *     generated names would otherwise have the button it is standing on greyed out.
 *
 * No enquiry chosen yet is deliberately *not* one of them: the dropdown then says "Choose an enquiry
 * first", which is the one place that guidance appears, and disabling the switch would hide it and
 * invite a name to be typed before the enquiry it belongs to has been picked.
 */
export function savedGroupNameModeAvailable({ groupNames, enquiryId, isLoading = false, mode = "saved" } = {}) {
  if (isLoading || mode === "saved") return true;
  if (!String(enquiryId || "").trim()) return true;
  return groupNamesForEnquiry(groupNames, enquiryId).length > 0;
}
