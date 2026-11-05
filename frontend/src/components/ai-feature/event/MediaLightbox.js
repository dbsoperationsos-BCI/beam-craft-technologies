"use client";

import DeleteOutline from "@mui/icons-material/DeleteOutlined";
import Button from "@/components/shared/Button";
import Lightbox, { GLASS } from "@/components/shared/Lightbox";
import { formatBytes, formatCount } from "@/lib/aiFeature.mjs";

/**
 * The full-screen view of one media row: its file name on the first line, what is known of it -
 * how many faces were found (or that they are still being looked for), what it weighs - on the
 * second, and under the picture only what the viewer may do to it. No processing pill: whether
 * the engine has been over a photo is the pipeline's business, not the person looking at the
 * picture's; the one state worth a line is a photo the engine could not process, said in words
 * with where to retry it. `onDelete(media)` draws the Delete - a quiet glass pill in the shell's
 * own language with the destructive colour on the icon and the word, that asks first (the Media
 * tab's confirmation), also reachable with the Delete key; a person's grid and the review queue
 * pass nothing and show none. `paused` (a confirmation open, a delete in flight) makes every
 * control and key inert.
 */
export default function MediaLightbox({ items, index, onIndexChange, onClose, onDelete, paused = false, actions }) {
  const media = items[index];
  if (!media) return null;
  const isVideo = media.kind === "VIDEO";
  const scanning = media.kind === "PHOTO" && (media.aiStatus === "QUEUED" || media.aiStatus === "PROCESSING");
  const faces = scanning ? "Finding faces…" : media.faceCount != null && `${formatCount(media.faceCount)} ${media.faceCount === 1 ? "face" : "faces"}`;
  const subtitle = [faces, media.sizeBytes && formatBytes(media.sizeBytes)].filter(Boolean).join(" · ");
  const askDelete = onDelete ? () => onDelete(media) : undefined;
  return <Lightbox
    src={isVideo ? media.thumbnailUrl : media.previewUrl || media.thumbnailUrl}
    alt={media.fileName}
    title={media.fileName}
    subtitle={subtitle}
    onClose={onClose}
    hasPrev={index > 0}
    hasNext={index < items.length - 1}
    onPrev={() => onIndexChange(index - 1)}
    onNext={() => onIndexChange(index + 1)}
    onDeleteKey={askDelete}
    paused={paused}
  >
    {media.aiStatus === "FAILED" && <span className={`max-w-full truncate rounded-full px-3 py-1.5 text-xs text-red-200 ${GLASS}`} title={media.aiError || undefined}>Face processing failed. Retry from the processing card above the gallery.</span>}
    {isVideo && media.previewUrl && <Button type="button" size="md" variant="plain" className={`rounded-full px-4 ${GLASS}`} disabled={paused} onClick={() => window.open(media.previewUrl, "_blank", "noopener")}>Open video</Button>}
    {askDelete && <Button type="button" size="md" variant="plain" className={`gap-1.5 rounded-full px-4 text-red-200 hover:text-red-100 ${GLASS}`} disabled={paused} onClick={askDelete}><DeleteOutline fontSize="small" aria-hidden="true" />Delete</Button>}
    {actions?.(media)}
  </Lightbox>;
}
