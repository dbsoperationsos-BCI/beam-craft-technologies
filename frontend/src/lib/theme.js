/**
 * Which of the three appearances the app is wearing.
 *
 * The palette itself lives in `globals.css`, keyed on `[data-theme]` on the document element.
 * That is what makes this possible without touching a single component: the shared controls keep
 * their Tailwind classes, and the stylesheet remaps what those classes paint once a theme is set.
 *
 * Three tiers rather than two, because the middle one is what most people asking for "dark mode"
 * in an app they read all day actually want: panels lifted off a dim ground rather than a black
 * screen, so a table of leads is still comfortable to scan.
 */

/*
 * Listed light to darkest, which is the order the picker offers them in.
 *
 * "Dark" is the everyday one - panels lifted off a dim ground, which is what most people reading
 * a table of leads all day actually want. "Enhanced Dark" is the deeper tier for a dim room. The
 * keys match the names so the stylesheet reads the same way the menu does.
 */
export const THEMES = ["light", "dark", "enhanced-dark"];

export const THEME_LABELS = {
  light: "Light Mode",
  dark: "Dark Mode",
  "enhanced-dark": "Enhanced Dark Mode",
};

export const DEFAULT_THEME = "light";

/*
 * The cookie the choice is kept in.
 *
 * A cookie rather than localStorage, because the server has to be able to read it: the root
 * layout writes `data-theme` into the HTML it sends, so the right palette is painted on the first
 * frame instead of appearing after hydration. localStorage is invisible to the server, which is
 * why a theme kept there needs a bootstrap script and still risks a flash.
 *
 * Not a secret and not a session: `SameSite=Lax` and a year, so it survives a browser restart and
 * is not sent on cross-site requests.
 */
export const THEME_STORAGE_KEY = "dbs_theme";
const THEME_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function isTheme(value) {
  return THEMES.includes(String(value || ""));
}

/**
 * The theme this browser last chose.
 *
 * Falls back to light rather than to the operating system's preference: this is a tool people use
 * at a desk all day beside other studio software, and following the OS would flip the whole CRM
 * at sunset for anyone on an automatic schedule. The choice made here is the choice that stands.
 */
export function readStoredTheme() {
  if (typeof document === "undefined") return DEFAULT_THEME;
  // The attribute is the truth once the page is up - the server already put the saved theme
  // there - so it is read back rather than parsing the cookie a second time.
  const applied = document.documentElement.getAttribute("data-theme");
  return isTheme(applied) ? applied : DEFAULT_THEME;
}

/**
 * Paints the theme and remembers it.
 *
 * Written to the document element rather than to a React context, because the stylesheet is what
 * does the work - and because portalled menus, dialogs and the snackbar render outside the app
 * tree entirely. An attribute on `<html>` reaches all of them; a provider would not.
 */
/**
 * Repaints in one step instead of animating.
 *
 * Almost every control in the module carries a `transition` for its hover state, so changing the
 * theme set hundreds of colour animations running at once - the page washed from one palette to
 * the other over a few hundred milliseconds, which reads as the app lagging rather than as a
 * setting being applied. Transitions are switched off for the swap and restored on the next
 * frame, so hover still animates afterwards and the theme itself lands instantly.
 */
function repaintWithoutTransitions(paint) {
  const root = document.documentElement;
  root.classList.add("theme-switching");
  paint();
  // Reading a layout value forces the browser to apply both the class and the new palette in this
  // frame; without it the class could be added and removed before anything was recalculated.
  void root.offsetHeight;
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => root.classList.remove("theme-switching"));
  });
}

export function applyTheme(theme) {
  const next = isTheme(theme) ? theme : DEFAULT_THEME;
  if (typeof document === "undefined") return next;

  // Painted immediately, so the change is instant rather than waiting on a round trip.
  repaintWithoutTransitions(() => document.documentElement.setAttribute("data-theme", next));
  try {
    document.cookie = `${THEME_STORAGE_KEY}=${next}; path=/; max-age=${THEME_COOKIE_MAX_AGE}; samesite=lax`;
  } catch {
    // The theme still applies for this visit; it just will not be remembered.
  }
  return next;
}
