/**
 * A strip of film: two rows of sprocket holes with frames between them - the photograph's own
 * object, which is what a studio's client is shown their project as.
 *
 * Presentational only. The frames are `children` (each an `<li>`), laid in a row; `className` sizes
 * and places the strip. `winding` sets it moving: it winds in from the right as the page opens
 * (`film-wind`, globals.css) - still for anybody whose device asks for less motion.
 */
export default function FilmStrip({ children, label, className = "", listClassName = "", winding = false }) {
  return <div className={`rounded-xl bg-[var(--client-film)] shadow-[0_18px_40px_-24px_rgba(46,36,25,0.8)] ${winding ? "film-wind" : ""} ${className}`}>
    <div aria-hidden="true" className="film-sprockets h-3" />
    <ol aria-label={label} className={`flex gap-2 px-2.5 ${listClassName}`}>{children}</ol>
    <div aria-hidden="true" className="film-sprockets h-3" />
  </div>;
}
