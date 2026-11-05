"use client";

import Add from "@mui/icons-material/Add";
import Check from "@mui/icons-material/Check";
import Close from "@mui/icons-material/Close";
import InfoOutlined from "@mui/icons-material/InfoOutlined";
import OpenInFull from "@mui/icons-material/OpenInFull";
import { useState } from "react";
import IconButton from "@/components/shared/IconButton";
import { PROGRESS_COLORS } from "@/lib/progressStatus.mjs";
import { folderShootGroup, unmatchedFolderShoots } from "@/lib/shootGroups.mjs";
import { newSelectionItemLimit, validateSelectionLimit } from "@/lib/imageSelectionSettings.mjs";

/**
 * The per-deliverable "which items can the client choose, and how many" table, grouped by the shoot
 * each deliverable belongs to.
 *
 * It is drawn at two sizes because it has two homes: `dense` is the 300px workspace rail, whose
 * compact idiom (10px labels, h-6 controls) the shared inputs would break, and the roomy size is the
 * ⋮ → Settings form, which has the whole width of the page to spend.
 *
 * `onAdd` and `onRemove` are passed only for a manually named project, which has no Post
 * Production Allocation to derive its items from. There the shoot groups are the project's root
 * folders, handed in as `folderShoots` (`{ id, name }`): each root folder already is a shoot in the
 * client gallery - an item points at its folder by id, so renaming the folder keeps the group - so
 * the folders the studio made in the tree stand as groups here, each carrying its own add row, and a
 * new shoot is made by making its folder rather than by typing its name a second time.
 */
function groupByShoot(deliverables) {
  const groups = new Map();
  deliverables.forEach((item) => {
    const key = item.shootId || "unassigned";
    if (!groups.has(key)) groups.set(key, { id: key, shoot: item.shoot, items: [] });
    groups.get(key).items.push(item);
  });
  return [...groups.values()];
}

