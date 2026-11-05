"use client";

import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { permissionForRoute } from "@/constants/modulePermissions";
import { getUserPermissions } from "@/services/iam/iam.service";

// One fetch for the whole signed-in session. Every PermissionGuard and every usePermissions() call
// reads from this context - asking the API per guard would put one request behind every button on
// the screen.
const PermissionsContext = createContext(null);

// DISABLED is stored as a row like any other, so it has to rank below READ rather than be absent.
const LEVELS = { DISABLED: 0, READ: 1, READ_WRITE: 2 };

// A permission set that failed to load is not a permission set of none: it closes every guard on
// the screen, and the person is told they lack access when the truth is that nothing was fetched.
// A backend restart is enough to cause it, so the fetch retries a few times before giving up, and
// `error` is kept so callers can say which of the two happened.
const RETRIES = 3;
const RETRY_DELAY_MS = 1500;

export default function PermissionsProvider({ children }) {
  const [permissions, setPermissions] = useState([]);
  // The server's answer to "is this login an administrator" - a Super Admin, or a role with the
  // Administrator tick - for the screens that are administrators' alone. False until it says so.
  const [isAdministrator, setIsAdministrator] = useState(false);
  // Narrower: a Super Admin of either kind (`isSuperAdmin` in the backend's services/administrator),
  // for the few things kept for Super Admins alone. False until the server says so.
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // Bumping this re-runs the effect below. Callers get `reload` rather than an async loader so the
  // fetch stays inside the effect, where it can be cancelled and where its setState calls land in
  // promise callbacks instead of running synchronously on mount.
  const [reloadToken, setReloadToken] = useState(0);

  // Called from a Retry control, never from an effect, so raising `loading` here is safe - doing
  // it inside the effect below would be a synchronous setState on mount.
  const reload = useCallback(() => {
    setLoading(true);
    setReloadToken((token) => token + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer;

    const attempt = (remaining) => {
      getUserPermissions()
        .then((data) => {
          if (cancelled) return;
          setPermissions(data?.permissions ?? []);
          setIsAdministrator(data?.isAdministrator === true);
          setIsSuperAdmin(data?.isSuperAdmin === true);
          setError(null);
          setLoading(false);
        })
        .catch((cause) => {
          if (cancelled) return;
          // A transient failure - the API restarting is the common one - should not settle into a
          // session where everything is hidden, so it is retried before being reported.
          if (remaining > 0) {
            timer = window.setTimeout(() => attempt(remaining - 1), RETRY_DELAY_MS);
            return;
          }
          setPermissions([]);
          setIsAdministrator(false);
          setError(cause);
          setLoading(false);
        });
    };

    attempt(RETRIES);

    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [reloadToken]);

  const value = useMemo(() => {
    const has = (module, feature, level = "READ") => {
      const match = permissions.find((permission) => permission.module === module && permission.feature === feature);
      if (!match) return false;
      return (LEVELS[match.accessLevel] ?? 0) >= (LEVELS[level] ?? 0) && match.accessLevel !== "DISABLED";
    };
    return {
      permissions,
      isAdministrator,
      isSuperAdmin,
      loading,
      // Set only when the permission set could not be fetched at all. Anything reading this to
      // decide what to show must not treat it as "no access".
      error,
      reload,
      hasPermission: has,
      hasAllPermissions: (required = []) => required.every((entry) => has(entry.module, entry.feature, entry.level)),
      hasAnyPermission: (required = []) => required.some((entry) => has(entry.module, entry.feature, entry.level)),
    };
  }, [error, isAdministrator, isSuperAdmin, loading, permissions, reload]);

  return <PermissionsContext.Provider value={value}>{children}</PermissionsContext.Provider>;
}

export function usePermissions() {
  const context = useContext(PermissionsContext);
  if (!context) throw new Error("usePermissions must be used inside PermissionsProvider.");
  return context;
}

/**
 * What a screen may do with one permission, as the two questions a screen actually asks.
 *
 * `canWrite` is the one that shapes the page: READ alone means the records are readable and every
 * control that changes them is absent - no Add, no Edit, no Delete - rather than present and
 * refused. `loading` is passed through so a page can wait instead of drawing its read-only state
 * for a beat and then filling in the buttons.
 */
export function useModuleAccess(module, feature) {
  const { hasPermission, loading, error } = usePermissions();
  return useMemo(() => ({
    canRead: hasPermission(module, feature, "READ"),
    canWrite: hasPermission(module, feature, "READ_WRITE"),
    loading,
    error,
  }), [error, feature, hasPermission, loading, module]);
}

/**
 * The same, for whichever permission governs the page currently open.
 *
 * Pages use this rather than naming their own module and feature, so a screen cannot drift out of
 * step with the route map that the sidebar and the route guard read. `permission` is null on a page
 * no permission names, and `canWrite` is true there - an ungoverned screen is not a locked one.
 */
export function useRouteAccess() {
  const pathname = usePathname();
  const permission = permissionForRoute(pathname);
  const { hasPermission, loading, error } = usePermissions();
  return useMemo(() => ({
    permission,
    canRead: permission ? hasPermission(permission.module, permission.feature, "READ") : true,
    canWrite: permission ? hasPermission(permission.module, permission.feature, "READ_WRITE") : true,
    loading,
    error,
  }), [error, hasPermission, loading, permission]);
}
