"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/*
 * What a refresh must not lose.
 *
 * `useUrlParam` keeps one thing that is open - a form, a record's view, a selected row - in the page's
 * address (`/hrm/client-details?open=subscription:abc`), so a refresh, the Back button and a copied link
 * all open the page exactly as it was. It replaces the address rather than adding to the history, so
 * opening and closing things does not fill Back with steps.
 *
 * `useDraft` keeps what is being typed into a form in this tab's sessionStorage until the form is saved
 * or closed, so a refresh in the middle of filling one in brings the typing back.
 */

// The address a `set` has asked for but the router has not landed yet. Two quick changes (a row's
// click then its double-click) would otherwise each start from the old address, and the second would
// undo the first.
let pendingSearch = null;

export function useUrlParam(key) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const value = params.get(key);

  const set = useCallback((next) => {
    const query = new URLSearchParams(pendingSearch ?? window.location.search);
    if (next === null || next === undefined || next === "") query.delete(key);
    else query.set(key, String(next));
    const text = query.toString();
    pendingSearch = text ? `?${text}` : "";
    window.setTimeout(() => { pendingSearch = null; }, 100);
    router.replace(text ? `${pathname}?${text}` : pathname, { scroll: false });
  }, [key, pathname, router]);

  return [value, set];
}

const draftKey = (key) => `beamcraft_draft:${key}`;

/** Clears a draft, for a form that has just been saved or closed. */
export function clearDraft(key) {
  try {
    window.sessionStorage.removeItem(draftKey(key));
  } catch {
    // Storage blocked: there was no draft to keep either.
  }
}

/**
 * `useState` for a form's values that survives a refresh. `key` names the form and the record it is for
 * (`subscription:abc`, `client:new`); a different key is a different draft. `restore` tidies a saved
 * draft before use - a picked file, for one, cannot be kept and comes back as nothing.
 */
export function useDraft(key, initial, restore = (saved) => saved) {
  const [values, setValues] = useState(() => {
    if (typeof window === "undefined" || !key) return typeof initial === "function" ? initial() : initial;
    try {
      const saved = window.sessionStorage.getItem(draftKey(key));
      if (saved) return restore(JSON.parse(saved));
    } catch {
      // A damaged or blocked draft: start from the record.
    }
    return typeof initial === "function" ? initial() : initial;
  });
  const first = useRef(true);
  useEffect(() => {
    // The first render is the record (or the draft) itself, not a change worth keeping.
    if (first.current) {
      first.current = false;
      return;
    }
    if (!key) return;
    try {
      window.sessionStorage.setItem(draftKey(key), JSON.stringify(values));
    } catch {
      // Full or blocked storage: the form still works, it just will not survive a refresh.
    }
  }, [key, values]);
  return [values, setValues];
}
