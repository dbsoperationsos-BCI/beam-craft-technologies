/**
 * Where My Profile goes back to.
 *
 * The page somebody was on when they chose My Profile, remembered at that moment rather than read
 * from history: `router.back()` undoes whatever the last navigation was, which after a reload or a
 * direct visit is not the page they came from. Session storage, so it lasts the tab and no longer.
 */
const KEY = "dbs.profile.returnTo";

export function rememberProfileReturnTo(pathname) {
  if (typeof window === "undefined" || !pathname || pathname === "/profile") return;
  window.sessionStorage.setItem(KEY, pathname);
}

/** The remembered page, or null when My Profile was opened with no page before it. */
export function profileReturnTo() {
  if (typeof window === "undefined") return null;
  return window.sessionStorage.getItem(KEY) || null;
}
