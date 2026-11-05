import Tabs from "@/components/ui/Tabs";

/**
 * The row under a page title. `tabs` is the tab bar as data — see `Tabs` — and `children` is for the
 * rare row that holds something else, such as a search box, drawn under the tabs. `aside` sits at the
 * right of the tabs on the same line - a short statement about what the tabs show, such as Payroll's
 * pay cycle - and wraps under them where the row is too narrow for both.
 */
export default function PageHeaderTabsRow({ tabs, tabValue, onTabChange, tabsAriaLabel, aside, children }) {
  if (!tabs && !children && !aside) return null;
  const tabBar = tabs && <Tabs tabs={tabs} value={tabValue} onChange={onTabChange} ariaLabel={tabsAriaLabel} />;
  // `px-6` for the same reason the row above uses it: 12px of it is spent undoing the header's
  // `-mx-3`. Matching that row is what keeps the first tab under the first letter of the title.
  return <div className="px-6 sm:px-8 lg:px-9">
    {aside
      ? <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <div className="min-w-0 max-w-full">{tabBar}</div>
        <div className="min-w-0 pb-1">{aside}</div>
      </div>
      : tabBar}
    {children}
  </div>;
}
