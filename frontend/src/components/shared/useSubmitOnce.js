"use client";

import { useCallback, useRef, useState } from "react";

/**
 * One press, one request — the guard every button that writes should be wearing.
 *
 * Two clicks on a Confirm that posts a new record make two records. The enquiry id, the candidate
 * code, the vendor number are all minted **on the server**, so the second write is not a duplicate
 * the database can refuse: it is a second, equally real row, with its own id, that somebody now has
 * to find and delete. On a slow connection the window is seconds wide, which is exactly when people
 * press again.
 *
 * ── Why a ref and not only state ──
 *
 * `disabled={busy}` is the half everyone writes, and on its own it is not enough. React state
 * updates are asynchronous: two clicks landing in the same tick both read `busy === false` and both
 * fire before the re-render that would have greyed the button out. A double-click is precisely two
 * clicks in the same tick. So the ref is the actual guard - it is written synchronously, before
 * anything awaits - and the state exists to *show* what the ref already decided.
 *
 * ── Why not a delay ──
 *
 * Because it does not fix this. Whatever delay is chosen, a save slower than it is still double
 * postable, and every ordinary save now feels sluggish to pay for the one in fifty that was not.
 * The honest signal is "this is running, and it is not finished", which is what `busy` says.
 *
 * ```js
 * const { busy, run } = useSubmitOnce();
 * <Button disabled={busy} onClick={() => run(() => saveLead(entries))}>
 *   {busy ? "Adding…" : "Confirm"}
 * </Button>
 * ```
 *
 * `run` returns whatever the work returned, or `undefined` for a press it ignored - so a caller that
 * acts on the result can tell "it failed" from "it never ran". The work's own errors are left to
 * propagate: this decides *whether* something runs, never what it means when it goes wrong.
 */
export default function useSubmitOnce() {
  /*
   * Written before the first `await`, so a second press in the same tick sees it. This is the guard;
   * `busy` below is the part the reader can see.
   */
  const running = useRef(false);
  const [busy, setBusy] = useState(false);

  const run = useCallback(async (work) => {
    if (running.current) return undefined;
    running.current = true;
    setBusy(true);
    try {
      return await work();
    } finally {
      /*
       * Released whatever happened. A save that threw has to leave the button usable, or a network
       * blip locks somebody out of the form until they reload and lose what they typed - which is a
       * worse failure than the double-post this exists to prevent.
       */
      running.current = false;
      setBusy(false);
    }
  }, []);

  return { busy, run };
}
