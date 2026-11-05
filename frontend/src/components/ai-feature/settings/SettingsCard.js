/**
 * One group of related settings inside a section of the Event Default Settings workspace - Guest
 * Registration, Face Quality, Match Confidence. A framed card with a small heading and an optional
 * line saying what the group is for, so a section reads as a few named groups rather than one grid
 * of switches.
 *
 * `inert` dims the whole card: the settings inside are kept exactly as they are but nothing reads
 * them while a parent switch is off, and the card says so through `inertReason`.
 */
export default function SettingsCard({ title, description, inert = false, inertReason, children, className = "" }) {
  return <section aria-label={title} className={`rounded-lg border border-slate-200 bg-white ${inert ? "opacity-60" : ""} ${className}`}>
    <header className="border-b border-slate-100 px-4 py-3">
      <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
      {description && <p className="mt-0.5 text-xs text-slate-500">{description}</p>}
      {inert && inertReason && <p className="mt-1 text-xs text-amber-700">{inertReason}</p>}
    </header>
    <div className="px-4">{children}</div>
  </section>;
}
