"use client";

import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import ModulePageHeader from "@/components/layout/ModulePageHeader";
import DropdownMenu from "@/components/ui/DropdownMenu";
import OptionsMenu from "@/components/ui/OptionsMenu";
import Button from "@/components/shared/Button";
import { useModuleAccess, useRouteAccess } from "@/components/auth/PermissionsProvider";
import EventDefaultSettingsPanel from "./settings/EventDefaultSettingsPanel";

/**
 * The AI Feature's title bar, wearing exactly what Image Selection's does: the shared
 * ModulePageHeader with the section switch beside the title - Overview / Events, the shared
 * DropdownMenu, as Image Selection picks Dashboard / Projects - then + Create Event and the ⋮.
 * The ⋮ holds Event Default Settings, the studio-wide template, which is not a section because it
 * is not a place the studio works, only one it configures.
 *
 * The switch moves between routes rather than state, so Overview and Events are each a page of
 * their own that the sidebar entry and a bookmark can land on.
 *
 * Create Event answers to this route's Read / Write; the defaults panel to AI Event Default
 * Settings by name, so somebody who runs events but may not change the template is not offered
 * a menu the server would refuse.
 */
const SECTIONS = [{ label: "Overview", value: "/visual-curation/ai/overview" }, { label: "Events", value: "/visual-curation/ai/events" }];

export default function AiFeatureNavigation({ onCreateEvent, actions = null, options = [] }) {
  const pathname = usePathname();
  const router = useRouter();
  const { canWrite } = useRouteAccess();
  const { canRead: canReadDefaults } = useModuleAccess("IMAGE_SELECTION", "AI Event Default Settings");
  const [defaultsOpen, setDefaultsOpen] = useState(false);
  const activeSection = SECTIONS.find((section) => pathname === section.value || pathname.startsWith(`${section.value}/`)) || SECTIONS[0];
  const menuItems = [...options, ...(canReadDefaults ? [{ label: "Event Default Settings", onSelect: () => setDefaultsOpen(true) }] : [])];

  return <>
    <ModulePageHeader
      title="AI Feature"
      titleAccessory={<div className="border-l border-slate-200 pl-3"><DropdownMenu ariaLabel="AI Feature section" items={SECTIONS} value={activeSection.value} onChange={(href) => router.push(href)} sorted={false} /></div>}
      actions={<>
        {actions}
        {canWrite && onCreateEvent && <Button type="button" variant="primary" size="sm" onClick={onCreateEvent}>+ Create Event</Button>}
        {menuItems.length > 0 && <OptionsMenu ariaLabel="AI Feature options" triggerVariant="button" items={menuItems} />}
      </>}
    />
    {defaultsOpen && <EventDefaultSettingsPanel onClose={() => setDefaultsOpen(false)} />}
  </>;
}
