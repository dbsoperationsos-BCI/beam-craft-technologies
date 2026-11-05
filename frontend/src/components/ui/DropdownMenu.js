"use client";

import Dropdown from "@/components/shared/Dropdown";

export default function DropdownMenu({ ariaLabel, items, value, onChange, className = "", sorted }) {
  return <Dropdown ariaLabel={ariaLabel} className={className} mode="switch" options={items} value={value} onChange={onChange} sorted={sorted} />;
}
