"use client";

import Dropdown from "@/components/shared/Dropdown";

/** A section switch. An item's `badge` is a count beside it in the menu; `triggerBadge` dots the switch itself. */
// `menuMinWidth` is for a switch whose rows carry a description: the menu opens wider than its
// narrow trigger so every row is read without scrolling.
export default function DropdownMenu({ ariaLabel, items, value, onChange, className = "", sorted, triggerBadge = false, disabled = false, menuMinWidth }) {
  return <Dropdown ariaLabel={ariaLabel} className={className} mode="switch" options={items} value={value} onChange={onChange} sorted={sorted} triggerBadge={triggerBadge} disabled={disabled} menuMinWidth={menuMinWidth} />;
}
