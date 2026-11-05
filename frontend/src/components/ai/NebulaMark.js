/**
 * The assistant's mark.
 *
 * One component for every place Nebula appears - the inline mark beside a module's own actions, the
 * avatar in the panel header, and the floating button - so the assistant is the same thing wherever
 * it is met rather than three drawings that have to be kept in step.
 *
 * `currentColor` throughout, and no colour of its own. That is what lets the same mark be the
 * studio's blue where it sits on white, and reversed out to white inside the blue circles, without
 * a variant for either - or for the dark tiers.
 *
 * ── The viewBox ───────────────────────────────────────────────────────────────────────────────
 *
 * The artwork was drawn on a 1095 canvas with the glyph itself occupying 398 x 405 in the middle of
 * it. Rendered on that canvas the mark would sit at about a third the size of the box it was given,
 * so a 22px button would draw a 7px mark floating in space. `320 320 455 455` is the glyph's own
 * bounds with a little air around them, still centred on the canvas centre (547.5), so the mark
 * fills its box the way the letter it replaces did and every size it is asked for still means what
 * it says.
 *
 * `size` is that box, not the glyph: 398 of 455 is about 89%, so a mark asked for at 34 draws about
 * 30px of ink. Worth knowing when sizing it against a button - a caller wanting a 30px mark asks for
 * 34, and a caller drawing a disc behind it leaves the margin in the disc rather than here.
 *
 * The source carries a quarter-pixel stroke in a dark teal, which closes hairline seams at poster
 * size. It is not kept: at these sizes it is a hundredth of a pixel, and a colour of its own is the
 * one thing that would stop this taking the blue around it.
 */
export default function NebulaMark({ size = 24, className = "" }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="320 320 455 455"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        fill="currentColor"
        d="M684.7,344.76c-1.1,5.06-1.51,10.32-2.7,15.41-3.64,15.63-11.92,30.84-26.95,37.94-6.86,3.24-14.19,4.96-21.58,6.31-3.29.6-7.91.69-10.01,2.81,21.02,3.53,40.25,6.82,51.29,27.43,2.82,5.27,4.84,10.85,6.43,16.59.75,2.73.72,7.53,2.27,9.84.26.39.92.31,1.25.64,1.8-3.22,1.73-6.74,2.98-10.14.58-1.59,1.63-2.96,2.19-4.61,1.4-4.06,1.95-9.11,4.3-12.77.68-1.06,1.63-1.65,2.42-2.62,2.8-3.45,3.91-7.51,7.67-10.3,12.39-9.17,26.43-11.67,41.22-14.06-3.67-2.88-10.73-2.62-15.61-3.77-9.73-2.3-20.86-6.58-27.92-13.95-7.48-7.82-11.22-18.16-13.44-28.47-1.1-5.16-.75-11.94-3.81-16.28ZM474,432.19c-15.84,1.61-29.27,10.68-37.62,24.23-4.35,7.05-6.9,15.1-10.45,22.54-5.01,10.5-9.11,21.43-14.04,31.98-7.15,15.31-15.14,30.23-22.56,45.4-8.66,17.71-17.01,35.57-25.75,53.24-8.3,16.78-22.01,36.23-11.52,54.8,2.07,3.68,4.52,7.5,7.82,10.22,19.07,15.77,42.62,4.88,52.9-14.77,2.88-5.5,5.62-11.33,7.93-17.1,1.21-3.01,2.02-6.54,3.72-9.33,4.23-6.92,7.37-14.17,10.31-21.7,1-2.57,3.07-5.07,4.3-7.62,4.15-8.58,8.14-17.21,12.22-25.82,2.54-5.39,4.67-12.13,7.93-17,5.97-8.92,17.72-13.84,28.51-12.65,3.87.42,7.41,3.46,10.63,5.51,13.08,8.35,18.25,18.95,26.54,31.41,14.65,22.04,29.26,44.13,43.76,66.28,8.52,13,16.81,28.15,28.68,38.34,16.98,14.58,43.71,13.29,61.21.43,10.87-8,17.35-20.44,22.4-32.61,1.48-3.57,1.89-7.86,3.82-11.21,2.59-4.52,5.06-9.02,7-13.97.93-2.38,1.47-5.15,2.67-7.41,2.18-4.11,4.66-8.14,6.31-12.6,1.26-3.39,2-7.12,3.76-10.31,2.95-5.34,4.78-10.98,7.47-16.44,6.16-12.53,12.25-25.25,17.95-38.07,6.95-15.6,12.34-33.33-2.85-46.61-3.34-2.92-7.36-5.86-11.59-7.33-13.01-4.51-32.14-.53-39.73,11.73-5.78,9.33-8.51,20.27-12.71,30.32-3.19,7.61-7.15,14.9-10.51,22.44-2.19,4.95-3.88,10.56-6.95,15.04-7.65,11.13-22.93,16.05-35.47,10.76-13.71-5.8-20.14-21.4-28.07-32.88-18.46-26.73-35.77-54.43-53.22-81.82-13.14-20.63-26.91-40.25-54.8-37.42ZM711.82,685.02c-10.31,1.58-21.99,10.77-24.42,21.3-3.38,14.62,2.76,28.97,16.04,35.69,4.21,2.13,9.45,3.74,14.2,3.37,18.19-1.4,32.05-18.94,28.56-37.13-2.79-14.61-20.14-25.42-34.38-23.23ZM467.7,690.65c-2.55,4.73-2,10.53-4.82,15.29-3.18,5.38-9.44,9.86-15.42,11.51-3.14.86-6.32,1.3-9.23,2.78,6.92,3.31,16.53,2.79,21.83,9.17,2.86,3.45,4.95,8.57,5.93,12.9.67,2.96.35,6.26,2.43,7.93,1.03-3.44.23-7.53,1.94-10.82,7.55-14.46,12.61-14.4,27.07-19.18-7.44-2.53-15.87-3.56-21.1-10.18-4.62-5.83-4.75-13.4-8.63-19.4Z"
      />
    </svg>
  );
}
