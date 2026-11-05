/**
 * The client pages' dark ground: earth deepening to the film's near-black, with a soft gold light
 * from the top corner, the way a studio lamp falls. Fills whatever positioned box it is put in -
 * the sign-in's panel, and the opening that lands on it - so the two are one ground.
 */
export default function ClientBackdrop() {
  return <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden bg-[linear-gradient(160deg,var(--client-earth)_0%,var(--client-film)_100%)]">
    <div className="absolute -right-24 -top-24 h-72 w-72 rounded-full bg-[var(--client-primary)] opacity-25 blur-3xl lg:h-[28rem] lg:w-[28rem]" />
  </div>;
}
