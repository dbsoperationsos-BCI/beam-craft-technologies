/** The thin track every progress figure in the module is drawn on. `percent` is 0-100. */
export default function ProgressBar({ percent = 0, tone = "bg-blue-600", className = "", label }) {
  const width = Math.max(0, Math.min(100, Number(percent) || 0));
  return <div className={className}>
    <div role="progressbar" aria-valuenow={width} aria-valuemin={0} aria-valuemax={100} aria-label={label} className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
      <div className={`h-full rounded-full transition-[width] duration-300 ${tone}`} style={{ width: `${width}%` }} />
    </div>
  </div>;
}
