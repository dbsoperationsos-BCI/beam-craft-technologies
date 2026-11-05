/**
 * When two service or deliverable names are the same name.
 *
 * The server keeps two unique columns on each definition: the name as typed, and a code made from
 * it - upper-cased, with every run of anything but a letter or a digit folded to one underscore, so
 * "Demo Drone", "demo drone" and "Demo - Drone" are all `DEMO_DRONE`. Two names with one code are
 * one row to it, and a save that tries to add the second is refused as "already exists".
 *
 * Settings → Project stages every add and edit and writes them all on one Save, so that refusal
 * used to arrive late: the row was already in the table, the dialog long closed, and the message
 * at the foot of a page whose Save had otherwise worked. The dialogs ask the same question by the
 * same rule before anything is staged, with the name still in the box to fix.
 *
 * Kept free of React so `node --test` can hold the rule, the way `servicePricing.mjs` is.
 */

/** The code the server would make of a name - see `codeFor` in the projects controller. */
export function definitionNameKey(name) {
  return String(name ?? "").trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

/**
 * The keys of every row's name but the row being edited - what a name typed into the dialog may
 * not be. A row keeps its own name without being told it is taken.
 */
export function takenDefinitionNameKeys(rows, exceptId = null) {
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => row && (exceptId === null || row.id !== exceptId))
    .map((row) => definitionNameKey(row.name))
    .filter(Boolean);
}

/** Whether the name typed is one of those - blank is not a name, so it is never taken. */
export function definitionNameTaken(name, takenKeys) {
  const key = definitionNameKey(name);
  return Boolean(key) && (Array.isArray(takenKeys) ? takenKeys : []).includes(key);
}
