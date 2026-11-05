const sizes = {
  sm: "h-4 w-4",
  md: "h-6 w-6",
  lg: "h-9 w-9",
};

/**
 * The one spinner in the app. Anything that waits — a table fetching rows, a dialog opening a
 * list, a route being loaded — shows this rather than its own line of "Loading..." text, so a wait
 * looks the same wherever it happens.
 *
 * Drawn as an SVG rather than as a bordered box. The border version asked a lot of the cascade to
 * be visible at all: a full grey `border-color` overridden on one side by `border-t-blue-600`, a
 * width from the arbitrary `border-[3px]`, and a `border-style` resolved through a `@property`
 * variable. Any one of those not landing left a plain grey ring, and a *uniform* ring that rotates
 * looks completely still — the blue arc is the only thing that shows it is moving at all. Two
 * explicit strokes cannot lose that arc.
 *
 * `inline` puts the spinner beside its label for tight spaces; the default stacks them in a block
 * that centres itself in whatever container it is dropped into.
 */
function Spinner({ size }) {
  return <svg
    aria-hidden="true"
    viewBox="0 0 24 24"
    fill="none"
    className={`shrink-0 animate-spin ${sizes[size] || sizes.md}`}
  >
    {/* Stroke 2 in a 24 viewBox, which is exactly the weight the bordered version had: at `lg` the
        SVG scales 24 -> 36, so 2 renders as the old 3px border, and at `md` it renders as 2px. */}
    {/* The track it turns against. */}
    <circle cx="12" cy="12" r="10" stroke="#e2e8f0" strokeWidth="2" />
    {/* A quarter turn of blue, from the top round to the right. This is the part that reads as
        motion, so it is a stroke of its own rather than one coloured side of a border. */}
    <path d="M12 2a10 10 0 0 1 10 10" stroke="#155dfc" strokeWidth="2" strokeLinecap="round" />
  </svg>;
}

export default function Loader({ label = "Loading...", size = "md", inline = false, className = "" }) {
  const spinner = <Spinner size={size} />;

  if (inline) return <span role="status" className={`inline-flex items-center gap-2 text-sm text-slate-500 ${className}`}>{spinner}{label && <span>{label}</span>}</span>;

  return <div role="status" className={`flex flex-col items-center justify-center gap-3 px-4 py-10 text-center text-sm text-slate-500 ${className}`}>
    {spinner}
    {label && <span>{label}</span>}
  </div>;
}

/** A whole page or route waiting, centred in the space the page would have filled. */
export function PageLoader({ label = "Loading..." }) {
  return <div className="flex h-full min-h-[60vh] w-full items-center justify-center">
    <Loader label={label} size="lg" />
  </div>;
}
