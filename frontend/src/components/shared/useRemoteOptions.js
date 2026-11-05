"use client";

import { useCallback, useState } from "react";

/**
 * A `Dropdown` whose list is **searched on the server**: what to show, what to show while it waits,
 * and how many matched.
 *
 * ── Why a hook and not a copy per picker ──
 *
 * Handing a picker its whole list and filtering in the browser needs a cap on the payload, and that
 * cap silently becomes the limit of what can be chosen - see `backend/src/services/pickerSearch.js`
 * for what that cost (200 of 986 shoots, 200 of 640 projects). Moving the typing to the server fixes
 * it, but every picker that does so needs the same three things, and one of them is easy to miss:
 *
 *   1. ask the server when the typing changes (`Dropdown` debounces it);
 *   2. show the wait, and the real total, so a page does not read as the whole list;
 *   3. **remember the rows already chosen.** This is the one that bites. A field holds a record's
 *      **id**, and its label comes from the list the next search replaces - so picking a shoot and
 *      then searching for something else leaves the field blank while still saving correctly, which
 *      is worse than an error because nobody doubts it.
 *
 * ── Using it ──
 *
 *     const shoots = useRemoteOptions(searchPaymentRequestShoots, { read: (data) => data.shoots });
 *     ...
 *     <Dropdown searchable options={shoots.optionsFor(opened, chosenIds, labelOf)} {...shoots.props} />
 *
 * `search` is the service function; `read` pulls the rows out of its answer. `opened` is the page the
 * screen already had (from its `/options` call) and is what the menu shows before anybody types.
 */
export default function useRemoteOptions(search, { read = (data) => data?.rows || [], args = {} } = {}) {
  // What the last search came back with - null until anybody types, so the menu opens on `opened`.
  const [found, setFound] = useState(null);
  const [searching, setSearching] = useState(false);
  // Every row a search has offered, by id, so a chosen one keeps its label. State, not a ref: it is
  // read while the options are built, and React forbids that of a ref.
  const [seen, setSeen] = useState({});

  /*
   * `args` is a plain object the caller rebuilds every render - the project a shoot search is
   * narrowed to, say - so it is held as its **contents**. Keyed on identity, every render would make
   * a new `ask` and `Dropdown` would re-arm its debounce; read back from the key rather than closed
   * over, so there is no stale copy of it either.
   */
  const argsKey = JSON.stringify(args || {});

  const ask = useCallback(async (text) => {
    setSearching(true);
    try {
      const response = await search(text, JSON.parse(argsKey));
      const data = response?.data || {};
      const rows = read(data) || [];
      setFound({ rows, total: Number(data.total) || rows.length });
      setSeen((held) => Object.fromEntries([...Object.entries(held), ...rows.map((row) => [row.id, row])]));
    } catch {
      // Nothing is set: the menu keeps what it had, which is honest, and the next keystroke asks
      // again. A picker that empties itself on a dropped request looks like a list with no rows.
    } finally {
      setSearching(false);
    }
  }, [search, read, argsKey]);

  /**
   * The options to give `Dropdown`: what the last search offered (or `opened` before any), plus any
   * `chosen` id the current answer no longer contains, labelled from what has been seen.
   *
   * `lead` rows go first - "General", a clear option - and are never filtered.
   */
  const optionsFor = useCallback((opened = [], chosen = [], labelOf = (row) => row.id, lead = []) => {
    const offered = found ? found.rows : opened;
    const labels = { ...seen, ...Object.fromEntries(opened.map((row) => [row.id, row])) };
    const missing = [...new Set(chosen.filter(Boolean))]
      .filter((id) => !offered.some((row) => row.id === id) && labels[id])
      .map((id) => ({ value: id, label: labelOf(labels[id]) }));
    return [...lead, ...offered.map((row) => ({ value: row.id, label: labelOf(row) })), ...missing];
  }, [found, seen]);

  /**
   * One chosen row, whole - not just its label.
   *
   * A caller that fills another field in from the choice needs the record behind it: the expense
   * line takes the shoot's own day for its date. Looked up where the labels are, so a row the
   * current search no longer offers is still found.
   */
  const rowFor = useCallback((id, opened = []) => {
    if (!id) return null;
    const offered = found ? found.rows : opened;
    return offered.find((row) => row.id === id) || opened.find((row) => row.id === id) || seen[id] || null;
  }, [found, seen]);

  /** Spread onto `Dropdown`: the three props that make its search remote. */
  const props = { onSearch: ask, searchLoading: searching, searchTotal: found?.total || 0 };

  return { optionsFor, rowFor, props, found, searching, ask };
}
