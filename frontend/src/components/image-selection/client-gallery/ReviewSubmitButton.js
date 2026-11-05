"use client";

import Button from "@/components/shared/Button";
import { canReviewItem } from "@/lib/clientGalleryHome.mjs";

/**
 * Review & Submit for the selection item in view. One button for the card list's footer and an
 * open card's header, so the client can send from either without walking back, and both answer
 * the same rule: disabled until the item holds a pick, absent once it is sent (the caller shows
 * "submitted" there instead). It only opens the review - sending happens there.
 */
export default function ReviewSubmitButton({ item, selected = 0, onClick, className = "" }) {
  const enabled = canReviewItem(item, selected);
  return (
    <Button
      type="button"
      variant="plain"
      size="none"
      disabled={!enabled}
      onClick={onClick}
      title={enabled ? undefined : `Pick at least one photo for ${item?.name || "this selection item"} first.`}
      className={`whitespace-nowrap rounded-lg bg-slate-700 text-white hover:bg-slate-800 disabled:opacity-40 ${className}`}
    >
      Review &amp; Submit
    </Button>
  );
}
