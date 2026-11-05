import { PROGRESS_COLORS } from "./progressStatus.mjs";

export function selectionProgressStatus(selected, limit) {
  if (selected <= 0) return { label: "Yet to start", color: PROGRESS_COLORS.notStarted };
  if (limit > 0 && selected >= limit) return { label: "Completed", color: PROGRESS_COLORS.completed };
  return { label: "In progress", color: PROGRESS_COLORS.inProgress };
}
