/**
 * The two shapes a picker's options may be given in, reduced to one.
 *
 * `Dropdown` and `FilterCombobox` both render `option.label` and key on `option.value`, but callers
 * across the app pass either `{label, value}` pairs or a plain list of strings. A string list used
 * to render a menu of blank rows — a string has no `.label` — and picking one set the value to
 * `undefined`, so the control looked dead. Accepting both here is what keeps a caller from having
 * to know which shape a particular picker wanted.
 */
export function normalizeOptions(options = []) {
  if (!Array.isArray(options)) return [];
  return options
    .filter((option) => option !== null && option !== undefined)
    .map((option) => (typeof option === "object" ? option : { label: String(option), value: option }));
}

/**
 * The options in alphabetical ascending order, as a person reads the labels: case-insensitive,
 * and digits compared as numbers so "Shoot 10" follows "Shoot 2" rather than "Shoot 1". Callers
 * hand options in whatever order they hold them — master data in the order it was typed, ids in
 * the order the server returned them — and the menu is where the order becomes visible, so the
 * menu is where it is imposed. Ties keep the order they arrived in.
 */
export function sortOptionsByLabel(options = []) {
  return [...options].sort((a, b) =>
    String(a?.label ?? "").localeCompare(String(b?.label ?? ""), undefined, { numeric: true, sensitivity: "base" }));
}

/** The value a cleared single-select holds: the same empty string an unanswered one starts at. */
export const CLEAR_OPTION_VALUE = "";

/**
 * The list with a row for answering the field with nothing.
 *
 * A dropdown could be moved from one option to another but never back to unanswered, so an
 * **optional** field answered by mistake stayed answered - which is how a Referred By naming
 * somebody who had not referred anybody could not be taken off an employee, and the referral it
 * records could not be removed with it. The row carries the empty string every caller already
 * treats as "no answer", so nothing downstream has to learn a new value.
 *
 * First in the list and never sorted among the options: it is the answer being withdrawn rather
 * than one of the answers. A caller whose own list already offers an empty value keeps it, so a
 * menu can never show two ways to say the same nothing.
 */
export function withClearOption(options = [], { label = "None" } = {}) {
  if (!Array.isArray(options)) return [];
  if (options.some((option) => option?.value === CLEAR_OPTION_VALUE)) return options;
  return [{ label, value: CLEAR_OPTION_VALUE, clear: true }, ...options];
}

/**
 * Where a run of typed characters lands in a list — the rule behind `Dropdown`'s type-to-select.
 *
 * Here rather than inside the component because it is a decision about a list and nothing else: no
 * state, no DOM, no React. The component owns *when* a run starts and ends (a timer, see
 * `TYPEAHEAD_WINDOW_MS`) and this owns where the run points.
 *
 * Three rules, and each is what a native `<select>` does, because that is the behaviour people
 * bring with them to anything that looks like one:
 *
 *   - **Letters typed together make a word.** `de` reaches Deluxe rather than stopping at Digital,
 *     and it searches from the top so each further letter narrows in place rather than moving on.
 *   - **One letter moves on.** It looks from the option *after* the current one, so pressing the
 *     same letter again reaches the next option starting with it rather than sticking on the first.
 *   - **The same letter repeated walks that letter's options.** `sss` is not a search for "sss"; it
 *     is a third press of `s`, which is how the third Studio entry is reached.
 *
 * Matching is `startsWith`, not `includes`: typing `s` should not offer "Album Designing" because
 * there is an s in the middle of it. Case and accent folding is the locale's.
 *
 * Anything `disabled` is skipped, which covers the separators and the headings as well — both are
 * marked disabled upstream precisely so that the keyboard steps over them.
 *
 * @param {Array<{label?: string, disabled?: boolean}>} options the list as it is on screen.
 * @param {string} text what has been typed in this run, oldest character first.
 * @param {number} activeIndex where the highlight is now; the search starts after it.
 * @returns {number} the index to move to, or `-1` when nothing in the list starts with it.
 */
export function typeaheadIndex(options, text, activeIndex = -1) {
  if (!Array.isArray(options) || !options.length || !text) return -1;

  const repeated = text.length > 1 && [...text].every((one) => one === text[0]);
  const needle = (repeated ? text[0] : text).toLocaleLowerCase();
  // A word being built searches from the top; a single letter - whether the first of a run or the
  // same one pressed again - searches from the one after where we are.
  const begin = repeated || text.length === 1 ? activeIndex + 1 : 0;

  const count = options.length;
  for (let step = 0; step < count; step += 1) {
    // Wrapped into range from either end: `activeIndex` may be -1 before anything is highlighted.
    const index = (((begin + step) % count) + count) % count;
    const option = options[index];
    if (option && !option.disabled && String(option.label ?? "").toLocaleLowerCase().startsWith(needle)) return index;
  }
  return -1;
}

export default normalizeOptions;
