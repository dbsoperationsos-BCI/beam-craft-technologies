/**
 * The heading over a module dashboard's recent-rows table, with the chip that says what a pressed
 * card has narrowed it to and the one place to let that go from down here. One copy for Recent
 * Projects, Recent Events and Recent Albums.
 */
export default function DashboardTableHeading({ title, label, onClear, noun = "rows" }) {
  return <div className="pb-2">
    <h2 className="text-sm font-medium text-slate-700">
      {title}
      {label && <span className="ml-2 inline-flex items-center gap-1 rounded-full border border-blue-300 bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700">
        {label}
        <button type="button" onClick={onClear} aria-label={`Show all ${noun} instead of ${label}`} className="rounded px-0.5 leading-none hover:bg-blue-100">×</button>
      </span>}
    </h2>
  </div>;
}
