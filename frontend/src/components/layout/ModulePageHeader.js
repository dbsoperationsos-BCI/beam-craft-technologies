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

import { PRE_PRODUCTION_DESTINATIONS as preProductionDestinations } from "@/lib/lastPage.mjs";

// `titleAddon` and `titleAccessory` are the same slot under two names - the CRM pages reach
// for the first, assets and image selection for the second. Both render, so neither module's
// callers had to be rewritten when the two histories met.
//
// `onBack` puts a Back arrow ahead of the title, for a page reached from somewhere else rather than
// from the sidebar - My Profile, say - whose reader wants the page they left, not the module list.
//
// `leadingActions` opens the row, for a control that scopes what the page is *showing* rather than
// doing something to it - the CRM's date range, the Assets register's branch. It sits with the
// actions rather than beside the title because it is a control the reader operates.
//
// `menu` is the trailing ⋮ - Import, Export, whatever else a page keeps behind one glyph. It has a
// slot of its own so that the row always ends the same way: the page's buttons, then Nebula, then
// the ⋮. Nebula used to open the row, which read well on a page whose actions were buttons and badly
// on one that ends in a ⋮ - two quiet icons with the primary button between them. A page passes its
// ⋮ here rather than at the end of `actions`; passed in `actions` it still draws, just before Nebula
// instead of after it.
//
// `stretchActionsOnPhone` is for a page whose actions are its main controls rather than one short
// button beside the title - Employee Attendance's Break In and Login. Below `sm` the action row then
// spans the width, so those buttons can share it (each takes `max-sm:flex-1`) instead of sitting in
// a clump at the left of an otherwise empty row. From `sm` up it changes nothing.
export default function ModulePageHeader({ title, titleAddon, titleAccessory, titleContainerClassName = "", tabs, tabValue, onTabChange, tabsAriaLabel, tabsAside, actions, leadingActions, menu, onBack, ownsSelectionActions = false, stretchActionsOnPhone = false, children }) {
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
      {/* The row's order is fixed here rather than page by page: what scopes the page, then what it
          can do, then Nebula, then the ⋮. The two quiet icons sit together at the end, and the
          primary button keeps the place the eye goes to - just before them. */}
      <div className={`module-page-header-actions flex max-w-full flex-wrap items-center gap-2 sm:shrink-0 sm:flex-nowrap ${stretchActionsOnPhone ? "max-sm:w-full max-sm:flex-nowrap" : ""}`}>{leadingActions}{selection && !ownsSelectionActions ? null : actions}<NebulaHeaderButton />{selection && !ownsSelectionActions ? null : menu}{selection && <TableSelectionActions {...selection} />}</div>
    </PageHeaderTopRow>
    <PageHeaderTabsRow tabs={tabs} tabValue={tabValue} onTabChange={onTabChange} tabsAriaLabel={tabsAriaLabel} aside={tabsAside}>{children}</PageHeaderTabsRow>
  </header>;
}
