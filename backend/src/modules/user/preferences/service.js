const prisma = require("../../../config/db");
const { validateSidebarLayout } = require("./sidebarStructure");

/*
 * One login's own arrangement of the application: the order it dragged its columns into, the ones
 * it hid, how many it froze, how wide it pulled them, the density it reads at, and the tab each
 * screen was left on.
 *
 * All of this used to live in the browser's `localStorage`, which meant it did not follow anybody
 * to a second machine, and - because those keys were not namespaced by user - meant the next person
 * to sign in on a shared machine inherited the last one's layout. It is per user here, and the
 * browser keeps only a cache of it.
 *
 * Everything arriving here is written by a browser and must be treated as such. The value goes into
 * a JSON column, so "it is only a layout" is not a reason to store whatever was sent: an unbounded
 * blob is a way to fill the table, and a shape nothing validates is a way to make the next reader
 * of it crash. Each namespace states what it accepts and anything else is refused.
 */

/** An error carrying the status the route should answer with. */
const fail = (status, message) => Object.assign(new Error(message), { status });

/*
 * The kinds of preference the application keeps, and what each one may hold.
 *
 * The namespace is part of the key rather than a column of its own so a new kind of preference
 * costs no migration - but it is matched against this list, not accepted on sight, so a key the
 * application never writes cannot be used to park arbitrary JSON on the account.
 */
const KEY_PATTERN = /^(table:[a-z0-9-]{1,100}|app:[a-zA-Z][a-zA-Z0-9]{0,40}|tab:[a-zA-Z0-9._-]{1,100})$/;

// A table has columns in the dozens, not the thousands; a layout larger than this is not a layout.
const MAX_COLUMNS = 200;
const MAX_FREEZE = 20;
// Long enough for the widest table's widths, short enough that the column cannot be used as storage.
const MAX_VALUE_BYTES = 8 * 1024;
/*
 * The tables in the application, the screens with tabs, and room for both to grow. Reached only by
 * a client writing keys nothing renders, which is the case this cap exists for: without it, a loop
 * in somebody's console grows this table without limit.
 */
const MAX_KEYS_PER_USER = 400;

const isPlainObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

/** A table's layout: every part optional, because a table saves only the parts that were changed. */
function validateTableLayout(value) {
  if (!isPlainObject(value)) throw fail(400, "A table layout must be an object.");

  const layout = {};
  if (value.columnOrder !== undefined) {
    if (!Array.isArray(value.columnOrder) || value.columnOrder.length > MAX_COLUMNS) {
      throw fail(400, "columnOrder must be a list of column ids.");
    }
    // Ids only, and each one no longer than a column id ever is. A duplicate would make the table
    // draw one column twice and drop another, so the list is deduplicated rather than refused -
    // the reader dragged a column, they did not write this by hand.
    const seen = new Set();
    for (const id of value.columnOrder) {
      if (typeof id !== "string" || !id || id.length > 120) throw fail(400, "columnOrder must contain column ids.");
      seen.add(id);
    }
    layout.columnOrder = [...seen];
  }
  if (value.columnVisibility !== undefined) {
    if (!isPlainObject(value.columnVisibility)) throw fail(400, "columnVisibility must be an object.");
    // Both answers are kept, not just the hidden ones. A table may ship with a column hidden by
    // default, and showing that column is a decision only a stored `true` can carry - dropping it
    // as "the default anyway" would silently refuse to remember half the choices in the dialog.
    layout.columnVisibility = Object.fromEntries(
      Object.entries(value.columnVisibility)
        .slice(0, MAX_COLUMNS)
        .filter(([, shown]) => typeof shown === "boolean")
        .map(([id, shown]) => [String(id).slice(0, 120), shown])
    );
  }
  if (value.freezeCount !== undefined) {
    const count = Number(value.freezeCount);
    if (!Number.isInteger(count) || count < 0 || count > MAX_FREEZE) throw fail(400, "freezeCount must be a small whole number.");
    layout.freezeCount = count;
  }
  if (value.columnSizing !== undefined) {
    if (!isPlainObject(value.columnSizing)) throw fail(400, "columnSizing must be an object.");
    layout.columnSizing = Object.fromEntries(
      Object.entries(value.columnSizing)
        .slice(0, MAX_COLUMNS)
        // A width that is not a finite number would be handed straight to the table's layout, where
        // it draws a column of no width at all and the row cannot be read.
        .filter(([, width]) => Number.isFinite(Number(width)) && Number(width) > 0)
        .map(([id, width]) => [String(id).slice(0, 120), Math.min(Math.round(Number(width)), 2000)])
    );
  }
  return layout;
}

