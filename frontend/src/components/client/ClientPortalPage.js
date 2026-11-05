"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import LogoutRounded from "@mui/icons-material/LogoutRounded";
import AppLogo from "@/components/shared/AppLogo";
import Button from "@/components/shared/Button";
import { CardState } from "@/components/shared/DashboardCard";
import { PageLoader } from "@/components/shared/Loader";
import ProjectTracker from "@/components/shared/ProjectTracker";
import ClientCrdCard from "./ClientCrdCard";
import { useClientCurtain } from "./ClientCurtain";
import { CLIENT_LOGIN_ROUTE, clearAccessToken, getAuthenticatedUser, getDefaultAuthenticatedRoute, handOffToClientWeb, isClientAccount } from "@/lib/auth";
import { getClientProject } from "@/services/client/portal.service";

/**
 * Where a client's sign-in lands (Create Project → Client Credentials).
 *
 * Outside the studio's shell, and built for the phone the login message is opened on: the studio's
 * mark with the way out beside it, where the project stands (`ProjectTracker`) straight under it -
 * no welcome card in between, the project is what the client came for - and, with the Pre
 * Production stage's sheet, the CRD document waiting on the client (`ClientCrdCard`) for a project
 * that needs one: the CRD is part of planning the shoots. The project is read from the client
 * portal's own endpoint, which finds it from the account and sends only what a client may see; the
 * API refuses a client token everything else (`protect`). There is no password change - a client
 * keeps the password the studio gave them.
 *
 * Anybody else who opens it is sent where they belong - a studio account to its landing screen,
 * nobody signed in to the client sign-in (`/client/login`).
 */
// Where the fixed bar ends: clear of a phone's notch, its 2.5rem row, its 0.75rem foot and its border.
const BAR_HEIGHT = "calc(max(0.75rem, env(safe-area-inset-top)) + 3.25rem + 1px)";

export default function ClientPortalPage() {
  const router = useRouter();
  const { cover, reveal } = useClientCurtain();
  const [user, setUser] = useState(null);
  const [project, setProject] = useState({ loading: true, data: null, error: "" });

  const loadProject = useCallback(async () => {
    setProject((current) => ({ ...current, loading: true, error: "" }));
    try {
      const response = await getClientProject();
      setProject({ loading: false, data: response?.data || null, error: "" });
    } catch (error) {
      // A login switched off (or its project deleted): the token is already cleared, so back to the
      // client's own sign-in rather than a Try again that cannot work.
      if (error.status === 401) { router.replace(CLIENT_LOGIN_ROUTE); return; }
      setProject({ loading: false, data: null, error: error.message || "We could not load your project. Please try again." });
    }
  }, [router]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const signedIn = getAuthenticatedUser();
      if (!signedIn) { router.replace(CLIENT_LOGIN_ROUTE); return; }
      if (!isClientAccount(signedIn)) { router.replace(getDefaultAuthenticatedRoute()); return; }
      // The studio runs the client website: the client continues there, signed in.
      if (handOffToClientWeb()) return;
      setUser(signedIn);
      void loadProject();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [router, loadProject]);

  // Arrived from the sign-in behind the curtain: drawn off once there is something to show - the
  // project, or what went wrong - so the client never watches it load.
  useEffect(() => {
    if (user && !project.loading) reveal();
  }, [user, project.loading, reveal]);

  // Back to the client's own sign-in, which is where their message's link takes them too - under
  // the same curtain the way in came by.
  const signOut = async () => { await cover(); clearAccessToken(); router.replace(CLIENT_LOGIN_ROUTE); };

  if (!user) return <div className="flex min-h-screen items-center justify-center bg-[color-mix(in_srgb,var(--client-sand)_22%,white)]"><PageLoader label="Loading..." /></div>;

  /*
   * Kept clear of a phone's notch and home bar, as the sign-in before it is. A warm ground - the
   * sand, faint, deepening a touch toward the top - under white cards.
   */
  return <main className="min-h-[100dvh] overflow-x-hidden bg-[linear-gradient(180deg,color-mix(in_srgb,var(--client-sand)_42%,white)_0%,color-mix(in_srgb,var(--client-sand)_14%,white)_420px)] pb-[max(2.5rem,env(safe-area-inset-bottom))] sm:pb-16">
    {/*
      The studio's mark and the way out, held at the top of the screen as the project scrolls
      beneath - on a translucent band of the page's own sand, blurred, so what passes under it reads
      as being under it. Clear of a phone's notch. Fixed rather than sticky: the application's body
      is a scroll box of its own (`overflow-y: auto`), which a sticky bar would stick to instead of
      the screen. The content below starts beneath it by the bar's own height.
    */}
    <header className="fixed inset-x-0 top-0 z-40 border-b border-[color-mix(in_srgb,var(--client-sand)_55%,transparent)] bg-[color-mix(in_srgb,color-mix(in_srgb,var(--client-sand)_38%,white)_82%,transparent)] pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur-md">
      <div className="mx-auto flex h-10 w-full max-w-lg items-center justify-between gap-3 px-4 md:max-w-3xl">
        <AppLogo variant="navbar" priority />
        {/*
          The way out: on a phone just its gold disc and arrow, the words kept for a screen reader;
          from `sm` up, a deep ink pill with the disc and "Sign out" - the CRD card's colours.
        */}
        <Button type="button" variant="plain" size="none" className="group min-h-10 shrink-0 rounded-full !font-semibold text-[var(--client-sand)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--client-primary)] focus-visible:ring-offset-2 sm:gap-2 sm:bg-[var(--client-ink)] sm:py-1 sm:pl-1 sm:pr-4 sm:shadow-[0_8px_18px_-10px_rgba(46,36,25,0.8)] sm:hover:bg-[var(--client-earth)]" onClick={signOut}>
          <span aria-hidden="true" className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--client-primary)] text-[var(--client-ink)] shadow-[0_8px_18px_-10px_rgba(46,36,25,0.8)] motion-safe:transition-transform sm:h-8 sm:w-8 sm:shadow-none motion-safe:sm:group-hover:translate-x-0.5"><LogoutRounded className="!text-[19px] sm:!text-[17px]" /></span>
          <span className="sr-only sm:not-sr-only">Sign out</span>
        </Button>
      </div>
    </header>
    <div className="mx-auto w-full max-w-lg space-y-7 px-4 pt-[calc(5.5rem+env(safe-area-inset-top))] sm:pt-[calc(6rem+env(safe-area-inset-top))] md:max-w-3xl">
      {/* The page's heading, for a screen reader: the stages below say the rest. */}
      <h1 className="sr-only">Your project</h1>
      {project.data
        ? <ProjectTracker tracking={project.data} pinTop={BAR_HEIGHT} stageCards={{ PRE_PRODUCTION: <ClientCrdCard crd={project.data.crdDocument} /> }} />
        : <CardState loading={project.loading} error={project.error} onRetry={() => void loadProject()} rows={6} />}
    </div>
  </main>;
}
