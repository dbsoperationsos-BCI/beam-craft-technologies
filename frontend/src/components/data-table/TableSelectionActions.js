"use client";

import { createContext, useCallback, useContext, useEffect, useId, useMemo, useState } from "react";
import CloseIcon from "@/components/ui/CloseIcon";
import Button from "@/components/shared/Button";
import IconButton from "@/components/shared/IconButton";

/**
 * What a selection can be done with, drawn in the module header rather than over the page.
 *
 * ── Where these buttons used to be ────────────────────────────────────────────────────────────
 *
 * A bar anchored to the bottom of the window, portalled to `body`, shown by every table with tick
 * boxes. It was written that way because twenty-odd tables do not share a header shape and a bar
 * per page would have been twenty-odd answers to one question. What it cost was that the actions on
 * a selection sat nowhere near the actions on the screen: Leads & Followups and the Interview
 * register had both grown their own buttons in the module header instead, so the application
 * answered the same question in two places, and on the Interview register in *both* at once.
 *
 * ── How they reach a header without every page wiring it up ───────────────────────────────────
 *
 * `AppShell` mounts the provider above every header and every table. A table with something ticked
 * publishes **what to draw** - a count, a noun and three callbacks - and `ModulePageHeader` renders
 * it among its own actions, in place of them.
 *
 * Props rather than rendered buttons, and no portal, and that is the point rather than a detail.
 * The header sizes its buttons in `globals.css` with `.module-page-header-actions > button`, a
 * child combinator: anything arriving inside a wrapper of its own is a grandchild, misses the rule
 * and keeps Tailwind's taller default, so the title bar grew as rows were ticked and shrank as they
 * were cleared. Handed over as props, these buttons are the header's own children - the same DOM,
 * the same rule, the same height as the Add button they stand in for, with nothing to keep in step.
 *
 * **A table with no module header on screen has nowhere to put them.** All nineteen tables that
 * carry tick boxes today sit under one, and `test/table-select-all.test.mjs` fails if a twentieth
 * is added that does not.
 */

const SelectionActionsContext = createContext(null);

/** Whether two published sets say the same thing, so an unchanged one is never a state update. */
function same(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key]);
}

/**
 * Mounted once, in `AppShell`, above every header and every table.
 *
 * Holds what each table is publishing, by table. The last to publish is what the header draws: a
 * page with two tables carrying tick boxes is not a shape this application has, and answering with
 * the most recent is better than answering with both at once.
 */
export function SelectionActionsProvider({ children }) {
  const [published, setPublished] = useState(() => new Map());

  const publish = useCallback((id, props) => {
    setPublished((current) => {
      if (same(current.get(id) || null, props || null)) return current;
      const next = new Map(current);
      if (props) next.set(id, props); else next.delete(id);
      return next;
    });
  }, []);

  const value = useMemo(() => ({ publish, current: [...published.values()].at(-1) || null }), [publish, published]);
  return <SelectionActionsContext.Provider value={value}>{children}</SelectionActionsContext.Provider>;
}

/**
 * A table offering what its selection can be done with, or `null` when it has nothing ticked.
 *
 * The props must be stable while they say the same thing - built with `useMemo` over values rather
 * than rebuilt each render - or this publishes on every render. The provider compares before it
 * stores, so a caller that slips is slow rather than stuck in a loop.
 */
export function useSelectionActions(props) {
  const context = useContext(SelectionActionsContext);
  const id = useId();
  const publish = context?.publish;

  useEffect(() => {
    if (!publish) return undefined;
    publish(id, props);
    return () => publish(id, null);
  }, [publish, id, props]);
}

/** What the header draws in place of its own actions, or null while nothing is ticked. */
export function useSelectionActionsProps() {
  return useContext(SelectionActionsContext)?.current || null;
}

/**
 * The buttons themselves, as a fragment: the header lays them out beside its own.
 *
 * The count rides on each button rather than on a sentence beside them - "Delete (12)" says what
 * would happen and to how many in the width the header has, where "12 selected" needed a line of
 * its own. Export first and Delete after it, the order these tables have always shown; the cross
 * clears the selection, which on a table scrolled past its first screen is the only way back that
 * does not mean finding every tick again.
 */
export default function TableSelectionActions({ count, noun = "row", plural, onClear, onExport, onDelete, deleting = false, exporting = false }) {
  if (!count) return null;

  const many = plural || `${noun}s`;
  const counted = count.toLocaleString();

  return <>
    <span className="sr-only" aria-live="polite">{`${counted} ${count === 1 ? noun : many} selected`}</span>
    {onExport && <Button type="button" onClick={onExport} disabled={exporting || deleting}>
      {exporting ? "Exporting…" : `Export (${counted})`}
    </Button>}
    {onDelete && <Button type="button" variant="danger" onClick={onDelete} disabled={deleting || exporting}>
      {deleting ? "Deleting…" : `Delete (${counted})`}
    </Button>}
    <IconButton onClick={onClear} label="Clear the selection" size="sm" shape="circle" disabled={deleting} className="text-slate-500">
      <CloseIcon />
    </IconButton>
  </>;
}
