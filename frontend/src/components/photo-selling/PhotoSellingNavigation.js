"use client";

import { usePathname, useRouter } from "next/navigation";
import ModulePageHeader from "@/components/layout/ModulePageHeader";
import DropdownMenu from "@/components/ui/DropdownMenu";

/**
 * Photo Selling's title bar: the shared ModulePageHeader with its section switch beside the title -
 * Dashboard / Projects / Orders - as the AI Feature's own header switches Dashboard / Events. The
 * switch moves between routes, so each section is a page the sidebar and a bookmark can land on.
 * The labels are the studio's words only: Dashboard is the Overview page and Projects the Galleries
 * page, at their same addresses. Settings is not a section: it opens over Projects from the ⋮ beside
 * New Gallery.
 */
export const PHOTO_SELLING_ROOT = "/visual-curation/ai/photo-selling";
const SECTIONS = [
  { label: "Dashboard", value: PHOTO_SELLING_ROOT },
  { label: "Projects", value: `${PHOTO_SELLING_ROOT}/galleries` },
  { label: "Orders", value: `${PHOTO_SELLING_ROOT}/orders` },
];

export default function PhotoSellingNavigation({ actions = null }) {
  const pathname = usePathname();
  const router = useRouter();
  const active = [...SECTIONS].reverse().find((section) => pathname === section.value || pathname.startsWith(`${section.value}/`)) || SECTIONS[0];
  return <ModulePageHeader
    title="Photo Selling"
    titleAccessory={<div className="border-l border-slate-200 pl-3"><DropdownMenu ariaLabel="Photo Selling section" items={SECTIONS} value={active.value} onChange={(href) => router.push(href)} sorted={false} /></div>}
    actions={actions}
  />;
}
