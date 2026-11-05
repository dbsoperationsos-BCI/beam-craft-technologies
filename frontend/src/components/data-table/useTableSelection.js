"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useModuleAccess } from "@/components/auth/PermissionsProvider";
import { deleteTableRows } from "@/services/api/tableSelection.service";
import { selectedFrom } from "./tableSelection";

/** What one request may carry; `services/bulkDelete.js` refuses more. A larger selection sends twice. */
const CHUNK = 500;

/** A stable empty array, so a table without the permission does not hand a new one out each render. */
const EMPTY_ROWS = [];

function errorMessage(error, fallback) {
  const message = String(error?.message || "").trim();
  return message && !message.startsWith("Request failed with status") ? message : fallback;
}

/**
 * The tick boxes on a table, and the two things a selection leads to.
 *
 * ── The permission ──
 *
 * `ADMIN / Table Select All` Read / Write, and nothing else, decides whether there are boxes at
 * all. Without it `selection` is `undefined`, `features={{ selection }}` draws no column, and the
 * table is exactly the table it was before - which is the point: a control the viewer may not use
 * is absent, not disabled and refused (CLAUDE.md Rule 4).
 *
 * It is a second permission **on top of** the screen's own, never a replacement. The reader already
 * had to hold the screen's `READ` to be looking at these rows, and `canDelete` is where the page
 * passes its own `canWrite` - so the Delete over a selection appears only for somebody who could
 * have deleted every one of those rows one at a time. The server asks the same two questions in the
 * same order; hiding the button is not the protection.
 *
 * ── What it does not decide ──
 *
 * Which rows are *deletable* in the sense of the module's own rules - a project only its manager may
 * delete, a request already approved. The server refuses those per id and reports them back, and
 * `onDelete` leaves their ticks in place, so the reader can see exactly which part of the selection
 * would not go. Nothing here tries to predict that: a second copy of twenty modules' rules living
 * in the frontend is a second copy that is wrong.
 *
 * ── Arguments ──
 *
 * `prefix` is the module's API prefix (`/api/assets`), which is all the built-in delete needs -
 * `mountBulkDelete` puts `DELETE <prefix>/bulk` under every one of them. A module whose delete is
 * not that shape passes `onDelete` instead and this calls that.
 *
 * `rows` must be the rows the table is *holding*, so a tick left over from a row deleted in the
 * meantime is dropped rather than sent. `onDeleted` is the page's reload.
 */
