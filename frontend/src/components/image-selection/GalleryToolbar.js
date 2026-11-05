import ArrowDownward from "@mui/icons-material/ArrowDownward";
import ArrowUpward from "@mui/icons-material/ArrowUpward";

const FILTER_TABS = [
  { value: "all", label: "All photos" },
  { value: "selected", label: "Selected" },
];

// `showTabs={false}` leaves out All photos / Selected for a gallery with nothing to filter by - the
// Signature Album's; Photo Selection keeps them.
export default function GalleryToolbar({ search, order, selected, onSearch, onOrder, onSelected, showTabs = true }) {
  return <div className="space-y-3">
    {showTabs && <div role="tablist" aria-label="Filter by client selection" className="flex items-end gap-2 border-b border-slate-200">
      {FILTER_TABS.map((tab) => {
        const active = selected === tab.value;
        return <button key={tab.value} type="button" role="tab" aria-selected={active} aria-controls="gallery-results" onClick={() => onSelected(tab.value)} className={`-mb-px border-b-2 px-3 py-2 text-xs transition-colors ${active ? "border-blue-600 font-medium text-blue-600" : "border-transparent text-slate-600 hover:text-slate-800"}`}>{tab.label}</button>;
      })}
    </div>}
    <div className="flex flex-wrap items-center gap-2">
      <input type="search" value={search} onChange={(event) => onSearch(event.target.value)} placeholder="Search images..." className="h-8 min-w-48 flex-1 rounded-md border border-slate-300 px-3 text-xs outline-none focus:border-blue-500" />
      <button type="button" onClick={onOrder} aria-label={`Sort upload date ${order === "asc" ? "descending" : "ascending"}`} className="h-8 rounded-md border border-slate-300 px-2 text-xs">{order === "asc" ? <ArrowUpward style={{ fontSize: 14 }} /> : <ArrowDownward style={{ fontSize: 14 }} />}</button>
    </div>
  </div>;
}
