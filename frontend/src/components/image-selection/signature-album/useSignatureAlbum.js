"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createSignatureAlbum, getSignatureAlbum } from "@/services/image-selection/signature-album.service";

/**
 * The project's album as the workspace holds it: loaded once per project, replaced by whatever a
 * write hands back (every album write answers with the whole serialized album, so the header
 * counts, the chapters and the rail all follow one answer), and reloadable.
 *
 * The tab opens the workspace at once, so a project with no album yet gets one made behind the
 * loading state when the login may write (`ensure`): the existing create, which the server keeps
 * unique per project - a 409 from a concurrent opening (the web and the desktop, two tabs) means
 * the other side won, and the album is simply read again. Nothing is published or shared by this;
 * the album starts as the server's own Draft with the studio defaults. A read-only login cannot
 * create, so for it `null` stands and the workspace says so quietly.
 *
 * `album` is `undefined` while loading or being made, `null` when the project has no album and
 * this login cannot start one, and the album otherwise - three states the workspace draws differently, so they are kept apart.
 */
export default function useSignatureAlbum(projectId, { ensure = false } = {}) {
  const [album, setAlbum] = useState(undefined);
  // True once, for the load that made the album: the workspace says so, because a record that
  // came into being should never be silent, even when nobody had to press anything.
  const [created, setCreated] = useState(false);
  const ensuring = useRef(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const reload = useCallback(async ({ reset = false } = {}) => {
    // Switching project (or retrying a load that failed) shows the loader again, with the last
    // failure cleared; a refresh keeps the album on screen meanwhile.
    if (reset && alive.current) { setAlbum(undefined); setCreated(false); setError(""); }
    let step = "load";
    try {
      const response = await getSignatureAlbum(projectId);
      let data = response.data;
      let made = false;
      if (data === null && ensure && !ensuring.current) {
        // Idempotent by the server's unique projectId: the first opening makes the album, every
        // later one - or a simultaneous one that lost - reads what exists.
        ensuring.current = true;
        step = "start";
        try {
          data = (await createSignatureAlbum(projectId)).data;
          made = true;
        } catch (creation) {
          if (creation?.status !== 409) throw creation;
          data = (await getSignatureAlbum(projectId)).data;
        } finally {
          ensuring.current = false;
        }
      }
      if (alive.current) { setAlbum(data); setError(""); if (made) setCreated(true); }
    } catch (failure) {
      if (alive.current) setError(`Unable to ${step} the Signature Album. ${failure.message || ""}`.trim());
    }
  }, [projectId, ensure]);

  useEffect(() => {
    const timer = window.setTimeout(() => reload({ reset: true }), 0);
    return () => window.clearTimeout(timer);
  }, [reload]);

  // Runs one write; an answer shaped like the album replaces the album. Errors are thrown back to
  // the caller, which owns the wording of what went wrong.
  const run = useCallback(async (work) => {
    setBusy(true);
    try {
      const response = await work();
      const data = response?.data;
      if (data && data.id && Array.isArray(data.chapters) && alive.current) setAlbum(data);
      return response;
    } finally {
      if (alive.current) setBusy(false);
    }
  }, []);

  return { album, error, busy, created, reload, run, setAlbum };
}
