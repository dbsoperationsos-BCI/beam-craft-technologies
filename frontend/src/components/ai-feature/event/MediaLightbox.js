"use client";

import Button from "@/components/shared/Button";
import Lightbox from "@/components/ai-feature/shared/Lightbox";
import StatusChip from "@/components/ai-feature/shared/StatusChip";
import { formatBytes, formatCount } from "@/lib/aiFeature.mjs";

/**
 * The full-screen view of one media row, with the caption every grid here shares: its file name,
 * how many faces were found in it, and its processing status. `actions` sits under the picture -
 * the Media tab puts Delete there, a person's grid puts nothing.
 */
export default function MediaLightbox({ items, index, onIndexChange, onClose, actions }) {
  const media = items[index];
  if (!media) return null;
  const isVideo = media.kind === "VIDEO";
  const caption = [media.fileName, media.faceCount != null && `${formatCount(media.faceCount)} ${media.faceCount === 1 ? "face" : "faces"}`, media.sizeBytes && formatBytes(media.sizeBytes)].filter(Boolean).join(" • ");
  return <Lightbox
    src={isVideo ? media.thumbnailUrl : media.previewUrl || media.thumbnailUrl}
    alt={media.fileName}
    caption={caption}
    onClose={onClose}
    hasPrev={index > 0}
    hasNext={index < items.length - 1}
    onPrev={() => onIndexChange(index - 1)}
    onNext={() => onIndexChange(index + 1)}
  >
    <StatusChip status={media.aiStatus} kind="ai" />
    {media.aiError && <span className="max-w-full truncate text-xs text-red-300">{media.aiError}</span>}
    {isVideo && media.previewUrl && <Button type="button" size="sm" onClick={() => window.open(media.previewUrl, "_blank", "noopener")}>Open video</Button>}
    {actions?.(media)}
  </Lightbox>;
}
