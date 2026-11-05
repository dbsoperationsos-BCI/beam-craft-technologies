/**
 * How dark a veil the guest join page lays over an event's cover. The typography over the cover is
 * always white; only the veil changes, so a bright photograph is dimmed more and a dark one less,
 * and the words read on both. The level - "light", "medium" or "strong" - comes with the event as
 * `coverVeil`, measured by the server from the cover itself (the browser cannot read the cover's
 * pixels: the image host sends no CORS headers). `.mjs` so `node --test` can import it without the
 * bundler.
 */

/**
 * The veil itself, top to bottom, one class string per level. The top is where the mark and the
 * name sit and is kept the lightest the level allows; the foot, behind the card, is always deep.
 */
export const VEIL_CLASSES = Object.freeze({
  light: "bg-linear-to-b from-black/35 via-black/20 to-black/65",
  medium: "bg-linear-to-b from-black/45 via-black/30 to-black/70",
  strong: "bg-linear-to-b from-black/60 via-black/45 to-black/75",
});

/** The classes for a level, and "medium" - the veil drawn before anything is known - for anything else. */
export const veilClassesFor = (level) => VEIL_CLASSES[level] || VEIL_CLASSES.medium;
