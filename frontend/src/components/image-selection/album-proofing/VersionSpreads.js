"use client";

import Button from "@/components/shared/Button";

/**
 * The way into one frozen version's own spreads, from the Versions list.
 *
 * A version froze a copy of every page it held, under keys of its own, so it can still be shown
 * exactly as it went to QC however many versions have followed it. The list said how many pages a
 * version had and gave no way to look at them, which is what made earlier rounds feel lost.
 *
 * It opens the review panel the album already uses — the same spreads, the same correction pins,
 * the same zoom — in its history mode, where nothing can be changed. A thumbnail grid stood here
 * before and could show the pages but not what was marked on them, which is most of what anybody
 * opens an old round to see.
 */
export default function VersionSpreads({ version, onOpen }) {
  return <div className="mt-2">
    <Button
      type="button"
      size="none"
      className="px-0 text-[11px] font-semibold text-blue-700 hover:text-blue-900"
      variant="plain"
      onClick={() => onOpen?.(version)}
    >
      View V{version.versionNumber} spreads
    </Button>
  </div>;
}