export default function SelectionItemsTable({ deliverables, selections, selectionCounts = {}, errors = {}, onLimitChange, onToggle, onExpand, onAdd, onRemove, adding = false, dense = false, folderShoots = [], drafts: heldDrafts, onDraftsChange }) {
  const savedGroups = groupByShoot(deliverables);
  // The per-group add-row drafts, keyed by group id. Held by the caller when it passes them, so
  // Review & Share can add a typed item nobody pressed + for; otherwise kept here.
  const [ownDrafts, setOwnDrafts] = useState({});
  const drafts = heldDrafts ?? ownDrafts;
  const setDrafts = onDraftsChange ?? setOwnDrafts;
  if (!deliverables.length && !onAdd)
    return <p className={`px-3 py-4 text-slate-500 ${dense ? "text-sm" : "text-xs sm:text-sm"}`}>No deliverables are available for this project.</p>;

  // Root folders that no saved group answers to yet, each shown as its own empty group. Matched
  // against the saved list by folder id - the shared rule ShootSelectionStatus also uses - so a
  // folder whose first item is saved does not double its heading, renamed or not.
  const folderGroups = unmatchedFolderShoots(savedGroups.map((group) => group.shoot), folderShoots)
    .map((folder) => ({ ...folderShootGroup(folder), items: [] }));
  const groups = [...savedGroups, ...folderGroups];

  // The remove column only exists where something can be removed, so a linked project's table keeps
  // the two columns it always had.
  const columns = onRemove || onAdd
    ? (dense ? "grid-cols-[minmax(0,1fr)_76px_24px]" : "grid-cols-[minmax(0,1fr)_92px_32px] sm:grid-cols-[minmax(0,1fr)_120px_32px]")
    : (dense ? "grid-cols-[minmax(0,1fr)_76px]" : "grid-cols-[minmax(0,1fr)_92px] sm:grid-cols-[minmax(0,1fr)_120px]");
  const rowText = dense ? "text-[10px]" : "text-xs sm:text-sm";
  const limitHeight = dense ? "h-6" : "min-h-9";

  function draftOf(groupId) { return drafts[groupId] || { name: "", limit: "" }; }
  // A typed limit out of range is marked as it is typed; empty is fine - it means 1.
  const draftLimitInvalid = (groupId) => String(draftOf(groupId).limit ?? "") !== "" && !validateSelectionLimit(draftOf(groupId).limit);
  // The shoot rides with the draft so it can be added from outside the table.
  function setDraft(group, patch) { setDrafts((current) => ({ ...current, [group.id]: { name: "", limit: "", ...current[group.id], ...patch, shootName: group.shoot?.shoot || null, shootFolderId: group.shoot?.folderId || null } })); }
  function submitNew(event, group) {
    event.preventDefault();
    const draft = draftOf(group.id);
    // An empty Limits box means 1; a typed number out of range is refused, as Review & Share does.
    const selectionLimit = newSelectionItemLimit(draft.limit);
    if (!draft.name.trim() || !validateSelectionLimit(selectionLimit)) return;
    Promise.resolve(onAdd({ name: draft.name.trim(), selectionLimit, shootName: group.shoot?.shoot || null, shootFolderId: group.shoot?.folderId || null })).then((ok) => {
      if (ok !== false) setDrafts((current) => ({ ...current, [group.id]: { name: "", limit: "" } }));
    });
  }

  return <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
    <div className={`grid ${columns} border-b border-slate-200 bg-slate-50 px-3 py-1 text-[10px] font-medium text-slate-600 ${dense ? "" : "sm:py-2 sm:text-xs"}`}>
      <span>Selection Items</span>
      <span className="flex items-center justify-between gap-1">
        Set Limit
        {/* Only the narrow rail offers this — the expanded view is already open. */}
        {onExpand && <IconButton size="xs" label="Expand selection items" title="Expand" onClick={onExpand} className="h-5 w-5 text-slate-500 hover:bg-slate-200 hover:text-slate-700"><OpenInFull style={{ fontSize: 12 }} /></IconButton>}
      </span>
    </div>
    {/* A manual project with nothing to group under yet: its shoots are its root folders, so the
        way to a first selection item is to make a folder, and the table says so instead of
        offering nothing. */}
    {onAdd && !groups.length && (
      <p className={`px-3 py-4 text-slate-500 ${dense ? "text-[10px]" : "text-xs sm:text-sm"}`}>Create a folder in the project to start adding selection items under it.</p>
    )}
    {groups.map((group) => (
      <div key={group.id}>
        <div className={`flex items-center gap-2 border-b border-slate-200 bg-slate-50 px-3 py-1.5 font-semibold text-slate-700 ${dense ? "text-xs" : "text-xs sm:text-sm"}`}>
          {group.shoot ? <>
            <InfoOutlined style={{ fontSize: 14 }} aria-hidden="true" className="shrink-0" />
            <span className="truncate">{group.shoot.shoot || "Unnamed shoot"}</span>
            {group.shoot.shootId && <span className="shrink-0 font-normal text-slate-500">({group.shoot.shootId})</span>}
          </> : <span>Other deliverables</span>}
        </div>
        {group.items.map((item) => {
          const current = selections.find((entry) => entry.id === item.id);
          return <div key={item.id} className={`grid ${columns} items-center gap-2 border-b border-slate-100 px-2 py-1 last:border-b-0 ${dense ? "" : "sm:px-3 sm:py-1.5"}`}>
            <label className={`flex min-w-0 items-center gap-2 text-slate-700 ${rowText}`}>
              {/* A submitted item's box turns the palette's completed green: the client has sent
                  this selection, and the row should say so at a glance.

                  Through `--control-accent`, not `accent-color`. The application draws its own
                  checkboxes - globals.css sets `appearance: none` on every one and fills a checked
                  box with `background-color: var(--control-accent)` - so the native accent this
                  used to set was inert, and the box stayed the default blue however green the
                  style said it was. This sets the variable that rule actually reads, which turns
                  the fill, the border and the focus ring together. */}
              <input
                type="checkbox"
                checked={current?.enabled || false}
                onChange={(event) => onToggle(item.id, event.target.checked)}
                style={item.selectionSubmittedAt ? { "--control-accent": PROGRESS_COLORS.completed } : undefined}
                className="h-4 w-4 shrink-0"
              />
              <span className="truncate">{item.name}</span>
              {/* How many the client has picked so far, the same "10 ✓" the desktop's panel
                  shows — read beside the limit it counts toward. */}
              <span className={`flex shrink-0 items-center ${item.selectionSubmittedAt ? "" : "text-slate-400"}`} style={item.selectionSubmittedAt ? { color: PROGRESS_COLORS.completed } : undefined} title={`${selectionCounts[item.id] || 0} selected by the client${item.selectionSubmittedAt ? " — selection submitted" : ""}`}>
                {selectionCounts[item.id] || 0}<Check style={{ fontSize: 12 }} aria-hidden="true" />
              </span>
            </label>
            <input
              type="number"
              min="1"
              max="100000"
              step="1"
              value={current?.selectionLimit ?? ""}
              onChange={(event) => onLimitChange(item.id, event.target.value)}
              aria-label={`Selection limit for ${item.name}`}
              aria-invalid={errors[item.id] ? true : undefined}
              className={`${limitHeight} ${rowText} w-full rounded-md border bg-white px-2 outline-none [&::-webkit-inner-spin-button]:m-0 [&::-webkit-inner-spin-button]:h-5 [&::-webkit-inner-spin-button]:w-3 ${errors[item.id] ? "border-red-500" : "border-slate-300"}`}
            />
            {/* Only an item the studio typed can be removed. One that came from the allocation is
                retired by changing the allocation, so it has no button here. */}
            {onRemove && (item.projectShootDeliverableId || item.projectPostProductionAllocationId
              ? <span />
              : <IconButton size="xs" label={`Remove ${item.name}`} title="Remove" onClick={() => onRemove(item)} className="h-5 w-5 text-slate-400 hover:bg-red-50 hover:text-red-600"><Close style={{ fontSize: 12 }} /></IconButton>)}
            {errors[item.id] && <p role="alert" className="col-span-full text-[10px] font-normal text-red-600">{errors[item.id]}</p>}
          </div>;
        })}
        {/* Every group — including one just created and still empty — carries its own add row,
            so a typed item lands in the shoot it belongs to. */}
        {onAdd && (
          <form onSubmit={(event) => submitNew(event, group)} className={`grid ${columns} items-center gap-2 border-b border-slate-100 bg-slate-50/60 px-2 py-1.5 last:border-b-0 ${dense ? "" : "sm:px-3 sm:py-2"}`}>
            <input
              value={draftOf(group.id).name}
              onChange={(event) => setDraft(group, { name: event.target.value })}
              maxLength={191}
              placeholder="Add a selection item"
              aria-label={`New selection item name under ${group.shoot?.shoot || "other deliverables"}`}
              className={`${limitHeight} ${rowText} w-full min-w-0 rounded-md border border-slate-300 bg-white px-2 outline-none placeholder:text-slate-400`}
            />
            <input
              type="number"
              min="1"
              max="100000"
              step="1"
              value={draftOf(group.id).limit}
              onChange={(event) => setDraft(group, { limit: event.target.value })}
              placeholder="Limits"
              aria-label={`Selection limit for the new item under ${group.shoot?.shoot || "other deliverables"}`}
              aria-invalid={draftLimitInvalid(group.id) ? true : undefined}
              className={`${limitHeight} ${rowText} w-full rounded-md border ${draftLimitInvalid(group.id) ? "border-red-500" : "border-slate-300"} bg-white px-2 outline-none placeholder:text-slate-400 [&::-webkit-inner-spin-button]:m-0 [&::-webkit-inner-spin-button]:h-5 [&::-webkit-inner-spin-button]:w-3`}
            />
            <IconButton size="xs" type="submit" label={`Add selection item under ${group.shoot?.shoot || "other deliverables"}`} title="Add" disabled={adding || !draftOf(group.id).name.trim() || draftLimitInvalid(group.id)} className="h-5 w-5 text-blue-600 hover:bg-blue-50 disabled:opacity-40"><Add style={{ fontSize: 12 }} /></IconButton>
            {draftLimitInvalid(group.id) && <p role="alert" className="col-span-full text-[10px] font-normal text-red-600">Enter a limit between 1 and 100000, or leave it empty for 1.</p>}
          </form>
        )}
      </div>
    ))}
  </div>;
}