export default function useTableSelection({
  prefix,
  onDelete: customDelete,
  rows,
  rowId = (row) => row?.id,
  noun = "record",
  plural,
  canDelete = true,
  /*
   * Which rows may be ticked at all, where a table mixes records it can act on with rows it cannot
   * - the Employee Repository lists onboarding invites beside employees. Rows that fail it get no
   * box, are not counted, and are never sent. Left out on almost every table, which means every row.
   *
   * **Declare it outside the component.** Unlike the callbacks below it this one is read while
   * rendering the tick-box column, so it cannot be held in the ref - which means an inline arrow
   * here is a new function every render, and `DataTable` rebuilds every column when `selection`
   * changes. A module-level `const` costs nothing and is what the pages passing one do.
   */
  canSelectRow,
  requireReason = false,
  reasonLabel = "Reason",
  onDeleted,
  showSuccess,
  showError,
} = {}) {
  const { canWrite: canSelect } = useModuleAccess("ADMIN", "Table Select All");
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [deleting, setDeleting] = useState(false);

  /*
   * Everything the page hands over that is a *function*, kept in a ref and read at the moment it is
   * called rather than depended on.
   *
   * Because pages write these inline - `onDeleted: () => load()` is the honest way to say it - and
   * an inline arrow is a new function on every render. Depended on directly, that would make
   * `runDelete` new every render, and `selection` with it, and `DataTable` rebuilds its entire
   * column list whenever `selection` changes. Every table in the application would rebuild every
   * column on every keystroke in a filter box. The ref costs one assignment and asks nothing of the
   * twenty-odd pages that call this.
   *
   * `rowId` is in here for the same reason and one more: it is read while *rendering* the tick-box
   * column, so it must be the current one, not the one captured when a callback was last rebuilt.
   */
  const handlers = useRef({ rowId, customDelete, onDeleted, showSuccess, showError });
  useEffect(() => {
    handlers.current = { rowId, customDelete, onDeleted, showSuccess, showError };
  });

  const clear = useCallback(() => setSelectedIds(new Set()), []);

  /*
   * The ticked ids that are still rows of this table, in the order the table holds them. A selection
   * survives a re-read - the rows come back with the same ids - but not a row that has since gone,
   * and handing those to the bulk route would count refusals nobody caused.
   */
  /*
   * Computed rather than memoised, because `rowId` is almost always written inline
   * (`rowId: (row) => String(row.id)`) and a memo keyed on a function that is new every render is a
   * memo that never hits - it only looks like one. This is a single pass over the rows the table is
   * already rendering, so it costs the same order as drawing them.
   *
   * It is also not what the Delete button acts on: `DataTable` works that out from its own row
   * model. This is here for a page that wants to say something about the selection itself.
   */
  const selectedRows = canSelect
    ? selectedFrom(selectedIds, rows, rowId).filter((row) => !canSelectRow || canSelectRow(row))
    : EMPTY_ROWS;

  const runDelete = useCallback(async (targets, reason) => {
    const { rowId: idOf, customDelete: custom, onDeleted: reload, showSuccess: success, showError: failed } = handlers.current;
    const ids = (targets || []).map((row) => idOf(row)).filter(Boolean);
    if (!ids.length) return;

    setDeleting(true);
    const deleted = [];
    try {
      // Chunked rather than sent whole, so a selection over the server's cap is two requests instead
      // of one refusal the reader can do nothing about.
      for (let at = 0; at < ids.length; at += CHUNK) {
        const answer = custom
          ? await custom(ids.slice(at, at + CHUNK), reason)
          // The reason, where the module's delete asks for one, is the same for the whole selection
          // and is collected once in the confirmation rather than per row.
          : await deleteTableRows(prefix, ids.slice(at, at + CHUNK), reason ? { reason } : undefined);
        deleted.push(...(answer?.data?.deletedIds || answer?.deletedIds || ids.slice(at, at + CHUNK)));
      }

      /*
       * Only the ids that actually went lose their tick. What is left ticked is precisely what the
       * server would not delete, so the bar still reads a count and a second press retries that part
       * rather than the whole selection - and a reader who ticked forty rows and lost three of them
       * can see which three without reading a sentence.
       */
      const gone = new Set(deleted);
      setSelectedIds((current) => new Set([...current].filter((id) => !gone.has(id))));

      const many = plural || `${noun}s`;
      const left = ids.length - gone.size;
      if (gone.size) {
        success?.(left
          ? `${gone.size} ${gone.size === 1 ? noun : many} deleted. ${left} could not be deleted and ${left === 1 ? "was" : "were"} left alone.`
          : `${gone.size} ${gone.size === 1 ? noun : many} deleted.`);
      } else {
        failed?.(`None of the selected ${many} could be deleted.`);
      }
      if (gone.size) await reload?.([...gone]);
    } catch (error) {
      failed?.(errorMessage(error, `Unable to delete the selected ${plural || `${noun}s`}.`));
    } finally {
      setDeleting(false);
    }
  }, [noun, plural, prefix]);

  /*
   * What `DataTable` is handed. `undefined` without the permission, so a page writes
   * `features={{ selection }}` with no condition of its own and cannot forget one.
   *
   * Memoised because `DataTable` rebuilds its column list whenever this changes; an inline object
   * would rebuild every column of every table on every render.
   */
  const deletable = canDelete && Boolean(prefix || customDelete);
  const selection = useMemo(() => (canSelect ? {
    selectedIds,
    onChange: setSelectedIds,
    onDelete: deletable ? runDelete : undefined,
    deleting,
    noun,
    plural,
    requireReason,
    reasonLabel,
    canSelectRow,
  } : undefined), [canSelect, canSelectRow, deletable, deleting, noun, plural, reasonLabel, requireReason, runDelete, selectedIds]);

  return { canSelect, selectedIds, selectedRows, selectedCount: selectedRows.length, clear, deleting, selection };
}
