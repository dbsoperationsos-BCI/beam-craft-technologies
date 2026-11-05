"use client";

import { useEffect, useState } from "react";
import { getAssetCustody } from "@/services/assets/assets.service";

function formatMoment(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

const personLabel = (name, employeeId) => name ? `${name}${employeeId ? ` (${employeeId})` : ""}` : "Nobody";

/**
 * Everyone who has held this asset, oldest first, rendered inside the asset info panel. The asset
 * row itself only ever holds the current person, so without this the previous holders are
 * invisible.
 *
 * Fetched per asset rather than carried on the list, which returns many assets at once. Mount it
 * keyed on the asset, so selecting another one starts from empty state instead of briefly showing
 * the previous asset's history.
 */
export default function AssetCustodyHistory({ assetId }) {
  const [entries, setEntries] = useState([]);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!assetId) return undefined;
    let cancelled = false;
    getAssetCustody(assetId)
      .then((result) => { if (!cancelled) setEntries(result.data || []); })
      .catch((requestError) => { if (!cancelled) setError(requestError.message || "Unable to load the custody history."); });
    return () => { cancelled = true; };
  }, [assetId]);

  if (!assetId) return null;
  return <section className="pt-3">
    <h3 className="font-semibold text-slate-800">Custody History</h3>
    {error && <p role="alert" className="mt-2 text-red-600">{error}</p>}
    {!error && !entries.length && <p className="mt-2 text-slate-500">This asset has not changed hands yet.</p>}
    {entries.length > 0 && <ol className="mt-2 space-y-2">
      {entries.map((entry) => <li key={entry.id} className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-2">
        <p className="font-medium text-slate-800">{personLabel(entry.toName, entry.toEmployeeId)}</p>
        <p className="mt-0.5 text-slate-600">
          {entry.fromName ? `From ${personLabel(entry.fromName, entry.fromEmployeeId)}` : "First assignment"}
          {" · "}{formatMoment(entry.changedAt)}
        </p>
        <p className="mt-0.5 text-slate-500">
          {entry.changedByName ? `By ${entry.changedByName}` : "By an unknown user"}
          {entry.cameFromStatusChange ? " · via status change" : " · via edit"}
        </p>
      </li>)}
    </ol>}
  </section>;
}
