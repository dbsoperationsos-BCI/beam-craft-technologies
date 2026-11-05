"use client";

import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import ModulePageHeader from "@/components/layout/ModulePageHeader";
import DropdownMenu from "@/components/ui/DropdownMenu";
import OptionsMenu from "@/components/ui/OptionsMenu";
import ImageSelectionSettingsForm from "./ImageSelectionSettingsForm";
import { useModuleAccess } from "@/components/auth/PermissionsProvider";

// Image Selection's own sections, and only those. Album Proofing is a section of its own — its own
// sidebar entry under Visual Curation, its own routes and its own permission — so it is not one of
// the destinations this switch offers, and it renders this header under its own title instead.
const imageSelectionSections = [
  { label: "Dashboard", value: "/image-selection/dashboard" },
  { label: "Projects", value: "/image-selection/projects" },
];

/**
 * The module title bar, built from the same ModulePageHeader every other module page uses so the
 * title, its dividers and the actions on the right line up with the rest of the app. The
 * section switch (Dashboard/Projects) is the shared DropdownMenu, exactly as Pre Production picks its
 * sub-page, and the ⋮ is the shared OptionsMenu — both of which already own the outside-click and
 * Escape handling this component used to repeat for itself.
 *
 * `title` and `sections` let a page that is not Image Selection wear the same bar: Album Proofing
 * passes its own title and no sections, so it gets the heading and the ⋮ without a switch to
 * pages that are not its own.
 *
 * ⋮ → Settings opens the settings shared by every Image Selection project, so it needs no project
 * and works from both pages under this header. A single project's own settings are edited in the
 * Selection Settings rail beside its workspace.
 *
 * Named "Settings" rather than "Project Settings": Project Management has a screen of its own by
 * that name, and the workspace below this one sends people to it by name — two unrelated screens
 * answering to one label is how somebody ends up on the wrong one.
 */
// `actions` is the page's own controls - the dashboard's range, Refresh and New Project - drawn
// ahead of the module's ⋮, which stays last at the right-hand end as every module header keeps it.
// `options` are the page's own entries for the ⋮, placed above Settings - the Projects page adds
// Match WhatsApp Groups there, under its own permission rather than this component's.
export default function ImageSelectionNavigation({ onSettingsSaved, actions = null, options = [], title = "Image Selection", sections = imageSelectionSections }) {
  // Settings edits the studio-wide Image Selection record, which the Settings module serves — not
  // this one. Asked for by name rather than by route, because the route's own permission would have
  // offered the menu to people the API then refuses the save to.
  // The studio name and branding logo this panel edits live in Settings → Organization, and its
  // routes are guarded by that row since `ADMIN / System Settings` was split into the Settings
  // module - one row per rail entry. Same permission the panel itself answers for.
  const { canWrite: canEditSettings } = useModuleAccess("SETTINGS", "Organization");
  const pathname = usePathname();
  const router = useRouter();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const menuItems = [...options, ...(canEditSettings ? [{ label: "Settings", onSelect: () => setSettingsOpen(true) }] : [])];
  const activeSection = sections.length > 1
    ? sections.find((section) => pathname === section.value || pathname.startsWith(`${section.value}/`)) || sections[0]
    : null;

  return <>
    <ModulePageHeader
      title={title}
      titleAccessory={activeSection ? <div className="border-l border-slate-200 pl-3"><DropdownMenu ariaLabel="Image Selection section" items={sections} value={activeSection.value} onChange={(href) => router.push(href)} /></div> : null}
      actions={actions || menuItems.length ? <>{actions}{menuItems.length > 0 && <OptionsMenu ariaLabel="Image Selection options" items={menuItems} />}</> : null}
    />
    {settingsOpen && <ImageSelectionSettingsForm onClose={() => setSettingsOpen(false)} onSaved={onSettingsSaved} />}
  </>;
}
