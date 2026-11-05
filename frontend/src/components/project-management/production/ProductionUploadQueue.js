import Button from "@/components/shared/Button";
import { uploadsOf } from "@/lib/productionUploads.mjs";

/** "Uploading… 3 left to upload", and each failed file with its reason, Retry and Discard. Nothing for a clean queue. */
export default function ProductionUploadQueue({ queue, kind, onRetry, onDiscard }) {
  const { items, left, failed } = uploadsOf(queue, kind);
  if (!items.length) return null;
  return <div className="flex flex-col gap-2 rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700" aria-live="polite">
    {left > 0 && <p className="font-medium">Uploading… {left} left to upload</p>}
    {failed > 0 && <>
      <p className="font-medium text-amber-800">{failed} not uploaded. They are still on this phone.</p>
      <ul className="flex flex-col gap-1">
        {items.filter((item) => item.status === "failed").map((item) => <li key={item.id} className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 flex-1 break-words">{item.name}: {item.error}</span>
          <Button type="button" variant="plain" size="lg" className="shrink-0 text-red-600" onClick={() => onDiscard(item.id)}>Discard</Button>
        </li>)}
      </ul>
      <Button type="button" size="lg" className="w-full sm:w-auto sm:self-start" onClick={() => onRetry(kind)}>Retry upload</Button>
    </>}
  </div>;
}
