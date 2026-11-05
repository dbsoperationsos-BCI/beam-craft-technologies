"use client";

import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import Brightness6 from "@mui/icons-material/Brightness6";
import DarkMode from "@mui/icons-material/DarkMode";
import LightMode from "@mui/icons-material/LightMode";
import { clearAccessToken, getAuthenticatedUser } from "@/lib/auth";
import { brandNameFor } from "@/components/shared/BrandFallbackLogo";
import EmployeeAvatar from "@/components/shared/EmployeeAvatar";
import IconButton from "@/components/shared/IconButton";
import AppLogo from "@/components/shared/AppLogo";
import useStudioBranding from "@/components/shared/useStudioBranding";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import OptionsMenu from "@/components/ui/OptionsMenu";
import SettingsOverlay from "@/components/settings/SettingsOverlay";
import AppNotifications from "@/components/app-shell/AppNotifications";
import ChevronIcon from "@/components/ui/ChevronIcon";
// A calendar rather than a group of people: the button opens the studio's diary, and a schedule is
// what it is about. The group icon read as a people directory, which is a different screen.
import CalendarMonthRoundedIcon from "@mui/icons-material/CalendarMonthRounded";
import { usePermissions } from "@/components/auth/PermissionsProvider";
import { firstPermittedRoute } from "@/constants/modulePermissions";
import { meetingsToggle } from "@/lib/meetingsToggle";
import ReleaseInfoDialog from "@/components/app-shell/ReleaseInfoDialog";
import MenuRoundedIcon from "@mui/icons-material/MenuRounded";
import { PROFILE_PHOTO_CHANGED_EVENT } from "@/lib/profilePhoto";
import { getMyProfile } from "@/services/user/profile.service";
import { rememberProfileReturnTo } from "@/lib/profileReturn";
import { THEMES, THEME_LABELS } from "@/lib/theme";
import useThemePreference from "@/components/preferences/useThemePreference";
import { announceTableSettingsSaved, OPEN_GLOBAL_SETTINGS_EVENT } from "@/lib/globalSettings";


/*
 * The sun, the half-lit sun and the moon, one per appearance — Material glyphs, so the same row
 * shows the same shape on every operating system.
 */
function ThemeIcon({ theme }) {
  const common = { style: { fontSize: 16 }, className: "shrink-0", "aria-hidden": true };
  // The moon belongs to the deepest tier, not to the everyday one.
  if (theme === "enhanced-dark") return <DarkMode {...common} />;
  // A sun with one half filled, which is what the everyday dark tier is: panels lifted off a
  // dim ground rather than a black screen.
  if (theme === "dark") return <Brightness6 {...common} />;
  return <LightMode {...common} />;
}

