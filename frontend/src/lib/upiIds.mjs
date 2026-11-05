/**
 * The UPI IDs a branch keeps, out of the boxes a form was holding.
 *
 * Trimmed, blanks dropped, and no handle twice. Settings → Organization → Branches always carries
 * one empty box and gains another whenever somebody presses Add, so a row left unfilled is not a
 * mistake to report - it is a row nobody used, and it simply does not travel. A repeat is said
 * under the box that repeats before it gets this far; dropping it here as well means the list that
 * reaches the server is the list whatever happens, and the server holds the same rule again
 * (`backend/src/modules/admin/branches/validation.js`).
 *
 * Compared without case, since `A@ybl` and `a@ybl` are one handle, but stored exactly as typed: a
 * UPI handle is the provider's spelling, and folding it would keep an address nobody wrote.
 *
 * Free of React so `test/branch-upi-ids.test.mjs` can hold the rule.
 */
/**
 * How many UPI IDs a branch may hold - the same ceiling the server keeps
 * (`MAX_UPI_IDS` in `backend/src/modules/admin/branches/validation.js`). Not a rule the studio
 * asked for: it is a ceiling on what one save may write, and the form stops offering Add there so
 * nobody builds a list that would be refused.
 */
export const MAX_UPI_IDS = 10;

export function upiIdsOf(list) {
  const seen = new Set();
  return (Array.isArray(list) ? list : [])
    .map((value) => String(value ?? "").trim())
    .filter((id) => {
      if (!id) return false;
      const key = id.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export default upiIdsOf;
