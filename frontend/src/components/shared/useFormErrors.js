"use client";

import { useCallback, useMemo, useState } from "react";
import { hasErrors, markedFieldsMessage, onlyErrors, serverFieldErrors } from "@/lib/formErrors.mjs";

/**
 * A form's red boxes: which fields are wrong, the one line above them, and the way to the first.
 *
 *   const form = useFormErrors();
 *   <form ...>
 *     {form.summary && <p role="alert">{form.summary}</p>}
 *     <TextField error={form.errors.email} onChange={(e) => { form.clear("email"); ... }} />
 *
 *   function submit() {
 *     if (!form.check({ email: email ? "" : "Enter the candidate's email." })) return;
 *     try { await save(); } catch (error) { if (!form.fromServer(error)) showError(error.message); }
 *   }
 *
 * `check` takes the form's own problems - `{ field: message }`, "" for a field that is fine - puts
 * each message under its box, and brings the first wrong box into view and focus. A box clears its
 * own mark when it is changed (`clear`), so the red follows the answers rather than waiting for the
 * next press. `fromServer` does the same for the server's field problems (`serverFieldErrors`), and
 * answers false when the failure named no field, so the caller still reports it its own way.
 *
 * The scroll goes to the first marked box - `aria-invalid`, or `data-invalid` on a button, which
 * every shared input sets while it carries an error - in the topmost open dialog, or on the page
 * when none is open. A form is the thing in front, so that is where its boxes are.
 */
const MARKED = '[aria-invalid="true"], [data-invalid="true"]';
export default function useFormErrors() {
  const [errors, setErrors] = useState({});
  const revealFirst = useCallback(() => {
    // After the paint that drew the marks, or there is nothing marked to find yet.
    window.requestAnimationFrame(() => {
      const dialogs = document.querySelectorAll('[aria-modal="true"]');
      const first = (dialogs[dialogs.length - 1] || document).querySelector(MARKED);
      if (!first) return;
      first.scrollIntoView({ behavior: "smooth", block: "center" });
      // Focus only a box that is typed into: focusing a search or pick-list opens its list over the
      // very messages the reader was sent to see.
      const opensAList = first.getAttribute("role") === "combobox" || first.hasAttribute("aria-haspopup") || first.hasAttribute("aria-autocomplete") || first.hasAttribute("list");
      if (!opensAList) first.focus?.({ preventScroll: true });
    });
  }, []);

  const show = useCallback((problems) => {
    const found = onlyErrors(problems);
    setErrors(found);
    if (hasErrors(found)) revealFirst();
    return found;
  }, [revealFirst]);

  /** True when nothing is wrong; otherwise marks the boxes and answers false. */
  const check = useCallback((problems) => !hasErrors(show(problems)), [show]);

  const clear = useCallback((field) => {
    setErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  }, []);

  const clearAll = useCallback(() => setErrors({}), []);

  /** Marks the boxes the server named; false when it named none. */
  const fromServer = useCallback((error, keyMap) => {
    const found = serverFieldErrors(error, keyMap);
    if (!hasErrors(found)) return false;
    show(found);
    return true;
  }, [show]);

  const count = Object.keys(errors).length;
  const summary = markedFieldsMessage(count);

  return useMemo(
    () => ({ errors, check, clear, clearAll, fromServer, summary, count, setErrors: show }),
    [check, clear, clearAll, count, errors, fromServer, show, summary],
  );
}
