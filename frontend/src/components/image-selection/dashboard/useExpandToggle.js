"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { setImageSelectionExpand } from "@/services/image-selection/image-selection.service";

/**
 * An Expand row's ⋮ → Enable / Disable.
 *
 * Expand is the reader's own view of the dashboard: enabling or disabling a project changes nothing
 * about the project, its gallery or its selections. The row's Activity is updated once the server
 * has it - the row stays in the table, marked - and `onChanged` follows, which the popup uses to
 * read its cards again. One change at a time: a second press while one is on its way is ignored
 * rather than raced, and a failure leaves the row as it was and says so (`onError`).
 */
export default function useExpandToggle({ setData, onError, onChanged }) {
  const [busyId, setBusyId] = useState(null);
  const pending = useRef(false);

  const toggle = useCallback(async (row, enabled) => {
    if (pending.current) return;
    pending.current = true;
    setBusyId(row.id);
    try {
      await setImageSelectionExpand(row.id, enabled);
      setData((current) => (current?.recentProjects
        ? { ...current, recentProjects: current.recentProjects.map((item) => (item.id === row.id ? { ...item, expandEnabled: enabled } : item)) }
        : current));
      onChanged?.(row, enabled);
    } catch (caught) {
      onError?.(caught?.message || "Unable to update Expand.");
    } finally {
      pending.current = false;
      setBusyId(null);
    }
  }, [setData, onError, onChanged]);

  // One object per change, so a table keyed on it rebuilds its columns only when the busy row does.
  return useMemo(() => ({ busyId, toggle }), [busyId, toggle]);
}
