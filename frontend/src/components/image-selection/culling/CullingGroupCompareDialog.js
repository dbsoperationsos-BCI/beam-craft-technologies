"use client";

import { useCallback, useEffect, useState } from "react";
import Star from "@mui/icons-material/Star";
import StarBorder from "@mui/icons-material/StarBorder";
import Dialog from "@/components/ui/Dialog";
import GalleryLazyImage from "../GalleryLazyImage";
import ImagePreviewDialog from "../ImagePreviewDialog";
import Loader from "@/components/shared/Loader";
import { getCullingGroup, setCullingDecision, setCullingGroupBest } from "@/services/image-selection/image-selection.service";
import { cullingGroupTitle, cullingRankLabel, CULLING_DECISION_STYLES, CULLING_GROUP_RANKING, CULLING_RANKED_ON } from "@/lib/imageSelectionCulling.mjs";

/**
 * The compare view — the culling UX that matters most: one duplicate, burst or similar-frames
 * group side by side, the best starred, and per frame the three decisions plus "this one is the
 * best". Marking a new best swaps the star, the ranks and the group badges; in Balanced and Strict
 * the server re-derives the two frames' AI calls to follow it, and never touches a decision the
 * photographer made. A similar-frames group moves only ranks and the alternate badge.
 */
export default function CullingGroupCompareDialog({ projectId, sessionId, groupId, canWrite = true, onClose, onCountsChange, onChanged, onNotice }) {
  const [group, setGroup] = useState(null);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await getCullingGroup(projectId, sessionId, groupId);
      setGroup(response.data);
    } catch (error) {
      onNotice?.(error.message || "Unable to load the group.", "error");
      onClose();
    }
  }, [projectId, sessionId, groupId, onNotice, onClose]);
  useEffect(() => { const timer = window.setTimeout(load, 0); return () => window.clearTimeout(timer); }, [load]);

  async function decide(member, decision) {
    setBusy(true);
    try {
      const response = await setCullingDecision(projectId, sessionId, member.id, decision, "COMPARE_DIALOG");
      setGroup((current) => current ? { ...current, members: current.members.map((entry) => (entry.id === member.id ? { ...entry, ...response.data.result } : entry)) } : current);
      onCountsChange?.(response.data.counts);
      onChanged?.();
    } catch (error) {
      onNotice?.(error.message || "Unable to save the decision.", "error");
    } finally { setBusy(false); }
  }

  async function markBest(member) {
    setBusy(true);
    try {
      const response = await setCullingGroupBest(projectId, sessionId, groupId, member.id);
      setGroup(response.data);
      onChanged?.();
    } catch (error) {
      onNotice?.(error.message || "Unable to mark the best frame.", "error");
    } finally { setBusy(false); }
  }

  return (
    <Dialog title={group ? cullingGroupTitle(group) : "Loading group…"} description={CULLING_GROUP_RANKING[group?.type] || CULLING_GROUP_RANKING.BURST} onClose={onClose} size="wide" height="tall" busy={busy} bodyClassName="overflow-y-auto">
      {!group ? (
        <div className="grid min-h-40 place-items-center"><Loader label="Loading group..." size="sm" inline /></div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {group.members.map((member) => {
            const decision = CULLING_DECISION_STYLES[member.effectiveDecision] || CULLING_DECISION_STYLES.PENDING;
            const isBest = group.representativeUploadId === member.upload.id;
            const rankLabel = cullingRankLabel(member.rank, group.memberCount);
            return (
              <div key={member.id} className={`overflow-hidden rounded-lg border ${isBest ? "border-amber-400 ring-2 ring-amber-100" : "border-slate-200"}`}>
                <button type="button" onClick={() => setPreview(member.upload)} className="block w-full" aria-label={`Preview ${member.upload.fileName}`}>
                  <GalleryLazyImage src={member.upload.previewUrl} alt={member.upload.fileName} className="aspect-4/3" />
                </button>
                <div className="p-2">
                  <div className="flex items-center justify-between gap-1">
                    <span className="flex min-w-0 items-center gap-1 text-[11px] text-slate-600">
                      {isBest && <Star className="shrink-0 text-amber-400" style={{ fontSize: 14 }} titleAccess="Best frame" />}
                      <span className="truncate" title={member.upload.fileName}>{member.upload.fileName}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1.5 text-[11px] font-semibold text-slate-500">
                      {rankLabel && <span className="rounded bg-slate-100 px-1 py-px text-slate-600" title={`Rank in this group, judged on ${CULLING_RANKED_ON}`}>{rankLabel}</span>}
                      <span title="Score">{member.finalScore ?? "—"}</span>
                    </span>
                  </div>
                  <div className="mt-1.5 flex items-center gap-1">
                    <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${decision.className}`}>{decision.label}{member.userDecision ? " ✎" : ""}</span>
                    {canWrite && (
                      <>
                        {["KEEP", "MAYBE", "REJECT"].map((value) => (
                          <button key={value} type="button" disabled={busy} onClick={() => decide(member, value)} className={`rounded px-1.5 py-0.5 text-[9px] font-semibold ${member.userDecision === value ? CULLING_DECISION_STYLES[value].className : "bg-slate-100 text-slate-500 hover:bg-slate-200"}`}>
                            {CULLING_DECISION_STYLES[value].label}
                          </button>
                        ))}
                        {!isBest && (
                          <button type="button" disabled={busy} onClick={() => markBest(member)} title="Mark as the group's best frame" className="ml-auto inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[9px] font-medium text-amber-600 hover:bg-amber-50">
                            <StarBorder style={{ fontSize: 12 }} /> Best
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {preview && <ImagePreviewDialog image={preview} onClose={() => setPreview(null)} />}
    </Dialog>
  );
}
