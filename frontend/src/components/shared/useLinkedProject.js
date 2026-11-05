"use client";

import { useEffect } from "react";
import useLinkedParam from "./useLinkedParam";

/**
 * A project named in the address (`?project=<event id>`), for a board to land on.
 *
 * A "Navigate to" from another board sends the reader here to *see* that project, and the board answers
 * by **filtering its Event ID column to it**: the project stands alone on screen, the filter box
 * says why, and clearing it gives the whole board back. Landing by scrolling to the row was the
 * first attempt and a poor one - on a board of hundreds it moved a highlight somewhere below the
 * fold, which is the hunting it was meant to spare the reader.
 *
 * The tabs are the other half. A board opens on whichever tab was last used, so a jump **always
 * brings it to All**, whatever tab was in front of the reader: the project is on it whatever its
 * status, and clearing the filter afterwards gives back the whole board rather than the slice of it
 * the reader happened to leave open last time. Landing on the old tab when the project was on it
 * was the earlier rule, and it left the reader on a filtered board they had not asked for.
 *
 * It answers the event id to filter by, or "" - and `clear`, which the board calls once it has
 * landed, so a reload does not filter all over again and the reader is free to change tab after.
 */
export default function useLinkedProject({ tab, onTab, allTab = "All" } = {}) {
  const [linkedEventId, clear] = useLinkedParam("project");
  useEffect(() => {
    if (!linkedEventId || tab === allTab) return;
    onTab?.(allTab);
  }, [allTab, linkedEventId, onTab, tab]);
  return [linkedEventId, clear];
}
