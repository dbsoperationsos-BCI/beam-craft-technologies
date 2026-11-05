"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import Button from "@/components/shared/Button";
import { PageLoader } from "@/components/shared/Loader";
import { usePermissions, useRouteAccess } from "@/components/auth/PermissionsProvider";
import { firstPermittedRoute } from "@/constants/modulePermissions";
import { getDefaultAuthenticatedRoute } from "@/lib/auth";

/**
 * Closes every signed-in page the viewer's roles do not reach.
 *
 * Mounted once around the whole `(app)` group rather than repeated per page, so a screen added to
 * the route map is guarded the moment it is added and a screen added to the nav cannot quietly
 * arrive unguarded. A page no permission names is left open - `useRouteAccess` answers `canRead`
 * true there - so this narrows what is described, and never guesses at what is not.
 *
 * It guards the interface only. The API refuses the same request on its own, which is what actually
 * protects the data; hiding a page it would refuse just stops the app asking.
 */
export default function RouteGuard({ children }) {
  const { canRead, permission, loading, error } = useRouteAccess();
  const { hasPermission, reload } = usePermissions();
  const pathname = usePathname();
  const router = useRouter();

  /*
   * Signing in lands everybody on one route, and not everybody can open it. Where the app chose the
   * destination rather than the person, a refusal is the wrong answer - it strands somebody on a
   * page they never asked for. So the landing route alone resolves forward to the first screen
   * their roles do reach.
   *
   * Only the landing route. A page reached by typing its address, or by a link, was asked for
   * deliberately, and the honest answer there is that it is not theirs to open.
   */
  const isLanding = pathname === getDefaultAuthenticatedRoute();
  const forwardTo = !loading && !error && !canRead && isLanding ? firstPermittedRoute(hasPermission) : null;

  useEffect(() => {
    if (forwardTo) router.replace(forwardTo);
  }, [forwardTo, router]);

  // Nothing until the permission set is in. Drawing the page and pulling it away a beat later is
  // worse than a moment of nothing, and drawing the refusal first is worse still - it tells people
  // they lack access they hold.
  if (loading) return <PageLoader label="Checking access..." />;

  // A permission set that could not be fetched is not a permission set of none. Saying "no access"
  // when the API was merely unreachable sends people to ask for access they already have.
  if (error) return <section className="flex h-full min-h-[60vh] w-full flex-1 items-center justify-center p-6">
    <div className="max-w-sm text-center">
      <p className="text-sm leading-6 text-slate-700">Your permissions could not be loaded, so this page cannot tell what you are allowed to see.</p>
      <p className="mt-1 text-xs text-slate-500">{error.message}</p>
      <Button className="mt-3" variant="primary" onClick={reload}>Try again</Button>
    </div>
  </section>;

  // Being forwarded: render nothing rather than the refusal, which would show for a frame and then
  // be replaced by the screen they are actually allowed.
  if (forwardTo) return null;

  if (!canRead) return <section className="flex min-h-64 flex-1 items-center justify-center p-6">
    <div className="max-w-sm text-center">
      {isLanding
        // No permitted route to forward to, so this is somebody whose account carries no role yet
        // rather than somebody who opened the wrong page.
        ? <>
          <p className="text-sm leading-6 text-slate-700">Your account does not have access to any screens yet.</p>
          <p className="mt-1 text-xs text-slate-500">Ask an administrator to assign you a role.</p>
        </>
        : <>
          <p className="text-sm leading-6 text-slate-700">You do not have access to this page.</p>
          <p className="mt-1 text-xs text-slate-500">Ask an administrator for {permission.feature} access under {permission.module}.</p>
        </>}
    </div>
  </section>;

  return children;
}
