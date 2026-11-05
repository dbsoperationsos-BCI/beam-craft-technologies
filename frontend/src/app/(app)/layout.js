import { cookies } from "next/headers";
import AppShell from "@/components/app-shell/AppShell";
import PermissionsProvider from "@/components/auth/PermissionsProvider";
import PreferencesProvider from "@/components/preferences/PreferencesProvider";
import RequireAuth from "@/components/auth/RequireAuth";
import RouteGuard from "@/components/auth/RouteGuard";
import { DEFAULT_THEME, THEME_STORAGE_KEY, isTheme } from "@/lib/theme";

/*
 * The theme is read here as well as in the root layout, and handed to the shell.
 *
 * The root layout puts it on `<html>`, which is what paints the page correctly from the first
 * frame. This second read is for the *label* on the appearance pill: without it the menu had to
 * start on "Light Mode" and correct itself after hydration, so every load of a dark page showed
 * the wrong name for a moment. Reading a cookie is cheap, and the alternative is a visible glitch.
 *
 * `PermissionsProvider` sits inside RequireAuth and outside the shell: it fetches the signed-in
 * user's permissions once for the session, so it cannot run before there is a session, and every
 * `PermissionGuard` and `usePermissions()` call under the shell reads from it. It is mounted only
 * here — without it those calls throw rather than degrading to "no access".
 *
 * `PreferencesProvider` sits beside it for the same reason: it fetches how this login has arranged
 * the application - column order, hidden and frozen columns, column widths, density, remembered
 * tabs - once for the session, so a layout follows the person to whatever machine they sign in on
 * instead of living in one browser. It is inside `RequireAuth` because the preferences belong to an
 * account; the public pages outside this group fall back to component state.
 *
 * `RouteGuard` sits inside the shell rather than around it, so a page the viewer cannot open still
 * arrives with the nav and the topbar around the refusal - they are told what is missing and can
 * go somewhere else, instead of landing on a bare page with no way out.
 */
export default async function ApplicationLayout({ children }) {
  const stored = (await cookies()).get(THEME_STORAGE_KEY)?.value;
  const theme = isTheme(stored) ? stored : DEFAULT_THEME;

  return <RequireAuth><PermissionsProvider><PreferencesProvider><AppShell theme={theme}><RouteGuard>{children}</RouteGuard></AppShell></PreferencesProvider></PermissionsProvider></RequireAuth>;
}
