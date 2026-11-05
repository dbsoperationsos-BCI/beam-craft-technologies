"use client";

/**
 * The underlined tab bar every module filters its table with. Give it the tabs as data and it
 * renders them, so the size, the selected colour and the tab semantics are decided once here rather
 * than written out again on each page — which is how three different tab sizes ended up in the app.
 *
 * A tab is `{ id, label, count, disabled, title }`. `count` is optional and shown in brackets after
 * the label; a tab with no count is just a label, as the vendor filters are. `disabled` shows a tab
 * that is not open yet - greyed, not pressable, with `title` saying why on hover.
 */
const sizes = {
  // Roomy enough to read at a glance, for the handful of tabs most modules have.
  md: "px-3 py-1.5 text-sm",
  // Tighter, for a bar with enough tabs that the roomy one would scroll on a laptop.
  sm: "px-2.5 py-2 text-xs sm:px-3 sm:py-1.5 sm:text-sm",
  // Underline only, sitting on a divider the caller draws - the client gallery's tab row, where the
  // words are spaced by the row's own gap rather than by padding.
  inline: "px-1 pb-2 text-[13px]",
};

/** More than five tabs and the roomy size stops fitting, so the bar tightens itself. */
const sizeFor = (count) => count > 5 ? "sm" : "md";

export default function Tabs({ tabs, value, onChange, size, ariaLabel, className = "" }) {
  const scale = sizes[size] || sizes[sizeFor(tabs.length)];

  return <div role="tablist" aria-label={ariaLabel} className={`flex max-w-full gap-1 overflow-x-auto ${className}`}>
    {tabs.map((tab) => {
      const selected = tab.id === value;
      const off = Boolean(tab.disabled);
      return <button
        key={tab.id}
        type="button"
        role="tab"
        aria-selected={selected}
        aria-disabled={off || undefined}
        disabled={off}
        title={tab.title || undefined}
        onClick={() => { if (!off) onChange(tab.id); }}
        className={`shrink-0 border-b-2 font-medium transition ${scale} ${selected ? "border-blue-600 text-blue-700" : off ? "cursor-not-allowed border-transparent text-slate-400" : "border-transparent text-slate-600 hover:border-slate-300 hover:text-slate-900"}`}
      >
        {tab.label}{tab.count === undefined || tab.count === null ? "" : ` (${tab.count})`}
      </button>;
    })}
  </div>;
}
