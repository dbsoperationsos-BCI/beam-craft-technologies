/**
 * The shape each photo takes in the guest gallery's phone layout - an editorial two-column grid
 * rather than a wall of equal squares - decided from what the photo is. `.mjs` so `node --test`
 * can import it without the bundler.
 *
 * Shapes, on a two-column grid whose row unit is a tenth of a column's width:
 *   hero   the first photo, across both columns, 14 units tall (about 10:7)
 *   wide   a landscape photo given both columns now and then, 12 units tall (about 5:3)
 *   tall   a portrait photo in one column, 13 units tall (about 3:4)
 *   short  a landscape or square photo in one column, 8 units tall (about 5:4)
 *
 * A photo whose size is not known is placed by a fixed rhythm instead, so the page still reads as
 * editorial rather than falling back to squares. Desktop is not drawn from this: from `md` up the
 * grid resets every tile to an equal square.
 */
export const SHAPES = Object.freeze({
  hero: "col-span-2 [grid-row:span_14]",
  wide: "col-span-2 [grid-row:span_12]",
  tall: "[grid-row:span_13]",
  short: "[grid-row:span_8]",
});

/** The rhythm for photos of unknown size, after the hero. */
const RHYTHM = ["tall", "short", "short", "tall", "wide", "short", "tall", "tall", "short", "wide"];

/** Every how-many-th landscape photo, after the hero, is given the full width. */
const WIDE_EVERY = 7;

/** "portrait", "landscape" or "square" from a photo's size, or null when it has none. */
export function orientationOf(item) {
  const width = Number(item?.width) || 0; const height = Number(item?.height) || 0;
  if (!width || !height) return null;
  if (height > width * 1.1) return "portrait";
  if (width > height * 1.1) return "landscape";
  return "square";
}

/**
 * The shape of every item in order. Decided over the whole list rather than per item, because
 * "every seventh landscape" needs the count so far, and a list that grows by a page keeps the
 * shapes it already had.
 */
export function tileShapes(items) {
  const shapes = [];
  let landscapes = 0;
  (items || []).forEach((item, index) => {
    if (index === 0) { shapes.push("hero"); return; }
    const orientation = orientationOf(item);
    if (orientation === null) { shapes.push(RHYTHM[(index - 1) % RHYTHM.length]); return; }
    if (orientation === "portrait") { shapes.push("tall"); return; }
    landscapes += 1;
    shapes.push(orientation === "landscape" && landscapes % WIDE_EVERY === 0 ? "wide" : "short");
  });
  return shapes;
}

/** The short label a phone's segmented tab bar shows, where the full one would not fit three across. */
export const MOBILE_TAB_LABELS = Object.freeze({ all: "All Photos", find: "Find Me", mine: "My Photos" });
