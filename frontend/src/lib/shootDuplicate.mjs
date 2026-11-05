/**
 * What a duplicated shoot's dialog opens with.
 *
 * Duplicate on a Shoot List's ⋮ - Create / Edit Project, Start / Edit Project, the Quotation
 * Generator - opens the shoot dialog filled from the shoot being copied, with Shoot left empty for
 * the person to choose: a copy is nearly always the same day, place and arrangements for a
 * different shoot (the Bride Haldi's details again, for the Bride Making), so the one thing it has
 * to be asked is which shoot it is. Every other value is carried exactly as the source holds it -
 * `false`, `0`, an empty optional answer and the Additional Text included - and nothing is reset
 * to a default on the way.
 *
 * One thing never comes across: Main Event. One shoot carries the mark, and a copy leaves it where
 * it was rather than taking it. The source's own identity rides along in the draft untouched, but
 * it goes nowhere: the dialog reads only the fields it asks (`emptyShoot`), and whoever saves the
 * copy gives it a key and Shoot ID of its own, so an id, a project link or a timestamp on the
 * source is never written onto the copy.
 *
 * Arrays are copied rather than shared, so nothing the draft holds is the source's own object. Kept
 * free of React so `node --test` can hold it, the way `definitionDuplicate.mjs` is.
 */
export function duplicateShootValues(source) {
  if (!source) return null;
  return {
    ...structuredClone(source),
    shoot: "",
    isMainEvent: false,
  };
}
