"use client";

import { useCallback, useEffect, useState } from "react";
import UploadDock from "@/components/image-selection/UploadDock";
import { SelectionActionsProvider } from "@/components/data-table/TableSelectionActions";
import { DOCK_WIDTH_CLASS, isNebulaDocked, onNebulaDockChange } from "@/lib/ai/nebulaPanel";
import AppSidebar from "./AppSidebar";
import AppTopbar from "./AppTopbar";
import useUsageHeartbeat from "./useUsageHeartbeat";
import WhatsappRequiredGate from "@/components/sales/WhatsappRequiredGate";

export default function AppShell({ children, theme }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  /*
   * Stable, because the drawer subscribes to the document with `onClose` among its dependencies:
   * an arrow rebuilt on every render of this shell would tear that listener down and put it back on
   * each one.
   */
  const closeSidebar = useCallback(() => setSidebarOpen(false), []);
  const toggleSidebar = useCallback(() => setSidebarOpen((open) => !open), []);

  /*
   * Whether a docked assistant is on screen, so the page can make room for it.
   *
   * The panel is `fixed` to the right edge, so without this the page lays out as though it were not
   * there and the module header's own controls end up behind it - Add Lead and the ⋮ menu were
   * still on the page and completely invisible. Insetting the content means the page reflows into
   * what is left instead of being covered.
   *
   * Seeded from the current value rather than `false`, so a shell that mounts while a panel is
   * already open does not start off wrong.
   */
  const [docked, setDocked] = useState(isNebulaDocked);
  useEffect(() => onNebulaDockChange(setDocked), []);

  /*
   * How long this person actually spends in the application, reported from here.
   *
   * The shell is the one thing mounted on every signed-in screen and unmounted on none, so a
   * person moving between modules is one continuous stretch rather than one per page. It beats
   * only while the tab is visible and they have touched something recently; see
   * `@/lib/usageHeartbeat`.
   */
  useUsageHeartbeat("app");

  return (
    /*
     * Above the header and the table alike, which is the whole reason it is here rather than on a
     * page: a table with rows ticked draws its buttons in whatever module header is on screen, and
     * neither of the two has to know about the other. See `TableSelectionActions`.
     */
    <SelectionActionsProvider>
    <div className="app-shell flex h-dvh max-w-full flex-col overflow-x-hidden bg-slate-100 text-slate-900">
      <AppTopbar theme={theme} sidebarOpen={sidebarOpen} onMenuClick={toggleSidebar} />
      {/*
        * The row the drawer and the page share, and the reason the drawer sits *below* the bar.
        *
        * The drawer used to carry the offset itself, as `top: var(--app-topbar-h)`. That put it in
        * the right place only while one utility class and one variable both held: a stylesheet an
        * open tab had not re-fetched, or a bar restyled to some other height, and the panel was back
        * over the hamburger it had just been opened from — with no `top` at all it anchors to
        * `bottom` and grows off the top of the screen, which is exactly how it failed. Here the bar
        * is a flex item above this row and the drawer is positioned within the row, so "below the
        * bar" is simply where the row begins. Nothing has to agree with anything.
        */}
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        <AppSidebar open={sidebarOpen} onClose={closeSidebar} />
        {/*
          * The room the docked assistant takes, given up by the page rather than taken from it.
          *
          * Only from `sm` up: below that the panel is a full-width sheet over the page, where there
          * is no room to give and insetting would leave the content a few pixels wide. The topbar is
          * outside this, because the panel starts under it and never covers it.
          */}
        <main className={`flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto transition-[padding] duration-200 ${docked ? DOCK_WIDTH_CLASS : ""}`}>
          <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col">{children}</div>
        </main>
      </div>
      <UploadDock />
      {/*
        * WhatsApp, before anything else.
        *
        * Everybody except an administrator has to have WhatsApp linked before they may use the
        * application, so it is a condition rather than a notice - and it lives here rather than on
        * one screen because "you may not use the application" is the shell's statement to make.
        *
        * It decides for itself whether it applies and renders nothing for everybody it does not:
        * every administrator, every account an administrator has released, anybody the WhatsApp
        * switches have turned off, and every session before the first answer has arrived. So
        * mounting it here costs the rest of the studio nothing; see `WhatsappRequiredGate`.
        */}
      <WhatsappRequiredGate />
      {/*
        The assistant, on every signed-in page. It reads the module from the path and hides itself
        where there is no single scope to use - Project Management spans two, Admin is not one.

        Mounted here rather than per page so there is one instance, one stored position and one
        implementation. It sits below every modal on purpose; see the note in the component.
      */}
    </div>
    </SelectionActionsProvider>
  );
}
