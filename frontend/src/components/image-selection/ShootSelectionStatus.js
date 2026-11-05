"use client";

import ExpandMore from "@mui/icons-material/ExpandMore";
import { PROGRESS_CHIP_CLASS, PROGRESS_COLORS, progressChipStyle } from "@/lib/progressStatus.mjs";
import { unmatchedFolderShoots } from "@/lib/shootGroups.mjs";

/**
 * The project's shoots with the selection items allocated under each, read-only: a collapsed row
 * per shoot ("Pre Wedding", "Wedding", ...) that opens to its items ("Retouches", ...), each with
 * where the client's selection stands. Drawn under the Access PIN in the settings rail, and the
 * desktop app draws the identical section. Colors come from the product-wide progress palette.
 *
 * `<details>/<summary>` rather than stateful buttons on purpose: the rail sits inside a
 * ReadOnlyFieldset for read-only roles, which makes every button inert — but reading which shoots
 * and items a project carries is exactly what read-only access is for, and a disclosure element
 * is not a form control, so it keeps working.
 */
function groupByShoot(deliverables, folderShoots) {
  const groups = new Map();
  deliverables.forEach((item) => {
    const key = item.shootId || "unassigned";
    if (!groups.has(key)) groups.set(key, { id: key, name: item.shoot?.shoot || "Other deliverables", shoot: item.shoot || null, items: [] });
    groups.get(key).items.push(item);
  });
  const saved = [...groups.values()];
  // A manual project's root folders are its shoots even before any item is saved under them,
  // matched to the saved groups by folder id - the same shared rule the Selection Settings table uses.
  const folders = unmatchedFolderShoots(saved.map((group) => group.shoot), folderShoots)
    .map((folder) => ({ id: `folder:${folder.id}`, name: folder.name, items: [] }));
  return [...saved, ...folders];
}

const isDisabled = (item) => Boolean(item.inactiveAt) || !item.enabled;

// Where the client's selection on one item stands. An item that reached its limit reads
// "Completed" — the picking is done — while "Submitted" stays the stronger word for a selection
// the client has actually sent. A disabled item is not offered to the client at all, so calling
// it "Yet to Start" would be a lie.
export function itemStatus(item, count) {
  if (isDisabled(item)) return { label: "Disabled", style: { color: "#64748B", backgroundColor: "#F1F5F9" } };
  if (item.selectionSubmittedAt) return { label: "Submitted", style: progressChipStyle(PROGRESS_COLORS.completed) };
  if (item.selectionLimit > 0 && count >= item.selectionLimit) return { label: "Completed", style: progressChipStyle(PROGRESS_COLORS.completed) };
  if (count > 0) return { label: "In Progress", style: progressChipStyle(PROGRESS_COLORS.inProgress) };
  return { label: "Yet to Start", style: progressChipStyle(PROGRESS_COLORS.notStarted) };
}

// The shoot row's own word for its items taken together. Only submission counts here: an item
// at its limit but unsent keeps the shoot In Progress — the client can still swap photos — so
// the shoot reads Completed only once everything is actually submitted, and "Partially
// Completed" marks some-but-not-all submitted.
export function shootStatus(items, selectionCounts) {
  const active = items.filter((item) => !isDisabled(item));
  if (!active.length) return null;
  const submitted = active.filter((item) => item.selectionSubmittedAt).length;
  if (submitted === active.length) return { label: "Completed", style: progressChipStyle(PROGRESS_COLORS.completed) };
  if (submitted > 0) return { label: "Partially Completed", style: progressChipStyle(PROGRESS_COLORS.partiallyCompleted) };
  if (active.some((item) => (selectionCounts[item.id] || 0) > 0)) return { label: "In Progress", style: progressChipStyle(PROGRESS_COLORS.inProgress) };
  return { label: "Yet to Start", style: progressChipStyle(PROGRESS_COLORS.notStarted) };
}

export default function ShootSelectionStatus({ deliverables = [], selectionCounts = {}, folderShoots = [] }) {
  const groups = groupByShoot(deliverables, folderShoots);
  if (!groups.length) return <p className="py-2 text-[10px] text-slate-500">No shoots or selection items yet.</p>;
  return (
    <ul className="space-y-1">
      {groups.map((group) => {
        const aggregate = shootStatus(group.items, selectionCounts);
        return (
          <li key={group.id}>
            <details className="group rounded-md border border-slate-200">
              <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-md px-2 py-1.5 hover:bg-slate-50 [&::-webkit-details-marker]:hidden">
                <ExpandMore style={{ fontSize: 14 }} aria-hidden="true" className="shrink-0 text-slate-400 transition-transform group-open:rotate-180" />
                <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-slate-700">{group.name}</span>
                {aggregate
                  ? <span className={`${PROGRESS_CHIP_CLASS} shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold`} style={aggregate.style}>{aggregate.label}</span>
                  : <span className="shrink-0 text-[10px] text-slate-400">{group.items.length} item{group.items.length === 1 ? "" : "s"}</span>}
              </summary>
              {group.items.length ? (
                <ul className="border-t border-slate-100 px-2 py-1">
                  {group.items.map((item) => {
                    const count = selectionCounts[item.id] || 0;
                    const status = itemStatus(item, count);
                    return (
                      <li key={item.id || item.name} className="flex items-center justify-between gap-2 py-1">
                        <span className="min-w-0 flex-1 truncate text-[10px] text-slate-600">{item.name}</span>
                        {count > 0 && <span className="shrink-0 text-[9px] text-slate-400">{count} selected</span>}
                        <span className={`${PROGRESS_CHIP_CLASS} shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold`} style={status.style}>{status.label}</span>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="border-t border-slate-100 px-2 py-1.5 text-[10px] text-slate-400">No selection items in this shoot yet.</p>
              )}
            </details>
          </li>
        );
      })}
    </ul>
  );
}
