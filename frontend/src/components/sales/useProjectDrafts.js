"use client";

import { useCallback, useEffect, useState } from "react";
import { getAuthenticatedUser } from "@/lib/auth";
import { draftForEnquiry, readProjectDrafts, removeDraftsForEnquiry, removeProjectDraft, saveProjectDraft } from "@/lib/projectDrafts.mjs";

// The accessor itself can throw - a private window, blocked site data - so it is asked inside a try.
function browserStorage() {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

const currentUserId = () => getAuthenticatedUser()?.id ?? null;

/**
 * The signed-in user's Create Project drafts, kept in this browser (`lib/projectDrafts.mjs` holds the
 * rules: five days, one per enquiry). Read after mount - local storage is not there while the page is
 * rendered on the server - and again when another tab saves or deletes one, so a draft put aside in
 * the CRM's conversion tab is listed on a Bookings & Converted tab already open.
 */
export default function useProjectDrafts() {
  const [drafts, setDrafts] = useState([]);
  const refresh = useCallback(() => setDrafts(readProjectDrafts(browserStorage(), currentUserId())), []);

  useEffect(() => {
    const timer = window.setTimeout(refresh, 0);
    window.addEventListener("storage", refresh);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("storage", refresh);
    };
  }, [refresh]);

  const save = useCallback((entry) => {
    const storage = browserStorage();
    if (!storage) throw new Error("This browser is not allowing drafts to be kept. Save the project instead, or allow site data for this app.");
    try {
      return saveProjectDraft(storage, currentUserId(), entry);
    } catch {
      throw new Error("This browser would not keep the draft - its storage is full. Delete an old draft and try again.");
    } finally {
      refresh();
    }
  }, [refresh]);

  const remove = useCallback((id) => {
    removeProjectDraft(browserStorage(), currentUserId(), id);
    refresh();
  }, [refresh]);

  const removeForEnquiry = useCallback((enquiryId) => {
    removeDraftsForEnquiry(browserStorage(), currentUserId(), enquiryId);
    refresh();
  }, [refresh]);

  const forEnquiry = useCallback((enquiryId) => draftForEnquiry(browserStorage(), currentUserId(), enquiryId), []);

  return { drafts, save, remove, removeForEnquiry, forEnquiry };
}
