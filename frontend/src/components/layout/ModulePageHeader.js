"use client";

import { usePathname, useRouter } from "next/navigation";
import ArrowBackRoundedIcon from "@mui/icons-material/ArrowBackRounded";
import IconButton from "@/components/shared/IconButton";
import DropdownMenu from "@/components/ui/DropdownMenu";
import PageHeaderTabsRow from "./PageHeaderTabsRow";
import PageHeaderTopRow from "./PageHeaderTopRow";
import NebulaHeaderButton from "@/components/ai/NebulaHeaderButton";
import TableSelectionActions, { useSelectionActionsProps } from "@/components/data-table/TableSelectionActions";
import { sidebarLabelForRoute } from "@/constants/navigation.mjs";

const preProductionDestinations = [
  { label: "All", href: "/project-management/pre-production" },
  { label: "Dum Dum", href: "/project-management/pre-production/dum-dum" },
  { label: "Qua Qua", href: "/project-management/pre-production/qua-qua" },
  { label: "Corp", href: "/project-management/pre-production/corp" },
];

// `titleAddon` and `titleAccessory` are the same slot under two names - the CRM pages reach
// for the first, assets and image selection for the second. Both render, so neither module's
// callers had to be rewritten when the two histories met.
//
// `onBack` puts a Back arrow ahead of the title, for a page reached from somewhere else rather than
// from the sidebar - My Profile, say - whose reader wants the page they left, not the module list.
//
// `leadingActions` is the one slot ahead of Nebula, for a control that scopes what the page is
// *showing* rather than doing something to it - the CRM's date range. It sits with the actions
// rather than beside the title because it is a control the reader operates, and to the left of the
// quiet Nebula icon because everything after that icon is an action and this is not one.
export default function ModulePageHeader({ title, titleAddon, titleAccessory, titleContainerClassName = "", tabs, tabValue, onTabChange, tabsAriaLabel, actions, leadingActions, onBack, ownsSelectionActions = false, children }) {
  const router = useRouter();
  /*
   * A selection takes the action row over.
   *
   * Two sets of buttons side by side would put an action on thirty rows next to one that adds a
   * thirty-first, and the primary position - where the eye lands - would belong to neither. So the
   * page's own actions stand down while a table on it has something ticked, and come back the
   * moment it is cleared. The table's buttons arrive through the slot below.
   *
   * `ownsSelectionActions` is for a page that already swaps its own actions on a selection - the
   * Interview register puts Delete and Change Stage where Add Application stands - which must keep
   * drawing them beside the general Export and Clear rather than losing them to this.
   */
  const selection = useSelectionActionsProps();
  const pathname = usePathname();
  const showPreProductionDropdown = title.startsWith("Pre Production");
  /*
   * A screen is called what the menu entry that opens it is called.
   *
   * The sidebar said **Quotations** and the page said Quotation, for the one screen — the label was
   * written in two places and only one of them was ever corrected. So the registry answers for both
   * now: a page whose route the sidebar lists takes its heading from
   * `constants/navigation.mjs`, the same file the drawer, the layout editor and Role Management
   * already read their names from, and the two cannot drift apart again.
   *
   * `title` is still what a page passes and still what is drawn for everything the menu does not
   * list — My Profile, Administration, the Pre Production boards, a record opened from a table.
   * Those are real screens with names of their own; the registry answers `""` for them and steps
   * out of the way.
   */
  const headingTitle = showPreProductionDropdown ? "Pre Production" : (sidebarLabelForRoute(pathname) || title);
  const selectedPreProductionDestination = preProductionDestinations.find((destination) => destination.label === "All" ? title === "Pre Production" : title === `Pre Production - ${destination.label}`)?.href || preProductionDestinations[0].href;

  return <header className="-mx-3 border-b border-slate-200 bg-white sm:-mx-4 lg:-mx-5">
    <PageHeaderTopRow>
      {/* No padding nudge of its own. Two modules used to add `max-sm:pl-2` here, which shifted the
          heading off the screen edge but left the buttons and the tabs against it — the inset
          belongs to the rows, where it applies to both ends of both of them at once. */}
      <div className={`flex min-w-0 flex-wrap items-center gap-3 ${titleContainerClassName}`}>{onBack && <IconButton label="Back" size="sm" shape="circle" onClick={onBack} className="-ml-1 text-slate-600 hover:bg-slate-100"><ArrowBackRoundedIcon fontSize="small" aria-hidden="true" /></IconButton>}<h1 className="text-md leading-6 tracking-tight text-slate-700">{headingTitle}</h1>{titleAddon}{titleAccessory}{showPreProductionDropdown && <div className="border-l border-slate-200 pl-3"><DropdownMenu ariaLabel="Pre Production workflow" items={preProductionDestinations.map((destination) => ({ label: destination.label, value: destination.href }))} value={selectedPreProductionDestination} onChange={(href) => router.push(href)} /></div>}</div>
      {/* Not `w-full` on a phone: a full-width block always wraps to its own line, whether or not
          it would have fitted beside the title, and stretches one short button across the screen.
          Sized by its buttons instead, so the row above can decide. `max-w-full` is what keeps a
          header of three actions from running off the side once it no longer spans the width — it
          wraps within itself instead. */}
      {/* Nebula opens the action row of every module header, which is how it reaches the whole
          application without a single page having to add it. First, ahead of the page's own actions:
          it is a quiet icon rather than a call to action, so it reads as part of the furniture and
          leaves the primary button - Add Lead, Add Meet - at the end where the eye expects it. The
          wrapper is not conditional, because a page with no actions of its own still gets Nebula. */}
      <div className="module-page-header-actions flex max-w-full flex-wrap items-center gap-2 sm:shrink-0 sm:flex-nowrap">{leadingActions}<NebulaHeaderButton />{selection && !ownsSelectionActions ? null : actions}{selection && <TableSelectionActions {...selection} />}</div>
    </PageHeaderTopRow>
    <PageHeaderTabsRow tabs={tabs} tabValue={tabValue} onTabChange={onTabChange} tabsAriaLabel={tabsAriaLabel}>{children}</PageHeaderTabsRow>
  </header>;
}