/*
 * The appearances the application wears, mirroring `frontend/src/lib/theme.js`.
 *
 * Kept per login as well as in the browser's own cookie, which is what paints the first frame
 * before any of this is read: the cookie is how the theme arrives instantly, this is how it follows
 * the person to the next machine they sign in on.
 */
const THEMES = ["light", "dark", "enhanced-dark"];

/** The value a key is allowed to carry, normalised, or an error saying why it is not allowed. */
function validateValue(key, value) {
  if (key.startsWith("table:")) return validateTableLayout(value);
  // The one density setting every table follows.
  if (key === "app:compactView") {
    if (typeof value !== "boolean") throw fail(400, "app:compactView must be true or false.");
    return value;
  }
  // Which appearance this login reads in.
  if (key === "app:theme") {
    if (!THEMES.includes(value)) throw fail(400, "app:theme must be one of the application's appearances.");
    return value;
  }
  /*
   * How this login has arranged its own sidebar: the order of the modules and the order within
   * each. Checked against the sidebar's actual structure rather than stored as sent - a layout is
   * an ordering, and may not assert that a screen belongs to a module that does not own it.
   */
  if (key === "app:sidebarLayout") return validateSidebarLayout(value);
  if (key.startsWith("app:")) throw fail(400, `"${key}" is not a preference this application keeps.`);
  // The tab a screen was left on: the label itself, which the screen checks against its own tabs
  // before using - a tab since renamed must fall back rather than filter by a label nothing matches.
  if (typeof value !== "string" || value.length > 120) throw fail(400, "A remembered tab must be a short string.");
  return value;
}

/** The key, checked against the namespaces the application actually writes. */
function validateKey(key) {
  const trimmed = String(key || "").trim();
  if (!KEY_PATTERN.test(trimmed)) throw fail(400, "That is not a preference key this application keeps.");
  return trimmed;
}

/**
 * Every preference this login holds, as one object keyed the way it was saved.
 *
 * One query for the whole session: the alternative is a request behind every table on the screen,
 * which is the same reasoning that put the permission set behind a single fetch.
 */
async function listForUser(userId) {
  const rows = await prisma.userPreference.findMany({
    where: { userId },
    select: { key: true, value: true },
  });
  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}

/**
 * Saves one preference for one login.
 *
 * `userId` is the caller's own, taken from the token by the route - never from the body. There is
 * no route here that writes anybody else's preferences, and nothing in the payload can name a
 * different account.
 */
async function saveForUser(userId, rawKey, rawValue) {
  const key = validateKey(rawKey);
  const value = validateValue(key, rawValue);

  if (JSON.stringify(value ?? null).length > MAX_VALUE_BYTES) {
    throw fail(413, "That layout is too large to save.");
  }

  // Only for a key the account does not already hold: re-saving a table's layout must not be
  // refused because the account is at its limit, or a reader at the cap could never rearrange
  // anything again.
  const existing = await prisma.userPreference.findUnique({
    where: { userId_key: { userId, key } },
    select: { id: true },
  });
  if (!existing && (await prisma.userPreference.count({ where: { userId } })) >= MAX_KEYS_PER_USER) {
    throw fail(409, "This account has saved as many preferences as it can hold.");
  }

  await prisma.userPreference.upsert({
    where: { userId_key: { userId, key } },
    create: { userId, key, value },
    update: { value },
  });
  return { key, value };
}

/** Forgets one preference - the "Reset column order" item, and anything like it added later. */
async function clearForUser(userId, rawKey) {
  const key = validateKey(rawKey);
  // `deleteMany` rather than `delete`: resetting a table that was never saved is not an error, it
  // is the table already being in its natural order.
  await prisma.userPreference.deleteMany({ where: { userId, key } });
  return { key };
}

module.exports = {
  listForUser,
  saveForUser,
  clearForUser,
  // Exported for the tests, which check the validation without a database in front of them.
  validateKey,
  validateValue,
  KEY_PATTERN,
  MAX_VALUE_BYTES,
  MAX_KEYS_PER_USER,
};
