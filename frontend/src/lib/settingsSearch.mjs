import { matchesWordChunks, wordChunks } from "./wordChunks.mjs";

/**
 * Search in Settings - Role Management's search (`admin/RoleDialog.searchModule`) applied to the
 * Settings rail: the same Word Chunk Search (every word typed, any order, ignoring case and stray
 * spaces), over every screen the reader may open.
 *
 * A screen is found by its own name, the names of the groups it sits in (User Settings → WhatsApp),
 * its help text (`constants/settingsHelp`), and the labels of the settings on it (`SETTINGS_FIELDS`)
 * - so "phone number" finds Exclude Phone Numbers and "messages a day" finds WhatsApp's usage limit.
 * A label that matches by itself is its own result, so the reader is taken to that setting and it is
 * pointed out; the screen it is on is listed once more only when the screen matches in its own right.
 *
 * Only what the rail already holds is searched: a screen the reader's permissions leave out of the
 * rail is never offered, and nothing here asks the server anything.
 */

/**
 * The settings on each screen, by the label they show - what a search for one setting finds. Only
 * labels the screen actually draws: a result takes the reader there and points at the label.
 */
export const SETTINGS_FIELDS = Object.freeze({
  whatsapp: ["WhatsApp chat", "Usage limits", "Different clients an hour", "Messages an hour", "Messages a day"],
  "employee-referral": ["Referral amount", "Number of instalments"],
  "employee-payroll-rules": ["A day's pay is the base salary over", "Round the net salary to", "Payslip generation"],
  "application-monitoring": ["Usage Timeout (minutes)"],
  holidays: ["Holiday applies to", "Show holidays for"],
  "studio-branding": ["Global Name", "Login Credential Name", "Global Logo — Light Mode", "Global Logo — Dark Mode", "Favicon — Light Mode", "Favicon — Dark Mode"],
  "quotation-general": ["Allow Client Download", "PDF Content", "PDF Image"],
});

/** Every screen in rail entries `[id, label, children?, disabled?]`, with the groups it sits in. */
function screens(entries, path = []) {
  return (entries || []).flatMap(([id, label, children, disabled]) => (children?.length
    ? screens(children, [...path, label])
    : disabled ? [] : [{ id, label, path }]));
}

/**
 * The results of a search over the rail: `{ key, id, title, path, field }` - `field` set when a
 * setting on the screen is what matched - most direct first: a screen named for what was typed, then
 * a setting, then a screen found by its help text. Each once. No search, no results.
 */
export function searchSettings(rail, query, helpFor = () => "") {
  if (!wordChunks(query).length) return [];
  const named = [];
  const fields = [];
  const described = [];
  for (const screen of screens(rail)) {
    const where = { id: screen.id, title: screen.label, path: screen.path.join(" › ") };
    if (matchesWordChunks([...screen.path, screen.label].join("\n"), query)) named.push({ ...where, key: screen.id, field: null });
    for (const field of SETTINGS_FIELDS[screen.id] || []) {
      if (matchesWordChunks(`${field}\n${screen.label}`, query) && !matchesWordChunks(screen.label, query)) fields.push({ ...where, key: `${screen.id}|${field}`, field });
    }
    if (!named.some((result) => result.id === screen.id) && matchesWordChunks([...screen.path, screen.label, helpFor(screen.id) || ""].join("\n"), query)) described.push({ ...where, key: screen.id, field: null });
  }
  const seen = new Set();
  return [...named, ...fields, ...described].filter((result) => !seen.has(result.key) && seen.add(result.key));
}
