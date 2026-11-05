"use client";

import AutoAwesome from "@mui/icons-material/AutoAwesome";
import CloudUpload from "@mui/icons-material/CloudUpload";
import HourglassTop from "@mui/icons-material/HourglassTop";
import ErrorOutline from "@mui/icons-material/ErrorOutlined";
import PhotoLibrary from "@mui/icons-material/PhotoLibrary";
import DesktopWindows from "@mui/icons-material/DesktopWindows";
import Button from "@/components/shared/Button";

const COPY = {
  empty: { Icon: PhotoLibrary, eyebrow: "AI Culling", title: "No photos have been imported yet" },
  uploading: { Icon: CloudUpload, eyebrow: "Photos arriving", title: "Photos are still arriving from the desktop app" },
  processing: { Icon: HourglassTop, eyebrow: "Photos processing", title: "Previews are being made" },
  unprocessable: { Icon: ErrorOutline, eyebrow: "AI Culling", title: "None of these photos could be processed" },
  ready: { Icon: AutoAwesome, eyebrow: "AI culling ready", title: "" },
};

/**
 * The tab before any run: what the scope's photos are doing right now, from the overview's
 * `photoCounts` (never a guess), and the one useful next step. Photos are imported by the desktop
 * app, never uploaded from here: the empty state says so and tells the photographer how, with no
 * upload control of any kind. `onOpenPhotos` goes to Photo Selection on this same folder, for
 * photos that need its attention; it is absent when that tab is not available. The ready
 * state's mode picker and Start arrive as `children`.
 */
export default function CullingStateCard({ state, counts, folderLabel, canWrite = true, onOpenPhotos = null, children }) {
  const copy = COPY[state] || COPY.empty;
  const { Icon } = copy;
  const total = counts?.total || 0;
  const ready = counts?.ready || 0;
  const inFlight = (counts?.processing || 0) + (counts?.uploading || 0);
  const figures = [["Photos", total], ["Ready", ready], ["Processing", inFlight], ...(counts?.failed ? [["Could not be processed", counts.failed]] : [])];
  const plural = (value, word) => `${value} ${word}${value === 1 ? "" : "s"}`;
  const line = {
    empty: `No photos have been imported into ${folderLabel} yet. Import them with the DBS Desktop application.`,
    uploading: `${plural(counts?.uploading || 0, "photo")} still arriving from the desktop app. Culling can start once they are processed.`,
    processing: `${plural(total, "photo")} imported · ${ready} processed · ${inFlight} still processing.`,
    unprocessable: `${plural(counts?.failed || 0, "photo")} failed processing. Retry them in Photo Selection, or import others from the desktop app.`,
    ready: `${inFlight ? `${plural(inFlight, "more photo")} ${inFlight === 1 ? "is" : "are"} still arriving or processing; wait for ${inFlight === 1 ? "it" : "them"}, or cull them in a later run. ` : ""}Each photo is sorted into Keep, Maybe and Reject for you to review. Nothing is ever deleted.`,
  }[state];
  // Photos are imported by the desktop app; Photo Selection is for photos that need its attention.
  const action = state === "ready" || state === "empty" ? null : "Open Photo Selection";

  return (
    <section className="rounded-xl border border-slate-200 bg-white px-5 py-8 text-center" aria-labelledby="culling-state-title">
      <Icon aria-hidden="true" className="text-blue-500" style={{ fontSize: 30 }} />
      <p className="mt-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{copy.eyebrow}</p>
      <h3 id="culling-state-title" className="mt-1 text-base font-semibold text-slate-800">
        {state === "ready" ? `${plural(ready, "photo")} ready for analysis` : copy.title}
      </h3>
      <p className="mx-auto mt-1 max-w-110 text-xs leading-5 text-slate-500">{line}</p>
      <dl className={`mx-auto mt-4 grid max-w-130 gap-2 ${figures.length > 3 ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-3"}`}>
        {figures.map(([label, value]) => (
          <div key={label} className="rounded-lg bg-slate-50 px-2 py-2">
            <dt className="text-[10px] font-medium uppercase tracking-wide text-slate-500">{label}</dt>
            <dd className="text-sm font-semibold tabular-nums text-slate-700">{value}</dd>
          </div>
        ))}
      </dl>
      {counts?.failed > 0 && state !== "unprocessable" && <p className="mt-2 text-[11px] text-amber-700">{plural(counts.failed, "photo")} could not be processed and will not be culled.</p>}
      {action && onOpenPhotos && <div className="mt-5"><Button variant="secondary" onClick={onOpenPhotos}>{action}</Button></div>}
      {state === "empty" && (
        // The non-upload way in: what to do in the desktop app, which keeps the originals where they are.
        <div className="mx-auto mt-5 max-w-110 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-left text-xs leading-5 text-slate-600" role="note" aria-label="How to import photos">
          <p className="flex items-center gap-1.5 font-semibold text-slate-700"><DesktopWindows aria-hidden="true" style={{ fontSize: 16 }} />Import photos with the DBS Desktop app</p>
          <ol className="mt-1 list-decimal space-y-0.5 pl-5">
            <li>Open this project in the desktop app and go to AI Culling.</li>
            <li>Choose the photos or the folder, or drop them in - RAW files included.</li>
            <li>The originals stay on that computer; only compressed previews reach the server, and the cull shows here as it runs.</li>
          </ol>
        </div>
      )}
      {children && <div className="mx-auto mt-5 max-w-130 text-left">{children}</div>}
    </section>
  );
}
