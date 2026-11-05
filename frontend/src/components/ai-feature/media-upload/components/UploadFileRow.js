import Loader from "@/components/shared/Loader";
import { UPLOAD_STATUS, UPLOAD_STATUS_LABELS, UPLOAD_STATUS_TONES } from "@/lib/aiMediaUpload/config.mjs";
import { formatBytes } from "@/lib/aiFeature.mjs";

const BUSY = new Set([UPLOAD_STATUS.COMPRESSING, UPLOAD_STATUS.UPLOADING, UPLOAD_STATUS.UPLOADED, UPLOAD_STATUS.FACE_PROCESSING_QUEUED]);

/** One photo's line: name, what it weighed before and after, and where it is. */
export default function UploadFileRow({ item, style }) {
  const sizes = item.outputBytes && item.outputBytes !== item.size
    ? `${formatBytes(item.size)} → ${formatBytes(item.outputBytes)}`
    : formatBytes(item.size);
  const detail = item.error || item.note || "";
  const busy = BUSY.has(item.status);
  return <div style={style} className="flex items-center gap-3 border-b border-slate-100 px-3 text-xs">
    <div className="min-w-0 flex-1">
      <p className="truncate font-medium text-slate-800" title={item.relativePath || item.name}>{item.name}</p>
      <p className="truncate text-[11px] text-slate-500">{sizes}{detail ? ` · ${detail}` : ""}</p>
    </div>
    <span className={`flex shrink-0 items-center gap-1.5 font-medium ${UPLOAD_STATUS_TONES[item.status] || "text-slate-500"}`}>
      {busy && <Loader size="sm" inline label="" />}
      {item.status === UPLOAD_STATUS.COMPLETE && <span aria-hidden="true">✓</span>}
      {UPLOAD_STATUS_LABELS[item.status] || item.status}
    </span>
  </div>;
}
