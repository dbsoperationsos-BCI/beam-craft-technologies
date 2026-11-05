/**
 * Makes everything inside genuinely un-editable when the viewer holds READ but not READ_WRITE.
 *
 * A control the viewer may not use is normally *absent* — that is the rule everywhere a button or a
 * menu entry is concerned. Form fields are the exception: a panel with its fields removed is not a
 * read-only record, it is an empty one, and the whole point of opening it on READ is to read what it
 * says. So the fields stay, filled in, and are refused instead.
 *
 * `fieldset disabled` is what does the refusing, rather than a `disabled` prop on each field: it
 * reaches every input, select, textarea and button inside, including ones added later by somebody
 * who never heard of this component. A field that opts out of it is a field that has to say so.
 *
 * The refused cursor sits on the controls, never on the box around them — over a heading or the gap
 * between rows there is nothing to refuse, and a whole panel reading as blocked says the screen is
 * unavailable rather than uneditable.
 *
 * What it cannot reach: a control that hides its real input behind a label, the way ToggleSwitch
 * draws a span over a visually hidden checkbox. Those are inert here but still style themselves as
 * live, so they need `disabled` passed to them as a prop as well.
 */
export default function ReadOnlyFieldset({ canWrite = true, reason, className = "", children }) {
  // The element is always rendered, with only `disabled` changing. Rendering it in one state and not
  // the other would hand `className` to the layout in one case and drop it in the other, so a rail
  // that scrolls for somebody who may edit it would stop scrolling for somebody who may not.
  //
  // `min-w-0` because a fieldset sizes to its content by default and would otherwise push a narrow
  // column wider than the space it was given. The refused-cursor rules only match `:disabled`, so
  // they cost nothing while the form is editable.
  return <fieldset
    disabled={!canWrite}
    title={canWrite ? undefined : reason}
    className={`min-w-0 [&_button:disabled]:cursor-restricted [&_input:disabled]:cursor-restricted [&_select:disabled]:cursor-restricted [&_textarea:disabled]:cursor-restricted ${className}`}
  >
    {children}
  </fieldset>;
}
