"use client";

import { useEffect, useState } from "react";
import { getMasterData } from "@/services/hrm/master-data.service";

/**
 * The studio's reference lists a table's known-value columns filter by - branches, departments and
 * verticals, by name (`KNOWN_LISTS` in `tableCells.js`).
 *
 * Read once per page load and shared by every table: a list is fetched only when a table showing
 * such a column first asks for it, and every later table gets the same answer from memory. They are
 * reference data any signed-in session may read (`/api/hrm/<list>`), so asking never fails for want
 * of a permission; a read that does fail leaves the column offering the values its rows hold.
 */
const cache = new Map();

function load(kind) {
  if (!cache.has(kind)) {
    cache.set(kind, getMasterData(kind, { pageSize: 100 })
      .then((result) => (Array.isArray(result?.data) ? result.data : Array.isArray(result?.data?.rows) ? result.data.rows : [])
        .map((row) => String(row?.name || "").trim())
        .filter(Boolean))
      .catch(() => { cache.delete(kind); return []; }));
  }
  return cache.get(kind);
}

/** `{ branches: [...], departments: [...] }` for the kinds asked, filled in as each arrives. */
export default function useKnownFilterLists(kinds = []) {
  const key = [...new Set(kinds)].sort().join(",");
  const [lists, setLists] = useState({});
  useEffect(() => {
    if (!key) return undefined;
    let current = true;
    for (const kind of key.split(",")) {
      void load(kind).then((names) => { if (current) setLists((previous) => (previous[kind] === names ? previous : { ...previous, [kind]: names })); });
    }
    return () => { current = false; };
  }, [key]);
  return lists;
}
