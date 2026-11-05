"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { PageLoader } from "@/components/shared/Loader";
import { AUTH_EXPIRED_EVENT, hasAccessToken } from "@/lib/auth";

/*
 * Signed in. Nothing more.
 *
 * This used to sort people by the legacy `User.role` string and `accessDepartment` as well: an
 * EMPLOYEE on "Technical" was pinned to a Technical dashboard and could reach nothing else, and an
 * EMPLOYEE on any other department was shown a wall saying their access was still being prepared.
 * Neither read the roles a user actually carries, so granting somebody Asset Management widened
 * nothing. Both are gone with that dashboard, and what a person may do is now decided where it is
 * described — the permissions on their roles, checked by `PermissionGuard` and `usePermissions()`
 * on the way in and by the API on every request.
 */
export default function RequireAuth({ children }) {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [authorized, setAuthorized] = useState(false);
  useEffect(() => { const timer = window.setTimeout(() => { const hasToken = hasAccessToken(); setAuthorized(hasToken); setChecking(false); if (!hasToken) router.replace("/login"); }, 0); return () => window.clearTimeout(timer); }, [router]);
  useEffect(() => {
    const handleExpiredSession = () => {
      setAuthorized(false);
      router.replace("/login");
    };
    window.addEventListener(AUTH_EXPIRED_EVENT, handleExpiredSession);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, handleExpiredSession);
  }, [router]);
  // The same full-surface loader every other wait uses, on the plain ground the shell has not been
  // drawn on yet. Size and spacing come from PageLoader, so signing in and then having access
  // checked are one continuous spinner rather than two of different sizes in different places.
  if (checking) return <div className="flex min-h-screen items-center justify-center bg-slate-100"><PageLoader label="Loading workspace..." /></div>;
  if (!authorized) return null;
  return children;
}
