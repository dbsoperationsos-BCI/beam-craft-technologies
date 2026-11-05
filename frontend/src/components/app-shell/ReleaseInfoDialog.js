"use client";

import { useEffect, useState } from "react";
import Dialog from "@/components/ui/Dialog";
import { APP_VERSION } from "@/lib/appVersion";
import { getReleaseInfo } from "@/services/system/release.service";

/** How many of the release's changes the small card lists before summing up the rest. */
const NOTES_SHOWN = 3;

function formatDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(date);
}

/**
 * The release, opened from the user menu: the version as a headline, when it was released, and
 * what it brought - the first few entries of the changelog's current section, as the server reads
 * them, with a count of the rest.
 *
 * The server's version is the one shown, since it is the release actually running; the version
 * stamped into this bundle stands in only while the server has not answered, and a line says so
 * when the two differ, because a reload is what brings the tab up to date.
 *
 * The card is mounted only while open, so each opening asks afresh with nothing to reset.
 */
export default function ReleaseInfoDialog({ open, onClose }) {
  return open ? <ReleaseInfoCard onClose={onClose} /> : null;
}

function ReleaseInfoCard({ onClose }) {
  const [release, setRelease] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    getReleaseInfo()
      .then((info) => { if (!cancelled) setRelease(info); })
      .catch((requestError) => { if (!cancelled) setError(requestError.message || "Unable to load the release details."); });
    return () => { cancelled = true; };
  }, []);

  const version = release?.version || APP_VERSION;
  const releasedOn = formatDate(release?.deployedAt);
  const notes = release?.notes || [];
  const shown = notes.slice(0, NOTES_SHOWN);
  const remaining = notes.length - shown.length;
  const outOfDate = Boolean(release?.version && APP_VERSION !== "dev" && release.version !== APP_VERSION);

  let subtitle = "DBS Operations OS";
  if (releasedOn) subtitle = `Released ${releasedOn}`;
  else if (release?.section === "Unreleased") subtitle = "Changes not yet promoted to a numbered release.";
  else if (release?.section) subtitle = release.section;

  return (
    <Dialog title="Release Information" onClose={onClose} size="sm">
      <p className="text-2xl font-semibold tabular-nums text-slate-900">v{version}</p>
      <p className="mt-1 text-xs text-slate-500 sm:text-sm">{subtitle}</p>
      {!release && !error && <p className="mt-4 text-xs text-slate-500 sm:text-sm">Loading release details...</p>}
      {error && <p role="alert" className="mt-4 text-xs text-red-600 sm:text-sm">{error}</p>}
      {shown.length > 0 && (
        <ul className="mt-4 space-y-2 border-t border-slate-100 pt-4">
          {shown.map((line) => (
            <li key={line} className="flex gap-2 text-xs leading-5 text-slate-700 sm:text-sm sm:leading-6">
              <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-blue-500" />
              <span>{line}</span>
            </li>
          ))}
        </ul>
      )}
      {release && shown.length === 0 && !error && <p className="mt-4 text-xs text-slate-500 sm:text-sm">No changes are recorded for this release.</p>}
      {remaining > 0 && <p className="mt-3 text-xs text-slate-500">and {remaining} more {remaining === 1 ? "change" : "changes"} in this release.</p>}
      {outOfDate && <p className="mt-4 text-xs text-amber-700">This tab loaded an older build (v{APP_VERSION}). Reload the page to pick up the current release.</p>}
    </Dialog>
  );
}
