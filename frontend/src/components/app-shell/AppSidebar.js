"use client";

import Image from "next/image";
import Link from "next/link";
import Search from "@mui/icons-material/Search";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { layers } from "@/constants/layers";
import useSidebarLayout from "@/components/preferences/useSidebarLayout";

export default function AppSidebar({ open, onClose }) {
  const pathname = usePathname();

  /*
   * What this viewer is offered, and in the order they put it.
   *
   * Both halves come from one shared hook, so this drawer and the Sidebar Layout editor in Settings
   * cannot disagree: a screen is listed only where its route's permission is held — absent rather
   * than present and refused, which is the whole point of listing it here — and the modules and the
   * screens inside them are in whatever order this login arranged, which follows them to any
   * machine they sign in on. A group left with nothing goes too, so the nav carries no empty
   * headings, and while the permissions are still loading nothing is listed: a nav that shows
   * everything and then takes half of it away reads as a glitch.
   */
  const { groups: visibleGroups } = useSidebarLayout();

  /*
   * What the reader has typed into the search box at the top of the drawer.
   *
   * It narrows the nav rather than searching the app: this list is the one thing the drawer holds,
   * and a nav of seven groups is faster to filter than to read down. Matching is a
   * case-insensitive substring of a screen's label or of its group's title — typing "sales" keeps
   * that whole group, typing "quot" keeps the one screen inside it.
   *
   * Only what the viewer may already open is searched, because the permission filter above runs
   * first: search never surfaces a screen the nav would not otherwise list.
   */
  const [query, setQuery] = useState("");
  const search = query.trim().toLowerCase();
  const searchedGroups = useMemo(() => {
    if (!search) return visibleGroups;
    const matches = (text) => text.toLowerCase().includes(search);
    return visibleGroups
      .map((group) => {
        // A group whose own title matches keeps every screen in it — the reader asked for the
        // section, not for one line of it.
        if (matches(group.title)) return group;
        return {
          ...group,
          items: group.items
            .map((item) => (item.children ? { ...item, children: item.children.filter((child) => matches(child.label)) } : item))
            .filter((item) => matches(item.label) || (item.children || []).length > 0),
        };
      })
      .filter((group) => group.items.length > 0);
  }, [search, visibleGroups]);

  const toggle = (setter) => (key) => setter((current) => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  /*
   * Which groups the reader has collapsed, rather than which are open.
   *
   * Every group is open until somebody closes it, so a module added to the application - or one
   * that appears when a permission is granted - arrives expanded like the rest. Seeding a set of
   * open groups from the nav instead would have left anything the seed did not know about
   * collapsed, and would have to be rebuilt every time this person's list of modules changed.
   */
  const [collapsedGroups, setCollapsedGroups] = useState(() => new Set());
  const toggleGroup = toggle(setCollapsedGroups);

  /*
   * Closing the drawer also clears the search, so it opens on the whole nav next time — reopening
   * on somebody's last search, the one they navigated away from included, reads as a nav with
   * screens missing. Everything that closes from inside this component goes through here: the
   * links, the backdrop and the outside press below.
   */
  const closeDrawer = useCallback(() => {
    setQuery("");
    onClose();
  }, [onClose]);

  const panelRef = useRef(null);
  /*
   * A press anywhere outside the drawer closes it — the topbar included.
   *
   * The backdrop closes the page area, but it starts below the topbar so that the bar stays whole
   * and usable while the nav is open. That leaves the bar itself as the one place a press landed
   * outside the drawer without closing it: the drawer stayed open behind whatever the bar's control
   * did. Listening on the document covers both, and the backdrop keeps its own handler because it
   * is also what answers the keyboard.
   *
   * On `pointerdown` in the capture phase, so the drawer is already closing as the control being
   * pressed acts rather than a frame after it. Closing does not swallow that press: the bar is not
   * covered by anything, so its button still receives the click that follows.
   *
   * The hamburger is exempt. It toggles, and closing here first would have it reopen the drawer it
   * had just been pressed to close.
   */
  useEffect(() => {
    if (!open) return undefined;
    const closeOnOutsidePress = (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (panelRef.current?.contains(target) || target.closest("[data-sidebar-toggle]")) return;
      closeDrawer();
    };
    document.addEventListener("pointerdown", closeOnOutsidePress, true);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePress, true);
  }, [closeDrawer, open]);

  return <>
    {/*
      * The backdrop fades rather than being switched on and off.
      *
      * It used to toggle `block`/`hidden`, so the dim appeared and vanished in one frame while the
      * panel beside it took 200ms to slide — one gesture reading as two. It now shares the panel's
      * duration and curve, and stays in the DOM so both directions animate.
      *
      * Closed it is inert rather than merely transparent: no pointer events, out of the tab order,
      * and out of the accessibility tree, so an invisible full-screen button cannot be reached.
      *
      * It covers the page area only, never the top bar, because the row it fills starts where the
      * bar ends — the bar stays whole and usable with the nav open. The press that lands on the bar
      * is caught by the document listener above instead.
      *
      * Within that row it dims everything, and the assistant panel is part of everything. Its layer
      * is `navScrim` rather than a number of its own: under the assistant's own layer it dimmed the
      * page and left Nebula lit beside it, which read as two applications rather than as one screen
      * with a drawer over it. Nebula is `fixed` and this is `absolute`, but neither the row nor
      * anything between them opens a stacking context, so the two still compare by z-index alone.
      * See `@/constants/layers` for why this sits where it does.
      */}
    <button
      aria-label="Close navigation"
      aria-hidden={!open}
      tabIndex={open ? 0 : -1}
      onClick={closeDrawer}
      className={`absolute inset-0 ${layers.navScrim} bg-slate-950/25 transition-opacity duration-200 ease-out ${open ? "opacity-100" : "pointer-events-none opacity-0"}`}
    />
    {/* `app-sidebar` is the hook globals.css uses for the dark theme; the class stays. */}
    {/*
      * The drawer begins where the topbar ends, and it does so by *position in the layout* rather
      * than by an offset it has to carry.
      *
      * Two earlier attempts got this wrong in the same visible way — the panel covering the left end
      * of the bar, hamburger and studio mark included, the moment it opened. First as `inset-y-0`
      * with the bar's height as padding, which moved the links down but left the white background,
      * border and shadow starting at the top of the screen. Then as `fixed` with
      * `top: var(--app-topbar-h)`, which is right only while that one arbitrary-value utility is in
      * the stylesheet the page actually has: where it is missing the panel has no `top` at all, so
      * it anchors to `bottom-0`, takes its content's height, and grows up off the top of the screen
      * — the nav cut off at the top, the bar covered, which is precisely the report.
      *
      * `AppShell` now renders this inside the row *below* the bar, so `inset-y-0` here is the row's
      * height: bounded, so the nav scrolls inside the panel instead of overflowing the viewport, and
      * below the bar with nothing left to agree about. `absolute` rather than `fixed` also means the
      * shell's own `overflow-x-hidden` clips the closed panel off-canvas.
      */}
    <aside ref={panelRef} className={`app-sidebar absolute inset-y-0 left-0 ${layers.nav} flex w-72 max-w-[85vw] -translate-x-full flex-col border-r border-slate-200 bg-white shadow-xl transition-transform duration-200 ease-out will-change-transform ${open ? "translate-x-0" : ""}`}>
      {/* Fixed at the top of the drawer, outside the scrolling nav, so it stays reachable however
          far down the list somebody has scrolled. The magnifier sits inside the field the way it
          does on every other search box in the app (see ProjectSidebar), and is `pointer-events-none`
          so a press on it still lands in the input behind it. */}
      <div className="border-b border-slate-200 p-2">
        <label className="relative block">
          <span className="sr-only">Search navigation</span>
          <Search style={{ fontSize: 16 }} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} type="search" placeholder="Search..." className="h-9 w-full rounded-md border border-slate-300 bg-white pl-8 pr-2 text-sm text-slate-700 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" />
        </label>
      </div>
      <nav className="flex-1 overflow-y-auto px-2 py-1.5" aria-label="Primary navigation">{search && searchedGroups.length === 0 && <p className="px-2.5 py-2 text-sm text-slate-500">No screens match “{query.trim()}”.</p>}{searchedGroups.map((group) => {
        // While a search is running every remaining group is open: what was collapsed before the
        // reader typed is not an answer they have to click past to see. Collapsing goes back to
        // whatever it was the moment the box is cleared.
        const isExpanded = search ? true : !collapsedGroups.has(group.id);
        /*
         * ── How tight this list is, and why ──────────────────────────────────────────────────
         *
         * A nav of seven groups and twenty screens is read by scanning, not by aiming: the drawer
         * has to show as much of itself as it can without being scrolled, or the sections at the
         * bottom - Accounts, Resource Management - are ones nobody discovers. Every measure below
         * was one step looser and the whole list ran past the fold on a laptop.
         *
         * The gaps went first, then the padding. Rows sit flush against each other rather than
         * carrying a `space-y` between them: they are a list, and the hover fill on a row already
         * separates it from its neighbours far better than two pixels of nothing did. What is left
         * is the padding *inside* a row, which is what a press actually lands on.
         *
         * A row is 28px tall, which is deliberately below the 44px a lone button would want. It is
         * not a lone button: it spans the full width of the drawer, so the target is 280 x 28 and
         * the only way to miss it is vertically, between two rows that both go somewhere. Trading
         * six pixels of height for six more screens on the page is the right way round here.
         */
        return <section key={group.title} className="mb-1">
          <button type="button" onClick={() => toggleGroup(group.id)} aria-expanded={isExpanded} className="flex w-full items-center justify-between px-2 py-1 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 hover:text-slate-900">
            <span>{group.title}</span>
            {/* `›` points right where it is written, so the closed state turns it a quarter turn
                down and the open state a quarter turn up - the same pair every other disclosure
                uses, drawn with the character this rail already had. */}
            <span className={`text-sm transition-transform ${isExpanded ? "-rotate-90" : "rotate-90"}`}>›</span>
          </button>
          {isExpanded && <div className="mt-0.5 border-l border-slate-200 pl-2">{group.items.map((item) => {
            const children = item.children || [];
            /*
             * A child page does not light its parent as well.
             *
             * The parent's own test is a prefix one, so a page beneath an item would light both at
             * once and read as being in two places. Nothing declares children today - Reports is an
             * entry of its own, beside Leads rather than under it - but the rendering below is the
             * nav's from before, and this is the rule it needs to be correct if anything uses it.
             */
            const childActive = children.some((child) => pathname === child.href || pathname.startsWith(`${child.href}/`));
            /*
             * `activePath` reads as a prefix, like `href` beside it.
             *
             * It is what an entry claims rather than where it lands, and the two are not always the
             * same route: Image Selection opens on its dashboard but owns the Projects page under
             * it as well. Tested for equality only, that entry sat unlit on half of its own module.
             * The `/` is what keeps one claim out of another's: no entry's path is a prefix of a
             * different entry's segment, and this is what holds that true if one ever is.
             */
            const claimed = pathname === item.activePath || (item.activePath ? pathname.startsWith(`${item.activePath}/`) : false);
            const itemActive = !childActive && (claimed || pathname === item.href || pathname.startsWith(`${item.href}/`));
            return <div key={item.label}>
              {item.href
                ? <Link href={item.href} onClick={closeDrawer} className={`block rounded-md px-2.5 py-1 text-sm hover:bg-slate-50 ${itemActive ? "font-medium text-blue-600" : "text-slate-700"}`}>{item.label}</Link>
                : <span aria-disabled="true" className="block cursor-not-allowed rounded-md px-2.5 py-1 text-sm text-slate-400">{item.label}</span>}
              {children.length > 0 && <div className="ml-2 border-l border-slate-100 pl-2">
                {children.map((child) => <Link key={child.label} href={child.href} onClick={closeDrawer} className={`block rounded-md px-2.5 py-1 text-sm hover:bg-slate-50 ${pathname === child.href || pathname.startsWith(`${child.href}/`) ? "font-medium text-blue-600" : "text-slate-600"}`}>{child.label}</Link>)}
              </div>}
            </div>;
          })}</div>}
        </section>;
      })}</nav>
      {/* The release used to be named here too; it now lives under Release Information in the user menu. */}
      <div className="border-t border-slate-200 px-3 py-2 text-xs text-slate-400">Operations workspace</div>
    </aside>
  </>;
}
