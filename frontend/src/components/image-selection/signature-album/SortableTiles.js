"use client";

import { useState } from "react";
import { dropIndex, moveInList } from "@/lib/sidebarLayout.mjs";

/**
 * A grid of tiles whose order a person sets by dragging, the way `SortableList` orders rows.
 *
 * The line marking where a tile will land sits to the left or right of the tile under the
 * pointer, by which half of it the pointer is in. Every tile answers the arrow keys while it has
 * focus, which is also the only way to reorder by touch - a finger fires no HTML5 drag - so each
 * tile's own controls are expected to carry "move" actions for a phone; see `renderTile`.
 */
export default function SortableTiles({ items, onReorder, renderTile, disabled = false, className = "", label }) {
  const [draggingId, setDraggingId] = useState(null);
  const [target, setTarget] = useState(null);

  const move = (from, to) => {
    const ids = items.map((item) => item.id);
    const next = moveInList(ids, from, to);
    if (next !== ids) onReorder(next);
  };
  const sideOf = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return event.clientX - rect.left < rect.width / 2 ? "before" : "after";
  };
  const finish = () => { setDraggingId(null); setTarget(null); };

  return <ul aria-label={label} className={`grid ${className}`}>
    {items.map((item, index) => <li
      key={item.id}
      draggable={!disabled}
      tabIndex={disabled ? -1 : 0}
      aria-label={`Reorder ${item.label || item.fileName || "photo"}`}
      onDragStart={(event) => { if (disabled) return; event.stopPropagation(); setDraggingId(item.id); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", item.id); }}
      onDragEnd={(event) => { event.stopPropagation(); finish(); }}
      onDragOver={(event) => {
        if (disabled || !draggingId || draggingId === item.id) return;
        event.preventDefault(); event.stopPropagation();
        event.dataTransfer.dropEffect = "move";
        const side = sideOf(event);
        setTarget((current) => (current?.id === item.id && current.side === side ? current : { id: item.id, side }));
      }}
      onDrop={(event) => {
        if (disabled || !draggingId) return;
        event.preventDefault(); event.stopPropagation();
        const from = items.findIndex((row) => row.id === draggingId);
        const to = items.findIndex((row) => row.id === item.id);
        if (from >= 0 && to >= 0) move(from, dropIndex(from, to, sideOf(event)));
        finish();
      }}
      onKeyDown={(event) => {
        if (disabled || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return;
        event.preventDefault();
        move(index, index + (event.key === "ArrowLeft" ? -1 : 1));
      }}
      className={`relative rounded-md outline-none transition focus-visible:ring-2 focus-visible:ring-blue-500 ${disabled ? "" : "cursor-grab active:cursor-grabbing"} ${draggingId === item.id ? "opacity-40" : ""}`}
    >
      {target?.id === item.id && <span aria-hidden="true" className={`pointer-events-none absolute inset-y-0 z-10 w-0.5 rounded-full bg-blue-500 ${target.side === "before" ? "-left-1" : "-right-1"}`} />}
      {renderTile(item, index)}
    </li>)}
  </ul>;
}
