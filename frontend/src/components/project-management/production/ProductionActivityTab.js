"use client";

import { useEffect, useState } from "react";
import Loader from "@/components/shared/Loader";
import { activityText, formatWhen } from "@/lib/productionSteps.mjs";
import { getProductionActivity } from "@/services/project-management/production.service";

/** Everything done on the shoot, newest first. Re-read whenever the shoot changes (`refreshKey`). */
export default function ProductionActivityTab({ shootId, refreshKey, onError }) {
  const [entries, setEntries] = useState(null);
  useEffect(() => {
    let live = true;
    getProductionActivity(shootId)
      .then((response) => { if (live) setEntries(Array.isArray(response?.data) ? response.data : []); })
      .catch((error) => { if (live) { setEntries([]); onError(error.message || "Unable to load the activity."); } });
    return () => { live = false; };
  }, [shootId, refreshKey, onError]);

  if (!entries) return <Loader label="Loading activity..." className="p-6" />;
  if (!entries.length) return <p className="p-4 text-sm text-slate-500">Nothing has happened on this shoot yet.</p>;
  return <ol className="flex flex-col gap-2 p-3 sm:p-4">
    {entries.map((entry) => <li key={entry.id} className="rounded-md border border-slate-200 bg-white p-3">
      <p className="break-words text-sm text-slate-800">{activityText(entry)}</p>
      <p className="mt-1 text-xs text-slate-500">{entry.userName} · {formatWhen(entry.createdAt)}</p>
    </li>)}
  </ol>;
}
