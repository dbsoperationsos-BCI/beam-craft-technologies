"use client";

import { useCallback, useEffect, useState } from "react";
import { getMessageTemplate } from "@/services/settings/message-templates.service";

/**
 * One studio-written message, for a screen that is about to hand it over.
 *
 * A hook rather than a copy of the same fetch in each dialog: the onboarding invite and the login
 * credentials both show a message the studio words in Settings, and a third will.
 *
 * **It never fails loudly.** Every caller has its own built-in wording to fall back on - see
 * `renderMessageOr` - so a template that is missing, deleted, or refused to this reader ends in the
 * screen printing what it always printed. Raising an error instead would put a red box over a dialog
 * whose actual job, handing over a link, is working perfectly.
 *
 * The read is guarded by `SETTINGS / Message Template` **or** the sending module's own permission
 * (`HRM / Employee Management` for these two), which is why an HR user reaching this without being
 * an administrator still gets the studio's wording rather than the fallback.
 */
export default function useMessageTemplate(key) {
  const [template, setTemplate] = useState(null);

  const load = useCallback(async () => {
    if (!key) return;
    try {
      const response = await getMessageTemplate(key);
      setTemplate(response?.data || null);
    } catch {
      // Including the 404 for a message nobody has written yet, which is not a fault: the caller's
      // own wording is the answer.
      setTemplate(null);
    }
  }, [key]);

  // Deferred a tick rather than run in the effect body, the way the Settings panels load: the fetch
  // sets state, and doing that synchronously inside an effect is a cascading render.
  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  return template;
}
