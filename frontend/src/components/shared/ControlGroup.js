/**
 * A few controls that do one job, drawn as one control: a bordered pill with hairlines between its
 * children.
 *
 * Icon buttons on their own are glyphs floating in a row - a reader has to work out which belong
 * together and which are separate jobs. Three of them in a bordered group with a hairline between
 * each is one object with three parts, which is what a pager, a stepper or a zoom pair actually is
 * (Gestalt: what is enclosed together is read together).
 *
 * `label` names the job for a screen reader - "Zoom", "Days shown" - since the buttons inside name
 * only themselves. The children are the application's own `IconButton`s and `Button`s; the group
 * adds the border, the spacing and the hairlines and nothing else, so each child keeps its own
 * disabled and focus behaviour.
 */
export default function ControlGroup({ label, children, className = "" }) {
  return <div
    role="group"
    aria-label={label}
    /*
     * The module's own corners and border, so the pill reads as one of this application's controls
     * beside the fields and buttons next to it; it squares its children itself, so no caller has to
     * remember to, and a rounded child cannot leave a sliver of the pill showing at each corner.
     *
     * A child with nothing to do is greyed here rather than by each caller: `Button`'s `plain`
     * variant carries no colours at all - that is what it is for - so a disabled one inside a
     * bordered group was the same slate as a live one, and only the cursor said otherwise.
     */
    className={`inline-flex items-center divide-x divide-slate-200 overflow-hidden rounded-[14px] border border-slate-300 bg-white [&>button]:rounded-none [&_button:disabled]:text-slate-300 ${className}`}
  >
    {children}
  </div>;
}
