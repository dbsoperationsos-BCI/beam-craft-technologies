"use client";

import { useCallback, useEffect, useState } from "react";
import Button from "@/components/shared/Button";
import {
  PROJECT_FOLDER_NAMES,
  displaySeparator,
  downloadFolderDisplayName,
  forgetDownloadFolder,
  labelDownloadFolder,
  pickDownloadFolder,
  readDownloadFolder,
  safePathSegment,
  supportsFolderSelection,
} from "@/lib/projectStorage.mjs";

const EXAMPLE_PROJECT = "John & Priya Wedding";

/**
 * The Target Download Path control in ⋮ → Settings: where every file the app saves is filed.
 *
 * A browser will not write to a path just because it was named one — it writes into a folder the
 * person at the keyboard picked — so the folder *is* the setting, and it belongs to this browser
 * alone rather than to the studio-wide settings record. Pick nothing and downloads go to the
 * browser's own Downloads folder, which is where they went before this existed.
 *
 * The picker also refuses to say where the picked folder lives: the handle carries only its own
 * name. So the field is typable — the studio can spell out the complete path for its own reference,
 * and that label is remembered with the grant. It changes what is *shown*, never where files go.
 */
export default function TargetDownloadPathField() {
  const [stored, setStored] = useState(null);
  const [label, setLabel] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const supported = supportsFolderSelection();

  const refresh = useCallback(async () => {
    const record = await readDownloadFolder();
    setStored(record);
    setLabel(downloadFolderDisplayName(record));
  }, []);
  useEffect(() => { const timer = window.setTimeout(refresh, 0); return () => window.clearTimeout(timer); }, [refresh]);

  async function choose() {
    setNotice(""); setBusy(true);
    try {
      const picked = await pickDownloadFolder();
      setStored(picked);
      // A path typed for the previous folder says nothing about this one, so the field starts over
      // from the only thing the browser will say about it.
      setLabel(picked.name);
      setNotice("");
    } catch (failure) {
      // AbortError is the picker being closed, which is not a failure worth reporting.
      if (failure?.name !== "AbortError") setNotice(failure?.message || "Unable to open the folder picker.");
    } finally { setBusy(false); }
  }

  async function clear() {
    setBusy(true);
    await forgetDownloadFolder();
    setStored(null);
    setLabel("");
    setNotice("Downloads will go to your Downloads folder.");
    setBusy(false);
  }

  // Saved when the studio leaves the field rather than on every keystroke; an emptied field falls
  // back to the folder's own name rather than remembering nothing.
  async function saveLabel() {
    if (!stored) return;
    const trimmed = label.trim();
    const next = await labelDownloadFolder(trimmed === stored.name ? "" : trimmed);
    if (next) { setStored(next); setLabel(downloadFolderDisplayName(next)); }
  }

  const chosen = Boolean(stored?.name);
  const shown = label.trim() || stored?.name || "";
  const separator = displaySeparator();
  const example = [shown || "Downloads", safePathSegment(EXAMPLE_PROJECT), PROJECT_FOLDER_NAMES[0]].join(separator);

  return <div className="space-y-2">
    <p className="text-xs font-medium text-slate-700">Target Download Path</p>

    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      {chosen
        ? <input
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            onBlur={saveLabel}
            aria-label="Target Download Path"
            placeholder={stored.name}
            className="min-w-0 flex-1 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs text-slate-600 outline-none focus:border-blue-400 focus:bg-white"
          />
        : <p className="min-w-0 flex-1 truncate rounded-md border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs text-slate-600">
            No folder chosen — files go to your Downloads folder.
          </p>}
      {supported && <div className="flex shrink-0 gap-2">
        <Button type="button" onClick={choose} disabled={busy}>{chosen ? "Change Folder" : "Choose Folder…"}</Button>
        {chosen && <Button type="button" onClick={clear} disabled={busy}>Clear</Button>}
      </div>}
    </div>

    <p className="text-[11px] text-slate-500">
      Every file the app saves is filed under this folder, by project and then by module — for example{" "}
      <span className="font-mono text-slate-600">{example}{separator}</span>
      {" "}with {PROJECT_FOLDER_NAMES.join(", ")} beside it. Existing files are never moved when the folder changes.
    </p>

    {chosen && <p className="text-[11px] text-slate-500">
      The browser only reveals the folder&apos;s name, so type its complete path here — for example{" "}
      <span className="font-mono text-slate-600">D:{separator}Studio{separator}{stored.name}</span> — if you want it
      shown in full. This changes only what is displayed; files always go to the folder you picked.
    </p>}

    {/* The folder is granted to this browser, not saved with the settings, so this says what will
        happen on this computer rather than what the studio has agreed. */}
    <p className={`text-[11px] ${chosen ? "text-emerald-700" : "text-amber-700"}`}>
      {!supported
        ? "This browser cannot save into a chosen folder, so downloads will go to your Downloads folder. Chrome or Edge can."
        : chosen
          ? `Downloads on this computer are saved into "${shown}".`
          : "No folder chosen on this computer — downloads go to your Downloads folder. Choose one to file them by project."}
    </p>

    {notice && <p className="text-[11px] text-slate-500">{notice}</p>}
  </div>;
}
