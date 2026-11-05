"use client";

import { useCallback, useEffect, useMemo } from "react";
import { usePermissions } from "@/components/auth/PermissionsProvider";
import { usePreference, usePreferencesReady } from "@/components/preferences/PreferencesProvider";
import { permissionForRoute } from "@/constants/modulePermissions";
import { FAMILY_SIDEBAR_ITEM_ID, familyEntryFor } from "@/constants/rbacSections";
import { SIDEBAR_LAYOUT_KEY, resolveSidebarLayout } from "@/lib/sidebarLayout.mjs";

/**
 * This login's sidebar: the registry, filtered to what they may open, in the order they arranged.
 *
 * The one place the three inputs are brought together, so the hamburger drawer and Settings →
 * User Preference → Sidebar Layout are guaranteed to show the same thing — they are not two
 * implementations agreeing, they are one function called twice. The merge itself is
 * `@/lib/sidebarLayout.mjs`, which is pure and tested; this hook is only where the inputs come
 * from and where the result is saved.
 *
 * Access is decided here and nowhere else in the layout code: a screen is offered only if the
 * permission its **route** answers to is held, which is the same question `RouteGuard` asks when
 * the page is opened directly and the same table both read. Reordering the sidebar is not a way to
 * reach anything; a screen the role may not open is absent from the drawer *and* from the editor.
 */
export default function useSidebarLayout() {
  const { hasPermission, loading } = usePermissions();
  const ready = usePreferencesReady();
  const [stored, setStored, resetStored] = usePreference(SIDEBAR_LAYOUT_KEY, null);

  /*
   * Whether this person may open one screen.
   *
   * An entry with no route of its own is kept — nothing gates it, and none exist in the registry
   * today — while an entry whose route no permission names is treated the way the rest of the
   * application treats it: open to anybody signed in.
   */
  const canSee = useCallback((item) => {
    if (!item?.href) return true;
    /*
     * One row, four screens. Employee Repository is the only entry in the menu for the family it
     * belongs to - the repository itself, the referral register, Users and Roles - so asking only
     * what `/employees` needs would shut the door on a role granted one of the other three and not
     * that one: the screens stay readable by URL and unreachable by navigation. The row is offered
     * if any of them is, and leads to the first the reader may open (see `entry` below).
     */
    if (item.id === FAMILY_SIDEBAR_ITEM_ID) return Boolean(familyEntryFor(hasPermission));
    const permission = permissionForRoute(item.href);
    return permission ? hasPermission(permission.module, permission.feature, "READ") : true;
  }, [hasPermission]);

  /*
   * While the permission set is loading nothing is offered - a nav that shows everything and then
   * takes half of it away reads as a glitch, and this resolves in one fetch. `layout` is still
   * worked out, because the editor needs an order to draw even before it knows what is in it.
   */
  const { groups: resolved, layout, changed } = useMemo(
    () => resolveSidebarLayout(stored, loading ? () => false : canSee),
    [stored, canSee, loading]
  );

  /*
   * Where the family's one row actually leads, for this reader.
   *
   * `/employees` for anybody holding Employee Management, which is nearly everybody who has the
   * row at all; the referral register, or Users, or Roles, for a role granted one of those and not
   * the repository. The label stays **Employee Repository**: it is the name of the group of screens
   * as the application talks about them - the heading on all four reads it - and the switch beside
   * that heading says which one is open.
   */
  const groups = useMemo(() => {
    const entry = loading ? null : familyEntryFor(hasPermission);
    if (!entry || entry === "/employees") return resolved;
    return resolved.map((group) => ({
      ...group,
      items: (group.items || []).map((item) =>
        item.id === FAMILY_SIDEBAR_ITEM_ID ? { ...item, href: entry, activePath: entry } : item),
    }));
  }, [resolved, hasPermission, loading]);

  /*
   * The merged layout, written back so the stored record keeps up with the application.
   *
   * Only when there was already a layout and merging genuinely changed it — a module added to the
   * registry since it was saved, an id that has left. A login that has never arranged anything is
   * deliberately left with nothing stored: it follows the registry's own order, including as that
   * order changes, and writing a row on first sign-in would freeze today's order for them forever.
   *
   * Waits for both answers. Saving a layout worked out before the permissions arrived would store
   * one with nothing appended, and before the server's preferences arrived would store the default
   * over an arrangement this account already has on another machine.
   */
  useEffect(() => {
    if (loading || !ready || !changed) return;
    setStored(layout);
  }, [loading, ready, changed, layout, setStored]);

  return {
    /** What to draw: modules in this person's order, each holding only screens they may open. */
    groups,
    /** The same arrangement as ids — what the editor edits and what is saved. */
    layout,
    /** Nothing is known yet; the drawer draws nothing rather than drawing the wrong thing. */
    loading: loading || !ready,
    /** Saves an arrangement. The server checks it again before it is stored. */
    save: setStored,
    /** Forgets it, so this login follows the application's own order again. */
    reset: resetStored,
    /** Whether anything is stored at all, which is what "Reset to Default" has to undo. */
    customised: Boolean(stored),
  };
}