export default function AppTopbar({ theme, sidebarOpen, onMenuClick }) {
  const router = useRouter();
  const pathname = usePathname();
  const { hasPermission } = usePermissions();
  // The Global Name from Settings, written beside the mark so the bar says whose OS this is. Left
  // empty there, nothing is written at all - the studio's name is the studio's to give.
  const branding = useStudioBranding();
  const brandName = brandNameFor(branding);
  /*
   * The screen the meetings icon was pressed from, so pressing it again goes back there.
   *
   * Held here rather than derived from history: `router.back()` would undo whatever the last
   * navigation happened to be, which after a few clicks inside the meetings screen is not the page
   * somebody opened it from. This is the page they were on, remembered at the moment they left it.
   *
   * It survives navigation because the bar belongs to the app shell, which the router keeps mounted
   * across pages - only the content below it is replaced.
   */
  const [meetingsReturnTo, setMeetingsReturnTo] = useState(null);
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const [adminSettingsOpen, setAdminSettingsOpen] = useState(false);
  const [settingsInitialSection, setSettingsInitialSection] = useState("whatsapp");
  const [settingsInitialIntegration, setSettingsInitialIntegration] = useState(null);
  const [settingsInitialNotice, setSettingsInitialNotice] = useState(null);
  const [settingsSession, setSettingsSession] = useState(0);
  const [releaseOpen, setReleaseOpen] = useState(false);
  const [user, setUser] = useState(null);
  /*
   * The appearance now lives inside this menu rather than in a pill of its own on the bar.
   *
   * The theme is handed down from the layout, which read it from the cookie on the server, so the
   * right mode is already ticked on the first render with nothing to reconcile. From there the
   * shared hook takes over: it saves the choice to the account, so it follows this person to their
   * other machines. This menu is the only place the appearance is chosen; the hook exists so the
   * cookie and the account are reconciled on every load rather than only when it is changed.
   */
  const { theme: appearance, setTheme: setAppearance } = useThemePreference(theme);

  useEffect(() => {
    const timer = window.setTimeout(() => setUser(getAuthenticatedUser()), 0);
    return () => window.clearTimeout(timer);
  }, []);

  /*
   * The face beside the name. The access token names the person but carries no photo, so the
   * profile is read once the token is known: the linked employee's photo from the Employee
   * Repository where there is one, otherwise the photograph the login keeps on My Profile, and
   * initials in a circle until either exists. My Profile announces a change, so the bar follows
   * it at once. A failed read leaves the initials - the bar must never wait on this.
   */
  const [photoUrl, setPhotoUrl] = useState(null);
  // The username as the account holds it now, read with the photo; the token's copy stands in
  // until it arrives, or for good when the read fails.
  const [username, setUsername] = useState(null);
  useEffect(() => {
    if (!user) return undefined;
    let cancelled = false;
    getMyProfile()
      .then((response) => {
        if (cancelled) return;
        setPhotoUrl(response?.data?.profilePhotoUrl || null);
        setUsername(response?.data?.username || null);
      })
      .catch(() => {});
    const follow = (event) => setPhotoUrl(event.detail?.photoUrl || null);
    window.addEventListener(PROFILE_PHOTO_CHANGED_EVENT, follow);
    return () => { cancelled = true; window.removeEventListener(PROFILE_PHOTO_CHANGED_EVENT, follow); };
  }, [user]);

  useEffect(() => {
    const openSettings = (event) => {
      const detail = event.detail || {};
      setSettingsInitialSection(detail.section || "whatsapp");
      setSettingsInitialIntegration(detail.integration || null);
      setSettingsInitialNotice(detail.notice || null);
      setSettingsSession((current) => current + 1);
      setAdminSettingsOpen(true);
    };
    window.addEventListener(OPEN_GLOBAL_SETTINGS_EVENT, openSettings);
    return () => window.removeEventListener(OPEN_GLOBAL_SETTINGS_EVENT, openSettings);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const googleStatus = params.get("google");
    if (googleStatus !== "connected" && googleStatus !== "error") return;

    const timer = window.setTimeout(() => {
      /*
       * Which integration panel the flow left from, and which Settings section it sits in. Both are
       * noted before the consent redirect: the callback returns to one fixed URL per flow, so without
       * them a flow started from Google Meet came back on Google Sheets, and one started from
       * Integrations → Interview came back on Sales.
       */
      const integration = window.sessionStorage.getItem("dbs_google_oauth_return") || "google-sheets";
      const section = window.sessionStorage.getItem("dbs_google_oauth_return_section") || "integration";
      window.sessionStorage.removeItem("dbs_google_oauth_return");
      window.sessionStorage.removeItem("dbs_google_oauth_return_section");
      setSettingsInitialSection(section);
      setSettingsInitialIntegration(integration);
      setSettingsInitialNotice({
        tone: googleStatus === "connected" ? "success" : "error",
        message: googleStatus === "connected"
          ? "Google account connected successfully."
          : params.get("message") || "Google OAuth failed.",
      });
      setSettingsSession((current) => current + 1);
      setAdminSettingsOpen(true);

      const nextUrl = new URL(window.location.href);
      nextUrl.searchParams.delete("google");
      nextUrl.searchParams.delete("message");
      window.history.replaceState({}, "", `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [pathname]);
  // The person's name, as the access token carries it - the email only where a login has no name,
  // and the role as a last resort for a token that has neither.
  // The username, generated with the login credentials, is the identity the bar shows - not the
  // employee's name, which HR maintains and My Profile states. A login made before usernames
  // existed falls to the name the token carries, then the email, then the role.
  const displayName = username || user?.username || user?.name || user?.email || (user?.role === "EMPLOYEE" ? "Employee" : "Super Admin");

  const meetingsPath = "/sales/meetings";
  const meetingsOpen = pathname === meetingsPath;

  /*
   * Open, or close and go back.
   *
   * It only pushed before, so a second press on a control that looked pressed did nothing at all -
   * the one thing a toggle must not do. Landing straight on the meetings screen leaves nothing to
   * go back to, so closing then falls to the first screen this role may open, which is where the
   * application sends somebody with nowhere else to be.
   */
  function toggleMeetings() {
    const next = meetingsToggle({
      open: meetingsOpen,
      pathname,
      returnTo: meetingsReturnTo,
      meetings: meetingsPath,
      fallback: firstPermittedRoute(hasPermission) || "/sales/crm",
    });
    setMeetingsReturnTo(next.returnTo);
    router.push(next.href);
  }

  function logout() {
    clearAccessToken();
    router.replace("/login");
  }

  return <>
    {/* `app-topbar` is the hook globals.css uses for the dark theme, so the class stays on the
        header even though the bar itself is Tailwind. */}
    <header data-app-topbar="true" className="app-topbar sticky top-0 z-[50] flex h-12 min-w-0 items-center gap-1 border-b border-slate-200 bg-white/95 px-2 backdrop-blur sm:gap-3">
      {/*
        The menu and the mark, as one group.

        The bar's own `sm:gap-3` is what separates the bar's three concerns - navigation, identity,
        the user's controls - and it was landing between these two as well, sitting the logo well
        clear of the hamburger. Grouping them puts the gap around the pair instead of inside it, so
        the two read as one control cluster without a negative margin fighting the gap.
      */}
      <div className="flex shrink-0 items-center">
        {/* The Material icon rather than the "☰" character: a glyph is drawn by whatever font the
            viewer's system supplies, so it sat at a different weight and baseline per platform -
            the same reason the theme icons here are paths. */}
        {/* `data-sidebar-toggle` is how the drawer's own outside-press handler tells this button
            apart from the rest of the bar. Every other control on the bar closes the drawer when it
            is pressed; this one toggles, and closing it first would reopen it. */}
        <IconButton data-sidebar-toggle="true" label={sidebarOpen ? "Close navigation" : "Open navigation"} size="sm" onClick={onMenuClick} className="text-slate-600 hover:bg-slate-100"><MenuRoundedIcon fontSize="small" aria-hidden="true" /></IconButton>
        {/*
          The studio's mark, where the product name used to be, and the sidebar's header no longer
          carries it: one logo on screen rather than two, and it is on the bar that is present on
          every screen instead of behind a drawer that has to be opened to be seen.

          Home is whatever the signed-in role may actually open. The sidebar sent everyone to
          /hrm/departments, which is a page most roles cannot read, so the mark now leads to the
          same first permitted route the rest of the bar falls back to.
        */}
        <Link href={firstPermittedRoute(hasPermission) || "/sales/crm"} aria-label="DBS Operations OS home" className="app-logo shrink-0 rounded-md py-1 pl-0.5 pr-1">
          <AppLogo variant="navbar" priority />
        </Link>
        {/* The Global Name, to the right of the mark and level with its centre, in Montserrat, the
            studio's face, at 14px, in the bar's own text colour so it reads in every theme.
            Hidden on a phone, where the bar has no room for it beside the controls on the right. */}
        {brandName && <span className="ml-2.5 hidden max-w-[16rem] truncate font-[family-name:var(--font-montserrat)] text-sm font-normal text-slate-700 sm:inline">{brandName}</span>}
      </div>
      {/*
        Who is signed in, then the bell.

        Everything a person does to their own session lives behind one control - the role, the
        appearance, the settings and signing out. The appearance had a pill of its own beside this
        one, which put two curved bars on a bar that also carries the product name; it is a setting
        like the others and now sits with them. The bell stays outside because it is the only one
        of these that is about the world rather than about the user.
      */}
      <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-2">
        {/*
          The Calendar, on the bar rather than in the Sales menu.
          
          Scheduling and joining a meeting is not a thing the sales team does to a lead - it is a
          thing anybody in the studio does - so it belongs where the controls that follow you from
          screen to screen are, beside the user's own, rather than as one entry inside one module's
          list.

          Shown to everybody, because the diary is everybody's. It used to be offered only with
          SALES / CRM Leads, which was right while the page behind it was gated the same way and
          wrong once the calendar started carrying the studio's declared holidays: the person most
          likely to want to know the office is shut on the 20th is the one holding no module
          permission at all. What is *drawn* is still decided per source against each module's own
          permission, so nothing is exposed by opening the door. An icon and no word, like the rest
          of the furniture on this bar.
        */}
        <IconButton
          // Named for the page it opens, which draws shoots and main events as readily as meetings.
          label={meetingsOpen ? "Close calendar" : "Calendar"}
          title={meetingsOpen ? "Close calendar" : "Calendar"}
          // A control with two states says which it is in, rather than leaving the colour to say it.
          aria-pressed={meetingsOpen}
          onClick={toggleMeetings}
          className={`text-slate-600 hover:bg-slate-100 ${meetingsOpen ? "bg-slate-100 text-blue-600" : ""}`}
        >
          <CalendarMonthRoundedIcon fontSize="small" aria-hidden="true" />
        </IconButton>
        <OptionsMenu
          ariaLabel={`Signed in as ${displayName}`}
          // The heading names the account, not the person: the email is what they signed in with and
          // what an admin looks a login up by, while the name is already on the button beneath. Kept
          // in its own case - the heading style uppercases, and an address is not read in capitals.
          title={user?.email ? <span className="block truncate normal-case tracking-normal">{user.email}</span> : displayName}
          menuClassName="w-56"
          // Above the app shell's own layers, since the bar it hangs from is sticky.
          menuZIndexClassName="z-[120]"
          /*
           * The trigger is an IconButton, which is a fixed square. Its size classes are overridden
           * rather than the component changed, so this reads as a labelled control beside the
           * appearance pill instead of a cramped icon with the name wrapping inside it.
           */
          /*
           * The curved bar the appearance picker used to be. Its trigger is an IconButton, which
           * is a fixed square, so the size classes are overridden rather than the component
           * changed. `crm-user-button` is the hook globals.css already had for it. At rest it is
           * the initial and the name alone; the box - a tint and a hairline - appears under the
           * pointer and on keyboard focus, so the bar carries one less permanent shape.
           */
          triggerClassName="crm-user-button !h-auto !w-auto whitespace-nowrap rounded-full border border-transparent bg-transparent !px-3 !py-1.5 !text-sm font-medium text-slate-700 hover:border-slate-200 hover:bg-slate-100 focus-visible:border-slate-200 focus-visible:bg-slate-100"
          triggerContent={
            <span className="flex items-center gap-2">
              {/* The face first, then the name - the way a contact reads. On a phone the name
                  goes and the face stands in for it. The colour behind the initials follows the
                  login's id, so it stays the same if the person is renamed. */}
              <EmployeeAvatar name={displayName} photoUrl={photoUrl} seed={user?.id ?? displayName} size="xs" />
              <span className="hidden max-w-[12rem] truncate sm:inline">{displayName}</span>
              <ChevronIcon size={18} className="shrink-0 text-slate-500" />
            </span>
          }
          items={[
            /*
             * The three appearances, on a row that opens a flyout rather than as three rows of
             * their own - the menu is about the person, and the mode is one of the things they
             * set. OptionsMenu already draws the row with a `›` and flips the flyout to whichever
             * side has room, which beside the right edge of the bar is the left.
             */
            {
              label: "Appearance",
              // Wide enough for "Enhanced Dark Mode" and its icon on one line.
              submenuClassName: "w-52",
              submenu: THEMES.map((value) => ({
                label: THEME_LABELS[value],
                icon: <ThemeIcon theme={value} />,
                selected: appearance === value,
                onSelect: () => setAppearance(value),
              })),
            },
            // Your own page, first: the menu is about the person, and this is the person. The page
            // it was chosen from is noted so the Back button on it knows where to return.
            { label: "My Profile", onSelect: () => { rememberProfileReturnTo(pathname); router.push("/profile"); } },
            /*
             * No "User Settings" row. It opened a second full-screen Settings whose whole content -
             * the WhatsApp table - Settings below already lists, under User Settings > WhatsApp; it
             * had held Studio Branding too until that moved to Settings, and what was left was one
             * screen reachable two ways, from two menu rows a line apart. The overlay is gone with
             * the row; `WhatsAppUsersTable` is unchanged and is where it always also was.
             */
            // The release, reached from here rather than printed in the sidebar's footer: the menu
            // is where a person looks for what concerns their own session, and "which build am I
            // on" is that. A plain item, not one with a `description` - the menu draws that kind as
            // a line of text with nothing to press.
            { label: "Release Information", onSelect: () => setReleaseOpen(true) },
            /*
             * Offered to everybody, because everybody has something in there.
             *
             * This row used to be withheld from `user.role === "EMPLOYEE"`, which is the legacy role
             * column rather than a permission - so it silently overruled the permission system and
             * could be granted to nobody (CLAUDE.md Rule 4). Every account the studio issues carries
             * that value, so granting a role its Settings sections changed nothing: the door was
             * hidden before anything asked what was behind it.
             *
             * What each person sees inside is decided by the thirteen `SETTINGS` permissions, one
             * per rail entry, and nobody opens an empty overlay - **User Preference** is their own
             * sidebar order and appearance, which is not the studio's to withhold.
             */
            {
              label: "Settings",
              onSelect: () => {
                setSettingsInitialSection("whatsapp");
                setSettingsInitialIntegration(null);
                setSettingsInitialNotice(null);
                setSettingsSession((current) => current + 1);
                setAdminSettingsOpen(true);
              },
            },
            { label: "Sign out", tone: "danger", onSelect: () => setConfirmSignOut(true) },
          ]}
        />
        {/*
          The bell: one panel for everything the application has to tell this person - the tasks
          they have been given or that they set and somebody has answered, and the day's meetings.

          It used to be the meetings alone, gated on SALES / CRM Leads, which left the bar with a
          control called "Notifications" that knew about one module. `AppNotifications` decides for
          itself which halves this reader may see, and falls back to the same quiet bell for
          somebody who may see neither - so there is nothing to gate here. Selecting a meeting still
          opens the Meetings page through the same toggle the icon beside it uses, so the bar has
          one way in and one way back out.
        */}
        <AppNotifications onOpenMeetings={() => { if (!meetingsOpen) toggleMeetings(); }} />
      </div>
    </header>
    <SettingsOverlay
      key={settingsSession}
      open={adminSettingsOpen}
      onClose={() => {
        setAdminSettingsOpen(false);
        setSettingsInitialIntegration(null);
        setSettingsInitialNotice(null);
      }}
      initialSection={settingsInitialSection}
      initialIntegration={settingsInitialIntegration}
      initialNotice={settingsInitialNotice}
      onCustomFieldsSaved={announceTableSettingsSaved}
    />
    <ReleaseInfoDialog open={releaseOpen} onClose={() => setReleaseOpen(false)} />
    <ConfirmDialog
      open={confirmSignOut}
      title="Sign out?"
      message="Are you sure you want to sign out of DBS Operations OS?"
      confirmLabel="Sign out"
      tone="primary"
      onCancel={() => setConfirmSignOut(false)}
      onConfirm={logout}
    />
  </>;
}
