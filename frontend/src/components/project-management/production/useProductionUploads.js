"use client";

import { useCallback, useRef, useState } from "react";
import { dropUpload, enqueueUploads, markUpload, nextWaiting, retryUploads } from "@/lib/productionUploads.mjs";
import { addProductionFiles } from "@/services/project-management/production.service";

/*
 * Why a file did not land, in words for somebody standing at a venue. A dropped connection comes
 * back from `apiRequest` naming the API's address, which means nothing on a phone; everything else
 * (the upload limit's "Too many uploads. Please try again in 1 minute.", a refused file type) is
 * already the server's own sentence.
 */
const reasonFor = (error) => (error?.code === "NETWORK_ERROR" ? "No connection." : error?.message || "Upload failed.");

/**
 * Sends the queue one file at a time and keeps what failed. `onUploaded` receives the shoot as it
 * stands after each file lands, so the list fills in as the photos arrive rather than all at once
 * at the end of a slow upload. `onDrained` runs once when nothing is left to send and at least one
 * file landed - the moment for anything that should hear about the batch once rather than per photo
 * (the board behind the panel). It still runs if the panel was closed mid-upload.
 */
export default function useProductionUploads(shootId, onUploaded, onDrained) {
  const [queue, setQueue] = useState([]);
  // The queue as it stands now; state only follows it, so a photo taken mid-upload is never lost.
  const current = useRef([]);
  const running = useRef(false);
  const commit = useCallback((next) => { current.current = next; setQueue(next); }, []);

  const pump = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    let landed = 0;
    try {
      for (let item = nextWaiting(current.current); item; item = nextWaiting(current.current)) {
        commit(markUpload(current.current, item.id, "uploading"));
        try {
          const response = await addProductionFiles(shootId, item.kind, [{ name: item.name, data: item.data }], item.travelMode);
          commit(dropUpload(current.current, item.id));
          landed += 1;
          onUploaded?.(response?.data);
        } catch (error) {
          commit(markUpload(current.current, item.id, "failed", reasonFor(error)));
        }
      }
    } finally {
      running.current = false;
      if (landed) onDrained?.();
    }
  }, [commit, onDrained, onUploaded, shootId]);

  const add = useCallback((kind, files, meta) => {
    if (!files?.length) return;
    commit(enqueueUploads(current.current, kind, files, meta));
    void pump();
  }, [commit, pump]);

  const retry = useCallback((kind) => { commit(retryUploads(current.current, kind)); void pump(); }, [commit, pump]);
  const discard = useCallback((id) => commit(dropUpload(current.current, id)), [commit]);

  return { queue, add, retry, discard, pending: queue.length };
}
