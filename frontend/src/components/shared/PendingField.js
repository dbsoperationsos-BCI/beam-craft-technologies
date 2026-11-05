import ProgressChip from "@/components/shared/ProgressChip";
import { PROGRESS_COLORS } from "@/lib/progressStatus.mjs";

/**
 * A field still owed for a record to be done: a small **Pending** tag at the end of its label line,
 * over the field rather than inside its control, so every kind of field carries it the same way.
 * `pending` false draws the field alone. Pre Production's shoot form and Production's plan show it on
 * the answers each is counted on for Planned (`SchemaFormField`'s `context.pendingTags`, and each
 * service's person in `ProductionServiceCrew`).
 */
export default function PendingField({ pending, className = "", children }) {
  if (!pending) return children;
  return <div className={`relative min-w-0 ${className}`.trim()}>
    {children}
    <ProgressChip color={PROGRESS_COLORS.notStarted} className="pointer-events-none absolute right-0 top-0 !px-1.5 !py-0 !text-[10px] !leading-4">Pending</ProgressChip>
  </div>;
}
