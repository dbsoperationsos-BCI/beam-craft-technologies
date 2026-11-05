import Tabs from "@/components/ui/Tabs";

/**
 * The row under a page title. `tabs` is the tab bar as data — see `Tabs` — and `children` is for the
 * rare row that holds something else, such as a search box.
 */
export default function PageHeaderTabsRow({ tabs, tabValue, onTabChange, tabsAriaLabel, children }) {
  if (!tabs && !children) return null;
  // `px-6` for the same reason the row above uses it: 12px of it is spent undoing the header's
  // `-mx-3`. Matching that row is what keeps the first tab under the first letter of the title.
  return <div className="px-6 sm:px-8 lg:px-9">
    {tabs && <Tabs tabs={tabs} value={tabValue} onChange={onTabChange} ariaLabel={tabsAriaLabel} />}
    {children}
  </div>;
}
